// engine.js v7 — Real-world simulation
import State from './state.js';

const VOL = {
  bluechip:{ base:0.0003, spike:0.001 },
  stable:  { base:0.0004, spike:0.0015 },
  normal:  { base:0.0008, spike:0.003 },
  high:    { base:0.002,  spike:0.008 },
  extreme: { base:0.005,  spike:0.02 },
};
const LIQ = {
  thick:  { levels:10, baseSize:50000, spread:0.001 },
  medium: { levels:10, baseSize:10000, spread:0.003 },
  thin:   { levels:10, baseSize:2000,  spread:0.008 },
};
export const FEE_BUY  = 0.0015;
export const FEE_SELL = 0.0025;
const TICK_MS = 1000;
const FX_BASE = { 'USD/IDR':15800,'EUR/IDR':17200,'GBP/IDR':19900,'XAU/IDR':30000000,'XAU/USD':1900 };
const TICK_MOVE_LIMIT = {
  bluechip:0.0035, stable:0.005, normal:0.008, high:0.014, extreme:0.03,
};

// Saham IDX yang bayar dividen (dunia nyata: harus pernah pegang saat cum-date)
export const DIVIDEND_STOCKS = {
  'BBCA': { yieldPct:0.025, freq:'quarterly',  sector:'Perbankan' },
  'BMRI': { yieldPct:0.030, freq:'quarterly',  sector:'Perbankan' },
  'BBRI': { yieldPct:0.035, freq:'quarterly',  sector:'Perbankan' },
  'BBNI': { yieldPct:0.028, freq:'quarterly',  sector:'Perbankan' },
  'TLKM': { yieldPct:0.045, freq:'quarterly',  sector:'Telekomunikasi' },
  'UNVR': { yieldPct:0.038, freq:'quarterly',  sector:'Consumer' },
  'ASII': { yieldPct:0.032, freq:'quarterly',  sector:'Otomotif' },
  'HMSP': { yieldPct:0.055, freq:'quarterly',  sector:'Konsumer' },
  'ICBP': { yieldPct:0.020, freq:'quarterly',  sector:'Konsumer' },
  'PTBA': { yieldPct:0.060, freq:'biannual',   sector:'Pertambangan' },
  'ANTM': { yieldPct:0.018, freq:'annual',     sector:'Pertambangan' },
  'AALI': { yieldPct:0.022, freq:'annual',     sector:'Perkebunan' },
  'BSDE': { yieldPct:0.015, freq:'annual',     sector:'Properti' },
};

const CORR = {
  crypto_major: { assets:['BTC','ETH','BNB','SOL'],                  strength:0.55 },
  crypto_alt:   { assets:['ADA','XRP','DOT','LINK','AVAX'], leader:'BTC', strength:0.45 },
  crypto_small: { assets:['MATIC','UNI','ATOM','NEAR','ARB','OP','INJ','FTM'], leader:'ETH', strength:0.40 },
  crypto_meme:  { assets:['DOGE','PEPE'], leader:'BTC',              strength:0.3, canInverse:true },
  banking:      { assets:['BBCA','BMRI','BBRI','BBNI'],              strength:0.5 },
  consumer:     { assets:['UNVR','HMSP','ICBP','INDF'],              strength:0.4 },
  mining:       { assets:['PTBA','ANTM'],                            strength:0.45 },
};

let _tick=null, _ipoCheck=null;

// ─── Init ────────────────────────────────────────────────────
export function initMarket(assetsData) {
  const all=[...(assetsData.stocks||[]),...(assetsData.syariah||[]),...(assetsData.crypto||[])];
  const fxAssets=makeFxAssets();
  const cur=State.get('assets')||{};
  if (!cur.forex) { cur.forex=fxAssets; State.set('assets',{...cur}); }
  [...all,...fxAssets,...(State.get('listedAssets')||[]),...(State.get('customAssets')||[]).filter(isTradableAsset)].forEach(a=>{
    if (!State.get(`prices.${a.symbol}`)) initPrice(a);
    if (!State.get(`candles.${a.symbol}`)) initCandles(a.symbol,a.basePrice,a.vol||'normal');
    if (!State.get(`tradeTapes.${a.symbol}`)) State.set(`tradeTapes.${a.symbol}`,[]);
  });
}

function makeFxAssets(){
  return [
    {symbol:'USD/IDR',name:'US Dollar/Rupiah',  sector:'Forex',     basePrice:FX_BASE['USD/IDR'],vol:'normal',liq:'thick', currency:'IDR',isForex:true},
    {symbol:'EUR/IDR',name:'Euro/Rupiah',        sector:'Forex',     basePrice:FX_BASE['EUR/IDR'],vol:'normal',liq:'medium',currency:'IDR',isForex:true},
    {symbol:'GBP/IDR',name:'Pound/Rupiah',       sector:'Forex',     basePrice:FX_BASE['GBP/IDR'],vol:'high',  liq:'medium',currency:'IDR',isForex:true},
    {symbol:'XAU/IDR',name:'Emas (Gold)/Rupiah', sector:'Komoditas', basePrice:FX_BASE['XAU/IDR'],vol:'normal',liq:'medium',currency:'IDR',isForex:true},
    {symbol:'XAU/USD',name:'Gold/USD',           sector:'Komoditas', basePrice:FX_BASE['XAU/USD'],vol:'normal',liq:'medium',currency:'USD',isForex:true},
  ];
}

function initPrice(a,opts={}){
  const { freshBook=false } = opts;
  const dec=decimals(a.basePrice,a.currency);
  State.set(`prices.${a.symbol}`,{
    symbol:a.symbol,name:a.name,sector:a.sector||'',syariah:!!a.syariah,
    currency:a.currency,vol:a.vol||'normal',liq:a.liq||'medium',isForex:!!a.isForex,
    last:a.basePrice,open:a.basePrice,high:a.basePrice,low:a.basePrice,
    bid:round(a.basePrice*0.999,dec),ask:round(a.basePrice*1.001,dec),
    volume:0,change:0,changePct:0,
  });
  buildOrderBook(a.symbol,a.basePrice,a.liq||'medium',freshBook);
}

export function buildOrderBook(symbol,mid,liqProfile,isFresh=false){
  const{levels,baseSize,spread}=LIQ[liqProfile]||LIQ.medium;
  const depth=isFresh?Math.max(2,Math.floor(levels*0.3)):levels;
  const sizeMult=isFresh?0.08:1;
  const dec=mid<10?6:mid<1000?2:0;
  const bids=[],asks=[];
  for(let i=1;i<=depth;i++){
    const sf=spread*i,n=1+(Math.random()-.5)*.5,d=1/(1+i*.3);
    bids.push({price:round(mid*(1-sf),dec),qty:Math.max(50,Math.floor(baseSize*sizeMult*n*d))});
    asks.push({price:round(mid*(1+sf),dec),qty:Math.max(50,Math.floor(baseSize*sizeMult*n*d))});
  }
  bids.sort((a,b)=>b.price-a.price); asks.sort((a,b)=>a.price-b.price);
  State.set(`orderBooks.${symbol}`,{bids,asks});
}

function initFreshCandles(symbol,basePrice,simTime){
  const now=(simTime||State.get('simTime')||new Date()).getTime();
  const tfMs={ '1m':60e3,'5m':300e3,'15m':900e3,'1h':3.6e6,'4h':14.4e6,'1d':86.4e6 };
  const seed={};
  Object.entries(tfMs).forEach(([tf,ms])=>{
    const t=Math.floor(now/ms)*ms;
    seed[tf]=[{ t, o:basePrice, h:basePrice, l:basePrice, c:basePrice, v:0 }];
  });
  State.set(`candles.${symbol}`,seed);
}

