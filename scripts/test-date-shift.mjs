import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";
import moment from "moment";

const bundle = await build({
  stdin: {
    contents: `export { EditorState, EditorSelection } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export * from "./src/editor/composerDateShift.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { EditorState, EditorSelection, EditorView, dateShiftCommand, dateShiftOnSpace } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function editor(doc, { base = "2026-10-31", today = "2026-10-31", caret = doc.length, selection, readOnly = false, composing = false, compositionStarted = composing } = {}) {
  const original = moment(base);
  let date = original;
  let shifts = 0;
  let followToday = false;
  let post = false;
  const command = dateShiftCommand(() => date, (next, follow, submit) => { date = next; followToday = follow; post = submit; shifts++; }, () => moment(today));
  const view = {
    state: EditorState.create({
      doc,
      selection: selection ?? { anchor: caret },
      extensions: [dateShiftOnSpace(command), EditorState.readOnly.of(readOnly), EditorState.allowMultipleSelections.of(true)],
    }),
    composing,
    compositionStarted,
    dispatch(spec) { this.state = this.state.update(spec).state; },
  };
  return { view, command, original, get date() { return date; }, get shifts() { return shifts; }, get followToday() { return followToday; }, get post() { return post; } };
}

test("all units navigate from the displayed day without mutating the original date", () => {
  for (const [input, expected] of [
    ["@1d", "2026-11-01"], ["@1w", "2026-11-07"],
    ["@1m", "2026-11-30"], ["@1y", "2027-10-31"],
    ["@3d", "2026-11-03"], ["@2w", "2026-11-14"],
    ["@12m", "2027-10-31"], ["@10y", "2036-10-31"],
    ["@0d", "2026-10-31"],
    ["@1d-", "2026-10-30"], ["@2w-", "2026-10-17"],
    ["@1m-", "2026-09-30"], ["@1y-", "2025-10-31"],
  ]) {
    const h = editor(input);
    assert.equal(h.command(h.view), true, input);
    assert.equal(h.date.format("YYYY-MM-DD"), expected, input);
    assert.equal(h.original.format("YYYY-MM-DD"), "2026-10-31");
    assert.equal(h.view.state.doc.toString(), "");
    assert.equal(h.view.state.selection.main.head, 0);
    assert.equal(h.shifts, 1);
    assert.equal(h.followToday, false);
  }
});

test("month and year shifts clamp month ends and leap days", () => {
  for (const [base, input, expected] of [
    ["2026-01-31", "@1m", "2026-02-28"],
    ["2028-01-31", "@1m", "2028-02-29"],
    ["2028-02-29", "@1y", "2029-02-28"],
    ["2028-02-29", "@4y", "2032-02-29"],
    ["2026-12-31", "@1m", "2027-01-31"],
    ["2026-03-31", "@1m-", "2026-02-28"],
    ["2028-03-31", "@1m-", "2028-02-29"],
    ["2028-02-29", "@1y-", "2027-02-28"],
    ["2026-01-01", "@1d-", "2025-12-31"],
  ]) {
    const h = editor(input, { base });
    assert.equal(h.command(h.view), true);
    assert.equal(h.date.format("YYYY-MM-DD"), expected);
  }
});

test("days and weeks preserve local clock time across daylight saving changes", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const [input, expected] of [["@1d", "2026-03-08T12:00:00-04:00"], ["@1w", "2026-03-14T12:00:00-04:00"]]) {
      const h = editor(input, { base: "2026-03-07T12:00:00" });
      assert.equal(h.command(h.view), true);
      assert.equal(h.date.format(), expected);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("only the command line is cleared, preserving the draft and surrounding blank lines", () => {
  const doc = "前の行\n  @2w　 \n次の行";
  const h = editor(doc, { caret: doc.indexOf("w") + 1 });
  assert.equal(h.command(h.view), true);
  assert.equal(h.view.state.doc.toString(), "前の行\n\n次の行");
  assert.equal(h.view.state.selection.main.head, "前の行\n".length);
  assert.equal(h.date.format("YYYY-MM-DD"), "2026-11-14");
});

test("repeated commands are relative to the newly displayed date", () => {
  const h = editor("@1w");
  assert.equal(h.command(h.view), true);
  h.view.dispatch({ changes: { from: 0, insert: "@2d" }, selection: { anchor: 3 } });
  assert.equal(h.command(h.view), true);
  assert.equal(h.date.format("YYYY-MM-DD"), "2026-11-09");
  assert.equal(h.shifts, 2);
});

test("space and full-width space confirm, while typing the command alone does not", () => {
  for (const space of [" ", "　"]) {
    const h = editor("");
    const type = text => {
      const { from, to } = h.view.state.selection.main;
      const handled = h.view.state.facet(EditorView.inputHandler).some(handler => handler(h.view, from, to, text));
      if (!handled) h.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      return handled;
    };
    for (const character of "@12d") assert.equal(type(character), false);
    assert.equal(h.shifts, 0);
    assert.equal(type(space), true);
    assert.equal(h.date.format("YYYY-MM-DD"), "2026-11-12");
    assert.equal(h.view.state.doc.toString(), "");
  }
  const h = editor("@1d");
  const handler = h.view.state.facet(EditorView.inputHandler)[0];
  assert.equal(handler(h.view, 0, 1, " "), false);
  assert.equal(handler(h.view, 0, 0, " "), false);
  assert.equal(h.shifts, 0);
});

test("malformed shortcuts, prose, links, task text and unrepresentable dates remain literal", () => {
  for (const doc of [
    "@", "@t", "@tomorrow", "@todayx", "@today 本文", "本文@to", "@1", "@d", "@1D", "@1h", "@-1d", "@1.5d", "@1month", "@2000",
    "本文@1d", "@1d 本文", "mail@1d", "https://example.com/@1d", "`@1d`",
    "[@1d]", "本文 `code @1d", "本文 $math @1d", "[リンク @1d", "@9007199254740992d", "@999999999y",
    "@1d--", "@1d-x", "@1d -", "@1d- 本文", "@today-",
  ]) {
    const h = editor(doc);
    assert.equal(h.command(h.view), false, doc);
    assert.equal(h.view.state.doc.toString(), doc);
    assert.equal(h.shifts, 0);
  }
  const h = editor("@1d", { base: "9999-12-31" });
  assert.equal(h.command(h.view), false);
  const lower = editor("@1d-", { base: "0001-01-01" });
  assert.equal(lower.command(lower.view), false);
});

