// Presentation regression checks. Real Tradovate rendering remains authoritative.
// Usage: node tests/presentation-cleanup.js [candidate.js]
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const repo=path.resolve(__dirname,'..'),candidatePath=path.resolve(process.argv[2]||path.join(repo,'AsiaSessionVolumeProfile.js'));
const baselineRevision='0b10d98a51ef8ef5f1801aae31e688eb66dfa78c';
const baselineSource=execFileSync('git',['show',baselineRevision+':AsiaSessionVolumeProfile.js'],{cwd:repo,encoding:'utf8',maxBuffer:1024*1024});
const MIN=60000;
function load(source,filename){
    const specs=new Proxy({},{get:(_,key)=>key==='enum'?(values,value)=>({def:value,enumSet:values}):value=>({def:value})});
    const predef={paramSpecs:specs,plotters:new Proxy({},{get:()=>(...args)=>args}),styles:new Proxy({},{get:()=>(...args)=>args})};
    const graphics={du:value=>({unit:'du',value}),px:value=>({unit:'px',value}),op:(left,operator,right)=>({left,operator,right})};
    const box={module:{exports:{}},require:name=>{if(name==='./tools/predef')return predef;if(name==='./tools/graphics')return graphics;throw Error('Unexpected dependency: '+name);},console,Date,Intl,Number,Math,Object,Array,String,Map,Set};
    vm.runInNewContext(source+(source.includes('function priceCaptions(')?'\nmodule.exports.__test={priceCaptions,profileStatus};':''),box,{filename});return box.module.exports;
}
const baseline=load(baselineSource,baselineRevision),candidate=load(fs.readFileSync(candidatePath,'utf8'),candidatePath);
function make(module,interval=1,overrides={}){
    const calc=new module.calculator();calc.props={...Object.fromEntries(Object.entries(module.params).map(([key,spec])=>[key,spec.def])),...overrides};
    calc.contractInfo={tickSize:.25,product:'NQ',contract:'NQZ6'};calc.chartDescription={underlyingType:'MinuteBar',elementSize:interval,elementSizeUnit:'UnderlyingUnits'};calc.init();return calc;
}
function candle(t,index,values={}){const o=25200+(index%17-8)*.25,c=o+(index%5-2)*.25;return {t,index,sequence:index,o,c,l:Math.min(o,c)-1,h:Math.max(o,c)+1,v:1+(index*37)%503,...values};}
function bars(interval,minutes=960,omissions=new Set(),offset=0){
    const out=[],start=Date.parse('2026-10-05T22:00:00Z')+offset*MIN;
    for(let elapsed=0;elapsed<=minutes;elapsed+=interval){if(omissions.has(elapsed))continue;out.push(candle(start+elapsed*MIN,out.length));}return out;
}
function entity(b,last=false){return {timestamp:()=>new Date(b.t),index:()=>b.index,open:()=>b.o,high:()=>b.h,low:()=>b.l,close:()=>b.c,volume:()=>b.v,isLast:()=>last};}
function history(input){return {get:i=>input[i]?entity(input[i]):undefined,size:()=>input.length,first:()=>input[0]?entity(input[0]):undefined};}
const optionalPlots=new Set(['vwap','futuresVWAP','devVAH','devPOC','devVAL']);
function coreOutput(out){return JSON.stringify(Object.fromEntries(Object.entries(out).filter(([key])=>key!=='graphics'&&!optionalPlots.has(key))));}
function financialState(calc){
    const keys=['minutes','duration','tick','step','active','completed','prior','lastValidUS','previous','processed','historyStart','future','fpv','fvol','fgood','fAbsent','above','below','context','area','tests','testsCovered','baselines','pocHistory','atr','trCount','trSum','snapshot','inputWarning'];
    const result=Object.fromEntries(keys.map(key=>[key,calc[key]]));
    result.references=Object.fromEntries(['periods','ranges','previousBar','monday','week','zoneHistory','historyKeys'].map(key=>[key,calc.references[key]]));return JSON.stringify(result);
}
function feed(calc,input){const h=history(input),hash=crypto.createHash('sha256');let out;
    input.forEach((b,i)=>{out=calc.map(entity(b,i===input.length-1),i,h);hash.update(coreOutput(out)+'\n');});
    return {out,hash:hash.digest('hex'),state:financialState(calc)};
}
function allItems(items){const out=[];for(const item of items||[]){out.push(item);if(item.children)out.push(...allItems(item.children));}return out;}
function depth(item){return (item.transformOps||[]).reduce((value,op)=>op.tag==='ZIndex'?value+op.zIndex:value,0);}
function statusText(items){const status=allItems(items).find(item=>item.key==='profile-status-text');assert.ok(status&&status.tag==='Text','Compact quality status must be rendered');return status.text;}
function evaluate(value,projection){if(typeof value==='number')return value;if(value.unit==='px')return value.value;if(value.unit==='du')return projection.offset-value.value*projection.scale;
    const left=evaluate(value.left,projection),right=evaluate(value.right,projection);switch(value.operator){case '+':return left+right;case '-':return left-right;case 'min':return Math.min(left,right);case 'max':return Math.max(left,right);default:throw Error('Unexpected expression operator: '+value.operator);}}
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.stack);}}