function initCandles(symbol,base,volProfile){
  const TF=['1m','5m','15m','1h','4h','1d'];
  const CNT={'1m':200,'5m':200,'15m':200,'1h':200,'4h':100,'1d':60};
  const MS={'1m':60e3,'5m':300e3,'15m':900e3,'1h':3.6e6,'4h':14.4e6,'1d':86.4e6};
  const{base:v}=VOL[volProfile]||VOL.normal;
  const now=(State.get('simTime')||new Date()).getTime();
  const c={};
  TF.forEach(tf=>{
    let p=base,arr=[];
    for(let i=CNT[tf];i>=0;i--){
      const t=now-i*MS[tf],o=p;
      const ch=(Math.random()-.49)*v*4;
      const cl=round(o*(1+ch),o<10?6:o<1000?2:0);
      arr.push({t,o,h:round(Math.max(o,cl)*(1+Math.random()*v*2),o<10?6:o<1000?2:0),
                   l:round(Math.min(o,cl)*(1-Math.random()*v*2),o<10?6:o<1000?2:0),c:cl,
                   v:Math.floor(Math.random()*50000+10000)});
      p=cl;
    }
    c[tf]=arr;
  });
  State.set(`candles.${symbol}`,c);
}

// ─── Engine Loop ─────────────────────────────────────────────
export function startEngine(){
  if(_tick) clearInterval(_tick);
  _tick=setInterval(()=>{
    if(!State.get('simRunning')) return;
    const spd=Math.min(State.get('simSpeed')||1,50);
    for(let i=0;i<spd;i++) tick();
  },TICK_MS);
  if(_ipoCheck) clearInterval(_ipoCheck);
  _ipoCheck=setInterval(checkIPOAutoListing,10000);
}

export function stopEngine(){
  clearInterval(_tick);_tick=null;
  clearInterval(_ipoCheck);_ipoCheck=null;
}

export function tick(){
  const t=State.get('simTime');
  const nt=new Date(t.getTime()+60000);
  State.set('simTime',nt);

  // Check suspended assets / IHSG halt
  const suspended=State.get('suspendedAssets')||{};
  const ihsgHalted=State.get('ihsgHalted')||false;

  const a=State.get('assets')||{};
  const all=[
    ...(a.stocks||[]),...(a.syariah||[]),...(a.crypto||[]),
    ...(a.forex||[]),...(State.get('listedAssets')||[]),...(State.get('customAssets')||[]).filter(isTradableAsset),
  ];

  all.forEach(asset=>{
    if(suspended[asset.symbol]) return; // skip suspended
    if(ihsgHalted && asset.currency==='IDR' && !asset.isForex && !asset.isCrypto) return;
    updatePrice(asset,nt);
  });

  if(!ihsgHalted) applyCorrelations();
  applyAUMImpact();
  processAllPendingOrders();
  checkDividendCumDate(nt);
  processMonthlyDividends(nt);
  updateIHSG(all);
  checkIPOAutoListing();

  if(nt.getMinutes()%5===0) State.saveToStorage();
  State.emit('tick',nt);
}

// ─── IHSG Index ──────────────────────────────────────────────
function updateIHSG(all){
  const stocks=all.filter(a=>a.currency==='IDR'&&!a.isForex&&!a.isCrypto);
  if(!stocks.length) return;

  // IHSG approximation: free-float market cap weighted index
  // Index = 6000 * (Σ (price * freeFloatShares)) / (Σ (basePrice * freeFloatShares))
  let sumCurrent=0, sumBase=0, count=0;
  stocks.forEach(a=>{
    const p=State.get(`prices.${a.symbol}`); if(!p) return;
    const base=a.basePrice||p.open||p.last;
    if(!base||base<=0) return;
    const ffShares=estimateFreeFloatShares(a);
    sumCurrent+=p.last*ffShares;
    sumBase+=base*ffShares;
    count++;
  });
  if(!count||!sumBase) return;
  // Normalize to real-world IHSG range (6000-7500)
  const ratio=sumCurrent/sumBase;
  const ihsgVal=round(6000*ratio, 2);
  const prev=State.get('ihsg')||{value:ihsgVal,open:ihsgVal,history:[]};
  const change=round(ihsgVal-prev.open,2);
  const changePct=round((ihsgVal-prev.open)/(prev.open||1)*100,2);
  const now=State.get('simTime');
  const hist=prev.history||[];
  if(!hist.length||now.getTime()-(hist[hist.length-1]?.t||0)>=300000){
    hist.push({t:now.getTime(),v:ihsgVal});
    if(hist.length>288) hist.shift();
  }
  State.set('ihsg',{value:ihsgVal,open:prev.open,
    high:Math.max(prev.high||ihsgVal,ihsgVal),
    low:Math.min(prev.low||ihsgVal,ihsgVal),
    change,changePct,history:hist,lastUpdate:now.toISOString()});
}

// ─── Price Update ─────────────────────────────────────────────
function updatePrice(asset,simTime){
  const{symbol,vol,liq,currency,isForex}=asset;
  const ps=State.get(`prices.${symbol}`); if(!ps) return;
  const h=simTime.getHours(),dow=simTime.getDay(),min=simTime.getMinutes();
  if(!isForex&&currency==='IDR'){
    if(dow===0||dow===6) return;
    if(h<9||h>=16) return;
    if(h===9&&min===0){
      State.set(`prices.${symbol}`,{...ps,open:ps.last,high:ps.last,low:ps.last,change:0,changePct:0});
      // Reset IHSG open too
      const ih=State.get('ihsg');
      if(ih) State.set('ihsg',{...ih,open:ih.value,high:ih.value,low:ih.value,change:0,changePct:0});
      return;
    }
  } else if(isForex){
    if(dow===0||dow===6) return;
    if(h===0&&min===0){State.set(`prices.${symbol}`,{...ps,open:ps.last,high:ps.last,low:ps.last,change:0,changePct:0});return;}
  } else {
    // crypto 24/7
    if(h===0&&min===0){State.set(`prices.${symbol}`,{...ps,open:ps.last,high:ps.last,low:ps.last,change:0,changePct:0});return;}
  }
  const{base,spike}=VOL[vol]||VOL.normal;
  const dec=decimals(ps.last,currency);
  const vf=Math.random()<0.02?spike:base;
  const microTrend=((ps.last-(ps.open||ps.last))/(ps.open||ps.last))*-0.04;
  const gaussian=(randn()+randn()*0.35)*vf;
  const changeRaw=(gaussian*0.45)+microTrend;
  const lim=TICK_MOVE_LIMIT[vol]||0.008;
  const change=clamp(changeRaw,-lim,lim);
  const ob=State.get(`orderBooks.${symbol}`);
  let imb=0;
  if(ob?.bids?.length&&ob?.asks?.length){
    const bv=ob.bids.slice(0,3).reduce((s,l)=>s+l.qty,0);
    const av=ob.asks.slice(0,3).reduce((s,l)=>s+l.qty,0);
    imb=(bv-av)/(bv+av+1)*0.0002;
  }
  const boundedMove=clamp(change+imb,-lim,lim);
  const spread=(LIQ[liq]?.spread||0.003)*ps.last;
  let target=Math.max(0.000001,ps.last*(1+boundedMove));
  let bestBid=round(target-spread*.5,dec),bestAsk=round(target+spread*.5,dec);
  if(ob?.bids?.length&&ob?.asks?.length){
    bestBid=ob.bids[0].price;
    bestAsk=ob.asks[0].price;
    target=(bestBid+bestAsk)*0.5;
  }
  const newLast=Math.max(0.000001,round(target,dec));
  const openP=ps.open>0?ps.open:newLast;
  const changePct=Math.max(-99,Math.min(99,round((newLast-openP)/openP*100,2)));
  State.set(`prices.${symbol}`,{...ps,last:newLast,
    bid:bestBid,ask:bestAsk,
    high:Math.max(ps.high,newLast),low:Math.min(ps.low,newLast),
    change:round(newLast-openP,dec),changePct,
    volume:(ps.volume||0)+Math.floor(Math.random()*5000),
  });
  updateCandles(symbol,simTime,newLast,Math.floor(Math.random()*5000));
  refreshOrderBook(symbol,newLast,liq||'medium',dec);
}

