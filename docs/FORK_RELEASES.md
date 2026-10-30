# Fork releases

This fork follows `<upstream-version>-task.<release-number>` and does not claim upstream's plain version tags.

- `3.1.0-task.1`: first fork release based on Wrot 3.1.0.
- `3.1.0-task.2`: next fork release on the same upstream base.
- `3.2.0-task.1`: first fork release after merging Wrot 3.2.0.

The suffix distinguishes fork releases; it does not remove Git merge conflicts. When updating from upstream, keep the fork suffix in the version files and preserve fork-specific release workflow changes. Update this document's examples only when the policy changes.

Publish through GitHub Releases. Users install manually or through BRAT with `uoFishbox/wrot-for-task`; Obsidian's built-in updater supports only `x.y.z` versions reliably. The plugin ID remains `wrot`, so this fork replaces the original installation.

## Release procedure

1. Merge the chosen upstream version and retain the task features.
2. Set the same fork version in `manifest.json`, `package.json`, and the two root version fields in `package-lock.json`. Add its minimum Obsidian version to `versions.json`.
3. Update `RELEASE_NOTES.md` and `CHANGELOG.md`.
4. Run `npm ci`, `npm run lint`, `node --test scripts/test-*.mjs`, and `npm run build`.
5. Commit, tag with the exact version (without a `v` prefix), and push the commit and tag.
6. Verify the Release workflow succeeds and the published release contains `main.js`, `manifest.json`, and `styles.css` with the matching version.

References: [Obsidian manifest](https://docs.obsidian.md/Reference/Manifest), [BRAT developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md).