test('Preset default preserves existing custom visibility and registered defaults',()=>{
    assert.equal(candidate.params.displayPreset.def,'custom');
    assert.deepEqual(Object.keys(candidate.params.displayPreset.enumSet).sort(),['context','custom','essential','full']);
    for(const [key,spec] of Object.entries(baseline.params))assert.equal(candidate.params[key].def,spec.def,'Changed existing default: '+key);
    assert.deepEqual(Object.keys(candidate.params),[...Object.keys(baseline.params),'displayPreset'],'New parameter must follow existing positional arguments');
});

function period(h,l,o,start=0){return {good:true,h,l,c:o,o,start,key:'2026-10-05'};}
function profile(kind,startIndex,levels,complete=false){return {kind,key:'2026-10-05 '+kind,good:true,complete,first:12598,rows:[20,80,40,10],total:150,pv:3780000,startIndex,endIndex:startIndex+20,last:Date.parse('2026-10-06T02:00:00Z'),observed:21,absent:0,reason:'Ready',cumulative:[],levels:{peak:1,lo:0,hi:2,...levels}};}
function crowded(module,interval=1,preset='custom',histograms=false){
    const calc=make(module,interval,{displayPreset:preset,showDashboard:false,showHistograms:histograms,showDaily:true,showWeekly:true,showMonthly:false,showQuarterly:false,showYearly:false,showMonday:false,showPivots:true,showLondon:true,showNewYorkRange:true,showTokyo:true,showHistory:false,showZones:true,showLevels:true});
    calc.references.periods={D:{current:period(25208,25192,25200,600),previous:period(25203,25197,25200,0)},W:{current:period(25209,25191,25200.25,500),previous:period(25203.25,25196.75,25200,0)}};
    calc.references.ranges={London:{...period(25203.5,25196.5,25200.5,100),last:950},NewYork:{...period(25203.75,25196.25,25200.75,200),last:950},Tokyo:{...period(25204,25196,25200,300),last:950}};
    calc.references.previousBar={c:25200};
    calc.prior=profile('US',0,{vah:25203,poc:25200,val:25197},true);calc.active=profile('ON',700,{vah:25204,poc:25201,val:25198});
    calc.snapshot={s:{kind:'ON'},b:{t:Date.parse('2026-10-06T02:00:00Z'),c:25200},area:calc.prior.levels,vwap:25200,futures:25200,location:0,priorAtr:2,migration:'POC stable',valueRelation:'Value overlaps prior US',rvol:null,samples:0};return calc;
}
function horizontalPrices(items){return allItems(items).filter(item=>item.tag==='LineSegments'&&!/leader/.test(item.key)).flatMap(item=>item.lines).filter(line=>line.a.y.unit==='du'&&line.b.y.unit==='du'&&line.a.y.value===line.b.y.value).map(line=>JSON.stringify({a:line.a,b:line.b})).sort();}
for(const interval of [1,5])test(`${interval}m shared caption layout keeps exact lines and merges prior/zone/reference prices`,()=>{
    const before=crowded(baseline,interval).draw(1000),after=crowded(candidate,interval).draw(1000);
    assert.deepEqual(horizontalPrices(after),horizontalPrices(before),'Horizontal reference prices or endpoints moved');
    const container=after.find(item=>item.key==='price-captions');assert.ok(container&&container.global,'Expected a single shared caption container');
    const captions=allItems(container.children).filter(item=>item.tag==='Text'&&/^price-caption-/.test(item.key)),leaders=allItems(container.children).filter(item=>item.tag==='LineSegments'&&/^price-leader-/.test(item.key));
    assert.equal(captions.length,leaders.length);assert.ok(captions.length>=12,'Crowded fixture must exercise all caption families');
    const poc=leaders.filter(item=>item.lines[0].a.y.value===25200);assert.equal(poc.length,1,'Prior POC, review and same-price references must share one price slot');
    const pocCaption=captions.find(item=>item.key==='price-caption-'+poc[0].key.slice('price-leader-'.length));assert.ok(pocCaption.text.endsWith('25200.00'),'Merged caption must retain exact displayed price');
    assert.equal(allItems(after).some(item=>/^(prior-label-|zone-text-|ref-caption-)/.test(item.key)),false,'Old unallocated captions remain');
    for(const view of [{height:280,scale:2.8},{height:560,scale:5.6},{height:1080,scale:10.8},{height:720,scale:72}]){
        const projection={...view,offset:view.height/2+25200*view.scale},positions=captions.map(item=>evaluate(item.point.y,projection)).sort((a,b)=>a-b);
        for(let i=1;i<positions.length;i++)assert.ok(positions[i]-positions[i-1]>=18-1e-8,'Shared caption collision');
        for(const leader of leaders){const suffix=leader.key.slice('price-leader-'.length),caption=captions.find(item=>item.key==='price-caption-'+suffix);assert.ok(caption);assert.equal(leader.lines[0].a.y.unit,'du','Leader must start at exact price');assert.equal(evaluate(leader.lines[0].b.y,projection),evaluate(caption.point.y,projection));}
    }
    assert.equal(allItems(after).some(item=>item.tag==='Text'&&/\b(?:BUY|SELL)\?/.test(item.text)),false,'Directional question labels remain');
});
test('Three short family labels merge and long labels stay bounded without dropping the price',()=>{
    const merged=candidate.__test.priceCaptions([{name:'Prior POC',value:25200,color:'#fff',showPrice:true},{name:'Review',value:25200,color:'#fff',showPrice:true},{name:'Daily Open',value:25200,color:'#fff',showPrice:true}],.25,25200);
    const captions=allItems(merged.children).filter(item=>item.tag==='Text'&&/^price-caption-/.test(item.key));assert.equal(captions.length,1);assert.ok(/Prior POC/.test(captions[0].text)&&/Review/.test(captions[0].text)&&/Day Open/.test(captions[0].text));
    const long=candidate.__test.priceCaptions([{name:'Very long reference caption '.repeat(6),value:25200.25,color:'#fff',showPrice:true}],.25,25200);
    const text=allItems(long.children).find(item=>item.tag==='Text'&&/^price-caption-/.test(item.key)).text;assert.ok(text.endsWith('25200.25'));assert.ok(text.slice(0,text.lastIndexOf('  ')).length<=39);assert.ok(text.includes('...'));
});
test('Status and caption text have explicit foreground depth above their background',()=>{
    const calc=crowded(candidate),normal=calc.draw(1000),warning=calc.warning('Invalid input');
    for(const items of [normal,warning]){
        const status=items.find(item=>item.key==='profile-status');assert.ok(status);
        const foreground=status.children.find(item=>item.key==='profile-status-foreground'),background=status.children.find(item=>item.key==='profile-status-background'||item.key==='warning-bg');
        assert.ok(foreground&&foreground.tag==='Container'&&background&&background.tag==='Shapes');
        assert.ok(depth(foreground)>depth(status)&&depth(foreground)>depth(background),'Status foreground must rise above its background layer');
        assert.ok(allItems(foreground.children).some(item=>item.tag==='Text'&&item.key==='profile-status-text'));
    }
    const captions=normal.find(item=>item.key==='price-captions');assert.ok(captions);
    const foregrounds=captions.children.filter(item=>/^caption-foreground-/.test(item.key));assert.ok(foregrounds.length>=12);
    for(const foreground of foregrounds){const suffix=foreground.key.slice('caption-foreground-'.length),background=captions.children.find(item=>item.key==='caption-background-'+suffix);assert.ok(background&&background.tag==='Shapes');assert.ok(depth(foreground)>depth(captions)&&depth(foreground)>depth(background),'Caption foreground must rise above its background layer');assert.ok(allItems(foreground.children).some(item=>item.tag==='Text'&&item.key==='price-caption-'+suffix));}
});
for(const preset of ['essential','context','full'])test(`${preset} changes display density without deleting stored profiles or references`,()=>{
    const calc=crowded(candidate,1,preset,true);
    calc.completed=[profile('US',0,{vah:25203,poc:25200,val:25197},true),profile('ON',100,{vah:25204,poc:25201,val:25198},true),profile('US',200,{vah:25205,poc:25202,val:25199},true)];
    const before=financialState(calc),items=calc.draw(1000),keys=allItems(items).map(item=>item.key);
    assert.equal(financialState(calc),before,'Drawing mutated financial data');assert.equal(calc.completed.length,3);
    const histogramStarts=new Set(allItems(items).filter(item=>item.tag==='Shapes'&&/^profile-\d+(?:out|in)$/.test(item.key)).flatMap(item=>item.primitives).map(item=>item.position.x.value));
    assert.equal(histogramStarts.size,preset==='full'?4:2);
    const hasReference=keys.some(key=>/^ref-line-/.test(key));assert.equal(hasReference,preset==='full');
    assert.equal(keys.some(key=>/^prior-/.test(key)),preset!=='essential');assert.equal(keys.some(key=>/^zone-/.test(key)),preset!=='essential');
});

