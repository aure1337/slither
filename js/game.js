'use strict';

/* ============ Конфиг ============ */

const CFG = {
  WORLD_R: 3600,            // радиус круглой арены
  TICK: 1 / 60,

  BASE_SPEED: 158,          // px/сек базовая скорость
  BOOST_MULT: 1.9,
  TURN_RATE: 3.4,           // рад/сек поворота головы
  SPACING: 7,               // базальный шаг сегментов
  MASS_TO_R: 1.15,          // радиус сегмента = base + k * mass^0.5 ... см. wormRadius
  BASE_R: 9,
  BOOST_DROP_MASS: 14,      // массы в секунду при ускорении
  BOOST_MIN_MASS: 40,
  CASH_LOCK: 30,            // сек до открытия кассы после входа в игру
  FOOD_VALUE: 2,
  INIT_MASS: 40,            // стартовая масса червя
  LOOT_MULT: 1.1,           // с убитого выпадает его ₽ × 1.1
  FOOD_TARGET: 900,         // сколько обычной еды держать в мире
  BOTS_SOLO: 18,            // червей в соло-игре
  BOTS_ONLINE: 12,          // червей в онлайн-комнате
  BOTS_MENU: 12,            // червей в фоновом мире меню
};

const FOOD_COLORS = ['#ffd23d', '#ff7a3d', '#3dd6ff', '#b06cff', '#39d353', '#ff5ad2', '#f2f4fa'];

/* ============ Мир ============ */

function makeWorld() {
  return {
    time: 0,
    me: null,
    worms: new Map(),   // id -> worm (включая меня)
    food: new Map(),    // id -> food
    fx: [],             // визуальные эффекты
    floaters: [],       // всплывающие "+12₽"
    kills: 0,
  };
}

function massToRadius(mass) {
  return CFG.BASE_R + Math.sqrt(mass) * CFG.MASS_TO_R * 0.5;
}

function wormSpeed(worm) {
  const s = CFG.BASE_SPEED * (1 - Math.min(worm.mass, 2600) / 2600 * 0.42);
  return worm.boosting ? s * CFG.BOOST_MULT : s;
}

function wormLength(mass) {
  return 16 + Math.floor(Math.sqrt(mass) * 2.1);
}

function randomSpawnPos() {
  const a = Math.random() * TAU;
  const r = Math.sqrt(Math.random()) * (CFG.WORLD_R - 260);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/* ============ Червь ============ */

function makeWorm(id, name, skinId, x, y, isBot, isMe) {
  const w = {
    id, name: name || 'Червяк',
    skin: skinById(skinId),
    isBot: !!isBot, isMe: !!isMe,
    x, y, dir: Math.random() * TAU,
    wantDir: 0, targetX: x, targetY: y, hasTarget: false,
    mass: CFG.INIT_MASS, boosting: false,
    boostFuel: 1,
    alive: true, deadAt: 0,
    pts: [],               // [{x,y}]
    // деньги за жизнь
    runMoney: 0,
    maxMass: CFG.INIT_MASS,
    // визуальные
    wobble: Math.random() * 10,
    eatFlash: 0,
    // боты
    ai: null,
    // сеть
    netDirty: true,
    lastSeen: 0,
    remote: false,
  };
  w.wantDir = w.dir;
  const n = wormLength(w.mass);
  for (let i = 0; i < n; i++) w.pts.push({ x: x - Math.cos(w.dir) * i * 2, y: y - Math.sin(w.dir) * i * 2 });
  return w;
}

function wormHeadR(w) { return massToRadius(w.mass) * 1.06; }

function ensureWormAI(w) {
  if (!w.ai) w.ai = { t: 0, goal: null, goalT: 0, avoid: 0, aggro: Math.random() < 0.25, wanderT: 0, wander: w.dir };
}

/* ============ Еда ============ */

let foodSeq = 1;
function makeFood(x, y, value, color, golden, vx, vy) {
  return {
    id: 'f' + (foodSeq++) + Math.random().toString(36).slice(2, 6),
    x, y, value: value || CFG.FOOD_VALUE,
    r: value >= 6 ? 7.5 : 3.4 + Math.min(value, 6) * 0.55,
    color: color || pick(FOOD_COLORS),
    golden: !!golden,
    vx: vx || 0, vy: vy || 0,
    born: Date.now(),
    wobble: Math.random() * TAU,
  };
}

function spawnFoodNear(x, y, count, value, golden, spread) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const d = Math.random() * (spread || 30);
    const f = makeFood(x + Math.cos(a) * d, y + Math.sin(a) * d, value || CFG.FOOD_VALUE, golden ? '#ffd23d' : undefined, golden);
    out.push(f);
  }
  return out;
}

