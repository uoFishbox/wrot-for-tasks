## New Features

- Added a collapsible remaining-tasks header that snaps between the full list and a minimized one-line task-name summary when dragged, with muted task names, click and keyboard controls, and per-view workspace persistence.
- Added continuous scrolling: toggle it from the date header and the timeline keeps loading adjacent daily notes as you scroll.
- Added date-aware timestamps. When enabled, timestamps move to the bottom left and show the time alone for posts saved in their own daily note, adding the date when the post comes from a different note date or the note date is unknown.
- Composer placeholders now name the destination note ("Post to yesterday's note…", "Post to the note for 2 days from now…"), and switch to "Edit post…" while editing.
- Posts that still contain unfinished checklist items are highlighted with a subtle accent-colored tint in the timeline, Reading View, and Live Preview. Checklist examples inside code or math blocks do not count.
- Added a confirmation modal before posting incomplete tasks to past daily note dates or with start times before the current local time. Canceling preserves the draft and attachments.
- Added relative date badges and refined calendar task-dot spacing while preserving the fork's task features and calendar layout.

## Improvements and Fixes

- Merged upstream Wrot 3.2.0, including reliable timeline checkbox writes, nested-list indentation, accent-insensitive tag completion, and Obsidian 1.15 diagram colors.
- Matched the calendar popover background to the theme's secondary background.

## Changes

- Changed UI class names and CSS variables from `wr-` to `wrot-`; update custom CSS snippets to the new prefix. Memo fences and block IDs are unchanged.