for(const interval of [1,5])test(`${interval}m completed histogram geometry is reused and cache retention remains bounded`,()=>{
    const calc=make(candidate,interval,{completedProfiles:2,showDashboard:false,showHistory:false});
    const input=bars(interval,5820),h=history(input);let remembered=null,rememberedItems=null,sawEviction=false;
    for(let i=0;i<input.length;i++){
        const out=calc.map(entity(input[i],i===input.length-1),i,h);
        if(i%(60/interval)!==0&&i!==input.length-1)continue;
        const items=i===input.length-1?out.graphics.items:calc.draw(input[i].index);
        assert.ok(calc.histogramCache instanceof Map);assert.ok(calc.histogramCache.size<=calc.completed.length,'Histogram cache exceeded retained completed profile count');assert.equal(calc.histogramCache.has(calc.active),false,'Mutable active geometry must not be cached');
        if(remembered&&calc.completed.includes(remembered)){
            assert.strictEqual(calc.histogramCache.get(remembered),rememberedItems,'Immutable completed geometry rebuilt');
            const cached=calc.histogramCache.get(remembered);assert.ok(allItems(items).some(item=>item.primitives===cached.outside)&&allItems(items).some(item=>item.primitives===cached.inside),'Drawing copied cached primitive arrays');
        }else if(remembered){assert.equal(calc.histogramCache.has(remembered),false,'Expired profile geometry retained');sawEviction=true;remembered=null;}
        if(!remembered&&calc.completed.length){remembered=calc.completed[0];rememberedItems=calc.histogramCache.get(remembered);assert.ok(rememberedItems);}
    }
    assert.ok(sawEviction,'Fixture must exercise completed profile eviction');
});
for(const interval of [1,5])test(`${interval}m active histogram updates after a newly closed candle`,()=>{
    const calc=make(candidate,interval,{showDashboard:false,showHistory:false}),input=bars(interval,30*interval);
    feed(calc,input.slice(0,20));const before=calc.draw(input[19].index);
    const oldShape=before.find(item=>/^profile-\d+in$/.test(item.key));assert.ok(oldShape);
    input[19]={...input[19],o:25200,l:25198,h:25220,c:25210,v:1000000};
    const after=calc.map(entity(input[20],true),20,history(input));
    const newShape=after.graphics.items.find(item=>/^profile-\d+in$/.test(item.key));assert.ok(newShape);
    assert.notStrictEqual(newShape.primitives,oldShape.primitives,'Active mutable geometry was reused');
    assert.notEqual(JSON.stringify(newShape.primitives),JSON.stringify(oldShape.primitives),'New closed-bar distribution was not reflected');
    assert.equal(calc.histogramCache.has(calc.active),false);
});
test('Prior US and futures gaps stay explicit even when the current profile has no gaps',()=>{
    const calc=crowded(candidate);calc.prior.absent=3;calc.fAbsent=2;
    const text=statusText(calc.draw(1000));assert.ok(/Prior US partial: 3m absent/.test(text));assert.ok(/Futures VWAP partial/.test(text));assert.equal(calc.active.absent,0);
});
for(const interval of [1,5])for(const scenario of ['developing','complete','sparse','missing-open','zero-volume','invalid'])test(`${interval}m ${scenario} quality remains visible with dashboard disabled`,()=>{
    const calc=make(candidate,interval,{showDashboard:false,displayPreset:'essential'});
    let input=bars(interval,scenario==='complete'||scenario==='sparse'?930:30,scenario==='sparse'?new Set([interval*2]):new Set());
    if(scenario==='missing-open')input=input.slice(1).map((b,index)=>({...b,index,sequence:index}));
    if(scenario==='zero-volume')input=input.map(b=>({...b,v:0}));
    if(scenario==='invalid')input[input.length-2]={...input[input.length-2],v:NaN};
    const result=feed(calc,input),text=statusText(result.out.graphics.items);
    assert.ok(/Estimated\s+OHLCV/i.test(text));assert.ok(text.includes(interval+'m'));assert.ok(/18:00.*09:30/.test(text));
    if(scenario==='complete')assert.ok(/Complete/.test(text));else if(scenario==='developing')assert.ok(/Developing/.test(text));else assert.ok(/Partial|Waiting|Invalid|Unavailable|missing/i.test(text),'Quality must disclose incomplete/invalid coverage: '+text);
    if(scenario==='sparse'){assert.equal(calc.active.complete,true);assert.equal(calc.active.absent,interval);assert.ok(/Partial/i.test(text),'Sparse session must not be presented as complete');}
});
for(const interval of [1,5])test(`${interval}m missing closed history retains an explicit quality warning`,()=>{
    const calc=make(candidate,interval,{showDashboard:false}),input=bars(interval,2*interval);
    const h=history(input);h.get=i=>i===1?undefined:input[i]?entity(input[i]):undefined;
    const out=calc.map(entity(input[2],true),2,h),text=statusText(out.graphics.items);
    assert.ok(/Estimated OHLCV/.test(text));assert.ok(/Partial|unavailable|missing/i.test(text),'Missing history must not retain a no-gaps quality claim');
    assert.equal(out.dataReady,0);
});
for(const interval of [1,5])test(`${interval}m initial live candle still shows estimate status before any closed bar`,()=>{
    const calc=make(candidate,interval,{showDashboard:false}),input=bars(interval,0),out=calc.map(entity(input[0],true),0,history(input));
    const text=statusText(out.graphics&&out.graphics.items);assert.ok(/Estimated OHLCV/.test(text));assert.ok(!/Complete/.test(text));
});
console.log(`\n${passed} passed; ${failed} failed. ${candidatePath}`);process.exitCode=failed?1:0;
