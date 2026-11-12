'use strict';

/* ============ Скины ============ */

const SKINS = [
  { id: 'classic',  name: 'Классика', price: 0,    c1: '#39d353', c2: '#1f8f38', pattern: 'dash' },
  { id: 'fire',     name: 'Огонёк',   price: 0,    c1: '#ff7a3d', c2: '#e6482e', pattern: 'dash' },
  { id: 'bee',      name: 'Пчёлка',   price: 300,  c1: '#ffd23d', c2: '#2b2b33', pattern: 'dash' },
  { id: 'aqua',     name: 'Аква',     price: 300,  c1: '#3dd6ff', c2: '#2b6cff', pattern: 'dash' },
  { id: 'purple',   name: 'Пурпур',   price: 500,  c1: '#b06cff', c2: '#ff5ad2', pattern: 'dash' },
  { id: 'melon',    name: 'Арбуз',    price: 600,  c1: '#2fce4e', c2: '#ff5a5a', pattern: 'dash' },
  { id: 'panda',    name: 'Панда',    price: 800,  c1: '#f2f4fa', c2: '#23252e', pattern: 'dash' },
  { id: 'gold',     name: 'Золото',   price: 1000, c1: '#ffd23d', c2: '#c98a12', pattern: 'dash', glow: 'rgba(255,210,61,0.5)' },
  { id: 'vampire',  name: 'Вампир',   price: 1200, c1: '#a1233f', c2: '#1b1023', pattern: 'dash' },
  { id: 'neon',     name: 'Неон',     price: 1500, c1: '#39ffd0', c2: '#3d8bff', pattern: 'dash', glow: 'rgba(57,255,208,0.55)' },
  { id: 'rainbow',  name: 'Радуга',   price: 2500, c1: '#ff5a5a', c2: '#39d353', pattern: 'seg' },
  { id: 'absolute', name: 'Абсолют',  price: 5000, c1: '#1a1f2e', c2: '#f5f7ff', pattern: 'dash', glow: 'rgba(255,255,255,0.35)' },
];

function skinById(id) {
  return SKINS.find(s => s.id === id) || SKINS[0];
}

/* Превью скина на маленьком canvas карточки */
function drawSkinPreview(canvas, skin) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const n = 8;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push({ x: 30 + (w - 60) * (i / n), y: h / 2 + Math.sin(i * 1.05 + 0.4) * (h * 0.2) });
  }
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (skin.glow) {
    ctx.save();
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 26;
    ctx.strokeStyle = skin.c1;
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.lineWidth = 26;
  ctx.strokeStyle = skin.c1;
  ctx.stroke(path);
  if (skin.pattern === 'dash') {
    ctx.save();
    ctx.lineWidth = 17;
    ctx.strokeStyle = skin.c2;
    ctx.setLineDash([12, 12]);
    ctx.stroke(path);
    ctx.restore();
  } else if (skin.pattern === 'seg') {
    for (let i = 1; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 6.5, 0, TAU);
      ctx.fillStyle = `hsl(${(i * 47) % 360},85%,60%)`;
      ctx.fill();
    }
  }
  // голова слева + глаза
  const hd = pts[0];
  ctx.beginPath();
  ctx.arc(hd.x, hd.y, 14, 0, TAU);
  ctx.fillStyle = skin.c1;
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(hd.x - 4, hd.y + s * 5.5, 4.6, 0, TAU);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hd.x - 6, hd.y + s * 5.5, 2.2, 0, TAU);
    ctx.fillStyle = '#101020';
    ctx.fill();
  }
}
