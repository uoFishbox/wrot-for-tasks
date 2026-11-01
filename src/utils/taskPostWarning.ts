import { dailyNoteTaskStartMinutes, incompleteMemoTaskEntries } from "./dailyNoteTasks";
import { calendarDateValue, taskScheduleStatus } from "./remainingTaskTime";

export type TaskPostWarning = { reason: "pastDate" } | { reason: "pastTime"; startMinutes: number };

/** Check the selected calendar day, independent of the daily note's filename format. */
export function taskPostWarning(content: string, date: Date, now: Date): TaskPostWarning | null {
  const tasks = incompleteMemoTaskEntries(content);
  if (tasks.length === 0) return null;
  const noteDate = calendarDateValue(date);
  if (noteDate < calendarDateValue(now)) return { reason: "pastDate" };
  for (const task of tasks) {
    const startMinutes = dailyNoteTaskStartMinutes(task.text);
    if (startMinutes !== null && taskScheduleStatus({ noteDate, createdDate: null, startMinutes }, now) === "past") {
      return { reason: "pastTime", startMinutes };
    }
  }
  return null;
}
