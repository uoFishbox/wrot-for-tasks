import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/utils/dailyNoteTasks.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { incompleteDailyNoteTasks, incompleteDailyNoteTaskEntries, dailyNoteTaskStartMinutes } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const cache = (statuses = [], codeLines = []) => ({
  listItems: statuses.map((task, line) => ({ task, position: { start: { line } } })),
  sections: codeLines.map((line) => ({ type: "code", position: { start: { line } } })),
});

test("task start times accept single times and ranges, including midnight", () => {
  for (const [text, expected] of [
    ["18:45-23:00 勉強", 1125],
    ["18:45 勉強", 1125],
    ["9:05 朝の勉強", 545],
    ["00:00 深夜", 0],
    ["23:59 最終", 1439],
    ["18:45 - 23:00 勉強", 1125],
    ["18:45　勉強", 1125],
    ["18:45", 1125],
    ["18:45-23:00", 1125],
    ["23:00-01:00 日をまたぐ予定", 1380],
  ]) assert.equal(dailyNoteTaskStartMinutes(text), expected, text);
});

test("invalid times and times inside task prose do not become start times", () => {
  for (const text of [
    "", "勉強", "勉強 18:45", "24:00 勉強", "18:60 勉強", "118:45 勉強",
    "18:4 勉強", "18:450 勉強", "18:45-25:00 勉強", "18:45-23:60 勉強",
    "18:45- 勉強", "18:45:00 勉強", "`18:45` コード",
  ]) assert.equal(dailyNoteTaskStartMinutes(text), null, text);
});

test("native and Wrot tasks use their own start times rather than the post timestamp", () => {
  const content = [
    "- [ ] 18:45-23:00 勉強", "```wr 2026-10-30T08:00:00+09:00",
    "- [ ] 09:30 朝の予定", "- [ ] 時刻なし", "```",
  ].join("\n");
  const tasks = incompleteDailyNoteTaskEntries(content, cache([" "], [1]));
  assert.deepEqual(tasks.map((task) => dailyNoteTaskStartMinutes(task.text)), [1125, 570, null]);
});
test("notes without tasks do not get dots", () => {
  assert.deepEqual(incompleteDailyNoteTasks("ordinary text", cache([undefined])), []);
  assert.deepEqual(incompleteDailyNoteTasks("", null), []);
});

test("only native incomplete and mixed days get a dot", () => {
  assert.deepEqual(incompleteDailyNoteTasks("- [ ] pending", cache([" "])), ["pending"]);
  assert.deepEqual(incompleteDailyNoteTasks("- [x] done\n- [X] done", cache(["x", "X"])), []);
  assert.deepEqual(incompleteDailyNoteTasks("- [ ] pending\n- [x] done", cache([" ", "x"])), ["pending"]);
});

test("native custom statuses follow Obsidian's completion semantics", () => {
  assert.deepEqual(incompleteDailyNoteTasks("", cache(["/", "-"])), []);
});

test("a completed native checkbox is excluded even before metadata catches up", () => {
  assert.deepEqual(incompleteDailyNoteTasks("- [x] done", cache([" "])), []);
});

test("Wrot tasks include nested and quoted checkboxes", () => {
  const content = ["```wr 10:00", "  - [ ] nested", "> - [x] quoted", "```"].join("\n");
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([], [0])), ["nested"]);
});

test("completed Wrot tasks do not get a dot", () => {
  const content = ["```wr 10:00", "- [x] done", "```"].join("\n");
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([], [0])), []);
});

test("Wrot code samples and math do not count as tasks", () => {
  const content = [
    "```wr 10:00", "~~~md", "- [ ] code example", "~~~", "$$", "- [x] math", "$$", "```",
  ].join("\n");
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([], [0])), []);
});

test("wr-looking fences inside ordinary code samples do not count", () => {
  const content = ["````md", "```wr 10:00", "- [ ] example", "```", "````"].join("\n");
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([], [0])), []);
});

test("tasks combine across native Markdown and multiple Wrot posts", () => {
  const content = ["- [ ] native", "```wr 10:00", "no tasks", "```", "```wr 11:00", "- [x] done", "```"].join("\n");
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([" "], [1, 4])), ["native"]);
});

test("native task text supports quotes, nesting, bullets and numbered lists", () => {
  const content = ["  * [ ] nested", "> + [ ] quoted", "1. [ ] numbered", "2) [ ] another", "- [ ]"].join("\n");
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([" ", " ", " ", " ", " "])), [
    "nested", "quoted", "numbered", "another", "",
  ]);
});

test("tooltip tasks follow document order across native tasks and Wrot posts", () => {
  const content = [
    "- [ ] first", "```wr 10:00", "- [ ] second", "> - [ ] third", "```",
    "- [x] omit", "```wr 11:00", "- [ ] fourth", "```", "- [ ] fifth",
  ].join("\n");
  const metadata = cache([], [1, 6]);
  metadata.listItems = [
    { task: " ", position: { start: { line: 0 } } },
    { task: "x", position: { start: { line: 5 } } },
    { task: " ", position: { start: { line: 9 } } },
  ];
  assert.deepEqual(incompleteDailyNoteTasks(content, metadata), ["first", "second", "third", "fourth", "fifth"]);
});

test("task labels preserve literal markup and Japanese text", () => {
  const content = "- [ ] [[資料]] を読む <b>メモ</b>";
  assert.deepEqual(incompleteDailyNoteTasks(content, cache([" "])), ["[[資料]] を読む <b>メモ</b>"]);
});

test("task source lines survive blank lines, quoted tasks and embedded code/math", () => {
  const time = "2026-10-30T10:00:00+09:00";
  const content = [
    "# Daily", `\`\`\`wr ${time}`, "", "- [ ] first", "~~~md", "- [ ] code", "~~~",
    "$$", "- [ ] math", "$$", "", "> - [ ] second", "```", "- [ ] native",
  ].join("\n");
  const metadata = cache([], [1]);
  metadata.listItems = [{ task: " ", position: { start: { line: 13 } } }];
  assert.deepEqual(incompleteDailyNoteTaskEntries(content, metadata), [
    { text: "first", line: 3, time },
    { text: "second", line: 11, time },
    { text: "native", line: 13 },
  ]);
});

test("unterminated Wrot posts keep their final task and exact source line", () => {
  const content = "```wr 10:00\n\n- [ ] last";
  assert.deepEqual(incompleteDailyNoteTaskEntries(content, cache([], [0])), [
    { text: "last", line: 2, time: "10:00" },
  ]);
});
