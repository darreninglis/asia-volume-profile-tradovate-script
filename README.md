# Asia Volume Profile — Tradovate

Native Tradovate custom indicator for standard **1-minute and 5-minute charts**.

`AsiaSessionVolumeProfile.js` is the latest saved and published source, copied unchanged on 10 October 2026.

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

## Updates

This private repository stores the source and its change history. A GitHub push does not update the Tradovate community version. Publish accepted changes through Tradovate's existing community entry; other logins install from the link above and apply available community updates.
