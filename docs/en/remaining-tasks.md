# Remaining tasks

The remaining-tasks panel has two modes: the normal task list and a minimized header such as `Remaining tasks: Task 1, Task 2, …`. Only the task names use `var(--text-muted)`; the title keeps its normal color. The summary stays on one line and truncates with an ellipsis when it exceeds the available width.

On desktop, the minimized panel in the right sidebar keeps `var(--size-4-8)` of bottom padding below the header.

- Drag the header or its top border down to minimize, or up to restore. It snaps after 24 pixels of movement; small movements leave the mode unchanged.
- Click or tap the header to toggle modes.
- With the header focused, use Enter or Space to toggle, Arrow Down to minimize, or Arrow Up to restore.
- Press Escape during a drag to cancel it. Losing focus or cancelling the pointer also restores the starting mode.

The task summary keeps updating while minimized. Each view saves its mode in Obsidian's workspace layout. Snap animations respect the system's reduced-motion preference.