function randomPointInWorld(margin) {
  const a = Math.random() * TAU;
  const r = Math.sqrt(Math.random()) * (CFG.WORLD_R - (margin || 120));
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function fillFood(world, target) {
  let need = target - world.food.size;
  while (need-- > 0) {
    const p = randomPointInWorld(90);
    const f = makeFood(p.x, p.y, CFG.FOOD_VALUE);
    world.food.set(f.id, f);
  }
}

/* ============ Обновление червя ============ */

function updateWorm(world, w, dt) {
  if (!w.alive) return;
  const spd = wormSpeed(w);
  const turn = CFG.TURN_RATE * dt * (w.boosting ? 0.7 : 1) * (1 - Math.min(w.mass, 3000) / 3000 * 0.35);

  // цель направления: для меня — wantDir (ставится вводом), для ботов — ai
  w.dir = turnToward(w.dir, w.wantDir, turn);

  const nx = w.x + Math.cos(w.dir) * spd * dt;
  const ny = w.y + Math.sin(w.dir) * spd * dt;
  w.x = nx; w.y = ny;
  w.wobble += dt * (6 + spd * 0.02);

  // трата массы на буст (без крошек — иначе можно кататься туда-сюда и собирать свои же шарики)
  if (w.boosting) {
    w.mass -= CFG.BOOST_DROP_MASS * dt;
    if (w.mass < CFG.BOOST_MIN_MASS) w.boosting = false;
  }

  // тело тянется за головой с постоянным шагом
  const n = wormLength(w.mass);
  let pts = w.pts;
  if (n > pts.length) {
    const last = pts[pts.length - 1];
    while (pts.length < n) pts.push({ x: last.x, y: last.y });
  } else if (n < pts.length) {
    pts.length = n;
  }
  let px = w.x, py = w.y;
  const step = CFG.SPACING + Math.min(wormHeadR(w) * 0.12, 4);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dx = p.x - px, dy = p.y - py;
    const d = Math.hypot(dx, dy) || 1;
    if (d > step) {
      p.x = px + dx / d * step;
      p.y = py + dy / d * step;
    }
    px = p.x; py = p.y;
  }

  w.maxMass = Math.max(w.maxMass, w.mass);
}

function addFood(world, f) {
  if (world.food.size > 1400) world.food.delete(world.food.keys().next().value);
  world.food.set(f.id, f);
}

/* ест еду головой */
function eatFood(world, w) {
  if (!w.alive) return;
  const R = wormHeadR(w) + 14;
  const R2 = R * R;
  for (const f of world.food.values()) {
    if (Math.abs(f.x - w.x) > 60 || Math.abs(f.y - w.y) > 60) continue;
    if (dist2(f.x, f.y, w.x, w.y) < R2) {
      world.food.delete(f.id);
      gainMass(world, w, f.value);
      if (w.isMe) {
        Sfx.eat(w.mass);
        addFloater(world, f.x, f.y, '+' + f.value + '₽', f.golden ? '#ffd23d' : 'rgba(255,255,255,0.9)');
      }
    }
  }
}

function gainMass(world, w, amount) {
  w.mass += amount;
  w.runMoney += amount;
  w.eatFlash = 0.18;
}

/* ============ Смерть ============ */

/* Рассыпает ровно loot × LOOT_MULT золотыми шариками (сумма шариков = loot) */
function dropLoot(world, x, y, loot, spread) {
  loot = Math.max(0, Math.round(loot * (CFG.LOOT_MULT || 1)));
  if (loot <= 0) return 0;
  let cnt = clamp(Math.round(loot / 2), 6, 160);
  cnt = Math.min(cnt, loot);                // чтобы остаток не ушёл в минус
  const per = Math.max(1, Math.floor(loot / cnt));
  const sp = (spread || 60) * 1.6;          // шире веер — эффектнее взрыв
  const balls = spawnFoodNear(x, y, cnt - 1, per, true, sp);
  balls.push(makeFood(x + rand(-sp * 0.4, sp * 0.4), y + rand(-sp * 0.4, sp * 0.4), loot - per * (cnt - 1), '#ffd23d', true));
  for (const b of balls) addFood(world, b);
  return balls.length;
}

