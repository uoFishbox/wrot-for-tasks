## New Features

- Clicking or tapping a task in the remaining-tasks panel now navigates to its post's date and reveals the post in the same Wrot view instead of opening the source note, including posts hidden by a tag rule and in continuous scrolling mode. Enter or Space on a focused task row does the same. Tasks written outside a Wrot post still open the corresponding line in the source note.
- Added an experimental **Use Obsidian's native editor** toggle under a new **Experimental features** settings section. Turned on, the composer embeds Obsidian's Markdown editor with Live Preview, editor commands and native link/tag completion; it applies immediately to open views and keeps the text, selection, attached image, quote and post being edited. If initialization fails, Wrot shows a notice and keeps using the existing text box.

## Improvements and Fixes

- Unset color overrides now follow the theme's CSS instead of fixed hex defaults, so themes and CSS snippets control the timeline colors until you pick your own. Each reset button clears that override so later theme changes apply.
- Moved the post and cancel buttons into the composer footer beside the toolbar.

## Changes

- The remaining-tasks and posting-form guides now document opening posts from the task list and choosing between the native and existing editors.
