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
const { incompleteDailyNoteTasks } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const cache = (statuses = [], codeLines = []) => ({
  listItems: statuses.map((task, line) => ({ task, position: { start: { line } } })),
  sections: codeLines.map((line) => ({ type: "code", position: { start: { line } } })),
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
