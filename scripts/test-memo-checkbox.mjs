import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/utils/memoWriter.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "obsidian-memo-test",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: "export class App {} export class TFile {}",
      }));
    },
  }],
});
const { setMemoCheckbox, toggleCheckbox } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const timestamp = "2026-11-01T09:00:00.000Z";
const memo = (body) => ["```wr " + timestamp + " ^wr-20261101090000000", body, "```"].join("\n");

function vaultWith(files) {
  const contents = new Map(Object.entries(files));
  return {
    contents,
    app: { vault: { process: async (file, update) => {
      assert.ok(contents.has(file.path));
      contents.set(file.path, update(contents.get(file.path)));
    } } },
  };
}

test("memo checkbox writes follow the source note, shifted memo and leading blank lines", async () => {
  const source = "archive.md";
  const original = "# Inserted heading\n\n" + memo("\n\nintro\n>   - [ ] pinned task\n- [ ] keep");
  const current = memo("- [ ] another day");
  const { app, contents } = vaultWith({ [source]: original, "today.md": current });
  assert.equal(await setMemoCheckbox(app, { path: source }, timestamp, 1, true), true);
  assert.equal(contents.get(source), original.replace(">   - [ ] pinned task", ">   - [x] pinned task"));
  assert.equal(contents.get("today.md"), current);
});

test("repeated memo checkbox events preserve the requested state", async () => {
  const file = { path: "daily.md" };
  const original = memo("- [ ] task");
  const { app, contents } = vaultWith({ [file.path]: original });
  for (const checked of [true, true, false, false]) {
    assert.equal(await setMemoCheckbox(app, file, timestamp, 0, checked), true);
    assert.equal(contents.get(file.path), checked ? original.replace("[ ]", "[x]") : original);
  }
});

test("missing memos and non-checkbox lines leave the note unchanged", async () => {
  const file = { path: "daily.md" };
  const original = memo("intro\n- [ ] task");
  const { app, contents } = vaultWith({ [file.path]: original });
  assert.equal(await setMemoCheckbox(app, file, "missing", 1, true), false);
  assert.equal(await setMemoCheckbox(app, file, timestamp, 0, true), false);
  assert.equal(contents.get(file.path), original);
});

test("native task writes retain the fork's marker support and text guard", async () => {
  const file = { path: "daily.md" };
  for (const line of ["+ [ ] task", "* [ ] task", "1. [ ] task", "> 2) [ ] task"]) {
    const { app, contents } = vaultWith({ [file.path]: line });
    await toggleCheckbox(app, file, 0, { checked: true, expectedText: "different task" });
    assert.equal(contents.get(file.path), line);
    await toggleCheckbox(app, file, 0, { checked: true, expectedText: "task" });
    await toggleCheckbox(app, file, 0, { checked: true, expectedText: "task" });
    assert.equal(contents.get(file.path), line.replace("[ ]", "[x]"));
  }
});
