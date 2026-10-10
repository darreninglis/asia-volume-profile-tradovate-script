# Asia Volume Profile — Tradovate

Native Tradovate custom indicator for standard **1-minute and 5-minute charts**.

`AsiaSessionVolumeProfile.js` is the indicator source maintained in this repository.

## Installation

Install the unlisted community version: [Asia Session Volume Profile - 1m / 5m](https://trader.tradovate.com/?shareable=f3b9f193-031f-4554-8202-d696f1a3dcf5).

Alternatively, import `AsiaSessionVolumeProfile.js` through the Tradovate custom-indicator Code Editor, save it, and add the indicator to a 1-minute or 5-minute chart.

The `./tools/predef` and `./tools/graphics` imports are provided by Tradovate. No additional source files or npm installation are needed. This script runs inside Tradovate, not as a standalone Node program.

## Profile behavior

- Asia/overnight session: 18:00–09:30 New York time.
- US cash session: 09:30–16:00 New York time, weekdays.
- New York daylight-saving time is handled by the script.
- Profiles use closed chart-bar OHLCV and distribute each candle's volume uniformly across its price range. Five-minute profiles are coarser approximations; the script does not reconstruct one-minute data or use native volume-at-price data.
- The newest candle is excluded until the following candle appears.
- Right-side reference labels use spacing and leader lines to reduce overlap.
- The script does not place orders or make network requests.

Tradovate's standard right-side volume profile is configured separately in chart settings.

Load history back to the session opening for a complete profile. The indicator replays supplied history when its opening timestamp changes, including newly loaded opening bars.

After changing between 1-minute and 5-minute charts, reload Tradovate. Live checks found that Tradovate can retain the previous `chartDescription.elementSize` until a reload. The script uses this documented interval metadata and does not guess an interval from gaps between sparse bars.

## Updates

This private repository is the working source for future updates. Every accepted indicator change must be validated, committed, pushed, and published to the existing unlisted Tradovate community entry, retaining the installation link above. See [AGENTS.md](AGENTS.md) for the standing release instructions.

A GitHub push does not update Tradovate by itself. Other logins install from the link above and apply available community updates.

## Validation

With Node.js and Git available, run from this repository:

```text
node --check AsiaSessionVolumeProfile.js
node tests/profile-tests.js
node tests/calculation-parity.js
node tests/history-recovery.js
```

The parity suite compares the working indicator against the pinned pre-optimization Git revision. It checks exact numeric outputs, financial/reference state and final graphics across both chart intervals, warmed-up RVOL, DST, sparse data, calendar changes and runtime history resets. It requires that revision to be available locally (use a full clone, or provide baseline/candidate file paths).

These local checks use small Tradovate API stubs. Confirm rendering and saved source in Tradovate before publishing.
