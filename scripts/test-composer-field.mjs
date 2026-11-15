/* global Event, EventTarget */
import assert from "node:assert/strict";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const viewModule = require.resolve("@codemirror/view").replace(/index\.cjs$/, "index.js");
const bundle = await build({
  stdin: {
    contents: `export { ComposerField } from "./src/editor/composerField.ts";
      export { NativeComposer } from "./src/editor/nativeComposer.ts";
      export { nativeInstances } from "@mnaoumov/obsidian-lib/components/embeddable-markdown-editor-component";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{
    name: "editor-runtime",
    setup(build) {
      // Real CodeMirror state, transactions, facets and Wrot extensions; only the
      // DOM/layout view and Obsidian's unavailable embed constructor are mocked.
      build.onResolve({ filter: /^@codemirror\/view$/ }, () => ({ path: "view", namespace: "test" }));
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      build.onResolve({ filter: /^@codemirror\/commands$/ }, () => ({ path: "commands", namespace: "test" }));
      build.onResolve({ filter: /^@mnaoumov\/obsidian-lib\// }, () => ({ path: "native", namespace: "test" }));
      build.onLoad({ filter: /^obsidian$/, namespace: "test" }, () => ({ contents: `
        export const renderMath = () => {};
        export const finishRenderMath = () => {};
        export const loadMathJax = async () => {};
      ` }));
      build.onLoad({ filter: /^commands$/, namespace: "test" }, () => ({ contents: `
        export const history = () => [];
        export const historyKeymap = [];
        export const standardKeymap = [];
        export const insertNewline = () => false;
      ` }));
      build.onLoad({ filter: /^native$/, namespace: "test" }, () => ({
        resolveDir: process.cwd(),
        contents: `
          import { EditorState } from "@codemirror/state";
          import { EditorView } from "@codemirror/view";
          export const nativeInstances = [];
          export class EmbeddableMarkdownEditorComponent {
            constructor(params) { this.params = params; nativeInstances.push(this); }
            load() {
              this.editorView = new EditorView({ parent: this.params.containerEl,
                state: EditorState.create({ extensions: this.buildExtensions() }) });
              if (this.params.app.fail) throw new Error("Unsupported Obsidian internals");
            }
            buildExtensions() { return []; }
            unload() { this.unloaded = true; this.editorView?.destroy(); }
            get hasFocus() { return this.editorView.hasFocus; }
          }
        `,
      }));
      build.onLoad({ filter: /^view$/, namespace: "test" }, () => ({
        resolveDir: process.cwd(),
        contents: `
          export * from ${JSON.stringify(viewModule)};
          import { EditorView as RealView } from ${JSON.stringify(viewModule)};
          export class EditorView extends RealView {
            constructor(options) { return new HeadlessView(options); }
          }
          class HeadlessView {
            constructor({ state, parent }) {
              this.state = state;
              this.dom = parent.createDiv();
              this.contentDOM = this.dom.createDiv();
              this.contentDOM.blur = () => { this.hasFocus = false; this.contentDOM.dispatchEvent(new Event("blur")); };
              this.hasFocus = false;
              this.composing = false;
              this.compositionStarted = false;
            }
            dispatch(spec) {
              const startState = this.state;
              const tr = this.state.update(spec);
              this.state = tr.state;
              const update = { view: this, startState, state: this.state, transactions: [tr],
                changes: tr.changes, docChanged: tr.docChanged, selectionSet: !!spec.selection };
              for (const listener of this.state.facet(RealView.updateListener)) listener(update);
            }
            focus() { this.hasFocus = true; this.contentDOM.dispatchEvent(new Event("focus")); }
            destroy() { this.destroyed = true; this.dom.remove(); }
          }
        `,
      }));
    },
  }],
});
const directory = await mkdtemp(join(tmpdir(), "wrot-editor-test-"));
const filename = join(directory, "editor.mjs");
let api;
try {
  await writeFile(filename, bundle.outputFiles[0].text);
  api = await import(pathToFileURL(filename).href);
} finally {
  await rm(filename, { force: true });
  await rmdir(directory);
}
const { ComposerField, NativeComposer, nativeInstances } = api;

globalThis.InputEvent = class extends Event {
  constructor(type, options) { super(type); Object.assign(this, options); }
};

class Element extends EventTarget {
  children = [];
  classes = new Set();
  // Node's EventTarget does not normalize a boolean capture argument on removal.
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, typeof options === "boolean" ? { capture: options } : options);
  }
  createDiv() { const child = new Element(); this.children.push(child); return child; }
  addClass(cls) { this.classes.add(cls); }
  removeClass(cls) { this.classes.delete(cls); }
  empty() { this.children = []; }
  remove() { this.removed = true; }
  getAttribute() { return null; }
}

function field(enabled = false, app = {}) {
  const failures = [];
  const field = new ComposerField(new Element(), "Write…", true, () => true, [], {
    app, enabled, onSubmit: () => {}, onFailure: (error) => failures.push(error),
  });
  return { field, failures };
}

test("switches both directions without losing text, selection, read-only or pending formatting", async () => {
  const { field: editor } = field();
  editor.value = "日本語 **draft";
  editor.setSelectionRange(6, 9);
  editor.setArmedFormat(4, "**");
  editor.readOnly = true;
  const original = editor.view;
  editor.setNative(true);
  assert.equal(original.destroyed, true);
  assert.equal(editor.isNative, true);
  assert.equal(editor.value, "日本語 **draft");
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [6, 9]);
  assert.deepEqual(editor.armedOpener(), { pos: 4, marker: "**" });
  assert.equal(editor.view.state.readOnly, true);
  assert.equal(editor.commitTypedLine(), false);
  assert.equal(editor.listMarkerAtCaret(), null);
  const native = nativeInstances.at(-1);
  editor.setNative(false);
  assert.equal(native.unloaded, true);
  assert.equal(editor.isNative, false);
  assert.equal(editor.value, "日本語 **draft");
  assert.deepEqual(editor.armedOpener(), { pos: 4, marker: "**" });
  assert.equal(editor.view.state.readOnly, true);
  editor.destroy();
  await Promise.resolve();
});

test("keeps event wiring, silences programmatic replacement and ignores queued events from old views", async () => {
  const { field: editor } = field(true);
  let inputs = 0;
  let keydowns = 0;
  editor.addEventListener("input", () => inputs++);
  const onKey = () => keydowns++;
  editor.addEventListener("keydown", onKey);
  editor.value = "draft";
  await Promise.resolve();
  assert.equal(inputs, 0);
  // Native commands do not always annotate transactions with userEvent.
  editor.view.dispatch({ changes: { from: 5, insert: "!" } });
  await Promise.resolve();
  assert.equal(inputs, 1);
  editor.view.dispatch({ changes: { from: 6, insert: "?" } });
  const oldView = editor.view;
  editor.setNative(false);
  await Promise.resolve();
  assert.equal(inputs, 1);
  assert.equal(editor.value, "draft!?");
  editor.view.contentDOM.dispatchEvent(new Event("keydown"));
  assert.equal(keydowns, 1);
  editor.removeEventListener("keydown", onKey);
  editor.view.contentDOM.dispatchEvent(new Event("keydown"));
  assert.equal(keydowns, 1);
  assert.equal(oldView.destroyed, true);
  editor.view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
  editor.destroy();
  await Promise.resolve();
  assert.equal(inputs, 1);
});

test("native initialization failure cleans up and restores an editable custom field with its text", () => {
  const { field: editor, failures } = field(false, { fail: true });
  editor.value = "失わない下書き";
  editor.setSelectionRange(3, 3);
  editor.setNative(true);
  assert.equal(failures.length, 1);
  assert.equal(nativeInstances.at(-1).unloaded, true);
  assert.equal(editor.isNative, false);
  assert.equal(editor.value, "失わない下書き");
  assert.equal(editor.selectionStart, 3);
  editor.value += "!";
  assert.equal(editor.value, "失わない下書き!");
  editor.destroy();
});

test("native Enter callback submits only with the modifier and outside IME composition", () => {
  let submissions = 0;
  const editor = new NativeComposer({}, new Element(), [], () => submissions++);
  editor.load();
  const enter = (mod) => editor.params.onEnter({ component: editor, isModifierPressed: mod });
  assert.equal(enter(false), false);
  assert.equal(enter(true), true);
  assert.equal(submissions, 1);
  editor.editorView.composing = true;
  assert.equal(enter(true), true);
  editor.editorView.composing = false;
  editor.editorView.compositionStarted = true;
  assert.equal(enter(true), true);
  assert.equal(submissions, 1);
  editor.unload();
});
