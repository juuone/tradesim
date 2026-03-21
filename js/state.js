// state.js v3 — per-user isolated storage
const State = (() => {
  let _state = {
    session: null,
    users: [],
    assets: { stocks:[], syariah:[], crypto:[], ipo:[], newCrypto:[], forex:[] },
    prices: {},
    orderBooks: {},
    tradeTapes: {},
    candles: {},
    // per-user data (keyed by userId)
    portfolio: {},
    orders: {},
    transactions: {},
    deposits: {},
    dividends: {},
    // shared state
    ipoSubscriptions: {}, // userId => {symbol: qty}
    activeAsset: 'BBCA',
    activeTimeframe: '5m',
    watchlist: ['BBCA','TLKM','BTC','ETH','ASII'],
    theme: 'dark',
    simTime: new Date('2025-04-07T09:00:00'),
    simSpeed: 1,
    simRunning: true,
    drawings: {},
    newsEvents: [],
    customAssets: [],
    listedAssets: [], // assets that moved from IPO → trading
    marketActivity: { all:1, stocks:1, crypto:1, forex:1 },
  };

  const _listeners = {};
  let _emitting = false;
  const _pending = [];

  function get(path) {
    if (!path) return _state;
    return path.split('.').reduce((o, k) => o?.[k], _state);
  }

  function set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => { if (!o[k]) o[k]={}; return o[k]; }, _state);
    target[last] = value;
    _scheduleEmit(path, value);
  }

  function merge(path, obj) { set(path, { ...get(path)||{}, ...obj }); }
  function push(path, item) { set(path, [...(get(path)||[]), item]); }

  function on(ev, fn) { if (!_listeners[ev]) _listeners[ev]=[]; _listeners[ev].push(fn); }
  function off(ev, fn) { if (_listeners[ev]) _listeners[ev]=_listeners[ev].filter(f=>f!==fn); }
  function emit(ev, data) { _scheduleEmit(ev, data); }

  function _scheduleEmit(ev, data) {
    if (_emitting) { _pending.push({ev,data}); return; }
    _flush(ev, data);
  }

  function _flush(ev, data) {
    _emitting = true;
    try {
      _doEmit(ev, data);
      while (_pending.length) { const n=_pending.shift(); _doEmit(n.ev,n.data); }
    } finally { _emitting = false; }
  }

  function _doEmit(ev, data) {
    const parts = ev.split('.');
    for (let i=parts.length; i>=1; i--) {
      const key = parts.slice(0,i).join('.');
      (_listeners[key]||[]).slice().forEach(fn=>{ try{fn(data,ev);}catch(e){console.error(e);} });
    }
    (_listeners['*']||[]).slice().forEach(fn=>{ try{fn(data,ev);}catch(e){console.error(e);} });
  }

  // ── Per-user storage key ──────────────────────────────────
  function _userKey(userId) { return `tradesim_user_${userId}`; }
  const GLOBAL_KEY = 'tradesim_global';

  // Save: split global state and per-user state
  function saveToStorage() {
    try {
      // Global (shared across users)
      const global = {
        theme: _state.theme,
        simTime: _state.simTime,
        newsEvents: (_state.newsEvents||[]).slice(-80),
        customAssets: _state.customAssets,
        listedAssets: _state.listedAssets,
        assets: _state.assets,
        marketActivity: _state.marketActivity,
      };
      localStorage.setItem(GLOBAL_KEY, JSON.stringify(global));

      // Per-user (isolated)
      const uid = _state.session?.userId;
      if (uid) {
        const userState = {
          session: _state.session,
          portfolio: { [uid]: _state.portfolio[uid] },
          orders:      { [uid]: _state.orders[uid] },
          transactions:{ [uid]: _state.transactions[uid] },
          deposits:    { [uid]: _state.deposits[uid] },
          dividends:   { [uid]: _state.dividends[uid] },
          watchlist: _state.watchlist,
          ipoSubscriptions: { [uid]: (_state.ipoSubscriptions||{})[uid] },
        };
        localStorage.setItem(_userKey(uid), JSON.stringify(userState));
      }
    } catch(e) { console.warn('Save failed', e); }
  }

  // Load global state (prices/sim shared)
  function loadGlobal() {
    try {
      const raw = localStorage.getItem(GLOBAL_KEY);
      if (!raw) return false;
      const g = JSON.parse(raw);
      if (g.theme)        _state.theme = g.theme;
      if (g.simTime)      _state.simTime = new Date(g.simTime);
      if (g.newsEvents)   _state.newsEvents = g.newsEvents;
      if (g.customAssets) _state.customAssets = g.customAssets;
      if (g.listedAssets) _state.listedAssets = g.listedAssets;
      if (g.assets)       _state.assets = g.assets;
      if (g.marketActivity) _state.marketActivity = g.marketActivity;
      return true;
    } catch(e) { return false; }
  }

  // Load per-user state (called after login)
  function loadUserData(userId) {
    try {
      const raw = localStorage.getItem(_userKey(userId));
      if (!raw) return false;
      const u = JSON.parse(raw);
      if (u.portfolio?.[userId])     _state.portfolio[userId]     = u.portfolio[userId];
      if (u.orders?.[userId])        _state.orders[userId]        = u.orders[userId];
      if (u.transactions?.[userId])  _state.transactions[userId]  = u.transactions[userId];
      if (u.deposits?.[userId])      _state.deposits[userId]      = u.deposits[userId];
      if (u.dividends?.[userId])     _state.dividends[userId]     = u.dividends[userId];
      if (u.watchlist)               _state.watchlist             = u.watchlist;
      if (u.ipoSubscriptions?.[userId]) {
        if (!_state.ipoSubscriptions) _state.ipoSubscriptions = {};
        _state.ipoSubscriptions[userId] = u.ipoSubscriptions[userId];
      }
      return true;
    } catch(e) { return false; }
  }

  // Export user data as JSON string
  function exportUserData(userId) {
    const data = {
      exportedAt: new Date().toISOString(),
      userId,
      portfolio:    _state.portfolio[userId],
      orders:       (_state.orders[userId]||[]).slice(0,100),
      transactions: (_state.transactions[userId]||[]).slice(0,200),
      deposits:     (_state.deposits[userId]||[]).slice(0,100),
      dividends:    (_state.dividends[userId]||[]).slice(0,100),
      watchlist:    _state.watchlist,
    };
    return JSON.stringify(data, null, 2);
  }

  // Import user data from JSON string
  function importUserData(userId, jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.portfolio)    _state.portfolio[userId]    = data.portfolio;
      if (data.orders)       _state.orders[userId]       = data.orders;
      if (data.transactions) _state.transactions[userId] = data.transactions;
      if (data.deposits)     _state.deposits[userId]     = data.deposits;
      if (data.dividends)    _state.dividends[userId]    = data.dividends;
      if (data.watchlist)    _state.watchlist            = data.watchlist;
      saveToStorage();
      return true;
    } catch(e) { return false; }
  }

  // Legacy: loadFromStorage (loads global only, user data loaded separately)
  function loadFromStorage() { return loadGlobal(); }

  return { get, set, merge, push, on, off, emit,
           saveToStorage, loadFromStorage, loadGlobal, loadUserData,
           exportUserData, importUserData };
})();

export default State;
