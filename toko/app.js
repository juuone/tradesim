const KEY='tokosim_v1';
const START_CASH=100000;
const RECIPES={
  burger:{roti:2,saos:1,sosis:1,cabe:1},
  shirt:{kain:2,benang:1},
  software:{license:1},
};

let state=load();
render();
setInterval(tick,3000);
setInterval(save,60000);

function load(){
  const raw=localStorage.getItem(KEY);
  if(raw) return JSON.parse(raw);
  return {
    cash:START_CASH,revenueMonth:0,expenseMonth:0,taxMonth:0,
    simTime:new Date().toISOString(),
    materialsPrice:{roti:3000,saos:2000,sosis:5000,cabe:2000,kain:12000,benang:4000,license:50000},
    branches:[mkBranch('Pusat','Jakarta')],
    ledger:[mkLedger('init','Modal awal',START_CASH)],
    lastTaxMonth:'',
  };
}
function mkBranch(name,city){
  return {id:'BR'+Date.now()+Math.random().toString(36).slice(2,5),name,city,promo:0,
    prices:{burger:22000,shirt:85000,software:150000},
    mats:{roti:30,saos:30,sosis:30,cabe:20,kain:10,benang:10,license:5},
    stock:{burger:0,shirt:0,software:0},
  };
}
function mkLedger(type,desc,amount){return{id:'L'+Date.now()+Math.random().toString(36).slice(2,4),t:new Date().toISOString(),type,desc,amount,cashAfter:0};}
function save(){localStorage.setItem(KEY,JSON.stringify(state));}

function tick(){
  const now=new Date(state.simTime); now.setMinutes(now.getMinutes()+30); state.simTime=now.toISOString();
  // material price fluctuation
  Object.keys(state.materialsPrice).forEach(k=>{
    const p=state.materialsPrice[k]; state.materialsPrice[k]=Math.max(500,Math.round(p*(1+(Math.random()-0.5)*0.08)));
  });
  // sales per branch
  state.branches.forEach(br=>{
    const promoBoost=1+(br.promo>0?0.7:0);
    br.promo=Math.max(0,br.promo-1);
    ['burger','shirt','software'].forEach(prod=>{
      const demandBase=prod==='burger'?4:prod==='shirt'?2:1;
      const spike=Math.random()<0.08?Math.floor(Math.random()*8):0;
      const sold=Math.min(br.stock[prod],Math.max(0,Math.floor((Math.random()*demandBase+spike)*promoBoost)));
      if(sold>0){
        const rev=sold*br.prices[prod];
        br.stock[prod]-=sold;
        state.cash+=rev; state.revenueMonth+=rev;
        addLedger('sale',`${br.name} jual ${prod} x${sold}`,rev);
      }
    });
  });
  applyTaxIfNeeded();
  save(); render();
}

function applyTaxIfNeeded(){
  const d=new Date(state.simTime); const mk=`${d.getFullYear()}-${d.getMonth()+1}`;
  if(state.lastTaxMonth===mk) return;
  if(state.revenueMonth>50000000){
    const tax=Math.round(state.revenueMonth*0.005); // 0.5%
    state.cash-=tax; state.taxMonth+=tax;
    addLedger('tax',`Pajak omzet >50jt`,-tax);
  }
  state.lastTaxMonth=mk;
  state.revenueMonth=0; state.expenseMonth=0; state.taxMonth=0;
}

function addLedger(type,desc,amount){
  const l=mkLedger(type,desc,amount); l.cashAfter=state.cash;
  state.ledger.unshift(l); if(state.ledger.length>300) state.ledger.pop();
}

function render(){
  $('#sim-time').textContent=new Date(state.simTime).toLocaleString('id-ID');
  $('#cash').textContent=fmt(state.cash); $('#revenue').textContent=fmt(state.revenueMonth);
  const profit=state.revenueMonth-state.expenseMonth-state.taxMonth; $('#profit').textContent=fmt(profit); $('#branches-count').textContent=state.branches.length;
  const sel=$('#branch-select'); sel.innerHTML=state.branches.map(b=>`<option value="${b.id}">${b.name} (${b.city})</option>`).join('');
  $('#branches').innerHTML=state.branches.map(b=>`<div class="branch"><b>${b.name}</b> <span class="sub">${b.city}</span><div class="sub">Harga: ${ico('burger')} ${fmt(b.prices.burger)} | ${ico('shirt')} ${fmt(b.prices.shirt)} | ${ico('software')} ${fmt(b.prices.software)}</div><div class="sub">Stok: burger ${b.stock.burger}, baju ${b.stock.shirt}, software ${b.stock.software}</div><div class="sub">Bahan: roti ${b.mats.roti}, saos ${b.mats.saos}, sosis ${b.mats.sosis}, cabe ${b.mats.cabe}, kain ${b.mats.kain}, benang ${b.mats.benang}, lisensi ${b.mats.license}</div></div>`).join('');
  $('#ledger').innerHTML=state.ledger.map(l=>`<div class="ledger-item"><span>${new Date(l.t).toLocaleTimeString('id-ID')} · ${l.desc}</span><span class="${l.amount>=0?'up':'down'}">${l.amount>=0?'+':''}${fmt(l.amount)}</span></div>`).join('');
}

