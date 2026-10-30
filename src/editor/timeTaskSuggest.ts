import { AbstractInputSuggest, type App } from "obsidian";
import type { ComposerField } from "./composerField";
import { selectTimedTask, timeTaskSuggestions, type TimeTaskSuggestion } from "./composerTimeTask";

interface PendingSuggestions {
  resolve: (items: TimeTaskSuggestion[]) => void;
}

/** Obsidian owns the popup, keyboard navigation and pointer selection. */
export class TimeTaskSuggest extends AbstractInputSuggest<TimeTaskSuggestion> {
  private opened = false;
  private destroyed = false;
  private lastContext = "";
  private suppressUiUntil = 0;
  private tabConfirming = false;
  private pending: PendingSuggestions | null = null;
  private refreshQueued = false;
  private revision = 0;
  private publishedContext = "";
  private onCompositionStart = (): void => this.close();
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

  constructor(app: App, private field: ComposerField, onSubmit: () => void) {
    super(app, field.view.contentDOM as HTMLDivElement);
    this.limit = 96;
    field.addEventListener("compositionstart", this.onCompositionStart);
    const win = field.view.dom.ownerDocument.defaultView;
    win?.addEventListener("resize", this.onGeometryChange);
    win?.visualViewport?.addEventListener("resize", this.onGeometryChange);
    if (win?.ResizeObserver) {
      this.resizeObserver = new win.ResizeObserver(this.onGeometryChange);
      this.resizeObserver.observe(field.view.contentDOM);
    }
    this.scope.register([], "Tab", (evt) => {
      if (evt.isComposing || this.field.view.composing) return;
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
      if (evt.isComposing || this.field.view.composing) return;
      evt.preventDefault();
      this.close();
      onSubmit();
      return false;
    });
  }

  getValue(): string {
    return this.field.value;
  }

  protected getSuggestions(): Promise<TimeTaskSuggestion[]> {
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
            return { context: this.contextKey(), items: timeTaskSuggestions(this.field.view) };
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

  renderSuggestion(value: TimeTaskSuggestion, el: HTMLElement): void {
    el.setText(value.label);
  }

  selectSuggestion(value: TimeTaskSuggestion): void {
    const current = this.publishedContext === this.contextKey();
    this.close();
    if (current && !this.destroyed && selectTimedTask(this.field.view, value, this.tabConfirming)) this.refresh();
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
    if (!this.canSuggest() || timeTaskSuggestions(this.field.view).length === 0) {
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
    this.field.removeEventListener("compositionstart", this.onCompositionStart);
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

  private contextKey(): string {
    return `${this.field.selectionStart}:${this.field.selectionEnd}:${this.field.value}`;
  }

  private canSuggest(): boolean {
    return !this.destroyed && this.field.hasFocus && this.field.view.dom.isConnected &&
      !this.field.view.composing && !this.field.view.state.readOnly;
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
