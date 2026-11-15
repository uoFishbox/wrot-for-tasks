import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";
import moment from "moment";

const bundle = await build({
  stdin: {
    contents: `export * from "./src/utils/memoTimestamp.ts";
      export { settings } from "obsidian-daily-notes-interface";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "daily-note-timestamp-runtime",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|obsidian-daily-notes-interface)$/ }, args => ({ path: args.path, namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
        contents: path === "obsidian"
          ? `export class TFile {} export const normalizePath = path => path.replace(/\\/+/g, "/");`
          : `export const settings = {}; export const getDailyNoteSettings = () => settings;
             export const getTemplateInfo = async () => [""];`,
      }));
    },
  }],
});
const { formatMemoTimestamp, settings } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
globalThis.moment = moment;

const display = {
  timestampFormat: "YYYY-MM-DD HH:mm",
  dateAwareTimestamp: true,
  timestampTimeFormat: "HH:mm:ss",
  timestampDateFormat: "YYYY/MM/DD",
};
const file = path => ({ path, extension: "md" });
const time = moment([2026, 10, 14, 9, 12, 34]).toISOString();

beforeEach(() => {
  for (const key of Object.keys(settings)) delete settings[key];
  settings.format = "YYYY-MM-DD";
});

test("same source day shows only local time, including UTC timestamps", () => {
  assert.deepEqual(formatMemoTimestamp(time, file("2026-11-14.md"), display), { time: "09:12:34" });
  const nearMidnight = moment([2026, 10, 14, 0, 5]).toISOString();
  assert.deepEqual(formatMemoTimestamp(nearMidnight, file("2026-11-14.md"), display), { time: "00:05:00" });
});

test("backfilled and future notes show the actual posting date", () => {
  for (const path of [
    "2026-11-13.md",
    "2026-11-15.md",
    "2025-11-14.md",
  ]) {
    assert.deepEqual(formatMemoTimestamp(time, file(path), display), { time: "09:12:34", date: "2026/11/14" });
  }
});

test("uses configured folders and date tokens in the full path", () => {
  settings.folder = "Journal";
  settings.format = "YYYY/MM/DD[ daily]";
  assert.equal(formatMemoTimestamp(time, file("Journal/2026/11/14 daily.md"), display).date, undefined);
  assert.equal(formatMemoTimestamp(time, file("Other/2026/11/14 daily.md"), display).date, "2026/11/14");
});

test("weekly and monthly notes use the date parsed from their configured format", () => {
  for (const format of ["GGGG-[W]WW", "YYYY-MM"]) {
    settings.format = format;
    const name = moment(time).format(format);
    const path = name.endsWith(".md") ? name : `${name}.md`;
    const noteDate = moment(name, format, true);
    const firstDay = noteDate.clone().hour(9).toISOString();
    assert.equal(formatMemoTimestamp(firstDay, file(path), display).date, undefined);
    assert.equal(formatMemoTimestamp(noteDate.clone().add(1, "day").toISOString(), file(path), display).date,
      noteDate.clone().add(1, "day").format("YYYY/MM/DD"));
  }
});

test("unknown, missing, or invalid daily notes retain the posting date", () => {
  for (const source of [null, file("archive.md"), file("2026-02-30.md")]) {
    assert.equal(formatMemoTimestamp(time, source, display).date, "2026/11/14");
  }
});

test("disabled mode uses the original timestamp format and custom formats work", () => {
  assert.deepEqual(formatMemoTimestamp(time, file("2026-11-14.md"), { ...display, dateAwareTimestamp: false }), { time: "2026-11-14 09:12" });
  assert.deepEqual(formatMemoTimestamp(time, file("2026-11-15.md"), {
    ...display, timestampTimeFormat: "h:mm A", timestampDateFormat: "DD.MM.YYYY",
  }), { time: "9:12 AM", date: "14.11.2026" });
  assert.deepEqual(formatMemoTimestamp(time, null, {
    ...display, timestampTimeFormat: "", timestampDateFormat: "",
  }), { time: "09:12:34", date: "2026/11/14" });
});


