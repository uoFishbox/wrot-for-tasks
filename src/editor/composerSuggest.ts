import { AbstractInputSuggest, Scope, type App } from "obsidian";
import type { ComposerField } from "./composerField";
import type { Moment } from "moment";
import { selectTimedTask, timeTaskSuggestions, type TimeTaskSuggestion } from "./composerTimeTask";
import { dateShiftSuggestions, type DateShiftCommand, type DateShiftSuggestion } from "./composerDateShift";
import { rebuildFocus } from "../utils/tagSuggest";
import { t } from "../i18n";

type ComposerSuggestion = TimeTaskSuggestion | DateShiftSuggestion;

interface DateNavigation {
  getDate: () => Moment;
  shiftDate: DateShiftCommand;
  canPost: () => boolean;
}

interface PendingSuggestions {
  resolve: (items: ComposerSuggestion[]) => void;
}

interface PendingSelection {
  context: string;
  value: ComposerSuggestion;
  continueRange: boolean;
}

/** Obsidian owns the popup, keyboard navigation and pointer selection. */
export class ComposerSuggest extends AbstractInputSuggest<ComposerSuggestion> {
  private opened = false;
  private destroyed = false;
  private lastContext = "";
  private suppressUiUntil = 0;
  private tabConfirming = false;
  private pending: PendingSuggestions | null = null;
  private refreshQueued = false;
  private revision = 0;
  private publishedContext = "";
  private composing = false;
  private pendingSelection: PendingSelection | null = null;
  private commitTimer: number | null = null;
  private onCompositionStart = (): void => {
    this.cancelSelection();
    this.composing = true;
  };
  private onCompositionEnd = (): void => {
    this.composing = false;
    // ComposerField listeners run before CodeMirror's compositionend handler. Let
    // it clear its composition state and read the committed DOM before inserting.
    if (this.pendingSelection) this.scheduleSelection(0);
    queueMicrotask(() => this.refresh());
  };
  private resizeObserver: ResizeObserver | null = null;
  private positionKey = {};
  private onGeometryChange = (): void => {
    if (!this.opened || this.destroyed) return;
    this.field.view.requestMeasure({
      key: this.positionKey,
      read: () => this.canSuggest() && this.hasVisibleAnchor() ? this.contextKey() : null,
      write: (context) => {
        // The native API reads layout while opening, so run it after the measurement phase.
        queueMicrotask(() => {
          if (!this.opened || this.destroyed) return;
          if (context !== this.publishedContext || context !== this.contextKey()) this.close();
          else this.open();
        });
      },
    });
  };

  constructor(app: App, private field: ComposerField, onSubmit: () => void, private dateNavigation: DateNavigation) {
    super(app, field.view.contentDOM as HTMLDivElement);
    this.limit = 96;
    // Native popup bindings only inspect event.isComposing, which may lag behind
    // the editor's IME state. A child scope bypasses those bindings without
    // preventing the key's normal input/IME action.
    this.scope = new Scope(this.scope);
    this.scope.register(null, null, (evt) => {
      if (evt.isComposing || this.isComposing()) return true;
    });
    field.addEventListener("compositionstart", this.onCompositionStart);
    field.addEventListener("compositionend", this.onCompositionEnd);
    const win = field.view.dom.ownerDocument.defaultView;
    win?.addEventListener("resize", this.onGeometryChange);
    win?.visualViewport?.addEventListener("resize", this.onGeometryChange);
    if (win?.ResizeObserver) {
      this.resizeObserver = new win.ResizeObserver(this.onGeometryChange);
      this.resizeObserver.observe(field.view.contentDOM);
    }
    this.scope.register([], "Tab", (evt) => {
      if (evt.isComposing || this.isComposing()) return;
      evt.preventDefault();
      const win = this.field.view.dom.ownerDocument.defaultView;
      if (!win || !this.canSuggest() || this.publishedContext !== this.contextKey()) {
        this.close();
        return false;
      }
      // Delegate selection to Obsidian's Enter binding, retaining its highlighted item
      // without depending on the popup's private suggestion list or DOM classes.
      this.tabConfirming = true;
      try {
        this.field.view.contentDOM.dispatchEvent(new win.KeyboardEvent("keydown", {
          key: "Enter", bubbles: true, cancelable: true,
        }));
      } finally {
        this.tabConfirming = false;
      }
      return false;
    });
    // The popup's scope inherits the app scope, so explicitly retain the form's submit shortcut.
    this.scope.register(["Mod"], "Enter", (evt) => {
      if (evt.isComposing || this.isComposing()) return;
      evt.preventDefault();
      this.close();
      onSubmit();
      return false;
    });
  }

  getValue(): string {
    return this.field.value;
  }

  protected getSuggestions(): Promise<ComposerSuggestion[]> {
    this.cancelPending();
    if (this.destroyed) return Promise.resolve([]);
    // Native input arrives before CodeMirror has read the changed DOM. Never publish
    // candidates or measure the anchor from that event's old editor state.
    return new Promise((resolve) => {
      const pending = this.pending = { resolve };
      queueMicrotask(() => {
        if (this.pending !== pending) return;
        this.field.view.requestMeasure({
          key: this,
          read: () => {
            if (this.pending !== pending || !this.canSuggest() || !this.hasVisibleAnchor()) return null;
            return { context: this.contextKey(), items: this.getComposerCandidates() };
          },
          write: (result) => {
            if (this.pending !== pending) return;
            this.pending = null;
            if (!result || !this.canSuggest() || result.context !== this.contextKey()) {
              resolve([]);
              return;
            }
            this.lastContext = this.publishedContext = result.context;
            resolve(result.items);
          },
        });
      });
    });
  }

