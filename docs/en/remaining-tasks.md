# Remaining tasks

Click or tap a task to navigate to its post's date and reveal the post in the same Wrot view. Enter or Space on a focused task row does the same. This works in both daily and continuous scrolling modes, including posts hidden by a tag rule. Tasks written outside a Wrot post open the corresponding line in the source note.

The remaining-tasks panel has two modes: the normal task list and a minimized header such as `Remaining tasks: Task 1, Task 2, …`. Only the task names use `var(--text-muted)`; the title keeps its normal color. The summary stays on one line and truncates with an ellipsis when it exceeds the available width.

On desktop, the minimized panel in the right sidebar keeps `var(--size-4-8)` of bottom padding below the header.

- Drag the header or its top border down to minimize, or up to restore. It snaps after 24 pixels of movement; small movements leave the mode unchanged.
- Click or tap the header to toggle modes.
- With the header focused, use Enter or Space to toggle, Arrow Down to minimize, or Arrow Up to restore.
- Press Escape during a drag to cancel it. Losing focus or cancelling the pointer also restores the starting mode.

The task summary keeps updating while minimized. Each view saves its mode in Obsidian's workspace layout. Snap animations respect the system's reduced-motion preference.
