import { App, CachedMetadata, HoverParent, TFile, setIcon } from "obsidian";
import { CALENDAR_HOVER_SOURCE } from "../constants";
import { t } from "../i18n";
import { dailyNotePathFor } from "./dailyNote";
import { incompleteDailyNoteTasks } from "./dailyNoteTasks";

declare const moment: typeof import("moment");

type Moment = ReturnType<typeof moment>;

interface CalendarPopoverOptions {
  app: App;
  // Element the popover aligns to (the calendar button).
  anchor: HTMLElement;
  // Element whose right edge the popover's right edge meets, when that is not the anchor's.
  // A button sitting wherever a row of others happens to end is not where the eye expects a
  // panel of this width to stop; the form around it is.
  alignTo?: HTMLElement;
  // Parent that actually hosts the popover (view body = wr-container). Placed inside
  // the anchor it would overflow the sidebar when the button sits at the right edge.
  container: HTMLElement;
  // Date used for the initial view and the selected-day highlight.
  initialDate: Moment;
  // Earliest selectable day. Days before it render greyed out and do not respond.
  minDate?: Moment;
  // Called with the tapped day as a moment at 00:00.
  onSelect: (date: Moment) => void;
  // Cleanup, called on any close (select, outside click, Esc).
  onClose: () => void;
}

export interface CalendarPopoverHandle {
  close: () => void;
  // The popover is placed against the anchor's position at the time. Call this after
  // moving the anchor — scrolling the list under it — to place it again.
  reposition: () => void;
  // The popover element itself, for a caller that needs to measure where it landed.
  el: HTMLElement;
}

const GRID_CELLS = 6 * 7; // fixed 6 weeks so the height never changes per month

function createTaskDot(container: HTMLElement): void {
  const svg = container.createSvg("svg", {
    cls: "wr-calendar-task-dot",
    attr: {
      // Leave space around the stroke so subpixel rendering cannot clip its edge.
      viewBox: "-1 -1 12 12",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "aria-hidden": "true",
      focusable: "false",
    },
  });
  svg.createSvg("circle", { attr: { cx: "5", cy: "5", r: "4" } });
}

