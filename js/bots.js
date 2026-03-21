// ============================================================
// BOTS.JS — Market Bot Engine
// Bots: MarketMaker, Momentum, MeanReversion, Whale, Panic
// Each bot has personality parameters and reacts to market state
// ============================================================

import State from './state.js';
import { placeOrder, round } from './engine.js';

const BOT_USER_ID = 'BOT_SYSTEM';

// ─── Bot Configurations ────────────────────────────────────────
const BOTS = [
  {
    id: 'mm1', type: 'market_maker', name: 'MM Alpha',
    riskAppetite: 0.3, reactionSpeed: 0.9,
    positionLimit: 100000, sessionWindow: [9, 16],
    symbols: ['BBCA','TLKM','ASII','BMRI','BTC','ETH'],
  },
  {
    id: 'mom1', type: 'momentum', name: 'MomBot',
    riskAppetite: 0.7, reactionSpeed: 0.6,
    positionLimit: 50000, sessionWindow: [0, 24],
    symbols: ['BTC','ETH','SOL','AVAX','ARB','PEPE'],
  },
  {
    id: 'mr1', type: 'mean_reversion', name: 'RevBot',
    riskAppetite: 0.5, reactionSpeed: 0.4,
    positionLimit: 30000, sessionWindow: [9, 16],
    symbols: ['BBCA','UNVR','KLBF','HMSP'],
  },
  {
    id: 'whale1', type: 'whale', name: 'Whale Prime',
    riskAppetite: 0.9, reactionSpeed: 0.2,
    positionLimit: 500000, sessionWindow: [0, 24],
    symbols: ['BTC','ETH','BBCA','BMRI'],
  },
  {
    id: 'panic1', type: 'panic', name: 'Crowd Bot',
    riskAppetite: 1.0, reactionSpeed: 1.0,
    positionLimit: 10000, sessionWindow: [0, 24],
    symbols: ['BTC','ETH','SOL','DOGE','PEPE','AVAX','BNB'],
  },
];

// Bot state: positions, last prices, signals
const _botState = {};
BOTS.forEach(b => { _botState[b.id] = { holdings: {}, lastPrice: {}, tickCount: 0 }; });

// ─── Main Bot Tick ────────────────────────────────────────────
function runBots() {
  const simTime = State.get('simTime');
  const hour = simTime.getHours();

  BOTS.forEach(bot => {
    // Random activity: not every tick
    if (Math.random() > bot.reactionSpeed * 0.3) return;

    // Session check
    if (hour < bot.sessionWindow[0] || hour >= bot.sessionWindow[1]) return;

    const symbol = bot.symbols[Math.floor(Math.random() * bot.symbols.length)];
    const priceState = State.get(`prices.${symbol}`);
    if (!priceState) return;

    const bs = _botState[bot.id];
    bs.tickCount++;

    switch (bot.type) {
      case 'market_maker': runMarketMaker(bot, symbol, priceState); break;
      case 'momentum':     runMomentum(bot, symbol, priceState); break;
      case 'mean_reversion': runMeanReversion(bot, symbol, priceState); break;
      case 'whale':        runWhale(bot, symbol, priceState); break;
      case 'panic':        runPanic(bot, symbol, priceState); break;
    }
  });
}

// ─── Market Maker Bot ─────────────────────────────────────────
// Posts tight bid/ask quotes, profits from spread
function runMarketMaker(bot, symbol, priceState) {
  const { last, liq } = priceState;
  const spreadPct = liq === 'thick' ? 0.002 : 0.005;
  const bidPrice = round(last * (1 - spreadPct), last > 1000 ? 0 : 4);
  const askPrice = round(last * (1 + spreadPct), last > 1000 ? 0 : 4);
  const qty = Math.floor(500 + Math.random() * 1000);

  // Inject liquidity into order book
  const ob = State.get(`orderBooks.${symbol}`);
  if (!ob) return;

  // Add bot's quote to top of book
  const newBids = [{ price: bidPrice, qty }, ...ob.bids.slice(0, 9)].sort((a,b) => b.price - a.price);
  const newAsks = [{ price: askPrice, qty }, ...ob.asks.slice(0, 9)].sort((a,b) => a.price - b.price);
  State.set(`orderBooks.${symbol}`, { bids: newBids, asks: newAsks });
}

// ─── Momentum Bot ─────────────────────────────────────────────
// Chases price trends, adds to winning positions
function runMomentum(bot, symbol, priceState) {
  const { last, changePct } = priceState;
  const bs = _botState[bot.id];
  const prevPrice = bs.lastPrice[symbol] || last;
  const shortChange = (last - prevPrice) / prevPrice;

  bs.lastPrice[symbol] = last;

  if (Math.abs(changePct) < 0.5) return; // No signal

  const side = changePct > 0 ? 'buy' : 'sell';
  const qty = Math.floor((50 + Math.random() * 200) * bot.riskAppetite);

  injectBotTrade(symbol, side, qty, last, priceState.currency);
}

// ─── Mean Reversion Bot ───────────────────────────────────────
// Fades extreme moves, bets on return to mean
function runMeanReversion(bot, symbol, priceState) {
  const { last, changePct } = priceState;

  if (Math.abs(changePct) < 1.5) return; // Need significant deviation

  // Fade the move
  const side = changePct > 0 ? 'sell' : 'buy';
  const qty = Math.floor((100 + Math.random() * 300) * bot.riskAppetite);

  injectBotTrade(symbol, side, qty, last, priceState.currency);
}

