import type { TFile } from "obsidian";
import { dateForDailyNote } from "./dailyNote";

declare const moment: typeof import("moment");

export interface MemoTimestampSettings {
  timestampFormat: string;
  dateAwareTimestamp: boolean;
  timestampTimeFormat: string;
  timestampDateFormat: string;
}

export function formatMemoTimestamp(
  time: string,
  file: TFile | null,
  settings?: MemoTimestampSettings,
): { time: string; date?: string } {
  const posted = moment(time);
  if (!settings?.dateAwareTimestamp || !posted.isValid()) {
    return { time: posted.format(settings?.timestampFormat || "YYYY/MM/DD HH:mm:ss") };
  }
  const noteDate = file ? dateForDailyNote(file) : null;
  const formattedTime = posted.format(settings.timestampTimeFormat || "HH:mm:ss");
  if (noteDate && posted.isSame(noteDate, "day")) return { time: formattedTime };
  return {
    time: formattedTime,
    date: posted.format(settings.timestampDateFormat || "YYYY/MM/DD"),
  };
}

export function renderMemoTimestamp(
  container: HTMLElement,
  time: string,
  file: TFile | null,
  settings?: MemoTimestampSettings,
): void {
  const formatted = formatMemoTimestamp(time, file, settings);
  container.createSpan({
    cls: "wrot-timestamp",
    text: formatted.date ? `${formatted.date} ${formatted.time}` : formatted.time,
  });
}