$('#btn-add-branch').onclick=()=>{
  if(state.cash<2000000) return alert('Kas tidak cukup');
  const n=$('#branch-name').value.trim()||`Cabang ${state.branches.length+1}`;
  const c=$('#branch-city').value.trim()||'Kota';
  state.cash-=2000000; state.branches.push(mkBranch(n,c)); addLedger('branch',`Buka cabang ${n}`,-2000000); save(); render();
};

$('#btn-set-price').onclick=()=>{
  const br=getBranch(); if(!br) return;
  const prod=$('#product-select').value; const p=parseFloat($('#set-price').value)||0; if(p<=0) return;
  br.prices[prod]=Math.round(p); save(); render();
};

$('#btn-buy-material').onclick=()=>{
  const br=getBranch(); if(!br) return;
  const mat=$('#material-select').value; const q=parseInt($('#material-qty').value)||0; if(q<=0) return;
  const cost=(state.materialsPrice[mat]||0)*q; if(state.cash<cost) return alert('Kas kurang');
  state.cash-=cost; state.expenseMonth+=cost; br.mats[mat]=(br.mats[mat]||0)+q; addLedger('buy',`Beli ${mat} x${q}`,-cost); save(); render();
};

$('#btn-craft').onclick=()=>{
  const br=getBranch(); if(!br) return;
  const prod=$('#product-select').value; const recipe=RECIPES[prod];
  let max=9999; Object.entries(recipe).forEach(([m,n])=>{max=Math.min(max,Math.floor((br.mats[m]||0)/n));});
  if(max<=0) return alert('Bahan tidak cukup');
  const qty=Math.max(1,Math.min(max,10));
  Object.entries(recipe).forEach(([m,n])=>br.mats[m]-=n*qty);
  br.stock[prod]+=qty; addLedger('craft',`Produksi ${prod} x${qty}`,0); save(); render();
};

$('#btn-promo').onclick=()=>{
  const br=getBranch(); if(!br) return;
  const b=parseFloat($('#promo-budget').value)||0; if(b<=0||state.cash<b) return alert('Budget promo tidak valid');
  state.cash-=b; state.expenseMonth+=b; br.promo=Math.min(24,br.promo+Math.floor(b/100000));
  addLedger('promo',`Promosi ${br.name}`,-b); save(); render();
};

$('#btn-from-trade').onclick=()=>transferTradeSim(false);
$('#btn-to-trade').onclick=()=>transferTradeSim(true);

function transferTradeSim(toTrade){
  const amt=parseFloat($('#transfer-amount').value)||0; if(amt<=0) return;
  const sess=JSON.parse(localStorage.getItem('tradesim_global')||'{}');
  const keys=Object.keys(localStorage).filter(k=>k.startsWith('tradesim_user_'));
  if(!keys.length) return alert('Akun TradeSim tidak ditemukan');
  const k=keys[0],u=JSON.parse(localStorage.getItem(k));
  const uid=Object.keys(u.portfolio||{})[0]; if(!uid) return alert('Portfolio TradeSim kosong');
  const port=u.portfolio[uid];
  if(toTrade){ if(state.cash<amt) return alert('Kas toko kurang'); state.cash-=amt; port.cash_idr=(port.cash_idr||0)+amt; addLedger('transfer',`Kirim ke TradeSim`,-amt); }
  else { if((port.cash_idr||0)<amt) return alert('Saldo TradeSim kurang'); port.cash_idr-=amt; state.cash+=amt; addLedger('transfer',`Ambil dari TradeSim`,amt); }
  u.portfolio[uid]=port; localStorage.setItem(k,JSON.stringify(u)); save(); render();
}

function getBranch(){const id=$('#branch-select').value; return state.branches.find(b=>b.id===id)||state.branches[0];}

function ico(type){
  if(type==='burger') return '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="vertical-align:-2px"><path d="M3 8a7 7 0 0 1 14 0H3Zm0 2h14v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1Zm1 5h12a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2Z"/></svg>';
  if(type==='shirt') return '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="vertical-align:-2px"><path d="m7 3 1.5 2h3L13 3l4 2-2 4-2-1v9H7V8L5 9 3 5l4-2Z"/></svg>';
  return '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" style="vertical-align:-2px"><path d="M4 4h12v9H4V4Zm-1 11h14v2H3v-2Zm3-9v5l4-2.5L6 6Z"/></svg>';
}

function fmt(v){return 'Rp '+Math.round(v).toLocaleString('id-ID');}
function $(s){return document.querySelector(s);}
