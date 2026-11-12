'use strict';

const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function turnToward(a, target, maxStep) {
  const d = angDiff(a, target);
  return a + clamp(d, -maxStep, maxStep);
}

function randId(n = 6) {
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

function fmtRub(n) {
  return Math.max(0, Math.round(n)).toLocaleString('ru-RU') + '₽';
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function safeName(s, fallback) {
  if (typeof s !== 'string') return fallback || 'Червяк';
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return s || fallback || 'Червяк';
}

function safeId(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(s) ? s : null;
}

function safeNum(v, min, max, dflt) {
  v = Number(v);
  if (!isFinite(v)) return dflt;
  return clamp(v, min, max);
}
