import { t } from "../i18n";

// Compare calendar dates without time-of-day or daylight-saving offsets.
export function calendarDateValue(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Timed tasks count from their start on the daily note's local calendar date. */
export function remainingTaskTimeLabel(noteDate: number, startMinutes: number | null, now: Date): string {
  if (startMinutes !== null) {
    const day = new Date(noteDate);
    const start = new Date(
      day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
      Math.floor(startMinutes / 60), startMinutes % 60,
    );
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    const difference = Math.round((start.getTime() - currentMinute.getTime()) / 60_000);
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
  const days = (noteDate - calendarDateValue(now)) / 86_400_000;
  return days === 0 ? t("view.dateNav.today") : t(
    days > 0 ? "view.tasks.daysRemaining" : "view.tasks.daysElapsed",
    { days: Math.abs(days) },
  );
}