// ─── Whale Bot ────────────────────────────────────────────────
// Places large iceberg-like orders, moves market
function runWhale(bot, symbol, priceState) {
  const bs = _botState[bot.id];
  if (bs.tickCount % 20 !== 0) return; // Only every 20 ticks

  const { last } = priceState;
  const side = Math.random() > 0.5 ? 'buy' : 'sell';
  const whaleQty = Math.floor(2000 + Math.random() * 8000);

  // Split into iceberg chunks
  const chunkCount = Math.floor(3 + Math.random() * 5);
  const chunkQty = Math.floor(whaleQty / chunkCount);

  for (let i = 0; i < chunkCount; i++) {
    setTimeout(() => {
      injectBotTrade(symbol, side, chunkQty, last, priceState.currency);
    }, i * 500);
  }
}

// ─── Panic/Crowd Bot ──────────────────────────────────────────
// Amplifies volatility spikes with herd behavior
function runPanic(bot, symbol, priceState) {
  const { last, changePct, vol } = priceState;
  if (vol !== 'extreme' && Math.abs(changePct) < 3) return;

  // Follow the crowd
  const side = changePct > 0 ? 'buy' : 'sell';
  const qty = Math.floor((200 + Math.random() * 800) * bot.riskAppetite);

  // Panic creates rapid trades
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      injectBotTrade(symbol, side, Math.floor(qty / 3), last, priceState.currency);
    }, i * 200);
  }
}

// ─── Direct Market Injection ─────────────────────────────────
// Bots directly affect price by consuming order book
function injectBotTrade(symbol, side, qty, currentPrice, currency) {
  const ob = State.get(`orderBooks.${symbol}`);
  if (!ob) return;

  const book = side === 'buy' ? ob.asks : ob.bids;
  if (!book.length) return;

  // Consume from book
  let remaining = qty;
  let totalCost = 0;
  const newBook = book.map(level => {
    if (remaining <= 0) return level;
    const fill = Math.min(remaining, level.qty);
    remaining -= fill;
    totalCost += fill * level.price;
    return { ...level, qty: level.qty - fill };
  }).filter(l => l.qty > 0);

  const filled = qty - remaining;
  if (filled === 0) return;

  const avgPrice = totalCost / filled;
  const decimals = currentPrice > 1000 ? 0 : currentPrice > 1 ? 4 : 8;

  if (side === 'buy') {
    State.set(`orderBooks.${symbol}`, { bids: ob.bids, asks: newBook });
  } else {
    State.set(`orderBooks.${symbol}`, { bids: newBook, asks: ob.asks });
  }

  // Add trade tape entry
  const tape = State.get(`tradeTapes.${symbol}`) || [];
  tape.unshift({ price: round(avgPrice, decimals), qty: filled, side, time: State.get('simTime').toISOString(), bot: true });
  State.set(`tradeTapes.${symbol}`, tape.slice(0, 50));
  State.emit(`tradeTape.${symbol}`, tape);
}

// ─── News Event Generator ────────────────────────────────────
const NEWS_TEMPLATES = [
  { msg: '{sym} membukukan laba Q1 melampaui ekspektasi analis', sentiment: 0.03 },
  { msg: '{sym} mengumumkan buyback saham senilai Rp 2T', sentiment: 0.025 },
  { msg: 'Analis upgrade {sym} dengan target harga lebih tinggi', sentiment: 0.015 },
  { msg: '{sym} melaporkan penurunan pendapatan 8% YoY', sentiment: -0.025 },
  { msg: 'Regulator selidiki praktik bisnis {sym}', sentiment: -0.04 },
  { msg: 'Inflasi AS memukul sentimen pasar, {sym} ikut tertekan', sentiment: -0.02 },
  { msg: 'Fed pertahankan suku bunga, {sym} menguat', sentiment: 0.018 },
  { msg: '{sym} ekspansi ke pasar baru, target revenue meningkat 20%', sentiment: 0.022 },
  { msg: 'Whale besar terakumulasi {sym} berdasarkan data on-chain', sentiment: 0.035 },
  { msg: 'CEO {sym} mundur mendadak', sentiment: -0.05 },
];

function generateNewsEvent() {
  const assets = State.get('assets');
  const all = [...assets.stocks, ...assets.syariah, ...assets.crypto];
  if (!all.length) return;

  const asset = all[Math.floor(Math.random() * all.length)];
  const template = NEWS_TEMPLATES[Math.floor(Math.random() * NEWS_TEMPLATES.length)];
  const msg = template.msg.replace('{sym}', asset.symbol);

  const event = {
    id: 'EVT' + Date.now(),
    symbol: asset.symbol,
    message: msg,
    sentiment: template.sentiment,
    time: State.get('simTime').toISOString(),
    read: false,
  };

  State.push('newsEvents', event);

  // Apply sentiment to price
  const priceState = State.get(`prices.${asset.symbol}`);
  if (priceState) {
    const newLast = priceState.last * (1 + template.sentiment);
    State.set(`prices.${asset.symbol}`, { ...priceState, last: round(newLast, priceState.last > 1000 ? 0 : 4) });
  }

  State.emit('news.new', event);
  return event;
}

// Auto-generate news every ~30 ticks
let _newsCounter = 0;
State.on('tick', () => {
  _newsCounter++;
  if (_newsCounter % 30 === 0) {
    generateNewsEvent();
    _newsCounter = 0;
  }
  runBots();
});

export { runBots, generateNewsEvent, BOTS };
