# 3.1.0-task.1

First release of **Wrot for Task**, based on [Wrot 3.1.0](https://github.com/villyoshioka/Wrot/releases/tag/3.1.0).

## Features

- Remaining daily note tasks panel with source links, task completion, and completion animations.
- Relative start times for tasks such as `- [ ] 09:15 test` and `- [ ] 09:15-09:30 test`, updated every minute. Time ranges use their start time.
- Timed task shortcuts and autocomplete, including Tab to enter an end time.
- Larger calendar with incomplete-task indicators and daily note previews.
- Composer focus and sidebar scrolling improvements.

## Installation

Requires **Obsidian 1.14.4 or newer**. Install this fork through BRAT using `uoFishbox/wrot-for-task`, or download `main.js`, `manifest.json`, and `styles.css` from this release and place them in your vault's plugin directory. The plugin ID remains `wrot`; this fork replaces the original Wrot installation.

Fork versions use `<upstream-version>-task.<release-number>`. For example, the next fork release based on Wrot 3.1.0 will be `3.1.0-task.2`; after merging Wrot 3.2.0, it will be `3.2.0-task.1`. Upstream tags are left available for future merges. Suffix versions are distributed through GitHub Releases/BRAT; Obsidian's built-in updater does not fully support them.
