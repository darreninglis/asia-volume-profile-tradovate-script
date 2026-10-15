'use strict';
// Read-only regression fixture: source is evaluated in a VM, never rewritten.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const sourcePath=process.argv[2]||path.join(__dirname,'..','AsiaSessionVolumeProfile.js');
const code=fs.readFileSync(sourcePath,'utf8'),MIN=60000;
function load(source){
    const specs=new Proxy({},{get:(_,key)=>key==='enum'?(values,value)=>({def:value}):value=>({def:value})});
    const predef={paramSpecs:specs,plotters:new Proxy({},{get:()=>(...args)=>args}),styles:new Proxy({},{get:()=>(...args)=>args})};
    const graphics={du:value=>({unit:'du',value}),px:value=>({unit:'px',value}),op:(left,operator,right)=>({left,operator,right})};
    const box={module:{exports:{}},require:name=>{if(name==='./tools/predef')return predef;if(name==='./tools/graphics')return graphics;throw Error(name);},console,Date,Intl,Number,Math,Object,Array,String,Map,Set};
    vm.runInNewContext(source,box,{filename:sourcePath});return box.module.exports;
}
const guarded=load(code);
const guardLine='if(Number.isFinite(start) && this.historyStart!==null && start!==this.historyStart)reset=true;';
assert.ok(code.includes(guardLine),'Expected the canonical historyStart guard');
const withoutHeadGuard=load(code.replace(guardLine,'// Disabled only in this in-memory regression control.'));
function make(module,interval){
    const calc=new module.calculator();calc.props=Object.fromEntries(Object.entries(module.params).map(([key,spec])=>[key,spec.def]));
    calc.contractInfo={tickSize:.25,product:'NQ',contract:'NQZ6'};
    calc.chartDescription={underlyingType:'MinuteBar',elementSize:interval,elementSizeUnit:'UnderlyingUnits'};calc.init();
    const stats={resets:0},init=calc.init.bind(calc);calc.init=()=>{stats.resets++;init();};return {calc,stats};
}
function bars(interval){const result=[];for(let elapsed=0;elapsed<1380;elapsed+=interval){const o=25200+(elapsed%17)*.25,c=o+(elapsed%3-1)*.25;result.push({t:Date.parse('2026-10-05T22:00:00Z')+elapsed*MIN,index:result.length,o,c,l:Math.min(o,c)-1,h:Math.max(o,c)+1,v:10+elapsed%23});}return result;}
function entity(b,last=false){return {timestamp:()=>new Date(b.t),index:()=>b.index,open:()=>b.o,high:()=>b.h,low:()=>b.l,close:()=>b.c,volume:()=>b.v,isLast:()=>last,...('tradeDate' in b?{tradeDate:()=>b.tradeDate}:{})};}
function history(input){return {get:i=>input[i]?entity(input[i]):undefined,size:()=>input.length,first:()=>input[0]?entity(input[0]):undefined};}
function numeric(value){return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='graphics')));}
function state(calc){const result={};for(const key of Object.keys(calc)){if(['props','drawCache','init'].includes(key))continue;result[key]=key==='references'?Object.fromEntries(Object.entries(calc.references).filter(([name])=>name!=='props')):calc[key];}return JSON.stringify(result);}
function feed(calc,input,latestOnly=false){const h=history(input),indices=latestOnly?[input.length-1]:input.map((_,i)=>i);return indices.map(i=>numeric(calc.map(entity(input[i],i===input.length-1),i,h)));}
function latest(calc,input,h=history(input)){const i=input.length-1;return numeric(calc.map(entity(input[i],true),i,h));}
function kinds(calc){return Array.from(calc.completed,p=>p.kind).join(',');}
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.stack);}}
for(const interval of [1,5])for(const latestOnly of [false,true])test(`${interval}m opening-prefix repair with unchanged latest anchor (${latestOnly?'catchup':'sequential'}) equals fresh calculation`,()=>{
    const full=bars(interval),initial=full.slice(5/interval).map((b,index)=>({...b,index}));
    const repaired=initial.map((b,index)=>index===0?({...full[0],index:0}):b);
    const {calc,stats}=make(guarded,interval);feed(calc,initial);
    assert.equal(kinds(calc),'US');const previousTime=calc.previous.t,previousSequence=calc.previous.sequence;
    assert.equal(repaired[previousSequence].t,previousTime,'Latest anchor must remain identical');
    const fresh=make(guarded,interval).calc;
    assert.deepEqual(feed(calc,repaired,latestOnly),feed(fresh,repaired,latestOnly));assert.equal(state(calc),state(fresh));
    assert.equal(kinds(calc),'ON,US');assert.equal(stats.resets,1);assert.equal(calc.inputWarning,null);
    const before=state(calc);latest(calc,repaired);assert.equal(state(calc),before);assert.equal(stats.resets,1,'Repeated callback must not reset again');
});
for(const interval of [1,5])test(`${interval}m control without earliest guard reproduces missing overnight despite unchanged latest anchor`,()=>{
    const full=bars(interval),initial=full.slice(5/interval).map((b,index)=>({...b,index})),repaired=initial.map((b,index)=>index===0?({...full[0],index:0}):b);
    const {calc,stats}=make(withoutHeadGuard,interval);feed(calc,initial);feed(calc,repaired,true);
    const fresh=make(guarded,interval).calc;feed(fresh,repaired,true);
    assert.equal(kinds(calc),'US');assert.equal(kinds(fresh),'ON,US');assert.equal(stats.resets,0);assert.equal(calc.inputWarning,null);
});
for(const interval of [1,5])test(`${interval}m a later replacement head also replays once to fresh-history semantics`,()=>{
    const full=bars(interval),initial=[full[0],...full.slice(10/interval)].map((b,index)=>({...b,index}));
    const replaced=initial.map((b,index)=>index===0?({...full[5/interval],index:0}):b);
    const {calc,stats}=make(guarded,interval);feed(calc,initial);assert.equal(kinds(calc),'ON,US');
    assert.equal(replaced[calc.previous.sequence].t,calc.previous.t);
    const fresh=make(guarded,interval).calc;assert.deepEqual(feed(calc,replaced,true),feed(fresh,replaced,true));assert.equal(state(calc),state(fresh));
    assert.equal(kinds(calc),'US','Expired opening volume must not remain in a fresh-equivalent profile');assert.equal(stats.resets,1);
});
for(const interval of [1,5])test(`${interval}m ordinary live append and repeated callbacks retain state without replay or double count`,()=>{
    const input=bars(interval),{calc,stats}=make(guarded,interval);feed(calc,input.slice(0,80));
    const fresh=make(guarded,interval).calc;assert.deepEqual(feed(calc,input,true),feed(fresh,input,true));assert.equal(state(calc),state(fresh));assert.equal(stats.resets,0);
    const before=state(calc),h=history(input);for(const index of [0,11,input.length-1,input.length-1])calc.map(entity(input[index],index===input.length-1),index,h);
    assert.equal(state(calc),before);assert.equal(stats.resets,0);
});
for(const interval of [1,5])test(`${interval}m temporarily absent or invalid-Date head cannot poison the saved fingerprint`,()=>{
    const input=bars(interval),{calc,stats}=make(guarded,interval);feed(calc,input);const before=state(calc),h=history(input);
    for(const head of [undefined,{timestamp:()=>new Date(NaN)}])latest(calc,input,{...h,get:i=>i===0?head:h.get(i)});
    assert.equal(state(calc),before);assert.equal(stats.resets,0);assert.equal(calc.historyStart,input[0].t);
});
for(const [from,to] of [[1,5],[5,1]])test(`${from}m to ${to}m with current public metadata still equals fresh initialization`,()=>{
    const {calc,stats}=make(guarded,from);feed(calc,bars(from));calc.chartDescription.elementSize=to;
    const input=bars(to),fresh=make(guarded,to).calc;assert.deepEqual(feed(calc,input,true),feed(fresh,input,true));assert.equal(state(calc),state(fresh));assert.equal(stats.resets,1);
});
for(const interval of [1,5])test(`${interval}m finite history shrink is still detected when the first timestamp is unchanged`,()=>{
    const input=bars(interval),{calc,stats}=make(guarded,interval);feed(calc,input);
    const shorter=input.slice(0,60),fresh=make(guarded,interval).calc;assert.deepEqual(feed(calc,shorter,true),feed(fresh,shorter,true));assert.equal(state(calc),state(fresh));assert.equal(stats.resets,1);
});
for(const interval of [1,5])for(const field of ['o','h','l','c','v','tradeDate'])test(`${interval}m revisited closed ${field} correction replays derived state exactly once`,()=>{
    const input=bars(interval),changed=Math.floor(100/interval),{calc,stats}=make(guarded,interval);feed(calc,input);
    const delta=field==='v'?1000:field==='l'?-.25:.25;
    const corrected=input.map((b,i)=>i===changed?{...b,[field]:field==='tradeDate'?'20261007':b[field]+delta}:b);
    const h=history(corrected);calc.map(entity(corrected[changed]),changed,h);
    const fresh=make(guarded,interval).calc;
    assert.equal(latest(calc,corrected),feed(fresh,corrected,true)[0]);assert.equal(state(calc),state(fresh));assert.equal(stats.resets,1);
    const before=state(calc);calc.map(entity(corrected[changed]),changed,h);latest(calc,corrected);assert.equal(state(calc),before);assert.equal(stats.resets,1);
});
for(const interval of [1,5])test(`${interval}m a repaired invalid closed volume restores the same profiles as fresh valid history`,()=>{
    const valid=bars(interval),changed=Math.floor(100/interval),invalid=valid.map((b,i)=>i===changed?{...b,v:NaN}:b),{calc,stats}=make(guarded,interval);feed(calc,invalid);
    assert.equal(kinds(calc),'US');const h=history(valid);calc.map(entity(valid[changed]),changed,h);
    const fresh=make(guarded,interval).calc;assert.equal(latest(calc,valid),feed(fresh,valid,true)[0]);assert.equal(state(calc),state(fresh));assert.equal(kinds(calc),'ON,US');assert.equal(stats.resets,1);
});
for(const interval of [1,5])for(const delivery of ['latest-only','closed-first'])test(`${interval}m history-only middle correction is audited on next live candle (${delivery})`,()=>{
    const input=bars(interval),changed=Math.floor(100/interval),{calc,stats}=make(guarded,interval);feed(calc,input);
    const corrected=input.map((b,i)=>i===changed?{...b,v:b.v+1000}:b);
    corrected.push({...input[input.length-1],t:input[input.length-1].t+interval*MIN,index:input.length});
    const h=history(corrected);if(delivery==='closed-first')calc.map(entity(corrected[corrected.length-2]),corrected.length-2,h);
    const fresh=make(guarded,interval).calc;assert.equal(latest(calc,corrected,h),feed(fresh,corrected,true)[0]);assert.equal(state(calc),state(fresh));assert.equal(stats.resets,1);
});
for(const interval of [1,5])test(`${interval}m history-only same-candle correction waits for next candle without per-tick scanning`,()=>{
    const input=bars(interval),changed=Math.floor(100/interval),{calc,stats}=make(guarded,interval);feed(calc,input);const original=calc.completed[0].total;
    const corrected=input.map((b,i)=>i===changed?{...b,v:b.v+1000}:b);latest(calc,corrected);
    assert.equal(calc.completed[0].total,original);assert.equal(stats.resets,0,'A repeated live tick must not scan the entire past');
    corrected.push({...input[input.length-1],t:input[input.length-1].t+interval*MIN,index:input.length});latest(calc,corrected);
    assert.equal(calc.completed[0].total,original+1000);assert.equal(stats.resets,1);
});
for(const interval of [1,5])test(`${interval}m unchanged live updates use constant history reads and preserve cached graphics`,()=>{
    const input=bars(interval),{calc,stats}=make(guarded,interval);feed(calc,input);const base=history(input),before=state(calc);let reads=0;
    const h={...base,get:i=>{reads++;return base.get(i);}},i=input.length-1;
    const cache=calc.map(entity(input[i],true),i,h).graphics.items;reads=0;
    for(let tick=0;tick<100;tick++){const current={...input[i],v:999999+tick};assert.strictEqual(calc.map(entity(current,true),i,h).graphics.items,cache);}
    assert.ok(reads<=300,'At most three history reads per unchanged live tick; observed '+reads);assert.equal(state(calc),before);assert.equal(stats.resets,0);
});
for(const interval of [1,5])test(`${interval}m unavailable audited history warns and later supplied bars recover without stale outputs`,()=>{
    const input=bars(interval),{calc,stats}=make(guarded,interval);feed(calc,input);
    const extended=input.concat({...input[input.length-1],t:input[input.length-1].t+interval*MIN,index:input.length}),base=history(extended),missing=100/interval;
    const unavailable={...base,get:i=>i===missing?undefined:base.get(i)},i=extended.length-1;
    const out=calc.map(entity(extended[i],true),i,unavailable);assert.equal(out.dataReady,0);assert.equal(out.vwap,undefined);assert.equal(out.currentPOC,undefined);assert.match(calc.inputWarning,/history unavailable/i);assert.equal(stats.resets,1);
    const fresh=make(guarded,interval).calc;assert.equal(latest(calc,extended),feed(fresh,extended,true)[0]);assert.equal(state(calc),state(fresh));assert.equal(stats.resets,1);
});
console.log(`\n${passed} passed; ${failed} failed.`);process.exitCode=failed?1:0;
