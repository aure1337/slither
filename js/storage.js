'use strict';

/* ============ Локальное хранилище (баланс, ник, скины) ============ */

const Store = {
  KEY: 'wormcash_v1',
  data: null,
  def() {
    return {
      bank: 500,
      nick: '',
      skin: 'classic',
      stake: 150,
      owned: ['classic', 'fire'],
      best: 0,
      plays: 0,
      killsTotal: 0,
      lastBonus: 0,
      muted: false,
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      this.data = raw ? Object.assign(this.def(), JSON.parse(raw)) : this.def();
    } catch (e) {
      this.data = this.def();
    }
    if (!Array.isArray(this.data.owned) || !this.data.owned.length) this.data.owned = ['classic', 'fire'];
    if (!this.data.owned.includes('classic')) this.data.owned.push('classic');
    return this;
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* приватный режим — молча */ }
  },
};