// ─── Correlations & AUM ──────────────────────────────────────
function applyCorrelations(){
  const suspended=State.get('suspendedAssets')||{};
  const ihsgHalted=State.get('ihsgHalted')||false;
  Object.values(CORR).forEach(group=>{
    const leader=group.leader||group.assets[0];
    if(suspended[leader]) return;
    const lp=State.get(`prices.${leader}`);
    if(!lp||Math.abs(lp.changePct||0)<0.15) return;
    group.assets.forEach(sym=>{
      if(sym===leader) return;
      if(suspended[sym]) return;
      // Skip IDR stocks if IHSG halted
      if(ihsgHalted){const sp2=State.get(`prices.${sym}`);if(sp2&&sp2.currency==='IDR'&&!sp2.isForex)return;}
      const sp=State.get(`prices.${sym}`); if(!sp) return;
      const corr=group.strength*(0.5+Math.random()*.5);
      let effect=(lp.changePct/100)*corr*0.1;
      if(group.canInverse&&Math.random()<0.15) effect=-effect;
      effect=clamp(effect,-0.01,0.01);
      const dec=decimals(sp.last,sp.currency);
      const nl=Math.max(0.000001,round(sp.last*(1+effect),dec));
      const op=sp.open>0?sp.open:nl;
      State.set(`prices.${sym}`,{...sp,last:nl,change:round(nl-op,dec),
        changePct:Math.max(-99,Math.min(99,round((nl-op)/op*100,2)))});
    });
  });
}

export function computeAUM(){
  const ports=State.get('portfolio')||{};
  const fxRate=getForexRate('USD/IDR');
  let totalIDR=0; const byAsset={};
  Object.values(ports).forEach(port=>{
    totalIDR+=port.cash_idr||0;
    Object.entries(port.holdings||{}).forEach(([sym,h])=>{
      const ps=State.get(`prices.${sym}`); if(!ps) return;
      const valIDR=ps.currency==='IDR'?ps.last*h.qty:ps.last*h.qty*fxRate;
      totalIDR+=valIDR; byAsset[sym]=(byAsset[sym]||0)+valIDR;
    });
  });
  return{totalIDR,byAsset};
}

function applyAUMImpact(){
  const{byAsset}=computeAUM();
  Object.entries(byAsset).forEach(([sym,aumIDR])=>{
    const ps=State.get(`prices.${sym}`); if(!ps) return;
    const floatEst=ps.last*2000000;
    const ratio=aumIDR/(floatEst||1);
    if(ratio>0.01){
      const pressure=Math.min(ratio*0.05,0.001);
      const dec=decimals(ps.last,ps.currency);
      const nl=round(ps.last*(1+pressure),dec);
      const op=ps.open>0?ps.open:nl;
      State.set(`prices.${sym}`,{...ps,last:nl,
        changePct:Math.max(-99,Math.min(99,round((nl-op)/op*100,2)))});
    }
  });
}

export function applyTradeMarketImpact(symbol,side,qty,avgPrice,currency){
  const ps=State.get(`prices.${symbol}`); if(!ps) return;
  const fxRate=getForexRate('USD/IDR');
  const tradeIDR=currency==='IDR'?avgPrice*qty:avgPrice*qty*fxRate;
  let impactPct=0;
  if(tradeIDR>500e6) impactPct=side==='sell'?-0.008:0.008;
  else if(tradeIDR>50e6) impactPct=side==='sell'?-0.003:0.003;
  if(!impactPct) return;
  const dec=decimals(ps.last,ps.currency);
  const nl=Math.max(0.000001,round(ps.last*(1+impactPct),dec));
  const op=ps.open>0?ps.open:nl;
  State.set(`prices.${symbol}`,{...ps,last:nl,
    changePct:Math.max(-99,Math.min(99,round((nl-op)/op*100,2)))});
  Object.values(CORR).forEach(group=>{
    if(!group.assets.includes(symbol)) return;
    group.assets.forEach(sym=>{
      if(sym===symbol) return;
      const sp=State.get(`prices.${sym}`); if(!sp) return;
      const e=impactPct*group.strength*.3*(0.5+Math.random()*.5);
      const d=decimals(sp.last,sp.currency);
      const nl2=Math.max(0.000001,round(sp.last*(1+e),d));
      const op2=sp.open>0?sp.open:nl2;
      State.set(`prices.${sym}`,{...sp,last:nl2,
        changePct:Math.max(-99,Math.min(99,round((nl2-op2)/op2*100,2)))});
    });
  });
  if(tradeIDR>500e6){
    const msgs=side==='sell'
      ?[`Aksi jual besar-besaran ${symbol} menekan harga pasar`]
      :[`Akumulasi besar ${symbol} mendorong harga naik`];
    const evt={id:'IMPACT'+Date.now(),symbol,message:msgs[0],
      sentiment:side==='sell'?-0.02:0.02,category:'market',
      time:(State.get('simTime')||new Date()).toISOString(),read:false};
    State.push('newsEvents',evt); State.emit('news.new',evt);
  }
}

// ─── Dividend System (Real-world: cum-date based) ─────────────
// Records who held the stock at cum-date (ex-date -1 day)
// Users get unclaimed dividend → they can claim in wallet
function checkDividendCumDate(simTime){
  const month=simTime.getMonth()+1,day=simTime.getDate(),hour=simTime.getHours();
  if(day!==14||hour!==15) return; // Cum-date: 14th at 15:00 (ex-date is 15th)

  const portfolios=State.get('portfolio')||{};
  Object.entries(portfolios).forEach(([userId,port])=>{
    Object.entries(port.holdings||{}).forEach(([symbol,holding])=>{
      const divInfo=DIVIDEND_STOCKS[symbol]; if(!divInfo) return;
      const isPayMonth=divInfo.freq==='quarterly'?[3,6,9,12].includes(month)
        :divInfo.freq==='biannual'?[6,12].includes(month):month===12;
      if(!isPayMonth) return;

      const ps=State.get(`prices.${symbol}`); if(!ps) return;
      const paymentsPerYear=divInfo.freq==='quarterly'?4:divInfo.freq==='biannual'?2:1;
      const divPerShare=round((ps.last*divInfo.yieldPct)/paymentsPerYear,0);
      const totalDiv=divPerShare*holding.qty;
      if(totalDiv<=0) return;

      // Record as UNCLAIMED dividend
      const claimId='DIV'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,4).toUpperCase();
      const divRecord={
        id:claimId, userId, symbol,
        qty:holding.qty, divPerShare, totalAmount:totalDiv,
        currency:'IDR', cumDate:simTime.toISOString(),
        payDate:new Date(simTime.getTime()+86400000).toISOString(), // ex-date +1
        yieldPct:divInfo.yieldPct, claimed:false, type:'dividend',
      };
      const divs=State.get(`dividends.${userId}`)||[];
      // Avoid duplicate for same period
      const periodKey=`${symbol}_${month}_${simTime.getFullYear()}`;
      if(divs.find(d=>d.periodKey===periodKey)) return;
      divRecord.periodKey=periodKey;
      State.set(`dividends.${userId}`,[divRecord,...divs].slice(0,200));
      State.emit('dividend.available',divRecord);
    });
  });
}

