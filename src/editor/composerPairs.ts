import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { findBlockRanges } from "../utils/blockSegmenter";

// Brackets and quotes only: Markdown markers already have their own handling in the composer.
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
const CLOSERS = new Set(Object.values(PAIRS));
const WORD_RE = /[\p{L}\p{N}_]/u;

/**
 * Closes a typed bracket or quote, steps over a closer typed against one, wraps a selection,
 * and deletes an empty pair with one Backspace. `enabled` is read on every keystroke so it
 * follows Obsidian's "Auto pair brackets" setting without rebuilding the editor.
 */
export function autoPairs(enabled: () => boolean): Extension {
  const input = EditorView.inputHandler.of((view, from, to, text) => {
    if (!enabled() || view.composing || text.length !== 1) return false;
    const { state } = view;
    if (state.selection.ranges.length > 1) return false;
    const next = state.sliceDoc(to, to + 1);

    if (from === to && CLOSERS.has(text) && next === text) {
      view.dispatch({ selection: { anchor: to + 1 }, userEvent: "input.type" });
      return true;
    }
    const close = PAIRS[text];
    if (!close) return false;
    if (from !== to) {
      view.dispatch({
        changes: [{ from, insert: text }, { from: to, insert: close }],
        selection: { anchor: from + 1, head: to + 1 },
        userEvent: "input.type",
      });
      return true;
    }
    // Not against a word: an apostrophe in "don't", or an opener typed right before text.
    if (close === text && WORD_RE.test(state.sliceDoc(from - 1, from))) return false;
    if (next && WORD_RE.test(next)) return false;
    view.dispatch({
      changes: { from, insert: text + close },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
    });
    return true;
  });

  const backspace = Prec.high(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          if (!enabled()) return false;
          const { main } = view.state.selection;
          if (!main.empty || main.from === 0) return false;
          const before = view.state.sliceDoc(main.from - 1, main.from);
          if (PAIRS[before] === undefined || view.state.sliceDoc(main.from, main.from + 1) !== PAIRS[before]) return false;
          view.dispatch({ changes: { from: main.from - 1, to: main.from + 1 }, userEvent: "delete.backward" });
          return true;
        },
      },
    ])
  );

  return [input, backspace, closeTags(enabled)];
}

const MARKUP_LANGS = new Set(["html", "htm", "xhtml", "xml", "svg", "vue", "svelte"]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const OPEN_TAG_TAIL_RE = /<([A-Za-z][\w:.-]*)(?:\s[^<>]*)?$/;
const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)[^<>]*?(\/?)>/g;

/** The text of the markup code block the position sits in, up to the position; null elsewhere. */
function markupBefore(view: EditorView, pos: number): string | null {
  const lines = view.state.doc.toString().split("\n");
  const line = view.state.doc.lineAt(pos).number - 1;
  const block = findBlockRanges(lines).find(
    (b) => b.kind === "codeblock" && line > b.startLine && line <= b.endLine
  );
  if (!block || !MARKUP_LANGS.has((block.lang ?? "").toLowerCase())) return null;
  return view.state.sliceDoc(view.state.doc.line(block.startLine + 2).from, pos);
}

/**
 * In html-like code blocks: ">" ending an opening tag writes its closing tag after the caret,
 * and "</" finishes the innermost tag still open. Void and self-closed tags are left alone.
 */
function closeTags(enabled: () => boolean): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (!enabled() || view.composing || from !== to || (text !== ">" && text !== "/")) return false;
    const before = markupBefore(view, from);
    if (before === null) return false;

    if (text === ">") {
      const open = OPEN_TAG_TAIL_RE.exec(before);
      if (!open || before.endsWith("/") || VOID_TAGS.has(open[1].toLowerCase())) return false;
      view.dispatch({
        changes: { from, insert: `></${open[1]}>` },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      return true;
    }

    if (!before.endsWith("<")) return false;
    const stack: string[] = [];
    for (const [, closing, name, selfClosed] of before.matchAll(TAG_RE)) {
      if (closing) {
        const at = stack.lastIndexOf(name);
        if (at !== -1) stack.length = at;
      } else if (!selfClosed && !VOID_TAGS.has(name.toLowerCase())) {
        stack.push(name);
      }
    }
    const name = stack.pop();
    if (!name) return false;
    const insert = `/${name}>`;
    view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length }, userEvent: "input.type" });
    return true;
  });
}
