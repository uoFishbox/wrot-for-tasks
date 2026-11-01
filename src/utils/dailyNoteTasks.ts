import type { CachedMetadata } from "obsidian";
import { segmentBlocks } from "./blockSegmenter";
import { parseListLine } from "./listParser";
import { parseMemos } from "./memoParser";

export interface DailyNoteTask {
  line: number;
  text: string;
  time?: string;
}

/** Start of a leading H:mm / HH:mm time or time range, in minutes after midnight. */
export function dailyNoteTaskStartMinutes(text: string): number | null {
  const match = /^\s*([01]?\d|2[0-3]):([0-5]\d)(?:\s*-\s*(?:[01]?\d|2[0-3]):[0-5]\d)?(?=\s|$)/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Incomplete checkboxes rendered in a memo body, with lines relative to that body. */
export function incompleteMemoTaskEntries(content: string): DailyNoteTask[] {
  const tasks: DailyNoteTask[] = [];
  for (const segment of segmentBlocks(content)) {
    if (segment.kind !== "text") continue;
    segment.text.split("\n").forEach((line, index) => {
      const item = parseListLine(line.replace(/^(?:\s*>\s?)*/, ""));
      if (item?.kind === "check" && !item.checked) {
        tasks.push({ line: segment.startLine + index, text: item.content.trim() });
      }
    });
  }
  return tasks;
}

/** Native Markdown tasks plus the checkboxes Wrot renders inside its memo fences. */
export function incompleteDailyNoteTaskEntries(content: string, cache: CachedMetadata | null): DailyNoteTask[] {
  const tasks: DailyNoteTask[] = [];
  const lines = content.split("\n");
  for (const item of cache?.listItems ?? []) {
    if (item.task !== " ") continue;
    const line = item.position.start.line;
    const match = (lines[line] ?? "").match(/^[\s>]*(?:[-+*]|\d+[.)])\s+\[ \](?:[ \t]+|$)(.*)$/);
    // Reads can finish before metadata has caught up with a checkbox write.
    if (!match) continue;
    const text = match[1].trim();
    tasks.push({ line, text });
  }

  for (const memo of parseMemos(content)) {
    // A wr-looking fence inside an ordinary code example is not a rendered memo.
    if (!cache?.sections?.some((section) =>
      section.type === "code" && section.position.start.line === memo.lineStart
    )) continue;
    // rawBlock preserves blank lines stripped from memo.content, so source links
    // still land on the actual task after blank lines or embedded code/math.
    const body = memo.rawBlock.split("\n").slice(1);
    if (body[body.length - 1]?.trim() === "```") body.pop();
    for (const task of incompleteMemoTaskEntries(body.join("\n"))) {
      tasks.push({ ...task, line: memo.lineStart + 1 + task.line, time: memo.time });
    }
  }
  return tasks.sort((a, b) => a.line - b.line);
}

export function incompleteDailyNoteTasks(content: string, cache: CachedMetadata | null): string[] {
  return incompleteDailyNoteTaskEntries(content, cache).map((task) => task.text);
}
