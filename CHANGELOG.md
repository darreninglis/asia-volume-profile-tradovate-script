# Changes

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
