import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export * from "./src/utils/remainingTaskTime.ts";
      export * from "./src/utils/dailyNoteTasks.ts";
      export { RemainingTasks } from "./src/views/RemainingTasks.ts";
      export { initI18n } from "./src/i18n/index.ts";
      export { setLanguage } from "obsidian";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "obsidian-test-language",
    setup(build) {
      build.onResolve({ filter: /\/utils\/(dailyNote|memoWriter|urlRenderer|quoteCard)$/ }, ({ path }) => ({ path, namespace: "view-test" }));
      build.onLoad({ filter: /.*/, namespace: "view-test" }, ({ path }) => ({ contents:
        path.endsWith("dailyNote") ? "export const dateForDailyNote = () => null;" :
        path.endsWith("memoWriter") ? "export const toggleCheckbox = async () => {};" :
        path.endsWith("quoteCard") ? "export const renderQuoteCard = () => {};" :
        "export const renderTextWithTagsAndUrls = () => []; export const renderUrlPreviews = () => {};"
      }));
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
        let language = "ja";
        export const getLanguage = () => language;
        export const setLanguage = (value) => { language = value; };
        export class Component {} export class Notice {} export class TFile {}
      ` }));
    },
  }],
});
const { calendarDateValue, remainingTaskTimeLabel, taskCreationDate, taskScheduleStatus, dailyNoteTaskStartMinutes,
  incompleteDailyNoteTaskEntries, RemainingTasks, initI18n, setLanguage } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
initI18n();

const date = (hour, minute, second = 0) => new Date(2026, 9, 31, hour, minute, second);
const noteDate = calendarDateValue(date(0, 0));
const schedule = (text, day = noteDate, createdDate = day - 86_400_000) => ({
  noteDate: day, createdDate, startMinutes: dailyNoteTaskStartMinutes(text),
});
const label = (text, now, day = noteDate) => remainingTaskTimeLabel(schedule(text, day), now);

test("same-day untimed tasks never become past or display a date countdown", () => {
  const task = schedule("いつかやる", noteDate, noteDate);
  for (const now of [date(0, 0), date(23, 59), new Date(2026, 10, 1), new Date(2027, 0, 1)]) {
    assert.equal(taskScheduleStatus(task, now), "unscheduled");
    assert.equal(remainingTaskTimeLabel(task, now), null);
  }
});

test("same-day timed tasks become past after their start, including time ranges", () => {
  for (const text of ["09:15 予定", "09:15-10:00 予定"]) {
    const task = schedule(text, noteDate, noteDate);
    assert.equal(taskScheduleStatus(task, date(9, 14, 59)), "scheduled");
    assert.equal(taskScheduleStatus(task, date(9, 15)), "scheduled");
    assert.equal(taskScheduleStatus(task, date(9, 15, 1)), "past");
    assert.equal(taskScheduleStatus(task, date(9, 16)), "past");
    assert.equal(remainingTaskTimeLabel(task, date(9, 14)), "あと1分");
    assert.equal(remainingTaskTimeLabel(task, date(9, 16)), "1分経過");
  }
});

test("advance untimed tasks expire only when their note day has passed", () => {
  const task = schedule("予約した予定");
  for (const now of [new Date(2026, 9, 30, 23, 59), date(0, 0), date(23, 59, 59)]) {
    assert.equal(taskScheduleStatus(task, now), "scheduled");
  }
  assert.equal(remainingTaskTimeLabel(task, new Date(2026, 9, 30)), "あと1日");
  assert.equal(remainingTaskTimeLabel(task, date(12, 0)), "今日");
  assert.equal(taskScheduleStatus(task, new Date(2026, 10, 1)), "past");
  assert.equal(remainingTaskTimeLabel(task, new Date(2026, 10, 1)), "1日経過");
});

test("unknown creation dates and backfilled untimed tasks stay unscheduled", () => {
  for (const created of [null, noteDate + 86_400_000]) {
    for (const text of ["記録なし", "24:00 不正な時刻"]) {
      const task = schedule(text, noteDate, created);
      assert.equal(taskScheduleStatus(task, new Date(2026, 10, 1)), "unscheduled");
      assert.equal(remainingTaskTimeLabel(task, new Date(2026, 10, 1)), null);
    }
    assert.equal(taskScheduleStatus(schedule("00:00 予定", noteDate, created), date(0, 1)), "past");
  }
});

test("creation dates use the recorded calendar day and reject missing or invalid dates", () => {
  for (const time of ["2026-10-31T00:01:00+14:00", "2026-10-31T23:59:00-12:00"]) {
    assert.equal(taskCreationDate(time), noteDate);
  }
  for (const time of [undefined, "10:00", "invalid", "2026-02-30T10:00:00Z", "2026-13-01T10:00:00Z"]) {
    assert.equal(taskCreationDate(time), null);
  }
  assert.equal(taskCreationDate("2028-02-29T10:00:00Z"), Date.UTC(2028, 1, 29));
});

test("extracted post creation dates distinguish same-day and advance tasks", () => {
  const content = [
    "- [ ] native", "```wr 2026-10-31T08:00:00+09:00", "- [ ] same day", "```",
    "```wr 2026-10-30T23:59:00+09:00", "- [ ] advance", "```",
  ].join("\n");
  const tasks = incompleteDailyNoteTaskEntries(content, {
    listItems: [{ task: " ", position: { start: { line: 0 } } }],
    sections: [1, 4].map((line) => ({ type: "code", position: { start: { line } } })),
  }).map((task) => schedule(task.text, noteDate, taskCreationDate(task.time)));
  const now = new Date(2026, 10, 1);
  assert.deepEqual(tasks.map((task) => taskScheduleStatus(task, now)), ["unscheduled", "unscheduled", "past"]);
  assert.deepEqual(tasks.map((task) => remainingTaskTimeLabel(task, now)), [null, null, "1日経過"]);
});

class Element {
  constructor(options = {}, parent = null) {
    this.cls = options.cls;
    this.text = options.text ?? "";
    this.attributes = options.attr ?? {};
    this.children = [];
    this.listeners = {};
    this.parent = parent;
    this.scrollTop = 0;
  }
  createEl(tag, options) {
    const child = new Element(options, this);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  empty() { this.children = []; }
  setText(text) { this.text = text; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.cls === selector.slice(1) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) {
    const matches = selector.split(",").some((part) => {
      const query = part.trim();
      const attribute = /^\[([^=]+)="([^"]+)"\]$/.exec(query);
      if (attribute) return this.attributes[attribute[1]] === attribute[2];
      return query.startsWith(".") ? this.cls === query.slice(1) : this.tag === query;
    });
    return matches ? this : this.parent?.closest(selector);
  }
  find(cls) { return this.cls === cls ? this : this.children.map(child => child.find(cls)).find(Boolean); }
}

function taskView(entries) {
  return Object.assign(Object.create(RemainingTasks.prototype), {
    app: { vault: { getName: () => "test" } }, plugin: { settings: {} },
    list: new Element(), count: new Element(), loading: false, closed: false,
    tasks: new Map([["daily.md", entries]]), failed: new Set(), completingRows: new Map(), timeLabels: new Map(),
  });
}

function entry(text, line, day = noteDate, createdDate = day) {
  return { ...schedule(text, day, createdDate), text, line, filePath: "daily.md", noteDateLabel: "note date" };
}

test("the task list hides unscheduled metadata, opens rows and refreshes past status", () => {
  const today = calendarDateValue(new Date());
  const day = 86_400_000;
  const entries = [
    { ...schedule("いつかやる", today - day, today - day), line: 0 },
    { ...schedule("09:15 予定", today + day, today + day), line: 1 },
    { ...schedule("事前の予定", today + day, today), line: 2 },
    { ...schedule("過去の予定", today - day, today - 2 * day), line: 3 },
  ].map((task) => ({ ...task, text: `task ${task.line}`, filePath: "daily.md", noteDateLabel: "note date" }));
  const opened = [];
  const view = taskView(entries);
  view.openTask = async (task, newTab) => { opened.push({ line: task.line, newTab }); };
  view.render();
  assert.equal(view.count.text, "4");
  const unscheduled = view.list.querySelectorAll(".wr-remaining-task").find(row => row.attributes["data-task-status"] === "unscheduled");
  assert.ok(unscheduled);
  assert.equal(unscheduled.find("wr-remaining-task-days"), undefined);
  assert.equal(unscheduled.find("wr-remaining-task-source"), undefined);
  assert.equal(unscheduled.find("wr-remaining-task-meta"), undefined);
  assert.equal(unscheduled.attributes.tabindex, "0");
  unscheduled.listeners.click({ target: unscheduled, ctrlKey: true });
  assert.deepEqual(opened, [{ line: 0, newTab: true }]);
  const content = unscheduled.find("wr-content");
  unscheduled.listeners.click({ target: content, ctrlKey: false, metaKey: false });
  assert.deepEqual(opened.at(-1), { line: 0, newTab: false });

  // Nested controls and links retain their own action instead of also opening the task.
  const beforeControls = opened.length;
  for (const [tag, attr] of [
    ["input", { type: "checkbox" }], ["a", { href: "target.md" }], ["button", {}],
    ["label", {}], ["select", {}], ["textarea", {}], ["div", { role: "button" }],
    ["div", { role: "link" }], ["div", { contenteditable: "true" }],
  ]) {
    const control = content.createEl(tag, { attr });
    const target = control.createSpan({});
    unscheduled.listeners.click({ target, ctrlKey: false, metaKey: false });
    unscheduled.listeners.keydown({ target, key: "Enter" });
  }
  unscheduled.listeners.click({ target: content, defaultPrevented: true });
  assert.equal(opened.length, beforeControls);
  for (const key of ["Enter", " "]) {
    let prevented = false;
    unscheduled.listeners.keydown({
      target: unscheduled, key, ctrlKey: false, metaKey: true,
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true);
    assert.deepEqual(opened.at(-1), { line: 0, newTab: true });
  }
  for (const row of view.list.querySelectorAll(".wr-remaining-task").filter(row => row !== unscheduled)) {
    const source = row.find("wr-remaining-task-source");
    assert.equal(source.text, "note date");
    assert.equal(source.tag, "span");
    assert.equal(source.attributes.href, undefined);
    assert.equal(source.listeners.click, undefined);
    assert.ok(row.find("wr-remaining-task-days").text);
    row.listeners.click({ target: source, ctrlKey: false, metaKey: false });
    assert.equal(opened.at(-1).line, [...view.timeLabels].find(([label]) => label.parent === source.parent)[1].line);
  }
  assert.equal(view.timeLabels.size, 3);
  const tomorrow = new Date(today + day);
  const afterStart = new Date(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 9, 16);
  view.updateTimeLabels(afterStart);
  const [timedLabel] = [...view.timeLabels].find(([, task]) => task.line === 1);
  assert.equal(timedLabel.text, "1分経過");
  assert.equal(timedLabel.closest(".wr-remaining-task").attributes["data-task-status"], "past");
  assert.equal(unscheduled.attributes["data-task-status"], "unscheduled");
  view.updateTimeLabels(new Date(afterStart.getTime() + day));
  assert.equal(unscheduled.find("wr-remaining-task-days"), undefined);
  const advanceLabel = [...view.timeLabels].find(([, task]) => task.line === 2)[0];
  assert.equal(advanceLabel.closest(".wr-remaining-task").attributes["data-task-status"], "past");
});

test("past tasks are isolated below current tasks, retaining ordering and row actions", () => {
  const view = taskView([
    entry("08:00 past", 0), entry("10:00 future", 1), entry("unscheduled", 2),
    entry("09:00 past", 3), entry("advance untimed", 4, noteDate - 86_400_000, noteDate - 2 * 86_400_000),
  ]);
  view.list.scrollTop = 120;
  view.render(date(9, 30));
  assert.equal(view.count.text, "5");
  assert.equal(view.list.scrollTop, 120);
  assert.deepEqual(view.list.children.map(child => child.cls), ["wr-remaining-tasks-current", "wr-remaining-tasks-past"]);
  const current = view.list.find("wr-remaining-tasks-current");
  const past = view.list.find("wr-remaining-tasks-past");
  assert.equal(current.attributes.role, "list");
  assert.equal(past.find("wr-remaining-tasks-past-title"), undefined);
  assert.deepEqual(current.querySelectorAll(".wr-remaining-task").map(row => row.attributes["data-task-status"]), ["scheduled", "unscheduled"]);
  assert.equal(past.querySelectorAll(".wr-remaining-task").length, 3);
  assert.ok(past.querySelectorAll(".wr-remaining-task").every(row => row.attributes["data-task-status"] === "past"));
  assert.deepEqual(past.querySelectorAll(".wr-remaining-task").map(row => row.find("wr-remaining-task-days").text), ["1時間30分経過", "30分経過", "1日経過"]);
  const opened = [];
  view.openTask = async (task) => { opened.push(task.line); };
  const row = past.querySelector(".wr-remaining-task");
  row.listeners.click({ target: row });
  assert.deepEqual(opened, [0]);
});

test("time ticks move expired tasks and remove the group if the clock moves back", () => {
  const view = taskView([entry("09:15 task", 0), entry("unscheduled", 1)]);
  view.render(date(9, 14));
  const beforeTick = view.list.find("wr-remaining-tasks-current");
  assert.equal(view.list.find("wr-remaining-tasks-past"), undefined);
  view.updateTimeLabels(date(9, 15));
  assert.equal(view.list.find("wr-remaining-tasks-current"), beforeTick);
  assert.equal(view.list.find("wr-remaining-task-days").text, "ちょうど今");
  view.updateTimeLabels(date(9, 15, 1));
  assert.equal(view.list.find("wr-remaining-tasks-past").querySelectorAll(".wr-remaining-task").length, 1);
  view.updateTimeLabels(date(9, 16));
  assert.equal(view.list.find("wr-remaining-task-days").text, "1分経過");
  assert.equal(view.count.text, "2");
  view.updateTimeLabels(date(9, 14));
  assert.equal(view.list.find("wr-remaining-tasks-past"), undefined);
  assert.equal(view.list.find("wr-remaining-tasks-current").querySelectorAll(".wr-remaining-task").length, 2);
});

test("date-only reservations move after midnight; unscheduled tasks remain current", () => {
  const view = taskView([entry("reservation", 0, noteDate, noteDate - 86_400_000), entry("unscheduled", 1)]);
  view.render(date(23, 59, 59));
  assert.equal(view.list.find("wr-remaining-tasks-past"), undefined);
  view.updateTimeLabels(new Date(2026, 10, 1));
  assert.equal(view.list.find("wr-remaining-tasks-past").querySelectorAll(".wr-remaining-task").length, 1);
  assert.equal(view.list.find("wr-remaining-tasks-current").querySelectorAll(".wr-remaining-task").length, 1);
});

test("all-past and empty task lists only show the past section when needed", () => {
  const view = taskView([entry("09:00 task", 0)]);
  view.render(date(10, 0));
  assert.equal(view.list.find("wr-remaining-tasks-current").querySelectorAll(".wr-remaining-task").length, 0);
  assert.equal(view.list.find("wr-remaining-tasks-status"), undefined);
  assert.equal(view.list.find("wr-remaining-tasks-past").querySelectorAll(".wr-remaining-task").length, 1);
  view.tasks.clear();
  view.render(date(10, 0));
  assert.equal(view.count.text, "0");
  assert.equal(view.list.find("wr-remaining-tasks-past"), undefined);
  assert.equal(view.list.find("wr-remaining-tasks-status").text, "未完了のタスクはありません");
});

test("completion defers regrouping and keeps counts and empty sections correct across both lists", () => {
  const currentTask = entry("unscheduled", 0);
  const view = taskView([currentTask, entry("00:00 past", 1, noteDate - 86_400_000)]);
  view.render(date(9, 0));
  const current = view.list.find("wr-remaining-tasks-current").querySelector(".wr-remaining-task");
  const past = view.list.find("wr-remaining-tasks-past").querySelector(".wr-remaining-task");
  view.completingRows.set(current, null);
  view.completingRows.set(past, null);
  view.updateTimeLabels(date(23, 59));
  assert.equal(view.list.find("wr-remaining-tasks-current").querySelector(".wr-remaining-task"), current);
  view.section = { win: {
    getComputedStyle: () => ({ height: "100px" }), matchMedia: () => ({ matches: true }),
  } };
  view.tasks.set("daily.md", [currentTask]);
  view.finishCompletion(past, true);
  assert.equal(view.count.text, "1");
  assert.equal(view.list.find("wr-remaining-tasks-past"), undefined);
  view.tasks.clear();
  view.finishCompletion(current, true);
  assert.equal(view.count.text, "0");
  assert.equal(view.list.find("wr-remaining-tasks-status").text, "未完了のタスクはありません");
});

test("single times and ranges show time until or since their start", () => {
  for (const text of ["09:15 test", "09:15-09:30 test"]) {
    for (const [now, expected] of [
      [date(8, 0), "あと1時間15分"],
      [date(8, 15), "あと1時間"],
      [date(8, 45), "あと30分"],
      [date(9, 14, 59), "あと1分"],
      [date(9, 15), "ちょうど今"],
      [date(9, 15, 59), "ちょうど今"],
      [date(9, 16), "1分経過"],
      [date(9, 30), "15分経過"],
      [date(10, 15), "1時間経過"],
      [date(10, 30), "1時間15分経過"],
    ]) assert.equal(label(text, now), expected, `${text} at ${now}`);
  }
});

test("native tasks and Wrot tasks use the daily note date and ignore the posting time", () => {
  const content = ["- [ ] 09:15 test", "```wr 2026-10-30T23:00:00+09:00", "- [ ] 09:15-09:30 test", "```"].join("\n");
  const tasks = incompleteDailyNoteTaskEntries(content, {
    listItems: [{ task: " ", position: { start: { line: 0 } } }],
    sections: [{ type: "code", position: { start: { line: 1 } } }],
  });
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((task) => label(task.text, date(8, 45))), ["あと30分", "あと30分"]);
});

test("advance untimed or invalid-time tasks retain calendar-day labels", () => {
  for (const text of ["test", "24:00 test", "09:60 test", "09:15-25:00 test", "test 09:15"]) {
    assert.equal(label(text, date(12, 0)), "今日", text);
    assert.equal(label(text, date(12, 0), noteDate + 86_400_000), "あと1日", text);
    assert.equal(label(text, date(12, 0), noteDate - 86_400_000), "1日経過", text);
  }
});

test("nearby timed tasks count across midnight using their own note date", () => {
  assert.equal(label("00:00 test", date(23, 45), noteDate + 86_400_000), "あと15分");
  assert.equal(label("23:45 test", date(0, 15), noteDate - 86_400_000), "30分経過");
  assert.equal(label("23:45-00:15 test", date(0, 15), noteDate - 86_400_000), "30分経過");
  assert.equal(label("00:00 test", date(0, 0)), "ちょうど今");
});

test("timed tasks at least 24 hours away retain calendar-day labels", () => {
  assert.equal(label("09:15 test", date(9, 15), noteDate + 86_400_000), "あと1日");
  assert.equal(label("09:15 test", date(9, 15), noteDate - 86_400_000), "1日経過");
  assert.equal(label("09:15 test", date(9, 16), noteDate + 86_400_000), "あと23時間59分");
  assert.equal(label("09:15 test", date(9, 14), noteDate - 86_400_000), "23時間59分経過");
});

test("English labels follow the active app language", () => {
  setLanguage("en");
  initI18n();
  try {
    assert.equal(label("09:15 test", date(8, 0)), "1h 15m left");
    assert.equal(label("09:15 test", date(9, 0)), "15m left");
    assert.equal(label("09:15 test", date(9, 15)), "Now");
    assert.equal(label("09:15 test", date(9, 30)), "15m ago");
    assert.equal(label("09:15 test", date(10, 15)), "1h ago");
  } finally {
    setLanguage("ja");
    initI18n();
  }
});

test("local scheduled times account for daylight-saving changes", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // Local 01:30 to 03:30 spans one real hour when clocks spring forward.
    const now = new Date(2026, 2, 8, 1, 30);
    assert.equal(remainingTaskTimeLabel({
      noteDate: calendarDateValue(now), createdDate: calendarDateValue(now), startMinutes: 3 * 60 + 30,
    }, now), "あと1時間");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
