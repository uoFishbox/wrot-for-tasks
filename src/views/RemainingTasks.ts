import { App, CachedMetadata, Component, Notice, TFile } from "obsidian";
import { dateForDailyNote } from "../utils/dailyNote";
import { DailyNoteTask, dailyNoteTaskStartMinutes, incompleteDailyNoteTaskEntries } from "../utils/dailyNoteTasks";
import { toggleCheckbox } from "../utils/memoWriter";
import { renderTextWithTagsAndUrls, renderUrlPreviews } from "../utils/urlRenderer";
import { renderQuoteCard } from "../utils/quoteCard";
import type WrotPlugin from "../main";
import { t } from "../i18n";

interface RemainingTask extends DailyNoteTask {
  filePath: string;
  noteDate: number;
  startMinutes: number;
}

// Compare calendar dates without time-of-day or daylight-saving offsets.
function calendarDateValue(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
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

  constructor(private app: App, container: HTMLElement, private plugin: WrotPlugin) {
    super();
    this.section = container.createEl("section", {
      cls: "wr-remaining-tasks",
      attr: { "aria-label": t("view.tasks.title") },
    });
    const header = this.section.createDiv({ cls: "wr-remaining-tasks-header" });
    header.createEl("h3", { text: t("view.tasks.title") });
    this.count = header.createSpan({ cls: "wr-remaining-tasks-count" });
    this.list = this.section.createDiv({ cls: "wr-remaining-tasks-list", attr: { role: "list" } });
  }

  onload(): void {
    this.closed = false;
    let today = calendarDateValue(new Date());
    this.registerInterval(this.section.win.setInterval(() => {
      const day = calendarDateValue(new Date());
      if (day === today) return;
      today = day;
      this.render();
    }, 60_000));
    this.registerEvent(this.app.metadataCache.on("changed", (file, content, cache) => {
      if (!dateForDailyNote(file) && !this.tasks.has(file.path)) return;
      this.bumpRevision(file.path);
      this.update(file, content, cache);
      this.queueRender();
    }));
    this.registerEvent(this.app.metadataCache.on("deleted", (file) => {
      this.remove(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.remove(oldPath);
      if (file instanceof TFile) void this.read(file).then(() => this.queueRender());
    }));
    this.render();
    void this.scan();
  }

  onunload(): void {
    this.closed = true;
    if (this.renderTimer !== null) this.section.win.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.tasks.clear();
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

  private update(file: TFile, content: string, cache: CachedMetadata | null): void {
    const date = dateForDailyNote(file);
    this.failed.delete(file.path);
    if (!date) {
      this.tasks.delete(file.path);
      return;
    }
    const entries = incompleteDailyNoteTaskEntries(content, cache).map((task) => ({
      ...task,
      filePath: file.path,
      noteDate: calendarDateValue(date.toDate()),
      startMinutes: dailyNoteTaskStartMinutes(task.text) ?? 24 * 60,
    }));
    if (entries.length > 0) this.tasks.set(file.path, entries);
    else this.tasks.delete(file.path);
  }

  private async read(file: TFile): Promise<void> {
    if (this.closed || this.app.vault.getAbstractFileByPath(file.path) !== file || !dateForDailyNote(file)) return;
    const path = file.path;
    const revision = this.bumpRevision(path);
    try {
      const content = await this.app.vault.cachedRead(file);
      if (this.closed || file.path !== path || this.revisions.get(path) !== revision) return;
      this.update(file, content, this.app.metadataCache.getFileCache(file));
    } catch (error) {
      if (this.closed || this.revisions.get(path) !== revision) return;
      this.failed.add(path);
      console.warn("Wrot: could not read remaining tasks", path, error);
    }
  }

  private async scan(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => dateForDailyNote(file));
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

  private render(): void {
    const today = calendarDateValue(new Date());
    const tasks = [...this.tasks.values()].flat().sort((a, b) =>
      Math.abs(a.noteDate - today) - Math.abs(b.noteDate - today)
      || b.noteDate - a.noteDate || a.startMinutes - b.startMinutes
      || a.filePath.localeCompare(b.filePath) || a.line - b.line
    );
    const scrollTop = this.list.scrollTop;
    this.count.setText(String(tasks.length));
    this.list.empty();
    if (this.loading || this.failed.size > 0 || tasks.length === 0) {
      this.list.createDiv({
        cls: "wr-remaining-tasks-status",
        text: t(this.loading ? "view.tasks.loading" : this.failed.size > 0 ? "view.tasks.readFailed" : "view.tasks.empty"),
      });
    }
    for (const task of tasks) {
      const row = this.list.createDiv({ cls: "wr-remaining-task", attr: { role: "listitem" } });
      const contentEl = row.createDiv({ cls: "wr-content" });
      const resolveImagePath = (fileName: string): string | null => {
        const file = this.app.metadataCache.getFirstLinkpathDest(fileName, task.filePath);
        return file ? this.app.vault.getResourcePath(file) : null;
      };
      const urls = renderTextWithTagsAndUrls(contentEl, `- [ ] ${task.text || t("view.tasks.untitled")}`, {
        onTagClick: (tag) => this.plugin.openTagSearch(tag),
        onCheckToggle: (_lineIndex, checked) => {
          const checkbox = contentEl.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (checkbox) checkbox.disabled = true;
          void this.toggleTask(task, checked).catch((error: unknown) => {
            new Notice(t("view.notice.saveFailed", { error: String(error) }));
            if (!this.closed) this.render();
          });
        },
        onInternalLinkClick: (linkName) => {
          void this.app.workspace.openLinkText(linkName, task.filePath, false);
        },
        checkStrikethrough: this.plugin.settings.checkStrikethrough,
        resolveImagePath,
        resolveLinkTarget: (linkName) => this.app.metadataCache.getFirstLinkpathDest(linkName, task.filePath) !== null,
        vaultName: this.app.vault.getName(),
        renderQuoteCard: (slot, fileName, blockId) => {
          renderQuoteCard(slot, fileName, blockId, this.app, task.filePath, {
            timestampFormat: this.plugin.settings.timestampFormat,
            resolveRuleClass: (content) => this.plugin.getTagRuleClassForContent(content),
            resolveRuleAccent: (ruleClass) => this.plugin.getRuleAccentColor(ruleClass),
            checkStrikethrough: this.plugin.settings.checkStrikethrough,
          });
        },
      });
      const previewUrls = urls.filter((url) => url.type === "image" || !url.url.startsWith("obsidian://"));
      if (previewUrls.length > 0) {
        renderUrlPreviews(row.createDiv({ cls: "wr-media-area" }), previewUrls, this.plugin.ogpCache, resolveImagePath);
      }
      const meta = row.createDiv({ cls: "wr-remaining-task-meta" });
      const link = meta.createEl("a", {
        cls: "wr-remaining-task-source",
        text: task.filePath.replace(/\.md$/i, ""),
        attr: { href: task.filePath, "aria-label": `${task.filePath}:${task.line + 1}` },
      });
      const days = (task.noteDate - today) / 86_400_000;
      meta.createSpan({
        cls: "wr-remaining-task-days",
        text: days === 0 ? t("view.dateNav.today") : t(
          days > 0 ? "view.tasks.daysRemaining" : "view.tasks.daysElapsed",
          { days: Math.abs(days) },
        ),
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.openTask(task, event.ctrlKey || event.metaKey).catch((error: unknown) => {
          new Notice(t("view.tasks.openFailed"));
          console.warn("Wrot: could not open remaining task", error);
        });
      });
    }
    this.list.scrollTop = scrollTop;
  }

  private async toggleTask(task: RemainingTask, checked: boolean): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) {
      this.remove(task.filePath);
      return;
    }
    await toggleCheckbox(this.app, file, task.line, { expectedText: task.text, checked });
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
