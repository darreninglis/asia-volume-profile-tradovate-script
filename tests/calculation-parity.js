// Independent deterministic parity checks for calculation-preserving changes.
// Usage from the repository: node tests/calculation-parity.js [baseline.js candidate.js]
// Defaults compare the pinned pre-optimization Git revision with the working script.
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const path = require('path'), {execFileSync} = require('child_process');
const repositoryRoot = path.resolve(__dirname, '..');
const baselineRevision = '9e27517baa116158f47e0f0b93502c9233cee1c9';
const baselinePath = process.argv[2] ? path.resolve(process.argv[2]) : baselineRevision + ':AsiaSessionVolumeProfile.js';
const candidatePath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repositoryRoot, 'AsiaSessionVolumeProfile.js');
const baselineSource = process.argv[2] ? undefined : execFileSync('git', ['show', baselinePath], {cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024});
const MIN = 60000;
function load(filename, source) {
    const specs = new Proxy({}, {get: (_, key) => key === 'enum' ? (values, value) => ({def: value}) : value => ({def: value})});
    const predef = {paramSpecs: specs, plotters: new Proxy({}, {get: () => (...args) => args}), styles: new Proxy({}, {get: () => (...args) => args})};
    const graphics = {du: value => ({unit: 'du', value}), px: value => ({unit: 'px', value}), op: (left, operator, right) => ({left, operator, right})};
    const box = {module: {exports: {}}, require: name => {
        if (name === './tools/predef') return predef;
        if (name === './tools/graphics') return graphics;
        throw Error('Unexpected dependency ' + name);
    }, console, Date, Intl, Number, Math, Object, Array, String, Map, Set};
    vm.runInNewContext((source === undefined ? fs.readFileSync(filename, 'utf8') : source) + '\nmodule.exports.__test = {ny};', box, {filename});
    return box.module.exports;
}
const baselineModule = load(baselinePath, baselineSource), candidateModule = load(candidatePath);
function make(module, interval, overrides) {
    const calc = new module.calculator();
    calc.props = {...Object.fromEntries(Object.entries(module.params).map(([key, spec]) => [key, spec.def])), ...overrides};
    calc.contractInfo = {tickSize: .25, product: 'NQ', contract: 'NQZ6'};
    calc.chartDescription = {underlyingType: 'MinuteBar', elementSize: interval, elementSizeUnit: 'UnderlyingUnits'};
    calc.init(); return calc;
}
function trackResets(calc) {
    let resets = 0; const init = calc.init.bind(calc);
    calc.init = function() {resets++; return init();};
    return () => resets;
}
const nyClock = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
function input(start, days, interval, negative = false, sparse = false) {
    const result = [], begin = Date.parse(start), end = begin + days * 86400000;
    for (let t = begin; t < end; t += interval * MIN) {
        const parts = Object.fromEntries(nyClock.formatToParts(t).map(p => [p.type, p.value]));
        const minute = (+parts.hour % 24) * 60 + +parts.minute, weekday = parts.weekday;
        if (weekday === 'Sat' || weekday === 'Sun' && minute < 1080 || weekday === 'Fri' && minute >= 1020 || minute >= 1020 && minute < 1080 || minute >= 975 && minute < 990) continue;
        const i = result.length, elapsed = Math.round((t - begin) / MIN);
        if (sparse && elapsed % 701 === 1) continue;
        const center = (negative ? -100 : 25200) + ((elapsed * 17) % 61 - 30) * .25;
        const o = center + (i % 7 - 3) * .25, c = center + (i % 5 - 2) * .25;
        const low = Math.min(o, c) - (i % 11) * .25, high = Math.max(o, c) + (i % 13) * .25;
        result.push({t, index: i, o, c, l: low, h: high, v: i % 47 === 0 ? 0 : 1 + (elapsed * 37) % 1031});
    }
    return result;
}
function entity(b, last) {return {timestamp: () => new Date(b.t), index: () => b.index, open: () => b.o, high: () => b.h, low: () => b.l, close: () => b.c, volume: () => b.v, isLast: () => !!last};}
function run(calc, bars, catchup, captureValues = false) {
    const history = {get: i => bars[i] ? entity(bars[i], i === bars.length - 1) : undefined, size: () => bars.length};
    const hash = crypto.createHash('sha256'), stateHash = crypto.createHash('sha256');
    const series = captureValues ? [] : undefined;
    let last, previousSession, rvolOutputs = 0;
    const indices = catchup ? [bars.length - 1] : bars.map((_, i) => i);
    for (const i of indices) {
        last = calc.map(entity(bars[i], i === bars.length - 1), i, history);
        if (Number.isFinite(last.sessionRVOL)) rvolOutputs++;
        hash.update(numericOutput(last) + '\n');
        if (series) series.push(JSON.parse(numericOutput(last)));
        // Full state snapshots at session transitions and regular checkpoints
        // protect intermediate financial/reference state as well as final state.
        // The stride keeps long-history verification practical without hashing
        // all retained session-volume arrays after every single candle.
        const currentSession = calc.active && calc.active.key;
        if (currentSession !== previousSession || i % 257 === 0 || i === bars.length - 1) stateHash.update(financialState(calc) + '\n');
        previousSession = currentSession;
    }
    const cache = last.graphics && last.graphics.items;
    const total = calc.active && calc.active.total;
    for (let repeat = 0; repeat < 5; repeat++) {
        const live = {...bars[bars.length - 1], v: 999999 + repeat};
        const repeated = calc.map(entity(live, true), live.index, history);
        assert.strictEqual(repeated.graphics.items, cache, 'Repeated live updates must reuse drawing objects');
        assert.equal(calc.active && calc.active.total, total, 'Repeated current bars must not accumulate');
    }
    return {hash: hash.digest('hex'), stateHash: stateHash.digest('hex'), values: numericOutput(last), output: JSON.stringify(last), state: financialState(calc), rvolOutputs, series};
}
function numericOutput(output) {
    const {graphics, ...values} = output;
    return JSON.stringify(values);
}
function financialState(calc) {
    const keys = ['minutes', 'duration', 'tick', 'step', 'active', 'completed', 'prior', 'lastValidUS', 'previous', 'processed', 'future', 'fpv', 'fvol', 'fgood', 'fAbsent', 'above', 'below', 'context', 'area', 'tests', 'testsCovered', 'baselines', 'pocHistory', 'atr', 'trCount', 'trSum', 'snapshot', 'inputWarning'];
    const state = Object.fromEntries(keys.map(key => [key, calc[key]]));
    state.references = Object.fromEntries(['periods', 'ranges', 'previousBar', 'monday', 'week', 'zoneHistory', 'historyKeys'].map(key => [key, calc.references[key]]));
    return JSON.stringify(state);
}
let passed = 0, failed = 0, barsChecked = 0;
function test(name, fn) {try {fn(); passed++; console.log('PASS ' + name);} catch (error) {failed++; console.error('FAIL ' + name + ': ' + error.message);}}
test('NY calendar optimization preserves DST edges and agrees with independent Intl clock', () => {
    const formatter = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    for (const year of [2007, 2012, 2024, 2026, 2027, 2030, 2099]) for (const month of [0, 2, 10, 11]) {
        const begin = Date.UTC(year, month, 1), end = Date.UTC(year, month + 1, 1);
        for (let t = begin; t < end; t += 15 * MIN) {
            const expected = Object.fromEntries(formatter.formatToParts(t).map(part => [part.type, part.value]));
            const before = baselineModule.__test.ny(t), after = candidateModule.__test.ny(t);
            assert.equal(JSON.stringify(after), JSON.stringify(before));
            assert.equal(after.y, +expected.year); assert.equal(after.m, +expected.month); assert.equal(after.d, +expected.day);
            assert.equal(after.minute, (+expected.hour % 24) * 60 + +expected.minute);
        }
    }
});
test('Consolidated settings preserve previous defaults and numeric bounds', () => {
    const previousKeys = Object.keys(baselineModule.params), currentKeys = Object.keys(candidateModule.params);
    assert.deepStrictEqual(currentKeys.slice(0, previousKeys.length), previousKeys, 'Existing parameter positions must remain compatible with saved Tradovate expressions');
    for (const [key, spec] of Object.entries(baselineModule.params)) {
        assert.deepStrictEqual(candidateModule.params[key].def, spec.def, `${key}: public default changed`);
    }
    const bounded = ['ticksPerRow', 'valueAreaPercent', 'completedProfiles', 'rvolLookback', 'rvolMinSamples', 'historySessions', 'pocLookback', 'acceptBars', 'areaExtension', 'labelOffset', 'histogramWidth', 'referenceAnchorBars', 'referenceLabelBars', 'referenceLineWidth', 'areaTransparency', 'maxPriorAgeDays'];
    const cases = [{}, Object.fromEntries(Object.keys(baselineModule.params).map(key => [key, undefined]))];
    for (const value of [NaN, Infinity, -Infinity, 'invalid', null, -100, 3.75, 100000]) cases.push(Object.fromEntries(bounded.map(key => [key, value])));
    for (const overrides of cases) {
        const before = make(baselineModule, 1, overrides), after = make(candidateModule, 1, overrides);
        for (const [key, value] of Object.entries(before.props)) assert.deepStrictEqual(after.props[key], value, `${key}: normalized setting differs`);
        assert.equal(after.tick, before.tick);
        assert.equal(after.step, before.step);
    }
});
const scenarios = [
    {name: 'multiple RVOL/retention sessions', start: '2026-10-04T22:00:00Z', days: 24},
    {name: 'spring DST and sparse history', start: '2026-03-01T23:00:00Z', days: 12, sparse: true},
    {name: 'fall DST and negative prices', start: '2026-10-25T22:00:00Z', days: 12, negative: true},
    {name: 'year/month/quarter reference turnover', start: '2026-12-20T23:00:00Z', days: 18},
];
for (const interval of [1, 5]) for (const scenario of scenarios) {
    const bars = input(scenario.start, scenario.days, interval, scenario.negative, scenario.sparse);
    const overrides = {rvolLookback: 5, rvolMinSamples: 5, completedProfiles: 2, historySessions: 3, showDashboard: true, showDeveloping: true, adaptiveWidth: true, useLastFullUS: true, rangeTimezone: scenario.negative ? 'Asia/Tokyo' : scenario.sparse ? 'Europe/London' : 'America/Chicago'};
    test(`${interval}m ${scenario.name} exact sequential numeric outputs and financial/reference state`, () => {
        const before = run(make(baselineModule, interval, overrides), bars, false), after = run(make(candidateModule, interval, overrides), bars, false);
        assert.equal(after.hash, before.hash, 'Per-bar numeric output differs');
        // Presentation changes are intentional. Compare all exported numeric
        // values with the old release; compare graphics against a fresh run of
        // the candidate below so replay/reset equivalence remains enforced.
        assert.equal(after.values, before.values, 'Last-bar numeric output differs');
        assert.equal(after.stateHash, before.stateHash, 'Intermediate financial/reference state differs');
        assert.equal(after.state, before.state, 'Financial/reference state differs');
        if (scenario.name === 'multiple RVOL/retention sessions') assert.ok(after.rvolOutputs > 0, 'Scenario must exercise warmed-up RVOL calculations');
        barsChecked += bars.length;
    });
    test(`${interval}m ${scenario.name} catch-up matches sequential final state`, () => {
        const sequential = run(make(candidateModule, interval, overrides), bars, false), caught = run(make(candidateModule, interval, overrides), bars, true);
        assert.equal(caught.output, sequential.output, 'Catch-up last output differs');
        assert.equal(caught.state, sequential.state, 'Catch-up financial/reference state differs');
    });
}
for (const interval of [1, 5]) test(`${interval}m display presets preserve every calculation and retained reference history`, () => {
    assert.equal(candidateModule.params.displayPreset.def, 'custom', 'Existing settings must remain the default');
    const bars = input('2026-10-04T22:00:00Z', 8, interval);
    const overrides = {rvolLookback: 5, rvolMinSamples: 5, showDeveloping: true, showVWAP: true, showFuturesComparison: true, showHistory: true};
    const before = run(make(candidateModule, interval, {...overrides, displayPreset: 'custom'}), bars, false, true);
    const optionalPlots = new Set(['vwap', 'futuresVWAP', 'devVAH', 'devPOC', 'devVAL']);
    const core = values => Object.fromEntries(Object.entries(values).filter(([key]) => !optionalPlots.has(key)));
    for (const preset of ['essential', 'context', 'full']) {
        const after = run(make(candidateModule, interval, {...overrides, displayPreset: preset}), bars, false, true);
        assert.equal(after.stateHash, before.stateHash, `${preset}: intermediate financial/reference state differs`);
        assert.equal(after.state, before.state, `${preset}: final financial/reference state differs`);
        assert.equal(after.series.length, before.series.length);
        after.series.forEach((values, i) => {
            assert.deepStrictEqual(core(values), core(before.series[i]), `${preset}: core numeric output differs at bar ${i}`);
            for (const key of optionalPlots) if (Object.hasOwn(values, key)) {
                assert.strictEqual(values[key], before.series[i][key], `${preset}: ${key} value differs at bar ${i}`);
            }
        });
    }
});
for (const [from, to] of [[1, 5], [5, 1]]) test(`${from}m to ${to}m reset preserves fresh-target state and graphics`, () => {
    const before = make(baselineModule, from, {}), after = make(candidateModule, from, {});
    const oldBars = input('2026-10-04T22:00:00Z', 3, from), targetBars = input('2026-10-04T22:00:00Z', 3, to);
    run(before, oldBars, false); run(after, oldBars, false);
    before.chartDescription.elementSize = to; after.chartDescription.elementSize = to;
    const expected = run(before, targetBars, true), actual = run(after, targetBars, true), fresh = run(make(candidateModule, to, {}), targetBars, true);
    assert.equal(actual.values, expected.values); assert.equal(actual.state, expected.state);
    assert.equal(actual.output, fresh.output); assert.equal(actual.state, fresh.state);
});
for (const interval of [1, 5]) test(`${interval}m history prepend/reindex reset preserves fresh state and graphics`, () => {
    const bars = input('2026-10-04T22:00:00Z', 3, interval), short = bars.slice(30 / interval).map((b, index) => ({...b, index}));
    const before = make(baselineModule, interval, {}), after = make(candidateModule, interval, {});
    run(before, short, false); run(after, short, false);
    const expected = run(before, bars, false), actual = run(after, bars, false), fresh = run(make(candidateModule, interval, {}), bars, true);
    assert.equal(actual.values, expected.values); assert.equal(actual.state, expected.state);
    assert.equal(actual.output, fresh.output); assert.equal(actual.state, fresh.state);
});
for (const interval of [1, 5]) for (const latestOnly of [false, true]) for (const replacement of [false, true]) test(`${interval}m finite ${replacement ? 'replacement' : 'shortened'} history ${latestOnly ? 'latest-only' : 'sequential'} resets once and equals fresh target`, () => {
    const oldBars = input('2026-10-04T22:00:00Z', 3, interval);
    const targetBars = replacement ? input('2026-10-11T22:00:00Z', 1, interval) : oldBars.slice(0, 200 / interval);
    const calc = make(candidateModule, interval, {}), resets = trackResets(calc);
    run(calc, oldBars, false);
    assert.equal(resets(), 0);
    assert.ok(calc.previous.sequence >= targetBars.length, 'Scenario must put previous sequence outside finite replacement history');
    const actual = run(calc, targetBars, latestOnly), fresh = run(make(candidateModule, interval, {}), targetBars, latestOnly);
    assert.equal(actual.output, fresh.output, 'Shorter history must not retain obsolete outputs/graphics');
    assert.equal(actual.state, fresh.state, 'Shorter history must replay the supplied target exactly once');
    assert.equal(resets(), 1, 'Shorter history should cause one reset');
});
for (const interval of [1, 5]) test(`${interval}m unchanged history repeated and out-of-order callbacks do not reset`, () => {
    const bars = input('2026-10-04T22:00:00Z', 3, interval), calc = make(candidateModule, interval, {}), resets = trackResets(calc);
    const before = run(calc, bars, false), repeated = run(calc, bars, false);
    assert.equal(repeated.output, before.output); assert.equal(repeated.state, before.state);
    assert.equal(resets(), 0);
});
for (const interval of [1, 5]) test(`${interval}m unavailable or malformed history size does not cause a reset`, () => {
    const bars = input('2026-10-04T22:00:00Z', 1, interval), calc = make(candidateModule, interval, {}), resets = trackResets(calc);
    const before = run(calc, bars, false), live = bars[bars.length - 1];
    for (const size of [null, undefined, NaN, -1, -Infinity, Infinity]) {
        const history = {get: i => bars[i] ? entity(bars[i]) : undefined, size: () => size};
        const result = calc.map(entity(live, true), live.index, history);
        assert.equal(JSON.stringify(result), before.output, 'Unavailable, nonnumeric or negative size must preserve valid unchanged history');
        assert.equal(financialState(calc), before.state);
    }
    assert.equal(resets(), 0);
});
console.log(`\n${passed} passed; ${failed} failed; ${barsChecked} historical bars checked for exact parity.`);
process.exitCode = failed ? 1 : 0;
