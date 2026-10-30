import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { EditorState, EditorSelection } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export * from "./src/editor/composerTimeTask.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { EditorState, EditorSelection, EditorView, completeTimedTask, timedTaskOnSpace, timeTaskSuggestions, selectTimedTask } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// Exercise real CodeMirror transactions without a browser or Obsidian runtime.
function editor(doc, { caret = doc.length, selection, readOnly = false, composing = false } = {}) {
  return {
    state: EditorState.create({
      doc,
      selection: selection ?? { anchor: caret },
      extensions: [timedTaskOnSpace, EditorState.readOnly.of(readOnly), EditorState.allowMultipleSelections.of(true)],
    }),
    composing,
    transactions: [],
    dispatch(spec) {
      const transaction = this.state.update(spec);
      this.transactions.push(transaction);
      this.state = transaction.state;
    },
  };
}

function type(view, text) {
  const { from, to } = view.state.selection.main;
  const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text));
  if (!handled) view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
  return handled;
}

test("formats a time or range and leaves the caret ready for a task name", () => {
  for (const [input, expected] of [
    ["@2000", "- [ ] 20:00 "],
    ["@2000-2100", "- [ ] 20:00-21:00 "],
    ["@0900-1030", "- [ ] 09:00-10:30 "],
    ["@0000", "- [ ] 00:00 "],
    ["@2359", "- [ ] 23:59 "],
    ["@2300-0100", "- [ ] 23:00-01:00 "],
    ["- [ ] 2000", "- [ ] 20:00 "],
    ["- [ ] 2000-2130", "- [ ] 20:00-21:30 "],
    ["- [ ] 20:00-21:30", "- [ ] 20:00-21:30 "],
  ]) {
    const view = editor(input);
    assert.equal(completeTimedTask(view), true, input);
    assert.equal(view.state.doc.toString(), expected);
    assert.equal(view.state.selection.main.head, expected.length);
    assert.equal(view.transactions[0].isUserEvent("input.complete"), true);
    type(view, "会議");
    assert.equal(view.state.doc.toString(), expected + "会議");
  }
});

test("both space widths confirm; four digits still allow typing a range", () => {
  for (const space of [" ", "\u3000"]) {
    const view = editor("");
    for (const char of "@2000") type(view, char);
    assert.equal(view.state.doc.toString(), "@2000");
    for (const char of "-2100") type(view, char);
    assert.equal(view.state.doc.toString(), "@2000-2100");
    assert.equal(type(view, space), true);
    assert.equal(view.state.doc.toString(), "- [ ] 20:00-21:00 ");
  }
  const view = editor("@2000");
  assert.equal(type(view, " "), true);
  assert.equal(view.state.doc.toString(), "- [ ] 20:00 ");
});

test("reuses task markers and preserves indentation and quotes", () => {
  for (const [input, expected] of [
    ["- [ ] @2000", "- [ ] 20:00 "],
    ["  - [ ] @2000-2100", "  - [ ] 20:00-21:00 "],
    ["\t@0900", "\t- [ ] 09:00 "],
    ["> - [ ] @0900", "> - [ ] 09:00 "],
    ["> >   @0900", "> >   - [ ] 09:00 "],
    ["- @0900", "- [ ] 09:00 "],
    ["- [x] @0900", "- [x] 09:00 "],
  ]) {
    const view = editor(input);
    assert.equal(completeTimedTask(view), true, input);
    assert.equal(view.state.doc.toString(), expected);
  }
});

test("replaces only the shortcut on the current line and retains an existing task name", () => {
  const view = editor("前の行\n  @0900-1030 会議\n次の行", { caret: "前の行\n  @0900-1030".length });
  assert.equal(completeTimedTask(view), true);
  assert.equal(view.state.doc.toString(), "前の行\n  - [ ] 09:00-10:30 会議\n次の行");
  assert.equal(view.state.selection.main.head, "前の行\n  - [ ] 09:00-10:30 ".length);
});

test("invalid, incomplete and unrelated text remains literal", () => {
  for (const input of [
    "@", "@200", "@20000", "@2400", "@1260", "@9999", "@2000-", "@2000-210",
    "@2000-2400", "@2460-2100", "@20:00", "@2000-2100-2200", "本文 @2000",
    "user@2000", "`@2000", "$@2000", "[@2000", "https://example.com/@2000",
  ]) {
    const view = editor(input);
    assert.equal(completeTimedTask(view), false, input);
    assert.equal(view.state.doc.toString(), input);
    assert.equal(view.transactions.length, 0);
  }
  assert.equal(completeTimedTask(editor("@20001", { caret: 5 })), false);
});

test("code and math blocks remain literal, including unclosed blocks", () => {
  for (const doc of [
    "~~~text\n@2000\n~~~", "~~~text\n@2000", "$$\n@2000\n$$", "$$\n@2000",
  ]) {
    const view = editor(doc, { caret: doc.indexOf("@2000") + 5 });
    assert.equal(completeTimedTask(view), false, doc);
  }
  const view = editor("~~~text\ncode\n~~~\n@2000");
  assert.equal(completeTimedTask(view), true);
});