function killWorm(world, w, killerId) {
  if (!w.alive) return;
  w.alive = false;
  w.deadAt = world.time;
  // с червя падает ровно то, что написано на его плашке
  dropLoot(world, w.x, w.y, w.runMoney, Math.min(wormHeadR(w) * 3, 90));
  world.fx.push({ type: 'pop', x: w.x, y: w.y, r: wormHeadR(w), t: 0, dur: 0.5, color: w.skin.c1 });
  if (killerId && killerId !== w.id) {
    const k = world.worms.get(killerId);
    if (k) {
      if (k.isMe) { world.kills++; Sfx.kill(); addFloater(world, w.x, w.y, 'УБИЙСТВО!', '#ff5a5a'); }
    }
  }
  if (w.isMe) Sfx.die();
}

function addFloater(world, x, y, text, color) {
  world.floaters.push({ x, y, text, color, t: 0, dur: 0.95 });
}

/* ============ Столкновения ============ */

function checkCollisions(world) {
  const arr = [...world.worms.values()].filter(w => w.alive);
  for (const w of arr) {
    const hr = wormHeadR(w);
    // граница мира
    if (Math.hypot(w.x, w.y) > CFG.WORLD_R - hr * 0.4) {
      killWorm(world, w, null);
      continue;
    }
    const seeR = hr + 30;
    for (const o of arr) {
      if (o.id === w.id) continue;
      const or = wormHeadR(o);
      // грубая отсечка
      if (Math.abs(o.x - w.x) > 400 || Math.abs(o.y - w.y) > 400) continue;
      const pts = o.pts;
      // пропускаем первые сегменты, чтобы головы могли пересекаться
      const skip = Math.max(2, Math.floor(pts.length * 0.06));
      for (let i = skip; i < pts.length; i++) {
        const p = pts[i];
        if (Math.abs(p.x - w.x) > seeR + 6 || Math.abs(p.y - w.y) > seeR + 6) continue;
        const rr = (massToRadius(o.mass) + hr * 0.82);
        if (dist2(p.x, p.y, w.x, w.y) < rr * rr) {
          killWorm(world, w, o.id);
          break;
        }
      }
      if (!w.alive) break;
    }
  }
}

/* ============ Дефолтный ввод игрока ============ */

const Input = {
  sx: 0, sy: 0,   // курсор в экранных координатах
  has: false,
  boost: false,
};

function updateMyWorm(world, dt) {
  const me = world.me;
  if (!me || !me.alive) return;
  if (Input.has) {
    // руль как в slither.io: направление от центра экрана к курсору.
    // Мышка лежит на месте → вектор не меняется → червяк едет прямо, без самокручения.
    const dx = Input.sx - window.innerWidth / 2;
    const dy = Input.sy - window.innerHeight / 2;
    if (dx * dx + dy * dy > 400) { // мёртвая зона 20px — без дрожи у центра
      me.wantDir = Math.atan2(dy, dx);
    }
  }
  me.boosting = Input.boost && me.mass > CFG.BOOST_MIN_MASS;
}

/* ============ Эффекты и частицы ============ */

function updateEffects(world, dt) {
  for (let i = world.fx.length - 1; i >= 0; i--) {
    const e = world.fx[i];
    e.t += dt;
    if (e.t >= e.dur) world.fx.splice(i, 1);
  }
  for (let i = world.floaters.length - 1; i >= 0; i--) {
    const f = world.floaters[i];
    f.t += dt;
    f.y -= dt * 34;
    if (f.t >= f.dur) world.floaters.splice(i, 1);
  }
}

/* ============ Камера ============ */

