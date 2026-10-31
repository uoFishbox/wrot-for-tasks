/* global Event, EventTarget */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { build } from "esbuild";
import moment from "moment";

// Model the API's documented async suggestions and its native input/focus/blur events.
const bundle = await build({
  stdin: {
    contents: `export { EditorState } from "@codemirror/state";
      export { ComposerSuggest } from "./src/editor/composerSuggest.ts";
      export { dateShiftCommand } from "./src/editor/composerDateShift.ts";
      export { insertAtSign } from "./src/utils/textareaEditor.ts";
      export { initI18n } from "./src/i18n/index.ts";`,
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
        export function getLanguage() { return "ja"; }
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
            // Obsidian owns this instance property; subclass helpers must not shadow it.
            this.suggestions = {};
            this.scope = new Scope();
            this.scope.register([], "Enter", event => {
              if (!event.isComposing) { this.selectSuggestion(this.items[this.selectedIndex], event); return false; }
            });
            this.scope.register([], "ArrowDown", event => {
              if (!event.isComposing) { this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1); return false; }
            });
            this.scope.register([], "ArrowUp", event => {
              if (!event.isComposing) { this.selectedIndex = Math.max(0, this.selectedIndex - 1); return false; }
            });
            this.items = [];
            this.selectedIndex = 0;
            this.opened = false;
            this.request = 0;
            const refresh = () => {
              const request = ++this.request;
              this.getSuggestions().then(items => {
                if (request !== this.request) return;
                this.items = items;
                this.selectedIndex = 0;
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
const { EditorState, ComposerSuggest, dateShiftCommand, insertAtSign, initI18n } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
initI18n();

function harness(text = "@20") {
  const measurements = [];
  const timers = new Map();
  let timerId = 0;
  const contentDOM = new EventTarget();
  const win = Object.assign(new EventTarget(), {
    Event,
    KeyboardEvent: class extends Event {
      constructor(type, options) { super(type, options); this.key = options.key; this.isComposing = false; }
    },
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
    dispatchEvent: event => contentDOM.dispatchEvent(event),
    addEventListener: (...args) => contentDOM.addEventListener(...args),
    removeEventListener: (...args) => contentDOM.removeEventListener(...args),
  };
  let date = moment("2026-10-31");
  let today = moment("2026-10-31");
  let shifts = 0;
  let followToday = false;
  let canPost = true;
  const posts = [];
  const shiftDate = dateShiftCommand(() => date, (next, follow, post) => {
    date = next; followToday = follow; shifts++;
    if (post) posts.push({ date: date.format("YYYY-MM-DD"), text: field.value });
  }, () => today, () => canPost);
  const suggest = new ComposerSuggest({}, field, () => assert.fail("must not submit"), { getDate: () => date, shiftDate, canPost: () => canPost });
  contentDOM.addEventListener("keydown", event => suggest.scope.handleKey(event));
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
    get date() { return date; }, get shifts() { return shifts; },
    get followToday() { return followToday; },
    setDate(next) { date = moment(next); },
    setToday(next) { today = moment(next); },
    posts, setCanPost(value) { canPost = value; },
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

function labels(h) {
  return h.suggest.items.map(item => {
    let label;
    h.suggest.renderSuggestion(item, { setText(text) { label = text; } });
    return label;
  });
}

test("complete date shortcuts show a localized action without navigating until selected", async () => {
  for (const [text, expectedLabels, expected] of [
    ["@1d", ["1日後に移動する", "1日前に戻る"], "2026-11-01"],
    ["@2w", ["2週間後に移動する", "2週間前に戻る"], "2026-11-14"],
    ["@1m", ["1か月後に移動する", "1か月前に戻る"], "2026-11-30"],
    ["@1y", ["1年後に移動する", "1年前に戻る"], "2027-10-31"],
  ]) {
    const h = harness(text);
    h.emit();
    await h.settle();
    assert.equal(h.suggest.opened, true);
    assert.deepEqual(labels(h), expectedLabels);
    assert.equal(h.date.format("YYYY-MM-DD"), "2026-10-31");
    assert.equal(h.shifts, 0);
    h.suggest.selectSuggestion(h.suggest.items[0], { type: "click" });
    await h.settle();
    assert.equal(h.field.value, "");
    assert.equal(h.date.format("YYYY-MM-DD"), expected);
    assert.equal(h.shifts, 1);
    assert.equal(h.suggest.opened, false);
    h.suggest.destroy();
  }
});

test("date suggestions confirm through native Enter and Tab bindings", async () => {
  for (const key of ["Enter", "Tab"]) {
    const h = harness("下書き\n@1d");
    h.emit();
    await h.settle();
    assert.equal(h.suggest.scope.handleKey({ key, isComposing: false, preventDefault() {} }), false);
    await h.settle();
    assert.equal(h.field.value, "下書き\n");
    assert.equal(h.date.format("YYYY-MM-DD"), "2026-11-01");
    assert.equal(h.shifts, 1);
    h.suggest.destroy();
  }
});

test("typing a unit replaces time candidates with the date action and deleting it restores times", async () => {
  const h = harness("@1");
  h.emit();
  await h.settle();
  assert.ok(labels(h).includes("01:00"));
  h.setText("@1d");
  h.suggest.refresh();
  await h.settle();
  assert.deepEqual(labels(h), ["1日後に移動する", "1日前に戻る"]);
  h.setText("@1");
  h.suggest.refresh();
  await h.settle();
  assert.ok(labels(h).includes("01:00"));
  assert.equal(h.shifts, 0);
  h.suggest.destroy();
});

test("invalid date contexts never show an action", async () => {
  for (const text of ["@t", "@tomorrow", "@todayx", "本文@to", "@today 本文", "~~~\n@to", "```\n@today", "$$\n@today", "本文@1d", "@1d 本文", "~~~\n本文 @1d", "```\n@1d", "$$\n@1d", "@1h", "@999999999y"]) {
    const h = harness(text);
    h.emit();
    await h.settle();
    assert.equal(h.suggest.opened, false, text);
    assert.equal(h.shifts, 0);
    h.suggest.destroy();
  }
  const h = harness("@1d");
  h.setDate("9999-12-31");
  h.emit();
  await h.settle();
  assert.equal(h.suggest.opened, true);
  assert.deepEqual(labels(h), ["1日前に戻る"]);
  h.suggest.destroy();
});

test("stale date actions cannot navigate after text or the displayed date changes", async () => {
  for (const change of [
    h => h.setText("@2w"),
    h => h.setText("下書き\n@1d"),
    h => h.setDate("2026-11-10"),
  ]) {
    const h = harness("@1d");
    h.emit();
    await h.settle();
    const value = h.suggest.items[0];
    change(h);
    const date = h.date.format("YYYY-MM-DD");
    const text = h.field.value;
    h.suggest.selectSuggestion(value);
    assert.equal(h.shifts, 0);
    assert.equal(h.date.format("YYYY-MM-DD"), date);
    assert.equal(h.field.value, text);
    h.suggest.destroy();
  }
  const h = harness("@1d");
  h.emit();
  await h.settle();
  const value = h.suggest.items[0];
  h.setText("@2w");
  h.emit();
  await h.settle();
  h.suggest.selectSuggestion(value);
  assert.equal(h.field.value, "@2w");
  assert.equal(h.shifts, 0);
  h.suggest.destroy();
});

test("IME date actions are visible but Enter cannot confirm them during composition", async () => {
  const h = harness("@1d");
  h.emit("compositionstart");
  h.view.composing = h.view.compositionStarted = true;
  h.emit();
  await h.settle();
  assert.deepEqual(labels(h), ["1日後に移動する", "1日前に戻る"]);
  h.suggest.selectSuggestion(h.suggest.items[0], { key: "Enter", isComposing: false });
  assert.equal(h.field.value, "@1d");
  assert.equal(h.shifts, 0);
  h.suggest.selectSuggestion(h.suggest.items[0], { type: "click" });
  assert.equal(h.shifts, 0);
  h.emit("compositionend");
  h.view.composing = h.view.compositionStarted = false;
  h.runTimers(0);
  await h.settle();
  assert.equal(h.field.value, "");
  assert.equal(h.date.format("YYYY-MM-DD"), "2026-11-01");
  assert.equal(h.shifts, 1);
  assert.equal(h.field.hasFocus, true);
  h.suggest.destroy();
});

test("today is suggested from @to and confirms via Enter, Tab or click from any displayed day", async () => {
  for (const text of ["@to", "@tod", "@toda", "@today"]) {
    for (const key of ["Enter", "Tab", "click"]) {
      const h = harness(`下書き\n${text}`);
      h.setDate("2030-05-01");
      h.emit();
      await h.settle();
      assert.equal(h.suggest.opened, true);
      assert.deepEqual(labels(h), ["今日ポストする"]);
      assert.equal(h.shifts, 0);
      if (key === "click") h.suggest.selectSuggestion(h.suggest.items[0], { type: "click" });
      else assert.equal(h.suggest.scope.handleKey({ key, isComposing: false, preventDefault() {} }), false);
      await h.settle();
      assert.equal(h.date.format("YYYY-MM-DD"), "2026-10-31");
      assert.equal(h.followToday, true);
      assert.equal(h.field.value, "下書き\n");
      assert.equal(h.shifts, 1);
      h.suggest.destroy();
    }
  }
});

test("today is resolved when selected, including a day rollover while the popup is open", async () => {
  const h = harness("@to");
  h.setDate("2030-05-01");
  h.emit();
  await h.settle();
  h.setToday("2026-11-01");
  h.suggest.selectSuggestion(h.suggest.items[0], { type: "click" });
  assert.equal(h.date.format("YYYY-MM-DD"), "2026-11-01");
  assert.equal(h.followToday, true);
  h.suggest.destroy();
});

test("an outdated today suggestion cannot navigate after the shortcut changes", async () => {
  const h = harness("@to");
  h.emit();
  await h.settle();
  const value = h.suggest.items[0];
  h.setText("@1d");
  h.emit();
  await h.settle();
  h.suggest.selectSuggestion(value);
  assert.equal(h.field.value, "@1d");
  assert.equal(h.shifts, 0);
  h.suggest.destroy();
});

test("a trailing hyphen shows only the backward action for every relative unit", async () => {
  for (const [text, label, expected] of [
    ["@1d-", "1日前に戻る", "2026-10-30"],
    ["@2w-", "2週間前に戻る", "2026-10-17"],
    ["@1m-", "1か月前に戻る", "2026-09-30"],
    ["@1y-", "1年前に戻る", "2025-10-31"],
  ]) {
    const h = harness(text);
    h.emit();
    await h.settle();
    assert.deepEqual(labels(h), [label]);
    h.suggest.selectSuggestion(h.suggest.items[0], { type: "click" });
    assert.equal(h.date.format("YYYY-MM-DD"), expected);
    assert.equal(h.field.value, "");
    assert.equal(h.followToday, false);
    assert.equal(h.shifts, 1);
    h.suggest.destroy();
  }
});

test("the backward option of an unsigned shortcut confirms by keyboard or click", async () => {
  for (const [text, expected] of [
    ["@1d", "2026-10-30"], ["@2w", "2026-10-17"],
    ["@1m", "2026-09-30"], ["@1y", "2025-10-31"],
  ]) {
    for (const key of ["Enter", "Tab", "click"]) {
      const h = harness(`下書き\n${text}`);
      h.emit();
      await h.settle();
      assert.equal(h.suggest.items.length, 2);
      if (key === "click") h.suggest.selectSuggestion(h.suggest.items[1], { type: "click" });
      else {
        assert.equal(h.suggest.scope.handleKey({ key: "ArrowDown", isComposing: false }), false);
        assert.equal(h.suggest.scope.handleKey({ key, isComposing: false, preventDefault() {} }), false);
      }
      assert.equal(h.date.format("YYYY-MM-DD"), expected);
      assert.equal(h.field.value, "下書き\n");
      assert.equal(h.shifts, 1);
      h.suggest.destroy();
    }
  }
});

test("adding a hyphen filters the forward option, and removing it restores both", async () => {
  const h = harness("@1d");
  h.emit();
  await h.settle();
  const forward = h.suggest.items[0];
  h.setText("@1d-");
  h.suggest.refresh();
  await h.settle();
  assert.deepEqual(labels(h), ["1日前に戻る"]);
  h.suggest.selectSuggestion(forward);
  assert.equal(h.field.value, "@1d-");
  assert.equal(h.shifts, 0);
  h.setText("@1d");
  h.suggest.refresh();
  await h.settle();
  assert.deepEqual(labels(h), ["1日後に移動する", "1日前に戻る"]);
  h.suggest.destroy();
});

test("only representable directions appear at the supported date boundaries", async () => {
  const h = harness("@1d");
  h.setDate("0001-01-01");
  h.emit();
  await h.settle();
  assert.deepEqual(labels(h), ["1日後に移動する"]);
  h.setText("@1d-");
  h.emit();
  await h.settle();
  assert.equal(h.suggest.opened, false);
  h.suggest.destroy();
});

test("inline date actions submit the remaining text by keyboard or click in either direction", async () => {
  for (const [text, option, expected] of [
    ["なにかの投稿 @1d", 0, "2026-11-01"],
    ["なにかの投稿 @1d", 1, "2026-10-30"],
    ["なにかの投稿 @1d-", 0, "2026-10-30"],
    ["なにかの投稿 @2w-", 0, "2026-10-17"],
    ["なにかの投稿 @1m", 1, "2026-09-30"],
    ["なにかの投稿 @1y-", 0, "2025-10-31"],
    ["なにかの投稿 @to", 0, "2026-10-31"],
  ]) {
    for (const key of ["Enter", "Tab", "click"]) {
      const h = harness(text);
      h.emit();
      await h.settle();
      assert.equal(h.suggest.opened, true, text);
      assert.equal(h.posts.length, 0);
      if (key === "click") h.suggest.selectSuggestion(h.suggest.items[option], { type: "click" });
      else {
        if (option) h.suggest.scope.handleKey({ key: "ArrowDown", isComposing: false });
        h.suggest.scope.handleKey({ key, isComposing: false, preventDefault() {} });
      }
      assert.deepEqual(h.posts, [{ date: expected, text: "なにかの投稿" }]);
      h.suggest.destroy();
    }
  }
});

test("a stale inline action cannot submit changed text, and editing or saving suppresses inline actions", async () => {
  const h = harness("最初の投稿 @1d");
  h.emit();
  await h.settle();
  const value = h.suggest.items[0];
  h.setText("別の投稿 @1d");
  h.suggest.selectSuggestion(value);
  assert.equal(h.posts.length, 0);
  assert.equal(h.field.value, "別の投稿 @1d");
  h.setCanPost(false);
  h.emit();
  await h.settle();
  assert.equal(h.suggest.opened, false);
  h.setText("@1d");
  h.emit();
  await h.settle();
  assert.equal(h.suggest.opened, true);
  h.suggest.destroy();
});

test("date labels describe posting whenever other text exists, including on other lines", async () => {
  for (const [text, expected, caret] of [
    ["@1d", ["1日後に移動する", "1日前に戻る"]],
    ["  \n@1d\n　", ["1日後に移動する", "1日前に戻る"], 6],
    ["本文 @1d", ["1日後にポストする", "1日前にポストする"]],
    ["本文\n@1d", ["1日後にポストする", "1日前にポストする"]],
    ["@1d\n本文", ["1日後にポストする", "1日前にポストする"], 3],
    ["本文 @1d-", ["1日前にポストする"]],
    ["本文 @2w", ["2週間後にポストする", "2週間前にポストする"]],
    ["本文 @1m", ["1か月後にポストする", "1か月前にポストする"]],
    ["本文 @1y", ["1年後にポストする", "1年前にポストする"]],
    ["本文 @to", ["今日ポストする"]],
    ["@to", ["今日に移動"]],
  ]) {
    const h = harness(text);
    if (caret !== undefined) h.view.dispatch({ selection: { anchor: caret } });
    h.emit();
    await h.settle();
    assert.deepEqual(labels(h), expected, text);
    h.suggest.destroy();
  }
});

test("removing the body updates the action label and rejects a stale posting action", async () => {
  const h = harness("本文 @1d");
  h.emit();
  await h.settle();
  const posting = h.suggest.items[0];
  assert.deepEqual(labels(h), ["1日後にポストする", "1日前にポストする"]);
  h.setText("@1d");
  h.emit();
  await h.settle();
  assert.deepEqual(labels(h), ["1日後に移動する", "1日前に戻る"]);
  h.suggest.selectSuggestion(posting);
  assert.equal(h.shifts, 0);
  assert.equal(h.posts.length, 0);
  assert.equal(h.field.value, "@1d");
  h.suggest.destroy();
});

test("the @ button opens time suggestions in an empty input", async () => {
  const h = harness("");
  insertAtSign(h.field);
  await h.settle();
  assert.equal(h.field.value, "@");
  assert.equal(h.field.selectionStart, 1);
  assert.equal(h.suggest.opened, true);
  assert.equal(h.suggest.items.length, 96);
  assert.equal(h.posts.length, 0);
  h.suggest.destroy();
});

test("the @ button separates existing text and supports posting with date suggestions", async () => {
  for (const [text, expected] of [
    ["本文", "本文 @"], ["本文 ", "本文 @"], ["本文\n", "本文\n@"],
  ]) {
    const h = harness(text);
    insertAtSign(h.field);
    assert.equal(h.field.value, expected);
    assert.equal(h.field.selectionStart, expected.length);
    h.setText(h.field.value + "1d");
    h.emit();
    await h.settle();
    assert.deepEqual(labels(h), ["1日後にポストする", "1日前にポストする"]);
    h.suggest.selectSuggestion(h.suggest.items[0], { type: "click" });
    assert.deepEqual(h.posts, [{ date: "2026-11-01", text: text.trimEnd() + (text.endsWith("\n") ? "\n" : "") }]);
    h.suggest.destroy();
  }
});
