export const TASK_CONTROL_SELECTOR =
  'a, button, input, label, select, textarea, [role="button"], [role="link"], [contenteditable="true"]';

/** Touch/pen long presses without blocking native scrolling or ordinary taps. */
export function bindTaskLongPress(
  row: HTMLElement,
  onLongPress: () => void,
  onCancel: () => void,
): () => void {
  const doc = row.doc;
  const win = row.win;
  let press: { id: number; x: number; y: number; timer: number; opened: boolean } | null = null;
  let suppressClick = false;

  const stop = (cancelled: boolean): void => {
    const previous = press;
    press = null;
    if (previous) win.clearTimeout(previous.timer);
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onPointerCancel, true);
    doc.removeEventListener("pointerdown", onOtherPointer, true);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("blur", onBlur);
    if (cancelled && previous?.opened) onCancel();
  };
  const open = (): void => {
    if (press?.opened || suppressClick) return;
    if (!row.isConnected) {
      stop(true);
      return;
    }
    if (press) {
      win.clearTimeout(press.timer);
      press.opened = true;
    }
    suppressClick = true;
    onLongPress();
  };
  const onMove = (event: PointerEvent): void => {
    if (press?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) stop(true);
  };
  const onUp = (event: PointerEvent): void => {
    if (press?.id !== event.pointerId) return;
    if (press.opened) event.preventDefault();
    stop(false);
  };
  const onPointerCancel = (event: PointerEvent): void => {
    // Some mobile browsers cancel the pointer when their contextmenu fires.
    // A popover already opened by the hold must survive that cancellation.
    if (press?.id === event.pointerId) stop(false);
  };
  const onOtherPointer = (event: PointerEvent): void => {
    if (press?.id !== event.pointerId) stop(true);
  };
  const onScroll = (): void => stop(true);
  const onBlur = (): void => stop(true);
  const onDown = (event: PointerEvent): void => {
    stop(true);
    suppressClick = false;
    if (
      event.defaultPrevented || !event.isPrimary || event.button !== 0 ||
      (event.pointerType !== "touch" && event.pointerType !== "pen") ||
      (event.target as Element | null)?.closest(TASK_CONTROL_SELECTOR)
    ) return;
    press = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      timer: win.setTimeout(open, 500), opened: false,
    };
    doc.addEventListener("pointermove", onMove, { capture: true, passive: true });
    doc.addEventListener("pointerup", onUp, true);
    doc.addEventListener("pointercancel", onPointerCancel, true);
    doc.addEventListener("pointerdown", onOtherPointer, true);
    doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
    win.addEventListener("blur", onBlur);
  };
  const onClick = (event: MouseEvent): void => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onContextMenu = (event: MouseEvent): void => {
    if ((event.target as Element | null)?.closest(TASK_CONTROL_SELECTOR)) return;
    event.preventDefault();
    // Native long-press context menus may arrive before or after pointercancel.
    open();
  };
  row.addEventListener("pointerdown", onDown);
  row.addEventListener("click", onClick, true);
  row.addEventListener("contextmenu", onContextMenu);
  return () => {
    stop(true);
    row.removeEventListener("pointerdown", onDown);
    row.removeEventListener("click", onClick, true);
    row.removeEventListener("contextmenu", onContextMenu);
  };
}
