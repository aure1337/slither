'use strict';

/* ============ UI ============ */

const UI = {
  el: {},

  init() {
    const ids = ['menu', 'skinsModal', 'helpModal', 'pauseModal', 'overModal', 'hud',
      'menuBalance', 'nickInput', 'skinsBtn', 'helpBtn', 'modeRow', 'roomField', 'roomInput', 'roomRand',
      'stakeField', 'stakeInput',
      'playBtn', 'bonusBtn', 'bonusBtn2', 'skinGrid', 'skinsBalance',
      'hudBank', 'hudRoom', 'hudMenuBtn', 'leaderboard', 'lbList',
      'roomsTab', 'roomsPanel', 'roomsList', 'roomsClose',
      'cashBtn', 'boostBtn', 'hintChip', 'minimap', 'minimapWrap', 'toast',
      'pauseMoney', 'pauseCash', 'pauseResume',
      'overTitle', 'overSub', 'overStats', 'againBtn', 'toMenuBtn'];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.el.canvas = document.getElementById('game');

    // ник из хранилища
    this.el.nickInput.value = Game.store.data.nick || '';
    this.el.stakeInput.value = Math.max(150, Math.min(Game.store.data.stake || 150, Game.store.data.bank || 0)) || 150;
    // комната из хранилища или URL (?room=xxx)
    const urlRoom = new URLSearchParams(location.search).get('room');
    if (urlRoom) { this.el.roomInput.value = urlRoom.slice(0, 16); Game.store.data.room = this.el.roomInput.value.toLowerCase(); Game.store.save(); }
    else this.el.roomInput.value = Game.store.data.room || 'main';

    this.bind();
    this.refreshBalance();
    this.refreshBonus();
    this.updatePlayLabel();
  },

  bind() {
    const E = this.el;

    // модалки
    E.skinsBtn.onclick = () => { Sfx.init(); Sfx.click(); this.openSkins(); };
    E.helpBtn.onclick = () => { Sfx.init(); Sfx.click(); E.helpModal.classList.remove('hidden'); };
    document.querySelectorAll('[data-close]').forEach(b => {
      b.onclick = () => { Sfx.click(); document.getElementById(b.dataset.close).classList.add('hidden'); };
    });

    // режим
    E.modeRow.querySelectorAll('.mode').forEach(btn => {
      btn.onclick = () => {
        Sfx.init(); Sfx.click();
        E.modeRow.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Game.mode = btn.dataset.mode;
        E.roomField.classList.toggle('hidden', Game.mode !== 'online');
      };
    });

    // комната
    E.roomRand.onclick = () => {
      Sfx.click();
      E.roomInput.value = randId(6);
    };

    // игра
    E.playBtn.onclick = () => { Sfx.init(); Game.startRun(); };
    E.againBtn.onclick = () => { Sfx.init(); Game.startRun(); };
    E.toMenuBtn.onclick = () => { Sfx.click(); Game.toMenu(); };

    // ставка: обновляем подпись кнопки на лету
    E.stakeInput.addEventListener('input', () => this.updatePlayLabel());

    // бонус
    E.bonusBtn.onclick = () => this.takeBonus();
    E.bonusBtn2.onclick = () => this.takeBonus();

    // HUD
    E.hudMenuBtn.onclick = () => Game.pause();
    E.pauseResume.onclick = () => { Sfx.click(); Game.resume(); };
    E.pauseCash.onclick = () => { Sfx.click(); Game.cashout(true); };

    // касса
    E.cashBtn.onclick = () => Game.cashout();

    // буст на телефоне
    const boostOn = (on) => { Input.boost = on; E.boostBtn.classList.toggle('on', on); };
    E.boostBtn.addEventListener('pointerdown', (ev) => { ev.preventDefault(); boostOn(true); });
    E.boostBtn.addEventListener('pointerup', () => boostOn(false));
    E.boostBtn.addEventListener('pointercancel', () => boostOn(false));
    E.boostBtn.addEventListener('pointerleave', () => boostOn(false));
    E.boostBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // ввод ника и ставки
    E.nickInput.addEventListener('input', () => {
      Game.store.data.nick = safeName(E.nickInput.value, '');
      Game.store.save();
    });
    E.stakeInput.addEventListener('input', () => {
      let v = Math.floor(Number(E.stakeInput.value) || 0);
      if (v > 1000000) { v = 1000000; E.stakeInput.value = v; }
      Game.store.data.stake = v;
    });
    E.stakeInput.addEventListener('change', () => {
      let v = Math.floor(Number(E.stakeInput.value) || 0);
      if (!isFinite(v) || v < 150) { v = 150; UI.toast('Минимальная ставка — 150₽'); }
      const bank = Game.store.data.bank;
      if (v > bank) { v = Math.max(150, Math.floor(bank)); UI.toast('Ставка ограничена балансом: ' + fmtRub(v)); }
      E.stakeInput.value = v;
      Game.store.data.stake = v;
      this.updatePlayLabel();
      Game.store.save();
    });

    // ESC — пауза
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && Game.state === 'play') Game.pause();
    });

    // панель комнат
    E.roomsTab.onclick = () => { Sfx.init(); Sfx.click(); this.toggleRooms(); };
    E.roomsClose.onclick = () => { Sfx.click(); this.toggleRooms(false); };
  },

  toggleRooms(force) {
    const E = this.el;
    const show = force !== undefined ? force : E.roomsPanel.classList.contains('hidden');
    E.roomsPanel.classList.toggle('hidden', !show);
    if (show) {
      this.renderRooms([]);
      NET.onLobby = (rooms) => this.renderRooms(rooms);
      NET.scan((rooms) => this.renderRooms(rooms));
    } else {
      NET.onLobby = null;
      NET.stopScan();
    }
  },

  renderRooms(rooms) {
    const list = this.el.roomsList;
    if (!list) return;
    list.innerHTML = '';
    if (!NET._scan) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '📡 Подключаемся к списку комнат...';
      list.appendChild(d);
      return;
    }
    const current = (Game.store.data.room || 'main');
    if (!rooms.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Пока тихо. Создай свою — придумай код комнаты и жми ИГРАТЬ. Она появится здесь для других.';
      list.appendChild(d);
      return;
    }
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'room-row';
      const code = document.createElement('span');
      code.className = 'code';
      code.textContent = r.r;
      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = r.live ? `🟢 ${r.n} чел.` : '🕘 недавняя';
      row.appendChild(code);
      row.appendChild(cnt);
      row.onclick = () => {
        Sfx.click();
        this.el.roomInput.value = r.r;
        Game.store.data.room = r.r;
        Game.store.save();
        this.toggleRooms(false);
        this.toast(`Комната «${r.r}» выбрана`);
      };
      list.appendChild(row);
    }
  },

  openSkins() {
    this.el.skinsModal.classList.remove('hidden');
    this.renderSkins();
  },

  renderSkins() {
    const E = this.el;
    E.skinsBalance.textContent = fmtRub(Game.store.data.bank);
    const grid = E.skinGrid;
    grid.innerHTML = '';
    for (const skin of SKINS) {
      const owned = Game.store.data.owned.includes(skin.id);
      const selected = Game.store.data.skin === skin.id;
      const card = document.createElement('div');
      card.className = 'skin-card' + (selected ? ' selected' : '');
      const cv = document.createElement('canvas');
      cv.width = 280; cv.height = 112;
      card.appendChild(cv);
      const nameEl = document.createElement('div');
      nameEl.className = 'skin-name';
      nameEl.textContent = skin.name;
      card.appendChild(nameEl);
      const priceEl = document.createElement('div');
      priceEl.className = 'skin-price';
      priceEl.textContent = owned ? (selected ? 'Выбран' : 'Куплен') : fmtRub(skin.price);
      card.appendChild(priceEl);
      const btn = document.createElement('button');
      btn.className = 'skin-btn' + (owned ? ' sel' : ' buy');
      btn.textContent = owned ? (selected ? '✓ В игре' : 'Выбрать') : 'Купить';
      btn.disabled = !owned && Game.store.data.bank < skin.price;
      btn.onclick = () => {
        Sfx.init();
        if (owned) {
          Game.store.data.skin = skin.id;
          Sfx.click();
        } else if (Game.store.data.bank >= skin.price) {
          Game.store.data.bank -= skin.price;
          Game.store.data.owned.push(skin.id);
          Game.store.data.skin = skin.id;
          Sfx.bonus();
          this.toast(`Скин «${skin.name}» куплен!`);
        } else {
          this.toast('Не хватает ₽ — заработай в игре');
          return;
        }
        Game.store.save();
        this.refreshBalance();
        this.renderSkins();
      };
      card.appendChild(btn);
      drawSkinPreview(cv, skin);
      grid.appendChild(card);
    }
  },

  refreshBalance() {
    this.el.menuBalance.textContent = '💰 Баланс: ' + fmtRub(Game.store.data.bank);
  },

  refreshBonus() {
    const d = Game.store.data;
    const can = Date.now() - (d.lastBonus || 0) > 3 * 60 * 60 * 1000;
    const broke = d.bank < 150;
    const show = broke || (can && d.bank < 100000);
    this.el.bonusBtn.classList.toggle('hidden', !show);
    this.el.bonusBtn2.classList.toggle('hidden', !show);
    const label = can ? '🎁 Бонус +500₽' : '🆘 Подаяние +300₽';
    this.el.bonusBtn.textContent = label;
    this.el.bonusBtn2.textContent = label;
  },

  takeBonus() {
    const d = Game.store.data;
    const can = Date.now() - (d.lastBonus || 0) > 3 * 60 * 60 * 1000;
    if (can) {
      d.lastBonus = Date.now();
      d.bank += 500;
      this.toast('🎁 +500₽ на баланс!');
    } else if (d.bank < 150) {
      // страховка от банкротства: милостыня на две минимальные ставки
      d.bank += 300;
      this.toast('🆘 +300₽ на новые жизни. Не сливай!');
    } else {
      return;
    }
    Game.store.save();
    Sfx.init(); Sfx.bonus();
    this.refreshBalance();
    this.refreshBonus();
    this.updatePlayLabel();
  },

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg;
    this.el.toast.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  },

  /* ---------- состояния экранов ---------- */

  updatePlayLabel() {
    const stake = Math.max(150, Math.floor(Number(this.el.stakeInput && this.el.stakeInput.value) || 0));
    this.el.playBtn.textContent = 'ИГРАТЬ · −' + fmtRub(stake);
  },

  showMenu() {
    this.hideAll();
    this.el.menu.classList.remove('hidden');
    this.refreshBalance();
    this.refreshBonus();
    this.updatePlayLabel();
  },

  showHud() {
    this.hideAll();
    this.el.hud.classList.remove('hidden');
  },

  hideAll() {
    for (const k of ['menu', 'skinsModal', 'helpModal', 'pauseModal', 'overModal', 'hud']) {
      this.el[k].classList.add('hidden');
    }
  },

  showPause(money) {
    this.el.pauseModal.classList.remove('hidden');
    const stake = Math.max(0, Math.round(Game.store.data.stake || 0));
    this.el.pauseMoney.textContent = fmtRub(money + stake);
    this.el.pauseCash.textContent = 'Забрать ' + fmtRub(money + stake) + ' и выйти';
  },

  showOver(win, money, stats) {
    this.hideAll();
    this.el.overModal.classList.remove('hidden');
    this.el.overTitle.textContent = win ? '🏦 Деньги в кассе!' : '💀 Червяк погиб';
    this.el.overTitle.style.color = win ? '#ffd23d' : '#ff5a5a';
    const stake = stats.stake || 0;
    this.el.overSub.textContent = win
      ? `Возврат ставки ${fmtRub(stake)} + выигрыш ${fmtRub(money)} — всего ${fmtRub(stake + money)} на баланс`
      : `Ставка ${fmtRub(stake)} и собранные ${fmtRub(money)} сгорели вместе с червём`;
    const st = this.el.overStats;
    st.innerHTML = '';
    const items = [
      ['Масса', Math.round(stats.mass)],
      ['Собрано', fmtRub(money)],
      ['Ставка', fmtRub(stake)],
      ['Убийств', stats.kills],
      ['Время', fmtTime(stats.time)],
      ['Баланс', fmtRub(stats.bank)],
    ];
    const nextStake = Math.max(10, Math.floor(Number(this.el.stakeInput && this.el.stakeInput.value) || 0));
    this.el.againBtn.textContent = 'Ещё раз · −' + fmtRub(nextStake);
    for (const [k, v] of items) {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<b>${v}</b>${k}`;
      st.appendChild(d);
    }
    this.refreshBonus();
  },
};
