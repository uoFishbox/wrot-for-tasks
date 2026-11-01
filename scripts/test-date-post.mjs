import assert from "node:assert/strict";
import { Buffer, File } from "node:buffer";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";
import moment from "moment";

const bundle = await build({
  stdin: {
    contents: `export { WrotView } from "./src/views/WrotView.ts";
      export { dateShiftCommand, dateShiftSuggestions } from "./src/editor/composerDateShift.ts";
      export { Compartment, EditorState } from "@codemirror/state";
      export { DEFAULT_TOOLBAR_LAYOUT, resolveToolbarLayout } from "./src/settings.ts";
      export { TFile, notices } from "obsidian";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "obsidian-memory-runtime",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|obsidian-daily-notes-interface|@codemirror\/commands)$/ }, args => ({ path: args.path, namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => {
        if (path === "@codemirror/commands") return { contents: `export const history = () => []; export const historyKeymap = []; export const standardKeymap = []; export const insertNewline = () => false;` };
        if (path === "obsidian-daily-notes-interface") return { contents: `export const getDailyNoteSettings = () => ({format:"YYYY-MM-DD"}); export const getTemplateInfo = async () => [""];` };
        return { contents: `
          export const notices = [];
          export class Notice { constructor(message) { notices.push(message); } }
          export class TFile { constructor(path) { this.path = path; this.name = path.split("/").pop(); this.extension = "md"; this.basename = path.replace(/\\.md$/, ""); } }
          export class ItemView {} export class Component {} export class Events {} export class MarkdownView {} export class HoverPopover {}
          export class PluginSettingTab {} export class Setting {} export class AbstractInputSuggest {}
          export class Scope {} export class Menu {} export class MenuItem {}
          export class Modal {} export class ButtonComponent {}
          export const Platform = {}; export const MarkdownRenderer = {};
          export const normalizePath = value => value;
          export const getLanguage = () => "ja";
          export const setIcon = () => {}; export const renderMath = () => {}; export const finishRenderMath = () => {};
          export const loadMathJax = async () => {};
        ` };
      });
    },
  }],
});
const { WrotView, dateShiftCommand, dateShiftSuggestions, Compartment, EditorState, TFile, notices, DEFAULT_TOOLBAR_LAYOUT, resolveToolbarLayout } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
globalThis.moment = moment;

beforeEach((t) => {
  // Keep shortcut selection and the save path's today check on the same clock.
  t.mock.method(moment, "now", () => new Date(2026, 9, 31, 12).getTime());
});

test("the @ button appears in fresh and previously saved toolbar layouts", () => {
  assert.equal(DEFAULT_TOOLBAR_LAYOUT.find(slot => slot.id === "at")?.state, "bar");
  const saved = [{ id: "image", state: "off" }, { id: "bold", state: "menu" }];
  const resolved = resolveToolbarLayout(saved);
  assert.deepEqual(resolved.slice(0, 2), saved);
  assert.equal(resolved.find(slot => slot.id === "at")?.state, "bar");
  assert.equal(resolveToolbarLayout([{ id: "at", state: "off" }]).find(slot => slot.id === "at")?.state, "off");
});

function harness(text, { failWrite = false, holdWrite = false } = {}) {
  const files = new Map();
  const writes = [];
  const attachments = [];
  let release;
  const gate = holdWrite ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const vault = {
    getAbstractFileByPath(path) { return files.get(path)?.file ?? null; },
    async create(path, content) { const file = new TFile(path); files.set(path, { file, content }); return file; },
    async getAvailablePathForAttachments(name, extension, source) {
      attachments.push({ source: source.path });
      return `${name}.${extension}`;
    },
    async createBinary(path, content) { const file = new TFile(path); files.set(path, { file, content }); return file; },
    async process(file, change) {
      await gate;
      if (failWrite) throw new Error("simulated disk failure");
      const entry = files.get(file.path);
      entry.content = change(entry.content);
      writes.push({ path: file.path, content: entry.content });
    },
  };
  const readOnly = new Compartment();
  const editor = {
    state: EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [readOnly.of(EditorState.readOnly.of(false))] }),
    composing: false, compositionStarted: false,
    dispatch(spec) { this.state = this.state.update(spec).state; },
  };
  const field = {
    view: editor,
    get value() { return editor.state.doc.toString(); },
    set value(value) { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); },
    set readOnly(value) { editor.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) }); },
    dispatchEvent() {},
  };
  const view = Object.assign(Object.create(WrotView.prototype), {
    app: { vault, plugins: { plugins: {} } },
    plugin: {
      settings: { postHeading: "", tagSuggestEnabled: false },
      async saveDraft() {},
    },
    composer: field,
    currentDate: moment("2026-10-31"), anchoredToToday: false,
    activeFormatMode: null, pendingImage: null, pendingQuote: null, pendingShrink: null,
    armedSchedule: null, editingMemo: null, toolbarEditing: false, submittingMemo: false,
    calendarPopover: null,
    async refresh() {},
    clearPendingImage() { this.pendingImage = null; },
    setPendingQuote(value) { this.pendingQuote = value; },
  });
  let submitted = Promise.resolve();
  const submit = view.submitMemo.bind(view);
  view.submitMemo = () => { submitted = submit(); return submitted; };
  const command = dateShiftCommand(
    () => view.currentDate,
    (date, today, post) => view.shiftComposerDate(date, today, post),
    () => moment(),
    () => !view.editingMemo && !view.submittingMemo
  );
  return { view, editor, command, writes, files, attachments, setFailWrite(value) { failWrite = value; }, release: () => release?.(), settled: () => submitted };
}

test("inline selection writes the remaining body to the chosen day's daily note", async () => {
  for (const [text, option, path, body] of [
    ["なにかの投稿 @1d", 0, "2026-11-01.md", "なにかの投稿"],
    ["なにかの投稿 @1d", 1, "2026-10-30.md", "なにかの投稿"],
    ["なにかの投稿 @1d-", 0, "2026-10-30.md", "なにかの投稿"],
    ["- [ ] 来週の作業 @1w", 0, "2026-11-07.md", "- [ ] 来週の作業"],
    ["過去の記録 @1m-", 0, "2026-09-30.md", "過去の記録"],
    ["今日の記録 @to", 0, "2026-10-31.md", "今日の記録"],
    ["別の行の本文\n@1d", 0, "2026-11-01.md", "別の行の本文"],
  ]) {
    const h = harness(text);
    const suggestion = dateShiftSuggestions(h.editor, h.view.currentDate)[option];
    assert.equal(h.command(h.editor, suggestion), true);
    await h.settled();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].path, path);
    assert.ok(h.writes[0].content.includes(`\n${body}\n`));
    assert.equal(h.writes[0].content.includes("@"), false);
    assert.equal(h.view.composer.value, "");
    assert.equal(h.view.currentDate.format("YYYY-MM-DD") + ".md", path);
    assert.equal(h.editor.state.readOnly, false);
  }
});

test("failed posting retains the cleaned draft on the target day and unlocks input", async () => {
  const h = harness("消えてはいけない投稿 @1d-", { failWrite: true });
  const count = notices.length;
  assert.equal(h.command(h.editor), true);
  await h.settled();
  assert.equal(h.writes.length, 0);
  assert.equal(h.view.composer.value, "消えてはいけない投稿");
  assert.equal(h.view.currentDate.format("YYYY-MM-DD"), "2026-10-30");
  assert.equal(h.editor.state.readOnly, false);
  assert.equal(h.view.submittingMemo, false);
  assert.equal(notices.length, count + 1);
  h.setFailWrite(false);
  await h.view.submitMemo();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].path, "2026-10-30.md");
  assert.ok(h.writes[0].content.includes("\n消えてはいけない投稿\n"));
  assert.equal(h.view.composer.value, "");
});

test("pending saves cannot post twice or change the target through another shortcut", async () => {
  const h = harness("一度だけ投稿 @1d", { holdWrite: true });
  assert.equal(h.command(h.editor), true);
  const first = h.settled();
  assert.equal(h.editor.state.readOnly, true);
  await h.view.submitMemo();
  assert.equal(h.command(h.editor), false);
  h.view.currentDate = moment("2030-05-01");
  h.release();
  await first;
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].path, "2026-11-01.md");
  assert.equal(h.editor.state.readOnly, false);
});

test("bare shortcuts only navigate and editing cannot trigger a new post", async () => {
  const h = harness("@1d");
  assert.equal(h.command(h.editor), true);
  await h.settled();
  assert.equal(h.writes.length, 0);
  assert.equal(h.view.composer.value, "");
  const editing = harness("既存の投稿を編集中 @1d");
  editing.view.editingMemo = { time: "test", filePath: "existing.md" };
  assert.equal(editing.command(editing.editor), false);
  assert.equal(editing.view.composer.value, "既存の投稿を編集中 @1d");
  assert.equal(editing.writes.length, 0);
});

test("text after a shortcut also posts when the suggestion says it will post", async () => {
  const h = harness("@1d\n次の行の本文");
  h.editor.dispatch({ selection: { anchor: 3 } });
  const suggestions = dateShiftSuggestions(h.editor, h.view.currentDate);
  assert.equal(suggestions[0].post, true);
  assert.equal(h.command(h.editor, suggestions[0]), true);
  await h.settled();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].path, "2026-11-01.md");
  assert.ok(h.writes[0].content.includes("\n次の行の本文\n"));
});

test("inline posting keeps the pending image and quote on the destination note", async () => {
  const h = harness("写真付きの投稿 @1d");
  h.view.pendingImage = new File(["image"], "example.png", { type: "image/png" });
  const quote = "[[source#^wr-20261031123456789]]";
  h.view.pendingQuote = quote;
  assert.equal(h.command(h.editor), true);
  await h.settled();
  assert.deepEqual(h.attachments, [{ source: "2026-11-01.md" }]);
  assert.equal(h.writes.length, 1);
  assert.match(h.writes[0].content, /\n写真付きの投稿\n!\[\[Pasted Image \d+\.png\]\]\n/);
  assert.ok(h.writes[0].content.includes(quote));
  assert.equal(h.view.pendingImage, null);
  assert.equal(h.view.pendingQuote, null);
});
