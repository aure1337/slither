'use strict';

/* ============ Сеть (MQTT over WebSockets) ============
   Комнаты без своего сервера: каждый клиент публикует состояние своего червя
   в топик комнаты, чужие — интерполируем. Смерти/еда — события.
   ===================================================== */

const NET = {
  BROKERS: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ],
  LIBS: [
    'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js',
    'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js',
  ],
  STATUS: { OFF: 'off', CONNECTING: 'connecting', ON: 'on', FALLBACK: 'fallback' },
  PROTO: 2,
  LOBBY_TTL: 15000,          // сколько комната числится активной без пинга

  client: null,
  status: 'off',
  room: null,
  myId: null,
  nick: null,
  skin: null,
  peers: new Map(),      // id -> {worm, lastMsg, lx, ly, ldir, ltstamp, lastSeen}
  lobby: new Map(),      // room -> {n: игроки, t: последний пинг}
  knownRooms: new Set(), // вручную подтверждённые коды (JSON из localStorage)
  usedBroker: 0,
  reconnectTimer: null,
  onStatus: null,        // callback(status)
  onEvent: null,         // callback(type, data)
  onLobby: null,         // callback(roomsArray)
  announceTimer: null,
  roomFullTimer: null,
  lobbyTimer: null,

  genTopic(part) { return `wormcash/v${this.PROTO}/${this.room}/${part}`; },

  /* ---------- список активных комнат (лобби) ---------- */

  lobbyTopic() { return `wormcash/v${this.PROTO}/lobby`; },

  loadKnown() {
    try {
      const raw = JSON.parse(localStorage.getItem('wc_rooms') || '[]');
      if (Array.isArray(raw)) this.knownRooms = new Set(raw.filter(x => typeof x === 'string' && /^[a-zа-яё0-9_-]{2,16}$/i.test(x)));
    } catch (e) { this.knownRooms = new Set(); }
  },

  saveKnown() {
    try { localStorage.setItem('wc_rooms', JSON.stringify([...this.knownRooms].slice(0, 200))); } catch (e) { /* */ }
  },

  startLobby() {
    if (this.lobbyTimer) return;
    this.loadKnown();
    const sub = () => { try { this.client.subscribe(this.lobbyTopic(), { qos: 0 }); } catch (e) { /* */ } };
    if (this.client && this.status === this.STATUS.ON) sub();
    // пингуем свою комнату, пока в ней играем
    this.lobbyTimer = setInterval(() => {
      if (this.status === this.STATUS.ON && (this.room || this._scan)) {
        const n = this.room ? this.humanCount() : 0;
        if (this.room && n > 0) this.client.publish(this.lobbyTopic(), JSON.stringify({ r: this.room, n, t: Date.now() }), { qos: 0 });
      }
      // чистим протухшие
      const now = Date.now();
      for (const [r, e] of this.lobby) if (now - e.t > this.LOBBY_TTL) this.lobby.delete(r);
      if (this.onLobby) this.onLobby(this.roomsList());
    }, 4000);
  },

  stopLobby() {
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
    this.lobby.clear();
  },

  /* сканирование лобби без входа в игру: временный клиент только на топик-лобби */
  scan(onUpdate) {
    this._scan = true;
    this.loadKnown();
    if (typeof mqtt === 'undefined') {
      this.loadLib(0, () => this.scanStart(onUpdate));
      return;
    }
    this.scanStart(onUpdate);
  },

  scanStart(onUpdate) {
    if (typeof mqtt === 'undefined') { this._scan = false; onUpdate && onUpdate(this.roomsList()); return; }
    this._scanCb = onUpdate;
    if (this._scanClient) return;
    const mk = (idx) => {
      if (idx >= this.BROKERS.length || !this._scan) { return; }
      let c;
      try {
        c = mqtt.connect(this.BROKERS[idx], { connectTimeout: 5000, reconnectPeriod: 3000, keepalive: 30, clean: true, clientId: 'wcl_' + randId(8) });
      } catch (e) { mk(idx + 1); return; }
      this._scanClient = c;
      c.on('connect', () => { try { c.subscribe(this.lobbyTopic(), { qos: 0 }); } catch (e) { /* */ } });
      c.on('message', (tp, pl) => {
        let m; try { m = JSON.parse(pl); } catch (e) { return; }
        if (!m || m.r === undefined) return;
        const r = String(m.r).toLowerCase().slice(0, 16);
        if (!/^[a-zа-яё0-9_-]{2,16}$/.test(r)) return;
        const n = safeNum(m.n, 1, 99, 1);
        this.lobby.set(r, { n, t: Date.now() });
        if (this._scanCb) this._scanCb(this.roomsList());
      });
      c.on('error', () => { try { c.end(true); } catch (e) { /* */ } if (this._scanClient === c) this._scanClient = null; mk(idx + 1); });
      c.on('close', () => { if (this._scanClient === c && this._scan) { this._scanClient = null; mk(idx + 1); } });
    };
    mk(0);
    // периодическая чистка + отдача списка
    this._scanIv = setInterval(() => {
      const now = Date.now();
      for (const [r, e] of this.lobby) if (now - e.t > this.LOBBY_TTL) this.lobby.delete(r);
      if (this._scanCb) this._scanCb(this.roomsList());
    }, 3000);
  },

  stopScan() {
    this._scan = false;
    clearInterval(this._scanIv);
    this._scanIv = null;
    if (this._scanClient) { try { this._scanClient.end(true); } catch (e) { /* */ } this._scanClient = null; }
    this._scanCb = null;
  },

  roomsList() {
    // сначала ручные (недавно играемые) комнаты, потом живые блики
    const out = [];
    for (const r of this.knownRooms) {
      const e = this.lobby.get(r);
      out.push({ r, n: e ? e.n : 0, live: !!e });
    }
    for (const [r, e] of this.lobby) {
      if (!this.knownRooms.has(r)) out.push({ r, n: e.n, live: true });
    }
    out.sort((a, b) => (b.live - a.live) || (b.n - a.n) || a.r.localeCompare(b.r));
    return out.slice(0, 24);
  },

  humanCount() { return 1 + this.peers.size; },

  setStatus(s) {
    this.status = s;
    if (this.onStatus) this.onStatus(s);
  },

  connect(room, myId, nick, skin) {
    this.disconnect();
    this.room = (room || 'main').toLowerCase().replace(/[^a-zа-яё0-9_-]/gi, '').slice(0, 16) || 'main';
    this.myId = myId;
    this.nick = nick;
    this.skin = skin;
    this.peers.clear();
    this.setStatus(this.STATUS.CONNECTING);
    // комната запоминается как «своя» для списка
    this.loadKnown();
    this.knownRooms.add(this.room);
    this.saveKnown();
    if (typeof mqtt === 'undefined') this.loadLib(0, () => this.tryConnect(0));
    else this.tryConnect(0);
  },

  /* Подгрузка mqtt-библиотеки, если основной CDN не сработал */
  loadLib(idx, cb) {
    if (idx >= this.LIBS.length) { this.setStatus(this.STATUS.FALLBACK); return; }
    const s = document.createElement('script');
    s.src = this.LIBS[idx];
    s.async = true;
    let done = false;
    const finish = (ok) => { if (done) return; done = true; s.remove(); if (ok) cb(); else this.loadLib(idx + 1, cb); };
    s.onload = () => finish(typeof mqtt !== 'undefined');
    s.onerror = () => finish(false);
    document.head.appendChild(s);
    setTimeout(() => finish(typeof mqtt !== 'undefined'), 9000);
  },

  tryConnect(idx) {
    if (idx >= this.BROKERS.length) {
      this.setStatus(this.STATUS.FALLBACK);
      return;
    }
    this.usedBroker = idx;
    let client;
    try {
      client = mqtt.connect(this.BROKERS[idx], {
        connectTimeout: 6000,
        reconnectPeriod: 2500,
        keepalive: 30,
        clean: true,
        clientId: 'wc_' + this.myId + '_' + randId(4),
      });
    } catch (e) {
      this.tryConnect(idx + 1);
      return;
    }
    this.client = client;

    client.on('connect', () => {
      this.setStatus(this.STATUS.ON);
      try {
        client.subscribe([
          this.genTopic('s'),   // state
          this.genTopic('e'),   // events
        ], { qos: 0 });
        client.subscribe(this.lobbyTopic(), { qos: 0 });
      } catch (e) { /* */ }
      this.sendHello();
      // держим присутствие
      clearInterval(this.announceTimer);
      this.announceTimer = setInterval(() => this.sendState(true), 3000);
      // чистка молчунов
      clearInterval(this.roomFullTimer);
      this.roomFullTimer = setInterval(() => this.cleanup(), 4000);
      // лобби-пинг своей комнаты
      this.startLobby();
    });

    client.on('message', (topic, payload) => {
      if (topic.endsWith('/s')) this.onStateMsg(payload);
      else if (topic.endsWith('/e')) this.onEventMsg(payload);
      else if (topic.endsWith('/lobby')) this.onLobbyMsg(payload);
    });

    client.on('error', () => { /* mqtt.js сам переподключит */ });

    client.on('close', () => {
      if (this.status === this.STATUS.ON) this.setStatus(this.STATUS.CONNECTING);
    });

    client.on('reconnect', () => {
      if (this.status === this.STATUS.ON) this.setStatus(this.STATUS.CONNECTING);
    });
  },

  disconnect() {
    clearInterval(this.announceTimer);
    clearInterval(this.roomFullTimer);
    clearInterval(this.lobbyTimer);
    clearTimeout(this.reconnectTimer);
    this.announceTimer = this.roomFullTimer = this.lobbyTimer = null;
    if (this.client) {
      try { this.client.end(true); } catch (e) { /* */ }
      this.client = null;
    }
    this.peers.clear();
    this.lobby.clear();
    this.status = this.STATUS.OFF;
  },

  cleanup() {
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > 9000) {
        this.peers.delete(id);
        if (this.onEvent) this.onEvent('leave', { id });
      }
    }
  },

  publish(part, obj) {
    if (!this.client || this.status !== this.STATUS.ON) return;
    try {
      this.client.publish(this.genTopic(part), JSON.stringify(obj), { qos: 0 });
    } catch (e) { /* */ }
  },

  sendHello() {
    this.publish('s', { k: 'hi', id: this.myId, n: this.nick, sk: this.skin });
  },

  sendState(force) {
    const me = window.world && window.world.me;
    if (!me || !me.alive) return;
    this.publish('s', {
      k: 'st', id: this.myId, n: this.nick, sk: me.skin.id,
      x: Math.round(me.x), y: Math.round(me.y), d: +me.dir.toFixed(2),
      m: Math.round(me.mass), r: Math.round(me.runMoney),
      b: me.boosting ? 1 : 0,
      t: Date.now(),
    });
  },

  sendDeath(x, y, runMoney) {
    // с червя падает его плашка — передаём именно ₽
    this.publish('e', { k: 'died', id: this.myId, x: Math.round(x), y: Math.round(y), r: Math.round(runMoney) });
  },

  sendCashout(money, bank) {
    this.publish('e', { k: 'cash', id: this.myId, n: this.nick, m: money });
    this.publish('e', { k: 'bye', id: this.myId });
  },

  /* ---------- приём ---------- */

  onStateMsg(payload) {
    let m;
    try { m = JSON.parse(payload); } catch (e) { return; }
    if (!m || m.id === this.myId) return;
    if (m.k !== 'hi' && m.k !== 'st') return;

    let p = this.peers.get(m.id);
    const isNew = !p;
    if (isNew) {
      const w = makeWorm(m.id, safeName(m.n, 'Гость'), safeId(m.sk) || 'classic', 0, 0, false, false);
      w.remote = true;
      p = { worm: w, lastSeen: 0, lx: 0, ly: 0, ldir: 0, ltstamp: 0, lag: 0, joinT: 0 };
      this.peers.set(m.id, p);
      if (this.onEvent) this.onEvent('join', { id: m.id, name: safeName(m.n, 'Гость') });
    }
    const w = p.worm;
    w.name = safeName(m.n, w.name);
    if (safeId(m.sk)) w.skin = skinById(m.sk);
    w.lastSeen = Date.now();
    p.lastSeen = w.lastSeen;

    if (m.k === 'st') {
      const t = safeNum(m.t, 0, 9e15, Date.now());
      const x = safeNum(m.x, -1e6, 1e6, 0);
      const y = safeNum(m.y, -1e6, 1e6, 0);
      const d = safeNum(m.d, -Math.PI * 3, Math.PI * 3, 0);
      const mass = safeNum(m.m, 5, 50000, 40);
      const run = safeNum(m.r, 0, 1e9, 0);
      const boost = !!m.b;

      // буфер интерполяции
      w._nx = x; w._ny = y; w._ndir = d; w._nmass = mass; w._nrun = run; w._nboost = boost;
      w._stamp = t;
      w.hasNewNet = true;
    }
  },

  onEventMsg(payload) {
    let m;
    try { m = JSON.parse(payload); } catch (e) { return; }
    if (!m || m.id === this.myId) return;
    if (this.onEvent) this.onEvent(m.k, m);
  },

  onLobbyMsg(payload) {
    let m;
    try { m = JSON.parse(payload); } catch (e) { return; }
    if (!m || m.r === undefined) return;
    const r = String(m.r).toLowerCase().slice(0, 16);
    if (!/^[a-zа-яё0-9_-]{2,16}$/.test(r)) return;
    this.lobby.set(r, { n: safeNum(m.n, 1, 99, 1), t: Date.now() });
    if (this.onLobby) this.onLobby(this.roomsList());
  },

  /* вызывается из главного цикла каждый кадр */
  tick(world, dt) {
    if (this.status !== this.STATUS.ON) return;
    const now = Date.now();

    for (const [id, p] of this.peers) {
      const w = p.worm;

      // если давно нет апдейтов —worm замирает
      if (now - w.lastSeen > 9000) continue;

      if (w.hasNewNet) {
        // при первом пакете телепорт
        if (!w._first) {
          w.x = w._nx; w.y = w._ny; w.dir = w._ndir;
          w.mass = w._nmass;
          const n = wormLength(w._nmass);
          w.pts.length = 0;
          for (let i = 0; i < n; i++) {
            w.pts.push({ x: w.x - Math.cos(w.dir) * i * 3, y: w.y - Math.sin(w.dir) * i * 3 });
          }
          w._first = true;
        } else {
          // плавный догон: скорость интерполяции зависит от отставания
          const k = Math.min(1, dt * 10);
          w.x = lerp(w.x, w._nx, k);
          w.y = lerp(w.y, w._ny, k);
          w.dir = w.dir + angDiff(w.dir, w._ndir) * k;
        }
        w.mass = w.mass === undefined ? w._nmass : lerp(w.mass, w._nmass, Math.min(1, dt * 6));
        w.runMoney = w._nrun;
        w.boosting = w._nboost;
        w.hasNewNet = false;
      }

      // тянем тело за головой так же, как у ботов
      if (w.alive) {
        const n = wormLength(w.mass);
        let pts = w.pts;
        while (pts.length < n) pts.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
        if (pts.length > n) pts.length = n;
        let px = w.x, py = w.y;
        const step = CFG.SPACING + Math.min(wormHeadR(w) * 0.12, 4);
        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          const dx = pt.x - px, dy = pt.y - py;
          const d = Math.hypot(dx, dy) || 1;
          if (d > step) { pt.x = px + dx / d * step; pt.y = py + dy / d * step; }
          px = pt.x; py = pt.y;
        }
      }
    }

    // отправляем своё состояние ~12 раз/сек
    this._sendAcc = (this._sendAcc || 0) + dt;
    if (this._sendAcc >= 1 / 12) {
      this._sendAcc = 0;
      this.sendState();
    }
  },
};

/* Смерть удалённого игрока приходит событием, а не состоянием */
function netHandleEvent(type, m) {
  if (type === 'died') {
    const p = NET.peers.get(m.id);
    if (p) {
      const w = p.worm;
      w.alive = false;
      const x = safeNum(m.x, -1e6, 1e6, w.x), y = safeNum(m.y, -1e6, 1e6, w.y);
      const money = safeNum(m.r, 0, 1e9, 0);
      killWormRemote(window.world, w, x, y, money);
      NET.peers.delete(m.id);
    }
  }
}

function killWormRemote(world, w, x, y, money) {
  if (!world) return;
  w.x = x; w.y = y;
  w.runMoney = money; // с удалённого падает ровно его плашка
  dropLoot(world, x, y, money, 60);
  world.fx.push({ type: 'pop', x, y, r: wormHeadR(w), t: 0, dur: 0.5, color: w.skin.c1 });
  world.worms.delete(w.id);
}
