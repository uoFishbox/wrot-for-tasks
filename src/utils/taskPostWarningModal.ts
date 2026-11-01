import { App, ButtonComponent, Modal } from "obsidian";
import { t } from "../i18n";
import type { TaskPostWarning } from "./taskPostWarning";

class TaskPostWarningModal extends Modal {
  private confirmed = false;

  constructor(app: App, private warning: TaskPostWarning, private date: string, private resolve: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("view.tasks.pastWarning.title"));
    const warning = this.warning;
    const message = warning.reason === "pastDate"
      ? t("view.tasks.pastWarning.pastDate", { date: this.date })
      : t("view.tasks.pastWarning.pastTime", {
        date: this.date,
        time: `${String(Math.floor(warning.startMinutes / 60)).padStart(2, "0")}:${String(warning.startMinutes % 60).padStart(2, "0")}`,
      });
    this.contentEl.createEl("p", { text: message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = new ButtonComponent(buttons)
      .setButtonText(t("view.toolbarEdit.cancel"))
      .onClick(() => this.close());
    new ButtonComponent(buttons)
      .setButtonText(t("view.tasks.pastWarning.confirm"))
      .setCta()
      .onClick(() => {
        this.confirmed = true;
        this.close();
      });
    cancel.buttonEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.confirmed);
  }
}

export function confirmTaskPost(app: App, warning: TaskPostWarning, date: string): Promise<boolean> {
  return new Promise(resolve => new TaskPostWarningModal(app, warning, date, resolve).open());
}
