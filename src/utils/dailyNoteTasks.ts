import type { CachedMetadata } from "obsidian";
import { extractNonBlockText } from "./blockSegmenter";
import { parseListLine } from "./listParser";
import { parseMemos } from "./memoParser";

/** Native Markdown tasks plus the checkboxes Wrot renders inside its memo fences. */
export function incompleteDailyNoteTasks(content: string, cache: CachedMetadata | null): string[] {
  const tasks: { line: number; text: string }[] = [];
  const lines = content.split("\n");
  for (const item of cache?.listItems ?? []) {
    if (item.task !== " ") continue;
    const line = item.position.start.line;
    const text = (lines[line] ?? "")
      .replace(/^[\s>]*(?:[-+*]|\d+[.)])\s+\[ \](?:[ \t]+|$)/, "")
      .trim();
    tasks.push({ line, text });
  }

  for (const memo of parseMemos(content)) {
    // A wr-looking fence inside an ordinary code example is not a rendered memo.
    if (!cache?.sections?.some((section) =>
      section.type === "code" && section.position.start.line === memo.lineStart
    )) continue;
    for (const line of extractNonBlockText(memo.content).split("\n")) {
      const item = parseListLine(line.replace(/^(?:\s*>\s?)*/, ""));
      if (item?.kind === "check" && !item.checked) {
        tasks.push({ line: memo.lineStart, text: item.content.trim() });
      }
    }
  }
  return tasks.sort((a, b) => a.line - b.line).map((task) => task.text);
}
