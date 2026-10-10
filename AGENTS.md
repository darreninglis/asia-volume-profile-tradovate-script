# Repository instructions

This repository is the authoritative working source for the user's native Tradovate Asia volume profile indicator.

- Source: `AsiaSessionVolumeProfile.js`.
- Private remote: https://github.com/darreninglis/asia-volume-profile-tradovate-script
- Existing unlisted Tradovate entry: https://trader.tradovate.com/?shareable=f3b9f193-031f-4554-8202-d696f1a3dcf5

## Standing user instruction

"Please use this repo for future updates and make sure any changes we're happy with are committed, pushed and published to the unlisted Tradovate version."

For every validated, accepted indicator update:

1. Work from this repository's source. Preserve calculations unless the user explicitly requests calculation changes; preserve support for 1-minute and 5-minute charts.
2. Run a syntax check and focused checks appropriate to the change. Verify the saved indicator in Tradovate on both supported chart intervals, including a reload and timeframe switching when relevant to rendering or runtime behavior.
3. Commit the accepted source and related documentation, then push to the existing private remote. Verify the remote contains the commit and identify any remaining local changes.
4. Publish that same accepted source to the existing unlisted Tradovate community entry. Keep its visibility unlisted and retain the existing installation link; do not create a duplicate listing. The user has authorized routine publication of accepted updates, so no repeated permission request is needed.
5. Verify publication succeeded and report the commit, published version or release date, and installation link. If a step fails, state the specific incomplete step and do not claim the release is complete.

GitHub pushes and Tradovate publication are separate steps. Do not promise that pushing to GitHub automatically updates Tradovate or other logins. Documentation-only changes need a commit and push, but do not need an unchanged indicator to be republished.

Do not place trades or add order execution as part of indicator maintenance.
