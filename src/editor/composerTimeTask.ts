import type { Command } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { findBlockRanges } from "../utils/blockSegmenter";

// Only a line's task content can start the shortcut; prose and email addresses stay literal.
const SHORTCUT_RE = /^([ \t\u3000]*(?:>[ \t]?)*[ \t\u3000]*)(- \[[ xX]\] |- )?@(\d{0,4})(?:-(\d{0,4}))?$/;
// Existing tasks accept times directly, including a formatted start committed with Tab.
const TASK_TIME_RE = /^([ \t\u3000]*(?:>[ \t]?)*[ \t\u3000]*)(- \[[ xX]\] )(\d{1,4}|\d{2}:\d{0,2})(?:-(\d{0,4}|\d{2}:\d{0,2}))?$/;

function clockTime(digits: string): string | null {
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  return digits.length === 4 && hours < 24 && minutes < 60 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : null;
}

function timeTaskContext(view: EditorView) {
  const { state } = view;
  const { main, ranges } = state.selection;
  if (state.readOnly || ranges.length !== 1 || !main.empty) return null;
  const line = state.doc.lineAt(main.head);
  const before = state.sliceDoc(line.from, main.head);
  const match = SHORTCUT_RE.exec(before) ?? TASK_TIME_RE.exec(before);
  if (!match) return null;
  const suffix = state.sliceDoc(main.head, line.to);
  if (suffix && !/^[ \t\u3000]/.test(suffix)) return null;
  // Fence content is literal, including an unclosed code or math block.
  if (findBlockRanges(state.doc.toString().split("\n")).some(
    (block) => line.number - 1 >= block.startLine && line.number - 1 <= block.endLine
  )) return null;

  const end = match[4] as string | undefined;
  return {
    from: line.from + match[1].length,
    to: main.head,
    spaceAfter: suffix.startsWith(" "),
    marker: match[2]?.includes("[") ? match[2] : "- [ ] ",
    start: match[3].replace(":", ""),
    end: end?.replace(":", ""),
  };
}

function insertTimeTask(view: EditorView, context: NonNullable<ReturnType<typeof timeTaskContext>>, beginRange = false): boolean {
  const start = clockTime(context.start);
  const end = context.end === undefined ? null : clockTime(context.end);
  if (!start || (context.end !== undefined && !end)) return false;
  const insert = beginRange
    ? `${context.marker}${start}-`
    : `${context.marker}${start}${end ? `-${end}` : ""} `;
  view.dispatch({
    changes: { from: context.from, to: context.to + (!beginRange && context.spaceAfter ? 1 : 0), insert },
    selection: { anchor: context.from + insert.length },
    userEvent: "input.complete",
  });
  return true;
}

/** Completes @HHmm or @HHmm-HHmm, keeping the caret ready for the task name. */
export const completeTimedTask: Command = (view) => {
  if (view.compositionStarted || view.composing) return false;
  const context = timeTaskContext(view);
  return context ? insertTimeTask(view, context) : false;
};

export interface TimeTaskSuggestion {
  digits: string;
  label: string;
}

/** Quarter-hour candidates for a partial hour; four digits also allow exact minutes. */
export function timeTaskSuggestions(view: EditorView): TimeTaskSuggestion[] {
  const context = timeTaskContext(view);
  if (!context || (context.end !== undefined && !clockTime(context.start))) return [];
  const query = context.end ?? context.start;
  // Fixed-width HHmm strings sort in time order; end candidates stay on the same day.
  const minimum = context.end === undefined ? "0000" : context.start;
  if (query.length === 4) {
    const label = clockTime(query);
    return label && query >= minimum ? [{ digits: query, label }] : [];
  }
  const suggestions: TimeTaskSuggestion[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of ["00", "15", "30", "45"]) {
      const hh = String(hour).padStart(2, "0");
      const digits = hh + minute;
      if (digits < minimum) continue;
      // A single digit also matches that hour without its leading zero.
      if (digits.startsWith(query) || (query.length === 1 && hour === Number(query))) {
        suggestions.push({ digits, label: `${hh}:${minute}` });
      }
    }
  }
  return suggestions;
}

export function selectTimedTask(view: EditorView, suggestion: TimeTaskSuggestion, continueRange = false): boolean {
  if (view.compositionStarted || view.composing) return false;
  if (!timeTaskSuggestions(view).some((item) => item.digits === suggestion.digits)) return false;
  const context = timeTaskContext(view);
  if (!context) return false;
  const beginRange = continueRange && context.end === undefined;
  if (context.end === undefined) context.start = suggestion.digits;
  else context.end = suggestion.digits;
  return insertTimeTask(view, context, beginRange);
}

/** Wait for a delimiter so typing the first four digits never prevents adding a range. */
export const timedTaskOnSpace = EditorView.inputHandler.of((view, from, to, text) => {
  if ((text !== " " && text !== "\u3000") || from !== to || from !== view.state.selection.main.head) return false;
  return completeTimedTask(view);
});
