import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";
import moment from "moment";

const bundle = await build({
  stdin: {
    contents: `export { WrotView } from "./src/views/WrotView.ts";
      export { ContinuousTimeline, timelineMemos } from "./src/utils/continuousTimeline.ts";
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
        if (path === "obsidian-daily-notes-interface") return { contents: `export const dailyNoteSettings = {format:"YYYY-MM-DD"}; export const getDailyNoteSettings = () => dailyNoteSettings; export const getTemplateInfo = async () => [""];` };
        return { contents: `
          export const notices = [];
          export class Notice { constructor(message) { notices.push(message); } }
          export class TFile { constructor(path) { this.path = path; this.name = path.split("/").pop(); this.extension = "md"; this.basename = path.replace(/\\.md$/, ""); } }
          export class ItemView { async setState() {} }
          export class Component {} export class Events {} export class MarkdownView {} export class HoverPopover {}
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
const { WrotView, ContinuousTimeline, timelineMemos, TFile, notices } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
globalThis.moment = moment;

test("task panel mode restores with the workspace independently of continuous scrolling", async () => {
  const restored = [];
  const view = Object.assign(Object.create(WrotView.prototype), {
    continuousScroll: true, tasksCollapsed: false,
    remainingTasks: { setCollapsed: value => restored.push(value) },
  });
  await view.setState({ continuousScroll: true, tasksCollapsed: true }, {});
  assert.deepEqual(view.getState(), { continuousScroll: true, tasksCollapsed: true });
  await view.setState({ continuousScroll: true }, {});
  assert.deepEqual(view.getState(), { continuousScroll: true, tasksCollapsed: false });
  assert.deepEqual(restored, [true, false]);
  view.remainingTasks = null;
  await view.setState({ continuousScroll: true, tasksCollapsed: true }, {});
  assert.equal(view.getState().tasksCollapsed, true);
});

const note = day => ({ path: `${day}.md`, day });
const memo = (day, body = "post", hour = "12") => `\x60\x60\x60wr ${day}T${hour}:00:00\n${body}\n\x60\x60\x60\n`;

test("task navigation reveals its post in either timeline mode", async () => {
  for (const continuousScroll of [false, true]) {
    const file = new TFile("2026-11-20.md");
    const time = "2026-11-01T12:00:00";
    const cards = [];
    const list = {
      scrollTop: 0, clientHeight: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      style: { removeProperty() {} },
      empty() { cards.length = 0; }, addClass() {}, removeClass() {},
    };
    const view = Object.assign(Object.create(WrotView.prototype), {
      app: { vault: {
        getAbstractFileByPath: path => path === file.path ? file : null,
        getMarkdownFiles: () => [file],
        read: async () => memo("2026-11-01", "- [ ] target") + memo("2026-11-20", "other", "13"),
      } },
      plugin: { settings: { pins: [], scheduledPins: [] }, matchesRuleFlag: () => false },
      continuousScroll, timelineRevision: 0,
      listContainer: list, contentEl: { querySelectorAll: () => cards },
      closeCalendarPopover() {}, updateComposerPlaceholder() {}, updateDateLabel() {},
      setArmedSchedule() {}, releaseEditModeIfTargetGone: async () => {},
      queueTimelineScroll() {}, timelineAnchor: () => null, restoreTimelineAnchor() {},
      alignTimelineScrollTarget() {}, renderTimelineDay() {}, clearPinnedContainer() {},
      renderMemoCard(memo, options) {
        const card = {
          dataset: { memoKey: `${options.filePath}\n${memo.time}` },
          getBoundingClientRect: () => ({ top: 700, height: 100 }),
          setAttribute() {}, focus() { this.focused = true; },
        };
        cards.push(card);
        return card;
      },
    });
    await view.openTaskPost(file, time);
    // Navigate by the destination note's date, even when the post was written earlier.
    assert.equal(view.currentDate.format("YYYY-MM-DD"), "2026-11-20");
    assert.equal(view.continuousScroll, continuousScroll);
    assert.deepEqual(cards.filter(card => card.focused).map(card => card.dataset.memoKey), [`${file.path}\n${time}`]);
    assert.ok(list.scrollTop > 0);
  }
});

test("pagination skips calendar gaps, includes empty destinations, and never repeats a note", () => {
  const notes = [note("2026-11-13"), note("2020-01-01"), note("2010-01-01")];
  const window = new ContinuousTimeline([...notes, notes[0]], note("2025-06-01"));
  assert.deepEqual(window.visible.map(n => n.day), ["2026-11-13", "2025-06-01", "2020-01-01", "2010-01-01"]);
  assert.deepEqual(window.page("older"), []);
  assert.deepEqual(window.page("newer"), []);
  const weekly = new ContinuousTimeline([{ path: "2026-W46.md", day: "2026-11-09" }],
    { path: "2026-W46.md", day: "2026-11-13" });
  assert.equal(weekly.notes.length, 1);
});

test("both page boundaries advance without overlap and refresh retains loaded notes", () => {
  const notes = Array.from({ length: 30 }, (_, i) => note(`2026-11-${String(i + 1).padStart(2, "0")}`));
  const window = new ContinuousTimeline(notes, note("2026-11-15"));
  const initial = window.visible.map(n => n.path);
  const newer = window.page("newer");
  window.commit("newer", newer.length);
  const older = window.page("older");
  window.commit("older", older.length);
  assert.equal(new Set(window.visible.map(n => n.path)).size, initial.length + newer.length + older.length);
  const refreshed = new ContinuousTimeline(notes, note("2026-11-13"), window.visible.map(n => n.path));
  for (const path of window.visible.map(n => n.path)) assert.ok(refreshed.visible.some(n => n.path === path));
});

test("posts sort by timestamp even across template headings", () => {
  const content = memo("2026-11-13", "new", "18") + "# heading\n" + memo("2026-11-13", "old", "09");
  assert.deepEqual(timelineMemos(content).map(m => m.content), ["new", "old"]);
});

// Exercise loading and cancellation without rendering cards or simulating layout.
function loadingHarness(selected = "2026-11-15") {
  const files = new Map(Array.from({ length: 30 }, (_, i) => {
    const day = "2026-11-" + String(i + 1).padStart(2, "0");
    return [day + ".md", { file: new TFile(day + ".md"), content: memo(day) }];
  }));
  const rendered = [];
  const view = Object.assign(Object.create(WrotView.prototype), {
    app: { vault: {
      getAbstractFileByPath: path => files.get(path)?.file ?? null,
      read: async file => files.get(file.path).content,
    } },
    timeline: new ContinuousTimeline([...files.keys()].map(path => ({ path, day: path.slice(0, -3) })), note(selected)),
    continuousScroll: true, timelineLoading: false, timelineRevision: 1,
    // Fixed viewport inputs choose an edge; layout and scroll restoration are out of scope.
    listContainer: {
      scrollTop: 0, scrollHeight: 1000, clientHeight: 240,
      createDiv: () => ({ children: [], remove() {} }),
      querySelector: () => null, append() {},
    },
    timelineAnchor: () => null, restoreTimelineAnchor() {}, queueTimelineScroll() {},
    renderTimelineNotes(entries) { rendered.push(...entries); },
  });
  return { view, files, rendered };
}

test("in-flight edge reads are discarded after invalidation or disabling continuous mode", async () => {
  for (const invalidate of [view => { view.timelineRevision++; }, view => { view.continuousScroll = false; }]) {
    const { view, rendered } = loadingHarness();
    const visible = [...view.timeline.visible];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const read = view.app.vault.read;
    view.app.vault.read = async file => { await gate; return read(file); };
    const pending = view.loadTimelineEdge();
    assert.equal(view.timelineLoading, true);
    invalidate(view);
    release();
    await pending;
    assert.deepEqual(view.timeline.visible, visible);
    assert.deepEqual(rendered, []);
    assert.equal(view.timelineLoading, false);
  }
});

test("empty pages advance so distant visible posts can be reached", async () => {
  const { view, files, rendered } = loadingHarness("2026-11-30");
  for (const entry of files.values()) entry.content = "no posts";
  files.get("2026-11-01.md").content = memo("2026-11-01");
  view.listContainer.scrollTop = 1000;
  while (view.timeline.to < view.timeline.notes.length) {
    const previous = view.timeline.to;
    await view.loadTimelineEdge();
    assert.ok(view.timeline.to > previous);
  }
  assert.deepEqual(rendered.filter(entry => entry.memos.length).map(entry => entry.note.path), ["2026-11-01.md"]);
});

test("failed edge reads keep the boundary and can be retried", async (context) => {
  context.mock.method(console, "error", () => {});
  const { view, rendered } = loadingHarness();
  const visible = [...view.timeline.visible];
  const read = view.app.vault.read;
  view.app.vault.read = async () => { throw new Error("disk failure"); };
  const count = notices.length;
  await view.loadTimelineEdge();
  assert.deepEqual(view.timeline.visible, visible);
  assert.deepEqual(rendered, []);
  assert.equal(view.timelineLoading, false);
  assert.equal(notices.length, count + 1);
  view.app.vault.read = read;
  await view.loadTimelineEdge();
  assert.ok(view.timeline.visible.length > visible.length);
  assert.ok(rendered.some(entry => entry.memos.length > 0));
});
