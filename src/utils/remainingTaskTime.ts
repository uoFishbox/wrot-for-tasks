import { getActiveLocale, t } from "../i18n";

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

/** A duration without relative-date wording, for use beside a heading or in a sentence. */
function taskDurationLabel(minutes: number): string {
  const locale = getActiveLocale();
  const units: [string, number][] = [
    ["day", Math.floor(minutes / 1440)],
    ["hour", Math.floor(minutes / 60) % 24],
    ["minute", minutes % 60],
  ];
  const compact = /^(ja|zh)/.test(locale);
  return units.filter(([unit, value]) => value > 0 || (minutes === 0 && unit === "minute")).map(([unit, value]) => {
    const formatted = new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
    return compact ? formatted.replace(/\s/g, "") : formatted;
  }).join(compact ? "" : " ");
}

export function taskTimeDetails(task: TaskSchedule & { time?: string }, now: Date): {
  createdElapsed: string;
  scheduledRemaining: string;
  timeline: { elapsedDays: number; scheduledDays: number; elapsedLabel: string } | null;
} {
  const created = task.time && taskCreationDate(task.time) !== null ? new Date(task.time) : null;
  const validCreated = created !== null && Number.isFinite(created.getTime());
  const scheduled = taskScheduleStatus(task, now) !== "unscheduled";
  // Date-only reservations advance by calendar days, matching their remaining-time label.
  const start = task.startMinutes === null ? task.createdDate : validCreated ? created.getTime() : null;
  const end = task.startMinutes === null ? task.noteDate : taskStartTime(task);
  const current = task.startMinutes === null ? calendarDateValue(now) : now.getTime();
  const createdElapsed = validCreated
    ? taskDurationLabel(Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60_000)))
    : t("view.tasks.unknown");
  return {
    createdElapsed,
    scheduledRemaining: !scheduled ? t("view.tasks.unspecified") : task.startMinutes === null
      ? end === current ? t("view.dateNav.today") : taskDurationLabel(Math.abs(end - current) / 60_000)
      : taskDurationLabel(Math.floor(Math.abs(end - current) / 60_000)),
    timeline: validCreated && scheduled && start !== null && end > start
      ? {
        elapsedDays: Math.max(0, (current - start) / 86_400_000),
        scheduledDays: (end - start) / 86_400_000,
        elapsedLabel: t("view.tasks.timeElapsed", { duration: createdElapsed }),
      }
      : null,
  };
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
