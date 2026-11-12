# Unreleased

- Merged upstream Wrot 3.2.0, including reliable timeline checkbox writes, nested-list indentation, accent-insensitive tag completion, and Obsidian 1.15 diagram colors.
- Changed UI class names and CSS variables from `wr-` to `wrot-`; update custom CSS snippets to the new prefix. Memo fences and block IDs are unchanged.
- Added relative date badges and refined calendar task-dot spacing while preserving the fork's task features and calendar layout.
- Added a confirmation modal before posting incomplete tasks to past daily note dates or with start times before the current local time. Canceling preserves the draft and attachments.

---

# 3.1.0-task.3

## New Features

- Added task timing popovers on hover or mobile long press, showing elapsed time since creation, time until or since the scheduled date, and a progress timeline.
- Added date navigation and posting shortcuts: `@1d`, `@2w`, `@1m`, `@1y`, and `@today`. A trailing `-` moves backward; a shortcut with body text posts to the destination date.
- Added an `@` button to the composer toolbar.
- Added mouse-wheel date navigation over the date header.

## Improvements and Fixes

- Grouped past scheduled tasks separately and refined task ordering and schedule detection.
- Standardized task note dates as `YYYY-MM-DD`.
- Improved time suggestions during IME composition, suggestion selection, and popup positioning.
- Fixed inclusion of task timing translations in production builds.
