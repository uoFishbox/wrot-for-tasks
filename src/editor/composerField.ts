import { Compartment, EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import type { App } from "obsidian";
import { NativeComposer } from "./nativeComposer";
import { Decoration, DecorationSet, EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands";
import { autoPairs } from "./composerPairs";
import { timedTaskOnSpace } from "./composerTimeTask";
import { insertTaskOnSpace } from "../utils/textareaEditor";
import { armedField, armEffectOf, armedOpener, checkStrikethrough, commitTypedLine, drawnListMarkerAt, redrawEffect, visualMode } from "./composerVisual";

type Listener = (e: Event) => void;

interface NativeOptions {
  app: App;
  enabled: boolean;
  onSubmit: () => void;
  onFailure: (error: unknown) => void;
}

const placeholderAttr = (text: string) => EditorView.contentAttributes.of({ "aria-placeholder": text });

// The range a popover is working on (the link window), painted as selected while the
// popover's own field holds the focus and the editor's real selection is not drawn.
const heldRangeEffect = StateEffect.define<{ from: number; to: number } | null>();
const heldMark = Decoration.mark({ class: "wrot-held-range" });
const heldRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(heldRangeEffect)) continue;
      next = e.value && e.value.to > e.value.from
        ? Decoration.set([heldMark.range(e.value.from, e.value.to)])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The composer's editor, behind the surface the textarea used to offer.
 *
 * Everything that drives the composer (toolbar actions, list handling, tag completion, the
 * IME workarounds) was written against a textarea: read the value and selection, write
 * them back, announce the change with an input event. This keeps those terms so the editor
 * underneath could change without rewriting each of them.
 *
 * Contract kept from the textarea:
 * - Writing `value` or the selection does not fire "input"; user edits do, after the fact.
 *   Callers that change the text announce it themselves with dispatchEvent("input").
 * - DOM listeners run in the capture phase, ahead of CodeMirror's own handlers, so a
 *   preventDefault (Enter on a list, an image paste or drop) keeps CodeMirror out of it.
 */
export class ComposerField {
  view!: EditorView;
  private nativeEditor: NativeComposer | null = null;
  private host: HTMLElement;
  private domListeners = new Map<string, Set<Listener>>();
  private readOnlyValue = false;
  private revision = 0;
  private destroyed = false;
  private inputListeners = new Set<Listener>();
  private selectionListeners = new Set<() => void>();
  private readOnlyConf = new Compartment();
  private placeholderConf = new Compartment();
  private strikeConf = new Compartment();
  private holder: object | null = null;

  constructor(parent: HTMLElement, private placeholderText: string, private strikeDone: boolean, private autoPair: () => boolean, private extensions: Extension[] = [], private nativeOptions?: NativeOptions) {
    this.host = parent.createDiv({ cls: "wrot-composer-host" });
    this.mount(nativeOptions?.enabled ?? false);
  }

  get isNative(): boolean {
    return this.nativeEditor !== null;
  }

  private mount(native: boolean): void {
    const revision = ++this.revision;
    const common: Extension[] = [
      // Task/date shortcuts must precede the native Markdown input handlers.
      Prec.highest([
        ...this.extensions,
        timedTaskOnSpace,
        EditorView.inputHandler.of((view, from, to, text) => {
          if ((text !== " " && text !== "\u3000") || view.composing || view.state.readOnly) return false;
          if (view.state.selection.ranges.length !== 1 || from !== to || from !== this.selectionStart) return false;
          return insertTaskOnSpace(this);
        }),
      ]),
      // A CSS placeholder avoids CodeMirror's widget interfering with mobile long-press.
      this.placeholderConf.of(placeholderAttr(this.placeholderText)),
      // Use facets because CodeMirror rewrites the DOM class attribute on focus.
      EditorView.editorAttributes.of({ class: native ? "wrot-native-textarea" : "wrot-textarea" }),
      EditorView.editorAttributes.compute(["doc"], (s) => ({ class: s.doc.length ? "" : "wrot-composer-empty" })),
      this.readOnlyConf.of([EditorState.readOnly.of(this.readOnlyValue), EditorView.editable.of(!this.readOnlyValue)]),
      heldRangeField,
      ...(native ? [armedField] : []),
      EditorView.updateListener.of((update) => {
        const typed = update.docChanged && update.transactions.some((tr) =>
          tr.isUserEvent("input") || tr.isUserEvent("delete") ||
          tr.isUserEvent("undo") || tr.isUserEvent("redo") || tr.isUserEvent("move"));
        const composing = update.view.composing;
        // Native commands may omit userEvent; our own value replacements stay silent.
        // Listeners can write into the editor, so notify only after the update finishes.
        if (typed || (native && update.docChanged && !this.writingValue)) queueMicrotask(() => {
          if (this.destroyed || revision !== this.revision) return;
          this.emitInput(new InputEvent("input", { isComposing: composing }));
        });
        if (update.selectionSet || update.docChanged) queueMicrotask(() => {
          if (this.destroyed || revision !== this.revision) return;
          this.selectionListeners.forEach((cb) => cb());
        });
      }),
    ];
    if (native && this.nativeOptions) {
      let editor: NativeComposer | null = null;
      try {
        editor = new NativeComposer(this.nativeOptions.app, this.host, common, this.nativeOptions.onSubmit);
        editor.load();
        this.view = editor.editorView;
        this.nativeEditor = editor;
        this.host.addClass("wrot-native-composer");
        return;
      } catch (error) {
        try {
          editor?.unload();
        } catch (cleanupError) {
          console.error("Wrot: could not unload the failed native editor", cleanupError);
        }
        this.host.empty();
        this.nativeOptions.onFailure(error);
        // Build fresh extensions with the custom editor's visual state.
        this.mount(false);
        return;
      }
    }
    this.view = new EditorView({
      parent: this.host,
      state: EditorState.create({
        extensions: [
          ...common,
          history(),
          autoPairs(this.autoPair),
          // Plain newline first: the standard binding copies the line's indentation,
          // which a textarea never did. Lists get their marker from the view's handler.
          keymap.of([
            { key: "Enter", run: insertNewline, shift: insertNewline },
            ...standardKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "on" }),
          visualMode(),
          this.strikeConf.of(checkStrikethrough.of(this.strikeDone)),
        ],
      }),
    });
  }

  /** Swap only the editor; the surrounding form, attachments and event wiring survive. */
  setNative(enabled: boolean): void {
    if (enabled === this.isNative || this.destroyed) return;
    const value = this.value;
    const selection = this.view.state.selection;
    const armed = this.armedOpener();
    const focused = this.hasFocus;
    this.unmount();
    this.host.empty();
    this.host.removeClass("wrot-native-composer");
    this.mount(enabled);
    this.value = value;
    this.view.dispatch({ selection });
    this.setArmedFormat(armed?.pos ?? null, armed?.marker);
    for (const [type, listeners] of this.domListeners) {
      for (const listener of listeners) this.view.contentDOM.addEventListener(type, listener, true);
    }
    if (focused) this.focus();
  }

  private unmount(): void {
    // Blur first so native keymap scopes are removed even if the DOM is detached later.
    this.blur();
    if (this.nativeEditor) this.nativeEditor.unload();
    else this.view.destroy();
    this.nativeEditor = null;
  }

  private writingValue = false;

  get value(): string {
    return this.view.state.doc.toString();
  }

  // Replaces only the span that differs, so the caret, undo history and IME state around
  // an unchanged region are left where they were.
  set value(next: string) {
    const current = this.value;
    if (current === next) return;
    let from = 0;
    while (from < current.length && from < next.length && current[from] === next[from]) from++;
    let endCur = current.length;
    let endNext = next.length;
    while (endCur > from && endNext > from && current[endCur - 1] === next[endNext - 1]) {
      endCur--;
      endNext--;
    }
    this.writingValue = true;
    try {
      this.view.dispatch({ changes: { from, to: endCur, insert: next.slice(from, endNext) } });
    } finally {
      this.writingValue = false;
    }
  }

  get selectionStart(): number {
    return this.view.state.selection.main.from;
  }

  set selectionStart(pos: number) {
    this.setSelectionRange(pos, Math.max(pos, this.selectionEnd));
  }

  get selectionEnd(): number {
    return this.view.state.selection.main.to;
  }

  set selectionEnd(pos: number) {
    this.setSelectionRange(Math.min(this.selectionStart, pos), pos);
  }

  setSelectionRange(start: number, end: number): void {
    const len = this.view.state.doc.length;
    const anchor = Math.max(0, Math.min(start, len));
    const head = Math.max(anchor, Math.min(end, len));
    this.view.dispatch({ selection: { anchor, head } });
  }

  get hasFocus(): boolean {
    return this.nativeEditor?.hasFocus ?? this.view.hasFocus;
  }

  // The editor's own focus also writes its selection into the DOM; a bare DOM focus would let
  // the browser's caret (often the start) be read back as the selection. It never scrolls.
  focus(): void {
    this.view.focus();
  }

  blur(): void {
    this.view.contentDOM.blur();
  }

  set readOnly(on: boolean) {
    this.readOnlyValue = on;
    this.view.dispatch({ effects: this.readOnlyConf.reconfigure([EditorState.readOnly.of(on), EditorView.editable.of(!on)]) });
  }

  setPlaceholder(text: string): void {
    this.placeholderText = text;
    if (this.view.contentDOM.getAttribute("aria-placeholder") === text) return;
    this.view.dispatch({ effects: this.placeholderConf.reconfigure(placeholderAttr(text)) });
  }

  /**
   * Tells visual mode where the toolbar's pending bold/italic opener sits, so it can be
   * hidden while its text is typed. Null once the mode ends.
   */
  setArmedFormat(pos: number | null, marker = ""): void {
    this.view.dispatch({ effects: armEffectOf(pos, marker) });
  }

  /** The pending opener visual mode is tracking, or null. */
  armedOpener(): { pos: number; marker: string } | null {
    return armedOpener(this.view.state);
  }

  /**
   * Keeps [from, to] painted as selected while focus is elsewhere. null clears it, but only
   * for the holder that set it, so a late clear from one owner leaves another's hold.
   */
  holdRange(range: { from: number; to: number } | null, holder: object): void {
    if (!range && this.holder !== holder) return;
    this.holder = range ? holder : null;
    this.view.dispatch({ effects: heldRangeEffect.of(range) });
  }

  setCheckStrikethrough(on: boolean): void {
    this.strikeDone = on;
    if (this.isNative) return;
    this.view.dispatch({ effects: this.strikeConf.reconfigure(checkStrikethrough.of(on)) });
  }

  /** End of the drawn list marker the caret sits before or just after (see composerVisual). */
  listMarkerAtCaret(): number | null {
    if (this.isNative) return null;
    const sel = this.view.state.selection.main;
    return sel.empty ? drawnListMarkerAt(this.view.state, sel.head) : null;
  }

  /** Converts typed syntax on the caret's line; true if there was any (see composerVisual). */
  commitTypedLine(): boolean {
    if (this.isNative) return false;
    return commitTypedLine(this.view);
  }

  /** Rebuilds what visual mode draws, for when something outside the text changed. */
  redraw(): void {
    if (this.isNative) return;
    this.view.dispatch({ effects: redrawEffect.of(null) });
  }

  /** Viewport coordinates of the character edge at pos. */
  coordsAt(pos: number, side: -1 | 1 = 1): { left: number; bottom: number } | null {
    return this.view.coordsAtPos(pos, side);
  }

  contains(node: Node | null): boolean {
    return this.view.dom.contains(node);
  }

  getBoundingClientRect(): DOMRect {
    return this.view.dom.getBoundingClientRect();
  }

  /** Fires after the selection or the text changed, once the editor has settled. */
  onSelectionChange(cb: () => void): void {
    this.selectionListeners.add(cb);
  }

  addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (e: HTMLElementEventMap[K]) => void): void;
  addEventListener(type: string, listener: Listener): void {
    if (type === "input") this.inputListeners.add(listener);
    else {
      if (!this.domListeners.has(type)) this.domListeners.set(type, new Set());
      this.domListeners.get(type)!.add(listener);
      this.view.contentDOM.addEventListener(type, listener, true);
    }
  }

  removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (e: HTMLElementEventMap[K]) => void): void;
  removeEventListener(type: string, listener: Listener): void {
    if (type === "input") this.inputListeners.delete(listener);
    else {
      this.domListeners.get(type)?.delete(listener);
      this.view.contentDOM.removeEventListener(type, listener, true);
    }
  }

  dispatchEvent(event: Event): boolean {
    if (event.type === "input") this.emitInput(event);
    else this.view.contentDOM.dispatchEvent(event);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.inputListeners.clear();
    this.selectionListeners.clear();
    for (const [type, listeners] of this.domListeners) {
      for (const listener of listeners) this.view.contentDOM.removeEventListener(type, listener, true);
    }
    this.domListeners.clear();
    this.unmount();
    this.host.remove();
  }

  private emitInput(event: Event): void {
    for (const listener of this.inputListeners) listener(event);
  }
}