test("inline shortcuts remove only the date token and request posting the remaining draft", () => {
  for (const [doc, remaining, expected] of [
    ["なにかの投稿 @1d", "なにかの投稿", "2026-11-01"],
    ["なにかの投稿　@1d-", "なにかの投稿", "2026-10-30"],
    ["前の行\n- [ ] 会議 @2w\n次の行", "前の行\n- [ ] 会議\n次の行", "2026-11-14"],
    ["`コード` と $x$ と [リンク](https://example.com) @1m-", "`コード` と $x$ と [リンク](https://example.com)", "2026-09-30"],
    ["今日の投稿 @today", "今日の投稿", "2026-10-31"],
    ["費用は$100 @1d", "費用は$100", "2026-11-01"],
  ]) {
    const at = doc.lastIndexOf("@");
    const caret = at + /^\S+/.exec(doc.slice(at))[0].length;
    const h = editor(doc, { caret });
    assert.equal(h.command(h.view), true, doc);
    assert.equal(h.view.state.doc.toString(), remaining);
    assert.equal(h.date.format("YYYY-MM-DD"), expected);
    assert.equal(h.post, true);
  }
  const standalone = editor("下書き\n@1d");
  assert.equal(standalone.command(standalone.view), true);
  assert.equal(standalone.post, true);
});

test("today and its prefixes move to the current day and re-enable following today", () => {
  for (const shortcut of ["@to", "@tod", "@toda", "@today"]) {
    const doc = `下書き\n  ${shortcut}\u3000`;
    const h = editor(doc, { base: "2030-05-01", today: "2026-10-31T12:30:00" });
    assert.equal(h.command(h.view), true, shortcut);
    assert.equal(h.date.format("YYYY-MM-DD"), "2026-10-31");
    assert.equal(h.followToday, true);
    assert.equal(h.view.state.doc.toString(), "下書き\n");
    assert.equal(h.original.format("YYYY-MM-DD"), "2030-05-01");
  }
});

test("today confirms with either space width and remains literal inside code and math", () => {
  for (const space of [" ", "　"]) {
    const h = editor("@today", { base: "2030-05-01" });
    const handler = h.view.state.facet(EditorView.inputHandler)[0];
    assert.equal(handler(h.view, 6, 6, space), true);
    assert.equal(h.date.format("YYYY-MM-DD"), "2026-10-31");
    assert.equal(h.followToday, true);
  }
  for (const doc of ["~~~\n@to", "```\n@today", "$$\n@today"]) {
    const h = editor(doc);
    assert.equal(h.command(h.view), false);
    assert.equal(h.shifts, 0);
  }
});

test("a trailing hyphen waits for confirmation and either space width moves backward", () => {
  for (const space of [" ", "　"]) {
    const h = editor("@1d");
    const handler = h.view.state.facet(EditorView.inputHandler)[0];
    assert.equal(handler(h.view, 3, 3, "-"), false);
    h.view.dispatch({ changes: { from: 3, insert: "-" }, selection: { anchor: 4 } });
    assert.equal(h.shifts, 0);
    assert.equal(handler(h.view, 4, 4, space), true);
    assert.equal(h.date.format("YYYY-MM-DD"), "2026-10-30");
    assert.equal(h.shifts, 1);
  }
});

test("code and math blocks stay literal, including raw backticks and unclosed blocks", () => {
  for (const doc of [
    "~~~text\n@1d\n~~~", "~~~text\n@1d", "```text\n@1d\n```", "```text\n@1d",
    "$$\n@1d\n$$", "$$\n@1d",
  ]) {
    const h = editor(doc, { caret: doc.indexOf("@1d") + 3 });
    assert.equal(h.command(h.view), false, doc);
    assert.equal(h.shifts, 0);
  }
  const h = editor("~~~\ncode\n~~~\n@1d");
  assert.equal(h.command(h.view), true);
});

test("selection, multiple carets, read-only and IME input cannot change dates", () => {
  for (const options of [
    { selection: { anchor: 0, head: 3 } },
    { selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(3)], 1) },
    { readOnly: true }, { composing: true }, { compositionStarted: true }, { caret: 2 },
  ]) {
    const h = editor("@1d", options);
    assert.equal(h.command(h.view), false);
    assert.equal(h.view.state.doc.toString(), "@1d");
    assert.equal(h.shifts, 0);
  }
});
