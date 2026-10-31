/* global Event, EventTarget */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";

// Model the API's documented async suggestions and its native input/focus/blur events.
// The real Obsidian popup and keyboard scope are checked separately in the app.
const bundle = await build({
  stdin: {
    contents: `export { EditorState } from "@codemirror/state";
      export { TimeTaskSuggest } from "./src/editor/timeTaskSuggest.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "obsidian-test-api",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
        export class Scope {
          constructor(parent) { this.parent = parent; this.handlers = {}; this.bindings = []; }
          register(modifiers, key, callback) {
            this.bindings.push({ modifiers, key, callback });
            this.handlers[(modifiers ?? []).join("+") + key] = callback;
          }
          handleKey(event) {
            const pressed = [event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean).sort().join(",");
            for (const { modifiers, key, callback } of this.bindings) {
              if (modifiers && modifiers.map(mod => mod === "Mod" ? "Ctrl" : mod).sort().join(",") !== pressed) continue;
              if (key !== null && key !== event.key) continue;
              const result = callback(event);
              if (result !== undefined || key !== null) return result;
            }
            return this.parent?.handleKey(event);
          }
        }
        export class AbstractInputSuggest {
          constructor(app, el) {
            this.scope = new Scope();
            this.scope.register([], "Enter", event => {
              if (!event.isComposing) { this.selectSuggestion(this.items[0], event); return false; }
            });
            this.scope.register([], "ArrowDown", event => {
              if (!event.isComposing) return false;
            });
            this.items = [];
            this.opened = false;
            this.request = 0;
            const refresh = () => {
              const request = ++this.request;
              this.getSuggestions().then(items => {
                if (request !== this.request) return;
                this.items = items;
                if (items.length) this.open();
                else this.close();
              });
            };
            el.addEventListener("input", refresh);
            el.addEventListener("focus", refresh);
            el.addEventListener("blur", () => this.close());
          }
          open() { this.opened = true; }
          close() { this.opened = false; }
        }
      ` }));
    },
  }],
});
const { EditorState, TimeTaskSuggest } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function harness(text = "@20") {
  const measurements = [];
  const timers = new Map();
  let timerId = 0;
  const contentDOM = new EventTarget();
  const win = Object.assign(new EventTarget(), {
    Event,
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  let focusBounces = 0;
  const container = {
    createEl() { return { focus() { focusBounces++; }, remove() {} }; },
  };
  const ownerDocument = { defaultView: win, documentElement: { clientWidth: 1000, clientHeight: 800 } };
  contentDOM.ownerDocument = ownerDocument;
  contentDOM.rect = { left: 100, top: 200, right: 500, bottom: 224, width: 400, height: 24 };
  contentDOM.getBoundingClientRect = () => contentDOM.rect;
  contentDOM.getClientRects = () => [contentDOM.rect];
  const view = {
    state: EditorState.create({ doc: text, selection: { anchor: text.length } }),
    dom: { isConnected: true, ownerDocument, parentElement: container },
    contentDOM,
    composing: false,
    compositionStarted: false,
    inView: true,
    requestMeasure(request) { measurements.push(request); },
    dispatch(spec) { this.state = this.state.update(spec).state; },
  };
  const field = {
    view,
    hasFocus: true,
    get value() { return view.state.doc.toString(); },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    blur() { this.hasFocus = false; contentDOM.dispatchEvent(new Event("blur")); },
    focus() { this.hasFocus = true; contentDOM.dispatchEvent(new Event("focus")); },
    addEventListener: (...args) => contentDOM.addEventListener(...args),
    removeEventListener: (...args) => contentDOM.removeEventListener(...args),
  };
  const suggest = new TimeTaskSuggest({}, field, () => assert.fail("must not submit"));
  let inputEvents = 0;
  contentDOM.addEventListener("input", () => inputEvents++);
  const emit = (name = "input") => contentDOM.dispatchEvent(new Event(name));
  const setText = (text) => view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
  });
  const settle = async () => {
    // A programmatic refresh first notifies the API, then schedules its measurement.
    await Promise.resolve();
    await Promise.resolve();
    for (const request of measurements.splice(0)) request.write(request.read(view), view);
    await Promise.resolve();
    await Promise.resolve();
  };
  const runTimers = (maxDelay = Infinity) => {
    for (const [id, timer] of [...timers]) {
      if (!timers.has(id) || timer.delay > maxDelay) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  return {
    field, view, win, contentDOM, suggest, measurements, emit, setText, settle, runTimers,
    inputs: () => inputEvents, focusBounces: () => focusBounces,
  };
}

test("native input waits for settled editor state and layout before publishing", async () => {
  const h = harness("");
  h.emit(); // DOM has changed, but CodeMirror has not applied the text yet.
  h.setText("@20");
  assert.equal(h.suggest.opened, false);
  await h.settle();
  assert.deepEqual(h.suggest.items.map(item => item.label), ["20:00", "20:15", "20:30", "20:45"]);
  assert.equal(h.suggest.opened, true);
  h.suggest.destroy();
});

test("native input and repeated state notifications share one query", async () => {
  const h = harness();
  h.emit();
  h.suggest.refresh();
  h.suggest.refresh();
  await h.settle();
  assert.equal(h.inputs(), 1);
  h.suggest.refresh();
  await h.settle();
  assert.equal(h.inputs(), 1);
  h.suggest.destroy();
});

test("newer native queries supersede older ones", async () => {
  const h = harness();
  h.emit();
  h.setText("@21");
  h.emit();
  await h.settle();
  assert.deepEqual(h.suggest.items.map(item => item.label), ["21:00", "21:15", "21:30", "21:45"]);
  h.suggest.destroy();
});

test("blur, Escape and destruction cancel pending work", async () => {
  for (const cancel of [
    h => { h.field.hasFocus = false; h.emit("blur"); },
    h => h.suggest.close(),
    h => h.suggest.destroy(),
  ]) {
    const h = harness();
    h.emit();
    await Promise.resolve();
    cancel(h);
    await h.settle();
    assert.equal(h.suggest.opened, false);
    h.suggest.destroy();
  }
});

test("IME input opens and filters suggestions and unchanged committed text keeps them open", async () => {
  const h = harness("@");
  h.emit("compositionstart");
  h.view.composing = h.view.compositionStarted = true;
  h.emit();
  await h.settle();
  assert.equal(h.suggest.opened, true);
  assert.equal(h.suggest.items.length, 96);
  h.setText("@20");
  h.emit();
  h.suggest.refresh();
  await h.settle();
  assert.deepEqual(h.suggest.items.map(item => item.label), ["20:00", "20:15", "20:30", "20:45"]);
  // Capture listeners see the old composing state during compositionend.
  h.emit("compositionend");
  h.suggest.refresh();
  h.view.composing = h.view.compositionStarted = false;
  await h.settle();
  assert.equal(h.suggest.opened, true);
  h.suggest.destroy();
});

test("starting composition leaves an existing popup and its pending query available", async () => {
  const h = harness();
  h.emit();
  h.emit("compositionstart");
  h.view.compositionStarted = true;
  await h.settle();
  assert.equal(h.suggest.opened, true);
  h.suggest.destroy();
});

test("tapping an IME suggestion waits for the committed state, inserts once and restores focus", async () => {
  const h = harness();
  h.emit("compositionstart");
  h.view.composing = h.view.compositionStarted = true;
  h.emit();
  await h.settle();
  h.suggest.selectSuggestion(h.suggest.items[1], { type: "click" });
  assert.equal(h.field.value, "@20");
  assert.equal(h.field.hasFocus, false);
  h.emit("compositionend");
  assert.equal(h.field.value, "@20");
  h.view.composing = h.view.compositionStarted = false;
  h.runTimers(0);
  await h.settle();
  assert.equal(h.field.value, "- [ ] 20:15 ");
  assert.equal(h.field.hasFocus, true);
  assert.equal(h.focusBounces(), 1);
  h.runTimers();
  assert.equal(h.field.value, "- [ ] 20:15 ");
  assert.equal(h.focusBounces(), 1);
  h.suggest.destroy();
});

test("IME confirmation keys do not select a time or force a blur", async () => {
  const h = harness();
  h.emit("compositionstart");
  h.view.compositionStarted = true;
  h.emit();
  await h.settle();
  h.suggest.selectSuggestion(h.suggest.items[0], { key: "Enter", isComposing: true });
  h.suggest.selectSuggestion(h.suggest.items[0], { key: "Enter", isComposing: false });
  const handled = h.suggest.scope.handlers.Tab({ isComposing: false, preventDefault() { assert.fail("IME Tab must pass through"); } });
  assert.equal(handled, undefined);
  for (const key of ["Enter", "Tab", "ArrowDown", "ArrowUp", "Escape"]) {
    // Scope returning true leaves default input alone and bypasses native bindings.
    assert.equal(h.suggest.scope.handleKey({ key, isComposing: false }), true);
    assert.equal(h.suggest.scope.handleKey({ key, isComposing: true }), true);
  }
  assert.equal(h.suggest.opened, true);
  assert.equal(h.field.value, "@20");
  assert.equal(h.field.hasFocus, true);
  h.suggest.destroy();
});

test("normal Enter delegates to the native popup after composition ends", async () => {
  const h = harness();
  h.emit("compositionstart");
  h.view.composing = h.view.compositionStarted = true;
  h.emit();
  await h.settle();
  h.emit("compositionend");
  h.view.composing = h.view.compositionStarted = false;
  await h.settle();
  assert.equal(h.suggest.scope.handleKey({ key: "Enter", isComposing: false }), false);
  assert.equal(h.field.value, "- [ ] 20:00 ");
  assert.equal(h.focusBounces(), 0);
  h.suggest.destroy();
});

test("a deferred IME selection cannot overwrite changed text, selection or read-only content", async () => {
  for (const change of [
    h => h.setText("@21"),
    h => h.setText("前の行\n@20"),
    h => h.view.dispatch({ selection: { anchor: 0 } }),
    h => { h.view.state = EditorState.create({ doc: "@20", selection: { anchor: 3 }, extensions: [EditorState.readOnly.of(true)] }); },
    h => { h.view.dom.isConnected = false; },
    h => h.suggest.destroy(),
    h => { h.emit("compositionstart"); h.view.composing = h.view.compositionStarted = true; },
  ]) {
    const h = harness();
    h.emit("compositionstart");
    h.view.composing = h.view.compositionStarted = true;
    h.emit();
    await h.settle();
    h.suggest.selectSuggestion(h.suggest.items[0]);
    h.emit("compositionend");
    h.view.composing = h.view.compositionStarted = false;
    change(h);
    const text = h.field.value;
    h.runTimers();
    await h.settle();
    assert.equal(h.field.value, text);
    assert.equal(h.focusBounces(), 0);
    h.suggest.destroy();
  }
});

test("a missing compositionend never allows a timer to rewrite active marked text", async () => {
  const h = harness();
  h.emit("compositionstart");
  h.view.composing = h.view.compositionStarted = true;
  h.emit();
  await h.settle();
  h.suggest.selectSuggestion(h.suggest.items[0]);
  h.runTimers();
  assert.equal(h.field.value, "@20");
  assert.equal(h.focusBounces(), 0);
  h.suggest.destroy();
});

test("destroying the controller also cancels queued refresh notifications", async () => {
  const h = harness();
  h.suggest.refresh();
  h.suggest.destroy();
  await h.settle();
  assert.equal(h.inputs(), 0);
  assert.equal(h.measurements.length, 0);
});

test("a dismissed popup stays closed until the context changes", async () => {
  const h = harness();
  h.emit();
  await h.settle();
  h.suggest.close();
  h.suggest.refresh();
  await h.settle();
  assert.equal(h.suggest.opened, false);
  h.setText("@21");
  h.suggest.refresh();
  await h.settle();
  assert.equal(h.suggest.opened, true);
  h.suggest.destroy();
});

test("hidden, offscreen and invalid anchors never open a popup", async () => {
  for (const rect of [
    { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    { left: 100, top: 900, right: 500, bottom: 924, width: 400, height: 24 },
    { left: NaN, top: 200, right: 500, bottom: 224, width: 400, height: 24 },
  ]) {
    const h = harness();
    h.contentDOM.rect = rect;
    h.emit();
    await h.settle();
    assert.equal(h.suggest.opened, false);
    h.suggest.destroy();
  }
});

test("an edit between measuring and publishing discards the measured candidates", async () => {
  const h = harness();
  h.emit();
  await Promise.resolve();
  const request = h.measurements.shift();
  const result = request.read(h.view);
  h.setText("@21");
  request.write(result, h.view);
  await h.settle();
  assert.equal(h.suggest.opened, false);
  h.suggest.destroy();
});

test("a stale popup cannot edit a different task with the same time prefix", async () => {
  const h = harness();
  h.emit();
  await h.settle();
  const value = h.suggest.items[0];
  h.setText("前の行\n@20");
  h.suggest.selectSuggestion(value);
  assert.equal(h.field.value, "前の行\n@20");
  h.suggest.destroy();
});

test("resizing repositions the popup without querying or resetting its candidates", async () => {
  const h = harness();
  h.emit();
  await h.settle();
  const items = h.suggest.items;
  h.win.dispatchEvent(new Event("resize"));
  await h.settle();
  assert.equal(h.suggest.opened, true);
  assert.equal(h.suggest.items, items);
  assert.equal(h.inputs(), 1);
  h.view.inView = false;
  h.win.dispatchEvent(new Event("resize"));
  await h.settle();
  assert.equal(h.suggest.opened, false);
  h.suggest.destroy();
  h.win.dispatchEvent(new Event("resize"));
  assert.equal(h.measurements.length, 0);
});

test("Tab from a stale scope cannot forward Enter into a different task", async () => {
  const h = harness();
  h.emit();
  await h.settle();
  h.setText("前の行\n@20");
  let prevented = false;
  const handled = h.suggest.scope.handlers.Tab({ isComposing: false, preventDefault() { prevented = true; } });
  assert.equal(handled, false);
  assert.equal(prevented, true);
  assert.equal(h.field.value, "前の行\n@20");
  assert.equal(h.suggest.opened, false);
  h.suggest.destroy();
});
