'use strict';

/* ============ Главный модуль ============ */

const Game = {
  state: 'menu',      // menu | play | pause | dying | over
  mode: 'online',     // online | solo
  store: null,
  myId: null,
  world: null,
  wantBots: 14,
  lastT: 0,
  lbTimer: 0,
  raf: 0,

  init() {
    this.store = Store.load();
    this.myId = 'p' + randId(8);
    Sfx.muted = !!this.store.data.muted;

    UI.init();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // фоновая мира в меню — мир с ботами для красоты
    this.world = makeWorld();
    fillFood(this.world, Math.round(CFG.FOOD_TARGET * 0.55));
    for (let i = 0; i < CFG.BOTS_MENU; i++) spawnBot(this.world);

    this.lastT = performance.now();
    this.startLoop();
  },

  resize() {
    const c = UI.el.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.floor(innerWidth * dpr);
    c.height = Math.floor(innerHeight * dpr);
    c.style.width = innerWidth + 'px';
    c.style.height = innerHeight + 'px';
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = innerWidth;
    this.vh = innerHeight;
  },

  /* ---------- ввод ---------- */

  bindInput() {
    const c = UI.el.canvas;
    const setTarget = (ev) => {
      if (this.state !== 'play') return;
      Input.sx = ev.clientX;
      Input.sy = ev.clientY;
      Input.has = true;
    };
    c.addEventListener('pointermove', setTarget);
    c.addEventListener('pointerdown', (ev) => {
      Sfx.init();
      setTarget(ev);
      if (ev.pointerType === 'mouse') Input.boost = true;
    });
    window.addEventListener('pointerup', (ev) => {
      if (ev.pointerType === 'mouse') Input.boost = false;
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'KeyW') {
        if (this.state === 'play') { ev.preventDefault(); Input.boost = true; }
      }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'KeyW') Input.boost = false;
    });
    // не даём жестам браузера мешать
    document.addEventListener('contextmenu', (ev) => { if (this.state === 'play') ev.preventDefault(); });
    document.addEventListener('touchmove', (ev) => { if (this.state === 'play') ev.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (ev) => ev.preventDefault());
  },

  /* ---------- запуск жизни ---------- */

  startRun() {
    const d = this.store.data;
    // ставка: вводимая сумма, минимум 150₽, не больше баланса
    let stake = Math.floor(Number(UI.el.stakeInput && UI.el.stakeInput.value) || 0);
    if (!isFinite(stake) || stake < 150) stake = 150;
    stake = Math.min(stake, Math.floor(d.bank));
    if (stake < 150) {
      UI.toast('Нужно минимум 150₽ на ставку');
      UI.refreshBonus();
      return;
    }
    d.stake = stake;
    if (UI.el.stakeInput) UI.el.stakeInput.value = stake; // синхронизируем поле с прижатой ставкой
    Sfx.click();
    d.bank -= stake;
    d.plays++;
    d.nick = safeName(UI.el.nickInput.value, '');
    this.store.save();

    // мир
    const world = makeWorld();
    this.world = world;
    window.world = world;

    const p = randomSpawnPos();
    const me = makeWorm(this.myId, d.nick || 'Червяк', d.skin, p.x, p.y, false, true);
    world.me = me;
    world.worms.set(me.id, me);
    fillFood(world, CFG.FOOD_TARGET);

    Input.has = false;
    Input.boost = false;
    Cam.x = me.x; Cam.y = me.y; Cam.zoom = 1; Cam.targetZoom = 1;

    // сеть / боты
    if (this.mode === 'online') {
      const room = safeName(UI.el.roomInput.value, 'main').toLowerCase() || 'main';
      d.room = room;
      this.store.save();
      this.wantBots = CFG.BOTS_ONLINE;
      NET.onStatus = (s) => this.netStatus(s);
      NET.onEvent = (type, m) => this.netEvent(type, m);
      NET.connect(room, this.myId, me.name, me.skin.id);
      for (let i = 0; i < CFG.BOTS_ONLINE; i++) spawnBot(world);
    } else {
      this.wantBots = CFG.BOTS_SOLO;
      for (let i = 0; i < CFG.BOTS_SOLO; i++) spawnBot(world);
    }

    this.state = 'play';
    // касса откроется через 30 секунд игрового времени — забирать сразу нельзя
    this.cashLockUntil = world.time + CFG.CASH_LOCK;
    UI.showHud();
    UI.el.hudRoom.textContent = this.mode === 'online' ? '📶 подключение...' : '🤖 боты';
    UI.refreshBalance();
  },

  netStatus(s) {
    if (this.state !== 'play' && this.state !== 'pause') return;
    if (s === NET.STATUS.ON) UI.toast('🌐 Онлайн-комната активна');
    else if (s === NET.STATUS.FALLBACK) {
      UI.toast('📴 Сеть недоступна — играем с ботами');
      this.wantBots = CFG.BOTS_SOLO;
    }
  },

  netEvent(type, m) {
    if (type === 'join') UI.toast('➕ ' + m.name + ' в игре');
    else if ((type === 'leave' || type === 'bye') && this.world) {
      const w = this.world.worms.get(m.id);
      if (w) this.world.worms.delete(m.id);
    } else if (type === 'cash') {
      if (m.m > 0) UI.toast(`🏦 ${safeName(m.n, 'Гость')} забрал ${fmtRub(m.m)}`);
    } else if (type === 'died') {
      netHandleEvent(type, m);
    }
  },

  /* ---------- касса / смерть ---------- */

  cashout(fromPause) {
    const me = this.world && this.world.me;
    if (!me || !me.alive || this.state !== 'play') return;
    // в первые 30 секунд касса закрыта
    const lockLeft = (this.cashLockUntil || 0) - this.world.time;
    if (lockLeft > 0) { UI.toast('🏦 Касса откроется через ' + Math.ceil(lockLeft) + 'с'); return; }
    const money = Math.round(me.runMoney);
    const stake = Math.max(0, Math.round(this.store.data.stake || 0));
    me.alive = false; // без рассыпания
    // на баланс: собранное + возврат ставки (даже при 0 собранного вернётся ставка)
    const payout = money + stake;
    this.store.data.bank += payout;
    this.store.save();
    Sfx.cash();
    if (this.mode === 'online') NET.sendCashout(money, this.store.data.bank);
    this.endRun(true, money);
  },

  onMyDeath() {
    const me = this.world.me;
    if (this.mode === 'online') NET.sendDeath(me.x, me.y, me.runMoney);
    this.state = 'dying';
    setTimeout(() => this.endRun(false, Math.round(me.runMoney)), 900);
  },

  endRun(win, money) {
    const me = this.world.me;
    const stats = {
      mass: Math.max(me ? me.maxMass : 0, 0),
      money,
      stake: Math.max(0, Math.round(this.store.data.stake || 0)),
      kills: this.world.kills,
      time: this.world.time,
      bank: this.store.data.bank,
    };
    if (me && me.maxMass > this.store.data.best) this.store.data.best = me.maxMass;
    this.store.data.killsTotal += stats.kills;
    this.store.save();

    NET.disconnect();
    this.state = 'over';
    UI.showOver(win, money, stats);
  },

  toMenu() {
    NET.disconnect();
    this.state = 'menu';
    // фон меню: снова мир с ботами
    this.world = makeWorld();
    window.world = this.world;
    fillFood(this.world, Math.round(CFG.FOOD_TARGET * 0.55));
    for (let i = 0; i < CFG.BOTS_MENU; i++) spawnBot(this.world);
    UI.showMenu();
  },

  pause() {
    if (this.state !== 'play') return;
    if (this.mode === 'online') {
      UI.toast('В онлайне паузы нет — мир живёт');
      return;
    }
    this.state = 'pause';
    UI.showPause(this.world.me ? this.world.me.runMoney : 0);
  },

  resume() {
    if (this.state !== 'pause') return;
    this.state = 'play';
    UI.el.pauseModal.classList.add('hidden');
  },

  /* ---------- цикл ---------- */

  loop(t) {
    this.raf = requestAnimationFrame((tt) => this.loop(tt));
    this.frame(t);
  },

  /* Один кадр. Вызывается из rAF, а в скрытых/троттлящихся вкладках —
     сторожевым интервалом, чтобы мир и сеть не умирали */
  frame(t) {
    this._lastFrameT = performance.now();
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    const world = this.world;
    if (!world) return;

    const playing = this.state === 'play';

    if (playing || this.state === 'dying') {
      world.time += dt;

      if (playing) {
        updateMyWorm(world, dt);
        if (world.me && world.me.alive) {
          updateWorm(world, world.me, dt);
          eatFood(world, world.me);
        }
      }

      // боты живут всегда (и в dying, и в паузе онлайн-мира)
      if (playing || this.state === 'dying') {
        updateBots(world, dt);
      }

      // сеть
      if (this.mode === 'online' && NET.status !== NET.STATUS.OFF) {
        NET.tick(world, dt);
        // синхронизация участников в мир
        for (const [id, p] of NET.peers) {
          if (!world.worms.has(id)) world.worms.set(id, p.worm);
        }
        for (const [id, w] of world.worms) {
          if (w.remote && !NET.peers.has(id)) world.worms.delete(id);
        }
      }

      if (playing) {
        checkCollisions(world);
        // моя смерть?
        if (world.me && !world.me.alive) {
          this.onMyDeath();
        }
      }

      fillFood(world, CFG.FOOD_TARGET);
      updateEffects(world, dt);
      Cam.update(world, dt, this.vw, this.vh);
    } else if (this.state === 'menu' || this.state === 'over') {
      // фоновая жизнь меню
      world.time += dt;
      updateBots(world, dt);
      fillFood(world, 400);
      updateEffects(world, dt);
      Cam.targetZoom = 0.9;
      Cam.update(world, dt, this.vw, this.vh);
    }

    // рендер
    drawWorld(UI.el.canvas.getContext('2d'), world, this.vw, this.vh);

    // HUD
    if (this.state === 'play' || this.state === 'dying' || this.state === 'pause') this.updateHud(dt);
  },

  startLoop() {
    const frame = (t) => { try { this.frame(t); } catch (e) { /* кадр не должен ронять цикл */ } };
    const raf = (t) => { frame(t); this.raf = requestAnimationFrame(raf); };
    this.raf = requestAnimationFrame(raf);
    // сторожевой таймер: если rAF молчит (скрытая вкладка), качаем мир сами
    if (!this._watchdog) {
      this._lastFrameT = 0;
      this._watchdog = setInterval(() => {
        if (performance.now() - this._lastFrameT > 400) frame(performance.now());
      }, 250);
    }
  },

  updateHud(dt) {
    document.title = 'WC ' + this.state + ' f' + (++this._dbgFrames || (this._dbgFrames = 1));
    const world = this.world;
    const me = world.me;
    if (me) {
      const run = Math.max(0, Math.round(me.runMoney));
      const stake = Math.max(0, Math.round(this.store.data.stake || 0));
      const lockLeft = Math.max(0, (this.cashLockUntil || 0) - world.time);
      UI.el.hudBank.textContent = '💰 ' + fmtRub(this.store.data.bank);
      UI.el.cashBtn.classList.toggle('locked', lockLeft > 0);
      UI.el.cashBtn.textContent = lockLeft > 0
        ? 'ЗАБРАТЬ через ' + Math.ceil(lockLeft) + 'с'
        : 'ЗАБРАТЬ ' + fmtRub(run + stake);
      UI.el.cashBtn.classList.toggle('armed', run === 0 && lockLeft <= 0);
    }

    // комната
    if (this.mode === 'online') {
      let humans = 1;
      for (const [, w] of world.worms) if (!w.isBot && !w.isMe) humans++;
      const s = NET.status;
      UI.el.hudRoom.textContent =
        s === NET.STATUS.ON ? `🌐 ${NET.room} · ${humans} онлайн`
          : s === NET.STATUS.CONNECTING ? '📶 подключение...'
            : '📴 офлайн (боты)';
    }

    // лидерборд 2 раза/сек — топ по ₽ с плашки + своя строка, если не в топе
    this.lbTimer -= dt;
    if (this.lbTimer <= 0) {
      this.lbTimer = 0.5;
      const all = buildLeaderboard(world);
      const rows = UI.el.lbList;
      rows.innerHTML = '';
      const addRow = (w, rank) => {
        const div = document.createElement('div');
        div.className = 'lb-row' + (w.isMe ? ' me' : '');
        const medal = rank === 1 ? '👑 ' : '';
        div.innerHTML = `<span>${medal}${rank}. ${escapeHtml(w.name)}</span><b>${fmtRub(w.runMoney)}</b>`;
        rows.appendChild(div);
      };
      all.slice(0, 10).forEach((w, i) => addRow(w, i + 1));
      const myIdx = all.findIndex(w => w.isMe);
      if (myIdx >= 10) addRow(all[myIdx], myIdx + 1);
      drawMinimap(UI.el.minimap, world);
    }
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', () => Game.init());
