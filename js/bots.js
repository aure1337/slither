'use strict';

/* ============ Боты (хищные: предсказание угроз, ловушки, кластеры еды) ============ */

const BOT_NAMES = ['Валера', 'Кабан', 'Шпрот', 'Тимоха', 'Зина', 'Гоша', 'Пельмень', 'Кекс', 'Люся', 'Борщ',
  'Дядя Фёдор', 'Хвост', 'Гриша', 'Иннокентий', 'Слива', 'Толя', 'Жмот', 'Крош', 'Батон', 'Фрося',
  'Ролик', 'Сеня', 'Укроп', 'Марго', 'Плюх', 'Зигмунд', 'Вафля', 'Егорка', 'Пятачок', 'Лысый'];

function spawnBot(world) {
  const p = randomSpawnPos();
  const w = makeWorm('bot_' + randId(6), pick(BOT_NAMES), pick(SKINS).id, p.x, p.y, true, false);
  w.mass = rand(40, 260);
  ensureWormAI(w);
  world.worms.set(w.id, w);
  return w;
}

function botCount(world) {
  let n = 0;
  for (const w of world.worms.values()) if (w.isBot) n++;
  return n;
}

function updateBots(world, dt) {
  for (const w of world.worms.values()) {
    if (!w.isBot || !w.alive) continue;
    botThink(world, w, dt);
    updateWorm(world, w, dt);
    eatFood(world, w);
  }
  // респавн ботов
  for (const [id, w] of world.worms) {
    if (w.isBot && !w.alive && world.time - w.deadAt > rand(1.5, 3.5)) {
      world.worms.delete(id);
      if (botCount(world) < (Game.wantBots || CFG.BOTS_SOLO)) spawnBot(world);
    }
  }
}

function ensureWormAI(w) {
  if (!w.ai) w.ai = {
    t: 0, goal: null, goalT: 0,
    aggro: 0.35 + Math.random() * 0.5,    // склонность к охоте
    skill: 0.45 + Math.random() * 0.55,   // ловкость: дальность охоты, точность буста
    flee: 0,                              // таймер паники
    wanderT: 0, wander: w.dir,
  };
}

/* Свободность направления: чем ближе чужие точки к лучу, тем хуже */
function laneScore(world, w, ang, dist, ignore) {
  const tx = w.x + Math.cos(ang) * dist;
  const ty = w.y + Math.sin(ang) * dist;
  let s = 10;
  for (const o of world.worms.values()) {
    if (o.id === w.id || !o.alive || o.id === ignore) continue;
    if (Math.abs(o.x - tx) > 420 || Math.abs(o.y - ty) > 420) continue;
    const or2 = massToRadius(o.mass);
    const skip = Math.max(2, Math.floor(o.pts.length * 0.08));
    const step = Math.max(2, Math.floor(or2 * 0.9 / 3));
    for (let i = skip; i < o.pts.length; i += step) {
      const p = o.pts[i];
      const d = dist2(p.x, p.y, tx, ty);
      const rr = or2 + 26;
      if (d < rr * rr) s -= (rr * rr - d) / 900;
    }
  }
  return s;
}

