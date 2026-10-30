import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export * from "./src/utils/remainingTaskTime.ts";
      export * from "./src/utils/dailyNoteTasks.ts";
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
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
        let language = "ja";
        export const getLanguage = () => language;
        export const setLanguage = (value) => { language = value; };
      ` }));
    },
  }],
});
const { calendarDateValue, remainingTaskTimeLabel, dailyNoteTaskStartMinutes,
  incompleteDailyNoteTaskEntries, initI18n, setLanguage } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
initI18n();

const date = (hour, minute, second = 0) => new Date(2026, 9, 31, hour, minute, second);
const noteDate = calendarDateValue(date(0, 0));
const label = (text, now, day = noteDate) => remainingTaskTimeLabel(day, dailyNoteTaskStartMinutes(text), now);

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

test("untimed or invalid tasks retain calendar-day labels", () => {
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
    assert.equal(remainingTaskTimeLabel(calendarDateValue(now), 3 * 60 + 30, now), "あと1時間");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