test("does not rewrite selections, multiple carets, read-only text or IME composition", () => {
  const doc = "@2000";
  for (const options of [
    { selection: { anchor: 0, head: 5 } },
    { selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)], 1) },
    { readOnly: true },
    { composing: true },
  ]) {
    const view = editor(doc, options);
    assert.equal(completeTimedTask(view), false);
    assert.equal(view.transactions.length, 0);
  }
});

test("unrelated input and replacements do not trigger the space handler", () => {
  const view = editor("@2000");
  assert.equal(type(view, "-"), false);
  assert.equal(view.state.doc.toString(), "@2000-");
  const handler = view.state.facet(EditorView.inputHandler)[0];
  assert.equal(handler(view, 0, 1, " "), false);
  assert.equal(handler(view, 0, 0, " "), false);
});

test("a bare @ suggests all quarter hours and digits narrow the candidates", () => {
  const all = timeTaskSuggestions(editor("@"));
  assert.equal(all.length, 96);
  assert.equal(all[0].label, "00:00");
  assert.equal(all.at(-1).label, "23:45");
  assert.deepEqual(timeTaskSuggestions(editor("@20")), [
    { digits: "2000", label: "20:00" },
    { digits: "2015", label: "20:15" },
    { digits: "2030", label: "20:30" },
    { digits: "2045", label: "20:45" },
  ]);
  assert.deepEqual(timeTaskSuggestions(editor("- [ ] @09")).map((item) => item.label), ["09:00", "09:15", "09:30", "09:45"]);
  assert.deepEqual(timeTaskSuggestions(editor("@23")).map((item) => item.label), ["23:00", "23:15", "23:30", "23:45"]);
  assert.deepEqual(timeTaskSuggestions(editor("@203")).map((item) => item.label), ["20:30"]);
  assert.deepEqual(timeTaskSuggestions(editor("@204")).map((item) => item.label), ["20:45"]);
  assert.deepEqual(timeTaskSuggestions(editor("@2015")).map((item) => item.label), ["20:15"]);
  for (const input of ["@8", "@08", "- [ ] 8", "@0700-8", "- [ ] 07:00-8"]) {
    assert.deepEqual(timeTaskSuggestions(editor(input)).map((item) => item.label), ["08:00", "08:15", "08:30", "08:45"], input);
  }
  assert.deepEqual(timeTaskSuggestions(editor("@9")).map((item) => item.label), ["09:00", "09:15", "09:30", "09:45"]);
  assert.deepEqual(timeTaskSuggestions(editor("@2")).map((item) => item.label), [
    "02:00", "02:15", "02:30", "02:45", "20:00", "20:15", "20:30", "20:45",
    "21:00", "21:15", "21:30", "21:45", "22:00", "22:15", "22:30", "22:45", "23:00", "23:15", "23:30", "23:45",
  ]);
  for (const input of ["- [ ] 20", "- [ ] 20:", "  - [ ] 20", "> - [ ] 20"]) {
    assert.deepEqual(timeTaskSuggestions(editor(input)).map((item) => item.label), ["20:00", "20:15", "20:30", "20:45"], input);
  }
  for (const input of ["- [ ] 203", "- [ ] 20:3", "- [ ] 20:30"]) {
    assert.deepEqual(timeTaskSuggestions(editor(input)).map((item) => item.label), ["20:30"], input);
  }
});

test("selecting a suggestion creates a timed task and preserves existing tasks and titles", () => {
  for (const [doc, caret, expected] of [
    ["@", 1, "- [ ] 00:15 "],
    ["@20", 3, "- [ ] 20:15 "],
    ["@8", 2, "- [ ] 08:15 "],
    ["- [ ] @20", 9, "- [ ] 20:15 "],
    ["- [ ] 20", 8, "- [ ] 20:15 "],
    ["- [ ] 20: 会議", 9, "- [ ] 20:15 会議"],
    ["  @20 会議", 5, "  - [ ] 20:15 会議"],
  ]) {
    const view = editor(doc, { caret });
    assert.equal(selectTimedTask(view, timeTaskSuggestions(view)[1]), true);
    assert.equal(view.state.doc.toString(), expected);
  }
});