const Cam = {
  x: 0, y: 0, zoom: 1, targetZoom: 1,
  update(world, dt, vw, vh) {
    const me = world.me;
    if (me && me.alive) {
      this.x = lerp(this.x, me.x, Math.min(1, dt * 8));
      this.y = lerp(this.y, me.y, Math.min(1, dt * 8));
      const z = clamp(1.25 - Math.sqrt(me.mass) / 90, 0.42, 1.25);
      this.targetZoom = z;
    }
    this.zoom = lerp(this.zoom, this.targetZoom, Math.min(1, dt * 2.2));
    this.vw = vw; this.vh = vh;
  },
  toScreen(x, y) {
    return {
      x: (x - this.x) * this.zoom + this.vw / 2,
      y: (y - this.y) * this.zoom + this.vh / 2,
    };
  },
  toWorld(sx, sy) {
    return {
      x: (sx - this.vw / 2) / this.zoom + this.x,
      y: (sy - this.vh / 2) / this.zoom + this.y,
    };
  },
};

/* ============ Рендер ============ */

function drawWorld(ctx, world, w, h) {
  // фон
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(Cam.zoom, Cam.zoom);
  ctx.translate(-Cam.x, -Cam.y);

  const viewR = Math.hypot(w, h) / 2 / Cam.zoom + 80;
  const cx = Cam.x, cy = Cam.y;

  // арена
  ctx.beginPath();
  ctx.arc(0, 0, CFG.WORLD_R, 0, TAU);
  ctx.fillStyle = '#0b1020';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(255,60,80,0.85)';
  ctx.stroke();
  ctx.lineWidth = 40;
  ctx.strokeStyle = 'rgba(255,60,80,0.12)';
  ctx.stroke();

  // сетка
  ctx.lineWidth = 1 / Cam.zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  const gs = 130;
  const x0 = Math.floor((cx - viewR) / gs) * gs;
  const x1 = cx + viewR, y0 = Math.floor((cy - viewR) / gs) * gs, y1 = cy + viewR;
  ctx.beginPath();
  for (let gx = x0; gx < x1; gx += gs) { ctx.moveTo(gx, cy - viewR); ctx.lineTo(gx, cy + viewR); }
  for (let gy = y0; gy < y1; gy += gs) { ctx.moveTo(cx - viewR, gy); ctx.lineTo(cx + viewR, gy); }
  ctx.stroke();

  // еда
  const t = performance.now() / 1000;
  for (const f of world.food.values()) {
    if (Math.abs(f.x - cx) > viewR + 20 || Math.abs(f.y - cy) > viewR + 20) continue;
    const wob = Math.sin(t * 3 + f.wobble) * 0.8;
    ctx.beginPath();
    ctx.arc(f.x, f.y + wob, f.r, 0, TAU);
    if (f.golden) {
      ctx.shadowColor = 'rgba(255,210,61,0.8)';
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // черви: сначала чужие, потом я (поверх)
  const worms = [...world.worms.values()].filter(wm => wm.alive &&
    Math.abs(wm.x - cx) < viewR + 600 && Math.abs(wm.y - cy) < viewR + 600);
  worms.sort((a, b) => (a.isMe ? 1 : 0) - (b.isMe ? 1 : 0));
  for (const wm of worms) drawWorm(ctx, wm, t);

  // эффекты
  for (const e of world.fx) {
    const k = e.t / e.dur;
    if (e.type === 'pop') {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1 + k * 1.8), 0, TAU);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();

  // плашки с никами и ₽ — в экранных координатах, поверх мира
  for (const wm of worms) drawWormLabel(ctx, wm);

  // всплывающие "+2₽" в экранных координатах
  for (const f of world.floaters) {
    const s = Cam.toScreen(f.x, f.y);
    ctx.globalAlpha = clamp(1 - f.t / f.dur, 0, 1);
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = f.color || '#fff';
    ctx.fillText(f.text, s.x, s.y);
    ctx.globalAlpha = 1;
  }
}

function drawWorm(ctx, w, t) {
  const r = massToRadius(w.mass);
  const pts = w.pts;

  // строим сглаженный путь
  const path = new Path2D();
  if (pts.length) {
    path.moveTo(w.x, w.y);
    for (let i = 0; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // свечение
  if (w.skin.glow) {
    ctx.save();
    ctx.shadowColor = w.skin.glow;
    ctx.shadowBlur = 22;
    ctx.lineWidth = r * 2.3;
    ctx.strokeStyle = w.skin.c1;
    ctx.stroke(path);
    ctx.restore();
  }

  // тело: основной цвет
  ctx.lineWidth = r * 2;
  ctx.strokeStyle = w.skin.c1;
  ctx.stroke(path);

  // узор
  if (w.skin.pattern === 'dash') {
    ctx.save();
    ctx.lineWidth = r * 1.25;
    ctx.strokeStyle = w.skin.c2;
    ctx.setLineDash([r * 1.4, r * 1.6]);
    ctx.stroke(path);
    ctx.restore();
  } else if (w.skin.pattern === 'seg') {
    for (let i = 2; i < pts.length; i += 2) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, r * 0.55, 0, TAU);
      ctx.fillStyle = `hsl(${(i * 23 + t * 40) % 360},85%,62%)`;
      ctx.fill();
    }
  }

  // контур при ускорении
  if (w.boosting) {
    ctx.save();
    ctx.lineWidth = r * 2.35;
    ctx.strokeStyle = 'rgba(120,190,255,0.35)';
    ctx.setLineDash([10, 14]);
    ctx.lineDashOffset = -t * 90;
    ctx.stroke(path);
    ctx.restore();
  }

  // голова
  const hr = wormHeadR(w);
  ctx.beginPath();
  ctx.arc(w.x, w.y, hr, 0, TAU);
  ctx.fillStyle = w.eatFlash > 0 ? '#fff' : w.skin.c1;
  ctx.fill();
  if (w.eatFlash > 0) w.eatFlash -= 0.016;

  // глаза смотрят по направлению
  const er = hr * 0.34;
  for (const s of [-1, 1]) {
    const ex = w.x + Math.cos(w.dir) * hr * 0.42 + Math.cos(w.dir + Math.PI / 2) * s * hr * 0.5;
    const ey = w.y + Math.sin(w.dir) * hr * 0.42 + Math.sin(w.dir + Math.PI / 2) * s * hr * 0.5;
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, TAU);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + Math.cos(w.dir) * er * 0.45, ey + Math.sin(w.dir) * er * 0.45, er * 0.5, 0, TAU);
    ctx.fillStyle = '#101020';
    ctx.fill();
  }
}

