import { parseMemos, type Memo } from "./memoParser";

export interface TimelineNote {
  path: string;
  day: string;
}

/** A window over existing notes, so gaps of years cost no extra reads. */
export class ContinuousTimeline {
  readonly notes: TimelineNote[];
  from: number;
  to: number;

  constructor(notes: TimelineNote[], selected: TimelineNote, retainedPaths: string[] = []) {
    const unique = new Map(notes.map(note => [note.path, note]));
    if (!unique.has(selected.path)) unique.set(selected.path, selected);
    this.notes = [...unique.values()].sort((a, b) => b.day.localeCompare(a.day));
    const anchor = this.notes.findIndex(note => note.path === selected.path);
    const retained = new Set(retainedPaths);
    const indices = this.notes.flatMap((note, index) => retained.has(note.path) ? [index] : []);
    this.from = Math.max(0, Math.min(anchor - 1, ...indices));
    this.to = Math.min(this.notes.length, Math.max(anchor + 4, ...indices.map(index => index + 1)));
  }

  page(direction: "newer" | "older"): TimelineNote[] {
    return direction === "newer"
      ? this.notes.slice(Math.max(0, this.from - 5), this.from)
      : this.notes.slice(this.to, this.to + 5);
  }

  commit(direction: "newer" | "older", count: number): void {
    if (direction === "newer") this.from -= count;
    else this.to += count;
  }

  get visible(): TimelineNote[] { return this.notes.slice(this.from, this.to); }
}

/** Match the daily view's ordering, retaining the slots of unparseable timestamps. */
export function timelineMemos(content: string): Memo[] {
  const parsed = parseMemos(content);
  const timeOf = (memo: Memo): number => Date.parse(memo.time);
  const timed = parsed.filter(memo => !isNaN(timeOf(memo))).sort((a, b) => timeOf(b) - timeOf(a));
  let next = 0;
  return parsed.map(memo => isNaN(timeOf(memo)) ? memo : timed[next++]);
}
