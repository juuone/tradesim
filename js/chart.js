// ============================================================
// CHART.JS — Professional Candlestick Chart Renderer
// Canvas-based for performance; handles: candles, indicators,
// drawings, crosshair, pan/zoom, OHLCV tooltip
// ============================================================

import State from './state.js';

class TradingChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.symbol = null;
    this.tf = '5m';
    this.dpr = window.devicePixelRatio || 1;

    // View state
    this.offsetX = 0;   // candle offset from right
    this.scale = 10;    // pixels per candle width (CSS pixels)
    this.priceMin = 0;
    this.priceMax = 0;
    this.candles = [];

    // Interaction state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartOffset = 0;
    this.mouseX = -1;
    this.mouseY = -1;
    this.isDrawing = false;
    this.drawStart = null;
    this.drawings = [];

    // Colors (CSS variables)
    this.colors = {
      bg:        getComputedStyle(document.documentElement).getPropertyValue('--bg0').trim() || '#0b0f1a',
      grid:      getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#2a3550',
      bullCandle:'#26a69a',
      bearCandle:'#ef5350',
      wickBull:  '#26a69a',
      wickBear:  '#ef5350',
      text:      getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() || '#8fa3c0',
      crosshair: '#58a6ff',
      ma20:      '#f0b429',
      ma50:      '#9b59b6',
      ema12:     '#1abc9c',
      ema26:     '#e74c3c',
      macd:      '#3498db',
      macdSignal:'#e67e22',
      rsi:       '#2ecc71',
      volume:    'rgba(88, 166, 255, 0.3)',
      panelBg:   getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim() || '#111827',
    };

    // Indicators state
    this.indicators = { ma20: true, ma50: false, ema12: false, ema26: false, rsi: false, macd: false, volume: true };

    this._bindEvents();
    this._startRenderLoop();
  }

  // CSS-pixel dimensions (independent of DPR)
  get cssW() { return parseInt(this.canvas.style.width) || this.cssW; }
  get cssH() { return parseInt(this.canvas.style.height) || this.cssH; }

  // ─── Load Data ────────────────────────────────────────────
  load(symbol, tf) {
    this.symbol = symbol;
    this.tf = tf;
    const candleData = State.get(`candles.${symbol}`);
    this.candles = (candleData?.[tf] || []).slice();
    this.drawings = State.get(`drawings.${symbol}`) || [];
    this._fitView();
    this._render();
  }

  // ─── Live Update ──────────────────────────────────────────
  update() {
    if (!this.symbol) return;
    const candleData = State.get(`candles.${this.symbol}`);
    this.candles = (candleData?.[this.tf] || []).slice();
    this._render();
  }

  // ─── Fit View ─────────────────────────────────────────────
  _fitView() {
    const visible = Math.floor(this.cssW / this.scale);
    this.offsetX = 0;
    const visCandles = this.candles.slice(-visible);
    if (visCandles.length) {
      this.priceMin = Math.min(...visCandles.map(c => c.l)) * 0.998;
      this.priceMax = Math.max(...visCandles.map(c => c.h)) * 1.002;
    }
  }

  // ─── Coordinate Transforms ────────────────────────────────
  _priceToY(price) {
    const h = this.cssH * 0.75; // Reserve 25% for volume/indicators
    return h - ((price - this.priceMin) / (this.priceMax - this.priceMin)) * h;
  }

  _yToPrice(y) {
    const h = this.cssH * 0.75;
    return this.priceMin + (1 - y / h) * (this.priceMax - this.priceMin);
  }

  _candleToX(idx) {
    const total = this.candles.length;
    const visibleStart = total - Math.floor(this.cssW / this.scale) - this.offsetX;
    return (idx - visibleStart) * this.scale + this.scale / 2;
  }

  _xToIndex(x) {
    const total = this.candles.length;
    const visibleStart = total - Math.floor(this.cssW / this.scale) - this.offsetX;
    return Math.floor(x / this.scale) + visibleStart;
  }

  // ─── Main Render ──────────────────────────────────────────
  _render() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const W = this.cssW;
    const H = this.cssH;
    const chartH = H * 0.72;
    const volumeH = H * 0.12;
    const indicatorH = H * 0.16;

    // Clear
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, W, H);

    if (!this.candles.length) {
      ctx.fillStyle = this.colors.text;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Memuat data...', W / 2, H / 2);
      return;
    }

    const visible = Math.floor((W - 60) / this.scale);
    const startIdx = Math.max(0, this.candles.length - visible - this.offsetX);
    const endIdx   = Math.min(this.candles.length, startIdx + visible);
    const visCandles = this.candles.slice(startIdx, endIdx);

    // Dynamic price range from visible candles
    if (visCandles.length) {
      const lo = Math.min(...visCandles.map(c => c.l));
      const hi = Math.max(...visCandles.map(c => c.h));
      const pad = (hi - lo) * 0.05;
      this.priceMin = lo - pad;
      this.priceMax = hi + pad;
    }

    // Grid
    this._drawGrid(ctx, W, chartH);

    // Candles
    for (let i = 0; i < visCandles.length; i++) {
      this._drawCandle(ctx, visCandles[i], i + (startIdx - startIdx), i, chartH);
    }

    // Indicators overlay
    if (this.indicators.ma20) this._drawMA(ctx, visCandles, 20, this.colors.ma20, chartH);
    if (this.indicators.ma50) this._drawMA(ctx, visCandles, 50, this.colors.ma50, chartH);
    if (this.indicators.ema12) this._drawEMA(ctx, visCandles, 12, this.colors.ema12, chartH);
    if (this.indicators.ema26) this._drawEMA(ctx, visCandles, ema26=26, this.colors.ema26, chartH);

    // Volume bars
    if (this.indicators.volume) this._drawVolume(ctx, visCandles, W, chartH, volumeH);

    // RSI / MACD panel
    if (this.indicators.rsi) this._drawRSI(ctx, visCandles, W, chartH + volumeH, indicatorH);
    if (this.indicators.macd) this._drawMACD(ctx, visCandles, W, chartH + volumeH, indicatorH);

    // Drawings (trendlines, etc.)
    this._renderDrawings(ctx, startIdx, chartH);

    // Crosshair + tooltip
    if (this.mouseX > 0 && this.mouseX < W - 60) {
      this._drawCrosshair(ctx, W, H, chartH, startIdx, visCandles);
    }

    // Price axis (right)
    this._drawPriceAxis(ctx, W, chartH);

    // Time axis (bottom)
    this._drawTimeAxis(ctx, W, chartH, visCandles);
  }

  _drawGrid(ctx, W, chartH) {
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 0.5;
    const lines = 6;
    for (let i = 0; i <= lines; i++) {
      const y = (chartH / lines) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W - 60, y);
      ctx.stroke();
    }
  }

  _drawCandle(ctx, candle, absIdx, visIdx, chartH) {
    const x = visIdx * this.scale + this.scale / 2;
    const bull = candle.c >= candle.o;
    ctx.strokeStyle = bull ? this.colors.wickBull : this.colors.wickBear;
    ctx.fillStyle = bull ? this.colors.bullCandle : this.colors.bearCandle;
    ctx.lineWidth = 1;

    const openY  = this._priceToY(candle.o, chartH);
    const closeY = this._priceToY(candle.c, chartH);
    const highY  = this._priceToY(candle.h, chartH);
    const lowY   = this._priceToY(candle.l, chartH);

    // Wick
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(closeY - openY));
    ctx.fillRect(x - this.scale * 0.35, bodyTop, this.scale * 0.7, bodyH);
  }

  _priceToY(price, chartH) {
    if (!chartH) chartH = this.cssH * 0.72;
    return chartH - ((price - this.priceMin) / (this.priceMax - this.priceMin + 0.000001)) * chartH;
  }

  _drawMA(ctx, candles, period, color, chartH) {
    if (candles.length < period) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = period - 1; i < candles.length; i++) {
      const sum = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.c, 0);
      const avg = sum / period;
      const x = i * this.scale + this.scale / 2;
      const y = this._priceToY(avg, chartH);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawEMA(ctx, candles, period, color, chartH) {
    if (candles.length < period) return;
    const k = 2 / (period + 1);
    let ema = candles.slice(0, period).reduce((s, c) => s + c.c, 0) / period;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo((period - 1) * this.scale + this.scale / 2, this._priceToY(ema, chartH));
    for (let i = period; i < candles.length; i++) {
      ema = candles[i].c * k + ema * (1 - k);
      ctx.lineTo(i * this.scale + this.scale / 2, this._priceToY(ema, chartH));
    }
    ctx.stroke();
  }

  _drawVolume(ctx, candles, W, chartH, volH) {
    const maxVol = Math.max(...candles.map(c => c.v));
    candles.forEach((c, i) => {
      const x = i * this.scale + this.scale / 2;
      const barH = (c.v / maxVol) * volH;
      ctx.fillStyle = c.c >= c.o ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)';
      ctx.fillRect(x - this.scale * 0.35, chartH + (volH - barH), this.scale * 0.7, barH);
    });
  }

  _drawRSI(ctx, candles, W, panelY, panelH) {
    if (candles.length < 15) return;
    const rsi = calcRSI(candles.map(c => c.c), 14);

    // Panel background
    ctx.fillStyle = this.colors.panelBg;
    ctx.fillRect(0, panelY, W - 60, panelH);

    // Labels
    ctx.fillStyle = this.colors.text;
    ctx.font = '10px monospace';
    ctx.fillText('RSI(14)', 4, panelY + 12);
    [30, 50, 70].forEach(level => {
      ctx.strokeStyle = level === 50 ? this.colors.grid : (level === 30 ? '#26a69a44' : '#ef535044');
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const y = panelY + panelH - (level / 100) * panelH;
      ctx.moveTo(0, y); ctx.lineTo(W - 60, y); ctx.stroke();
    });

    ctx.strokeStyle = this.colors.rsi;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    rsi.forEach((val, i) => {
      if (val === null) return;
      const x = i * this.scale + this.scale / 2;
      const y = panelY + panelH - (val / 100) * panelH;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  _drawMACD(ctx, candles, W, panelY, panelH) {
    if (candles.length < 30) return;
    const closes = candles.map(c => c.c);
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macd = ema12.map((v, i) => v !== null && ema26[i] !== null ? v - ema26[i] : null);
    const signal = calcEMA(macd.filter(v => v !== null), 9);

    ctx.fillStyle = this.colors.panelBg;
    ctx.fillRect(0, panelY, W - 60, panelH);
    ctx.fillStyle = this.colors.text;
    ctx.font = '10px monospace';
    ctx.fillText('MACD(12,26,9)', 4, panelY + 12);

    const validMacd = macd.filter(v => v !== null);
    const macdMax = Math.max(...validMacd.map(Math.abs)) || 1;

    macd.forEach((val, i) => {
      if (val === null) return;
      const x = i * this.scale + this.scale / 2;
      const barH = Math.abs(val / macdMax) * (panelH * 0.4);
      const midY = panelY + panelH / 2;
      ctx.fillStyle = val >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)';
      ctx.fillRect(x - this.scale * 0.35, val >= 0 ? midY - barH : midY, this.scale * 0.7, barH);
    });
  }

  _drawCrosshair(ctx, W, H, chartH, startIdx, visCandles) {
    const x = this.mouseX;
    const y = this.mouseY;
    ctx.strokeStyle = this.colors.crosshair;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);

    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - 60, y); ctx.stroke();
    ctx.setLineDash([]);

    // Price label on right axis
    const price = this._yToPrice(y);
    ctx.fillStyle = this.colors.crosshair;
    ctx.fillRect(W - 60, y - 10, 60, 20);
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(price), W - 57, y + 4);

    // Candle tooltip
    const idx = Math.floor(x / this.scale);
    if (idx >= 0 && idx < visCandles.length) {
      const c = visCandles[idx];
      this._drawOHLCTooltip(ctx, c);
    }
  }

  _drawOHLCTooltip(ctx, candle) {
    const lines = [
      `O: ${fmtPrice(candle.o)}`,
      `H: ${fmtPrice(candle.h)}`,
      `L: ${fmtPrice(candle.l)}`,
      `C: ${fmtPrice(candle.c)}`,
      `V: ${candle.v.toLocaleString()}`,
    ];
    const W = 110, H = 88;
    const tx = 8, ty = 8;
    ctx.fillStyle = 'rgba(22,27,34,0.9)';
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tx, ty, W, H, 4);
    ctx.fill(); ctx.stroke();

    ctx.font = '11px monospace';
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#cdd9e5' : (i === 1 ? '#26a69a' : (i === 2 ? '#ef5350' : (i === 3 ? (candle.c >= candle.o ? '#26a69a' : '#ef5350') : '#8b949e')));
      ctx.textAlign = 'left';
      ctx.fillText(line, tx + 8, ty + 16 + i * 15);
    });
  }

  _drawPriceAxis(ctx, W, chartH) {
    const lines = 6;
    ctx.fillStyle = this.colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= lines; i++) {
      const price = this.priceMin + (this.priceMax - this.priceMin) * (1 - i / lines);
      const y = (chartH / lines) * i;
      ctx.fillText(fmtPrice(price), W - 57, y + 4);
    }
  }

  _drawTimeAxis(ctx, W, chartH, visCandles) {
    const tfMs = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 };
    const interval = Math.floor(visCandles.length / 6);
    ctx.fillStyle = this.colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    visCandles.forEach((c, i) => {
      if (i % interval !== 0) return;
      const x = i * this.scale + this.scale / 2;
      const d = new Date(c.t);
      const label = this.tf === '1d' ? `${d.getDate()}/${d.getMonth()+1}` :
                    this.tf === '4h' || this.tf === '1h' ? `${d.getHours()}:00` :
                    `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      ctx.fillText(label, x, chartH + 14);
    });
  }

  _renderDrawings(ctx, startIdx, chartH) {
    this.drawings.forEach(d => {
      if (d.type === 'trendline' || d.type === 'horizontal') {
        ctx.strokeStyle = d.color || '#58a6ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(d.dashed ? [6,3] : []);
        ctx.beginPath();
        const x1 = (d.x1 - startIdx) * this.scale + this.scale / 2;
        const x2 = (d.x2 - startIdx) * this.scale + this.scale / 2;
        ctx.moveTo(x1, this._priceToY(d.y1, chartH));
        ctx.lineTo(x2, this._priceToY(d.y2, chartH));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (d.type === 'rect') {
        ctx.strokeStyle = d.color || '#f0b429';
        ctx.fillStyle = (d.color || '#f0b429') + '22';
        ctx.lineWidth = 1;
        const x1 = (d.x1 - startIdx) * this.scale;
        const x2 = (d.x2 - startIdx) * this.scale;
        const y1 = this._priceToY(d.y1, chartH);
        const y2 = this._priceToY(d.y2, chartH);
        ctx.fillRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
        ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
      }
    });
  }

  // ─── Event Binding ────────────────────────────────────────
  _bindEvents() {
    this.canvas.addEventListener('mousemove', e => {
      const r = this.canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (this.cssW / r.width);
      this.mouseY = (e.clientY - r.top) * (this.cssH / r.height);
      if (this.isDragging) {
        this.offsetX = this.dragStartOffset + Math.floor((this.dragStartX - this.mouseX) / this.scale);
        this.offsetX = Math.max(0, Math.min(this.candles.length - 10, this.offsetX));
      }
    });

    this.canvas.addEventListener('mousedown', e => {
      const r = this.canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (this.cssW / r.width);
      this.isDragging = true;
      this.dragStartX = this.mouseX;
      this.dragStartOffset = this.offsetX;
    });

    this.canvas.addEventListener('mouseup', () => { this.isDragging = false; });
    this.canvas.addEventListener('mouseleave', () => { this.isDragging = false; this.mouseX = -1; });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      this.scale = Math.max(4, Math.min(30, this.scale + delta));
    }, { passive: false });
  }

  // ─── Render Loop ──────────────────────────────────────────
  _startRenderLoop() {
    const loop = () => {
      this._render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  toggleIndicator(name) {
    this.indicators[name] = !this.indicators[name];
  }

  zoomIn(step = 2) {
    this.scale = Math.max(4, Math.min(40, this.scale + step));
  }

  zoomOut(step = 2) {
    this.scale = Math.max(4, Math.min(40, this.scale - step));
  }

  resetZoom() {
    this.scale = 10;
    this.offsetX = 0;
  }

  addDrawing(drawing) {
    this.drawings.push(drawing);
    State.set(`drawings.${this.symbol}`, this.drawings);
  }

  clearDrawings() {
    this.drawings = [];
    State.set(`drawings.${this.symbol}`, []);
  }
}

// ─── Indicator Math ───────────────────────────────────────────
function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses -= d;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const d = closes[i] - closes[i-1];
      avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i] = 100 - 100 / (1 + rs);
  }
  return result;
}

function calcEMA(values, period) {
  const result = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    if (count < period) {
      sum += values[i]; count++;
      if (count === period) result[i] = sum / period;
    } else {
      result[i] = values[i] * k + result[i-1] * (1 - k);
    }
  }
  return result;
}

function fmtPrice(price) {
  if (price === null || isNaN(price)) return '-';
  if (price > 10000) return price.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  if (price > 100) return price.toFixed(2);
  if (price > 1) return price.toFixed(4);
  return price.toFixed(8);
}

export { TradingChart, calcRSI, calcEMA, fmtPrice };