function processMonthlyDividends(simTime){
  if(simTime.getDate()!==1||simTime.getHours()<9) return;
  const monthKey=`${simTime.getFullYear()}-${String(simTime.getMonth()+1).padStart(2,'0')}`;
  if(State.get('lastDividendSweep')===monthKey) return;
  State.set('lastDividendSweep',monthKey);

  const portfolios=State.get('portfolio')||{};
  Object.entries(portfolios).forEach(([userId,port])=>{
    Object.entries(port.holdings||{}).forEach(([symbol,holding])=>{
      const divInfo=DIVIDEND_STOCKS[symbol]; if(!divInfo) return;
      const ps=State.get(`prices.${symbol}`); if(!ps) return;
      const monthlyDivPerShare=round((ps.last*divInfo.yieldPct)/12,0);
      const totalDiv=monthlyDivPerShare*holding.qty;
      if(totalDiv<=0) return;
      const periodKey=`${symbol}_${monthKey}_monthly`;
      const divs=State.get(`dividends.${userId}`)||[];
      if(divs.find(d=>d.periodKey===periodKey)) return;
      const divRecord={
        id:'DIV'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,4).toUpperCase(),
        userId,symbol,qty:holding.qty,divPerShare:monthlyDivPerShare,totalAmount:totalDiv,
        currency:'IDR',cumDate:simTime.toISOString(),
        payDate:new Date(simTime.getTime()+3*86400000).toISOString(),
        yieldPct:divInfo.yieldPct,claimed:false,type:'dividend',
        note:'Dividen bulanan simulasi',periodKey,
      };
      State.set(`dividends.${userId}`,[divRecord,...divs].slice(0,200));
      State.emit('dividend.available',divRecord);
    });
  });
}

// Also track past holders for dividend (snapshot at cum-date)
// This is called after SELL transaction to record "held at cum-date" history
export function recordDividendEligibility(userId, symbol, qtyHeld, simTime){
  const month=simTime.getMonth()+1;
  const divInfo=DIVIDEND_STOCKS[symbol]; if(!divInfo) return;
  const isPayMonth=divInfo.freq==='quarterly'?[3,6,9,12].includes(month)
    :divInfo.freq==='biannual'?[6,12].includes(month):month===12;
  if(!isPayMonth) return;
  const day=simTime.getDate();
  // If sold before cum-date (14th), not eligible. If sold on/after cum-date, eligible.
  if(day<14) return;

  const ps=State.get(`prices.${symbol}`); if(!ps) return;
  const paymentsPerYear=divInfo.freq==='quarterly'?4:divInfo.freq==='biannual'?2:1;
  const divPerShare=round((ps.last*divInfo.yieldPct)/paymentsPerYear,0);
  const totalDiv=divPerShare*qtyHeld;
  if(totalDiv<=0) return;

  const periodKey=`${symbol}_${month}_${simTime.getFullYear()}_sold`;
  const divs=State.get(`dividends.${userId}`)||[];
  if(divs.find(d=>d.periodKey===periodKey)) return;

  const claimId='DIV'+Date.now().toString(36).toUpperCase()+'S';
  const divRecord={
    id:claimId, userId, symbol, qty:qtyHeld, divPerShare, totalAmount:totalDiv,
    currency:'IDR', cumDate:simTime.toISOString(),
    payDate:new Date(simTime.getTime()+86400000).toISOString(),
    yieldPct:divInfo.yieldPct, claimed:false, type:'dividend',
    note:'Sudah jual, tapi pegang saat cum-date', periodKey,
  };
  State.set(`dividends.${userId}`,[divRecord,...divs].slice(0,200));
  State.emit('dividend.available',divRecord);
}

export function claimDividend(userId, divId){
  const divs=State.get(`dividends.${userId}`)||[];
  const idx=divs.findIndex(d=>d.id===divId);
  if(idx===-1) return{ok:false,error:'Tidak ditemukan'};
  if(divs[idx].claimed) return{ok:false,error:'Sudah diclaim'};
  divs[idx]={...divs[idx],claimed:true,claimedAt:new Date().toISOString()};
  const port=State.get(`portfolio.${userId}`)||{};
  port.cash_idr=(port.cash_idr||0)+divs[idx].totalAmount;
  port.totalDividends=(port.totalDividends||0)+divs[idx].totalAmount;
  State.set(`portfolio.${userId}`,{...port});
  State.set(`dividends.${userId}`,[...divs]);
  recordTx(userId,{type:'dividend_claim',symbol:divs[idx].symbol,qty:divs[idx].qty,
    price:divs[idx].divPerShare,amount:divs[idx].totalAmount,fee:0,orderId:divs[idx].id,currency:'IDR'});
  State.emit(`portfolio.${userId}`,State.get(`portfolio.${userId}`));
  return{ok:true,amount:divs[idx].totalAmount};
}

export function claimAllDividends(userId){
  const divs=State.get(`dividends.${userId}`)||[];
  let total=0;
  let claimedCount=0;
  const updated=divs.map(d=>{
    if(d.claimed) return d;
    total+=d.totalAmount; claimedCount++; return{...d,claimed:true,claimedAt:new Date().toISOString()};
  });
  if(total<=0) return{ok:false,error:'Tidak ada dividen yang bisa diclaim'};
  State.set(`dividends.${userId}`,updated);
  const port=State.get(`portfolio.${userId}`)||{};
  port.cash_idr=(port.cash_idr||0)+total;
  port.totalDividends=(port.totalDividends||0)+total;
  State.set(`portfolio.${userId}`,{...port});
  recordTx(userId,{type:'dividend_claim_all',symbol:'DIV',qty:claimedCount,
    price:0,amount:total,fee:0,orderId:'DIVALL'+Date.now().toString(36).toUpperCase(),currency:'IDR'});
  State.emit(`portfolio.${userId}`,State.get(`portfolio.${userId}`));
  return{ok:true,total};
}

// ─── IPO System (Real-world) ──────────────────────────────────
// Phases: prelisting → subscription (users subscribe & pay) → allotment → listing (trading begins)
export function subscribeToIPO(userId, symbol, requestedLots){
  const a=State.get('assets')||{};
  const ipos=[...(a.ipo||[]),...(a.newCrypto||[]),...(State.get('customAssets')||[])];
  const ipo=ipos.find(x=>x.symbol===symbol);
  if(!ipo) return{ok:false,error:'IPO tidak ditemukan'};
  if(ipo.phase!=='subscription') return{ok:false,error:`IPO dalam fase ${ipo.phase}, belum bisa subscribe`};

  const port=State.get(`portfolio.${userId}`)||{};
  const cost=requestedLots*ipo.offerPrice;
  if((port.cash_idr||0)<cost) return{ok:false,error:`Saldo tidak cukup. Perlu: Rp${cost.toLocaleString()}`};

  // Block funds
  port.cash_idr=(port.cash_idr||0)-cost;
  port.blockedFunds=(port.blockedFunds||0)+cost;
  State.set(`portfolio.${userId}`,{...port});

  const subs=State.get('ipoSubscriptions')||{};
  if(!subs[userId]) subs[userId]={};
  subs[userId][symbol]={qty:requestedLots,cost,offerPrice:ipo.offerPrice,status:'pending'};
  State.set('ipoSubscriptions',subs);
  recordTx(userId,{type:'ipo_subscribe',symbol,qty:requestedLots,price:ipo.offerPrice,
    amount:cost,fee:0,orderId:'IPO'+Date.now().toString(36).toUpperCase(),currency:'IDR'});
  ipo.subscribed=(ipo.subscribed||0)+1;
  State.set('assets',{...a});
  State.saveToStorage();
  return{ok:true,qty:requestedLots,cost};
}