  renderSuggestion(value: ComposerSuggestion, el: HTMLElement): void {
    if (!("shortcut" in value)) {
      el.setText(value.label);
      return;
    }
    if (value.kind === "today") {
      el.setText(t(value.post ? "view.dateNav.post.today" : "view.dateNav.shift.today"));
      return;
    }
    const action = value.post
      ? value.direction === "backward" ? "postBack" : "post"
      : value.direction === "backward" ? "back" : "shift";
    el.setText(t(`view.dateNav.${action}.${value.unit}`, { count: value.amount }));
  }

  selectSuggestion(value: ComposerSuggestion, evt?: MouseEvent | KeyboardEvent): void {
    // Enter used to commit IME text must never also select a suggestion.
    if (evt && "key" in evt && (evt.isComposing || this.isComposing())) return;
    const context = this.contextKey();
    const current = this.publishedContext === context;
    this.close();
    if (!current || this.destroyed || this.pendingSelection) return;
    if (this.isComposing()) {
      // Blur force-commits iOS's marked text. Keep the original context so a late
      // completion cannot overwrite a different edit or a moved caret.
      this.pendingSelection = { context, value, continueRange: this.tabConfirming };
      this.scheduleSelection(150);
      this.field.blur();
      return;
    }
    if (this.select(value, this.tabConfirming)) this.refresh();
  }

  open(): void {
    // A promise may settle just before blur, a new edit, or a panel being hidden.
    if (!this.canSuggest() || this.publishedContext !== this.contextKey() || !this.hasVisibleAnchor()) {
      this.close();
      return;
    }
    super.open();
    this.opened = true;
  }

  close(): void {
    this.revision++;
    this.refreshQueued = false;
    this.cancelPending();
    this.lastContext = this.contextKey();
    this.publishedContext = "";
    if (this.opened) this.suppressUiUntil = Date.now() + 400;
    this.opened = false;
    super.close();
  }

  isSuppressingUi(): boolean {
    return this.opened || Date.now() < this.suppressUiUntil;
  }

  /** Coalesce state notifications; a real input event's pending query already covers them. */
  refresh(): void {
    if (this.destroyed) return;
    if (!this.canSuggest() || this.getComposerCandidates().length === 0) {
      this.close();
      return;
    }
    if (this.pending || this.refreshQueued || this.contextKey() === this.lastContext) return;
    this.refreshQueued = true;
    const revision = this.revision;
    queueMicrotask(() => {
      if (revision !== this.revision) return;
      this.refreshQueued = false;
      if (!this.canSuggest() || this.pending || this.contextKey() === this.lastContext) return;
      // AbstractInputSuggest's public refresh mechanism is its input event. Send it
      // only for changes not already covered by a native input/focus event.
      const win = this.field.view.dom.ownerDocument.defaultView;
      if (win) this.field.view.contentDOM.dispatchEvent(new win.Event("input"));
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelSelection();
    this.field.removeEventListener("compositionstart", this.onCompositionStart);
    this.field.removeEventListener("compositionend", this.onCompositionEnd);
    this.resizeObserver?.disconnect();
    const win = this.field.view.dom.ownerDocument.defaultView;
    win?.removeEventListener("resize", this.onGeometryChange);
    win?.visualViewport?.removeEventListener("resize", this.onGeometryChange);
    this.close();
  }

  private cancelPending(): void {
    this.pending?.resolve([]);
    this.pending = null;
  }

  private isComposing(): boolean {
    return this.composing || this.field.view.compositionStarted || this.field.view.composing;
  }

  private cancelSelection(): void {
    const win = this.field.view.dom.ownerDocument.defaultView;
    if (this.commitTimer !== null) win?.clearTimeout(this.commitTimer);
    this.commitTimer = null;
    this.pendingSelection = null;
  }

  private scheduleSelection(delay: number): void {
    const win = this.field.view.dom.ownerDocument.defaultView;
    if (!win) {
      this.cancelSelection();
      return;
    }
    if (this.commitTimer !== null) win.clearTimeout(this.commitTimer);
    this.commitTimer = win.setTimeout(() => {
      const selection = this.pendingSelection;
      this.cancelSelection();
      if (!selection || this.destroyed || !this.field.view.dom.isConnected || this.isComposing() ||
          selection.context !== this.contextKey()) return;
      if (!this.select(selection.value, selection.continueRange)) return;
      if (!this.field.hasFocus) {
        rebuildFocus(this.field, this.field.view.dom.parentElement ?? this.field.view.dom);
      }
      this.refresh();
    }, delay);
  }

  private contextKey(): string {
    return `${this.dateNavigation.getDate().format("YYYY-MM-DD")}:${this.field.selectionStart}:${this.field.selectionEnd}:${this.field.value}`;
  }

  private getComposerCandidates(): ComposerSuggestion[] {
    const dates = dateShiftSuggestions(this.field.view, this.dateNavigation.getDate(), this.dateNavigation.canPost());
    return dates.length ? dates : timeTaskSuggestions(this.field.view);
  }

  private select(value: ComposerSuggestion, continueRange: boolean): boolean {
    if ("shortcut" in value) {
      return this.dateNavigation.shiftDate(this.field.view, value);
    }
    return selectTimedTask(this.field.view, value, continueRange);
  }

  private canSuggest(): boolean {
    return !this.destroyed && !this.pendingSelection && this.field.hasFocus &&
      this.field.view.dom.isConnected && !this.field.view.state.readOnly;
  }

  private hasVisibleAnchor(): boolean {
    if (!this.field.view.inView) return false;
    const el = this.field.view.contentDOM;
    const rect = el.getBoundingClientRect();
    const doc = el.ownerDocument.documentElement;
    return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
      rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < doc.clientHeight && rect.left < doc.clientWidth && el.getClientRects().length > 0;
  }
}
