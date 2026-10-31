import { t } from "../i18n";

// Compare calendar dates without time-of-day or daylight-saving offsets.
export function calendarDateValue(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface TaskSchedule {
  noteDate: number;
  createdDate: number | null;
  startMinutes: number | null;
}

export type TaskScheduleStatus = "unscheduled" | "scheduled" | "past";

/** Keep the calendar date recorded at posting, even after a timezone change. */
export function taskCreationDate(time: string | undefined): number | null {
  const match = time?.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? date.getTime() : null;
}

function taskStartTime(task: TaskSchedule): number {
  const day = new Date(task.noteDate);
  const minutes = task.startMinutes ?? 0;
  return new Date(
    day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
    Math.floor(minutes / 60), minutes % 60,
  ).getTime();
}

export function taskScheduleStatus(task: TaskSchedule, now: Date): TaskScheduleStatus {
  if (task.startMinutes === null) {
    // A note/file creation date cannot establish when an individual task was written.
    if (task.createdDate === null || task.createdDate >= task.noteDate) return "unscheduled";
    return task.noteDate < calendarDateValue(now) ? "past" : "scheduled";
  }
  return taskStartTime(task) < now.getTime() ? "past" : "scheduled";
}

/** Timed tasks count from their start on the daily note's local calendar date. */
export function remainingTaskTimeLabel(task: TaskSchedule, now: Date): string | null {
  if (taskScheduleStatus(task, now) === "unscheduled") return null;
  if (task.startMinutes !== null) {
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    const difference = Math.round((taskStartTime(task) - currentMinute.getTime()) / 60_000);
    const minutes = Math.abs(difference);
    if (minutes === 0) return t("view.tasks.now");
    if (minutes < 60) {
      return t(difference > 0 ? "view.tasks.minutesRemaining" : "view.tasks.minutesElapsed", { minutes });
    }
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      if (remainder === 0) {
        return t(difference > 0 ? "view.tasks.hoursRemaining" : "view.tasks.hoursElapsed", { hours });
      }
      return t(difference > 0 ? "view.tasks.hoursMinutesRemaining" : "view.tasks.hoursMinutesElapsed", {
        hours, minutes: remainder,
      });
    }
  }
  const days = (task.noteDate - calendarDateValue(now)) / 86_400_000;
  return days === 0 ? t("view.dateNav.today") : t(
    days > 0 ? "view.tasks.daysRemaining" : "view.tasks.daysElapsed",
    { days: Math.abs(days) },
  );
}
