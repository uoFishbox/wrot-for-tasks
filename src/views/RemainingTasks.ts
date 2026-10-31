import { App, CachedMetadata, Component, Notice, TFile } from "obsidian";
import { dateForDailyNote } from "../utils/dailyNote";
import {
  DailyNoteTask,
  dailyNoteTaskStartMinutes,
  incompleteDailyNoteTaskEntries,
} from "../utils/dailyNoteTasks";
import {
  calendarDateValue,
  remainingTaskTimeLabel,
  taskCreationDate,
  taskScheduleStatus,
  TaskSchedule,
} from "../utils/remainingTaskTime";
import { toggleCheckbox } from "../utils/memoWriter";
import {
  renderTextWithTagsAndUrls,
  renderUrlPreviews,
} from "../utils/urlRenderer";
import { renderQuoteCard } from "../utils/quoteCard";
import type WrotPlugin from "../main";
import { t } from "../i18n";

interface RemainingTask extends DailyNoteTask, TaskSchedule {
  filePath: string;
  noteDateLabel: string;
}

/** A view-local index: one initial scan, then only changed daily notes are parsed. */
export class RemainingTasks extends Component {
  private section: HTMLElement;
  private count: HTMLElement;
  private list: HTMLElement;
  private tasks = new Map<string, RemainingTask[]>();
  private revisions = new Map<string, number>();
  private closed = false;
  private loading = true;
  private failed = new Set<string>();
  private renderTimer: number | null = null;
  private completingRows = new Map<HTMLElement, number | null>();
  private sectionResizeAnimation: Animation | null = null;
  private timeLabels = new Map<HTMLElement, RemainingTask>();

  constructor(
    private app: App,
    container: HTMLElement,
    private plugin: WrotPlugin,
  ) {
    super();
    this.section = container.createEl("section", {
      cls: "wr-remaining-tasks",
      attr: { "aria-label": t("view.tasks.title") },
    });
    const header = this.section.createDiv({ cls: "wr-remaining-tasks-header" });
    header.createEl("div", { text: t("view.tasks.title") });
    this.count = header.createSpan({ cls: "wr-remaining-tasks-count" });
    this.list = this.section.createDiv({ cls: "wr-remaining-tasks-list" });
  }

