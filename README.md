# Asia Volume Profile — Tradovate

Native Tradovate custom indicator for standard **1-minute and 5-minute charts**.

`AsiaSessionVolumeProfile.js` is the indicator source maintained in this repository.

## Installation

Install the unlisted community version: [Asia Session Volume Profile - 1m / 5m](https://trader.tradovate.com/?shareable=f3b9f193-031f-4554-8202-d696f1a3dcf5).

Alternatively, import `AsiaSessionVolumeProfile.js` through the Tradovate custom-indicator Code Editor, save it, and add the indicator to a 1-minute or 5-minute chart.

The `./tools/predef` and `./tools/graphics` imports are provided by Tradovate. No additional source files or npm installation are needed. This script runs inside Tradovate, not as a standalone Node program.

## Profile behavior

The timeframe-recovery changes on this branch are an unpublished candidate. All 158 local checks pass, but live switching verification is blocked by a custom-loader initialization failure after refresh. Tradovate was restored to the published `f211cf8` source. Do not describe this branch as a verified refresh fix.

- Asia/overnight session: 18:00–09:30 New York time.
- US cash session: 09:30–16:00 New York time, weekdays.
- New York daylight-saving time is handled by the script.
- Profiles use closed chart-bar OHLCV and distribute each candle's volume uniformly across its price range. Five-minute profiles are coarser approximations; the script does not reconstruct one-minute data or use native volume-at-price data.
- The newest candle is excluded until the following candle appears.
- Current, prior-session, review-area and reference labels share one spaced caption lane with leader lines. Their underlying prices stay unchanged.
- A compact status remains visible with the dashboard disabled. It identifies the OHLCV estimate, chart interval, session and observed coverage; sparse prior-session or futures VWAP coverage is disclosed separately.
- The script does not place orders or make network requests.

Tradovate's standard right-side volume profile is configured separately in chart settings.

Load history back to the session opening for a complete profile. “Complete” marks the observed session boundary; any detected missing minutes are still marked “Partial.” “No gaps observed” describes the supplied bars and does not certify the data feed.

The indicator replays supplied history when its opening timestamp changes, when history is replaced or shortened, or when a revisited closed candle changes. Corrections that arrive only in the history collection are checked at the next new chart candle. Reload to check those corrections immediately. The indicator cannot recover bars Tradovate has not supplied.

Tradovate can retain the previous `chartDescription.elementSize` after changing intervals. The indicator now checks the supplied history and can recover automatically: an adjacent one-minute pair proves 1m, while three consecutive closed 5m candles must exactly match the open, high, low, close and summed volume of all five previously supplied closed 1m bars. A single previous minute-history snapshot survives the host's repeated initialization calls and is discarded when the contract changes. It is used only to verify the interval; calculations always use the current supplied bars.

Gaps alone never establish a 5m chart. If replacement history cannot be confirmed (for example, corrected volumes, insufficient overlap or missing constituent bars), the indicator displays “Waiting to confirm chart interval from closed history” and suppresses profile/VWAP outputs until there is enough evidence or corrected host metadata. No absent volume is reconstructed.

If **all custom-indicator categories disappear after a refresh**, a failure of Tradovate's shared custom-indicator loader was observed with the previous release, updated source and a minimal calculation-free control, even with all other community packages temporarily disabled. Reimporting the saved workspace did not restore it. The original source and package settings were restored. Fresh sign-ins restored the custom catalog in earlier checks, but that is not a fix for refresh reliability. An indicator cannot recover itself while the host has not loaded its code; the precise browser/platform loader cause remains unconfirmed.

## Display presets

**Custom (existing settings)** is the default and preserves the saved visibility settings. The presets change display density while keeping profile, VWAP, RVOL, ATR, context, pivot and reference calculations unchanged:

- **Essential:** current profile and the most recent completed profile with VAH, POC and VAL; hides review areas, prior-US reference lines, other references and VWAP plots.
- **Session Context:** the same profiles plus prior-US levels, review areas and the active session VWAP.
- **Full References:** all reference families, comparison VWAP and retained profile/history displays. Existing style settings and retention limits remain in effect.

Full References displays available retained history. It does not create missing data or generate historical review areas that were disabled in the underlying settings. Switch back to Custom to use the individual visibility controls.

The new preset parameter is appended after the existing parameters so saved positional indicator expressions retain their original argument order.

Review areas use neutral descriptions such as “Upper value edge,” “Holding above” and “Review.” They remain contextual display areas, not order signals. Completed histogram geometry is cached and discarded when its profile leaves retention; the developing profile is rebuilt from newly closed candles.

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
node tests/presentation-cleanup.js
```

The parity suite compares calculations against the pinned pre-optimization Git revision. It checks exact core numeric outputs, financial/reference state and unchanged optional plot values when displayed across both chart intervals, warmed-up RVOL, DST, sparse data, calendar changes and runtime history resets. Intentional presentation changes are tested separately. The pinned revisions must be available locally; use a full clone. The calculation suite also accepts explicit baseline/candidate file paths.

The presentation suite checks exact horizontal line prices/endpoints, shared caption spacing and merging, preset visibility, cache identity/eviction and quality disclosure on 1-minute and 5-minute data. Layout projections are models; they do not replace live chart checks.

These local checks use small Tradovate API stubs. Confirm rendering and saved source in Tradovate before publishing.