function checkIPOAutoListing(){
  const simNow=State.get('simTime')||new Date();
  const a=State.get('assets')||{};
  let anyListed=false;
  const sources=[
    {list:a.ipo||[]},{list:a.newCrypto||[]},{list:State.get('customAssets')||[]},
  ];
  sources.forEach(src=>{
    src.list.forEach(ipo=>{
      if(!ipo.phaseEnd||ipo.phase==='listed') return;
      if(new Date(ipo.phaseEnd)>simNow) return;
      if(ipo.phase==='prelisting'){
        ipo.phase='subscription';
        ipo.phaseEnd=new Date(simNow.getTime()+5*24*60*60*1000).toISOString();
        const preEvt={id:'IPOPH'+Date.now()+ipo.symbol,symbol:ipo.symbol,
          message:`📋 ${ipo.symbol} masuk fase subscription IPO.`,
          sentiment:0.03,category:'ipo',time:simNow.toISOString(),read:false};
        State.push('newsEvents',preEvt); State.emit('news.new',preEvt);
        return;
      }
      ipo.phase='listed'; anyListed=true;
      const premium=Math.min((ipo.subscribed||1)/10,0.5);
      const lp=round(ipo.offerPrice*(1+premium),ipo.currency==='IDR'?0:4);
      if(!State.get(`prices.${ipo.symbol}`)){
        initPrice({...ipo,basePrice:lp},{freshBook:true});
        initFreshCandles(ipo.symbol,lp,simNow);
      }
      // Add to listedAssets for normal trading
      const listed=State.get('listedAssets')||[];
      if(!listed.find(x=>x.symbol===ipo.symbol)){
        const tradingAsset={symbol:ipo.symbol,name:ipo.name,sector:ipo.sector||'IPO',
          basePrice:lp,vol:ipo.vol||'high',liq:ipo.liq||'medium',
          currency:ipo.currency||'IDR',syariah:!!ipo.syariah,fromIPO:true,
          isCrypto:ipo.isCrypto||false};
        listed.push(tradingAsset); State.set('listedAssets',listed);
      }
      // Allocate to subscribers
      allocateIPOShares(ipo.symbol,lp,ipo.currency||'IDR');
      const evt={id:'LISTING'+Date.now(),symbol:ipo.symbol,
        message:`🎉 ${ipo.symbol} (${ipo.name}) resmi listing! Harga perdana: ${lp} ${ipo.currency}, premium +${(premium*100).toFixed(0)}%`,
        sentiment:0.08+premium*0.1,category:'ipo',time:simNow.toISOString(),read:false};
      State.push('newsEvents',evt); State.emit('news.new',evt);
      State.emit('ipo.listed',ipo.symbol);
    });
  });
  if(anyListed){ State.set('assets',{...a}); State.saveToStorage(); }
}

function allocateIPOShares(symbol,listingPrice,currency){
  const subs=State.get('ipoSubscriptions')||{};
  const fxR=currency==='IDR'?1:getForexRate('USD/IDR');
  Object.entries(subs).forEach(([userId,userSubs])=>{
    const sub=userSubs[symbol]; if(!sub||sub.status==='fulfilled') return;
    const port=State.get(`portfolio.${userId}`)||{};
    // Unblock funds
    port.blockedFunds=Math.max(0,(port.blockedFunds||0)-sub.cost);
    // Oversubscribed → prorated allotment (simplified: full allotment)
    const allotQty=sub.qty;
    const allotCost=allotQty*sub.offerPrice;
    const refund=sub.cost-allotCost*fxR; // refund leftover if any
    port.cash_idr=(port.cash_idr||0)+refund;
    // Add holding
    if(!port.holdings) port.holdings={};
    const h=port.holdings[symbol]||{qty:0,avgCost:0,totalCost:0,currency};
    const nt=h.totalCost+allotCost*fxR,nq=h.qty+allotQty;
    port.holdings[symbol]={qty:nq,avgCost:round(nt/nq,6),totalCost:nt,currency};
    State.set(`portfolio.${userId}`,{...port});
    sub.status='fulfilled'; sub.listingPrice=listingPrice;
    const gain=(listingPrice-sub.offerPrice)*allotQty*fxR;
    State.emit('ipo.allocated',{userId,symbol,qty:allotQty,offerPrice:sub.offerPrice,listingPrice,gain});
    State.emit(`portfolio.${userId}`,State.get(`portfolio.${userId}`));
  });
  State.set('ipoSubscriptions',subs);
}

// ─── Crypto Creator ───────────────────────────────────────────
export function createCryptoCoin(userId,{symbol,name,totalSupply,initialPrice,description}){
  const port=State.get(`portfolio.${userId}`)||{};
  const listingFee=2000000; // 2jt listing fee
  if((port.cash_idr||0)<listingFee) return{ok:false,error:`Biaya server listing: Rp ${listingFee.toLocaleString()}`};

  const existing=[...((State.get('assets')||{}).crypto||[]),...(State.get('customAssets')||[]),...(State.get('listedAssets')||[])];
  if(existing.find(a=>a.symbol===symbol)) return{ok:false,error:`Simbol ${symbol} sudah ada`};

  port.cash_idr-=listingFee;
  // Creator gets 20% of total supply
  const creatorQty=Math.floor(totalSupply*0.2);
  if(!port.holdings) port.holdings={};
  port.holdings[symbol]={qty:creatorQty,avgCost:initialPrice,totalCost:creatorQty*initialPrice,currency:'IDR'};
  State.set(`portfolio.${userId}`,{...port});

  const asset={symbol,name,sector:'Meme/Custom',basePrice:initialPrice,vol:'extreme',
    liq:'thin',currency:'IDR',syariah:false,isCrypto:true,custom:true,
    description,totalSupply,creatorId:userId,
    createdAt:(State.get('simTime')||new Date()).toISOString()};
  const customs=[...(State.get('customAssets')||[]),asset];
  State.set('customAssets',customs);

  // Add to listedAssets so it's tradeable immediately
  const listed=[...(State.get('listedAssets')||[])];
  listed.push({...asset,fromIPO:false});
  State.set('listedAssets',listed);

  initPrice(asset,{freshBook:true});
  initFreshCandles(symbol,initialPrice,State.get('simTime')||new Date());

  // Announce
  const evt={id:'LAUNCH'+Date.now(),symbol,
    message:`🚀 ${symbol} (${name}) baru diluncurkan! Total supply: ${totalSupply.toLocaleString()} coin. Creator pegang 20%.`,
    sentiment:0.1,category:'crypto',time:(State.get('simTime')||new Date()).toISOString(),read:false};
  State.push('newsEvents',evt); State.emit('news.new',evt);
  State.emit('crypto.launched',{symbol,name,creatorId:userId});
  State.saveToStorage();
  return{ok:true,creatorQty,listingFee};
}

export function rugPullCrypto(userId,symbol){
  const port=State.get(`portfolio.${userId}`)||{};
  const holding=port.holdings?.[symbol];
  if(!holding||holding.qty<=0) return{ok:false,error:'Tidak ada kepemilikan untuk rugpull'};

  const ps=State.get(`prices.${symbol}`); if(!ps) return{ok:false,error:'Harga tidak ditemukan'};
  const fxR=ps.currency==='IDR'?1:getForexRate('USD/IDR');
  const totalValue=ps.last*holding.qty*fxR;

  // Sell ALL holdings at current price (dump)
  port.cash_idr=(port.cash_idr||0)+totalValue*(1-FEE_SELL);
  port.realizedPnl=(port.realizedPnl||0)+(ps.last-holding.avgCost)*holding.qty*fxR;
  delete port.holdings[symbol];
  State.set(`portfolio.${userId}`,{...port});

  // Crash the price by 80-95%
  const crashPct=0.80+Math.random()*0.15;
  const dec=decimals(ps.last,ps.currency);
  const newLast=round(ps.last*(1-crashPct),dec);
  State.set(`prices.${symbol}`,{...ps,last:newLast,
    change:round(newLast-ps.open,dec),
    changePct:Math.max(-99,round((newLast-ps.open)/ps.open*100,2))});

  // 20% chance of fine
  const fined=Math.random()<0.2;
  let fine=0;
  if(fined){
    fine=round(totalValue*1.5,0); // 150% fine
    port.cash_idr=Math.max(-fine,(port.cash_idr||0)-fine);
    State.set(`portfolio.${userId}`,{...port});
  }

  // Generate angry news + social media
  const angryMsgs=[
    `🚨 RUGPULL! ${symbol} crash ${(crashPct*100).toFixed(0)}%! Creator jual semua! Komunitas marah besar!`,
    `⚠️ ${symbol} DITINGGAL DEVELOPERNYA! Harga ambruk! Ribuan investor merugi!`,
    `🔥 SCAM ALERT: ${symbol} diduga rugpull. OJK sedang menyelidiki.`,
  ];
  const evt={id:'RUGPULL'+Date.now(),symbol,
    message:angryMsgs[Math.floor(Math.random()*angryMsgs.length)],
    sentiment:-0.5,category:'crypto',time:(State.get('simTime')||new Date()).toISOString(),read:false};
  State.push('newsEvents',evt); State.emit('news.new',evt);

  // Social media notifications
  const sosmedMsgs=fined?[
    `😡 @${symbol}Dev PENIPU! Kena denda OJK ${fmtIDR(fine)}!`,
    `🤬 Rugpull ${symbol}! Dev kena sanksi! Kembalikan uang kami!`,
  ]:[
    `😤 ${symbol} developer kabur! Laporan ke OJK sedang diproses!`,
    `💀 ${symbol} dead coin. Community hancur. Semua nyalahin developer.`,
    `😱 Gila ${symbol} rugpull! Untung aku udah cut loss sebelumnya!`,
  ];
  State.emit('rugpull',{symbol,crashPct,fined,fine,profitBefore:totalValue,sosmedMsgs});
  State.saveToStorage();
  return{ok:true,profit:totalValue*(1-FEE_SELL),fine,fined,crashPct,sosmedMsgs};
}