// Custom calendar popover for jumping to a date. Replaces the OS input[type=date]
// picker for a consistent look on all platforms; date math uses Obsidian's bundled moment.
export function openCalendarPopover(
  opts: CalendarPopoverOptions
): CalendarPopoverHandle {
  const { app, anchor, alignTo, container, initialDate, minDate, onSelect, onClose } = opts;

  // Month being shown, normalized to its first day.
  let viewMonth = initialDate.clone().startOf("month");

  const popover = container.createDiv({ cls: "wr-calendar-popover" });

  // Place below the button, inside the container: right edge aligns to the anchor
  // but is clamped so it never crosses the container's left edge.
  const GAP = 4;
  const EDGE = 8; // min margin from container edges
  const positionPopover = () => {
    const a = anchor.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    // If wider than the container, shrink the popover itself; cells stretch via CSS grid.
    popover.style.maxWidth = `${c.width - EDGE * 2}px`;
    const w = popover.offsetWidth;
    const top = a.bottom - c.top + GAP;
    const maxLeft = c.width - w - EDGE;
    const rightEdge = alignTo ? alignTo.getBoundingClientRect().right : a.right;
    let left = rightEdge - c.left - w;
    if (left > maxLeft) left = maxLeft;
    if (left < EDGE) left = EDGE;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  };
  // Don't let clicks bubble to the anchor: its toggle handler would see "already
  // open → close", so pressing a nav arrow would close the popover.
  popover.addEventListener("click", (e) => e.stopPropagation());

  // Display modes: month grid or year list. The month label toggles year mode;
  // picking a year returns to month mode (year jumps, month/day preserved).
  type Mode = "month" | "year";
  let mode: Mode = "month";
  const YEARS_PER_PAGE = 12; // years per page in year mode (fits the grid)

  const header = popover.createDiv({ cls: "wr-calendar-header" });
  const prevBtn = header.createEl("button", { cls: "wr-calendar-nav-btn" });
  setIcon(prevBtn, "chevron-left");
  // The month label is a button: pressing it opens year mode.
  const monthLabel = header.createEl("button", { cls: "wr-calendar-month-label" });
  const nextBtn = header.createEl("button", { cls: "wr-calendar-nav-btn" });
  setIcon(nextBtn, "chevron-right");

  const weekdaysRow = popover.createDiv({ cls: "wr-calendar-weekdays" });
  const grid = popover.createDiv({ cls: "wr-calendar-grid" });

  let closed = false;
  const hoverParent: HoverParent = { hoverPopover: null };
  const closePreview = () => {
    const preview = hoverParent.hoverPopover;
    hoverParent.hoverPopover = null;
    preview?.unload();
    preview?.hoverEl.remove();
  };
  interface TaskCells {
    cells: HTMLElement[];
    revision: number;
  }
  // Paths also cover missing notes so creating a daily note updates the open calendar.
  const taskCells = new Map<string, TaskCells>();

  const showTasks = (entry: TaskCells, tasks: string[]) => {
    for (const cell of entry.cells) {
      cell.querySelector(".wr-calendar-task-dots")?.remove();
      const labels: string[] = [];
      if (tasks.length > 0) {
        const dots = cell.createSpan({
          cls: "wr-calendar-task-dots",
          attr: { "aria-hidden": "true" },
        });
        createTaskDot(dots);
        labels.push(t("calendar.tasks.incomplete"));
        labels.push(...tasks.map((task) => `- ${task}`));
      }
      const label = [cell.getAttr("data-date"), ...labels].join("\n");
      cell.setAttr("aria-label", label);
    }
  };

  const onNoteChanged = (file: TFile, content: string, cache: CachedMetadata) => {
    const entry = taskCells.get(file.path);
    if (!entry) return;
    entry.revision++;
    showTasks(entry, incompleteDailyNoteTasks(content, cache));
  };
  const changedRef = app.metadataCache.on("changed", onNoteChanged);
  const deletedRef = app.metadataCache.on("deleted", (file) => {
    const entry = taskCells.get(file.path);
    if (!entry) return;
    entry.revision++;
    showTasks(entry, []);
  });
  const renameRef = app.vault.on("rename", (file, oldPath) => {
    if (taskCells.has(oldPath) || taskCells.has(file.path)) render();
  });

  const close = () => {
    if (closed) return;
    closed = true;
    closePreview();
    taskCells.clear();
    app.metadataCache.offref(changedRef);
    app.metadataCache.offref(deletedRef);
    app.vault.offref(renameRef);
    activeDocument.removeEventListener("pointerdown", onOutside, true);
    activeDocument.removeEventListener("keydown", onKeydown, true);
    popover.remove();
    onClose();
  };

  // Close on outside press. Captured early, so exclude inside targets to avoid
  // closing before a day cell's click lands.
  const onOutside = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (target && (popover.contains(target) || anchor.contains(target) ||
      hoverParent.hoverPopover?.hoverEl.contains(target))) {
      return;
    }
    close();
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  // Week start follows locale (e.g. ja = Sunday, most of Europe = Monday).
  const weekStart = moment.localeData().firstDayOfWeek();
  const weekdaysMin = moment.localeData().weekdaysMin(); // 7 entries, Sunday-first

  const renderWeekdays = () => {
    weekdaysRow.empty();
    for (let i = 0; i < 7; i++) {
      const dow = (weekStart + i) % 7;
      weekdaysRow.createSpan({
        cls: "wr-calendar-weekday",
        text: weekdaysMin[dow],
      });
    }
  };

  const renderMonth = () => {
    closePreview();
    taskCells.clear();
    monthLabel.setText(viewMonth.format(t("calendar.monthYearFormat")));
    weekdaysRow.setCssStyles({ display: "" });
    grid.removeClass("wr-calendar-grid-years");
    grid.empty();

    const today = moment();
    const monthStart = viewMonth.clone().startOf("month");
    // Days to rewind so the grid starts on the locale's first weekday.
    const lead = (monthStart.day() - weekStart + 7) % 7;
    const gridStart = monthStart.clone().subtract(lead, "day");

    for (let i = 0; i < GRID_CELLS; i++) {
      const day = gridStart.clone().add(i, "day");
      const cell = grid.createEl("button", {
        cls: "wr-calendar-day",
        text: String(day.date()),
        attr: { "data-date": day.format("YYYY-MM-DD"), "aria-label": day.format("YYYY-MM-DD") },
      });
      const path = dailyNotePathFor(day);
      cell.addEventListener("mouseenter", (event) => {
        // Resolve on every hover so notes created or removed while open are respected.
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        app.workspace.trigger("hover-link", {
          event,
          source: CALENDAR_HOVER_SOURCE,
          hoverParent,
          targetEl: cell,
          linktext: file.path,
          sourcePath: "",
        });
      });
      let entry = taskCells.get(path);
      if (!entry) {
        entry = { cells: [], revision: 0 };
        taskCells.set(path, entry);
      }
      entry.cells.push(cell);
      if (!day.isSame(viewMonth, "month")) {
        cell.addClass("wr-calendar-day-outside");
      }
      if (day.isSame(today, "day")) {
        cell.addClass("wr-calendar-day-today");
      }
      if (day.isSame(initialDate, "day")) {
        cell.addClass("wr-calendar-day-selected");
      }
      if (minDate && day.isBefore(minDate, "day")) {
        cell.addClass("wr-calendar-day-disabled");
        continue;
      }
      cell.addEventListener("click", () => {
        onSelect(day.clone().startOf("day"));
        close();
      });
    }

    for (const [path, entry] of taskCells) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const revision = entry.revision;
      void app.vault.cachedRead(file).then((content) => {
        // Ignore reads overtaken by edits, month navigation, renames or closing.
        if (closed || taskCells.get(path) !== entry || entry.revision !== revision) return;
        showTasks(entry, incompleteDailyNoteTasks(content, app.metadataCache.getFileCache(file)));
      }).catch((error: unknown) => {
        console.warn("Wrot for Tasks: could not read calendar tasks", path, error);
      });
    }
  };

  // Year mode: the page of years containing viewMonth's year.
  const renderYears = () => {
    closePreview();
    taskCells.clear();
    const today = moment();
    const cur = viewMonth.year();
    // Page start year such that viewMonth's year falls within the page.
    const start = cur - (((cur % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);
    monthLabel.setText(`${start} – ${start + YEARS_PER_PAGE - 1}`);
    weekdaysRow.setCssStyles({ display: "none" });
    grid.addClass("wr-calendar-grid-years");
    grid.empty();

    for (let i = 0; i < YEARS_PER_PAGE; i++) {
      const year = start + i;
      const cell = grid.createEl("button", {
        cls: "wr-calendar-year",
        text: String(year),
      });
      // Prevent the focus move: after returning to month mode, focus would land on a
      // re-rendered day cell and leave a faint highlight.
      cell.addEventListener("pointerdown", (e) => e.preventDefault());
      if (year === today.year()) {
        cell.addClass("wr-calendar-day-today");
      }
      // Highlight the year currently being viewed in the calendar.
      if (year === viewMonth.year()) {
        cell.addClass("wr-calendar-day-selected");
      }
      // A year that ends before the earliest selectable day holds nothing that can be
      // picked, so it is out of reach here the same way those days are in month mode.
      if (minDate && year < minDate.year()) {
        cell.addClass("wr-calendar-day-disabled");
        continue;
      }
      cell.addEventListener("click", () => {
        viewMonth = viewMonth.clone().year(year);
        mode = "month";
        render();
        positionPopover();
      });
    }
  };

  // Nothing before minDate can be picked, so the previous page is not offered once
  // the current one already holds the earliest selectable day.
  const atEarliestPage = () => {
    if (!minDate) return false;
    if (mode === "year") {
      const cur = viewMonth.year();
      const start = cur - (((cur % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);
      return start <= minDate.year();
    }
    return !viewMonth.isAfter(minDate, "month");
  };

  const render = () => {
    if (mode === "year") renderYears();
    else renderMonth();
    prevBtn.disabled = atEarliestPage();
  };

  // Pressing an arrow briefly moves focus arrow → anchor, flashing Obsidian's focus
  // background; preventDefault on pointerdown stops the focus move entirely.
  prevBtn.addEventListener("pointerdown", (e) => e.preventDefault());
  nextBtn.addEventListener("pointerdown", (e) => e.preventDefault());
  monthLabel.addEventListener("pointerdown", (e) => e.preventDefault());

  // Arrows page by month in month mode, by YEARS_PER_PAGE years in year mode.
  prevBtn.addEventListener("click", () => {
    const unit = mode === "year" ? YEARS_PER_PAGE : 1;
    viewMonth = viewMonth.clone().subtract(unit, mode === "year" ? "year" : "month");
    render();
  });
  nextBtn.addEventListener("click", () => {
    const unit = mode === "year" ? YEARS_PER_PAGE : 1;
    viewMonth = viewMonth.clone().add(unit, mode === "year" ? "year" : "month");
    render();
  });

  monthLabel.addEventListener("click", () => {
    mode = mode === "year" ? "month" : "year";
    render();
    positionPopover();
  });

  renderWeekdays();
  render();
  positionPopover();

  activeDocument.addEventListener("pointerdown", onOutside, true);
  activeDocument.addEventListener("keydown", onKeydown, true);

  return { close, reposition: positionPopover, el: popover };
}