  onload(): void {
    this.closed = false;
    let today = calendarDateValue(new Date());
    this.registerInterval(
      this.section.win.setInterval(() => {
        const now = new Date();
        const day = calendarDateValue(now);
        if (day === today) {
          this.updateTimeLabels(now);
          return;
        }
        today = day;
        this.render(now);
      }, 60_000),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, content, cache) => {
        if (!dateForDailyNote(file) && !this.tasks.has(file.path)) return;
        this.bumpRevision(file.path);
        this.update(file, content, cache);
        this.queueRender();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("deleted", (file) => {
        this.remove(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.remove(oldPath);
        if (file instanceof TFile)
          void this.read(file).then(() => this.queueRender());
      }),
    );
    this.render();
    void this.scan();
  }

  onunload(): void {
    this.closed = true;
    if (this.renderTimer !== null)
      this.section.win.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    for (const timer of this.completingRows.values()) {
      if (timer !== null) this.section.win.clearTimeout(timer);
    }
    this.completingRows.clear();
    this.sectionResizeAnimation?.cancel();
    this.sectionResizeAnimation = null;
    this.tasks.clear();
    this.timeLabels.clear();
    this.revisions.clear();
    this.section.remove();
  }

  private bumpRevision(path: string): number {
    const revision = (this.revisions.get(path) ?? 0) + 1;
    this.revisions.set(path, revision);
    return revision;
  }

  private remove(path: string): void {
    this.bumpRevision(path);
    const changed = this.tasks.delete(path);
    const failed = this.failed.delete(path);
    if (changed || failed) this.queueRender();
  }

  private update(
    file: TFile,
    content: string,
    cache: CachedMetadata | null,
  ): void {
    const date = dateForDailyNote(file);
    this.failed.delete(file.path);
    if (!date) {
      this.tasks.delete(file.path);
      return;
    }
    const entries = incompleteDailyNoteTaskEntries(content, cache).map(
      (task) => ({
        ...task,
        filePath: file.path,
        noteDate: calendarDateValue(date.toDate()),
        noteDateLabel: date.format("YYYY-MM-DD"),
        createdDate: taskCreationDate(task.time),
        startMinutes: dailyNoteTaskStartMinutes(task.text),
      }),
    );
    if (entries.length > 0) this.tasks.set(file.path, entries);
    else this.tasks.delete(file.path);
  }

  private async read(file: TFile): Promise<void> {
    if (
      this.closed ||
      this.app.vault.getAbstractFileByPath(file.path) !== file ||
      !dateForDailyNote(file)
    )
      return;
    const path = file.path;
    const revision = this.bumpRevision(path);
    try {
      const content = await this.app.vault.cachedRead(file);
      if (
        this.closed ||
        file.path !== path ||
        this.revisions.get(path) !== revision
      )
        return;
      this.update(file, content, this.app.metadataCache.getFileCache(file));
    } catch (error) {
      if (this.closed || this.revisions.get(path) !== revision) return;
      this.failed.add(path);
      console.warn(
        "Wrot for Tasks: could not read remaining tasks",
        path,
        error,
      );
    }
  }

  private async scan(): Promise<void> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => dateForDailyNote(file));
    // Bound disk concurrency so a large history does not monopolize the vault.
    for (let i = 0; i < files.length && !this.closed; i += 12) {
      await Promise.all(files.slice(i, i + 12).map((file) => this.read(file)));
    }
    this.loading = false;
    if (!this.closed) this.render();
  }

  private queueRender(): void {
    if (this.closed || this.renderTimer !== null) return;
    this.renderTimer = this.section.win.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 50);
  }

  private render(now = new Date()): void {
    // Metadata updates must not replace rows while their completion feedback is visible.
    if (this.closed || this.completingRows.size > 0) return;
    const today = calendarDateValue(now);
    const tasks = [...this.tasks.values()]
      .flat()
      .sort(
        (a, b) =>
          Math.abs(a.noteDate - today) - Math.abs(b.noteDate - today) ||
          b.noteDate - a.noteDate ||
          (a.startMinutes ?? 24 * 60) - (b.startMinutes ?? 24 * 60) ||
          a.filePath.localeCompare(b.filePath) ||
          a.line - b.line,
      );
    const scrollTop = this.list.scrollTop;
    this.count.setText(String(tasks.length));
    this.list.empty();
    this.timeLabels.clear();
    if (this.loading || this.failed.size > 0 || tasks.length === 0) {
      this.list.createDiv({
        cls: "wr-remaining-tasks-status",
        text: t(
          this.loading
            ? "view.tasks.loading"
            : this.failed.size > 0
              ? "view.tasks.readFailed"
              : "view.tasks.empty",
        ),
      });
    }
    const currentList = this.list.createDiv({
      cls: "wr-remaining-tasks-current",
      attr: { role: "list", "aria-label": t("view.tasks.title") },
    });
    let pastList: HTMLElement | null = null;
    if (tasks.some((task) => taskScheduleStatus(task, now) === "past")) {
      const pastSection = this.list.createEl("section", {
        cls: "wr-remaining-tasks-past",
        attr: { "aria-label": t("view.tasks.pastTitle") },
      });
      pastList = pastSection.createDiv({
        attr: { role: "list", "aria-label": t("view.tasks.pastTitle") },
      });
    }
    for (const task of tasks) {
      const status = taskScheduleStatus(task, now);
      const parent = status === "past" && pastList ? pastList : currentList;
      const row = parent.createDiv({
        cls: "wr-remaining-task",
        attr: {
          role: "listitem",
          tabindex: "0",
          "data-task-status": status,
          "aria-label": `${task.text || t("view.tasks.untitled")} (${task.filePath}:${task.line + 1})`,
        },
      });
      const openTask = (newTab: boolean): void => {
        void this.openTask(task, newTab).catch((error: unknown) => {
          new Notice(t("view.tasks.openFailed"));
          console.warn("Wrot for Tasks: could not open remaining task", error);
        });
      };
      row.addEventListener("click", (event) => {
        if (
          event.defaultPrevented ||
          (event.target as Element | null)?.closest(
            'a, button, input, label, select, textarea, [role="button"], [role="link"], [contenteditable="true"]',
          )
        )
          return;
        openTask(event.ctrlKey || event.metaKey);
      });
      row.addEventListener("keydown", (event) => {
        if (
          event.defaultPrevented ||
          event.target !== row ||
          (event.key !== "Enter" && event.key !== " ")
        )
          return;
        event.preventDefault();
        openTask(event.ctrlKey || event.metaKey);
      });
      const contentEl = row.createDiv({ cls: "wr-content" });
      const resolveImagePath = (fileName: string): string | null => {
        const file = this.app.metadataCache.getFirstLinkpathDest(
          fileName,
          task.filePath,
        );
        return file ? this.app.vault.getResourcePath(file) : null;
      };
      const urls = renderTextWithTagsAndUrls(
        contentEl,
        `- [ ] ${task.text || t("view.tasks.untitled")}`,
        {
          onTagClick: (tag) => this.plugin.openTagSearch(tag),
          onCheckToggle: (_lineIndex, checked) => {
            const checkbox = contentEl.querySelector<HTMLInputElement>(
              'input[type="checkbox"]',
            );
            if (checkbox) checkbox.disabled = true;
            if (checked) this.completingRows.set(row, null);
            void this.toggleTask(task, checked)
              .then(() => {
                if (this.closed || !checked) return;
                row.addClass("wr-remaining-task-completing");
                const timer = this.section.win.setTimeout(
                  () => this.finishCompletion(row, true),
                  450,
                );
                this.completingRows.set(row, timer);
              })
              .catch((error: unknown) => {
                new Notice(
                  t("view.notice.saveFailed", { error: String(error) }),
                );
                if (this.closed) return;
                if (checkbox) {
                  checkbox.checked = !checked;
                  checkbox.disabled = false;
                }
                contentEl
                  .querySelector(".wr-check-done")
                  ?.classList.remove("wr-check-done");
                this.finishCompletion(row, false);
              });
          },
          onInternalLinkClick: (linkName) => {
            void this.app.workspace.openLinkText(
              linkName,
              task.filePath,
              false,
            );
          },
          checkStrikethrough: this.plugin.settings.checkStrikethrough,
          resolveImagePath,
          resolveLinkTarget: (linkName) =>
            this.app.metadataCache.getFirstLinkpathDest(
              linkName,
              task.filePath,
            ) !== null,
          vaultName: this.app.vault.getName(),
          renderQuoteCard: (slot, fileName, blockId) => {
            renderQuoteCard(slot, fileName, blockId, this.app, task.filePath, {
              timestampFormat: this.plugin.settings.timestampFormat,
              resolveRuleClass: (content) =>
                this.plugin.getTagRuleClassForContent(content),
              resolveRuleAccent: (ruleClass) =>
                this.plugin.getRuleAccentColor(ruleClass),
              checkStrikethrough: this.plugin.settings.checkStrikethrough,
            });
          },
        },
      );
      const previewUrls = urls.filter(
        (url) => url.type === "image" || !url.url.startsWith("obsidian://"),
      );
      if (previewUrls.length > 0) {
        renderUrlPreviews(
          row.createDiv({ cls: "wr-media-area" }),
          previewUrls,
          this.plugin.ogpCache,
          resolveImagePath,
        );
      }
      const timeText = remainingTaskTimeLabel(task, now);
      if (timeText !== null) {
        const meta = row.createDiv({ cls: "wr-remaining-task-meta" });
        meta.createSpan({
          cls: "wr-remaining-task-source",
          text: task.noteDateLabel,
        });
        const timeLabel = meta.createSpan({
          cls: "wr-remaining-task-days",
          text: timeText,
        });
        this.timeLabels.set(timeLabel, task);
      }
    }
    this.list.scrollTop = scrollTop;
  }

  private updateTimeLabels(now: Date): void {
    if (this.closed || this.completingRows.size > 0) return;
    // Rebuild only when a row changes groups; ordinary countdown ticks keep the DOM intact.
    for (const [label, task] of this.timeLabels) {
      if (
        label
          .closest(".wr-remaining-task")
          ?.getAttribute("data-task-status") !== taskScheduleStatus(task, now)
      ) {
        this.render(now);
        return;
      }
    }
    for (const [label, task] of this.timeLabels) {
      label.setText(remainingTaskTimeLabel(task, now) ?? "");
    }
  }

  private finishCompletion(row: HTMLElement, completed: boolean): void {
    this.completingRows.delete(row);
    if (this.closed) return;
    const previousHeight = completed
      ? parseFloat(this.section.win.getComputedStyle(this.section).height)
      : 0;
    if (completed) {
      // Start from the visible height if another completion is still resizing the section.
      this.sectionResizeAnimation?.cancel();
      this.sectionResizeAnimation = null;
      const pastSection = row.closest(".wr-remaining-tasks-past");
      row.remove();
      if (pastSection && !pastSection.querySelector(".wr-remaining-task"))
        pastSection.remove();
      this.count.setText(
        String(this.list.querySelectorAll(".wr-remaining-task").length),
      );
    }
    this.render();
    if (
      !completed ||
      this.section.win.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const height = parseFloat(
      this.section.win.getComputedStyle(this.section).height,
    );
    if (
      !Number.isFinite(previousHeight) ||
      !Number.isFinite(height) ||
      height >= previousHeight
    )
      return;
    this.sectionResizeAnimation = this.section.animate(
      { height: [`${previousHeight}px`, `${height}px`] },
      { duration: 200, easing: "ease-out" },
    );
    this.sectionResizeAnimation.onfinish = () => {
      this.sectionResizeAnimation = null;
    };
  }

  private async toggleTask(
    task: RemainingTask,
    checked: boolean,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      this.remove(task.filePath);
      return;
    }
    await toggleCheckbox(this.app, file, task.line, {
      expectedText: task.text,
      checked,
    });
    await this.read(file);
    this.queueRender();
  }

  private async openTask(task: RemainingTask, newTab: boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      this.remove(task.filePath);
      return;
    }
    await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file, {
      eState: { line: task.line },
    });
  }
}