// ─── Asset Suspension / IHSG Halt ────────────────────────────
export function suspendAsset(symbol,reason){
  const suspended=State.get('suspendedAssets')||{};
  suspended[symbol]={reason,since:(State.get('simTime')||new Date()).toISOString()};
  State.set('suspendedAssets',suspended);
  const evt={id:'SUSPEND'+Date.now(),symbol,
    message:`⛔ ${symbol} disuspensi sementara. Alasan: ${reason}`,
    sentiment:-0.1,category:'market',time:(State.get('simTime')||new Date()).toISOString()};
  State.push('newsEvents',evt); State.emit('news.new',evt);
  State.emit('asset.suspended',{symbol,reason});
}
export function unsuspendAsset(symbol){
  const suspended=State.get('suspendedAssets')||{};
  delete suspended[symbol];
  State.set('suspendedAssets',suspended);
  State.emit('asset.unsuspended',symbol);
}
export function haltIHSG(reason){
  State.set('ihsgHalted',true);
  State.set('ihsgHaltReason',reason);
  const evt={id:'HALT'+Date.now(),symbol:'IHSG',
    message:`🔴 IHSG dihentikan sementara (Circuit Breaker). ${reason}`,
    sentiment:-0.3,category:'macro',time:(State.get('simTime')||new Date()).toISOString()};
  State.push('newsEvents',evt); State.emit('news.new',evt);
  State.emit('ihsg.halted',reason);
}
export function resumeIHSG(){
  State.set('ihsgHalted',false); State.set('ihsgHaltReason','');
  State.emit('ihsg.resumed',null);
}

// ─── Fast forward ─────────────────────────────────────────────
export function skipSimTime(minutes){
  const T=minutes/(365.25*24*60);
  const a=State.get('assets')||{};
  const all=[...(a.stocks||[]),...(a.syariah||[]),...(a.crypto||[]),
    ...(a.forex||[]),...(State.get('listedAssets')||[]),...(State.get('customAssets')||[])];
  const suspended=State.get('suspendedAssets')||{};
  all.forEach(asset=>{
    if(suspended[asset.symbol]) return;
    const ps=State.get(`prices.${asset.symbol}`); if(!ps) return;
    const{base}=VOL[asset.vol||'normal']||VOL.normal;
    const annualVol=base*Math.sqrt(525600);
    const annualDrift=0.05;
    const u1=Math.max(1e-10,Math.random()),u2=Math.random();
    const Z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
    const exp=(annualDrift-0.5*annualVol*annualVol)*T+annualVol*Math.sqrt(T)*Z;
    const mult=Math.exp(exp);
    const maxChange=minutes<=1440?0.12:minutes<=10080?0.25:0.45;
    const cm=Math.max(1-maxChange,Math.min(1+maxChange,mult));
    const dec=decimals(ps.last,ps.currency);
    const nl=Math.max(0.000001,round(ps.last*cm,dec));
    const spread=(LIQ[asset.liq||'medium']?.spread||0.003)*nl;
    State.set(`prices.${asset.symbol}`,{...ps,last:nl,open:nl,high:nl,low:nl,
      bid:round(nl-spread*.5,dec),ask:round(nl+spread*.5,dec),
      change:0,changePct:0,volume:0});
    addSkipCandles(asset.symbol,ps.last,nl,minutes,asset.vol||'normal');
  });
  const t=State.get('simTime');
  const nt=new Date(t.getTime()+minutes*60000);
  State.set('simTime',nt);
  checkIPOAutoListing();
  const monthsCrossed=Math.floor(minutes/(30*24*60));
  if(monthsCrossed>0){
    for(let m=1;m<=monthsCrossed;m++){
      const ct=new Date(t.getTime()+m*30*24*60*60*1000);
      ct.setDate(14); ct.setHours(15,0,0,0);
      checkDividendCumDate(ct);
      const mt=new Date(t.getTime()+m*30*24*60*60*1000);
      mt.setDate(1); mt.setHours(9,0,0,0);
      processMonthlyDividends(mt);
    }
  }
  State.saveToStorage(); State.emit('tick',nt);
}

function addSkipCandles(symbol,fromPrice,toPrice,minutes,volProfile){
  const candles=State.get(`candles.${symbol}`); if(!candles) return;
  const{base}=VOL[volProfile]||VOL.normal;
  const now=State.get('simTime')||new Date();
  const MS={'1m':60e3,'5m':300e3,'15m':900e3,'1h':3.6e6,'4h':14.4e6,'1d':86.4e6};
  const targetMs=now.getTime()+minutes*60000;
  Object.entries(MS).forEach(([tf,ms])=>{
    const arr=candles[tf]||[];
    const steps=Math.min(Math.floor(minutes*60000/ms),50);
    if(steps<1) return;
    const step=(toPrice-fromPrice)/steps; let p=fromPrice;
    for(let i=0;i<steps;i++){
      const t=targetMs-(steps-i)*ms;
      const noise=(Math.random()-.5)*base*4;
      const c=round(Math.max(0.000001,(p+step)*(1+noise)),fromPrice>1000?0:fromPrice>1?4:8);
      arr.push({t,o:p,h:Math.max(p,c)*(1+Math.random()*base),l:Math.min(p,c)*(1-Math.random()*base),c,v:Math.floor(Math.random()*30000+5000)});
      if(arr.length>500) arr.shift();
      p=c;
    }
  });
  State.emit(`candles.${symbol}`,candles);
}

// ─── Orders ───────────────────────────────────────────────────
function genId(p){return p+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase();}

export function placeOrder(params){
  const{userId,symbol,side,type,qty,price,stopPrice,tif='GTC'}=params;
  if(!userId||!symbol||!side||!type||!qty||qty<=0) return{ok:false,error:'Parameter tidak valid'};
  if((type==='limit'||type==='stop_limit')&&(!price||price<=0)) return{ok:false,error:'Harga limit wajib diisi'};

  // Check if suspended
  const suspended=State.get('suspendedAssets')||{};
  if(suspended[symbol]) return{ok:false,error:`${symbol} sedang disuspensi: ${suspended[symbol].reason}`};

  const ps=State.get(`prices.${symbol}`);
  if(!ps) return{ok:false,error:`Aset ${symbol} tidak ditemukan`};

  const port=State.get(`portfolio.${userId}`)||initPortfolio(userId);
  const ep=type==='market'?(side==='buy'?ps.ask:ps.bid):price;
  const fxR=ps.currency==='IDR'?1:getForexRate('USD/IDR');

  if(side==='buy'){
    const need=ep*qty*(1+FEE_BUY)*fxR;
    if((port.cash_idr||0)<need)
      return{ok:false,error:`Dana tidak cukup. Perlu: ${fmtIDR(need)}, Saldo: ${fmtIDR(port.cash_idr||0)}`};
  } else {
    const h=port.holdings?.[symbol];
    if(!h||h.qty<qty) return{ok:false,error:`Kepemilikan tidak cukup. Tersedia: ${h?.qty||0} lot`};
  }
  const order={orderId:genId('ORD'),userId,symbol,side,type,qty,
    price:price||null,stopPrice:stopPrice||null,tif,
    status:'pending',filledQty:0,avgFill:0,fee:0,
    currency:ps.currency,createdAt:(State.get('simTime')||new Date()).toISOString()};
  State.set(`orders.${userId}`,[...(State.get(`orders.${userId}`)||[]),order]);
  if(type==='market') matchOrder(order);
  State.emit('order.placed',order);
  return{ok:true,orderId:order.orderId};
}

