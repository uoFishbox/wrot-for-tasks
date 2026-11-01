import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { setTimeout, clearTimeout } from "node:timers";
import esbuild from "esbuild";
import { i18nPackPlugin } from "./i18n-pack.mjs";

test("watch builds refresh translations, inherited locales, and the Japanese key order", async () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, "wrot-i18n-watch-"));
  const locales = path.join(directory, "src/i18n");
  fs.mkdirSync(locales, { recursive: true });
  const write = (name, source) => fs.writeFileSync(path.join(locales, name), source);
  write("ja.ts", 'export default { elapsed: "経過" };');
  write("en.ts", 'export default { elapsed: "ago" };');
  write("en-GB.ts", 'import en from "./en"; export default { ...en };');
  fs.writeFileSync(path.join(directory, "src/main.ts"), 'import en from "./i18n/en-GB"; export const read = () => [en.elapsed, en.remaining];');
  let onBuild;
  const completed = [];
  const nextBuild = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Translation edit did not trigger a watch rebuild")), 5000);
    onBuild = (result) => { clearTimeout(timer); resolve(result); };
    if (completed.length) onBuild(completed.shift());
  });
  const context = await esbuild.context({
    absWorkingDir: directory,
    entryPoints: ["src/main.ts"],
    bundle: true, write: false, format: "cjs", logLevel: "silent",
    plugins: [i18nPackPlugin(), {
      name: "observe-builds",
      setup(build) {
        build.onEnd(result => {
          const callback = onBuild;
          onBuild = undefined;
          if (callback) callback(result);
          else completed.push(result);
        });
      },
    }],
  });
  const read = (result) => {
    assert.equal(result.errors.length, 0);
    const scope = { module: { exports: {} } };
    vm.runInNewContext(result.outputFiles[0].text, scope);
    return [...scope.module.exports.read()];
  };
  try {
    await context.watch();
    assert.deepEqual(read(await nextBuild()), ["ago", undefined]);
    const updated = nextBuild();
    write("en.ts", 'export default { elapsed: "elapsed" };');
    assert.deepEqual(read(await updated), ["elapsed", undefined]);

    const newKeys = nextBuild();
    write("ja.ts", 'export default { remaining: "残り", elapsed: "経過" };');
    write("en.ts", 'export default { elapsed: "elapsed", remaining: "remaining" };');
    assert.deepEqual(read(await newKeys), ["elapsed", "remaining"]);
  } finally {
    await context.dispose();
    // Remove only the temporary fixture directory created by this test.
    assert.equal(path.dirname(fs.realpathSync(directory)), tempRoot);
    assert.match(path.basename(directory), /^wrot-i18n-watch-/);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