/* Умный мозг бота */
function botThink(world, w, dt) {
  ensureWormAI(w);
  const ai = w.ai;
  ai.t += dt;
  if (ai.flee > 0) ai.flee -= dt;

  const hr = wormHeadR(w);
  const spd = wormSpeed(w);

  /* 1) Угроза: прогноз точки головы через 0.3с и проверка встречных траекторий */
  const probe = spd * 0.3 + 10;
  const px = w.x + Math.cos(w.dir) * probe;
  const py = w.y + Math.sin(w.dir) * probe;
  let danger = null, dangerD = 1e9;
  for (const o of world.worms.values()) {
    if (o.id === w.id || !o.alive) continue;
    if (Math.abs(o.x - px) > 500 || Math.abs(o.y - py) > 500) continue;
    const or2 = massToRadius(o.mass);
    const skip = Math.max(2, Math.floor(o.pts.length * 0.06));
    const rr = (hr + or2 + 55) ** 2;
    for (let i = skip; i < o.pts.length; i += 2) {
      const p = o.pts[i];
      const d = dist2(p.x, p.y, px, py);
      if (d < dangerD && d < rr) {
        const ang = Math.atan2(p.y - w.y, p.x - w.x);
        if (Math.abs(angDiff(w.dir, ang)) < 1.8) { danger = p; dangerD = d; break; }
      }
    }
    if (danger) break;
  }

  if (danger) {
    ai.flee = 0.5 + Math.random() * 0.4;
    // 3 варианта побега + взвешенная оценка свободных «коридоров»
    const away = Math.atan2(py - danger.y, px - danger.x);
    const variants = [away, away + 0.55, away - 0.55, away + 1.15, away - 1.15];
    let bestA = away, bestS = -1e9;
    for (let i = 0; i < variants.length; i++) {
      const a = variants[i];
      const s = laneScore(world, w, a, 300, null) - i * 0.3;
      if (s > bestS) { bestS = s; bestA = a; }
    }
    w.wantDir = turnToward(w.wantDir, bestA, 14);
    const dd = Math.sqrt(dangerD);
    w.boosting = w.mass > 90 && dd < 190 && Math.random() < 0.35;
    return;
  }

  /* 2) Паника после недавнего испуга: не лезем к чужим телам */
  if (ai.flee > 0) {
    // держимся подальше: цель — самая чистая точка рядом
    let bestA = w.dir, bestS = -1e9;
    for (let k = 0; k < 5; k++) {
      const a = w.dir + rand(-1.6, 1.6);
      const s = laneScore(world, w, a, 240, null) + Math.random() * 2;
      if (s > bestS) { bestS = s; bestA = a; }
    }
    w.wantDir = turnToward(w.wantDir, bestA, 9);
    w.boosting = false;
    // границу уважаем даже в панике
    if (Math.hypot(w.x, w.y) > CFG.WORLD_R - 500) {
      w.wantDir = turnToward(w.wantDir, Math.atan2(-w.y, -w.x), 10);
    }
    return;
  }

  /* 3) Выбор цели */
  if (!ai.goal || ai.t > ai.goalT) {
    ai.t = 0;
    ai.goal = null;

    // охота: только если значительно крупнее, жертва близко, и есть «клешня» —
    // точка перехвата ПЕРЕД головой жертвы, которую мы достигнем раньше её
    if (Math.random() < ai.aggro && w.mass > 160) {
      let prey = null, pd = 1e9;
      const huntR = (ai.skill > 0.7 ? 850 : 560) ** 2;
      for (const o of world.worms.values()) {
        if (o.id === w.id || !o.alive) continue;
        if (o.isBot && o.mass > w.mass * 0.9) continue;   // боты не грызут ботов-соперников
        if (o.mass * 1.7 < w.mass) {
          const d = dist2(o.x, o.y, w.x, w.y);
          if (d < pd && d < huntR) { pd = d; prey = o; }
        }
      }
      if (prey) {
        const dd = Math.sqrt(pd);
        const preySpd = wormSpeed(prey);
        // точка встречи: время на пути жертвы до точки ≈ времени на нашем пути к ней
        let lead = dd * 0.5;
        for (let it = 0; it < 3; it++) {
          const tx = prey.x + Math.cos(prey.dir) * lead;
          const ty = prey.y + Math.sin(prey.dir) * lead;
          const ourT = Math.hypot(tx - w.x, ty - w.y) / spd;
          const preyT = lead / preySpd;
          lead = clamp(lead * (ourT > preyT ? 0.82 : 1.18), 60, 520);
        }
        const tx = prey.x + Math.cos(prey.dir) * lead;
        const ty = prey.y + Math.sin(prey.dir) * lead;
        if (Math.hypot(tx, ty) < CFG.WORLD_R - 420 && laneScore(world, w, Math.atan2(ty - w.y, tx - w.x), Math.min(300, Math.hypot(tx - w.x, ty - w.y)), prey.id) > -3) {
          ai.goal = { x: tx, y: ty, hunt: prey.id };
          ai.goalT = 0.5;
          w.boosting = w.mass > 240 && dd < 700 && Math.random() < 0.55 * ai.skill;
        }
      }
    }

    // еда: золото и плотные кластеры (ищем центр масс ближайших шариков)
    if (!ai.goal) {
      let best = null, bestScore = -1e9;
      const golden = [];
      for (const f of world.food.values()) {
        const d = Math.hypot(f.x - w.x, f.y - w.y);
        if (d > 950) continue;
        const score = (f.golden ? 5 : 1) * f.value / (d + 70);
        if (score > bestScore) { bestScore = score; best = f; }
        if (f.golden && d < 500) golden.push(f);
      }
      if (golden.length >= 3) {
        // центр кластера золота — вкуснее одиночного шарика
        let sx = 0, sy = 0, sv = 0;
        for (const f of golden) { sx += f.x * f.value; sy += f.y * f.value; sv += f.value; }
        const cx = sx / sv, cy = sy / sv;
        const d = Math.hypot(cx - w.x, cy - w.y);
        if (d < 700) { best = { x: cx, y: cy }; bestScore += 2; }
      }
      if (best) {
        ai.goal = { x: best.x, y: best.y };
        ai.goalT = best.golden ? 0.3 : rand(0.5, 1.0);
      } else {
        ai.goalT = 0.25;
      }
    }
  }

  if (ai.goal) {
    // живое обновление перехвата
    if (ai.goal.hunt) {
      const prey = world.worms.get(ai.goal.hunt);
      if (prey && prey.alive && w.mass > prey.mass * 1.6) {
        const d = Math.hypot(prey.x - w.x, prey.y - w.y);
        const lead = clamp(d * 0.5, 70, 480);
        ai.goal.x = prey.x + Math.cos(prey.dir) * lead;
        ai.goal.y = prey.y + Math.sin(prey.dir) * lead;
        if (w.mass > 240 && d < 650 && Math.random() < 0.1 * ai.skill + 0.05) w.boosting = true;
      } else {
        ai.goal = null;
      }
    }
    if (ai.goal) {
      const want = Math.atan2(ai.goal.y - w.y, ai.goal.x - w.x);
      w.wantDir = turnToward(w.wantDir, want, 20);
    }
  }

  if (!ai.goal) {
    // блуждание к центру с шумом
    ai.wanderT -= dt;
    if (ai.wanderT <= 0) { ai.wanderT = rand(0.7, 1.8); ai.wander = Math.atan2(-w.y, -w.x) + rand(-1, 1); }
    w.wantDir = ai.wander;
    w.boosting = w.mass > 400 && Math.random() < 0.008;
  }

  // граница: чем крупнее — тем раньше и жёстче разворот
  const dCenter = Math.hypot(w.x, w.y);
  if (dCenter > CFG.WORLD_R - (380 + hr * 3.5)) {
    const toC = Math.atan2(-w.y, -w.x);
    w.wantDir = turnToward(w.wantDir, toC, 9);
    w.boosting = false;
  }
}