export function cancelOrder(userId,orderId){
  const orders=State.get(`orders.${userId}`)||[];
  const idx=orders.findIndex(o=>o.orderId===orderId); if(idx===-1) return{ok:false};
  if(!['pending','partial'].includes(orders[idx].status)) return{ok:false};
  orders[idx]={...orders[idx],status:'cancelled'};
  State.set(`orders.${userId}`,[...orders]);
  State.emit('order.cancelled',orders[idx]);
  return{ok:true};
}

function processAllPendingOrders(){
  const ports=State.get('portfolio')||{};
  Object.keys(ports).forEach(uid=>{
    (State.get(`orders.${uid}`)||[]).filter(o=>['pending','partial'].includes(o.status)).forEach(o=>{
      const ps=State.get(`prices.${o.symbol}`); if(!ps) return;
      let go=false;
      if(o.type==='market') go=true;
      else if(o.type==='limit') go=o.side==='buy'?ps.last<=o.price:ps.last>=o.price;
      else if(o.type==='stop_market') go=o.side==='buy'?ps.last>=o.stopPrice:ps.last<=o.stopPrice;
      else if(o.type==='take_profit') go=o.side==='sell'&&ps.last>=o.price;
      else if(o.type==='stop_limit'){if((o.side==='buy'&&ps.last>=o.stopPrice)||(o.side==='sell'&&ps.last<=o.stopPrice)) o.type='limit';}
      if(go) matchOrder(o);
    });
  });
}

function matchOrder(order){
  const ob=State.get(`orderBooks.${order.symbol}`);
  const ps=State.get(`prices.${order.symbol}`);
  if(!ob||!ps) return;
  const isBuy=order.side==='buy';
  const book=[...(isBuy?ob.asks:ob.bids)];
  const dec=decimals(ps.last,ps.currency);
  let rem=order.qty-order.filledQty,cost=0,filled=0;
  for(let i=0;i<book.length&&rem>0;i++){
    if(order.type==='limit'||order.type==='take_profit'){
      if(isBuy&&book[i].price>order.price) break;
      if(!isBuy&&book[i].price<order.price) break;
    }
    const fq=Math.min(rem,book[i].qty);
    cost+=book[i].price*fq; filled+=fq; rem-=fq;
    book[i]={...book[i],qty:book[i].qty-fq};
  }
  if(!filled){if(order.tif==='FOK'){_setStatus(order,'cancelled');}return;}
  if(order.tif==='IOC'&&rem>0) rem=0;
  const avg=cost/filled;
  const fee=cost*(isBuy?FEE_BUY:FEE_SELL);
  const nfq=order.filledQty+filled;
  const stat=nfq>=order.qty?'filled':(rem===0?'cancelled':'partial');
  const orders=State.get(`orders.${order.userId}`)||[];
  const idx=orders.findIndex(o=>o.orderId===order.orderId); if(idx===-1) return;
  orders[idx]={...orders[idx],status:stat,filledQty:nfq,avgFill:round(avg,dec),fee:round(fee,2)};
  State.set(`orders.${order.userId}`,[...orders]);
  updatePortfolio(order.userId,order.symbol,order.side,filled,avg,fee,ps.currency);
  const newBook=book.filter(l=>l.qty>0);
  State.set(`orderBooks.${order.symbol}`,isBuy?{bids:ob.bids,asks:newBook}:{bids:newBook,asks:ob.asks});
  State.emit(`orderBook.${order.symbol}`,State.get(`orderBooks.${order.symbol}`));
  addTape(order.symbol,avg,filled,order.side);
  recordTx(order.userId,{type:order.side,symbol:order.symbol,qty:filled,
    price:avg,amount:cost,fee,orderId:order.orderId,currency:ps.currency});
  applyTradeMarketImpact(order.symbol,order.side,filled,avg,ps.currency);
  State.emit('order.filled',orders[idx]);
  State.emit(`portfolio.${order.userId}`,State.get(`portfolio.${order.userId}`));
}

function _setStatus(order,status){
  const orders=State.get(`orders.${order.userId}`)||[];
  const idx=orders.findIndex(o=>o.orderId===order.orderId);
  if(idx!==-1){orders[idx]={...orders[idx],status};State.set(`orders.${order.userId}`,[...orders]);}
}

// ─── Portfolio ────────────────────────────────────────────────
export function initPortfolio(userId){
  const u=(State.get('users')||[]).find(u=>u.id===userId)||{};
  const p={cash_idr:u.balance_idr||100000000,holdings:{},
    realizedPnl:0,totalFees:0,totalDividends:0,blockedFunds:0,
    tradeHistory:[]}; // detailed sell history
  State.set(`portfolio.${userId}`,p); return p;
}

function updatePortfolio(userId,symbol,side,qty,avgFill,fee,currency){
  const port=State.get(`portfolio.${userId}`)||initPortfolio(userId);
  const fxR=currency==='IDR'?1:getForexRate('USD/IDR');
  const cost=avgFill*qty*fxR, feeIDR=fee*fxR;
  if(side==='buy'){
    port.cash_idr=Math.max(-100000000,(port.cash_idr||0)-(cost+feeIDR));
    const h=port.holdings[symbol]||{qty:0,avgCost:0,totalCost:0,currency};
    const nt=h.totalCost+cost,nq=h.qty+qty;
    port.holdings[symbol]={qty:nq,avgCost:round(nt/nq,6),totalCost:nt,currency};
  } else {
    const h=port.holdings[symbol];
    const avgCost=h?.avgCost||0;
    const realized=(avgFill-avgCost)*qty*fxR;
    port.cash_idr=(port.cash_idr||0)+(cost-feeIDR);
    port.realizedPnl=(port.realizedPnl||0)+realized;
    // Record detailed sell history
    const simTime=State.get('simTime')||new Date();
    const sellRecord={
      id:genId('SL'), symbol, side:'sell', qty, avgCost, sellPrice:avgFill,
      realized, pnlPct:avgCost>0?round((avgFill-avgCost)/avgCost*100,2):0,
      fee:feeIDR, currency, soldAt:simTime.toISOString(),
    };
    port.tradeHistory=[sellRecord,...(port.tradeHistory||[])].slice(0,200);
    // Check dividend eligibility for sold position
    recordDividendEligibility(userId,symbol,qty,simTime);
    if(h){
      h.qty-=qty;
      if(h.qty<=0) delete port.holdings[symbol];
      else h.totalCost=h.avgCost*h.qty;
    }
  }
  port.totalFees=(port.totalFees||0)+feeIDR;
  State.set(`portfolio.${userId}`,{...port});
}

function recordTx(userId,p){
  const tx={txId:genId('TX'),...p,timestamp:(State.get('simTime')||new Date()).toISOString()};
  const txs=State.get(`transactions.${userId}`)||[];
  State.set(`transactions.${userId}`,[tx,...txs].slice(0,500));
}

function addTape(symbol,price,qty,side){
  const t=State.get(`tradeTapes.${symbol}`)||[];
  t.unshift({price,qty,side,time:(State.get('simTime')||new Date()).toISOString()});
  State.set(`tradeTapes.${symbol}`,t.slice(0,50));
  State.emit(`tradeTape.${symbol}`,t);
}

