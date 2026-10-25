// --- バトル本体（stage1.html の骨格を拡張） ---
const Battle = (() => {
  const TILE = 88, COLS = 8, ROWS = 6;
  const UNIT_H = Math.round(TILE * 1.05); // マスより少し大きく、頭が上のマスにかかる
  const FOOT = 10;                        // マス下端から足元までの余白（HPバー用）
  const PLAYER_POS = [[0, 1], [0, 3], [0, 5]];
  const ENEMY_POS = [[7, 0], [7, 2], [7, 4]];
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const key = (x, y) => x + ',' + y;

  let canvas, ctx;
  let lineup = null;        // もう一度用
  let units = [];
  let phase = 'player';     // player / enemy
  let state = 'idle';       // idle → selected → moved
  let selected = null;
  let reach = new Map();    // 選択中ユニットの移動先 key → {x, y, path}
  let threat = new Set();   // 移動後に攻撃が届くマス（表示用）
  let targets = [];         // 移動後に攻撃できる相手
  let forecastTarget = null;
  let origin = null;        // キャンセル用の移動前の位置
  let busy = false;
  let gameOver = false;
  let turn = 0;
  let session = 0;          // 中断・やり直し後に、前のバトルの処理を止めるため
  let effects = [];
  let banner = null;

  function log(msg) {
    $('log').textContent = msg;
  }

  // ===== 初期化 =====
  function makeUnit({ ch, sheet }, team, [x, y], i) {
    const gs = Stats.toGameStats(ch);
    return {
      uid: team + i, ch, sheet, team, x, y, gs,
      hp: gs.maxHp, alive: true, acted: false,
      facing: team === 'player' ? 1 : -1,
      ox: 0, oy: 0, frame: null, pose: 'idle', alpha: 1,
      flashUntil: 0, shakeUntil: 0,
      tOffset: Math.random() * 2,
    };
  }

  function start(players, enemies) {
    lineup = { players, enemies };
    session++;
    units = [
      ...players.map((p, i) => makeUnit(p, 'player', PLAYER_POS[i], i)),
      ...enemies.map((e, i) => makeUnit(e, 'enemy', ENEMY_POS[i], i)),
    ];
    gameOver = false;
    busy = false;
    turn = 0;
    effects = [];
    clearSelection();
    $('result').hidden = true;
    showInfo(null);
    App.show('battle');
    startPlayerPhase();
  }

  function unitAt(x, y) {
    return units.find(u => u.alive && u.x === x && u.y === y);
  }

  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  // ===== 移動範囲（BFS）=====
  // 味方のマスは通り抜けられるが止まれない。敵のマスは通れない
  function computeReach(unit) {
    const best = new Map([[key(unit.x, unit.y), { x: unit.x, y: unit.y, cost: 0, path: [{ x: unit.x, y: unit.y }] }]]);
    const queue = [best.get(key(unit.x, unit.y))];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.cost >= unit.gs.move) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!inBounds(nx, ny)) continue;
        const occ = unitAt(nx, ny);
        if (occ && occ.team !== unit.team) continue;
        const k = key(nx, ny);
        if (best.has(k)) continue;
        const node = { x: nx, y: ny, cost: cur.cost + 1, path: [...cur.path, { x: nx, y: ny }] };
        best.set(k, node);
        queue.push(node);
      }
    }
    const result = new Map();
    for (const [k, n] of best) {
      const occ = unitAt(n.x, n.y);
      if (!occ || occ === unit) result.set(k, n);
    }
    return result;
  }

  function targetsFrom(unit, x, y) {
    return units.filter(u => u.alive && u.team !== unit.team && Stats.inRange(unit, x, y, u));
  }

  const aiApi = {
    reach: u => [...computeReach(u).values()],
    forecast: (att, def, ax, ay) => Stats.forecast(att, def, units, ax, ay),
  };

  // ===== 描画 =====
  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#4f8040' : '#4a7a3a';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    if (state === 'selected') {
      ctx.fillStyle = 'rgba(255,80,80,0.3)';
      for (const k of threat) {
        const [x, y] = k.split(',').map(Number);
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
      ctx.fillStyle = 'rgba(80,150,255,0.45)';
      for (const n of reach.values()) ctx.fillRect(n.x * TILE, n.y * TILE, TILE, TILE);
    }
    if (state === 'moved') {
      ctx.fillStyle = 'rgba(255,80,80,0.5)';
      for (const u of targets) ctx.fillRect(u.x * TILE, u.y * TILE, TILE, TILE);
      if (forecastTarget) {
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 3;
        ctx.strokeRect(forecastTarget.x * TILE + 2, forecastTarget.y * TILE + 2, TILE - 4, TILE - 4);
      }
    }

    const now = performance.now();
    const order = units.filter(u => u.alive).sort((a, b) => a.y - b.y);
    for (const u of order) drawUnit(u, t, now);

    drawEffects(now);
    if (banner) drawBanner(now);
  }

  function drawUnit(u, t, now) {
    const shake = now < u.shakeUntil ? Math.round(Math.sin(now / 15) * 3) : 0;
    const cx = u.x * TILE + TILE / 2 + u.ox + shake;
    const foot = u.y * TILE + TILE - FOOT + u.oy;

    ctx.fillStyle = u.team === 'player' ? 'rgba(80,150,255,0.6)' : 'rgba(255,70,70,0.6)';
    ctx.beginPath();
    ctx.ellipse(cx, foot - 2, TILE * 0.28, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    let n;
    if (u.frame) n = u.frame;
    else if (u.pose === 'walk') n = Sprite.pick(Sprite.SEQ.walk, t);
    else if (u.pose === 'victory') n = Sprite.pick(Sprite.SEQ.victory, t + u.tOffset);
    else n = Sprite.pick(Sprite.SEQ.idle, t + u.tOffset);

    let variant = 'base';
    if (now < u.flashUntil && Math.floor(now / 50) % 2 === 0) variant = 'white';
    else if (u.acted && phase === 'player' && u.team === 'player') variant = 'gray';
    Sprite.draw(ctx, u.sheet, n, cx, foot, UNIT_H, { flip: u.facing < 0, alpha: u.alpha, variant });

    if (u.alpha > 0.5) {
      const barW = TILE * 0.7;
      const bx = u.x * TILE + (TILE - barW) / 2 + u.ox;
      const by = u.y * TILE + TILE - 7 + u.oy;
      const ratio = Math.max(0, u.hp / u.gs.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(bx, by, barW, 5);
      ctx.fillStyle = ratio > 0.5 ? '#4caf50' : ratio > 0.2 ? '#ffb300' : '#e53935';
      ctx.fillRect(bx, by, barW * ratio, 5);
    }

    if (u === selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(u.x * TILE + 1, u.y * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  function drawEffects(now) {
    effects = effects.filter(e => now < e.t0 + e.dur);
    for (const e of effects) {
      const k = (now - e.t0) / e.dur;
      if (e.type === 'arrow') {
        const x = e.x0 + (e.x1 - e.x0) * k, y = e.y0 + (e.y1 - e.y0) * k;
        const ang = Math.atan2(e.y1 - e.y0, e.x1 - e.x0);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = '#f5e6c8';
        ctx.fillRect(-14, -1, 18, 2);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(2, -4);
        ctx.lineTo(2, 4);
        ctx.fill();
        ctx.restore();
      } else if (e.type === 'text') {
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.fillStyle = e.color;
        const y = e.y - k * 20;
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        ctx.strokeText(e.text, e.x, y);
        ctx.fillText(e.text, e.x, y);
        ctx.globalAlpha = 1;
      } else if (e.type === 'spark') {
        ctx.fillStyle = '#fff59d';
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4, len = 6 + k * 16;
          ctx.fillRect(e.x + Math.cos(ang) * len - 2, e.y + Math.sin(ang) * len - 2, 4, 4);
        }
      }
    }
  }

  function drawBanner(now) {
    const k = (now - banner.t0) / banner.dur;
    if (k >= 1) {
      banner = null;
      return;
    }
    const alpha = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, canvas.height / 2 - 30, canvas.width, 60);
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = banner.color;
    ctx.fillText(banner.text, canvas.width / 2, canvas.height / 2 + 10);
    ctx.globalAlpha = 1;
  }

  function showBanner(text, color) {
    banner = { text, color, t0: performance.now(), dur: 900 };
    return sleep(900);
  }

  function loop(ms) {
    if (App.current === 'battle') draw(ms / 1000);
    requestAnimationFrame(loop);
  }

  // ===== 情報パネル =====
  function showInfo(u) {
    const el = $('info');
    if (!u) {
      el.innerHTML = '<div>ユニットをクリックすると詳細が出ます。</div>';
      return;
    }
    const g = u.gs;
    const range = g.minRange === g.maxRange ? g.minRange : `${g.minRange}-${g.maxRange}`;
    const skills = u.ch.qr && u.ch.qr.ls.length ? u.ch.qr.ls.map(s => s.n).join('・') : 'なし';
    el.innerHTML = `<img alt=""><div>
      <div class="name"></div>
      <div>HP ${u.hp}/${g.maxHp}　攻 ${g.atk}　防 ${g.def}　命中 ${g.hit}　回避 ${g.avo}　会心 ${g.crit}</div>
      <div>${Stats.WEAPONS[u.ch.weapon].icon} ${u.ch.weapon}　移動 ${g.move}　射程 ${range}　支援 +${g.support}</div>
      <div class="skills"></div></div>`;
    el.querySelector('img').src = u.ch.cardThumb;
    el.querySelector('.name').textContent = `${u.ch.name} ${u.ch.xid || ''}（${u.team === 'player' ? '自軍' : '敵軍'}）`;
    el.querySelector('.skills').textContent = `潜在スキル：${skills}`;
  }

  function showForecast(att, def) {
    const f = Stats.forecast(att, def, units);
    const canCounter = Stats.inRange(def, def.x, def.y, att);
    const c = canCounter ? Stats.forecast(def, att, units) : null;
    $('info').innerHTML = '<div><div class="name">戦闘予測（もう一度クリックで攻撃）</div><div class="a"></div><div class="d"></div></div>';
    $('info').querySelector('.a').textContent =
      `${att.ch.name}：ダメージ ${f.dmg}　命中 ${f.hit}%　会心 ${f.crit}%${f.clutch ? '　（土壇場！）' : ''}`;
    $('info').querySelector('.d').textContent = c
      ? `${def.ch.name}（反撃）：ダメージ ${c.dmg}　命中 ${c.hit}%　会心 ${c.crit}%`
      : `${def.ch.name}：反撃できない`;
  }

  // ===== アニメーション =====
  function tween(ms, fn) {
    return new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / ms);
        fn(k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async function animateMove(u, path) {
    if (path.length < 2) return;
    u.pose = 'walk';
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (b.x !== a.x) u.facing = b.x > a.x ? 1 : -1;
      await tween(140, k => {
        u.ox = (b.x - a.x) * TILE * k;
        u.oy = (b.y - a.y) * TILE * k;
      });
      u.x = b.x;
      u.y = b.y;
      u.ox = u.oy = 0;
    }
    u.pose = 'idle';
  }

  function face(a, b) {
    if (b.x !== a.x) a.facing = b.x > a.x ? 1 : -1;
  }

  function popup(u, text, color) {
    effects.push({ type: 'text', text, color, x: u.x * TILE + TILE / 2, y: u.y * TILE + 16, t0: performance.now(), dur: 900 });
  }

  // 1回の攻撃（攻撃コマ7〜10 → 命中・被弾 → 撃破）
  async function strike(att, def) {
    const f = Stats.forecast(att, def, units);
    const r = Stats.roll(f);
    face(att, def);
    face(def, att);

    att.frame = 7;
    await sleep(180);
    att.frame = 8;
    await sleep(200);
    att.frame = 9;

    const dx = Math.sign(def.x - att.x), dy = Math.sign(def.y - att.y);
    if (att.gs.ranged) {
      const x0 = att.x * TILE + TILE / 2, y0 = att.y * TILE + TILE / 2;
      const x1 = def.x * TILE + TILE / 2, y1 = def.y * TILE + TILE / 2;
      effects.push({ type: 'arrow', x0, y0, x1, y1, t0: performance.now(), dur: 260 });
      await sleep(260);
    } else {
      await tween(90, k => {
        att.ox = dx * 22 * k;
        att.oy = dy * 22 * k;
      });
    }

    const now = performance.now();
    if (r.hit) {
      def.hp = Math.max(0, def.hp - r.dmg);
      def.frame = 11;
      def.flashUntil = now + 250;
      def.shakeUntil = now + 300;
      effects.push({ type: 'spark', x: def.x * TILE + TILE / 2, y: def.y * TILE + TILE / 2, t0: now, dur: 250 });
      popup(def, r.crit ? `会心！${r.dmg}` : String(r.dmg), r.crit ? '#ffeb3b' : '#ff5252');
      log(`${att.ch.name} の攻撃！ ${def.ch.name} に ${r.dmg} ダメージ${r.crit ? '（会心の一撃！）' : ''}`);
    } else {
      popup(def, 'MISS', '#ddd');
      log(`${att.ch.name} の攻撃！ ${def.ch.name} はかわした！`);
    }
    await sleep(350);

    att.frame = 10;
    await tween(120, k => {
      att.ox = (att.gs.ranged ? 0 : dx * 22) * (1 - k);
      att.oy = (att.gs.ranged ? 0 : dy * 22) * (1 - k);
    });
    await sleep(120);
    att.frame = null;
    if (def.hp > 0) def.frame = null;
    else await die(def);
  }

  async function die(u) {
    u.frame = 16;
    await sleep(300);
    await tween(600, k => { u.alpha = 1 - k; });
    u.alive = false;
    log(`${u.ch.name} は倒れた…`);
  }

  // 攻撃 → 生き残って射程内なら反撃
  async function combat(att, def) {
    await strike(att, def);
    if (att.hp > 0 && def.hp > 0 && Stats.inRange(def, def.x, def.y, att)) {
      await sleep(150);
      await strike(def, att);
    }
  }

  // ===== プレイヤーフェイズ =====
  function clearSelection() {
    selected = null;
    reach = new Map();
    threat = new Set();
    targets = [];
    forecastTarget = null;
    origin = null;
    state = 'idle';
    $('actions').hidden = true;
  }

  function select(u) {
    clearSelection();
    selected = u;
    reach = computeReach(u);
    for (const n of reach.values()) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const d = Stats.dist(n.x, n.y, x, y);
          if (d >= u.gs.minRange && d <= u.gs.maxRange && !reach.has(key(x, y))) threat.add(key(x, y));
        }
      }
    }
    state = 'selected';
    showInfo(u);
    log(`${u.ch.name}：青いマスをクリックで移動（その場で行動するなら自分のマス）。`);
  }

  function enterMoved() {
    state = 'moved';
    targets = targetsFrom(selected, selected.x, selected.y);
    $('actions').hidden = false;
    log(targets.length
      ? '赤いマスの敵をクリックで戦闘予測 → もう一度クリックで攻撃。「待機」で行動終了。'
      : '攻撃できる敵がいません。「待機」で行動終了。');
  }

  async function onClick(e) {
    if (busy || gameOver || phase !== 'player') return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * COLS);
    const y = Math.floor((e.clientY - rect.top) / rect.height * ROWS);
    if (!inBounds(x, y)) return;
    const u = unitAt(x, y);

    if (state === 'idle' || state === 'selected') {
      const node = state === 'selected' && reach.get(key(x, y));
      if (node) {
        origin = { x: selected.x, y: selected.y, facing: selected.facing };
        busy = true;
        await animateMove(selected, node.path);
        busy = false;
        enterMoved();
        return;
      }
      if (u && u.team === 'player' && !u.acted) {
        select(u);
      } else {
        clearSelection();
        showInfo(u || null);
      }
      return;
    }

    if (state === 'moved') {
      const target = targets.find(t => t.x === x && t.y === y);
      if (!target) return;
      if (forecastTarget !== target) {
        forecastTarget = target;
        showForecast(selected, target);
        return;
      }
      busy = true;
      $('actions').hidden = true;
      const att = selected;
      state = 'busy';
      await combat(att, target);
      busy = false;
      finishUnit(att);
    }
  }

  function cancelMove() {
    if (busy || state !== 'moved') return;
    const u = selected;
    u.x = origin.x;
    u.y = origin.y;
    u.facing = origin.facing;
    select(u);
  }

  function finishUnit(u) {
    u.acted = true;
    clearSelection();
    showInfo(null);
    if (checkEnd()) return;
    if (units.every(v => !v.alive || v.team !== 'player' || v.acted)) {
      startEnemyPhase();
    } else {
      log('次のユニットを選んでください。');
    }
  }

  async function startPlayerPhase() {
    turn++;
    phase = 'player';
    for (const u of units) u.acted = false;
    $('phase').textContent = `ターン ${turn}　プレイヤーフェイズ`;
    busy = true;
    await showBanner('PLAYER PHASE', '#64a8ff');
    busy = false;
    log('自軍ユニットをクリックしてください。');
  }

  // ===== 敵フェイズ =====
  async function startEnemyPhase() {
    if (busy || gameOver) return;
    clearSelection();
    phase = 'enemy';
    busy = true;
    const mine = session;
    $('phase').textContent = `ターン ${turn}　敵フェイズ`;
    await showBanner('ENEMY PHASE', '#ff6b6b');
    for (const e of units.filter(u => u.alive && u.team === 'enemy')) {
      if (gameOver || mine !== session) return;
      if (!e.alive) continue;
      const plan = AI.decide(e, units, aiApi);
      await animateMove(e, plan.path);
      if (plan.target && plan.target.alive) await combat(e, plan.target);
      await sleep(250);
      if (mine !== session || checkEnd()) return;
    }
    busy = false;
    if (!gameOver) startPlayerPhase();
  }

  // ===== 勝敗 =====
  function checkEnd() {
    const playerAlive = units.some(u => u.alive && u.team === 'player');
    const enemyAlive = units.some(u => u.alive && u.team === 'enemy');
    if (playerAlive && enemyAlive) return false;
    gameOver = true;
    clearSelection();
    const win = !enemyAlive;
    for (const u of units) {
      if (u.alive) {
        u.pose = 'victory';
        u.frame = null;
      }
    }
    const text = $('resultText');
    text.textContent = win ? 'クリア！' : 'ゲームオーバー…';
    text.style.color = win ? '#6fcf6f' : '#ff6b6b';
    $('result').hidden = false;
    log(win ? '敵を全滅させました！' : '自軍が全滅しました。');
    return true;
  }

  function init() {
    canvas = $('board');
    canvas.width = COLS * TILE;
    canvas.height = ROWS * TILE;
    ctx = canvas.getContext('2d');
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (state === 'moved') cancelMove();
      else if (state === 'selected' && !busy) {
        clearSelection();
        showInfo(null);
      }
    });
    $('waitBtn').addEventListener('click', () => {
      if (!busy && state === 'moved') finishUnit(selected);
    });
    $('cancelBtn').addEventListener('click', cancelMove);
    $('endTurnBtn').addEventListener('click', () => {
      if (phase === 'player' && !busy && !gameOver) startEnemyPhase();
    });
    $('retreatBtn').addEventListener('click', async () => {
      if (gameOver || await App.confirm('バトルを中断して編成に戻りますか？')) App.show('team');
    });
    $('retryBtn').addEventListener('click', () => start(lineup.players, lineup.enemies));
    $('backBtn').addEventListener('click', () => App.show('team'));
    requestAnimationFrame(loop);
  }

  return { init, start };
})();
