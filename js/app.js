// app.js v8 — complete rewrite with all features
import State from './state.js';
import { initMarket, startEngine, stopEngine, placeOrder, cancelOrder,
         initPortfolio, requestDeposit, requestWithdraw, computeAUM, getForexRate, skipSimTime,
         subscribeToIPO, createCryptoCoin, rugPullCrypto,
         suspendAsset, unsuspendAsset, haltIHSG, resumeIHSG,
         claimDividend, claimAllDividends,
         FEE_BUY, FEE_SELL, round, DIVIDEND_STOCKS } from './engine.js';
import { TradingChart } from './chart.js';
import './bots.js';

let chart=null, chartInited=false;
let assetsData=null, currentPage='home', sidebarTab='stocks';
let saveTimer=null, walletCur='IDR';

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  try {
    const [ar,ur]=await Promise.all([fetch('./data/assets.json'),fetch('./data/users.json')]);
    assetsData=await ar.json(); const ud=await ur.json();
    State.set('assets',assetsData); State.set('users',ud.users);
  } catch(e) { assetsData={stocks:[],syariah:[],crypto:[],ipo:[],newCrypto:[]}; State.set('assets',assetsData); }
  $('login-form')?.addEventListener('submit',handleLogin);
  State.loadGlobal(); // Load global state (sim time, news, etc.)
  const sess=State.get('session');
  // Only auto-login if session matches a valid user
  if (sess && (State.get('users')||[]).find(u=>u.id===sess.userId)) {
    State.loadUserData(sess.userId);
    startApp(sess);
  } else {
    State.set('session',null);
    showLogin();
  }
}

function showLogin() {
  $('login-screen').style.display='flex'; $('app-screen').style.display='none';
  applyTheme(State.get('theme')||'dark');
}

function startApp(sess) {
  $('login-screen').style.display='none'; $('app-screen').style.display='flex';
  applyTheme(State.get('theme')||'dark');
  initMarket(assetsData);
  assetsData=State.get('assets')||assetsData;
  setupUserUI(sess); bindAll(); renderSidebar();
  selectAssetSilent(State.get('activeAsset')||'BBCA');
  navigateTo('home'); startEngine(); subscribe();
  clearInterval(saveTimer);
  saveTimer=setInterval(()=>State.saveToStorage(),60*1000);
}

function handleLogin(e) {
  e?.preventDefault();
  const u=$('login-username').value.trim(), p=$('login-password').value.trim();
  const user=(State.get('users')||[]).find(x=>x.username===u&&x.password===p);
  if (!user) { showErr('Username atau password salah'); return; }
  // Stop previous engine if any
  stopEngine(); clearInterval(saveTimer);
  const sess={userId:user.id,username:user.username,name:user.name,role:user.role,avatar:user.avatar};
  State.set('session',sess);
  State.loadUserData(user.id);
  if (!State.get(`portfolio.${user.id}`)) initPortfolio(user.id);
  State.saveToStorage(); startApp(sess);
}

function handleLogout() {
  stopEngine(); clearInterval(saveTimer);
  chart=null; chartInited=false;
  State.set('session',null); State.saveToStorage(); showLogin();
}

function showErr(msg) { const el=$('login-error'); el.textContent=msg; el.style.display='block'; setTimeout(()=>el.style.display='none',3000); }
function setupUserUI(sess) {
  setEl('user-avatar',sess.avatar); setEl('wallet-avatar',sess.avatar);
  setEl('wallet-name',sess.name); setEl('wallet-username',`@${sess.username}`);
  setEl('wallet-role',sess.role==='admin'?'Administrator':'User');
}