// ─── Candles ─────────────────────────────────────────────────
function updateCandles(symbol,simTime,price,vol){
  const MS={'1m':60e3,'5m':300e3,'15m':900e3,'1h':3.6e6,'4h':14.4e6,'1d':86.4e6};
  const c=State.get(`candles.${symbol}`); if(!c) return;
  Object.entries(MS).forEach(([tf,ms])=>{
    const arr=c[tf]||[];
    const barT=Math.floor(simTime.getTime()/ms)*ms;
    const last=arr[arr.length-1];
    if(last&&last.t===barT){last.h=Math.max(last.h,price);last.l=Math.min(last.l,price);last.c=price;last.v+=vol;}
    else{const pc=last?last.c:price;arr.push({t:barT,o:pc,h:Math.max(pc,price),l:Math.min(pc,price),c:price,v:vol});if(arr.length>500)arr.shift();}
  });
  State.emit(`candles.${symbol}`,c);
}

function refreshOrderBook(symbol,mid,liqProfile,dec){
  if(Math.random()>0.4) return;
  const cfg=LIQ[liqProfile]||LIQ.medium;
  const{baseSize,spread,levels}=cfg;
  const ob=State.get(`orderBooks.${symbol}`)||{bids:[],asks:[]};
  const bids=ob.bids.map((l,i)=>({price:round(mid*(1-(spread*(i+1))*(0.85+Math.random()*.3)),dec),qty:Math.max(100,l.qty+Math.floor((Math.random()-.5)*baseSize*.15))})).sort((a,b)=>b.price-a.price);
  const asks=ob.asks.map((l,i)=>({price:round(mid*(1+(spread*(i+1))*(0.85+Math.random()*.3)),dec),qty:Math.max(100,l.qty+Math.floor((Math.random()-.5)*baseSize*.15))})).sort((a,b)=>a.price-b.price);
  if(bids.length<levels&&Math.random()<0.2){
    const i=bids.length+1;
    bids.push({price:round(mid*(1-spread*i),dec),qty:Math.max(100,Math.floor(baseSize*0.2))});
    asks.push({price:round(mid*(1+spread*i),dec),qty:Math.max(100,Math.floor(baseSize*0.2))});
    bids.sort((a,b)=>b.price-a.price);
    asks.sort((a,b)=>a.price-b.price);
  }
  State.set(`orderBooks.${symbol}`,{bids,asks});
  State.emit(`orderBook.${symbol}`,{bids,asks});
}

// ─── Deposit ──────────────────────────────────────────────────
export function requestDeposit(userId,amount,currency,method){
  const fxR=currency==='IDR'?1:getForexRate('USD/IDR');
  const dep={id:'DEP'+Date.now().toString(36).toUpperCase(),userId,amount,currency,method,
    amountIDR:amount*fxR,status:'pending',type:'deposit',
    createdAt:new Date().toISOString(),processedAt:null,adminNote:''};
  State.set(`deposits.${userId}`,[dep,...(State.get(`deposits.${userId}`)||[])]);
  setTimeout(()=>processDeposit(userId,dep.id),(3+Math.random()*7)*1000);
  return dep;
}

export function processDeposit(userId,depositId){
  const deps=State.get(`deposits.${userId}`)||[];
  const idx=deps.findIndex(d=>d.id===depositId); if(idx===-1) return;
  const dep=deps[idx];
  const r=Math.random();
  const status=r<0.05?'failed':r<0.12?'hold':'success';
  const note={success:'Deposit berhasil',failed:'Transfer gagal/ditolak',hold:'Menunggu verifikasi manual'}[status];
  deps[idx]={...dep,status,processedAt:new Date().toISOString(),adminNote:note};
  State.set(`deposits.${userId}`,[...deps]);
  if(status==='success'){const p=State.get(`portfolio.${userId}`)||initPortfolio(userId);p.cash_idr=(p.cash_idr||0)+dep.amountIDR;State.set(`portfolio.${userId}`,{...p});}
  State.emit('deposit.updated',deps[idx]);
  State.emit(`portfolio.${userId}`,State.get(`portfolio.${userId}`));
  if(status==='hold') setTimeout(()=>processDeposit(userId,depositId),(5+Math.random()*8)*1000);
}

export function requestWithdraw(userId,amount,currency,method,destination){
  const fxR=currency==='IDR'?1:getForexRate('USD/IDR');
  const amountIDR=amount*fxR;
  const port=State.get(`portfolio.${userId}`)||initPortfolio(userId);
  const pendingWD=(port.pendingWithdrawIDR||0);
  if((port.cash_idr||0)-pendingWD<amountIDR){
    return {ok:false,error:`Saldo tersedia tidak cukup. Tersedia: ${fmtIDR((port.cash_idr||0)-pendingWD)}`};
  }
  port.pendingWithdrawIDR=pendingWD+amountIDR;
  State.set(`portfolio.${userId}`,{...port});
  const wd={id:'WD'+Date.now().toString(36).toUpperCase(),userId,amount,currency,method,destination,
    amountIDR,status:'pending',type:'withdraw',createdAt:new Date().toISOString(),processedAt:null,adminNote:'Menunggu verifikasi'};
  State.set(`deposits.${userId}`,[wd,...(State.get(`deposits.${userId}`)||[])]);
  setTimeout(()=>processWithdraw(userId,wd.id),(4+Math.random()*8)*1000);
  return {ok:true,withdraw:wd};
}

export function processWithdraw(userId,withdrawId){
  const deps=State.get(`deposits.${userId}`)||[];
  const idx=deps.findIndex(d=>d.id===withdrawId&&d.type==='withdraw'); if(idx===-1) return;
  const wd=deps[idx];
  if(wd.status!=='pending'&&wd.status!=='hold') return;
  const r=Math.random();
  const status=r<0.08?'failed':r<0.2?'hold':'success';
  const note={success:'Dana berhasil dikirim',failed:'Penarikan ditolak/gagal',hold:'Penarikan tertahan untuk verifikasi'}[status];
  deps[idx]={...wd,status,processedAt:new Date().toISOString(),adminNote:note};
  State.set(`deposits.${userId}`,[...deps]);
  const port=State.get(`portfolio.${userId}`)||initPortfolio(userId);
  port.pendingWithdrawIDR=Math.max(0,(port.pendingWithdrawIDR||0)-wd.amountIDR);
  if(status==='success'){
    port.cash_idr=(port.cash_idr||0)-wd.amountIDR;
    recordTx(userId,{type:'withdraw',symbol:'IDR',qty:1,price:wd.amountIDR,amount:wd.amountIDR,fee:0,orderId:wd.id,currency:'IDR'});
  }
  State.set(`portfolio.${userId}`,{...port});
  State.emit('deposit.updated',deps[idx]);
  State.emit(`portfolio.${userId}`,State.get(`portfolio.${userId}`));
  if(status==='hold') setTimeout(()=>processWithdraw(userId,withdrawId),(6+Math.random()*8)*1000);
}

// ─── Forex ────────────────────────────────────────────────────
export function getForexRate(pair){return State.get(`prices.${pair}`)?.last||FX_BASE[pair]||15800;}
export function toIDR(amt,cur){return cur==='IDR'?amt:amt*getForexRate('USD/IDR');}
export function fromIDR(amt,cur){return cur==='IDR'?amt:amt/getForexRate('USD/IDR');}

// ─── Utils ────────────────────────────────────────────────────
export function round(v,dec){if(!dec||dec<=0)return Math.round(v);const f=10**dec;return Math.round(v*f)/f;}
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function randn(){
  const u1=Math.max(1e-12,Math.random());
  const u2=Math.random();
  return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
}
function estimateFreeFloatShares(asset){
  if(asset?.freeFloatShares&&asset.freeFloatShares>0) return asset.freeFloatShares;
  const base=asset?.basePrice||1000;
  if(base>=10000) return 12_000_000_000;
  if(base>=5000) return 20_000_000_000;
  if(base>=1000) return 35_000_000_000;
  return 60_000_000_000;
}
function isTradableAsset(asset){
  if(!asset) return false;
  return !asset.phase || asset.phase==='listed';
}
function decimals(price,currency){
  if(!currency||currency==='IDR') return price>1000?0:1;
  return price>100?2:price>1?4:price>0.01?6:8;
}
function fmtIDR(v){return 'Rp'+(v||0).toLocaleString('id-ID');}
