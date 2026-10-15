# Changes

## 2026-10-15 — Presentation and data-quality cleanup

- Add Custom, Essential, Session Context and Full References display presets. Custom remains the compatibility default; presets change visibility without changing calculations.
- Append the preset parameter after all existing parameters to preserve saved positional indicator expressions.
- Merge current, prior-session, review-area and reference captions in one lane with pixel spacing and leader lines, retaining exact line and area prices.
- Use ASCII caption/status separators for consistent font rendering, add high-opacity label backgrounds, and raise caption/status text above its backgrounds with an explicit foreground layer.
- Replace directional review-area questions with neutral context labels.
- Keep a compact estimated-OHLCV/session/coverage status visible without the dashboard, including missing history, invalid input and sparse prior-US or futures VWAP coverage.
- Cache immutable completed-profile histogram geometry and evict expired profiles; keep developing geometry current.
- Centralize settings normalization and format parameter definitions for maintenance while retaining existing keys and defaults.
- Replay corrections to revisited closed bars and audit supplied closed history once per new live candle. Corrections supplied only through history are therefore checked at the next new candle; unavailable history and stale host interval metadata still require the documented recovery steps.
- Add presentation checks for shared captions, exact line geometry, presets, cache reuse/retention and 1-minute/5-minute quality status. Extend calculation and history-recovery coverage.
- Preserve the existing closed-bar OHLCV allocation, profile, VWAP, RVOL, ATR, pivot and context formulas. Native volume-at-price remains unimplemented.
- Validation: 138 checks pass, including exact calculation parity across 85,152 historical bars. The saved source rendered on live NQZ6 1-minute and 5-minute charts; Session Context and the separate native day volume profile were checked together. Tradovate's stale interval metadata after switching and intermittent loss of all custom indicators after refresh remain host limitations. Fresh chart instances/sign-ins restored the tested views; README documents these limits.
- Document the observed shared custom-indicator loader failure after refresh, including reproduction with the previous release and one successful fresh-sign-in recovery; this is not a guaranteed fix.

## 2026-10-10 — Performance and history recovery

- Rebuild when Tradovate replaces chart history with a shorter set, preventing stale profiles and outputs.
- Rebuild when the supplied history opening timestamp changes, even if the latest sequence/timestamp still matches.
- Cache one year's New York DST boundaries and reuse calendar conversions within each closed bar.
- Remove temporary RVOL arrays while retaining the original addition order.
- Reuse the same zone-width helper for current and historical display areas; reuse dashboard time conversion.
- Remove duplicate price/volume validation after the existing closed-bar input guard.
- Preserve profile, VWAP, RVOL, ATR, pivot and reference calculations, settings and chart appearance.
- Add reproducible profile and calculation-parity checks. Exact parity was checked across 85,152 historical bars on 1-minute and 5-minute charts; shorter/replaced-history cases match a fresh calculation.
- Document the live Tradovate limitation that interval metadata can remain stale after switching timeframes; a page reload supplies the correct interval. Sparse gaps are never used to guess the chart interval.
