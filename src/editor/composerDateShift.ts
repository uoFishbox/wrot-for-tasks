import { EditorView, type Command } from "@codemirror/view";
import type { Moment } from "moment";
import { findBlockRanges, toTildeFences } from "../utils/blockSegmenter";

const UNITS = { d: "day", w: "week", m: "month", y: "year" } as const;

declare const moment: typeof import("moment");

export type DateShiftSuggestion = { post: boolean } & ({
  kind: "relative";
  shortcut: string;
  amount: number;
  unit: keyof typeof UNITS;
  direction: "forward" | "backward";
} | {
  kind: "today";
  shortcut: string;
});

export type DateShiftCommand = (view: EditorView, suggestion?: DateShiftSuggestion) => boolean;

function dateShiftContext(view: EditorView, base: Moment, canPost: boolean) {
  const { state } = view;
  const { main, ranges } = state.selection;
  if (state.readOnly || ranges.length !== 1 || !main.empty) return null;
  const line = state.doc.lineAt(main.head);
  const before = state.sliceDoc(line.from, main.head);
  const match = /(?:^|[ \t\u3000]+)@(?:(\d+)([dwmy])(-?)|(to|tod|toda|today))[ \t\u3000]*$/.exec(before);
  if (!match || !/^[ \t\u3000]*$/.test(state.sliceDoc(main.head, line.to))) return null;
  if (findBlockRanges(toTildeFences(state.doc.toString()).split("\n")).some(
    (block) => line.number - 1 >= block.startLine && line.number - 1 <= block.endLine
  )) return null;

  const prefix = before.slice(0, match.index);
  // Unfinished inline code, math and links remain literal while being typed.
  const literalPrefix = prefix.replace(/\\./g, "").replace(/(`+)[\s\S]*?\1|\$[^$]*\$|\[[^\]]*\](?:\([^)]*\))?/g, "");
  if (literalPrefix.includes("`") || literalPrefix.includes("[") || /\$(?!\d)/.test(literalPrefix)) return null;
  const from = line.from + match.index;
  const post = (state.sliceDoc(0, from) + state.sliceDoc(line.to)).trim().length > 0;
  if (post && !canPost) return null;
  const shortcut = match[0].trim();
  if (match[4]) {
    return { from, to: line.to, post, defaultDirection: "forward", candidates: [{ date: null, suggestion: { kind: "today" as const, shortcut, post } }] };
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount)) return null;
  const unit = match[2] as keyof typeof UNITS;
  const directions: ("forward" | "backward")[] = match[3] ? ["backward"] : ["forward", "backward"];
  const candidates = directions.flatMap((direction) => {
    const date = base.clone().add(direction === "backward" ? -amount : amount, UNITS[unit]);
    if (!date.isValid() || date.year() < 1 || date.year() > 9999) return [];
    return [{ date, suggestion: { kind: "relative" as const, shortcut, amount, unit, direction, post } }];
  });
  return { from, to: line.to, post, defaultDirection: match[3] ? "backward" : "forward", candidates };
}

/** Use the same validation for the popup and for committing a shortcut. */
export function dateShiftSuggestions(view: EditorView, base: Moment, canPost = true): DateShiftSuggestion[] {
  return dateShiftContext(view, base, canPost)?.candidates.map(({ suggestion }) => suggestion) ?? [];
}

/** A shortcut also posts whenever removing it leaves text in the composer. */
export function dateShiftCommand(
  getDate: () => Moment,
  onShift: (date: Moment, followToday: boolean, post: boolean) => void,
  getToday: () => Moment = () => moment(),
  canPost: () => boolean = () => true
): DateShiftCommand {
  return (view, selected) => {
    if (view.composing || view.compositionStarted) return false;
    const context = dateShiftContext(view, getDate(), canPost());
    if (!context) return false;
    const candidate = context.candidates.find(({ suggestion }) => selected
      ? suggestion.shortcut === selected.shortcut && suggestion.post === selected.post && (suggestion.kind === "today"
        ? selected.kind === "today"
        : selected.kind === "relative" && suggestion.direction === selected.direction)
      : suggestion.kind === "today" || suggestion.direction === context.defaultDirection);
    if (!candidate) return false;
    const { from, to, post } = context;

    // Remove only the shortcut and its separator, preserving the rest of the draft.
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
      userEvent: "input.complete",
    });
    // Resolve today when selected, so a popup opened before midnight stays correct.
    onShift(candidate.date ?? getToday().clone(), candidate.suggestion.kind === "today", post);
    return true;
  };
}

export function dateShiftOnSpace(command: Command) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if ((text !== " " && text !== "\u3000") || from !== to || from !== view.state.selection.main.head) return false;
    return command(view);
  });
}