test("range completion suggests and inserts the end time", () => {
  const view = editor("@2000-21");
  const suggestions = timeTaskSuggestions(view);
  assert.deepEqual(suggestions.map((item) => item.label), ["21:00", "21:15", "21:30", "21:45"]);
  assert.equal(selectTimedTask(view, suggestions[1]), true);
  assert.equal(view.state.doc.toString(), "- [ ] 20:00-21:15 ");
  assert.equal(timeTaskSuggestions(editor("@2000-")).length, 16);
  for (const input of ["@0800-", "- [ ] 08:00-"]) {
    const ends = timeTaskSuggestions(editor(input));
    assert.equal(ends.length, 64, input);
    assert.equal(ends[0].label, "08:00");
    assert.equal(ends.at(-1).label, "23:45");
    assert.equal(ends.every(item => item.digits >= "0800"), true);
  }
  for (const input of ["@0800-07", "@0800-0759", "- [ ] 08:00-07:59", "@2000-8", "- [ ] 20:00-8"]) {
    assert.deepEqual(timeTaskSuggestions(editor(input)), [], input);
  }
  assert.deepEqual(timeTaskSuggestions(editor("@0800-0800")), [{ digits: "0800", label: "08:00" }]);
  assert.equal(timeTaskSuggestions(editor("- [ ] 08:10-"))[0].label, "08:15");
  assert.deepEqual(timeTaskSuggestions(editor("- [ ] 23:45-")), [{ digits: "2345", label: "23:45" }]);
  assert.deepEqual(timeTaskSuggestions(editor("- [ ] 23:59-")), []);
});

test("Tab on a start suggestion writes the formatted start and opens end-time completion", () => {
  for (const [input, index, expected] of [
    ["@", 0, "- [ ] 00:00-"],
    ["@20", 0, "- [ ] 20:00-"],
    ["@8", 0, "- [ ] 08:00-"],
    ["@9", 1, "- [ ] 09:15-"],
    ["@20", 1, "- [ ] 20:15-"],
    ["@2015", 0, "- [ ] 20:15-"],
    ["  - [ ] @20", 0, "  - [ ] 20:00-"],
    ["- [ ] 20", 0, "- [ ] 20:00-"],
    ["- [ ] 20:", 1, "- [ ] 20:15-"],
    ["> @09", 1, "> - [ ] 09:15-"],
  ]) {
    const view = editor(input);
    assert.equal(selectTimedTask(view, timeTaskSuggestions(view)[index], true), true, input);
    assert.equal(view.state.doc.toString(), expected);
    assert.equal(view.state.selection.main.head, expected.length);
    const ends = timeTaskSuggestions(view);
    const startTime = expected.slice(-6, -1);
    assert.equal(ends[0].label, startTime);
    assert.equal(ends.every(item => item.label >= startTime), true);
    type(view, "21");
    assert.deepEqual(timeTaskSuggestions(view).map((item) => item.label), ["21:00", "21:15", "21:30", "21:45"]);
    assert.equal(selectTimedTask(view, timeTaskSuggestions(view)[1], true), true);
    assert.equal(view.state.doc.toString(), expected + "21:15 ");
    assert.deepEqual(timeTaskSuggestions(view), []);
  }
});

test("Tab retains the task title while entering and completing a range", () => {
  const view = editor("前の行\n  @20 会議\n次の行", { caret: "前の行\n  @20".length });
  assert.equal(selectTimedTask(view, timeTaskSuggestions(view)[0], true), true);
  assert.equal(view.state.doc.toString(), "前の行\n  - [ ] 20:00- 会議\n次の行");
  assert.equal(view.state.selection.main.head, "前の行\n  - [ ] 20:00-".length);
  type(view, "21");
  assert.equal(selectTimedTask(view, timeTaskSuggestions(view)[0]), true);
  assert.equal(view.state.doc.toString(), "前の行\n  - [ ] 20:00-21:00 会議\n次の行");
});

test("formatted task ranges also accept full end times through the space shortcut", () => {
  const view = editor("- [ ] 20:00-");
  type(view, "2130");
  assert.equal(type(view, " "), true);
  assert.equal(view.state.doc.toString(), "- [ ] 20:00-21:30 ");
  for (const input of ["20:00-21", "本文 20:00-21", "- [ ] 24:00-21", "~~~\n- [ ] 20:00-21"]) {
    assert.deepEqual(timeTaskSuggestions(editor(input)), [], input);
  }
});

test("invalid contexts and stale suggestions do not change the document", () => {
  for (const doc of [
    "@24", "@206", "@2000-24", "@20-21", "本文 @20", "~~~\n@20", "$$\n@20",
    "- [ ] ", "- [ ] 本文 20", "- [ ] 24", "- [ ] 20:60", "- [ ] 20-21",
    "20", "- 20", "~~~\n- [ ] 20", "$$\n- [ ] 20",
  ]) {
    assert.deepEqual(timeTaskSuggestions(editor(doc)), [], doc);
  }
  const view = editor("@20");
  const suggestion = timeTaskSuggestions(view)[0];
  type(view, "30");
  assert.equal(selectTimedTask(view, suggestion), false);
  assert.equal(view.state.doc.toString(), "@2030");
  assert.deepEqual(timeTaskSuggestions(editor("@20", { composing: true })), []);
  assert.deepEqual(timeTaskSuggestions(editor("@20", { readOnly: true })), []);
});