// ─── Navigation ───────────────────────────────────────────────
function navigateTo(page) {
  currentPage=page;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`));
  document.querySelectorAll('.bnav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  const tb=$('asset-topbar'); if(tb) tb.style.display=page==='trade'?'flex':'none';
  // Order panel: desktop only. On mobile always hidden.
  const dop=$('d-order-panel');
  if(dop) dop.style.display=(page==='trade'&&window.innerWidth>=900)?'flex':'none';
  // Sidebar: desktop only via CSS — never toggle on mobile
  const dsb=$('d-sidebar');
  if (dsb && window.innerWidth<900) dsb.style.display='none';
  if (page==='trade') requestAnimationFrame(()=>requestAnimationFrame(ensureChart));
  if (page==='home')      refreshHome();
  if (page==='portfolio') renderPortfolio();
  if (page==='wallet')    renderWallet();
  if (page==='market')    renderMarketLists();
  if (page==='news')      { renderNewsFull(); fillNewsAssets(); }
  if (page==='ipo')       { renderIPOPage(); fillNewsAssets(); }
  if (page==='control')   renderControlPanel();
}
window.navTo=navigateTo;

// ─── Chart ────────────────────────────────────────────────────
function ensureChart() {
  const canvas=$('main-chart'), cont=$('chart-container');
  if(!canvas||!cont) return;
  // Force visible height always
  cont.style.height='240px';
  cont.style.minHeight='240px';
  cont.style.display='block';
  // Wait for layout
  requestAnimationFrame(()=>{
    const w=cont.clientWidth||window.innerWidth-0;
    if(w<10){ setTimeout(ensureChart,150); return; }
    if(!chartInited){
      sizeCanvas(canvas);
      try{ chart=new TradingChart(canvas); chartInited=true; }
      catch(e){ console.error('Chart init failed',e); return; }
      if(window.ResizeObserver){
        new ResizeObserver(()=>{
          if(currentPage==='trade'&&chartInited){ sizeCanvas(canvas); chart?._render(); }
        }).observe(cont);
      }
    } else { sizeCanvas(canvas); }
    chart.load(State.get('activeAsset'), State.get('activeTimeframe')||'5m');
  });
}
function sizeCanvas(c){
  const cont=c.parentElement;
  const w=Math.max(cont.clientWidth||0, window.innerWidth);
  const h=Math.max(cont.clientHeight||0, 240);
  const dpr=Math.min(window.devicePixelRatio||1, 2);
  c.style.width=w+'px'; c.style.height=h+'px';
  c.width=Math.round(w*dpr); c.height=Math.round(h*dpr);
  const ctx=c.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
}

// ─── Asset Selection ──────────────────────────────────────────
function selectAssetSilent(sym) {
  State.set('activeAsset',sym);
  updateTradeHeader(sym); renderOrderBook(); renderTradeTape();
  updateOrderForm(sym); hlSidebar(sym);
}
function selectAsset(sym) {
  selectAssetSilent(sym);
  if(chart&&chartInited) chart.load(sym,State.get('activeTimeframe')||'5m');
}
window.selectAssetUI=(sym)=>{selectAsset(sym);navigateTo('trade');};

function updateTradeHeader(sym) {
  const ps=State.get(`prices.${sym}`); const a=allAssets().find(x=>x.symbol===sym);
  setEl('trade-symbol',sym); setEl('asset-symbol',sym);
  setEl('trade-name',a?.name?.substring(0,22)||'');
  const suspended=State.get('suspendedAssets')||{};
  const suspWarn=$('trade-suspend-warn');
  if(suspWarn) suspWarn.style.display=suspended[sym]?'':'none';
  if(!ps) return;
  const up=ps.changePct>=0;
  ['trade-last','header-last'].forEach(id=>{const el=$(id);if(!el)return;el.textContent=fmtP(ps.last,ps.currency);el.className=el.className.replace(/\bup\b|\bdown\b/g,'').trim()+(up?' up':' down');});
  ['trade-pct','header-pct'].forEach(id=>{const el=$(id);if(!el)return;el.textContent=`${up?'+':''}${ps.changePct?.toFixed(2)}%`;el.className=el.className.replace(/\bup\b|\bdown\b/g,'').trim()+(up?' up':' down');});
  setEl('header-high',fmtP(ps.high,ps.currency)); setEl('header-low',fmtP(ps.low,ps.currency));
  setEl('header-vol',(ps.volume||0).toLocaleString());
}

function hlSidebar(sym){document.querySelectorAll('.sidebar-item').forEach(el=>el.classList.toggle('active',el.dataset.symbol===sym));}

function allAssets() {
  const a=State.get('assets')||{};
  return [...(a.stocks||[]),...(a.syariah||[]),...(a.crypto||[]),
    ...(a.forex||[]),...(State.get('listedAssets')||[]),...(State.get('customAssets')||[])];
}

// ─── Subscribe ────────────────────────────────────────────────
function subscribe() {
  State.on('tick',()=>{
    const active=State.get('activeAsset');
    updateTradeHeader(active); renderSidebarPrices(); updateDesktopPort(); updateSimTime();
    if(chart&&chartInited) chart.update();
    if(currentPage==='home') refreshHome();
    if(currentPage==='market') renderMarketPrices();
    renderIHSGMiniChart();
    if(currentPage==='ihsg') renderIHSGPage();
    if(currentPage==='wallet') renderForexRates();
    if(currentPage==='trade') updateHoldingPanel(active);
    updateIHSGDisplay();
  });
  State.on('orderBook',(d,path)=>{if(path===`orderBook.${State.get('activeAsset')}`)renderOrderBook();});
  State.on('tradeTape',(d,path)=>{if(path===`tradeTape.${State.get('activeAsset')}`)renderTradeTape();});
  State.on('portfolio',(d,path)=>{
    const uid=State.get('session')?.userId; if(!uid||path!==`portfolio.${uid}`) return;
    updateDesktopPort(); updateOrderForm(State.get('activeAsset'));
    if(currentPage==='home') renderHomePortfolio();
    if(currentPage==='portfolio') renderPortfolio();
    if(currentPage==='wallet') renderWallet();
  });
  State.on('order.filled',o=>{toast(`✅ ${o.symbol} ${o.status==='filled'?'TERISI':'PARTIAL'}`,  'success');renderDesktopOrders();if(currentPage==='portfolio')renderPortfolio();});
  State.on('order.placed',()=>renderDesktopOrders());
  State.on('order.cancelled',()=>{
    renderDesktopOrders();
    if(currentPage==='portfolio') renderPortfolio();
    toast('Order dibatalkan','info');
  });
  State.on('news.new',()=>{if(currentPage==='home')renderHomeNews();if(currentPage==='news')renderNewsFull();});
  State.on('deposit.updated',dep=>{toast(`${dep.status==='success'?'✅':'❌'} ${fmtM(dep.amount,dep.currency)}`,dep.status==='success'?'success':'warn');if(currentPage==='wallet')renderWallet();updateDesktopPort();});
  State.on('dividend.available',div=>{
    const sess=State.get('session'); if(sess?.userId!==div.userId) return;
    toast(`💰 Dividen ${div.symbol} tersedia! ${fmtM(div.totalAmount,'IDR')} — Claim di Wallet`,'warn');
    if(currentPage==='wallet') renderWallet();
  });
  State.on('ipo.listed',symbol=>{
    const updatedAssets=State.get('assets'); if(updatedAssets) assetsData=updatedAssets;
    // Always refresh market list so listed stock appears in Saham tab
    renderMarketLists();
    renderSidebar();
    if(currentPage==='ipo')       renderIPOPage();
    if(currentPage==='portfolio') renderPortfolio();
    if(currentPage==='home')      refreshHome();
  });
  State.on('ipo.allocated',ev=>{
    const sess=State.get('session'); if(sess?.userId!==ev.userId) return;
    const gain=ev.gain||0;
    toast(`🎉 ${ev.symbol} listing! ${ev.qty.toLocaleString()} lot @ ${fmtP(ev.offerPrice)}. Harga sekarang ${fmtP(ev.listingPrice)}. ${gain>=0?'+':''}${fmtM(gain,'IDR')}`,gain>=0?'success':'warn');
    if(currentPage==='portfolio') renderPortfolio();
  });
  State.on('rugpull',ev=>{
    // Show social media notifications
    ev.sosmedMsgs?.forEach((msg,i)=>setTimeout(()=>toast(msg,ev.fined?'error':'warn'),i*1200));
    if(ev.fined) toast(`⚖️ DENDA OJK: ${fmtM(ev.fine,'IDR')} (150% dari hasil rugpull)!`,'error');
    if(currentPage==='portfolio') renderPortfolio();
  });
  State.on('asset.suspended',({symbol,reason})=>{ toast(`⛔ ${symbol} disuspensi: ${reason}`,'warn'); updateTradeHeader(State.get('activeAsset')); if(currentPage==='control') renderControlPanel(); });
  State.on('asset.unsuspended',symbol=>{ toast(`✅ ${symbol} kembali trading`,'success'); if(currentPage==='control') renderControlPanel(); });
  State.on('ihsg.halted',reason=>{ toast(`🔴 IHSG Halt! ${reason}`,'error'); updateIHSGDisplay(); });
  State.on('ihsg.resumed',()=>{ toast('🟢 IHSG kembali normal','success'); updateIHSGDisplay(); });
}

// ─── Sidebar ──────────────────────────────────────────────────
function renderSidebar() {
  const el=$('sidebar-list'); if(!el) return;
  const a=State.get('assets')||{};
  const listed=State.get('listedAssets')||[];
  const listedIDR=listed.filter(x=>x.currency==='IDR'&&!x.syariah);
  const listedCrypto=listed.filter(x=>x.isCrypto||x.currency==='USD');
  const list=sidebarTab==='stocks'?[...(a.stocks||[]),...listedIDR]
    :sidebarTab==='syariah'?a.syariah
    :sidebarTab==='crypto'?[...(a.crypto||[]),...listedCrypto]
    :sidebarTab==='forex'?(a.forex||[])
    :[...(a.ipo||[]),...(a.newCrypto||[]),...(State.get('customAssets')||[]).filter(x=>x.phase)];
  const active=State.get('activeAsset');
  const suspended=State.get('suspendedAssets')||{};
  el.innerHTML=(list||[]).map(a=>{
    const p=State.get(`prices.${a.symbol}`); const up=(p?.changePct||0)>=0;
    const isSuspended=!!suspended[a.symbol];
    return `<div class="sidebar-item${a.symbol===active?' active':''}${isSuspended?' suspended':''}" data-symbol="${a.symbol}" onclick="window.selectAssetUI('${a.symbol}')">
      <div class="si-l"><span class="si-sym">${a.symbol}${isSuspended?' ⛔':''}</span><span class="si-name">${a.name?.substring(0,14)||''}</span></div>
      <div class="si-r"><span class="si-price">${fmtP(p?.last,p?.currency)}</span><span class="si-chg ${up?'up':'down'}">${up?'+':''}${(p?.changePct||0).toFixed(2)}%</span></div>
    </div>`;
  }).join('');
}

function renderSidebarPrices() {
  document.querySelectorAll('.sidebar-item[data-symbol]').forEach(el=>{
    const p=State.get(`prices.${el.dataset.symbol}`); if(!p) return;
    const up=p.changePct>=0;
    const pe=el.querySelector('.si-price'); if(pe) pe.textContent=fmtP(p.last,p.currency);
    const ce=el.querySelector('.si-chg');
    if(ce){ce.textContent=`${up?'+':''}${p.changePct.toFixed(2)}%`;ce.className=`si-chg ${up?'up':'down'}`;}
  });
}

// ─── IHSG Display ─────────────────────────────────────────────

function getIHSGMarketStatus(){
  if(State.get('ihsgHalted')) return {code:'halt',label:'🔴 HALT',badge:'HALT'};
  const t=State.get('simTime');
  if(!t) return {code:'normal',label:'🟢 Normal',badge:''};
  const ts=t.getTime()+7*60*60*1000; // WIB
  const d=new Date(ts);
  const dow=d.getUTCDay();
  const h=d.getUTCHours();
  if(dow===0||dow===6) return {code:'weekend',label:'🟡 Market Tutup Hari Libur',badge:'TUTUP'};
  if(h<9||h>=16) return {code:'offhours',label:'🟡 Market Tutup di luar jam market (09:00-16:00 WIB)',badge:'TUTUP'};
  return {code:'normal',label:'🟢 Normal',badge:''};
}

function updateIHSGDisplay() {
  const ihsg=State.get('ihsg'); if(!ihsg) return;
  const up=ihsg.changePct>=0;
  setEl('ihsg-value',ihsg.value?.toLocaleString('id-ID',{maximumFractionDigits:2})||'-');
  const chgEl=$('ihsg-chg');
  if(chgEl){chgEl.textContent=`${up?'+':''}${ihsg.changePct?.toFixed(2)}%`;chgEl.className=`ihsg-chg ${up?'up':'down'}`;}
  const status=getIHSGMarketStatus();
  const haltEl=$('ihsg-halt-badge');
  if(haltEl){
    haltEl.style.display=status.badge?'':'none';
    haltEl.textContent=status.badge||'HALT';
    haltEl.title=status.label;
  }
  // Topnav IHSG values
  setEl('ihsg-value', ihsg.value?.toLocaleString('id-ID',{maximumFractionDigits:2})||'-');
  const chgNav=$('ihsg-chg');
  if(chgNav){chgNav.textContent=`${up?'+':''}${ihsg.changePct?.toFixed(2)}%`;chgNav.className=`tnav-ihsg-chg ${up?'up':'down'}`;}
  renderIHSGMiniChart();
}

// Mini sparkline in topnav
function renderIHSGMiniChart() {
  const canvas=$('ihsg-mini-chart'); if(!canvas) return;
  const ihsg=State.get('ihsg');
  const hist=ihsg?.history||[];
  const W=60, H=28, dpr=window.devicePixelRatio||1;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);
  if(hist.length<2){
    ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);
    ctx.strokeStyle='rgba(143,163,192,.3)';ctx.lineWidth=1;ctx.stroke();
    return;
  }
  const vals=hist.map(h=>h.v);
  const mn=Math.min(...vals),mx=Math.max(...vals),range=mx-mn||mn*0.01||1;
  const toY=v=>2+(1-(v-mn)/range)*(H-4);
  const toX=i=>i/(vals.length-1)*(W);
  const up=(ihsg?.changePct||0)>=0;
  const color=up?'#1db97a':'#f04040';
  ctx.beginPath();
  ctx.moveTo(toX(0),toY(vals[0]));
  for(let i=1;i<vals.length;i++) ctx.lineTo(toX(i),toY(vals[i]));
  ctx.strokeStyle=color; ctx.lineWidth=1.2; ctx.lineJoin='round'; ctx.stroke();
}

// Full chart on IHSG detail page
function renderIHSGFullChart() {
  const canvas=$('ihsg-full-chart'); if(!canvas) return;
  const ihsg=State.get('ihsg');
  const hist=ihsg?.history||[];
  const wrap=$('ihsg-chart-wrap');
  const W=wrap?wrap.clientWidth:window.innerWidth;
  const H=wrap?wrap.clientHeight:220;
  const dpr=window.devicePixelRatio||1;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);
  if(hist.length<2){
    ctx.fillStyle=gv('--t3'); ctx.font=`11px ${gv('--font')||'sans-serif'}`;
    ctx.textAlign='center'; ctx.fillText('Data IHSG sedang dikumpulkan...',W/2,H/2);
    return;
  }
  const vals=hist.map(h=>h.v);
  const mn=Math.min(...vals),mx=Math.max(...vals),range=mx-mn||mn*0.01||1;
  const padL=52,padR=10,padT=12,padB=28;
  const cW=W-padL-padR, cH=H-padT-padB;
  const toY=v=>padT+(1-(v-mn)/range)*cH;
  const toX=i=>padL+i/(vals.length-1)*cW;
  const up=(ihsg?.changePct||0)>=0;
  const color=up?'#1db97a':'#f04040';

  // Grid lines
  ctx.strokeStyle=gv('--border')||'#2a3550'; ctx.lineWidth=.5;
  for(let i=0;i<=4;i++){
    const y=padT+i/4*cH;
    ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
    const val=mx-i/4*range;
    ctx.fillStyle=gv('--t3')||'#556882'; ctx.font='9px monospace'; ctx.textAlign='right';
    ctx.fillText(val.toLocaleString('id-ID',{maximumFractionDigits:0}),padL-4,y+3);
  }

  // X axis time labels
  ctx.fillStyle=gv('--t3')||'#556882'; ctx.font='9px monospace'; ctx.textAlign='center';
  const labelCount=Math.min(5,hist.length);
  for(let i=0;i<labelCount;i++){
    const idx=Math.floor(i*(hist.length-1)/(labelCount-1));
    const x=toX(idx);
    const d=new Date(hist[idx].t);
    const lbl=d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
    ctx.fillText(lbl,x,H-6);
  }

  // Gradient fill
  const grad=ctx.createLinearGradient(0,padT,0,padT+cH);
  grad.addColorStop(0,up?'rgba(29,185,122,.2)':'rgba(240,64,64,.2)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(toX(0),toY(vals[0]));
  for(let i=1;i<vals.length;i++) ctx.lineTo(toX(i),toY(vals[i]));
  ctx.lineTo(toX(vals.length-1),padT+cH); ctx.lineTo(toX(0),padT+cH);
  ctx.closePath(); ctx.fillStyle=grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0),toY(vals[0]));
  for(let i=1;i<vals.length;i++) ctx.lineTo(toX(i),toY(vals[i]));
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
}

function renderIHSGPage() {
  const ihsg=State.get('ihsg');
  const up=(ihsg?.changePct||0)>=0;
  const val=ihsg?.value||0;

  setEl('ihsg-detail-val', val.toLocaleString('id-ID',{maximumFractionDigits:2}));
  const chgEl=$('ihsg-detail-chg');
  if(chgEl){
    const chg=ihsg?.change||0, pct=ihsg?.changePct||0;
    chgEl.textContent=`${up?'+':''}${chg.toFixed(2)} (${up?'+':''}${pct.toFixed(2)}%)`;
    chgEl.className=`idh-chg ${up?'up':'down'}`;
  }
  setEl('ihsg-open', (ihsg?.open||val).toLocaleString('id-ID',{maximumFractionDigits:2}));
  setEl('ihsg-high', (ihsg?.high||val).toLocaleString('id-ID',{maximumFractionDigits:2}));
  setEl('ihsg-low',  (ihsg?.low||val).toLocaleString('id-ID',{maximumFractionDigits:2}));
  const chgAbs=$('ihsg-change');
  if(chgAbs){chgAbs.textContent=`${up?'+':''}${(ihsg?.change||0).toFixed(2)}`;chgAbs.className=up?'up':'down';}

  // Count advancers/decliners
  const a=State.get('assets')||{};
  const stocks=[...(a.stocks||[]),...(a.syariah||[]),...(State.get('listedAssets')||[]).filter(x=>!x.isCrypto&&!x.isForex)];
  let adv=0,dec=0,unch=0;
  const movers=[];
  stocks.forEach(st=>{
    const p=State.get(`prices.${st.symbol}`); if(!p) return;
    if(p.changePct>0) adv++; else if(p.changePct<0) dec++; else unch++;
    movers.push({symbol:st.symbol,name:st.name,changePct:p.changePct,last:p.last,currency:p.currency});
  });
  setEl('ihsg-adv',adv+'');
  setEl('ihsg-dec',dec+'');
  setEl('ihsg-unch',unch+'');
  const status=getIHSGMarketStatus();
  setEl('ihsg-status-txt',status.label);

  // Top movers
  movers.sort((a,b)=>Math.abs(b.changePct)-Math.abs(a.changePct));
  const ml=$('ihsg-movers-list');
  if(ml) ml.innerHTML=movers.slice(0,10).map(m=>{
    const up=m.changePct>=0;
    return `<div class="ihsg-mover-item" onclick="window.selectAssetUI('${m.symbol}')">
      <div><div class="ihm-sym">${m.symbol}</div><div class="ihm-name">${(m.name||'').substring(0,22)}</div></div>
      <div style="text-align:right"><div class="ihm-chg ${up?'up':'down'}">${up?'+':''}${m.changePct.toFixed(2)}%</div><div class="ihm-price">${fmtP(m.last,m.currency)}</div></div>
    </div>`;
  }).join('');

  // Market news
  const nl=$('ihsg-news-list');
  if(nl){
    const evts=(State.get('newsEvents')||[]).filter(e=>e.category!=='crypto').slice().reverse().slice(0,15);
    nl.innerHTML=evts.length?evts.map(newsCard).join(''):'<div class="empty-msg">Belum ada berita pasar</div>';
  }

  // Render full chart
  requestAnimationFrame(renderIHSGFullChart);
}

// Keep old name for any leftover references
function renderIHSGSparkline() {
  const canvas=$('ihsg-sparkline'); if(!canvas) return;
  const ihsg=State.get('ihsg');
  const hist=ihsg?.history||[];

  // Get dimensions from parent box
  const box=canvas.closest('.ihsg-chart-box');
  const W=box ? box.clientWidth : (canvas.parentElement.clientWidth||300);
  const H=56;
  const dpr=window.devicePixelRatio||1;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
  const ctx=canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);

  if(hist.length<2){
    // Draw flat placeholder line
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2);
    ctx.strokeStyle='rgba(143,163,192,.3)'; ctx.lineWidth=1; ctx.stroke();
    return;
  }

  const vals=hist.map(h=>h.v);
  const mn=Math.min(...vals), mx=Math.max(...vals);
  const range=mx-mn||mn*0.01||1;
  const padX=0, padY=4;
  const toY=v=>padY+(1-(v-mn)/range)*(H-padY*2);
  const toX=i=>padX+(i/(vals.length-1))*(W-padX*2);

  const up=(ihsg?.changePct||0)>=0;
  const color=up?'#1db97a':'#f04040';

  // Fill
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,up?'rgba(29,185,122,.18)':'rgba(240,64,64,.18)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(toX(0),toY(vals[0]));
  for(let i=1;i<vals.length;i++) ctx.lineTo(toX(i),toY(vals[i]));
  ctx.lineTo(toX(vals.length-1),H);
  ctx.lineTo(toX(0),H);
  ctx.closePath();
  ctx.fillStyle=grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0),toY(vals[0]));
  for(let i=1;i<vals.length;i++) ctx.lineTo(toX(i),toY(vals[i]));
  ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.lineJoin='round';
  ctx.lineCap='round'; ctx.stroke();
}

// ─── Home ─────────────────────────────────────────────────────
function refreshHome() { renderHomePortfolio(); renderHomeWatchlist(); renderHomeHoldings(); renderHomeNews(); updateIHSGDisplay(); renderDividendBadge(); renderIHSGMiniChart(); }

function renderHomePortfolio() {
  const sess=State.get('session'); if(!sess) return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const fxR=getForexRate('USD/IDR');
  const h=Object.entries(port.holdings||{});
  let equity=port.cash_idr||0,unr=0;
  h.forEach(([sym,hld])=>{const p=State.get(`prices.${sym}`);if(!p)return;equity+=p.currency==='IDR'?p.last*hld.qty:p.last*hld.qty*fxR;unr+=(p.last-hld.avgCost)*hld.qty*(p.currency==='IDR'?1:fxR);});
  const{totalIDR}=computeAUM();
  setEl('home-equity',fmtM(equity,'IDR'));
  setEl('home-cash-idr',fmtM(port.cash_idr||0,'IDR'));
  setEl('home-cash-usd',fmtM((port.cash_idr||0)/fxR,'USD'));
  setEl('home-holding-count',h.length+'');
  setEl('home-realized',fmtM(port.realizedPnl||0,'IDR'));
  setEl('home-aum',fmtM(totalIDR,'IDR'));
  const pe=$('home-pnl');if(pe){pe.textContent=`${unr>=0?'+':''}${fmtM(unr,'IDR')}`;pe.className=`hc-pnl-val ${unr>=0?'up':'down'}`;}
  setEl('topnav-equity',fmtM(equity,'IDR'));
  const cashEl=$('home-cash-idr-warn');
  if(cashEl) cashEl.style.display=(port.cash_idr||0)<0?'':'none';
}

function renderDividendBadge() {
  const sess=State.get('session'); if(!sess) return;
  const divs=(State.get(`dividends.${sess.userId}`)||[]).filter(d=>!d.claimed);
  const badge=$('div-pending-badge');
  if(badge){badge.textContent=divs.length;badge.style.display=divs.length>0?'':'none';}
}

function renderHomeWatchlist() {
  const el=$('home-watchlist'); if(!el) return;
  const wl=State.get('watchlist')||[];
  el.innerHTML=wl.length?wl.map(sym=>{
    const p=State.get(`prices.${sym}`),a=allAssets().find(x=>x.symbol===sym),up=(p?.changePct||0)>=0;
    return `<div class="hw-item" onclick="window.selectAssetUI('${sym}')"><div class="hw-l"><span class="hw-sym">${sym}</span><span class="hw-name">${a?.name?.substring(0,20)||''}</span></div><div class="hw-r"><span class="hw-price">${fmtP(p?.last,p?.currency)}</span><span class="hw-chg ${up?'up':'down'}">${up?'+':''}${(p?.changePct||0).toFixed(2)}%</span></div></div>`;
  }).join(''):'<div class="empty-msg">Watchlist kosong</div>';
}

function renderHomeHoldings() {
  const el=$('home-holdings'); if(!el) return;
  const sess=State.get('session'); if(!sess) return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const h=Object.entries(port.holdings||{}).slice(0,6);
  el.innerHTML=h.length?h.map(([sym,hld])=>{
    const p=State.get(`prices.${sym}`),last=p?.last||hld.avgCost,fxR=p?.currency==='IDR'?1:getForexRate('USD/IDR');
    const pnl=(last-hld.avgCost)*hld.qty*fxR,pct=hld.avgCost>0?((last-hld.avgCost)/hld.avgCost*100):0;
    return `<div class="hh-item" onclick="window.selectAssetUI('${sym}')"><div class="hh-l"><span class="hh-sym">${sym}</span><span class="hh-qty">${hld.qty.toLocaleString()} lot</span></div><div class="hh-r"><div class="hh-val">${fmtM(last*hld.qty*fxR,'IDR')}</div><div class="hh-pnl ${pnl>=0?'up':'down'}">${pnl>=0?'+':''}${fmtM(pnl,'IDR')} (${pct>=0?'+':''}${pct.toFixed(2)}%)</div></div></div>`;
  }).join(''):'<div class="empty-msg">Belum ada kepemilikan</div>';
}

function renderHomeNews() {
  const el=$('home-news'); if(!el) return;
  const evts=(State.get('newsEvents')||[]).slice(-6).reverse();
  el.innerHTML=evts.length?evts.map(newsCard).join(''):'<div class="empty-msg">Belum ada berita</div>';
}

function newsCard(e){
  const cls=e.sentiment>0?'pos':e.sentiment<0?'neg':'neu';
  return `<div class="hn-item ${cls}"><div class="hn-hdr"><span class="hn-sym">${e.symbol||'MARKET'}</span>${e.category?`<span class="hn-cat">${e.category}</span>`:''}<span class="hn-time">${new Date(e.time).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="hn-msg">${e.message}</div>${e.sentiment?`<div class="hn-impact ${e.sentiment>=0?'up':'down'}">${e.sentiment>=0?'▲':'▼'} ${Math.abs(e.sentiment*100).toFixed(1)}%</div>`:''}</div>`;
}

// ─── Market ───────────────────────────────────────────────────
function renderMarketLists() {
  if(!assetsData) return;
  const listed=State.get('listedAssets')||[];
  renderMktList('stocks',[...(assetsData.stocks||[]),...listed.filter(x=>!x.isCrypto&&!x.isForex&&x.currency==='IDR')]);
  renderMktList('syariah',assetsData.syariah||[]);
  renderMktList('crypto',[...(assetsData.crypto||[]),...listed.filter(x=>x.isCrypto)]);
  renderMktList('forex',(State.get('assets')||{}).forex||[]);
  renderIPOMktList();
}

function renderMarketPrices() {
  document.querySelectorAll('.mkt-item[data-symbol]').forEach(el=>{
    const p=State.get(`prices.${el.dataset.symbol}`); if(!p) return;
    const up=p.changePct>=0;
    const pe=el.querySelector('.mkt-price'); if(pe) pe.textContent=fmtP(p.last,p.currency);
    const ce=el.querySelector('.mkt-chg'); if(ce){ce.textContent=`${up?'+':''}${p.changePct.toFixed(2)}%`;ce.className=`mkt-chg ${up?'up':'down'}`;}
    const ve=el.querySelector('.mkt-vol'); if(ve) ve.textContent=`Vol: ${(p.volume||0).toLocaleString()}`;
  });
}

function renderMktList(type,list) {
  const el=$(`market-list-${type}`); if(!el) return;
  const suspended=State.get('suspendedAssets')||{};
  el.innerHTML=(list||[]).map(a=>{
    const p=State.get(`prices.${a.symbol}`),up=(p?.changePct||0)>=0;
    const susp=!!suspended[a.symbol];
    const div=DIVIDEND_STOCKS?.[a.symbol];
    return `<div class="mkt-item${susp?' mkt-suspended':''}" data-symbol="${a.symbol}" onclick="window.selectAssetUI('${a.symbol}')">
      <div class="mkt-l"><span class="mkt-sym">${a.symbol}${a.syariah?' <span class="badge-syariah">S</span>':''}${susp?' <span style="color:var(--dn);font-size:9px">⛔SUSPEND</span>':''}</span><span class="mkt-name">${a.name?.substring(0,28)||''}</span>${div?`<span class="div-badge">DIV ${(div.yieldPct*100).toFixed(1)}%</span>`:''}</div>
      <div class="mkt-r"><span class="mkt-price">${fmtP(p?.last,p?.currency)}</span><span class="mkt-chg ${up?'up':'down'}">${up?'+':''}${(p?.changePct||0).toFixed(2)}%</span><span class="mkt-vol">Vol: ${(p?.volume||0).toLocaleString()}</span></div>
    </div>`;
  }).join('');
}

function renderIPOMktList() {
  const el=$('market-list-ipo'); if(!el) return;
  const a=assetsData||{};
  // Only show IPOs that haven't listed yet
  const active=[...(a.ipo||[]),...(a.newCrypto||[]),...(State.get('customAssets')||[]).filter(x=>x.phase&&x.phase!=='listed')];
  el.innerHTML=active.length?active.map(ipo=>`
    <div class="ipo-card">
      <div class="ic-hdr"><span class="ic-sym">${ipo.symbol}</span>${ipo.syariah?'<span class="badge-syariah">S</span>':''}<span class="badge badge-${ipo.phase||'prelisting'}">${(ipo.phase||'').toUpperCase()}</span></div>
      <div class="ic-name">${ipo.name}</div><div class="ic-desc">${ipo.description||''}</div>
      <div class="ic-stats">
        <div><label>Harga Penawaran</label><span>${fmtP(ipo.offerPrice,ipo.currency)}</span></div>
        <div><label>Oversubscribed</label><span class="up">${ipo.subscribed||0}x</span></div>
        <div><label>Berakhir</label><span>${ipo.phaseEnd||'-'}</span></div>
      </div>
      <button class="btn-ipo" onclick="window.openIPOSubscribe('${ipo.symbol}')">Subscribe / Daftar</button>
    </div>`).join('')
    :'<div class="empty-msg">Tidak ada IPO aktif saat ini</div>';
}

// ─── Order Book ───────────────────────────────────────────────
function aggregateVisibleOrders(sym){
  const ordersByUser=State.get('orders')||{};
  const askMap=new Map(), bidMap=new Map();
  Object.values(ordersByUser).forEach(list=>{
    (list||[]).forEach(o=>{
      if(o.symbol!==sym) return;
      if(!['pending','partial'].includes(o.status)) return;
      if(o.type!=='limit'&&o.type!=='take_profit') return;
      const rem=Math.max(0,(o.qty||0)-(o.filledQty||0));
      if(rem<=0||!o.price) return;
      const map=o.side==='buy'?bidMap:askMap;
      map.set(o.price,(map.get(o.price)||0)+rem);
    });
  });
  return {askMap,bidMap};
}

function mergeBookSide(base,pendingMap,isAsk){
  const m=new Map();
  (base||[]).forEach(l=>m.set(l.price,(m.get(l.price)||0)+(l.qty||0)));
  pendingMap.forEach((qty,price)=>m.set(price,(m.get(price)||0)+qty));
  const arr=[...m.entries()].map(([price,qty])=>({price:Number(price),qty:Math.round(qty)}));
  arr.sort((a,b)=>isAsk?a.price-b.price:b.price-a.price);
  return arr;
}

function renderOrderBook() {
  const sym=State.get('activeAsset'); const ob=State.get(`orderBooks.${sym}`); if(!ob) return;
  const ae=$('ob-asks'),be=$('ob-bids'); if(!ae||!be) return;
  const pending=aggregateVisibleOrders(sym);
  const asks=mergeBookSide(ob.asks,pending.askMap,true).slice(0,10);
  const bids=mergeBookSide(ob.bids,pending.bidMap,false).slice(0,10);
  const max=Math.max(...asks.map(l=>l.qty),...bids.map(l=>l.qty),1);
  ae.innerHTML=asks.slice().reverse().map(l=>`<div class="ob-row ask" data-price="${l.price}"><span class="ob-price down">${fmtP(l.price)}</span><span class="ob-qty">${l.qty.toLocaleString()}</span><div class="ob-bar ask-bar" style="width:${(l.qty/max*100).toFixed(1)}%"></div></div>`).join('');
  const ps=State.get(`prices.${sym}`);
  const se=$('ob-spread');
  if(se&&asks[0]&&bids[0]){const sp=((asks[0].price-bids[0].price)/Math.max(1e-9,bids[0].price)*100).toFixed(3);se.innerHTML=`<span class="ob-mid">${fmtP(ps?.last)}</span><span class="ob-spread-label">Spread: ${sp}%</span>`;}
  be.innerHTML=bids.map(l=>`<div class="ob-row bid" data-price="${l.price}"><span class="ob-price up">${fmtP(l.price)}</span><span class="ob-qty">${l.qty.toLocaleString()}</span><div class="ob-bar bid-bar" style="width:${(l.qty/max*100).toFixed(1)}%"></div></div>`).join('');
  [ae,be].forEach(c=>c.querySelectorAll('.ob-row').forEach(r=>r.addEventListener('click',()=>setOBPrice(r.dataset.price))));
}

function setOBPrice(price) {
  const v=parseFloat(price); if(!v) return;
  ['m-order-price','d-order-price'].forEach(id=>{const e=$(id);if(!e)return;e.value=v;e.style.borderColor='var(--yellow)';e.style.boxShadow='0 0 0 2px rgba(240,180,41,.2)';setTimeout(()=>{e.style.borderColor='';e.style.boxShadow='';},500);});
  updateOrderTotals();
}
window.setOBPrice=setOBPrice;

window.setQtyPct=(prefix,pct)=>{
  const sess=State.get('session');if(!sess)return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const sym=State.get('activeAsset'),ps=State.get(`prices.${sym}`);if(!ps)return;
  const side=document.querySelector('.order-side-btn.active')?.dataset.side||'buy';
  const fxR=ps.currency==='IDR'?1:getForexRate('USD/IDR');
  const pfx=prefix.endsWith('-')?prefix.slice(0,-1):prefix;
  const priceInput=$(pfx+'-order-price');
  const usePrice=parseFloat(priceInput?.value)||ps.last;
  let maxQty=0;
  if(side==='buy'){const balIDR=port.cash_idr||0;if(balIDR<=0){toast('Saldo tidak cukup','error');return;}maxQty=Math.floor(balIDR/(usePrice*fxR*(1+FEE_BUY)));}
  else{maxQty=port.holdings?.[sym]?.qty||0;}
  if(maxQty<=0){toast(side==='buy'?'Saldo tidak cukup':'Tidak ada kepemilikan','error');return;}
  const qty=Math.max(1,Math.floor(maxQty*pct/100));
  const qtyInput=$(pfx+'-order-qty');
  if(qtyInput){qtyInput.value=qty;qtyInput.style.borderColor='var(--blue)';qtyInput.style.boxShadow='0 0 0 2px rgba(26,111,255,.2)';setTimeout(()=>{qtyInput.style.borderColor='';qtyInput.style.boxShadow='';},600);updateOrderTotals();}
};

// ─── Trade Tape ───────────────────────────────────────────────
function renderTradeTape() {
  const tape=State.get(`tradeTapes.${State.get('activeAsset')}`)||[];
  const el=$('trade-tape'); if(!el) return;
  el.innerHTML=tape.slice(0,30).map(t=>{const d=new Date(t.time);return `<div class="tape-row"><span class="tape-time">${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</span><span class="tape-price ${t.side==='buy'?'up':'down'}">${fmtP(t.price)}</span><span class="tape-qty">${t.qty.toLocaleString()}</span><span class="tape-side ${t.side}">${t.side.toUpperCase()}</span></div>`;}).join('');
}

// ─── Order Form ───────────────────────────────────────────────
function updateOrderForm(sym) {
  const p=State.get(`prices.${sym}`); if(!p) return;
  const v=p.last.toFixed(p.currency==='IDR'?0:4);
  ['m-order-price','d-order-price'].forEach(id=>{const e=$(id);if(e)e.value=v;});
  updateOrderTotals(); updateOrderBalance(); updateHoldingPanel(sym);
}

function updateOrderBalance() {
  const sess=State.get('session'); if(!sess) return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const sym=State.get('activeAsset'),p=State.get(`prices.${sym}`);
  const fxR=getForexRate('USD/IDR');
  const balIDR=port.cash_idr||0;
  // Show balance in user's preferred currency
  const balDisplay=fmtM(balIDR,'IDR');
  const hld=port.holdings?.[sym];
  ['m-order-balance','d-order-balance'].forEach(id=>setEl(id,balDisplay));
  ['m-order-holding','d-order-holding'].forEach(id=>setEl(id,hld?`${hld.qty.toLocaleString()} lot`:'0 lot'));
}

function updateOrderTotals() {
  const sym=State.get('activeAsset'),p=State.get(`prices.${sym}`);
  const cur=p?.currency||'IDR';
  const fxR=cur==='IDR'?1:getForexRate('USD/IDR');
  const side=document.querySelector('.order-side-btn.active')?.dataset.side||'buy';
  ['m','d'].forEach(pfx=>{
    const qty=parseFloat($(pfx+'-order-qty')?.value)||0;
    const pr=parseFloat($(pfx+'-order-price')?.value)||0;
    const total=qty*pr*fxR; const fee=total*(side==='buy'?FEE_BUY:FEE_SELL);
    setEl(pfx+'-order-total',fmtM(total,'IDR'));
    setEl(pfx+'-order-fee',fmtM(fee,'IDR'));
  });
}

function updateHoldingPanel(sym) {
  const sess=State.get('session'); if(!sess) return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const hld=port.holdings?.[sym];
  const panel=$('trade-holding-panel'); if(!panel) return;
  if(!hld||hld.qty<=0){panel.style.display='none';return;}
  panel.style.display='';
  const ps=State.get(`prices.${sym}`);
  const last=ps?.last||hld.avgCost;
  const fxR=ps?.currency==='IDR'?1:getForexRate('USD/IDR');
  const pnlIDR=(last-hld.avgCost)*hld.qty*fxR;
  const pct=hld.avgCost>0?((last-hld.avgCost)/hld.avgCost*100):0;
  setEl('thp-qty',hld.qty.toLocaleString());
  setEl('thp-avg',fmtP(hld.avgCost,ps?.currency||'IDR'));
  setEl('thp-last',fmtP(last,ps?.currency||'IDR'));
  const pi=$('thp-pnl-idr');if(pi){pi.textContent=`${pnlIDR>=0?'+':''}${fmtM(pnlIDR,'IDR')}`;pi.className=`thp-pnl-idr ${pnlIDR>=0?'up':'down'}`;}
  const pp=$('thp-pnl-pct');if(pp){pp.textContent=`${pct>=0?'+':''}${pct.toFixed(2)}%`;pp.className=`thp-pnl-pct ${pct>=0?'up':'down'}`;}
  const di=$('thp-div-info');
  if(di&&DIVIDEND_STOCKS?.[sym]){const info=DIVIDEND_STOCKS[sym];const annDiv=round((last*info.yieldPct)*hld.qty*fxR,0);di.textContent=`Dividen est. ${fmtM(annDiv,'IDR')}/thn (yield ${(info.yieldPct*100).toFixed(1)}%)`;}
  else if(di) di.textContent='';
}

function submitOrder(pfx) {
  const sess=State.get('session');if(!sess)return;
  const side=document.querySelector('.order-side-btn.active')?.dataset.side||'buy';
  const type=$(pfx+'-order-type')?.value||'limit';
  const qty=parseFloat($(pfx+'-order-qty')?.value);
  const price=parseFloat($(pfx+'-order-price')?.value);
  const stop=parseFloat($(pfx+'-order-stop')?.value)||null;
  const tif=$(pfx+'-order-tif')?.value||'GTC';
  if(!qty||qty<=0){toast('Qty harus > 0','error');return;}
  const r=placeOrder({userId:sess.userId,symbol:State.get('activeAsset'),side,type,qty,price,stopPrice:stop,tif});
  r.ok?toast(`Order ${r.orderId} ditempatkan`,'success'):toast(`❌ ${r.error}`,'error');
}

// ─── Desktop Portfolio ────────────────────────────────────────
function updateDesktopPort() {
  const sess=State.get('session');if(!sess)return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const fxR=getForexRate('USD/IDR');
  const h=Object.entries(port.holdings||{});
  let equity=port.cash_idr||0,unr=0;
  h.forEach(([sym,hld])=>{const p=State.get(`prices.${sym}`);if(!p)return;equity+=p.currency==='IDR'?p.last*hld.qty:p.last*hld.qty*fxR;unr+=(p.last-hld.avgCost)*hld.qty*(p.currency==='IDR'?1:fxR);});
  setEl('d-cash-idr',fmtM(port.cash_idr||0,'IDR'));
  setEl('d-cash-usd',fmtM((port.cash_idr||0)/fxR,'USD'));
  setEl('d-equity',fmtM(equity,'IDR'));
  const ue=$('d-unrealized');if(ue){ue.textContent=fmtM(unr,'IDR');ue.className=`mono ${unr>=0?'up':'down'}`;}
  setEl('topnav-equity',fmtM(equity,'IDR'));
  const dh=$('d-holdings');
  if(dh) dh.innerHTML=!h.length?'<div style="font-size:11px;color:var(--t3)">Belum ada kepemilikan</div>':h.map(([sym,hld])=>{const p=State.get(`prices.${sym}`);const last=p?.last||hld.avgCost;const pnl=(last-hld.avgCost)*hld.qty*(p?.currency==='IDR'?1:fxR);return`<div class="d-hr" onclick="window.selectAssetUI('${sym}')"><div><div class="dhr-sym">${sym}</div><div class="dhr-qty">${hld.qty.toLocaleString()} lot</div></div><div class="dhr-pnl ${pnl>=0?'up':'down'}">${pnl>=0?'+':''}${fmtM(pnl,'IDR')}</div></div>`;}).join('');
  renderDesktopOrders();
}

function renderDesktopOrders() {
  const el=$('d-open-orders');if(!el)return;
  const sess=State.get('session');if(!sess)return;
  const orders=(State.get(`orders.${sess.userId}`)||[]).filter(o=>['pending','partial'].includes(o.status)).slice(0,12);
  el.innerHTML=!orders.length?'<div style="font-size:11px;color:var(--t3)">Tidak ada open order</div>':orders.map(o=>`<div class="d-or"><div class="dor-main"><div class="dor-sym ${o.side==='buy'?'up':'down'}">${o.symbol} ${o.side.toUpperCase()}</div><div class="dor-info">${o.type} · ${fmtP(o.price||0)} · ${o.filledQty}/${o.qty}</div><span class="badge badge-${o.status}">${o.status}</span></div><button class="dor-cancel" onclick="window.cancelOrderUI('${o.orderId}')">✕</button></div>`).join('');
}

// ─── Portfolio Page ───────────────────────────────────────────
function renderPortfolio() {
  const sess=State.get('session');if(!sess)return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const fxR=getForexRate('USD/IDR');
  const h=Object.entries(port.holdings||{});
  let equity=port.cash_idr||0,unr=0,totalInvested=0;
  h.forEach(([sym,hld])=>{const p=State.get(`prices.${sym}`);if(!p)return;const fx=p.currency==='IDR'?1:fxR;equity+=p.last*hld.qty*fx;unr+=(p.last-hld.avgCost)*hld.qty*fx;totalInvested+=hld.avgCost*hld.qty*fx;});
  setEl('port-equity',fmtM(equity,'IDR'));
  const cashEl=$('port-cash-idr');if(cashEl){cashEl.textContent=fmtM(port.cash_idr||0,'IDR');cashEl.className=`pc2-v${(port.cash_idr||0)<0?' down':''}`;}
  setEl('port-cash-usd',fmtM((port.cash_idr||0)/fxR,'USD'));
  const ue=$('port-unrealized');if(ue){ue.textContent=`${unr>=0?'+':''}${fmtM(unr,'IDR')}`;ue.className=`psc-item-val ${unr>=0?'up':'down'}`;}
  const realizedGain=port.realizedPnl||0;
  const totalDivs=port.totalDividends||0;
  setEl('port-realized',fmtM(realizedGain,'IDR'));
  setEl('port-dividend',fmtM(totalDivs,'IDR'));
  setEl('port-fees',fmtM(port.totalFees||0,'IDR'));
  setEl('port-invested',fmtM(totalInvested,'IDR'));
  const totalReturn=unr+realizedGain+totalDivs;
  const roi=totalInvested>0?(totalReturn/totalInvested*100):0;
  const roiEl=$('port-total-roi');if(roiEl){roiEl.textContent=`${roi>=0?'+':''}${roi.toFixed(2)}%`;roiEl.className=`psc-roi-val ${roi>=0?'up':'down'}`;}

  // Holdings
  const hl=$('port-holdings-list');
  if(hl) hl.innerHTML=!h.length?'<div class="empty-msg">Belum ada kepemilikan</div>':h.map(([sym,hld])=>{
    const p=State.get(`prices.${sym}`),last=p?.last||hld.avgCost,cur=p?.currency||'IDR',fx=cur==='IDR'?1:fxR;
    const pnl=(last-hld.avgCost)*hld.qty*fx,pct=hld.avgCost>0?((last-hld.avgCost)/hld.avgCost*100):0;
    const a=allAssets().find(x=>x.symbol===sym);
    const divInfo=DIVIDEND_STOCKS?.[sym];
    return `<div class="phl-item" onclick="window.selectAssetUI('${sym}')">
      <div class="phl-top"><div><div class="phl-sym">${sym}</div><div class="phl-name">${a?.name?.substring(0,22)||''}</div></div>
        <div><div class="phl-pnl-v ${pnl>=0?'up':'down'}">${pnl>=0?'+':''}${fmtM(pnl,'IDR')}</div><div class="phl-pnl-p ${pnl>=0?'up':'down'}">${pct>=0?'+':''}${pct.toFixed(2)}%</div></div></div>
      <div class="phl-stats"><div class="phl-stat"><label>Qty</label><span>${hld.qty.toLocaleString()}</span></div><div class="phl-stat"><label>Avg</label><span>${fmtP(hld.avgCost,cur)}</span></div><div class="phl-stat"><label>Last</label><span>${fmtP(last,cur)}</span></div></div>
      ${divInfo?`<div class="phl-div-hint">Dividen yield ${(divInfo.yieldPct*100).toFixed(1)}%/thn · est. ${fmtM(round(last*divInfo.yieldPct*hld.qty*fx,0),'IDR')}</div>`:''}
      <div class="phl-actions">
        <button class="btn-sell-q" onclick="event.stopPropagation();window.quickSell('${sym}',${hld.qty})">Jual Semua</button>
        ${a?.custom&&a?.isCrypto?`<button class="btn-sell-q" style="background:rgba(240,64,64,.12);border-color:rgba(240,64,64,.35);color:var(--dn)" onclick="event.stopPropagation();window.rugPullUI('${sym}')">Rugpull</button>`:''}
        <button class="btn-chart-q" onclick="event.stopPropagation();window.selectAssetUI('${sym}')">Chart</button>
      </div></div>`;
  }).join('');

  // Open Orders
  const orders=(State.get(`orders.${sess.userId}`)||[]).filter(o=>['pending','partial'].includes(o.status));
  const oc=$('port-orders-count');if(oc)oc.textContent=orders.length;
  const ol=$('port-orders-list');
  if(ol)ol.innerHTML=!orders.length?'<div class="empty-msg">Tidak ada order aktif</div>':orders.slice(0,30).map(o=>`<div class="por-item"><div><div class="por-sym ${o.side==='buy'?'up':'down'}">${o.symbol} · ${o.side.toUpperCase()}</div><div class="por-detail">${o.type} · ${fmtP(o.price||0)} · ${o.filledQty}/${o.qty} lot</div></div><div style="display:flex;align-items:center;gap:6px"><span class="badge badge-${o.status}">${o.status}</span><button class="dor-cancel" onclick="window.cancelOrderUI('${o.orderId}')">✕</button></div></div>`).join('');

  // Sell/Trade History (riwayat jual dengan detail)
  const sellHist=(port.tradeHistory||[]).slice(0,50);
  const sh=$('port-sell-history');
  if(sh)sh.innerHTML=!sellHist.length?'<div class="empty-msg">Belum ada riwayat jual</div>':sellHist.map(s=>`
    <div class="sh-item">
      <div class="sh-top"><span class="sh-sym ${s.realized>=0?'up':'down'}">${s.symbol}</span><span class="sh-pnl ${s.realized>=0?'up':'down'}">${s.realized>=0?'+':''}${fmtM(s.realized,'IDR')}</span></div>
      <div class="sh-detail">${s.qty.toLocaleString()} lot · Avg Beli ${fmtP(s.avgCost,s.currency)} → Jual ${fmtP(s.sellPrice,s.currency)} · ${s.pnlPct>=0?'+':''}${s.pnlPct?.toFixed(2)}%</div>
      <div class="sh-meta">Fee: ${fmtM(s.fee,'IDR')} · ${new Date(s.soldAt).toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
    </div>`).join('');

  // Transaction history
  const txs=(State.get(`transactions.${sess.userId}`)||[]).slice(0,50);
  const tl=$('port-tx-list');
  if(tl)tl.innerHTML=!txs.length?'<div class="empty-msg">Belum ada transaksi</div>':txs.map(tx=>`<div class="tx-item"><div><div class="tx-type ${tx.type==='buy'?'up':'down'}">${tx.type.toUpperCase()} ${tx.symbol}</div><div class="tx-detail">${tx.qty.toLocaleString()} lot @ ${fmtP(tx.price)}</div></div><div><div class="tx-amount">${fmtM(tx.amount,tx.currency)}</div><div class="tx-time">${new Date(tx.timestamp).toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div></div></div>`).join('');
}

// ─── Wallet ───────────────────────────────────────────────────
window.switchWalletCurrency=(c)=>{walletCur=c;$('cur-btn-idr')?.classList.toggle('active',c==='IDR');$('cur-btn-usd')?.classList.toggle('active',c==='USD');renderWallet();};

function renderForexRates() {
  const el=$('forex-rates-grid');if(!el)return;
  el.innerHTML=['USD/IDR','EUR/IDR','XAU/IDR','XAU/USD'].map(pair=>{
    const p=State.get(`prices.${pair}`);if(!p)return'';
    const up=(p.changePct||0)>=0;
    return `<div class="fr-item" onclick="window.selectAssetUI('${pair}')"><div class="fr-pair">${pair}</div><div class="fr-price">${fmtP(p.last,p.currency)}</div><div class="fr-chg ${up?'up':'down'}">${up?'+':''}${(p.changePct||0).toFixed(2)}%</div></div>`;
  }).join('');
}

function renderWallet() {
  const sess=State.get('session');if(!sess)return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const fxR=getForexRate('USD/IDR');
  const totalIDR=port.cash_idr||0;
  const walletValEl=$('wallet-total');
  if(walletValEl){walletValEl.textContent=walletCur==='IDR'?fmtM(totalIDR,'IDR'):fmtM(totalIDR/fxR,'USD');walletValEl.className=`wtc-val${totalIDR<0?' down':''}`;}
  setEl('wallet-total-usd',walletCur==='IDR'?`≈ ${fmtM(totalIDR/fxR,'USD')} USD`:`≈ ${fmtM(totalIDR,'IDR')} IDR`);
  const warnEl=$('wallet-neg-warn');
  if(warnEl){warnEl.style.display=totalIDR<0?'':'none';if(totalIDR<0)warnEl.textContent=`⚠️ Saldo negatif ${fmtM(totalIDR,'IDR')}. Jual aset atau deposit untuk pulihkan saldo.`;}
  renderForexRates();

  // Dividend claims
  const divs=(State.get(`dividends.${sess.userId}`)||[]);
  const unclaimed=divs.filter(d=>!d.claimed);
  const divCount=$('div-claim-count');if(divCount)divCount.textContent=unclaimed.length;
  const divSection=$('dividend-claim-section');if(divSection)divSection.style.display=unclaimed.length?'':'none';
  const divList=$('dividend-claim-list');
  if(divList)divList.innerHTML=unclaimed.map(d=>`
    <div class="div-claim-item">
      <div class="dci-top"><span class="dci-sym">${d.symbol}</span><span class="dci-amt">${fmtM(d.totalAmount,'IDR')}</span></div>
      <div class="dci-detail">${d.qty.toLocaleString()} lot × ${fmtP(d.divPerShare)} · ${d.note||`Yield ${(d.yieldPct*100).toFixed(1)}%`}</div>
      <div class="dci-meta">${new Date(d.cumDate).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})}</div>
      <button class="btn-claim-div" onclick="window.claimDiv('${d.id}')">Claim Rp${d.totalAmount.toLocaleString()}</button>
    </div>`).join('');

  const deps=(State.get(`deposits.${sess.userId}`)||[]).slice(0,40);
  const txs=(State.get(`transactions.${sess.userId}`)||[]).slice(0,80);
  const el=$('wallet-history');if(!el)return;
  const cashEvents=[
    ...deps.map(d=>({
      t:new Date(d.createdAt).getTime(),
      cls:d.type==='withdraw'?'wd':'dep',
      type:d.type==='withdraw'?'Withdraw':'Deposit',
      up:d.type!=='withdraw',
      amountIDR:d.amountIDR||d.amount||0,
      detail:`${d.method} · ${d.status}${d.adminNote?' · '+d.adminNote:''}`,
      when:d.createdAt,
    })),
    ...txs.filter(tx=>['buy','sell','ipo_subscribe','dividend_claim','dividend_claim_all','withdraw'].includes(tx.type)).map(tx=>{
      const buyLike=['buy','ipo_subscribe','withdraw'].includes(tx.type);
      const inLike=['sell','dividend_claim','dividend_claim_all'].includes(tx.type);
      const sign=inLike?1:-1;
      return {
        t:new Date(tx.timestamp).getTime(),
        cls:buyLike?'wd':'dep',
        type:tx.type==='ipo_subscribe'?'IPO Subscribe':tx.type==='dividend_claim'?'Claim Dividen':tx.type==='dividend_claim_all'?'Claim Semua Dividen':tx.type==='withdraw'?'Withdraw':tx.type.toUpperCase(),
        up:sign>0,
        amountIDR:(tx.amount||0)*sign,
        detail:`${tx.symbol||'-'} · Qty ${(tx.qty||0).toLocaleString()} · ${fmtP(tx.price,tx.currency)}`,
        when:tx.timestamp,
      };
    }),
  ].sort((a,b)=>b.t-a.t).slice(0,80);
  el.innerHTML=!cashEvents.length?'<div class="empty-msg">Belum ada riwayat</div>':cashEvents.map(ev=>{
    const amt=walletCur==='IDR'?ev.amountIDR:(ev.amountIDR/fxR);
    return `<div class="wh-item ${ev.cls}"><div class="wh-top"><div class="wh-type ${ev.up?'up':'down'}">${ev.type}</div><div class="wh-amount">${ev.up?'+':''}${fmtM(amt,walletCur)}</div></div><div class="wh-detail">${ev.detail}</div><div class="wh-time">${new Date(ev.when).toLocaleString('id-ID')}</div></div>`;
  }).join('');
}

window.claimDiv=(id)=>{
  const sess=State.get('session');if(!sess)return;
  const r=claimDividend(sess.userId,id);
  if(r.ok){toast(`✅ Dividen ${fmtM(r.amount,'IDR')} berhasil diclaim!`,'success');renderWallet();renderDividendBadge();}
  else toast(`❌ ${r.error}`,'error');
};
window.claimAllDivs=()=>{
  const sess=State.get('session');if(!sess)return;
  const r=claimAllDividends(sess.userId);
  if(r.ok){toast(`✅ Semua dividen ${fmtM(r.total,'IDR')} berhasil diclaim!`,'success');renderWallet();renderDividendBadge();}
  else toast(r.error,'warn');
};

function submitDeposit(){
  const sess=State.get('session');if(!sess)return;
  const amount=parseFloat($('dep-amount')?.value);const currency=$('dep-currency')?.value||'IDR';const method=$('dep-method')?.value;
  if(!amount||amount<=0){toast('Masukkan jumlah yang valid','error');return;}
  requestDeposit(sess.userId,amount,currency,method);
  toast(`Deposit ${fmtM(amount,currency)} sedang diproses...`,'info');$('dep-amount').value='';
}

function submitWithdraw(){
  const sess=State.get('session');if(!sess)return;
  const amount=parseFloat($('wd-amount')?.value);const currency=$('wd-currency')?.value||'IDR';
  const method=$('wd-method')?.value||'Transfer Bank BCA';
  const destination=($('wd-account')?.value||'').trim();
  if(!amount||amount<=0){toast('Masukkan jumlah valid','error');return;}
  if(!destination){toast('Masukkan rekening/akun tujuan','error');return;}
  const r=requestWithdraw(sess.userId,amount,currency,method,destination);
  if(!r.ok){toast(`❌ ${r.error}`,'error');return;}
  toast(`Withdraw ${fmtM(amount,currency)} diajukan (${method}) — status pending`,'info');
  $('wd-amount').value=''; $('wd-account').value='';
  renderWallet();
}

// ─── News Page ────────────────────────────────────────────────
function renderNewsFull(){
  const el=$('news-feed-full');if(!el)return;
  const evts=(State.get('newsEvents')||[]).slice().reverse().slice(0,60);
  el.innerHTML=evts.length?evts.map(newsCard).join(''):'<div class="empty-msg">Belum ada berita</div>';
}

function fillNewsAssets(){
  const sel=$('news-asset-select');if(!sel||sel.options.length>1)return;
  sel.innerHTML=allAssets().map(a=>`<option value="${a.symbol}">${a.symbol} — ${a.name?.substring(0,26)||''}</option>`).join('');
}

function publishNews(){
  const title=$('news-title')?.value?.trim();const sym=$('news-asset-select')?.value;
  const impact=parseFloat($('news-impact')?.value)||0;const cat=$('news-category')?.value||'neutral';
  if(!title){toast('Tulis judul berita','error');return;}
  const sentiment=impact/100;
  const ps=State.get(`prices.${sym}`);
  if(ps&&impact){
    const dec=ps.last>1000?0:ps.last>1?4:8;
    const nl=Math.max(0.000001,round(ps.last*(1+sentiment),dec));
    const op=ps.open>0?ps.open:nl;
    State.set(`prices.${sym}`,{...ps,last:nl,changePct:Math.max(-99,Math.min(99,round((nl-op)/op*100,2)))});
  }
  const evt={id:'CUSTOM'+Date.now(),symbol:sym,message:title,sentiment,category:cat,time:(State.get('simTime')||new Date()).toISOString(),read:false,custom:true};
  State.push('newsEvents',evt);State.emit('news.new',evt);State.saveToStorage();
  toast(`Berita dipublikasi! ${sym} ${sentiment>=0?'+':''}${(sentiment*100).toFixed(1)}%`,'success');
  $('news-title').value='';renderNewsFull();
}

// ─── IPO Page ─────────────────────────────────────────────────
window.openIPOSubscribe=(sym)=>{
  const a=assetsData||{};
  const ipos=[...(a.ipo||[]),...(a.newCrypto||[]),...(State.get('customAssets')||[])];
  const ipo=ipos.find(x=>x.symbol===sym);if(!ipo)return;
  const ps=State.get(`prices.${sym}`);
  const price=ipo.offerPrice;
  const sess=State.get('session');if(!sess)return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const maxLots=Math.floor((port.cash_idr||0)/(price*1.001));
  openInputModal({
    title:`Subscribe IPO ${sym}`,
    message:`Harga ${fmtP(price,ipo.currency)} · Maks lot ${maxLots.toLocaleString()}`,
    placeholder:'Masukkan jumlah lot',
    confirmText:'Subscribe',
    defaultValue:'1',
    inputType:'number',
    onConfirm:(raw)=>{
      const lots=parseInt(raw,10);
      if(!lots||lots<=0){toast('Jumlah lot tidak valid','error');return false;}
      const r=subscribeToIPO(sess.userId,sym,lots);
      if(!r.ok){ toast(`❌ ${r.error}`,'error'); return false; }
      toast(`✅ Subscribe ${sym} ${lots.toLocaleString()} lot berhasil! Dana ${fmtM(r.cost,'IDR')} diblokir.`,'success');
      renderIPOPage();
      return true;
    },
  });
};

function renderIPOPage(){
  const a=assetsData||{};
  const subs=State.get('ipoSubscriptions')||{};
  const sess=State.get('session');
  const userSubs=sess?subs[sess.userId]||{}:{};

  // Active IPOs (not yet listed)
  const active=[...(a.ipo||[]),...(a.newCrypto||[]),...(State.get('customAssets')||[]).filter(x=>x.phase&&x.phase!=='listed')];
  const al=$('ipo-active-list');
  if(al)al.innerHTML=!active.length?'<div class="empty-msg">Tidak ada IPO aktif</div>':active.map(ipo=>{
    const sub=userSubs[ipo.symbol];
    return `<div class="ipo-card">
      <div class="ic-hdr"><span class="ic-sym">${ipo.symbol}</span>${ipo.syariah?'<span class="badge-syariah">S</span>':''}<span class="badge badge-${ipo.phase||'prelisting'}">${(ipo.phase||'').toUpperCase()}</span>${ipo.custom?'<span class="badge" style="background:rgba(155,93,229,.15);color:var(--purple)">Custom</span>':''}</div>
      <div class="ic-name">${ipo.name}</div><div class="ic-desc">${ipo.description||''}</div>
      <div class="ic-stats"><div><label>Harga Penawaran</label><span>${fmtP(ipo.offerPrice,ipo.currency)}</span></div><div><label>Oversubscribed</label><span class="up">${ipo.subscribed||0}x</span></div><div><label>Berakhir</label><span>${ipo.phaseEnd||'-'}</span></div></div>
      ${sub?`<div class="ipo-sub-badge">✅ Sudah subscribe: ${sub.qty?.toLocaleString()} lot · ${fmtM(sub.cost,'IDR')}</div>`:`<button class="btn-ipo" onclick="window.openIPOSubscribe('${ipo.symbol}')">Subscribe / Daftar</button>`}
    </div>`;
  }).join('');

  // IPO History (listed)
  const listed=State.get('listedAssets')||[];
  const lh=$('ipo-history-list');
  if(lh){
    const userListedSubs=Object.entries(userSubs).filter(([sym,sub])=>sub.status==='fulfilled');
    lh.innerHTML=!userListedSubs.length&&!listed.length?'<div class="empty-msg">Belum ada IPO yang listing</div>':listed.map(asset=>{
      const sub=userSubs[asset.symbol];
      const ps=State.get(`prices.${asset.symbol}`);
      const gain=sub&&ps?((ps.last-sub.offerPrice)*sub.qty*(ps.currency==='IDR'?1:getForexRate('USD/IDR'))):0;
      return `<div class="ipo-hist-item" onclick="window.selectAssetUI('${asset.symbol}')">
        <div class="ihi-top"><span class="ihi-sym">${asset.symbol}</span><span class="badge badge-listed">LISTED</span></div>
        <div class="ihi-name">${asset.name}</div>
        ${sub?`<div class="ihi-alloc">Alokasi: ${sub.qty?.toLocaleString()} lot @ ${fmtP(sub.offerPrice,ps?.currency)} → Sekarang ${fmtP(ps?.last,ps?.currency)} <span class="${gain>=0?'up':'down'}">${gain>=0?'+':''}${fmtM(gain,'IDR')}</span></div>`:''}
        <div class="ihi-trade">Harga Kini: ${fmtP(ps?.last,ps?.currency)} · <a href="#" onclick="event.preventDefault();window.selectAssetUI('${asset.symbol}')">Trade Sekarang →</a></div>
      </div>`;
    }).join('');
  }
}

// ─── Control Panel ────────────────────────────────────────────
function renderControlPanel(){
  const suspended=State.get('suspendedAssets')||{};
  const ihsgHalted=State.get('ihsgHalted')||false;
  const marketAct=State.get('marketActivity')||{all:1,stocks:1,crypto:1,forex:1};

  const sl=$('ctrl-suspended-list');
  if(sl){
    const suspList=Object.entries(suspended);
    sl.innerHTML=!suspList.length?'<div class="empty-msg">Tidak ada aset yang disuspensi</div>':suspList.map(([sym,info])=>`
      <div class="ctrl-item"><div><div class="ctrl-sym">⛔ ${sym}</div><div class="ctrl-reason">${info.reason}</div></div>
      <button class="ctrl-btn unsuspend" onclick="window.unsuspendAssetUI('${sym}')">Aktifkan</button></div>`).join('');
  }

  const haltBtn=$('btn-ihsg-halt');
  if(haltBtn){haltBtn.textContent=ihsgHalted?'▶ Resume IHSG':'⏸ Halt IHSG';haltBtn.className=`ctrl-big-btn ${ihsgHalted?'green':'red'}`;}
  setEl('ihsg-halt-status',ihsgHalted?`🔴 IHSG DIHENTIKAN: ${State.get('ihsgHaltReason')||''}` :'🟢 IHSG Normal');
  const targetSel=$('market-activity-target');
  const slider=$('market-activity-slider');
  const valLbl=$('market-activity-value');
  if(targetSel&&slider&&valLbl){
    const key=targetSel.value||'all';
    slider.value=String(marketAct[key]??1);
    valLbl.textContent=`${parseFloat(slider.value).toFixed(2)}x`;
  }

  const sess=State.get('session');
  const rugList=$('ctrl-rugpull-list');
  if(rugList&&sess){
    const port=State.get(`portfolio.${sess.userId}`)||{};
    const candidates=Object.entries(port.holdings||{}).filter(([sym,h])=>{
      if(!h||h.qty<=0) return false;
      const asset=allAssets().find(a=>a.symbol===sym);
      return !!asset?.custom&&!!asset?.isCrypto;
    });
    rugList.innerHTML=!candidates.length
      ?'<div class="empty-msg">Belum ada custom crypto yang bisa dirugpull</div>'
      :candidates.map(([sym,h])=>`<div class="ctrl-item">
          <div><div class="ctrl-sym">${sym}</div><div class="ctrl-reason">${h.qty.toLocaleString()} coin tersedia</div></div>
          <button class="ctrl-big-btn red" style="height:34px;padding:0 10px;font-size:11px" onclick="window.rugPullUI('${sym}')">Rugpull</button>
        </div>`).join('');
  }
}

window.suspendAssetUI=(sym)=>{
  openInputModal({
    title:`Suspensi ${sym}`,
    message:'Masukkan alasan suspensi aset.',
    placeholder:'Contoh: Unusual market activity',
    defaultValue:'Investigasi bursa',
    confirmText:'Suspensi',
    onConfirm:(reasonRaw)=>{
      const reason=(reasonRaw||'').trim()||'Investigasi bursa';
      suspendAsset(sym,reason); renderControlPanel();
      return true;
    },
  });
};
window.unsuspendAssetUI=(sym)=>{ unsuspendAsset(sym); renderControlPanel(); };
window.haltIHSGUI=()=>{
  openInputModal({
    title:'Halt IHSG',
    message:'Masukkan alasan penghentian perdagangan sementara.',
    placeholder:'Contoh: Circuit breaker level 1',
    defaultValue:'Circuit Breaker',
    confirmText:'Halt',
    onConfirm:(reasonRaw)=>{
      const reason=(reasonRaw||'').trim()||'Circuit Breaker';
      haltIHSG(reason); renderControlPanel();
      return true;
    },
  });
};
window.resumeIHSGUI=()=>{ resumeIHSG(); renderControlPanel(); };
window.rugPullUI=(sym)=>{
  const sess=State.get('session');if(!sess)return;
  const port=State.get(`portfolio.${sess.userId}`)||{};
  const hld=port.holdings?.[sym];
  if(!hld||hld.qty<=0){toast(`Kamu tidak pegang ${sym}. Bikin dulu crypto-nya.`,'error');return;}
  const ps=State.get(`prices.${sym}`);
  const val=round((ps?.last||0)*hld.qty,0);
  openConfirmModal({
    title:`RUGPULL ${sym}`,
    message:`Kamu akan jual ${hld.qty.toLocaleString()} lot (≈ ${fmtM(val,'IDR')}).\nHarga dapat crash 80-95% dan berisiko denda OJK 150%.`,
    confirmText:'Lanjutkan',
    danger:true,
    onConfirm:()=>{
      const r=rugPullCrypto(sess.userId,sym);
      if(r.ok){toast(`💰 Rugpull berhasil. Profit: ${fmtM(r.profit,'IDR')}${r.fined?` | ⚖️ DENDA: ${fmtM(r.fine,'IDR')}`:''}`,r.fined?'error':'warn');}
      else toast(`❌ ${r.error}`,'error');
    }
  });
};

// ─── Crypto Creator ───────────────────────────────────────────
function createCryptoUI(){
  const sess=State.get('session');if(!sess)return;
  const sym=($('cc-symbol')?.value||'').toUpperCase().trim();
  const name=$('cc-name')?.value?.trim();
  const supply=parseInt($('cc-supply')?.value)||0;
  const price=parseFloat($('cc-price')?.value)||0;
  const desc=$('cc-desc')?.value?.trim()||'';
  if(!sym||sym.length<2){toast('Simbol minimal 2 karakter','error');return;}
  if(!name){toast('Masukkan nama coin','error');return;}
  if(!supply||supply<1000){toast('Total supply minimal 1.000 coin','error');return;}
  if(!price||price<=0){toast('Harga awal harus > 0','error');return;}
  const r=createCryptoCoin(sess.userId,{symbol:sym,name,totalSupply:supply,initialPrice:price,description:desc});
  if(r.ok){
    toast(`🚀 ${sym} berhasil diluncurkan! Kamu pegang ${r.creatorQty.toLocaleString()} coin (20%). Fee server: ${fmtM(r.listingFee,'IDR')}`,'success');
    ['cc-symbol','cc-name','cc-supply','cc-price','cc-desc'].forEach(id=>{const e=$(id);if(e)e.value='';});
    renderControlPanel(); renderSidebar(); renderMarketLists();
  } else toast(`❌ ${r.error}`,'error');
}

// ─── Sim Time ─────────────────────────────────────────────────
function updateSimTime(){
  const t=State.get('simTime');if(!t)return;
  const el=$('sim-time');if(el)el.textContent=t.toLocaleDateString('id-ID',{day:'2-digit',month:'short'})+' '+t.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const se=$('sim-speed-label');if(se)se.textContent=`${State.get('simSpeed')||1}x`;
  updateIHSGDisplay();
}

function skipTime(mins){
  const label=mins>=10080?`${Math.floor(mins/1440)} minggu`:mins>=1440?`${Math.floor(mins/1440)} hari`:`${Math.floor(mins/60)} jam`;
  toast(`Melompat ${label} ke depan...`,'info');
  skipSimTime(mins);
  setTimeout(()=>{
    updateSimTime(); renderSidebarPrices(); updateTradeHeader(State.get('activeAsset'));
    if(chart&&chartInited) chart.load(State.get('activeAsset'),State.get('activeTimeframe')||'5m');
    if(currentPage==='home') refreshHome();
    if(currentPage==='portfolio') renderPortfolio();
    if(currentPage==='market') renderMarketLists();
    if(currentPage==='wallet') renderWallet();
    renderOrderBook(); renderTradeTape(); updateOrderBalance(); renderDividendBadge();
  },80);
}

// ─── Bind All ─────────────────────────────────────────────────
function bindAll(){
  $('btn-logout')?.addEventListener('click',handleLogout);
  $('btn-theme')?.addEventListener('click',()=>applyTheme(State.get('theme')==='dark'?'light':'dark'));
  $('btn-open-wallet')?.addEventListener('click',()=>navigateTo('wallet'));
  document.querySelectorAll('.bnav').forEach(b=>b.addEventListener('click',()=>navigateTo(b.dataset.page)));
  document.querySelectorAll('.mkt-tab').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.mkt-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    document.querySelectorAll('.mkt-list').forEach(el=>el.style.display=el.id.endsWith(b.dataset.mkt)?'block':'none');
  }));
  $('market-search')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.mkt-item,.ipo-card').forEach(el=>el.style.display=el.textContent.toLowerCase().includes(q)?'':'none');});
  $('sidebar-search')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.sidebar-item').forEach(el=>el.style.display=el.textContent.toLowerCase().includes(q)?'':'none');});
  document.querySelectorAll('.sat').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.sat').forEach(x=>x.classList.remove('active'));b.classList.add('active');sidebarTab=b.dataset.sat;renderSidebar();}));
  document.querySelectorAll('.trade-stab').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.trade-stab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    const isChart=b.dataset.stab==='chart';
    const cv=$('trade-view-chart'),bv=$('trade-view-book');
    if(cv)cv.style.display=isChart?'':'none'; if(bv)bv.style.display=isChart?'none':'';
    if(isChart)requestAnimationFrame(()=>requestAnimationFrame(ensureChart));
  }));
  document.querySelectorAll('.order-side-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const side=btn.dataset.side;
    document.querySelectorAll('.order-side-btn').forEach(b=>b.classList.toggle('active',b.dataset.side===side));
    ['order-form-mob','order-form-desktop'].forEach(id=>{const f=$(id);if(f)f.className=`order-form ${side}-mode`;});
    ['m-btn-place-order','d-btn-place-order'].forEach(id=>{
      const b=$(id);if(!b)return; b.className=`btn-place ${side}`;
      const icon=side==='buy'?'M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z':'M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z';
      b.innerHTML=`<svg viewBox="0 0 20 20" fill="currentColor" width="14"><path fill-rule="evenodd" d="${icon}" clip-rule="evenodd"/></svg> ${side==='buy'?'BELI SEKARANG':'JUAL SEKARANG'}`;
    });
    updateOrderTotals();
  }));
  ['m-order-type','d-order-type'].forEach(id=>$(id)?.addEventListener('change',e=>{
    const t=e.target.value,pfx=id.startsWith('m')?'m':'d';
    $(pfx+'-price-row')&&($(pfx+'-price-row').style.display=t==='market'?'none':'');
    $(pfx+'-stop-row')&&($(pfx+'-stop-row').style.display=['stop_market','stop_limit'].includes(t)?'':'none');
  }));
  ['m-order-qty','m-order-price','d-order-qty','d-order-price'].forEach(id=>$(id)?.addEventListener('input',updateOrderTotals));
  $('m-btn-place-order')?.addEventListener('click',()=>submitOrder('m'));
  $('d-btn-place-order')?.addEventListener('click',()=>submitOrder('d'));
  document.querySelectorAll('.tf-btn').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.tf-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    State.set('activeTimeframe',b.dataset.tf);if(chart&&chartInited)chart.load(State.get('activeAsset'),b.dataset.tf);
  }));
  document.querySelectorAll('.ind-btn').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('active');chart?.toggleIndicator(b.dataset.ind);}));
  $('btn-zoom-in')?.addEventListener('click',()=>{chart?.zoomIn(2);});
  $('btn-zoom-out')?.addEventListener('click',()=>{chart?.zoomOut(2);});
  $('btn-zoom-reset')?.addEventListener('click',()=>{chart?.resetZoom();});
  document.querySelectorAll('.speed-btn:not(.speed-day)').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.speed-btn:not(.speed-day)').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    State.set('simSpeed',parseInt(b.dataset.speed));updateSimTime();
  }));
  $('btn-skip-day')?.addEventListener('click',()=>skipTime(1440));
  $('btn-skip-week')?.addEventListener('click',()=>skipTime(10080));
  $('btn-deposit')?.addEventListener('click',submitDeposit);
  $('btn-withdraw')?.addEventListener('click',submitWithdraw);
  $('btn-publish-news')?.addEventListener('click',publishNews);
  $('news-impact')?.addEventListener('input',e=>{const v=parseFloat(e.target.value);const l=$('news-impact-label');if(l){l.textContent=`${v>=0?'+':''}${v}%`;l.className=`impact-label ${v>=0?'up':'down'}`;}});
  $('btn-create-asset')?.addEventListener('click',()=>{
    const sess=State.get('session');if(!sess)return;
    const sym=($('new-asset-symbol')?.value||'').toUpperCase().trim(),name=$('new-asset-name')?.value?.trim();
    const type=$('new-asset-type')?.value||'crypto',cur=$('new-asset-currency')?.value||'IDR';
    const price=parseFloat($('new-asset-price')?.value),vol=$('new-asset-vol')?.value||'normal';
    const sector=$('new-asset-sector')?.value||'Other',desc=$('new-asset-desc')?.value?.trim()||'';
    const fee=parseFloat($('new-asset-fee')?.value)||500000;
    if(!sym||sym.length<2){toast('Simbol minimal 2 karakter','error');return;}
    if(!name){toast('Masukkan nama','error');return;}
    if(!price||price<=0){toast('Harga harus > 0','error');return;}
    if(allAssets().find(a=>a.symbol===sym)){toast(`Simbol ${sym} sudah ada`,'error');return;}
    const port=State.get(`portfolio.${sess.userId}`)||{};
    if((port.cash_idr||0)<fee){toast(`Biaya listing: ${fmtM(fee,'IDR')}`,'error');return;}
    State.merge(`portfolio.${sess.userId}`,{cash_idr:(port.cash_idr||0)-fee});
    const simNow=State.get('simTime')||new Date();
    const newA={symbol:sym,name,sector,basePrice:price,vol,liq:'medium',syariah:type==='syariah',currency:cur,custom:true,description:desc,phase:'prelisting',offerPrice:price,subscribed:0,phaseEnd:new Date(simNow.getTime()+2*24*3600000).toISOString()};
    State.set('customAssets',[...(State.get('customAssets')||[]),newA]);
    const assets=State.get('assets')||{}; State.set('assets',assets); assetsData=assets;
    const evt={id:'LIST'+Date.now(),symbol:sym,message:`${sym} (${name}) masuk antrean IPO. Fase prelisting dimulai sekarang.`,sentiment:0.03,category:'ipo',time:new Date().toISOString(),read:false};
    State.push('newsEvents',evt);State.emit('news.new',evt);State.saveToStorage();
    toast(`🚀 ${sym} berhasil dibuat untuk IPO! Fee: ${fmtM(fee,'IDR')} dipotong`,'success');
    ['new-asset-symbol','new-asset-name','new-asset-price','new-asset-desc'].forEach(id=>{const e=$(id);if(e)e.value='';});
    renderIPOPage();renderSidebar();renderMarketLists();
  });
  $('btn-create-crypto')?.addEventListener('click',createCryptoUI);
  $('market-activity-slider')?.addEventListener('input',e=>{
    const v=parseFloat(e.target.value)||1;
    setEl('market-activity-value',`${v.toFixed(2)}x`);
  });
  $('market-activity-target')?.addEventListener('change',()=>{
    const cfg=State.get('marketActivity')||{all:1,stocks:1,crypto:1,forex:1};
    const key=$('market-activity-target')?.value||'all';
    const v=parseFloat(cfg[key]??1);
    const s=$('market-activity-slider'); if(s) s.value=String(v);
    setEl('market-activity-value',`${v.toFixed(2)}x`);
  });
  $('btn-apply-market-activity')?.addEventListener('click',()=>{
    const key=$('market-activity-target')?.value||'all';
    const v=parseFloat($('market-activity-slider')?.value)||1;
    const cfg=State.get('marketActivity')||{all:1,stocks:1,crypto:1,forex:1};
    cfg[key]=Math.max(0.2,Math.min(3,v));
    State.set('marketActivity',cfg);
    toast(`Market activity ${key.toUpperCase()} diset ke ${cfg[key].toFixed(2)}x`,'success');
    State.saveToStorage();
  });
  $('btn-ihsg-halt')?.addEventListener('click',()=>State.get('ihsgHalted')?window.resumeIHSGUI():window.haltIHSGUI());
  $('btn-suspend-asset')?.addEventListener('click',()=>{const sym=$('suspend-sym-input')?.value?.toUpperCase().trim();if(sym)window.suspendAssetUI(sym);});
  $('btn-export-data')?.addEventListener('click',()=>{
    const sess=State.get('session');if(!sess)return;
    const blob=new Blob([State.exportUserData(sess.userId)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download=`tradesim_${sess.username}_${new Date().toISOString().substring(0,10)}.json`;
    a.click();URL.revokeObjectURL(url);toast('Data diekspor!','success');
  });
  $('import-file-input')?.addEventListener('change',e=>{
    const file=e.target.files?.[0];if(!file)return;
    const sess=State.get('session');if(!sess)return;
    const reader=new FileReader();
    reader.onload=ev=>{const ok=State.importUserData(sess.userId,ev.target.result);if(ok){toast('Data diimpor!','success');setTimeout(()=>{renderPortfolio();renderWallet();updateDesktopPort();refreshHome();},500);}else toast('File tidak valid','error');};
    reader.readAsText(file);e.target.value='';
  });
  $('btn-reset-data')?.addEventListener('click',()=>{
    openConfirmModal({
      title:'Reset Semua Data',
      message:'Semua data TradeSim (global & user) akan dihapus dan aplikasi di-reload.',
      confirmText:'Reset Sekarang',
      danger:true,
      onConfirm:()=>{
        Object.keys(localStorage).forEach(k=>{
          if(k==='tradesim_global'||k.startsWith('tradesim_user_')) localStorage.removeItem(k);
        });
        location.reload();
      },
    });
  });
}

// ─── Globals ──────────────────────────────────────────────────
window.cancelOrderUI=(id)=>{const s=State.get('session');if(s)cancelOrder(s.userId,id);};
window.quickSell=(sym,qty)=>{
  const s=State.get('session');if(!s)return;
  const p=State.get(`prices.${sym}`);
  const r=placeOrder({userId:s.userId,symbol:sym,side:'sell',type:'market',qty,price:p?.bid});
  r.ok?toast(`Quick Sell ${sym}`,'success'):toast(`❌ ${r.error}`,'error');
};
window.subscribeIPO=window.openIPOSubscribe;

// ─── Utils ────────────────────────────────────────────────────
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);State.set('theme',t);if(chart){chart.colors.bg=gv('--bg0');chart.colors.grid=gv('--border');chart.colors.text=gv('--t2');}}
function gv(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function $(id){return document.getElementById(id);}
function setEl(id,text){const e=$(id);if(e)e.textContent=text;}
function pad(n){return String(n).padStart(2,'0');}
function toast(msg,type='info'){
  const c=$('toast-container');if(!c)return;
  const t=document.createElement('div');t.className=`toast toast-${type}`;t.textContent=msg;
  c.appendChild(t);setTimeout(()=>t.classList.add('show'),10);
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},4000);
}
function openInputModal({title,message,placeholder='',defaultValue='',confirmText='Simpan',inputType='text',onConfirm}){
  const root=$('custom-modal-root'); if(!root) return;
  root.innerHTML=`<div class="cm-backdrop">
    <div class="cm-box">
      <div class="cm-title">${title||'Input'}</div>
      <div class="cm-msg">${message||''}</div>
      <input id="cm-input" class="cm-input" type="${inputType}" value="${defaultValue||''}" placeholder="${placeholder||''}">
      <div class="cm-actions">
        <button id="cm-cancel" class="cm-btn">Batal</button>
        <button id="cm-ok" class="cm-btn primary">${confirmText}</button>
      </div>
    </div>
  </div>`;
  root.classList.add('show');
  const close=()=>{ root.classList.remove('show'); root.innerHTML=''; };
  const input=$('cm-input');
  $('cm-cancel')?.addEventListener('click',close);
  $('cm-ok')?.addEventListener('click',()=>{
    const shouldClose=onConfirm?onConfirm(input?.value):true;
    if(shouldClose!==false) close();
  });
  input?.addEventListener('keydown',(e)=>{ if(e.key==='Enter') $('cm-ok')?.click(); });
  setTimeout(()=>input?.focus(),25);
}
function openConfirmModal({title,message,confirmText='Lanjutkan',danger=false,onConfirm}){
  const root=$('custom-modal-root'); if(!root) return;
  root.innerHTML=`<div class="cm-backdrop">
    <div class="cm-box">
      <div class="cm-title">${title||'Konfirmasi'}</div>
      <div class="cm-msg">${(message||'').replace(/\n/g,'<br>')}</div>
      <div class="cm-actions">
        <button id="cm-cancel" class="cm-btn">Batal</button>
        <button id="cm-ok" class="cm-btn ${danger?'danger':'primary'}">${confirmText}</button>
      </div>
    </div>
  </div>`;
  root.classList.add('show');
  const close=()=>{ root.classList.remove('show'); root.innerHTML=''; };
  $('cm-cancel')?.addEventListener('click',close);
  $('cm-ok')?.addEventListener('click',()=>{ onConfirm?.(); close(); });
}
function fmtP(price,currency){
  if(price===null||price===undefined||isNaN(price))return'-';
  if(!currency||currency==='IDR'){if(price>10000)return price.toLocaleString('id-ID');return price.toLocaleString('id-ID',{maximumFractionDigits:2});}
  if(price>10000)return '$'+price.toLocaleString('en-US',{maximumFractionDigits:0});
  if(price>1)return '$'+price.toFixed(4);if(price>0.01)return '$'+price.toFixed(6);return '$'+price.toFixed(8);
}
function fmtM(val,currency){
  if(!val||isNaN(val))val=0;
  if(currency==='IDR'||!currency){const abs=Math.abs(val),s=val<0?'-':'';if(abs>=1e9)return s+'Rp '+(abs/1e9).toFixed(2)+'M';if(abs>=1e6)return s+'Rp '+(abs/1e6).toFixed(2)+'jt';if(abs>=1e3)return s+'Rp '+(abs/1e3).toFixed(0)+'rb';return s+'Rp '+abs.toLocaleString('id-ID');}
  return(val<0?'-$':'$')+Math.abs(val).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

document.addEventListener('DOMContentLoaded',init);