function drawWormLabel(ctx, w) {
  const hr = wormHeadR(w);
  const s = Cam.toScreen(w.x, w.y);
  const labelR = hr * Cam.zoom;
  const ly = s.y - labelR - 30;

  ctx.font = `${w.isMe ? 800 : 600} 13px system-ui, sans-serif`;
  ctx.textAlign = 'center';

  const money = Math.round(w.runMoney) + '₽';
  const name = w.name;

  // плашка ₽ (золотая капсула)
  const mw = ctx.measureText(money).width + 18;
  ctx.beginPath();
  roundRect(ctx, s.x - mw / 2, ly - 1, mw, 19, 9.5);
  ctx.fillStyle = w.isMe ? 'rgba(255,210,61,0.95)' : 'rgba(20,24,40,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = w.isMe ? '#241500' : '#ffd23d';
  ctx.fillText(money, s.x, ly + 13);

  // ник над плашкой
  ctx.font = `${w.isMe ? 800 : 600} 13px system-ui, sans-serif`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(name, s.x, ly - 7);
  ctx.fillStyle = w.isMe ? '#7df09a' : 'rgba(255,255,255,0.92)';
  ctx.fillText(name, s.x, ly - 7);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============ Миникарта ============ */

function drawMinimap(mm, world) {
  const ctx = mm.getContext('2d');
  const S = mm.width;
  ctx.clearRect(0, 0, S, S);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 2, 0, TAU);
  ctx.fillStyle = 'rgba(10,14,26,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,60,80,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const k = (S / 2 - 4) / CFG.WORLD_R;
  for (const w of world.worms.values()) {
    if (!w.alive) continue;
    ctx.beginPath();
    ctx.arc(S / 2 + w.x * k, S / 2 + w.y * k, w.isMe ? 3.4 : 2.2, 0, TAU);
    ctx.fillStyle = w.isMe ? '#7df09a' : (w.isBot ? 'rgba(255,255,255,0.4)' : '#ff9d5a');
    ctx.fill();
  }
}

/* ============ Лидерборд ============ */

/* Сортируем по ₽ с плашки — то, что и показываем.
   Сортировка по массе врала: боты рождаются толстыми с 0₽,
   а буст жжёт массу, но не деньги — деньги и масса расходятся. */
function buildLeaderboard(world) {
  const arr = [...world.worms.values()].filter(w => w.alive);
  arr.sort((a, b) => b.runMoney - a.runMoney);
  return arr;
}
