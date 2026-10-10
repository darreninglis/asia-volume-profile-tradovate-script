// Independent checks against the saved Tradovate module. No platform/network access.
// Usage: node tests/profile-tests.js [path-to-indicator]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const filename = path.resolve(process.argv[2] || path.join(__dirname, '..', 'AsiaSessionVolumeProfile.js'));
const specs = new Proxy({}, {get: (_, key) => key === 'enum' ? (values, value) => ({def: value}) : (value) => ({def: value})});
const predef = {
    paramSpecs: specs,
    plotters: new Proxy({}, {get: () => (...args) => args}),
    styles: new Proxy({}, {get: () => (...args) => args}),
};
const graphics = {
    du: value => ({unit: 'du', value}),
    px: value => ({unit: 'px', value}),
    op: (left, operator, right) => ({left, operator, right}),
};
const sandbox = {
    module: {exports: {}},
    require: name => {
        if (name === './tools/predef') return predef;
        if (name === './tools/graphics') return graphics;
        throw Error('Unexpected dependency: ' + name);
    },
    console, Date, Intl, Number, Math, Object, Array, String, Map, Set,
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8') +
    '\nmodule.exports.__test = {ny, session, levels};', sandbox, {filename});
const indicator = sandbox.module.exports;
const {ny, session, levels} = indicator.__test;
const defaults = Object.fromEntries(Object.entries(indicator.params).map(([key, spec]) => [key, spec.def]));
function calculator(interval = 1, overrides = {}) {
    const calc = new indicator.calculator();
    calc.props = {...defaults, ...overrides};
    calc.contractInfo = {tickSize: .25, contract: 'NQZ6', product: 'NQ'};
    calc.chartDescription = {underlyingType: 'MinuteBar', elementSize: interval, elementSizeUnit: 'UnderlyingUnits'};
    calc.init();
    return calc;
}
const minute = 60000;
function candle(time, index, values = {}) {
    return {t: +new Date(time), index, sequence: index, o: 100, h: 104, l: 100, c: 102, v: 100, ...values};
}
function entity(b, last = false) {
    return {timestamp: () => new Date(b.t), index: () => b.index,
        open: () => b.o, high: () => b.h, low: () => b.l, close: () => b.c,
        volume: () => b.v, isLast: () => last};
}
function feed(calc, start, minutes, interval, omissions = new Set()) {
    let index = 0;
    const bars = [];
    for (let elapsed = 0; elapsed < minutes; elapsed += interval) {
        if (omissions.has(elapsed)) continue;
        const b = candle(+new Date(start) + elapsed * minute, index++, {v: 100 + elapsed % 7});
        calc.commit(b); bars.push(b);
    }
    return bars;
}
function closeTo(actual, expected, tolerance = 1e-7) {
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
        `Expected ${actual} to be close to ${expected}`);
}
let passed = 0, failed = 0;
function test(name, fn) {
    try {fn(); passed++; console.log('PASS ' + name);}
    catch (error) {failed++; console.error('FAIL ' + name + ': ' + error.message);}
}
test('New York spring/fall DST transitions use UTC instants', () => {
    assert.equal(ny(Date.parse('2026-03-08T06:59:00Z')).minute, 119);
    assert.equal(ny(Date.parse('2026-03-08T07:00:00Z')).minute, 180);
    assert.equal(ny(Date.parse('2026-11-01T05:59:00Z')).minute, 119);
    assert.equal(ny(Date.parse('2026-11-01T06:00:00Z')).minute, 60);
});
test('Session boundaries are 18:00, 09:30 and 16:00 New York', () => {
    assert.equal(session(Date.parse('2026-10-05T21:59:00Z')).kind, null);
    assert.equal(session(Date.parse('2026-10-05T22:00:00Z')).atStart, true);
    assert.equal(session(Date.parse('2026-10-06T13:29:00Z')).kind, 'ON');
    assert.equal(session(Date.parse('2026-10-06T13:30:00Z')).kind, 'US');
    assert.equal(session(Date.parse('2026-10-06T19:59:00Z')).kind, 'US');
    assert.equal(session(Date.parse('2026-10-06T20:00:00Z')).kind, null);
});
for (const interval of [1, 5]) {
    test(`${interval} minute standard chart is supported`, () => assert.equal(calculator(interval).supported(), true));
    test(`${interval} minute overnight completes exactly at 09:30`, () => {
        const calc = calculator(interval);
        const bars = feed(calc, '2026-10-05T22:00:00Z', 930, interval);
        assert.equal(calc.active.kind, 'ON');
        assert.equal(calc.active.good, true);
        assert.equal(calc.active.complete, true);
        assert.equal(calc.active.last, Date.parse('2026-10-06T13:30:00Z'));
        assert.equal(calc.active.absent, 0);
        closeTo(calc.active.total, bars.reduce((sum, b) => sum + b.v, 0));
        closeTo(calc.active.rows.reduce((sum, value) => sum + value, 0), calc.active.total);
        calc.commit(candle('2026-10-06T13:30:00Z', bars.length));
        assert.equal(calc.completed.length, 1);
        assert.equal(calc.completed[0].kind, 'ON');
        assert.equal(calc.active.kind, 'US');
        assert.equal(calc.active.observed, 1);
    });
    test(`${interval} minute cash completes exactly at 16:00`, () => {
        const calc = calculator(interval);
        const bars = feed(calc, '2026-10-06T13:30:00Z', 390, interval);
        assert.equal(calc.active.complete, true);
        assert.equal(calc.active.last, Date.parse('2026-10-06T20:00:00Z'));
        calc.commit(candle('2026-10-06T20:00:00Z', bars.length));
        assert.equal(calc.completed.length, 1);
        assert.equal(calc.prior.kind, 'US');
    });
    test(`${interval} minute sparse bars conserve supplied volume and count missing minutes`, () => {
        const calc = calculator(interval);
        const bars = feed(calc, '2026-10-05T22:00:00Z', 30, interval, new Set([interval * 2]));
        assert.equal(calc.active.good, true);
        assert.equal(calc.active.absent, interval);
        closeTo(calc.active.total, bars.reduce((sum, b) => sum + b.v, 0));
        closeTo(calc.active.rows.reduce((sum, value) => sum + value, 0), calc.active.total);
    });
    test(`${interval} minute duplicate commits do not count a closed candle twice`, () => {
        const calc = calculator(interval);
        const b = candle('2026-10-05T22:00:00Z', 0);
        calc.commit(b); calc.commit(b); calc.commit({...b, v: b.v * 2});
        assert.equal(calc.active.observed, 1);
        assert.equal(calc.active.total, b.v);
    });
    test(`${interval} minute partial session remains unavailable`, () => {
        const calc = calculator(interval);
        feed(calc, Date.parse('2026-10-05T22:00:00Z') + interval * minute, 30, interval);
        assert.equal(calc.active.good, false);
        assert.equal(calc.active.levels, null);
        assert.equal(calc.completed.length, 0);
    });
    test(`${interval} minute missing final bar does not mark a full session`, () => {
        const calc = calculator(interval);
        const bars = feed(calc, '2026-10-06T13:30:00Z', 390 - interval, interval);
        assert.equal(calc.active.complete, false);
        calc.commit(candle('2026-10-06T20:00:00Z', bars.length));
        assert.equal(calc.completed.length, 0);
        assert.equal(calc.prior, null);
    });
    test(`${interval} minute live map excludes open candle and handles repeated updates`, () => {
        const calc = calculator(interval);
        const bars = [0, 1, 2].map(i => candle(Date.parse('2026-10-05T22:00:00Z') + i * interval * minute, i));
        const history = {get: i => entity(bars[i]), size: () => bars.length};
        calc.map(entity(bars[0]), 0, history);
        calc.map(entity(bars[1]), 1, history);
        const total = calc.active.total;
        const out = calc.map(entity(bars[2], true), 2, history);
        calc.map(entity({...bars[2], v: 99999}, true), 2, history);
        assert.equal(calc.active.total, total);
        assert.equal(calc.active.observed, 2);
        assert.ok(out.graphics && out.graphics.items.length > 0);
    });
}
test('Nonstandard charts produce a clear unsupported message', () => {
    const calc = calculator(15);
    assert.equal(calc.supported(), false);
    const out = calc.map(entity(candle('2026-10-05T22:00:00Z', 0), true), 0, {get: () => undefined});
    assert.ok(JSON.stringify(out).toLowerCase().includes('chart'));
});
test('Numeric-string interval metadata works and missing metadata is unsupported', () => {
    assert.equal(calculator('5').supported(), true);
    const calc = calculator();
    calc.chartDescription = null;
    assert.equal(calc.supported(), false);
});
test('Catch-up processes every previously unseen closed bar in sequence', () => {
    const calc = calculator(5);
    const bars = Array.from({length: 21}, (_, i) => candle(Date.parse('2026-10-05T22:00:00Z') + i * 5 * minute, i));
    const history = {get: i => entity(bars[i]), size: () => bars.length};
    calc.map(entity(bars[20], true), 20, history);
    assert.equal(calc.active.observed, 20);
    assert.equal(calc.active.total, 2000);
    assert.equal(calc.active.absent, 0);
});
test('Graphics cache is reused for unchanged live updates and rebuilt for a new last index', () => {
    const calc = calculator(1);
    const bars = Array.from({length: 4}, (_, i) => candle(Date.parse('2026-10-05T22:00:00Z') + i * minute, i));
    const history = {get: i => entity(bars[i]), size: () => bars.length};
    const first = calc.map(entity(bars[2], true), 2, history);
    const again = calc.map(entity({...bars[2], v: 200}, true), 2, history);
    assert.strictEqual(first.graphics.items, again.graphics.items);
    const next = calc.map(entity(bars[3], true), 3, history);
    assert.notStrictEqual(first.graphics.items, next.graphics.items);
    assert.equal(calc.active.observed, 3);
});
test('Undefined and missing parameters inherit defaults while false and zero survive', () => {
    const calc = new indicator.calculator();
    calc.props = {showVWAP: false, showDashboard: false, settlementClose: 0, ticksPerRow: undefined};
    calc.contractInfo = {tickSize: .25};
    calc.chartDescription = {underlyingType: 'MinuteBar', elementSize: 5, elementSizeUnit: 'UnderlyingUnits'};
    calc.init();
    assert.equal(calc.props.ticksPerRow, 8);
    assert.equal(calc.props.showVWAP, false);
    assert.equal(calc.props.showDashboard, false);
    assert.equal(calc.props.settlementClose, 0);
    assert.equal(calc.props.rangeTimezone, 'America/Chicago');
});
test('Retention and row settings are bounded for old or manually edited instances', () => {
    const calc = calculator(1, {completedProfiles: 1e9, rvolLookback: 1e9, historySessions: 1e9, ticksPerRow: -1});
    assert.ok(calc.props.completedProfiles <= 20);
    assert.ok(calc.props.rvolLookback <= 100);
    assert.ok(calc.props.historySessions <= 20);
    assert.ok(calc.step > 0);
});
test('Value area reaches requested coverage when the next row crosses the target', () => {
    const p = {good: true, total: 100, first: 0, rows: [40, 35, 25]};
    const result = levels(p, 1, 1, 70);
    assert.equal(result.lo, 0);
    assert.equal(result.hi, 1);
    assert.ok(p.rows.slice(result.lo, result.hi + 1).reduce((sum, v) => sum + v, 0) >= 70);
});
test('Nonfinite timestamps and malformed OHLC do not poison ATR or session state', () => {
    for (const values of [{t: NaN}, {h: 99}, {c: 105}, {v: -1}]) {
        const calc = calculator();
        calc.commit(candle('2026-10-05T22:00:00Z', 0));
        assert.equal(calc.fgood, true);
        calc.testsCovered = true;
        const count = calc.trCount, total = calc.active.total;
        calc.commit(candle('2026-10-05T22:01:00Z', 1, values));
        assert.equal(calc.trCount, count);
        assert.equal(calc.active.total, total);
        assert.equal(calc.active.good, false);
        assert.equal(calc.fgood, false);
        assert.equal(calc.testsCovered, false);
        assert.ok(calc.inputWarning);
    }
});
test('Five-minute bars cannot straddle the exact session boundary', () => {
    const calc = calculator(5);
    calc.commit(candle('2026-10-06T13:28:00Z', 0));
    assert.equal(calc.active, null);
    assert.ok(/misaligned/i.test(calc.inputWarning));
});
test('Missing opening history and zero-volume state warn even with dashboard disabled', () => {
    for (const [time, values, expected] of [
        ['2026-10-05T22:05:00Z', {}, 'Session-open history missing'],
        ['2026-10-05T22:00:00Z', {v: 0}, 'Waiting for volume'],
    ]) {
        const calc = calculator(1, {showDashboard: false});
        const first = candle(time, 0, values), next = candle(+new Date(time) + minute, 1);
        const history = {get: () => entity(first), size: () => 2};
        const result = calc.map(entity(next, true), 1, history);
        assert.ok(JSON.stringify(result.graphics).includes(expected));
    }
});
test('Invalid or unavailable closed history never exports stale VWAP, profile or readiness fields', () => {
    for (const unavailable of [false, true]) {
        const calc = calculator(1, {showVWAP: true, showFuturesComparison: true});
        const first = candle('2026-10-05T22:00:00Z', 0);
        calc.commit(first);
        assert.ok(Number.isFinite(calc.snapshot.vwap), 'Setup must have an existing valid VWAP');
        const invalid = candle('2026-10-05T22:01:00Z', 1, {v: NaN});
        const live = candle('2026-10-05T22:02:00Z', 2);
        const history = {get: i => i === 0 ? entity(first) : unavailable ? undefined : entity(invalid), size: () => 3};
        const result = calc.map(entity(live, true), 2, history);
        assert.equal(result.dataReady, 0);
        assert.equal(result.contextState, 0);
        for (const key of ['vwap', 'futuresVWAP', 'currentVAH', 'currentPOC', 'currentVAL', 'priorVAH', 'priorPOC', 'priorVAL', 'sessionRVOL', 'devVAH', 'devPOC', 'devVAL'])
            assert.equal(key in result, false, 'Unexpected stale output: ' + key);
        assert.ok(JSON.stringify(result.graphics).includes(unavailable ? 'Closed-bar history unavailable' : 'Invalid timestamp, OHLC or volume'));
    }
});
test('OHLCV allocation conserves exact row-boundary and zero-range volume', () => {
    const calc = calculator(1, {ticksPerRow: 8});
    const candles = [
        {l: 100, h: 100, c: 100, v: 17},
        {l: 100, h: 102, c: 101, v: 37},
        {l: 99.75, h: 104.25, c: 102, v: 123},
        {l: 99.75, h: 104.25, c: 102, v: 0},
        {o: 0, l: 0, h: 0, c: 0, v: 5},
    ];
    candles.forEach((values, i) => calc.commit(candle(Date.parse('2026-10-05T22:00:00Z') + i * minute, i, values)));
    assert.equal(calc.active.good, true);
    closeTo(calc.active.total, candles.reduce((sum, b) => sum + b.v, 0));
    closeTo(calc.active.rows.reduce((sum, value) => sum + value, 0), calc.active.total);
    assert.ok(calc.active.rows.every(value => value >= 0 && Number.isFinite(value)));
});
test('Invalid volume invalidates the session instead of inventing a profile', () => {
    const calc = calculator();
    calc.commit(candle('2026-10-05T22:00:00Z', 0, {v: NaN}));
    assert.ok(calc.inputWarning && /invalid/i.test(calc.inputWarning));
    assert.equal(calc.active, null);
});
test('Row allocation remains bounded on an extreme range', () => {
    const calc = calculator();
    calc.commit(candle('2026-10-05T22:00:00Z', 0, {l: 1, h: 1000000, c: 100}));
    assert.equal(calc.active.good, false);
    assert.ok(calc.active.rows.length <= 1200);
});
function validateGraphics(items) {
    let primitiveCount = 0;
    function inspect(value, trail) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), 'Nonfinite graphics number at ' + trail);
        if (!value || typeof value !== 'object') return;
        if (value.fillStyle && value.fillStyle.opacity !== undefined) {
            const opacity = value.fillStyle.opacity;
            // The installed live renderer was A/B verified to use percent opacity.
            // Its current behavior differs from the public 0..1 type declaration.
            assert.ok(opacity >= 0 && opacity <= 100, `Fill opacity ${opacity} outside verified 0..100 range at ${trail}`);
        }
        if (value.tag === 'Rectangle') {
            primitiveCount++;
            for (const dimension of ['width', 'height']) {
                if (typeof value.size[dimension].value === 'number')
                    assert.ok(value.size[dimension].value >= 0, 'Negative rectangle ' + dimension);
            }
        }
        for (const [key, child] of Object.entries(value)) inspect(child, trail + '.' + key);
    }
    items.forEach((item, i) => {
        assert.equal(item.global, true, 'Drawing must be globally scoped: ' + item.key);
        inspect(item, 'items[' + i + ']');
    });
    assert.ok(primitiveCount > 0, 'Expected histogram/zone/range rectangles');
    assert.ok(primitiveCount < 40000, 'Unexpected unbounded drawing count');
}
test('Histogram, history, zones and dashboard use finite geometry and verified percent opacity', () => {
    const calc = calculator(1, {showDashboard: true, showHistory: true});
    const bars = feed(calc, '2026-10-05T22:00:00Z', 950, 1);
    const next = candle(Date.parse('2026-10-05T22:00:00Z') + 950 * minute, bars.length);
    const history = {get: i => entity(bars[i]), size: () => bars.length + 1};
    const out = calc.map(entity(next, true), bars.length, history);
    validateGraphics(out.graphics.items);
    const items = out.graphics.items;
    const outside = items.find(item => /^profile-\d+out$/.test(item.key));
    const inside = items.find(item => /^profile-\d+in$/.test(item.key));
    assert.ok(outside && inside, 'Expected histogram fill groups');
    closeTo(outside.fillStyle.opacity, 20);
    closeTo(inside.fillStyle.opacity, 58);
    const historical = items.filter(item => /^historical-/.test(item.key));
    assert.ok(historical.length > 0, 'Expected historical review areas');
    historical.forEach(item => closeTo(item.fillStyle.opacity, 7));
    const boxes = items.filter(item => /^range-box-/.test(item.key));
    assert.ok(boxes.length > 0, 'Expected session range boxes');
    boxes.forEach(item => closeTo(item.fillStyle.opacity, 5));
    const zones = items.filter(item => /^zone-(vah|poc|val)$/.test(item.key));
    assert.ok(zones.length > 0, 'Expected current review areas');
    zones.forEach(item => closeTo(item.fillStyle.opacity, 100 - calc.props.areaTransparency));
    const panel = out.graphics.items.find(item => item.key === 'dashboard');
    assert.ok(panel, 'Expected dashboard container');
    closeTo(panel.children.find(item => item.key === 'panel').fillStyle.opacity, 94);
    closeTo(calc.warning('Test')[0].children.find(item => item.key === 'warning-bg').fillStyle.opacity, 94);
    const captions = panel.children.filter(item => item.tag === 'Text');
    assert.ok(captions.every(item => item.textAlignment === 'rightMiddle'), 'Dashboard text should extend into panel from left inset in the live renderer');
    assert.ok(panel.transformOps.some(op => op.tag === 'ZIndex' && op.zIndex > 0), 'Dashboard must render above chart references');
    assert.ok(calc.warning('Test')[0].transformOps.some(op => op.tag === 'ZIndex' && op.zIndex > 0), 'Warning must render above chart references');
});
console.log(`\n${passed} passed; ${failed} failed. ${filename}`);
process.exitCode = failed ? 1 : 0;
