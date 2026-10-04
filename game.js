(() => {
  'use strict';

  const W = 360, H = 640, CX = W / 2, CY = H / 2, TAU = Math.PI * 2;
  const CHUNK = 220, RUN_LENGTH = 240;
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const $ = (s) => document.querySelector(s);
  const ui = {
    start: $('#start'), upgrade: $('#upgrade'), result: $('#result'), cards: $('#upgradeCards'),
    hearts: $('#hearts'), phase: $('#phase'), timer: $('#timer'), level: $('#level'), xp: $('#xpFill'),
    skills: $('#skillStrip'), erase: $('#eraseBtn'), eraseCd: $('#eraseCd'), sound: $('#soundBtn'), toast: $('#toast'), boss: $('#bossNotice')
  };

  const assetPaths = {
    player: 'assets/player/player-walk-v2.png', enemies: 'assets/enemies/enemy-atlas-v2.png', props: 'assets/props/prop-atlas-v2.png',
    ground: 'assets/ground/ground-wash-v1.png'
  };
  const imgs = {};
  Object.entries(assetPaths).forEach(([key, src]) => { const img = new Image(); img.src = src; imgs[key] = img; });

  const input = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, keys: new Set() };
  let state = 'title', last = 0, time = 0, kills = 0, nextId = 1, shake = 0, flash = 0;
  let player, enemies = [], projectiles = [], enemyBullets = [], drops = [], effects = [], bombs = [], hazards = [], worldEvents = [], chunks = new Map();
  let spawnClock = 0, bossSpawned = false, bossWarning = false, pendingUpgrades = 0, eventStep = 0, lastPhase = 0, hitStop = 0;
  let audioCtx = null, soundEnabled = true, musicGain = null, musicStep = 0, musicNextTime = 0;
  const records = loadRecords();

  const skillData = {
    sword: {
      name: 'Pencil Sword', icon: '✎',
      levels: ['Basic forward slash', 'Longer reach and heavier line', 'Double slash', 'Slash sends a pencil wave', 'Large circular finishing slash']
    },
    orbit: {
      name: 'Ink Orbit', icon: '●',
      levels: ['One orbiting ink orb', 'Two orbiting ink orbs', 'Three orbiting ink orbs', 'Orbs burst on contact', 'Five fast orbiting orbs']
    },
    plane: {
      name: 'Paper Plane', icon: '➤',
      levels: ['Automatic seeking plane', 'Faster launch rate', 'Planes pierce one doodle', 'Twin paper planes', 'Large homing glider volley']
    },
    eraser: {
      name: 'Eraser', icon: '▰',
      levels: ['Periodically clears bullets and hurts nearby foes', 'Wider erased area', 'Shorter cooldown', 'Leaves a damaging clean patch', 'Huge double erasure']
    },
    bomb: {
      name: 'Doodle Bomb', icon: '✹',
      levels: ['Draws a timed bomb nearby', 'Larger blast', 'Draws bombs more often', 'Drops two bombs', 'Chain-reaction ink burst']
    }
  };

  function reset() {
    player = {
      x: 0, y: 0, r: 13, hp: 5, maxHp: 5, speed: 145, inv: 0,
      xp: 0, xpNeed: 7, level: 1, skills: { sword: 0, orbit: 0, plane: 0, eraser: 0, bomb: 0 },
      swordCd: .15, planeCd: 0, eraserCd: 0, bombCd: 0, moveX: 0, moveY: 0, moving: false, walkTime: 0, might: 0
    };
    enemies = []; projectiles = []; enemyBullets = []; drops = []; effects = []; bombs = []; hazards = []; worldEvents = []; chunks = new Map();
    time = 0; kills = 0; nextId = 1; shake = 0; flash = 0; spawnClock = .4; bossSpawned = false; bossWarning = false; pendingUpgrades = 0; eventStep = 0; lastPhase = 0; hitStop = 0;
    initAudio(); musicStep = 0; musicNextTime = audioCtx ? audioCtx.currentTime : 0; sound('start'); state = 'starter'; hideOverlays(); ensureChunks(); updateHud(); showStarterChoice();
  }

  function showStarterChoice() {
    ui.upgrade.classList.remove('hidden'); ui.cards.innerHTML = '';
    $('#upgradeTitle').textContent = 'Choose your first doodle';
    ['sword','orbit','plane'].forEach((id) => {
      const data=skillData[id],button=document.createElement('button');
      button.innerHTML=`<span class="skill-icon">${data.icon}</span><strong>${data.name}</strong><em>STARTER</em><span>${data.levels[0]}</span>`;
      button.onclick=()=>chooseStarter(id);ui.cards.append(button);
    });
  }

  function chooseStarter(id) {
    player.skills[id]=1;markDiscovered(id);ui.upgrade.classList.add('hidden');$('#upgradeTitle').textContent='Choose one';
    state='play';updateHud();toast(`${skillData[id].name} · ready`);sound('reward');
  }

  function hideOverlays() { [ui.start, ui.upgrade, ui.result, ui.boss].forEach((el) => el.classList.add('hidden')); }

  function phaseInfo() {
    if (bossSpawned) return { label: 'THE FORGOTTEN ONE', rate: 1.3, batch: 2, cap: 50 };
    if (time < 60) return { label: 'QUIET MARGINS', rate: 1.38, batch: 1, cap: 18 };
    if (time < 120) return { label: 'RESTLESS NOTES', rate: .82, batch: 2, cap: 34 };
    if (time < 180) return { label: 'CROWDED PAGE', rate: .62, batch: 2, cap: 48 };
    return { label: 'INK STORM', rate: .43, batch: 3, cap: 62 };
  }

  function update(dt) {
    if (state !== 'play') return;
    if (hitStop > 0) { hitStop -= dt; updateEffects(dt * .2); return; }
    time += dt;
    player.inv = Math.max(0, player.inv - dt); player.might = Math.max(0, player.might - dt); shake = Math.max(0, shake - dt * 24); flash = Math.max(0, flash - dt * 2.6);
    updateMilestones();
    movePlayer(dt); ensureChunks(); updateSpawner(dt); updateSkills(dt); updateProjectiles(dt); updateEnemies(dt);
    updateEnemyBullets(dt); updateBombs(dt); updateHazards(dt); updateWorldEvents(dt); updateDrops(dt); updateEffects(dt); updateHud();
    if (!bossSpawned && time >= RUN_LENGTH) summonBoss();
  }

  function updateMilestones() {
    const phase = Math.min(3, Math.floor(time / 60));
    if (phase > lastPhase) {
      lastPhase = phase; const names = ['','RESTLESS NOTES','CROWDED PAGE','INK STORM'];
      const notes = ['','new doodles enter the margins','elites stain the paper','survive the final minute'];
      showNotice(names[phase], notes[phase]); sound('phase'); flash = .45;
    }
    const eventTimes = [48,108,168];
    if (eventStep < eventTimes.length && time >= eventTimes[eventStep]) { spawnWorldEvent(eventStep); eventStep++; }
    if (!bossWarning && time >= 228) { bossWarning = true; showNotice('THE PAGE IS TEARING','something enormous is approaching'); sound('warning'); shake = 14; }
  }

  function movePlayer(dt) {
    const oldX = player.x, oldY = player.y;
    let dx = 0, dy = 0;
    if (input.keys.has('left')) dx--; if (input.keys.has('right')) dx++;
    if (input.keys.has('up')) dy--; if (input.keys.has('down')) dy++;
    if (input.active) {
      dx = input.x - input.ox; dy = input.y - input.oy;
      const len = Math.hypot(dx, dy); if (len < 7) dx = dy = 0; else { dx /= Math.max(30, len); dy /= Math.max(30, len); }
    }
    const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
    player.x += dx * player.speed * dt; player.y += dy * player.speed * dt;
    player.moveX = dx; player.moveY = dy; player.moving = len > .15;
    if (player.moving) player.walkTime += dt * 9;
    resolvePropCollision(player, oldX, oldY);
    if (len > .15 && Math.random() < dt * 8) effects.push({ type: 'dust', x: player.x - dx * 10, y: player.y + 13, life: .35, max: .35 });
  }

  function updateSpawner(dt) {
    if (bossSpawned && enemies.some((e) => e.type === 'boss')) return;
    const phase = phaseInfo(); spawnClock -= dt;
    if (spawnClock > 0 || enemies.length >= phase.cap) return;
    spawnClock = phase.rate * (.82 + Math.random() * .36);
    for (let i = 0; i < phase.batch && enemies.length < phase.cap; i++) spawnEnemy(pickEnemyType(), time > 120 && Math.random() < Math.min(.19, (time - 115) / 500));
  }

  function pickEnemyType() {
    const r = Math.random();
    if (time < 60) return r < .8 ? 'slime' : 'bat';
    if (time < 120) return r < .5 ? 'slime' : r < .77 ? 'bat' : 'skeleton';
    return r < .34 ? 'slime' : r < .64 ? 'bat' : 'skeleton';
  }

  function edgePosition(distance = 300) {
    const a = Math.random() * TAU, d = distance + Math.random() * 85;
    return { x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d };
  }

  function spawnEnemy(type, elite = false, at = null) {
    const pos = at || edgePosition();
    const base = type === 'slime' ? 28 : type === 'bat' ? 22 : 35;
    const scale = 1 + Math.min(.85, time / 330), hp = base * scale * (elite ? 3.4 : 1);
    enemies.push({
      id: nextId++, type, x: pos.x, y: pos.y, r: elite ? 20 : (type === 'skeleton' ? 15 : 13), hp, maxHp: hp,
      speed: (type === 'slime' ? 36 : type === 'bat' ? 46 : 32) * (elite ? 1.12 : 1),
      elite, cd: .7 + Math.random(), phase: Math.random() * TAU, wind: 0, dash: 0, hit: 0, orbitHit: 0
    });
  }

  function spawnWorldEvent(step) {
    const types = ['cache','shrine','bloom'], angle = player.moving ? Math.atan2(player.moveY,player.moveX) : Math.random()*TAU;
    const event = { id:nextId++, type:types[step], x:player.x+Math.cos(angle)*225, y:player.y+Math.sin(angle)*225, life:38, maxLife:38, progress:0, need:step===1?2:1.35 };
    worldEvents.push(event);
    if (step) spawnEnemy(step===1?'skeleton':'bat',true,{x:event.x+55,y:event.y-40});
    const names = ['A LOST CACHE','A MARGIN SHRINE','A BRIGHT BLOOM'];
    showNotice(names[step],'follow the sketched marker'); sound('event');
  }

  function updateWorldEvents(dt) {
    for (let i=worldEvents.length-1;i>=0;i--) {
      const e=worldEvents[i]; e.life-=dt; const near=dist(e,player)<48;
      e.progress=Math.max(0,Math.min(e.need,e.progress+(near?dt:-dt*.45)));
      if (e.progress>=e.need) {
        if(e.type==='cache'){gainXp(4);toast('Cache opened · bonus EXP');}
        else if(e.type==='shrine'){player.hp=Math.min(player.maxHp,player.hp+2);player.eraserCd=Math.min(player.eraserCd,1);toast('Margin restored · +2 hearts');}
        else{player.might=25;gainXp(4);toast('Bright ink · damage boosted');}
        for(let n=0;n<10;n++)spawnScrap(e.x,e.y,e.type==='bloom'?'#e5c875':'#eee3c3');
        sound('reward'); worldEvents.splice(i,1); continue;
      }
      if(e.life<=0) worldEvents.splice(i,1);
    }
  }

  function summonBoss() {
    bossSpawned = true; enemyBullets.length = 0;
    const p = edgePosition(275);
    enemies.push({ id: nextId++, type: 'boss', x: p.x, y: p.y, r: 40, hp: 1050, maxHp: 1050, speed: 26, cd: 1, phase: 0, hit: 0, bossPhase: 1, poolCd:1.8 });
    showNotice('THE FORGOTTEN ONE','has found your page'); sound('boss'); shake = 18;
  }

  function nearest(max = Infinity) {
    let best = null, bestD = max * max;
    for (const e of enemies) { const d = sqDist(player, e); if (!e.dead && d < bestD) { best = e; bestD = d; } }
    return best;
  }

  function updateSkills(dt) {
    player.swordCd -= dt;
    if (player.swordCd <= 0 && enemies.length) pencilSlash();

    const planeLv = player.skills.plane;
    if (planeLv) {
      player.planeCd -= dt;
      if (player.planeCd <= 0 && enemies.length) { launchPlanes(planeLv); player.planeCd = Math.max(.38, 1.18 - planeLv * .13); }
    }

    const eraserLv = player.skills.eraser;
    if (eraserLv) {
      player.eraserCd -= dt;
      if (player.eraserCd <= 0) useEraser(false);
    }

    const bombLv = player.skills.bomb;
    if (bombLv) {
      player.bombCd -= dt;
      if (player.bombCd <= 0) { placeBombs(bombLv); player.bombCd = Math.max(2.5, 6.2 - bombLv * .65); }
    }

    updateOrbit(dt);
  }

  function pencilSlash() {
    const lv = player.skills.sword, target = nearest(170); player.swordCd = Math.max(.42, .78 - lv * .045);
    if (!target) return;
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    const reach = 78 + (lv >= 2 ? 25 : 0) + (lv === 5 ? 12 : 0), damage = 33 + lv * 8;
    slashHit(angle, reach, damage, lv === 5 ? TAU : 1.75);
    effects.push({ type: lv === 5 ? 'circleSlash' : 'slash', x: player.x, y: player.y, angle, r: reach, life: .22, max: .22, level: lv });
    sound('slash');
    if (lv >= 3) effects.push({ type: 'delayedSlash', x: player.x, y: player.y, angle: angle + .28, r: reach, damage: damage * .72, life: .1, max: .1, fired: false, level: lv });
    if (lv >= 4) projectiles.push({ type: 'wave', x: player.x, y: player.y, vx: Math.cos(angle) * 245, vy: Math.sin(angle) * 245, r: 13 + lv * 2, damage: 18 + lv * 5, life: 1.15, pierce: 4 + lv, hit: new Set() });
  }

  function slashHit(angle, reach, damage, arc) {
    for (const e of enemies) {
      const dx = e.x - player.x, dy = e.y - player.y, d = Math.hypot(dx, dy);
      let diff = Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle));
      if (d < reach + e.r && (arc >= TAU || Math.abs(diff) < arc / 2)) damageEnemy(e, damage);
    }
  }

  function launchPlanes(lv) {
    const target = nearest(); if (!target) return;
    const count = lv >= 4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(target.y - player.y, target.x - player.x) + (i - (count - 1) / 2) * .22;
      projectiles.push({ type: 'plane', x: player.x, y: player.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, r: lv === 5 ? 13 : 8, damage: 15 + lv * 5, life: 2.2, pierce: lv >= 3 ? 1 + (lv === 5 ? 2 : 0) : 0, hit: new Set(), homing: lv === 5 ? 3.1 : 1.25 });
    }
  }

  function updateOrbit() {
    const lv = player.skills.orbit; if (!lv) return;
    const count = lv === 1 ? 1 : lv === 2 ? 2 : lv === 3 || lv === 4 ? 3 : 5;
    const speed = lv === 5 ? 3.65 : 2.25, radius = 43 + lv * 2;
    for (let i = 0; i < count; i++) {
      const a = time * speed + i * TAU / count, orb = { x: player.x + Math.cos(a) * radius, y: player.y + Math.sin(a) * radius };
      for (const e of enemies) if (dist(orb, e) < e.r + 7 && time - e.orbitHit > .3) {
        e.orbitHit = time; damageEnemy(e, 8 + lv * 3);
        if (lv >= 4) areaDamage(orb.x, orb.y, 31 + lv * 3, 8 + lv * 2, e.id);
      }
    }
  }

  function useEraser(manual) {
    const lv = player.skills.eraser;
    if (!lv || (manual && player.eraserCd > 0) || state !== 'play') return;
    const radius = 78 + lv * 13, damage = 18 + lv * 8;
    enemyBullets = enemyBullets.filter((b) => dist(b, player) > radius);
    hazards = hazards.filter((h)=>dist(h,player)>radius);
    for (const b of bombs) if (dist(b,player)<radius) { b.life=0; b.r*=1.22; b.damage*=1.18; }
    areaDamage(player.x, player.y, radius, damage);
    effects.push({ type: 'erase', x: player.x, y: player.y, r: radius, life: .48, max: .48, level: lv });
    if (lv >= 4) effects.push({ type: 'cleanPatch', x: player.x, y: player.y, r: radius * .68, life: 4.5, max: 4.5, tick: 0 });
    if (lv === 5) effects.push({ type: 'delayedErase', x: player.x, y: player.y, r: radius * 1.18, life: .35, max: .35, fired: false });
    player.eraserCd = Math.max(3.4, 8.5 - lv * .85); shake = 8; sound('erase'); toast('A clean patch!');
  }

  function placeBombs(lv) {
    const target = nearest(230), count = lv >= 4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, d = 35 + Math.random() * 75;
      bombs.push({ x: target ? target.x + Math.cos(a) * 20 : player.x + Math.cos(a) * d, y: target ? target.y + Math.sin(a) * 20 : player.y + Math.sin(a) * d, r: 48 + lv * 9, damage: 28 + lv * 12, life: 1.45, max: 1.45, level: lv });
    }
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]; p.life -= dt;
      if (p.type === 'plane' && p.homing) {
        const target = nearestFrom(p); if (target) {
          const speed = Math.hypot(p.vx, p.vy), desired = Math.atan2(target.y - p.y, target.x - p.x), current = Math.atan2(p.vy, p.vx);
          const turn = Math.atan2(Math.sin(desired - current), Math.cos(desired - current)) * Math.min(1, p.homing * dt);
          p.vx = Math.cos(current + turn) * speed; p.vy = Math.sin(current + turn) * speed;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if(p.type==='wave')for(const b of bombs)if(dist(p,b)<p.r+13){b.life=0;b.r*=1.18;b.damage*=1.15;p.life=0;}
      for (const e of enemies) if (!p.hit.has(e.id) && dist(p, e) < p.r + e.r) {
        p.hit.add(e.id); damageEnemy(e, p.damage); p.pierce--; if (p.pierce < 0) p.life = 0;
      }
      if (p.life <= 0 || dist(p, player) > 680) projectiles.splice(i, 1);
    }
  }

  function nearestFrom(p) {
    let best = null, d = Infinity;
    for (const e of enemies) { const nd = sqDist(p, e); if (!e.dead && nd < d) { d = nd; best = e; } }
    return best;
  }

  function updateEnemies(dt) {
    for (const e of [...enemies]) {
      const oldX = e.x, oldY = e.y;
      e.hit = Math.max(0, e.hit - dt); e.phase += dt; e.cd -= dt;
      const dx = player.x - e.x, dy = player.y - e.y, d = Math.max(1, Math.hypot(dx, dy)), nx = dx / d, ny = dy / d;
      if (e.type === 'slime') { e.x += nx * e.speed * dt; e.y += ny * e.speed * dt; }
      else if (e.type === 'bat') updateBat(e, dt, nx, ny);
      else if (e.type === 'skeleton') updateSkeleton(e, dt, nx, ny, d);
      else updateBoss(e, dt, nx, ny);
      resolvePropCollision(e, oldX, oldY);
      if (dist(e, player) < e.r + player.r) hurt(e.elite || e.type === 'boss' ? 2 : 1, e.x, e.y);
    }
  }

  function updateBat(e, dt, nx, ny) {
    if (e.wind > 0) { e.wind -= dt; if (e.wind <= 0) { e.dash = .3; e.dvx = nx * 245; e.dvy = ny * 245; } }
    else if (e.dash > 0) { e.x += e.dvx * dt; e.y += e.dvy * dt; e.dash -= dt; }
    else { e.x += nx * e.speed * .55 * dt; e.y += ny * e.speed * .55 * dt; if (e.cd <= 0) { e.wind = .42; e.cd = 2.1; } }
  }

  function updateSkeleton(e, dt, nx, ny, d) {
    const dir = d < 150 ? -1 : d > 220 ? 1 : 0;
    e.x += nx * e.speed * dir * dt; e.y += ny * e.speed * dir * dt;
    if (e.cd <= 0 && d < 360) { enemyShot(e, Math.atan2(ny, nx), e.elite ? 132 : 105); e.cd = e.elite ? .72 : 1.55; }
  }

  function updateBoss(e, dt, nx, ny) {
    e.bossPhase = e.hp / e.maxHp > .65 ? 1 : e.hp / e.maxHp > .32 ? 2 : 3;
    e.x += nx * e.speed * .35 * dt + Math.sin(e.phase * 1.2) * 18 * dt;
    e.y += ny * e.speed * .35 * dt + Math.cos(e.phase * .9) * 12 * dt;
    e.poolCd-=dt;
    if(e.poolCd<=0){hazards.push({x:e.x,y:e.y,r:24+e.bossPhase*4,life:6,max:6,tick:0});e.poolCd=2.6-e.bossPhase*.3;}
    breakNearbyProps(e);
    if (e.cd <= 0) {
      const count = 7 + e.bossPhase * 3;
      for (let i = 0; i < count; i++) enemyShot(e, i * TAU / count + e.phase * .25, 82 + e.bossPhase * 17);
      if (e.bossPhase >= 2) for (let i = 0; i < e.bossPhase - 1; i++) spawnEnemy(i ? 'bat' : 'slime', false, { x: e.x + (Math.random() - .5) * 70, y: e.y + (Math.random() - .5) * 70 });
      e.cd = 1.55 - e.bossPhase * .17; shake = 4;
    }
  }

  function breakNearbyProps(boss) {
    for(const chunk of chunks.values())for(let i=chunk.props.length-1;i>=0;i--){
      const p=chunk.props[i];if(!p.solid||dist(p,boss)>boss.r+p.solid+3)continue;
      for(let n=0;n<5;n++)spawnScrap(p.x,p.y,p.kind==='tree'||p.kind==='crate'?'#8d7155':'#aaa393');
      chunk.props.splice(i,1);shake=Math.max(shake,5);sound('break');
    }
  }

  function enemyShot(e, angle, speed) {
    enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: e.type === 'boss' ? 7 : 5, life: 5.5 });
  }

  function updateEnemyBullets(dt) {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (dist(b, player) < b.r + player.r) { hurt(1, b.x, b.y); b.life = 0; }
      if (b.life <= 0 || dist(b, player) > 520) enemyBullets.splice(i, 1);
    }
  }

  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i]; b.life -= dt;
      if (b.life <= 0) {
        areaDamage(b.x, b.y, b.r, b.damage); effects.push({ type: 'explosion', x: b.x, y: b.y, r: b.r, life: .42, max: .42 });
        if (b.level === 5) for (let n = 0; n < 6; n++) { const a = n * TAU / 6; projectiles.push({ type: 'ink', x: b.x, y: b.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, r: 7, damage: 26, life: .8, pierce: 1, hit: new Set() }); }
        bombs.splice(i, 1); shake = 8; sound('bomb');
      }
    }
  }

  function updateHazards(dt){
    for(let i=hazards.length-1;i>=0;i--){const h=hazards[i];h.life-=dt;h.tick-=dt;if(dist(h,player)<h.r&&h.tick<=0){hurt(1,h.x,h.y);h.tick=.8;}if(h.life<=0)hazards.splice(i,1);}
  }

  function damageEnemy(e, amount) {
    if (!e || e.dead) return;
    amount*=player.might>0?1.28:1;e.hp -= amount; e.hit = .12;
    const dx=e.x-player.x,dy=e.y-player.y,d=Math.hypot(dx,dy)||1;e.x+=dx/d*3;e.y+=dy/d*3;
    if(e.elite||e.type==='boss')hitStop=Math.max(hitStop,.022);
    effects.push({ type: 'speck', x: e.x, y: e.y, life: .3, max: .3, seed: Math.random() });
    if (e.hp > 0) return;
    e.dead = true; kills++; hitStop=Math.max(hitStop,e.elite ? .07 : .038);
    const value = e.type === 'boss' ? 0 : e.elite ? 5 : 1;
    for (let i = 0; i < value; i++) drops.push({ x: e.x + (Math.random() - .5) * 18, y: e.y + (Math.random() - .5) * 18, r: e.elite ? 6 : 5, value: 1 });
    enemies = enemies.filter((x) => x !== e); effects.push({ type: 'poof', x: e.x, y: e.y, life: .5, max: .5 });
    for(let n=0;n<(e.elite?10:5);n++)spawnScrap(e.x,e.y,n%2?'#eee2c3':'#403b42');
    sound(e.type==='boss'?'victory':'kill');if (e.type === 'boss') end(true); else shake = e.elite ? 7 : 3;
  }

  function areaDamage(x, y, radius, damage, skipId = null) {
    for (const e of [...enemies]) if (e.id !== skipId && Math.hypot(e.x - x, e.y - y) < radius + e.r) damageEnemy(e, damage);
  }

  function hurt(amount, x, y) {
    if (player.inv > 0 || state !== 'play') return;
    player.hp -= amount; player.inv = 1.2; flash = 1; shake = 12;
    effects.push({ type: 'hurt', x, y, life: .45, max: .45 });
    sound('hurt');
    if (player.hp <= 0) end(false);
  }

  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i], dx = player.x - d.x, dy = player.y - d.y, len = Math.hypot(dx, dy);
      if (len < 105) { const pull = len < 46 ? 420 : 170; d.x += dx / (len || 1) * pull * dt; d.y += dy / (len || 1) * pull * dt; }
      if (len < 18) { gainXp(d.value); drops.splice(i, 1); }
    }
  }

  function gainXp(value) {
    player.xp += value;
    if (player.xp < player.xpNeed) return;
    player.xp -= player.xpNeed; player.level++; player.xpNeed = Math.round(6 + player.level * 2.15); player.hp = Math.min(player.maxHp, player.hp + 1); pendingUpgrades++;sound('level');
    showUpgrade();
  }

  function showUpgrade() {
    if (!pendingUpgrades || state === 'end') return;
    state = 'upgrade'; ui.upgrade.classList.remove('hidden'); ui.cards.innerHTML = ''; $('#upgradeTitle').textContent = 'Choose one';
    const pool = Object.keys(skillData).filter((id) => player.skills[id] < 5);
    shuffle(pool).slice(0, 3).forEach((id) => {
      const data = skillData[id], next = player.skills[id] + 1, button = document.createElement('button');
      button.innerHTML = `<span class="skill-icon">${data.icon}</span><strong>${data.name}</strong><em>LV ${next}</em><span>${data.levels[next - 1]}</span>`;
      button.onclick = () => chooseUpgrade(id); ui.cards.append(button);
    });
  }

  function chooseUpgrade(id) {
    player.skills[id]++; markDiscovered(id); pendingUpgrades--; ui.upgrade.classList.add('hidden');
    if (id === 'eraser') player.eraserCd = .15; if (id === 'bomb') player.bombCd = .4;
    if(player.skills[id]===5){showNotice(`${skillData[id].name.toUpperCase()} MASTERED`,'the drawing has reached its final form');sound('master');flash=.7;}
    else toast(`${skillData[id].name} · LV ${player.skills[id]}`); updateHud();
    if (pendingUpgrades) showUpgrade(); else state = 'play';
  }

  function spawnScrap(x,y,color){const a=Math.random()*TAU,s=25+Math.random()*70;effects.push({type:'scrap',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-18,rot:Math.random()*TAU,vr:(Math.random()-.5)*8,size:2+Math.random()*4,color,life:.45+Math.random()*.3,max:.75});}

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]; e.life -= dt;
      if(e.type==='scrap'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.vy+=55*dt;e.rot+=e.vr*dt;}
      if (e.type === 'delayedSlash' && !e.fired && e.life <= 0) { e.fired = true; slashHit(e.angle, e.r, e.damage, 1.65); effects.push({ type: 'slash', x: player.x, y: player.y, angle: e.angle, r: e.r, life: .2, max: .2, level: e.level }); }
      if (e.type === 'delayedErase' && !e.fired && e.life <= 0) { e.fired = true; areaDamage(player.x, player.y, e.r, 45); enemyBullets.length = 0; effects.push({ type: 'erase', x: player.x, y: player.y, r: e.r, life: .45, max: .45, level: 5 }); }
      if (e.type === 'cleanPatch') { e.tick -= dt; if (e.tick <= 0) { areaDamage(e.x, e.y, e.r, 6); e.tick = .35; } }
      if (e.life <= 0) effects.splice(i, 1);
    }
  }

  function updateHud() {
    if (!player) return;
    ui.hearts.textContent = '♥'.repeat(Math.max(0, player.hp)) + '♡'.repeat(Math.max(0, player.maxHp - player.hp));
    ui.phase.textContent = phaseInfo().label; ui.timer.textContent = formatTime(time); ui.level.textContent = `LV ${player.level}`;
    ui.xp.style.width = `${Math.min(100, player.xp / player.xpNeed * 100)}%`;
    ui.skills.innerHTML = Object.entries(player.skills).filter(([, lv]) => lv).map(([id, lv], i) => `<span class="skill-pill" style="--tilt:${i % 2 ? 1 : -1}deg">${skillData[id].icon} ${lv}</span>`).join('')+(player.might>0?`<span class="skill-pill" style="--tilt:1deg">✦ ${Math.ceil(player.might)}</span>`:'');
    const lv = player.skills.eraser; ui.erase.classList.toggle('locked', !lv); ui.erase.classList.toggle('cooling', lv && player.eraserCd > 0);
    ui.eraseCd.textContent = !lv ? 'LOCKED' : player.eraserCd > 0 ? `${player.eraserCd.toFixed(1)}s` : 'READY';
  }

  function end(win) {
    state = 'end'; ui.result.classList.remove('hidden'); ui.boss.classList.add('hidden');
    $('#resultStamp').textContent = win ? 'PAGE SAVED' : 'RUN OVER';
    $('#resultTitle').textContent = win ? 'The final line lands!' : 'The ink caught up';
    $('#resultText').textContent = win ? 'The Forgotten One fades into a harmless margin note.' : 'Your next sketch can build a stronger set of doodles.';
    const strongest=Object.entries(player.skills).sort((a,b)=>b[1]-a[1])[0],mastered=Object.values(player.skills).filter(v=>v===5).length;
    $('#buildTitle').textContent=`Build: ${skillData[strongest[0]].name} LV ${strongest[1]}${mastered?` · ${mastered} mastered`:''}`;
    const newBest=saveRunRecord(win);$('#recordNote').textContent=newBest?'NEW PERSONAL BEST ✦':`Best ${formatTime(records.bestTime)} · LV ${records.bestLevel}`;
    $('#timeDone').textContent = formatTime(time); $('#killsDone').textContent = kills;
  }

  function loadRecords(){
    const fallback={bestTime:0,bestLevel:0,bossWins:0,runs:0,discovered:[]};
    try{const saved=JSON.parse(localStorage.getItem('doodle-survivor-records-v1'));return{...fallback,...saved,discovered:Array.isArray(saved?.discovered)?saved.discovered:[]};}catch{return fallback;}
  }
  function storeRecords(){try{localStorage.setItem('doodle-survivor-records-v1',JSON.stringify(records));}catch{}updateRecordsUI();}
  function markDiscovered(id){if(!records.discovered.includes(id)){records.discovered.push(id);storeRecords();}}
  function saveRunRecord(win){
    const isBest=time>records.bestTime;records.bestTime=Math.max(records.bestTime,time);records.bestLevel=Math.max(records.bestLevel,player.level);records.runs++;if(win)records.bossWins++;storeRecords();return isBest;
  }
  function updateRecordsUI(){
    const el=$('#records');if(!el)return;el.textContent=records.runs?`BEST ${formatTime(records.bestTime)} · LV ${records.bestLevel} · BOSS ×${records.bossWins} · ${records.discovered.length}/5 SKILLS`:'NO RUNS YET · 0/5 SKILLS';
  }

  function ensureChunks() {
    const pcx = Math.floor(player.x / CHUNK), pcy = Math.floor(player.y / CHUNK), keep = new Set();
    for (let y = pcy - 2; y <= pcy + 2; y++) for (let x = pcx - 2; x <= pcx + 2; x++) {
      const key = `${x},${y}`; keep.add(key); if (!chunks.has(key)) chunks.set(key, makeChunk(x, y));
    }
    for (const key of chunks.keys()) if (!keep.has(key)) chunks.delete(key);
  }

  function makeChunk(cx, cy) {
    const rand = mulberry32(hash(cx, cy)), props = [], count = 3 + Math.floor(rand() * 4);
    const biome=biomeFor(cx*CHUNK+CHUNK/2,cy*CHUNK+CHUNK/2);
    const pools={meadow:['grass','grass','plant','tree','rock'],ruins:['ruin','column','crate','rock','grass'],grave:['bones','tree','rock','ruin','plant']};
    const kinds = pools[biome];
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)], s = .72 + rand() * .55;
      props.push({ kind, x: cx * CHUNK + 20 + rand() * (CHUNK - 40), y: cy * CHUNK + 20 + rand() * (CHUNK - 40), s, flip: rand() > .5 ? 1 : -1, rot: (rand() - .5) * .12, solid: propRadius(kind) * s });
    }
    return {
      cx, cy,
      blooms: Array.from({ length: 3 }, () => ({ x: rand() * CHUNK, y: rand() * CHUNK, r: 65 + rand() * 82, tone: Math.floor(rand() * 3) })),
      biome,props
    };
  }

  function biomeField(x,y){return(Math.sin(x/760)+Math.cos(y/930)+Math.sin((x+y)/1280))/3;}
  function biomeFor(x,y){const v=biomeField(x,y);return v>.24?'meadow':v<-.24?'grave':'ruins';}

  function propRadius(kind) {
    return kind === 'rock' ? 14 : kind === 'tree' ? 13 : kind === 'ruin' ? 17 : kind === 'crate' ? 17 : kind === 'column' ? 14 : 0;
  }

  function resolvePropCollision(entity, oldX, oldY) {
    for (const chunk of chunks.values()) for (const prop of chunk.props) {
      if (!prop.solid) continue;
      const dx = entity.x - prop.x, dy = entity.y - prop.y, min = entity.r + prop.solid, d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      let d = Math.sqrt(d2), nx, ny;
      if (d < .001) { const ox = oldX - prop.x, oy = oldY - prop.y, ol = Math.hypot(ox, oy) || 1; nx = ox / ol; ny = oy / ol; d = 0; }
      else { nx = dx / d; ny = dy / d; }
      entity.x = prop.x + nx * min; entity.y = prop.y + ny * min;
      if (entity === player) effects.push({ type: 'bump', x: prop.x + nx * prop.solid, y: prop.y + ny * prop.solid, life: .16, max: .16 });
    }
  }

  function draw() {
    const sx = shake ? (Math.random() - .5) * shake : 0, sy = shake ? (Math.random() - .5) * shake : 0;
    ctx.save(); ctx.translate(sx, sy);
    if (!player) { drawTitleBackdrop(); ctx.restore(); return; }
    drawWorld(); drawHazards(); drawCleanPatches(); drawDrops(); drawBombs(); drawProjectiles(); drawScene(); drawEventIndicators(); drawEnemyBullets(); drawEffects(); drawJoystick(); drawVignette();
    if (flash) { ctx.fillStyle = `rgba(176,72,68,${flash * .19})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  function drawTitleBackdrop() {
    ctx.fillStyle = '#aeb49a'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = .09; ctx.strokeStyle = '#4c453b';
    for (let y = 8; y < H; y += 27) { ctx.beginPath(); for (let x = 0; x <= W; x += 14) { const yy = y + Math.sin(x * .08 + y) * 1.2; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    ctx.globalAlpha = 1; drawVignette();
  }

  function worldToScreen(x, y) { return { x: x - player.x + CX, y: y - player.y + CY }; }
  function visible(x, y, margin = 80) { const p = worldToScreen(x, y); return p.x > -margin && p.x < W + margin && p.y > -margin && p.y < H + margin; }

  function drawWorld() {
    const field=biomeField(player.x,player.y),warm=(field+1)/2;
    ctx.fillStyle = `rgb(${Math.round(176+warm*8)},${Math.round(174+warm*8)},${Math.round(147+warm*6)})`; ctx.fillRect(0, 0, W, H);
    drawGroundWash();
    const bloomColors = ['rgba(102,119,94,.065)', 'rgba(127,106,89,.045)', 'rgba(226,207,161,.055)'];
    for (const chunk of chunks.values()) {
      const p = worldToScreen(chunk.cx * CHUNK, chunk.cy * CHUNK);
      if (p.x > W + 90 || p.x + CHUNK < -90 || p.y > H + 90 || p.y + CHUNK < -90) continue;
      for (const b of chunk.blooms) {
        const g = ctx.createRadialGradient(p.x + b.x, p.y + b.y, 0, p.x + b.x, p.y + b.y, b.r);
        g.addColorStop(0, bloomColors[b.tone]); g.addColorStop(1, 'rgba(170,169,147,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x + b.x, p.y + b.y, b.r, 0, TAU); ctx.fill();
      }
    }
  }

  function drawGroundWash() {
    const img=imgs.ground;if(!img||!img.complete||!img.naturalWidth)return;
    const size=430,minX=Math.floor((player.x-CX)/size)-1,maxX=Math.ceil((player.x+CX)/size)+1,minY=Math.floor((player.y-CY)/size)-1,maxY=Math.ceil((player.y+CY)/size)+1;
    ctx.save();ctx.globalAlpha=.72;
    for(let gy=minY;gy<=maxY;gy++)for(let gx=minX;gx<=maxX;gx++){
      const p=worldToScreen((gx+.5)*size,(gy+.5)*size);ctx.save();ctx.translate(p.x,p.y);ctx.scale(gx&1?-1:1,gy&1?-1:1);ctx.drawImage(img,-size/2,-size/2,size,size);ctx.restore();
    }
    ctx.restore();
  }

  function drawProp(prop) {
    if (!visible(prop.x, prop.y, 90)) return;
    const p = worldToScreen(prop.x, prop.y), index = ['rock','grass','tree','bones','ruin','crate','plant','column'].indexOf(prop.kind);
    const dimensions = {
      rock:[58,58], grass:[52,48], tree:[82,108], bones:[58,48],
      ruin:[82,94], crate:[61,61], plant:[42,48], column:[61,78]
    }[prop.kind];
    if (prop.solid) { ctx.fillStyle='rgba(49,45,40,.16)';ctx.beginPath();ctx.ellipse(p.x,p.y+prop.solid*.58,prop.solid*1.15,prop.solid*.36,0,0,TAU);ctx.fill(); }
    ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(prop.rot); ctx.scale(prop.flip,1);
    drawAtlasCell(imgs.props,index,4,2,0,0,dimensions[0]*prop.s,dimensions[1]*prop.s);
    ctx.restore();
  }

  function drawCleanPatches() {
    for (const e of effects) if (e.type === 'cleanPatch') { const p = worldToScreen(e.x, e.y); ctx.fillStyle = `rgba(239,230,197,${.13 + e.life / e.max * .08})`; ctx.beginPath(); ctx.arc(p.x, p.y, e.r, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(83,75,64,.25)'; ctx.setLineDash([5,6]); ctx.stroke(); ctx.setLineDash([]); }
  }

  function drawHazards(){
    for(const h of hazards){const p=worldToScreen(h.x,h.y),t=h.life/h.max;ctx.fillStyle=`rgba(52,48,61,${.2+t*.13})`;ctx.strokeStyle='rgba(39,35,45,.55)';ctx.lineWidth=2;ctx.beginPath();for(let n=0;n<14;n++){const a=n*TAU/14,r=h.r*(n%2?.84:1)*(1+Math.sin(n*7+h.x)*.04);n?ctx.lineTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r):ctx.moveTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r)}ctx.closePath();ctx.fill();ctx.stroke();}
  }

  function drawDrops() {
    for (const d of drops) { if (!visible(d.x, d.y)) continue; const p = worldToScreen(d.x, d.y), pulse = 1 + Math.sin(time * 8 + d.x) * .16; ctx.fillStyle = '#77a8b4'; ctx.strokeStyle = '#343330'; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(p.x, p.y - 7 * pulse); ctx.quadraticCurveTo(p.x + 8, p.y + 3, p.x, p.y + 7); ctx.quadraticCurveTo(p.x - 8, p.y + 3, p.x, p.y - 7 * pulse); ctx.fill(); ctx.stroke(); }
  }

  function drawBombs() {
    for (const b of bombs) { const p = worldToScreen(b.x, b.y); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(time * 20) * .08); ctx.fillStyle = '#4a4641'; ctx.strokeStyle = '#262522'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0,2,12,0,TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(5,-9); ctx.quadraticCurveTo(8,-18,15,-14); ctx.stroke(); ctx.fillStyle = b.life < .45 ? '#ed8d73' : '#d6b76c'; ctx.beginPath(); ctx.arc(16,-15,3 + Math.sin(time*18),0,TAU); ctx.fill(); ctx.restore(); }
  }

  function drawPlayer() {
    const frame = player.moving ? Math.floor(player.walkTime) % 4 : 0;
    const bob = player.moving ? Math.sin(player.walkTime * Math.PI) * 1.25 : Math.sin(time * 3) * .35;
    const tilt = player.moving ? player.moveX * .045 : 0, facing = player.moveX < -.08 ? -1 : 1;
    ctx.save(); ctx.fillStyle = 'rgba(52,48,43,.22)'; ctx.beginPath(); ctx.ellipse(CX, CY + 18, 15 + Math.abs(bob), 5 - Math.abs(bob) * .3, 0, 0,TAU); ctx.fill(); ctx.restore();
    ctx.save(); if (player.inv && Math.floor(time * 15) % 2) ctx.globalAlpha = .35; ctx.translate(CX, CY + bob); ctx.rotate(tilt); ctx.scale(facing, 1); drawAtlasQuarter(imgs.player, frame, 0, 0, 88, 88); ctx.restore();
    const lv = player.skills.orbit; if (lv) { const count = lv === 1 ? 1 : lv === 2 ? 2 : lv < 5 ? 3 : 5, speed = lv === 5 ? 3.65 : 2.25, radius = 43 + lv * 2; for (let i=0;i<count;i++){const a=time*speed+i*TAU/count;ctx.fillStyle='#373541';ctx.strokeStyle='#1d1c20';ctx.lineWidth=2;ctx.beginPath();ctx.arc(CX+Math.cos(a)*radius,CY+Math.sin(a)*radius,6+(lv>=4?1:0),0,TAU);ctx.fill();ctx.stroke();} }
  }

  function drawScene() {
    const items = [{ type:'player', y:player.y }];
    for (const chunk of chunks.values()) for (const prop of chunk.props) if (visible(prop.x,prop.y,100)) items.push({ type:'prop', y:prop.y + prop.solid*.25, value:prop });
    for (const enemy of enemies) if (visible(enemy.x,enemy.y,110)) items.push({ type:'enemy', y:enemy.y, value:enemy });
    for (const event of worldEvents) if (visible(event.x,event.y,110)) items.push({type:'event',y:event.y,value:event});
    items.sort((a,b)=>a.y-b.y);
    for (const item of items) {
      if (item.type==='player') drawPlayer();
      else if (item.type==='prop') drawProp(item.value);
      else if (item.type==='event') drawWorldEvent(item.value);
      else drawEnemy(item.value);
    }
  }

  function drawWorldEvent(event){
    const p=worldToScreen(event.x,event.y),index=event.type==='cache'?5:event.type==='shrine'?4:6,d=event.type==='cache'?[76,76]:event.type==='shrine'?[98,112]:[62,70];
    const pulse=1+Math.sin(time*5)*.05;ctx.fillStyle='rgba(237,214,132,.16)';ctx.strokeStyle='rgba(238,220,160,.8)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,36*pulse,0,TAU);ctx.fill();ctx.stroke();
    drawAtlasCell(imgs.props,index,4,2,p.x,p.y,d[0],d[1]);
    if(dist(event,player)<52){ctx.strokeStyle='#efe2aa';ctx.lineWidth=4;ctx.beginPath();ctx.arc(p.x,p.y,42,-Math.PI/2,-Math.PI/2+TAU*(event.progress/event.need));ctx.stroke();}
  }

  function drawEventIndicators(){
    for(const event of worldEvents){if(visible(event.x,event.y,35))continue;const p=worldToScreen(event.x,event.y),a=Math.atan2(p.y-CY,p.x-CX),r=Math.min(145,Math.min((W/2-24)/Math.max(.01,Math.abs(Math.cos(a))),(H/2-72)/Math.max(.01,Math.abs(Math.sin(a)))));const x=CX+Math.cos(a)*r,y=CY+Math.sin(a)*r;ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle='#ead07d';ctx.strokeStyle='#302c2a';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-7,-7);ctx.lineTo(-4,0);ctx.lineTo(-7,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
  }

  function drawEnemy(e) {
    const p = worldToScreen(e.x,e.y), size = e.r * (e.type === 'boss' ? 2.75 : 3);
    ctx.save(); if (e.hit) ctx.globalAlpha = .48;
    if (e.elite) { ctx.strokeStyle = '#b85f57'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x,p.y,e.r+8,0,TAU); ctx.stroke(); }
    if (e.type === 'bat' && e.wind > 0) { ctx.strokeStyle = '#b85f57'; ctx.setLineDash([5,5]); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(CX,CY); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = 'rgba(52,48,43,.17)'; ctx.beginPath(); ctx.ellipse(p.x,p.y+e.r*.78,e.r*1.05,e.r*.36,0,0,TAU); ctx.fill();
    const atlasIndex = e.type === 'slime' ? 0 : e.type === 'bat' ? 1 : e.type === 'skeleton' ? 2 : 3;
    const drawW = e.type === 'boss' ? size * 1.72 : size * 1.86, drawH = e.type === 'boss' ? size * 2.25 : size * 2.48;
    const bobY = p.y + Math.sin(e.phase * 5) * 1.1;
    if (e.type === 'skeleton') drawAtlasRegion(imgs.enemies, 1000, 35, 480, 650, p.x, bobY, drawW, drawH);
    else drawAtlasQuarter(imgs.enemies, atlasIndex, p.x, bobY, drawW, drawH);
    if (e.elite || e.type === 'boss') { ctx.fillStyle='rgba(48,44,42,.2)';ctx.fillRect(p.x-e.r,p.y-e.r-12,e.r*2,5);ctx.fillStyle=e.type==='boss'?'#b85f57':'#c49a52';ctx.fillRect(p.x-e.r,p.y-e.r-12,e.r*2*(e.hp/e.maxHp),5); }
    ctx.restore();
  }

  function drawAtlasQuarter(img, index, x, y, w, h) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const sw = img.naturalWidth / 4, sh = img.naturalHeight;
    ctx.drawImage(img, index * sw, 0, sw, sh, x - w / 2, y - h / 2, w, h);
  }

  function drawAtlasRegion(img, sx, sy, sw, sh, x, y, w, h) {
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.drawImage(img, sx, sy, sw, sh, x-w/2, y-h/2, w, h);
  }

  function drawAtlasCell(img,index,cols,rows,x,y,w,h) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const sw=img.naturalWidth/cols,sh=img.naturalHeight/rows,sx=(index%cols)*sw,sy=Math.floor(index/cols)*sh;
    ctx.drawImage(img,sx,sy,sw,sh,x-w/2,y-h/2,w,h);
  }

  function drawProjectiles() {
    for (const b of projectiles) { const p=worldToScreen(b.x,b.y),a=Math.atan2(b.vy,b.vx);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);ctx.strokeStyle='#302c2a';ctx.fillStyle=b.type==='ink'?'#3e3b4b':'#f1e7cb';ctx.lineWidth=2;
      if(b.type==='plane'){ctx.beginPath();ctx.moveTo(-11,-7);ctx.lineTo(13,0);ctx.lineTo(-11,7);ctx.lineTo(-5,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(7,0);ctx.stroke();}
      else if(b.type==='wave'){ctx.strokeStyle='#d46f68';ctx.lineWidth=5;ctx.beginPath();ctx.arc(-3,0,b.r,-1.1,1.1);ctx.stroke();}
      else{ctx.beginPath();ctx.arc(0,0,b.r,0,TAU);ctx.fill();ctx.stroke();} ctx.restore(); }
  }

  function drawEnemyBullets() {
    for(const b of enemyBullets){if(!visible(b.x,b.y))continue;const p=worldToScreen(b.x,b.y);ctx.fillStyle='#55505d';ctx.strokeStyle='#29272d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,b.r,0,TAU);ctx.fill();ctx.stroke();ctx.strokeStyle='rgba(244,231,201,.7)';ctx.beginPath();ctx.moveTo(p.x-2,p.y-2);ctx.lineTo(p.x+2,p.y+2);ctx.stroke();}
  }

  function drawEffects() {
    for(const e of effects){const p=worldToScreen(e.x,e.y),t=Math.max(0,e.life/e.max);ctx.save();
      if(e.type==='slash'||e.type==='circleSlash'){ctx.strokeStyle=`rgba(218,108,101,${t})`;ctx.lineWidth=5+(e.level||1);ctx.lineCap='round';ctx.beginPath();if(e.type==='circleSlash')ctx.arc(p.x,p.y,e.r*(1.05-t*.12),0,TAU);else ctx.arc(p.x,p.y,e.r*(1.05-t*.12),e.angle-.9,e.angle+.9);ctx.stroke();}
      else if(e.type==='erase'){ctx.fillStyle=`rgba(246,237,207,${t*.48})`;ctx.strokeStyle=`rgba(70,65,58,${t*.7})`;ctx.lineWidth=4;ctx.beginPath();ctx.arc(p.x,p.y,e.r*(1.15-t*.2),0,TAU);ctx.fill();ctx.stroke();}
      else if(e.type==='explosion'){ctx.fillStyle=`rgba(220,126,103,${t*.4})`;ctx.strokeStyle=`rgba(54,49,44,${t})`;ctx.lineWidth=5;ctx.beginPath();for(let n=0;n<16;n++){const a=n*TAU/16,r=e.r*(n%2?.66:1)*(1.1-t*.2);n?ctx.lineTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r):ctx.moveTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r)}ctx.closePath();ctx.fill();ctx.stroke();}
      else if(e.type==='poof'||e.type==='speck'||e.type==='hurt'){ctx.strokeStyle=e.type==='hurt'?'#b85f57':'#3d3935';ctx.globalAlpha=t;for(let n=0;n<5;n++){const a=n*TAU/5+(e.seed||0),r=(1-t)*24+5;ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r);ctx.lineTo(p.x+Math.cos(a)*(r+5),p.y+Math.sin(a)*(r+5));ctx.stroke();}}
      else if(e.type==='scrap'){ctx.translate(p.x,p.y);ctx.rotate(e.rot);ctx.globalAlpha=Math.min(1,t*1.8);ctx.fillStyle=e.color;ctx.strokeStyle='rgba(48,44,42,.55)';ctx.lineWidth=1;ctx.fillRect(-e.size,-e.size*.65,e.size*2,e.size*1.3);ctx.strokeRect(-e.size,-e.size*.65,e.size*2,e.size*1.3);}
      else if(e.type==='dust'||e.type==='bump'){ctx.fillStyle=`rgba(61,57,51,${t*.22})`;ctx.beginPath();ctx.arc(p.x,p.y,(1-t)*6+2,0,TAU);ctx.fill();}
      ctx.restore(); }
  }

  function drawJoystick(){if(!input.active||state!=='play')return;ctx.strokeStyle='rgba(48,44,42,.35)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(input.ox,input.oy,29,0,TAU);ctx.stroke();ctx.fillStyle='rgba(48,44,42,.25)';ctx.beginPath();ctx.arc(input.x,input.y,11,0,TAU);ctx.fill();}
  function drawVignette(){const intensity=.16+Math.min(.13,time/1800)+(bossSpawned ? .08 : 0),g=ctx.createRadialGradient(CX,CY,155,CX,CY,390);g.addColorStop(0,'rgba(54,48,40,0)');g.addColorStop(1,`rgba(47,42,38,${intensity})`);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);if(time>180){ctx.strokeStyle=`rgba(48,43,51,${Math.min(.16,(time-180)/420)})`;ctx.lineWidth=8;ctx.setLineDash([18,12,7,15]);ctx.strokeRect(-3,-3,W+6,H+6);ctx.setLineDash([]);}}
  function drawImg(img,x,y,w,h){if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x-w/2,y-h/2,w,h);else{ctx.strokeStyle='#302c2a';ctx.lineWidth=2;ctx.strokeRect(x-w/2,y-h/2,w,h);}}

  function showNotice(title,subtitle){ui.boss.innerHTML=`${title}<br><small>${subtitle}</small>`;ui.boss.classList.remove('hidden');clearTimeout(showNotice.t);showNotice.t=setTimeout(()=>ui.boss.classList.add('hidden'),2100);}
  function toast(text){ui.toast.textContent=text;ui.toast.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>ui.toast.classList.add('hidden'),1100);}
  function initAudio(){
    if(!audioCtx){
      const AC=window.AudioContext||window.webkitAudioContext;
      if(AC){audioCtx=new AC();musicGain=audioCtx.createGain();musicGain.gain.value=.72;musicGain.connect(audioCtx.destination);}
    }
    if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();
  }
  function updateMusic(){
    if(!soundEnabled||!audioCtx||!musicGain||state==='title'||state==='end')return;
    const now=audioCtx.currentTime;
    if(musicNextTime<now-.5)musicNextTime=now;
    if(musicNextTime>now+.12)return;
    const melody=[220,261.63,329.63,293.66,261.63,196,220,246.94,293.66,329.63,392,329.63,293.66,246.94,220,196];
    const roots=[110,98,130.81,87.31],step=musicStep++,note=melody[step%melody.length],bar=Math.floor(step/4)%roots.length;
    musicTone(note,musicNextTime,.5,.018,'triangle');
    if(step%4===0)musicTone(roots[bar],musicNextTime,.95,.015,'sine');
    if(step%8===6)musicTone(note*2,musicNextTime+.22,.24,.007,'sine');
    musicNextTime+=.44;
  }
  function musicTone(freq,at,duration,volume,type){
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(freq,at);o.detune.setValueAtTime(Math.sin(musicStep*1.7)*3,at);
    g.gain.setValueAtTime(.0001,at);g.gain.linearRampToValueAtTime(volume,at+.035);g.gain.exponentialRampToValueAtTime(.0001,at+duration);
    o.connect(g);g.connect(musicGain);o.start(at);o.stop(at+duration+.03);
  }
  function sound(kind){
    if(!soundEnabled||!audioCtx)return;const table={start:[330,.08,.035],slash:[190,.035,.012],erase:[120,.2,.05],kill:[420,.045,.018],hurt:[95,.13,.055],level:[620,.18,.04],phase:[260,.22,.035],event:[510,.14,.03],reward:[760,.2,.04],warning:[82,.35,.055],boss:[70,.45,.065],bomb:[105,.18,.055],break:[145,.07,.02],master:[880,.3,.045],victory:[980,.5,.06]};const c=table[kind]||table.kill,o=audioCtx.createOscillator(),g=audioCtx.createGain(),now=audioCtx.currentTime;o.type=kind==='hurt'||kind==='warning'||kind==='boss'?'sawtooth':kind==='slash'?'triangle':'sine';o.frequency.setValueAtTime(c[0],now);o.frequency.exponentialRampToValueAtTime(Math.max(45,c[0]*(kind==='reward'||kind==='level'||kind==='master'?1.55:.58)),now+c[1]);g.gain.setValueAtTime(c[2],now);g.gain.exponentialRampToValueAtTime(.0001,now+c[1]);o.connect(g);g.connect(audioCtx.destination);o.start(now);o.stop(now+c[1]);
  }
  function formatTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);} function sqDist(a,b){return(a.x-b.x)**2+(a.y-b.y)**2;}
  function shuffle(a){const out=[...a];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  function hash(x,y){let h=Math.imul(x,374761393)^Math.imul(y,668265263);h=(h^(h>>>13))*1274126177;return(h^(h>>>16))>>>0;}
  function mulberry32(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

  function pos(ev){const r=canvas.getBoundingClientRect();return{x:(ev.clientX-r.left)*W/r.width,y:(ev.clientY-r.top)*H/r.height};}
  canvas.addEventListener('pointerdown',(e)=>{if(state!=='play')return;const p=pos(e);input.active=true;input.id=e.pointerId;input.ox=input.x=p.x;input.oy=input.y=p.y;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',(e)=>{if(!input.active||e.pointerId!==input.id)return;const p=pos(e),dx=p.x-input.ox,dy=p.y-input.oy,l=Math.hypot(dx,dy),m=Math.min(34,l);input.x=input.ox+dx/(l||1)*m;input.y=input.oy+dy/(l||1)*m;});
  function release(e){if(e.pointerId===input.id){input.active=false;input.id=null;}} canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  addEventListener('keydown',(e)=>{const map={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};if(map[e.key]){e.preventDefault();input.keys.add(map[e.key]);}if(e.key===' '){e.preventDefault();useEraser(true);}});
  addEventListener('keyup',(e)=>{const map={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};if(map[e.key])input.keys.delete(map[e.key]);});
  $('#startBtn').onclick=reset;$('#restartBtn').onclick=reset;ui.erase.onclick=()=>useEraser(true);ui.sound.onclick=()=>{soundEnabled=!soundEnabled;ui.sound.textContent=soundEnabled?'♫ ON':'♫ OFF';if(musicGain)musicGain.gain.setValueAtTime(soundEnabled ? .72 : 0,audioCtx.currentTime);if(soundEnabled){initAudio();musicNextTime=audioCtx.currentTime;sound('reward');}};

  updateRecordsUI();
  function loop(now){const dt=Math.min(.033,(now-last)/1000||0);last=now;update(dt);updateMusic();draw();requestAnimationFrame(loop);} requestAnimationFrame(loop);
})();
