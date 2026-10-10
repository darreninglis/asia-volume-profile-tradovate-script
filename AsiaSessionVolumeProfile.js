// Asia session Volume Profile — native Tradovate port.
// Uses CLOSED 1- or 5-minute OHLCV, uniformly allocated over each candle's range.
// Five-minute profiles are coarser approximations; no minute data is fabricated.
// No orders, network requests, or native volume-at-price substitution.
const predef = require('./tools/predef');
const {du, px, op} = require('./tools/graphics');
const MIN = 60000;
let nyDst;
// US daylight-saving rules from 2007 onward; independent of browser locale.
function ny(t) {
    const year=new Date(t).getUTCFullYear();
    // Bound the cache to one year, including when historical replays cross years.
    if(!nyDst || nyDst.year!==year) {
        const marchFirst=new Date(Date.UTC(year,2,1)).getUTCDay();
        const novemberFirst=new Date(Date.UTC(year,10,1)).getUTCDay();
        nyDst={year,start:Date.UTC(year,2,8+(7-marchFirst)%7,7),end:Date.UTC(year,10,1+(7-novemberFirst)%7,6)};
    }
    const local=new Date(t-(t>=nyDst.start && t<nyDst.end?4:5)*3600000);
    return {y:local.getUTCFullYear(),m:local.getUTCMonth()+1,d:local.getUTCDate(),minute:local.getUTCHours()*60+local.getUTCMinutes()};
}
function dateKey(a, shift) {return new Date(Date.UTC(a.y,a.m-1,a.d+(shift||0))).toISOString().slice(0,10);}
function session(t) {
    const a=ny(t), minute=a.minute;
    const weekday=new Date(Date.UTC(a.y,a.m-1,a.d)).getUTCDay();
    const future=dateKey(a,minute<1080?-1:0);
    const kind=minute>=570 && minute<960 && weekday>0 && weekday<6 ? 'US' : minute>=1080 || minute<570 ? 'ON' : null;
    return {kind,key:kind==='US'?dateKey(a)+' US':kind==='ON'?future+' ON':null,future,minute,
        atStart:kind==='US'?minute===570:kind==='ON'?minute===1080:false};
}
function levels(p,step,tick,percent) {
    if(!p || !p.good || !(p.total>0) || !p.rows.length) return null;
    const n=p.rows.length, mid=(n-1)/2; let peak=0;
    for(let j=1;j<n;j++) if(p.rows[j]>p.rows[peak] || (p.rows[j]===p.rows[peak] && Math.abs(j-mid)<Math.abs(peak-mid))) peak=j;
    let lo=peak,hi=peak,sum=p.rows[peak]; const target=p.total*percent/100;
    while(sum<target && (lo>0 || hi<n-1)) {
        const below=lo>0?p.rows[lo-1]:-1, above=hi<n-1?p.rows[hi+1]:-1;
        const up=above>below || (above===below && hi+1-peak<=peak-(lo-1));
        const v=up?above:below;
        if(up) hi++; else lo--; sum+=v;
    }
    const round=v=>Math.round(v/tick)*tick;
    return {vah:round((p.first+hi+1)*step),poc:round((p.first+peak+.5)*step),val:round((p.first+lo)*step),peak,lo,hi};
}
function createProfile(s,t,index) {
    return {key:s.key,kind:s.kind,first:null,rows:[],total:0,pv:0,startIndex:index,endIndex:index,last:t,good:s.atStart,reason:s.atStart?'Collecting':'Session-open history missing',observed:0,absent:0,cumulative:[],levels:null,complete:false};
}
function add(p,b,step,duration) {
    if(!p.good) return;
    if(![b.h,b.l,b.c,b.v].every(Number.isFinite) || b.h<b.l || b.v<0) {p.good=false;p.reason='Invalid price or volume';p.levels=null;return;}
    if(b.t<p.last || (b.t-p.last)%duration) {p.good=false;p.reason='Misaligned chart bars';p.levels=null;return;}
    p.absent+=(b.t-p.last)/MIN;
    const bottom=Math.floor(b.l/step+1e-7),top=Math.max(bottom,b.h===b.l?bottom:Math.ceil(b.h/step-1e-7)-1);
    const first=p.first===null?bottom:Math.min(p.first,bottom),last=p.first===null?top:Math.max(p.first+p.rows.length-1,top);
    if(last-first+1>1200) {p.good=false;p.reason='Row limit: increase ticks per row';p.levels=null;return;}
    if(p.first===null)p.first=bottom;
    if(p.first>first){p.rows=Array(p.first-first).fill(0).concat(p.rows);p.first=first;}
    while(p.rows.length<last-p.first+1)p.rows.push(0);
    for(let k=bottom;k<=top;k++) p.rows[k-p.first]+=b.v*(b.h===b.l?1:Math.max(0,Math.min(b.h,(k+1)*step)-Math.max(b.l,k*step))/(b.h-b.l));
    p.total+=b.v;p.pv+=(b.h+b.l+b.c)/3*b.v;p.observed++;p.last=b.t+duration;p.endIndex=b.index;p.reason=p.total>0?'Ready':'Waiting for volume';
    p.cumulative.push({minute:ny(b.t).minute,total:p.total});
    p.complete=ny(b.t+duration).minute===(p.kind==='US'?960:570);
}
function bar(d,index) {return {t:+new Date(d.timestamp()),h:d.high(),l:d.low(),c:d.close(),o:d.open(),v:d.volume(),index:d.index(),sequence:index,tradeDate:typeof d.tradeDate==='function'?d.tradeDate():undefined};}
function line(key,y,x1,x2,color,width) {return {tag:'LineSegments',key,lines:[{tag:'Line',a:{x:du(x1),y:du(y)},b:{x:du(x2),y:du(y)}}],lineStyle:{color,lineWidth:width||1}};}
// rightMiddle positions text to the right of its anchor in the live renderer.
function text(key,value,x,y,color,size) {return {tag:'Text',key,text:value,point:{x,y},style:{fontSize:size||12,fill:color},textAlignment:'rightMiddle'};}
// Captions are presentation only; the corresponding reference prices stay exact.
function referenceCaption(name) {
    return name.replace(/Prev Day/g,'Prev day').replace(/Prev Week/g,'Prev week')
        .replace(/New York/g,'NY').replace(/London/g,'LDN').replace(/Tokyo/g,'TKY')
        .replace(/Monday/g,'Mon').replace(/Daily/g,'Day').replace(/Weekly/g,'Week')
        .replace(/ \(trade close\)/g,' (close)');
}
// The live Tradovate renderer uses percent opacity (verified against 1 vs 50).
// Keep callers in fractions and convert at the graphics boundary.
function fill(color,opacity) {return {color,opacity:Math.max(0,Math.min(1,opacity))*100};}
function rect(key,x,y,w,h,color,opacity) {return {tag:'Shapes',key,primitives:[{tag:'Rectangle',position:{x,y},size:{width:w,height:h}}],fillStyle:fill(color,opacity)};}
// Reference levels use only supplied, completed minute bars. An incomplete
// first period never becomes an apparently complete prior period.
function tradingDate(b) {
    const v=b.tradeDate;
    if(v!==undefined && v!==null) {
        const digits=String(v).replace(/-/g,'');
        if(/^\d{8}$/.test(digits))return digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6,8);
    }
    const local=ny(b.t);
    return dateKey(local,local.minute>=1080?1:0);
}
function referenceKeys(day,date=new Date(day+'T12:00:00Z')) {
    const weekday=date.getUTCDay();
    const monday=new Date(+date-((weekday+6)%7)*86400000).toISOString().slice(0,10);
    return {D:day,W:monday,M:day.slice(0,7),Q:day.slice(0,4)+'-Q'+(Math.floor((date.getUTCMonth())/3)+1),Y:day.slice(0,4)};
}
function traditionalPivots(high,low,close) {
    const p=(high+low+close)/3;
    return {P:p,R1:2*p-low,S1:2*p-high,R2:p+high-low,S2:p-high+low,
        R3:2*p+high-2*low,S3:2*p-2*high+low,R4:3*p+high-3*low,S4:3*p-3*high+low,
        R5:4*p+high-4*low,S5:4*p-4*high+low};
}
function zoneWidths(props,tick,area,atr) {
    const total=props.adaptiveWidth && atr?Math.max(Math.min(props.minWidth,props.maxWidth),Math.min(Math.max(props.minWidth,props.maxWidth),atr*props.atrFactor)):props.zoneWidth;
    const half=g=>Math.max(tick,Math.floor(Math.min(total/2,g*.4)/tick)*tick);
    return {high:half(area.vah-area.poc),low:half(area.poc-area.val),poc:area.poc-area.val<3*tick || area.vah-area.poc<3*tick?0:half(Math.min(area.vah-area.poc,area.poc-area.val))};
}
function rangeClock(t,zone) {
    if(zone==='America/New_York')return ny(t);
    if(zone==='America/Chicago') {
        const a=ny(t),day=new Date(Date.UTC(a.y,a.m-1,a.d,0,a.minute-60));
        return {y:day.getUTCFullYear(),m:day.getUTCMonth()+1,d:day.getUTCDate(),minute:day.getUTCHours()*60+day.getUTCMinutes()};
    }
    if(!rangeClock.formatters)rangeClock.formatters={};
    const fmt=rangeClock.formatters[zone] || (rangeClock.formatters[zone]=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
    const parts={};fmt.formatToParts(new Date(t)).forEach(p=>{parts[p.type]=p.value;});
    return {y:+parts.year,m:+parts.month,d:+parts.day,minute:(+parts.hour%24)*60+(+parts.minute)};
}
class ReferenceOverlays {
    constructor(props,tick,duration) {this.props=props;this.tick=tick;this.duration=duration;this.periods={};this.ranges={};this.previousBar=null;this.monday=null;this.zoneHistory=[];this.historyKeys=[];}
    update(b,a) {
        const props=this.props,day=tradingDate(b),date=new Date(day+'T12:00:00Z'),keys=referenceKeys(day,date);
        const dow=date.getUTCDay(),minute=ny(b.t).minute,atOpen=minute===1080,old=this.previousBar;
        const oldCloseMinute=old?ny(old.t+this.duration).minute:null;
        const tail=old && oldCloseMinute===1020;
        const missingWithinDay=old && tradingDate(old)===day && b.t-old.t>this.duration && !(oldCloseMinute===975 && minute===990);
        const firstBusiness=date.getUTCDate()===1 || (dow===1 && date.getUTCDate()<=3);
        Object.keys(keys).forEach(kind=>{
            let state=this.periods[kind];if(!state)state=this.periods[kind]={current:null,previous:null};
            let p=state.current;
            if(!p || p.key!==keys[kind]) {
                state.previous=p && p.good && tail?p:null;
                const observedBoundary=!!p;
                const anchor=kind==='D'?true:kind==='W'?dow===1:kind==='M'?firstBusiness:kind==='Q'?firstBusiness && date.getUTCMonth()%3===0:firstBusiness && date.getUTCMonth()===0;
                p=state.current={key:keys[kind],good:atOpen && (anchor || (kind!=='D' && kind!=='W' && observedBoundary && tail)),o:b.o,h:b.h,l:b.l,c:b.c,start:b.index,last:b.t,day};
            } else {
                // Unscheduled missing minutes within a trading date invalidate
                // extrema. Overnight maintenance/weekend gaps are outside it.
                if(missingWithinDay)p.good=false;
                p.h=Math.max(p.h,b.h);p.l=Math.min(p.l,b.l);p.c=b.c;p.last=b.t;p.day=day;
            }
            if(![b.o,b.h,b.l,b.c].every(Number.isFinite))p.good=false;
        });
        const daily=this.periods.D.current;
        if(this.week!==keys.W){this.week=keys.W;this.monday=null;}
        if(dow===1)this.monday=daily;
        const zone=props.rangeTimezone || 'America/Chicago',clock=rangeClock(b.t,zone);
        [['London',props.londonStart,props.londonEnd],['NewYork',props.newYorkStart,props.newYorkEnd],['Tokyo',props.tokyoStart,props.tokyoEnd]].forEach(def=>{
            const start=Math.max(0,Math.min(1439,def[1])),end=Math.max(0,Math.min(1439,def[2]));
            const inside=start<end?clock.minute>=start && clock.minute<end:clock.minute>=start || clock.minute<end;
            if(!inside)return;
            const key=dateKey(clock,clock.minute<start?-1:0)+' '+def[0],r=this.ranges[def[0]];
            if(!r || r.key!==key)this.ranges[def[0]]={key,start:b.index,last:b.index,o:b.o,h:b.h,l:b.l,good:clock.minute===start};
            else {r.h=Math.max(r.h,b.h);r.l=Math.min(r.l,b.l);r.last=b.index;if(old && b.t-old.t>this.duration)r.good=false;}
        });
        if(props.showHistory && a.s.kind && !this.historyKeys.includes(a.s.key)){this.historyKeys.push(a.s.key);while(this.historyKeys.length>Math.max(1,Math.min(20,props.historySessions)))this.historyKeys.shift();this.zoneHistory=this.zoneHistory.filter(s=>this.historyKeys.includes(s.key));}
        if(props.showHistory && a.area && a.s.kind && a.area.vah-a.area.val>=3*this.tick) {
            const sessionKey=a.s.key;
            const w=zoneWidths(props,this.tick,a.area,a.priorAtr),prev=this.zoneHistory[this.zoneHistory.length-1];
            const step={key:sessionKey,x1:b.index,x2:b.index+1,vah:a.area.vah,poc:a.area.poc,val:a.area.val,wh:w.high,wl:w.low,wp:w.poc};
            if(prev && prev.key===step.key && prev.x2===step.x1 && ['vah','poc','val','wh','wl','wp'].every(k=>prev[k]===step[k]))prev.x2=step.x2;
            else this.zoneHistory.push(step);
            while(this.zoneHistory.length>6000)this.zoneHistory.shift();
        }
        this.previousBar=b;
    }
    draw(index) {
        const props=this.props,items=[],levels=[];
        if(props.showHistory) {
            [['val','wl',props.buyColor],['vah','wh',props.sellColor],['poc','wp',props.reviewColor]].forEach(def=>{
                const primitives=this.zoneHistory.filter(s=>s[def[1]]>0).map(s=>({tag:'Rectangle',position:{x:du(s.x1),y:du(s[def[0]]-s[def[1]])},size:{width:du(s.x2-s.x1),height:du(s[def[1]]*2)}}));
                if(primitives.length)items.push({tag:'Shapes',key:'historical-'+def[0],global:true,primitives,fillStyle:fill(def[2],.07)});
            });
        }
        const add=(name,value,start,color)=>{if(Number.isFinite(value))levels.push({name,value,start,color});};
        const definitions=[['D','Daily',props.dailyColor],['W','Weekly',props.weeklyColor],['M','Monthly',props.monthlyColor],['Q','Quarterly',props.quarterlyColor],['Y','Yearly',props.yearlyColor]];
        definitions.forEach(def=>{
            const kind=def[0],state=this.periods[kind];if(!state || !props['show'+def[1]])return;
            const cur=state.current,prior=state.previous;
            if(cur && cur.good && props[def[1].toLowerCase()+'Open'])add(def[1]+' Open',cur.o,cur.start,def[2]);
            const p=kind==='Y'?cur:prior;
            if(p && p.good) {
                const name=(kind==='Y'?'Current Year':'Prev '+({D:'Day',W:'Week',M:'Month',Q:'Quarter',Y:'Year'})[kind]);
                if(props[def[1].toLowerCase()+'Range']){add(name+' High',p.h,p.start,def[2]);add(name+' Low',p.l,p.start,def[2]);}
                if(props[def[1].toLowerCase()+'Mid'])add(name+' Mid',(p.h+p.l)/2,p.start,def[2]);
            }
        });
        if(props.showMonday && this.monday && this.monday.good) {
            add('Monday High',this.monday.h,this.monday.start,props.mondayColor);add('Monday Low',this.monday.l,this.monday.start,props.mondayColor);
            if(props.mondayMid)add('Monday Mid',(this.monday.h+this.monday.l)/2,this.monday.start,props.mondayColor);
        }
        if(props.showPivots) {
            const kind=props.pivotPeriod || 'D',state=this.periods[kind],p=state && state.previous;
            if(p && p.good) {
                const override=kind==='D' && props.settlementClose>0 && String(props.settlementDate)===p.key.replace(/-/g,'');
                const pivot=traditionalPivots(p.h,p.l,override?props.settlementClose:p.c),current=state.current;
                Object.keys(pivot).forEach(name=>{if(props['pivot'+name]!==false)add(name+(override?'':' (trade close)'),pivot[name],current.start,props.pivotColor);});
            }
        }
        [['London',props.showLondon,props.londonColor],['NewYork',props.showNewYorkRange,props.newYorkColor],['Tokyo',props.showTokyo,props.tokyoColor]].forEach(def=>{
            const r=this.ranges[def[0]];if(!def[1] || !r)return;
            const caption=def[0]==='NewYork'?'New York':def[0],suffix=r.good?'':' (partial)';
            add(caption+' High'+suffix,r.h,r.start,def[2]);add(caption+' Low'+suffix,r.l,r.start,def[2]);
            if(r.good)add(caption+' Open',r.o,r.start,def[2]);
            if(props.showSessionBoxes)items.push(rect('range-box-'+def[0],du(r.start),du(r.l),du(Math.max(1,r.last-r.start+1)),du(r.h-r.l),def[2],.05));
        });
        // Combine captions at identical tick-rounded prices, keeping the line's
        // exact mathematical value. No panel is needed to read the references.
        const groups=[];
        levels.forEach(l=>{
            const found=props.mergeReferences && groups.find(g=>Math.abs(g.value-l.value)<this.tick*.1);
            if(found){found.name+=' / '+l.name;found.start=Math.min(found.start,l.start);}else groups.push(Object.assign({},l));
        });
        groups.forEach((l,i)=>{
            const x=props.rightAnchoredReferences?Math.max(l.start,index-props.referenceAnchorBars):l.start,end=index+props.referenceLabelBars;
            items.push(line('ref-line-'+i,l.value,x,end,l.color,props.referenceLineWidth));
        });
        if(props.showReferenceLabels && groups.length) {
            // Let the renderer resolve screen-space gaps on every zoom/pan.
            // Spread both ways around the closest reference to avoid downward drift.
            const captions=groups.map((l,i)=>Object.assign({id:i},l)).sort((a,b)=>b.value-a.value);
            const close=this.previousBar?this.previousBar.c:captions[0].value;
            let anchor=0;
            captions.forEach((l,i)=>{if(Math.abs(l.value-close)<Math.abs(captions[anchor].value-close))anchor=i;});
            captions[anchor].y=du(captions[anchor].value);
            for(let i=anchor-1;i>=0;i--)captions[i].y=op(du(captions[i].value),'min',op(captions[i+1].y,'-',px(18)));
            for(let i=anchor+1;i<captions.length;i++)captions[i].y=op(du(captions[i].value),'max',op(captions[i-1].y,'+',px(18)));
            const children=[];
            captions.forEach(l=>{
                children.push({tag:'LineSegments',key:'ref-leader-'+l.id,lines:[{tag:'Line',a:{x:px(-466),y:du(l.value)},b:{x:px(-450),y:l.y}}],lineStyle:{color:l.color,lineWidth:1}});
                children.push(text('ref-caption-'+l.id,referenceCaption(l.name)+(props.referencePrices?'  '+l.value.toFixed(2):''),px(-444),l.y,l.color,12));
            });
            // Leave the last 180 pixels available for the native day volume profile.
            items.push({tag:'Container',key:'reference-captions',global:true,origin:{cs:'grid',h:'right',v:'top'},transformOps:[{tag:'ZIndex',zIndex:1}],children});
        }
        return items;
    }
}

class AsiaSessionVolumeProfile {
    init() {
        const defaults={};Object.keys(module.exports.params).forEach(key=>{defaults[key]=module.exports.params[key].def;});
        this.props=Object.assign({},defaults,this.props);
        Object.keys(defaults).forEach(key=>{if(this.props[key]===undefined)this.props[key]=defaults[key];});
        const limits={ticksPerRow:[1,1000,8],valueAreaPercent:[1,100,70],completedProfiles:[2,20,6],rvolLookback:[5,100,20],rvolMinSamples:[1,100,5],historySessions:[0,20,5],pocLookback:[1,240,6],acceptBars:[2,60,2],areaExtension:[1,300,36],labelOffset:[1,200,25],histogramWidth:[5,80,30],referenceAnchorBars:[1,5000,250],referenceLabelBars:[1,200,10],referenceLineWidth:[.5,5,1],areaTransparency:[0,95,80],maxPriorAgeDays:[1,365,7]};
        Object.keys(limits).forEach(key=>{const v=Number(this.props[key]),r=limits[key];this.props[key]=Math.max(r[0],Math.min(r[1],Number.isFinite(v)?v:r[2]));});
        ['ticksPerRow','completedProfiles','rvolLookback','rvolMinSamples','historySessions','pocLookback','acceptBars','maxPriorAgeDays'].forEach(key=>{this.props[key]=Math.floor(this.props[key]);});
        this.props.rvolMinSamples=Math.min(this.props.rvolMinSamples,this.props.rvolLookback);
        this.minutes=Number(this.chartDescription && this.chartDescription.elementSize);
        this.duration=([1,5].includes(this.minutes)?this.minutes:1)*MIN;
        this.inputWarning=null;this.drawCache=null;
        this.props=Object.assign({showDaily:true,dailyOpen:true,dailyRange:true,dailyMid:true,showWeekly:true,weeklyOpen:true,weeklyRange:true,weeklyMid:true,showMonthly:true,monthlyOpen:true,monthlyRange:true,monthlyMid:true,showQuarterly:true,quarterlyOpen:true,quarterlyRange:true,quarterlyMid:true,showYearly:true,yearlyOpen:true,yearlyRange:true,yearlyMid:true,showMonday:true,mondayMid:true,showPivots:true,showLondon:true,showNewYorkRange:true,showTokyo:true,showSessionBoxes:true,rightAnchoredReferences:true,mergeReferences:true,showReferenceLabels:true,referencePrices:true,showHistory:true,pivotP:true,pivotR1:true,pivotR2:true,pivotR3:true,pivotR4:true,pivotR5:true,pivotS1:true,pivotS2:true,pivotS3:true,pivotS4:true,pivotS5:true,londonStart:120,londonEnd:510,newYorkStart:510,newYorkEnd:1140,tokyoStart:1020,tokyoEnd:120,referenceLineWidth:1,referenceLabelBars:10,referenceAnchorBars:250,historySessions:5,settlementDate:0,settlementClose:0,dailyColor:'#29b6f6',weeklyColor:'#795500',monthlyColor:'#006B45',quarterlyColor:'#B3261E',yearlyColor:'#8E245D',mondayColor:'#455A64',pivotColor:'#B85C00',londonColor:'#AB47BC',newYorkColor:'#26a69a',tokyoColor:'#1976D2',pivotPeriod:'D',rangeTimezone:'America/Chicago'},this.props);this.tick=this.contractInfo.tickSize;this.step=this.tick*this.props.ticksPerRow;
        this.active=null;this.completed=[];this.prior=null;this.lastValidUS=null;this.previous=null;this.processed=-1;this.historyStart=null;
        this.future=null;this.fpv=0;this.fvol=0;this.fgood=false;this.fAbsent=0;
        this.above=0;this.below=0;this.context='Waiting for closed-bar context';this.area=null;
        this.tests={vah:false,poc:false,val:false};this.testsCovered=false;
        this.baselines={US:[],ON:[]};this.pocHistory=[];this.events=[];this.atr=null;this.trCount=0;this.trSum=0;
        this.snapshot={};this.references=new ReferenceOverlays(this.props,this.tick,this.duration);
    }
    supported() {const d=this.chartDescription;return !!d && d.underlyingType==='MinuteBar' && [1,5].includes(Number(d.elementSize)) && d.elementSizeUnit==='UnderlyingUnits';}
    closeProfile() {
        const p=this.active;if(!p)return;
        if(p.kind==='US') {
            if(p.good && p.complete && p.levels) {this.lastValidUS=p;this.prior=p;this.tests={vah:false,poc:false,val:false};this.testsCovered=true;}
            else this.prior=this.props.useLastFullUS?this.lastValidUS:null;
        }
        if(p.good && p.complete && p.levels) {
            this.completed.push(p);while(this.completed.length>this.props.completedProfiles)this.completed.shift();
            if(!p.absent){this.baselines[p.kind].push(p.cumulative);while(this.baselines[p.kind].length>this.props.rvolLookback)this.baselines[p.kind].shift();}
        }
    }
    commit(b) {
        const sequence=b.sequence===undefined?b.index:b.sequence;
        if(sequence<=this.processed)return;
        this.processed=sequence;this.drawCache=null;
        const valid=[b.t,b.o,b.h,b.l,b.c,b.v,b.index,sequence].every(Number.isFinite) && b.h>=b.l && b.o>=b.l && b.o<=b.h && b.c>=b.l && b.c<=b.h && b.v>=0;
        if(!valid || b.t%this.duration!==0 || (this.previous && b.t<=this.previous.t)) {
            this.inputWarning=!valid?'Invalid timestamp, OHLC or volume':'Misaligned or out-of-order chart bar';
            if(this.active){this.active.good=false;this.active.levels=null;this.active.reason=this.inputWarning;}
            this.fgood=false;this.testsCovered=false;
            return;
        }
        this.inputWarning=null;
        const s=session(b.t), old=this.previous, gap=old?b.t-old.t-this.duration:0;
        const tr=old?Math.max(b.h-b.l,Math.abs(b.h-old.c),Math.abs(b.l-old.c)):b.h-b.l;
        const priorAtr=this.atr;this.trCount++;this.trSum+=tr;this.atr=this.trCount===14?this.trSum/14:this.trCount>14?(this.atr*13+tr)/14:null;
        const changed=!this.active || this.active.key!==s.key;
        if(changed && this.active){this.closeProfile();this.active=null;}
        if(changed){this.above=0;this.below=0;this.context='Waiting for closed-bar context';this.pocHistory=[];}
        if(s.kind && !this.active)this.active=createProfile(s,b.t,b.index);
        if(this.prior && this.props.useLastFullUS && b.t-this.prior.last>this.props.maxPriorAgeDays*86400000)this.prior=null;
        const scheduled=old && ((ny(old.t+this.duration).minute===1020 && s.minute===1080) || (ny(old.t+this.duration).minute===975 && s.minute===990));
        if(gap>0 && !scheduled)this.testsCovered=false;
        if(this.prior) ['vah','poc','val'].forEach(k=>{const y=this.prior.levels[k];if(b.l<=y && b.h>=y)this.tests[k]=true;});
        if(this.future!==s.future){this.future=s.future;this.fpv=0;this.fvol=0;this.fgood=s.minute===1080;this.fAbsent=0;}
        // The input guard above already validated these prices and volume.
        if(this.fgood){this.fpv+=(b.h+b.l+b.c)/3*b.v;this.fvol+=b.v;if(gap>0 && !scheduled)this.fAbsent+=gap/MIN;}
        // NY context uses the profile snapshot available BEFORE this closed bar.
        const prevLevels=this.active?this.active.levels:null;
        const area=s.kind==='US' && !changed ? prevLevels : s.kind==='ON' && this.prior ? this.prior.levels:null;
        if(gap>0){this.above=0;this.below=0;}
        let location=0;
        if(area && area.vah>area.val) {
            if(s.kind==='US' && old && ((this.above && old.c<=area.vah)||(this.below && old.c>=area.val)||(!this.above && !this.below && (old.c>area.vah || old.c<area.val)))){this.above=0;this.below=0;}
            location=b.c>area.vah?1:b.c<area.val?-1:0;
            const wasOutside=this.above || this.below;
            this.above=location===1?Math.min(this.above+1,this.props.acceptBars):0;
            this.below=location===-1?Math.min(this.below+1,this.props.acceptBars):0;
            this.context=this.above>=this.props.acceptBars?'Holding above value':this.below>=this.props.acceptBars?'Holding below value':location===1?'Testing above value':location===-1?'Testing below value':wasOutside?'Back inside value':'Inside value — rejection watch';
        } else {this.above=0;this.below=0;this.context='Waiting for complete profile data';}
        this.area=area;
        if(this.active){add(this.active,b,this.step,this.duration);this.active.levels=levels(this.active,this.step,this.tick,this.props.valueAreaPercent);}
        const p=this.active, futures=this.fgood && this.fvol>0?this.fpv/this.fvol:null;
        const cash=p && p.kind==='US' && p.good && p.total>0?p.pv/p.total:null;
        const vwap=s.kind==='US' && this.props.cashVWAP?cash:s.kind?futures:null;
        const dev=p && p.levels;
        let migration='POC warming up';
        if(dev){this.pocHistory.push(dev.poc);if(this.pocHistory.length>this.props.pocLookback+1)this.pocHistory.shift();if(this.pocHistory.length>this.props.pocLookback){const move=this.pocHistory[this.pocHistory.length-1]-this.pocHistory[0],threshold=Math.max(this.tick,this.props.pocMinMove);migration=move>=threshold?'POC higher':move<=-threshold?'POC lower':'POC stable';}}
        let rvol=null,samples=0;
        if(p && p.good) {
            const base=this.baselines[p.kind],slot=p.cumulative.length-1;let sum=0;
            // Retain the original session order and floating-point addition order.
            for(let i=0;i<base.length;i++){const point=base[i][slot];if(point && point.minute===s.minute){sum+=point.total;samples++;}}
            if(samples>=this.props.rvolMinSamples){const average=sum/samples;if(average>0)rvol=p.total/average;}
        }
        const valueRelation=dev && this.prior ? dev.val>this.prior.levels.vah?'Value above prior US':dev.vah<this.prior.levels.val?'Value below prior US':dev.vah<=this.prior.levels.vah && dev.val>=this.prior.levels.val?'Value inside prior US':dev.vah>=this.prior.levels.vah && dev.val<=this.prior.levels.val?'Value spans prior US':'Value overlaps prior US':'Prior US comparison unavailable';
        this.snapshot={s,b,vwap,futures,area,location,migration,valueRelation,rvol,samples,priorAtr};this.references.update(b,this.snapshot);
        this.previous=b;
    }
    map(d,index,history) {
        // Tradovate can keep a calculator while changing its chart interval or
        // replacing/prepending history. Replay supplied closed bars after a change;
        // calculation formulas and duplicate protection remain unchanged.
        if(this.supported()) {
            let reset=Number(this.chartDescription.elementSize)!==this.minutes;
            const first=history && typeof history.get==='function'?history.get(0):null;
            const start=first?+new Date(first.timestamp()):NaN;
            // The host can replace the opening prefix while retaining the latest
            // sequence/timestamp. That still requires a complete history replay.
            if(Number.isFinite(start) && this.historyStart!==null && start!==this.historyStart)reset=true;
            if(!reset && this.previous && history && typeof history.get==='function') {
                const sequence=this.previous.sequence===undefined?this.previous.index:this.previous.sequence;
                const anchor=history.get(sequence);
                reset=!!anchor && +new Date(anchor.timestamp())!==this.previous.t;
                if(!anchor && typeof history.size==='function') {
                    const size=history.size();
                    if(Number.isFinite(size) && size>=0 && sequence>=size)reset=true;
                }
            }
            if(reset)this.init();
            if(Number.isFinite(start))this.historyStart=start;
        }
        if(!this.supported())return d.isLast()?{graphics:{items:this.warning('Use a standard 1- or 5-minute chart')}}:{};
        // Repeated live updates never accumulate the current candle twice.
        const lastClosed=d.isLast()?index-1:index;
        for(let i=this.processed+1;i<=lastClosed;i++) {
            const source=i===index?d:history && history.get(i);
            if(!source){this.inputWarning='Closed-bar history unavailable';this.drawCache=null;break;}
            this.commit(bar(source,i));
        }
        const a=this.snapshot, out={};
        if(this.inputWarning)return Object.assign({dataReady:0,contextState:0},d.isLast()?{graphics:{items:this.warning(this.inputWarning)}}:{});
        if(!a.b)return out;
        out.contextState=a.area?(this.above>=this.props.acceptBars?3:this.below>=this.props.acceptBars?-3:a.location):0;
        out.dataReady=this.active && this.active.good && this.active.levels && a.area && a.vwap!==null?1:0;
        if(this.active && this.active.levels){out.currentVAH=this.active.levels.vah;out.currentPOC=this.active.levels.poc;out.currentVAL=this.active.levels.val;}
        if(this.prior){out.priorVAH=this.prior.levels.vah;out.priorPOC=this.prior.levels.poc;out.priorVAL=this.prior.levels.val;}
        if(a.rvol!==null)out.sessionRVOL=a.rvol;
        if(this.props.showVWAP && a.vwap!==null)out.vwap=a.vwap;
        if(this.props.showFuturesComparison && a.futures!==null && (!a.s.kind || (a.s.kind==='US' && this.props.cashVWAP)))out.futuresVWAP=a.futures;
        if(this.props.showDeveloping && this.active && this.active.levels){out.devVAH=this.active.levels.vah;out.devPOC=this.active.levels.poc;out.devVAL=this.active.levels.val;}
        if(d.isLast()) {
            const key=this.processed+':'+d.index()+':'+(this.inputWarning||'');
            if(!this.drawCache || this.drawCache.key!==key)this.drawCache={key,items:this.draw(d.index()).map(item=>Object.assign({global:true},item))};
            out.graphics={items:this.drawCache.items};
        }
        return out;
    }
    warning(message) {return [{tag:'Container',key:'asia-warning',global:true,transformOps:[{tag:'ZIndex',zIndex:1}],origin:{cs:'grid',h:'left',v:'top'},children:[rect('warning-bg',px(10),px(12),px(510),px(29),'#241b12',.94),text('warning-text','Asia profile: '+message,px(18),px(27),'#ffcf80',12)]}];}
    draw(index) {
        const items=this.references.draw(index),a=this.snapshot,p=this.active;
        if(this.inputWarning || (p && (!p.good || !p.levels)))items.push(...this.warning(this.inputWarning || p.reason || 'Waiting for volume'));
        const profiles=this.completed.slice();if(p && p.good && p.levels)profiles.push(p);
        profiles.forEach((q,n)=>{
            const color=q.kind==='US'?this.props.usColor:this.props.overnightColor,L=q.levels,k='profile-'+n;
            const span=Math.max(1,q.endIndex-q.startIndex+1)*this.props.histogramWidth/100;
            if(this.props.showHistograms) {
                const outside=[],inside=[];
                q.rows.forEach((v,j)=>{const r={tag:'Rectangle',position:{x:du(q.startIndex),y:du((q.first+j)*this.step)},size:{width:du(span*v/q.rows[L.peak]),height:du(this.step)}};(j>=L.lo && j<=L.hi?inside:outside).push(r);});
                items.push({tag:'Shapes',key:k+'out',primitives:outside,fillStyle:fill(color,q.kind==='ON'?.20:.16)},{tag:'Shapes',key:k+'in',primitives:inside,fillStyle:fill(color,q.kind==='ON'?.58:.43)});
            }
            let end=q.endIndex+1;
            if(q.kind==='ON' && q.complete && this.props.extendOvernight && a.s.kind==='US' && dateKey(ny(q.last))===dateKey(ny(a.b.t)))end=index+this.props.labelOffset;
            if(this.props.showLevels)['vah','poc','val'].forEach(t=>{items.push(line(k+t,L[t],q.startIndex,end,color,t==='poc'?(q.kind==='ON'?3:2):1));});
            if(this.props.showHistograms)items.push(text(k+'caption',q.kind==='ON'?'ASIA / OVERNIGHT':'US',du(q.startIndex),op(du(L.vah),'-',px(18)),color,q.kind==='ON'?13:11));
        });
        if(this.prior && a.s.kind==='ON') ['vah','poc','val'].forEach(k=>{
            const y=this.prior.levels[k],name=k==='poc'?'PPOC':k==='vah'?'PVAH':'PVAL';
            items.push(line('prior-'+k,y,p?p.startIndex:index,index+this.props.labelOffset,this.props.priorColor,k==='poc'?2:1));
            items.push(text('prior-label-'+k,name+' '+y.toFixed(2),du(index+this.props.labelOffset),du(y),this.props.priorColor));
        });
        const A=a.area;
        if(this.props.showZones && A && A.vah-A.val>=3*this.tick) {
            const widths=zoneWidths(this.props,this.tick,A,a.priorAtr);
            const holdH=this.above>=this.props.acceptBars,holdL=this.below>=this.props.acceptBars;
            const rows=[['vah',A.vah,widths.high,holdH?this.props.buyColor:a.location===0?this.props.sellColor:this.props.neutralColor,holdH?'BUY?':a.location===0?'SELL?':'TEST '+this.above+'/'+this.props.acceptBars],['val',A.val,widths.low,holdL?this.props.sellColor:a.location===0?this.props.buyColor:this.props.neutralColor,holdL?'SELL?':a.location===0?'BUY?':'TEST '+this.below+'/'+this.props.acceptBars],['poc',A.poc,widths.poc,this.props.reviewColor,'REVIEW']];
            rows.forEach(r=>{if(r[0]==='poc' && (A.poc-A.val<3*this.tick || A.vah-A.poc<3*this.tick))return;items.push(rect('zone-'+r[0],du(index),du(r[1]-r[2]),du(this.props.areaExtension),du(r[2]*2),r[3],(100-this.props.areaTransparency)/100));items.push(text('zone-text-'+r[0],r[4]+' '+r[1].toFixed(2),du(index+this.props.areaExtension+1),du(r[1]),r[3]));});
        }
        if(this.props.showDashboard){
            const ready=p && p.good && p.levels;
            const asOf=ny(a.b.t+this.duration);
            const prior=this.prior?this.prior.key+' · '+this.prior.observed+' observed / '+this.prior.absent+' absent':'Unavailable — load complete US history';
            const test=k=>this.tests[k]?'Tested':this.testsCovered?'Untested':'Unknown';
            const lines=['ASIA SESSION VOLUME PROFILE · '+(a.s.kind==='US'?'NY CASH':a.s.kind==='ON'?'OVERNIGHT':'OUTSIDE WATCH HOURS'),this.context,
                'Profile: '+(ready?'Ready · closed '+this.minutes+'m bars':p?p.reason:'Waiting for session'),
                'As of '+dateKey(asOf)+' '+String(asOf.minute/60|0).padStart(2,'0')+':'+String(asOf.minute%60).padStart(2,'0')+' NY',
                ready?'VAH '+p.levels.vah.toFixed(2)+' · POC '+p.levels.poc.toFixed(2)+' · VAL '+p.levels.val.toFixed(2):'Current levels unavailable',
                'Prior US: '+prior,
                'VWAP: '+(a.vwap===null?'Anchor missing':a.vwap.toFixed(2)+' · '+(a.s.kind==='US' && this.props.cashVWAP?'Cash 09:30':'Futures 18:00')),
                a.migration+' · '+a.valueRelation,
                'RVOL: '+(a.rvol===null?'Warming up '+a.samples+'/'+this.props.rvolMinSamples+' full sessions':a.rvol.toFixed(2)+'× · '+a.samples+' sessions'),
                'PVAH '+test('vah')+' · PPOC '+test('poc')+' · PVAL '+test('val'),
                this.minutes+'m OHLCV approximation'+(this.minutes===5?' (coarser)':'')+' · '+this.props.ticksPerRow+' ticks/row · '+this.props.valueAreaPercent+'% VA',
                'Review areas only · no order signals'];
            if(p && p.absent)lines.push('Sparse data: '+p.absent+' absent minutes; no volume invented');
            const detail=this.props.reviewMode?lines:[lines[0],lines[1],lines[4],lines[6],lines[5],lines[8],lines[2]+' · '+lines[3],lines[11]];
            if(p && p.absent && !this.props.reviewMode)detail.push(lines[lines.length-1]);
            const right=this.props.panelOnRight!==false,bottom=this.props.panelAtBottom===true;
            const width=460,height=detail.length*21+20,x=right?-width-16:70,y=bottom?-height-16:48;
            items.push({tag:'Container',key:'dashboard',global:true,transformOps:[{tag:'ZIndex',zIndex:1}],origin:{cs:'grid',h:right?'right':'left',v:bottom?'bottom':'top'},children:[rect('panel',px(x),px(y),px(width),px(height),this.props.panelBackground,.94)].concat(detail.map((v,i)=>text('row-'+i,v,px(x+12),px(y+18+i*21),i===1?this.props.reviewColor:this.props.panelText,i===0?13:12)))});
        }
        return items;
    }
}
module.exports={name:'AsiaSessionVolumeProfile',description:'Asia session Volume Profile — closed 1m / 5m',calculator:AsiaSessionVolumeProfile,inputType:'bars',areaChoice:'overlay',tags:['Custom','Volume-based'],
    params:{settlementDate:predef.paramSpecs.number(0,1,0),settlementClose:predef.paramSpecs.number(0,.25,0),pivotPeriod:predef.paramSpecs.enum({D:'Daily',W:'Weekly',M:'Monthly'},'D'),rangeTimezone:predef.paramSpecs.enum({'America/Chicago':'Chicago (exchange)','America/New_York':'New York','Europe/London':'London','Asia/Tokyo':'Tokyo',UTC:'UTC','Australia/Melbourne':'Melbourne'},'America/Chicago'),showDaily:predef.paramSpecs.bool(true),showWeekly:predef.paramSpecs.bool(true),showMonthly:predef.paramSpecs.bool(true),showQuarterly:predef.paramSpecs.bool(true),showYearly:predef.paramSpecs.bool(true),showMonday:predef.paramSpecs.bool(true),showPivots:predef.paramSpecs.bool(true),showLondon:predef.paramSpecs.bool(true),showNewYorkRange:predef.paramSpecs.bool(true),showTokyo:predef.paramSpecs.bool(true),showSessionBoxes:predef.paramSpecs.bool(true),showHistory:predef.paramSpecs.bool(true),historySessions:predef.paramSpecs.number(5,1,0),ticksPerRow:predef.paramSpecs.period(8),valueAreaPercent:predef.paramSpecs.percent(70,1,1,100),completedProfiles:predef.paramSpecs.number(6,1,2),histogramWidth:predef.paramSpecs.percent(30,1,5,80),showHistograms:predef.paramSpecs.bool(true),showLevels:predef.paramSpecs.bool(true),extendOvernight:predef.paramSpecs.bool(true),showDeveloping:predef.paramSpecs.bool(false),showVWAP:predef.paramSpecs.bool(true),cashVWAP:predef.paramSpecs.bool(true),showFuturesComparison:predef.paramSpecs.bool(true),showDashboard:predef.paramSpecs.bool(false),panelOnRight:predef.paramSpecs.bool(true),panelAtBottom:predef.paramSpecs.bool(false),reviewMode:predef.paramSpecs.bool(false),showZones:predef.paramSpecs.bool(true),zoneWidth:predef.paramSpecs.number(10,.5,.5),adaptiveWidth:predef.paramSpecs.bool(false),atrFactor:predef.paramSpecs.number(.5,.1,.1),minWidth:predef.paramSpecs.number(4,.5,.5),maxWidth:predef.paramSpecs.number(16,.5,.5),areaExtension:predef.paramSpecs.number(36,1,12),areaTransparency:predef.paramSpecs.percent(80,1,0,95),labelOffset:predef.paramSpecs.number(25,1,1),acceptBars:predef.paramSpecs.number(2,1,2),pocLookback:predef.paramSpecs.period(6),pocMinMove:predef.paramSpecs.number(.25,.25,.25),rvolLookback:predef.paramSpecs.number(20,1,5),rvolMinSamples:predef.paramSpecs.number(5,1,5),useLastFullUS:predef.paramSpecs.bool(false),maxPriorAgeDays:predef.paramSpecs.period(7),usColor:predef.paramSpecs.color('#687187'),overnightColor:predef.paramSpecs.color('#54c48c'),priorColor:predef.paramSpecs.color('#abb7c7'),buyColor:predef.paramSpecs.color('#66bb6a'),sellColor:predef.paramSpecs.color('#ef8a80'),reviewColor:predef.paramSpecs.color('#8b8ba7'),neutralColor:predef.paramSpecs.color('#9598a1'),panelBackground:predef.paramSpecs.color('#ecf0f1'),panelText:predef.paramSpecs.color('#01040d')},
    plots:{contextState:{title:'Context: -3 holding below, 0 inside, +3 holding above'},dataReady:{title:'Context data ready'},currentVAH:{title:'Current VAH'},currentPOC:{title:'Current POC'},currentVAL:{title:'Current VAL'},priorVAH:{title:'Prior US VAH'},priorPOC:{title:'Prior US POC'},priorVAL:{title:'Prior US VAL'},sessionRVOL:{title:'Session RVOL'},vwap:{title:'Active session VWAP'},futuresVWAP:{title:'Futures VWAP 18:00 NY'},devVAH:{title:'Developing VAH'},devPOC:{title:'Developing POC'},devVAL:{title:'Developing VAL'}},
    plotter:predef.plotters.multiline(['vwap','futuresVWAP','devVAH','devPOC','devVAL']),schemeStyles:{dark:{vwap:predef.styles.plot({color:'#003fba',lineWidth:2}),futuresVWAP:predef.styles.plot({color:'#8b8ba7',lineWidth:1}),devVAH:predef.styles.plot('#1b5e20'),devPOC:predef.styles.plot('#1b5e20'),devVAL:predef.styles.plot('#1b5e20')},light:{vwap:predef.styles.plot({color:'#003fba',lineWidth:2}),futuresVWAP:predef.styles.plot('#8b8ba7')}}};
