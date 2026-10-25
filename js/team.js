// --- 編成画面：登録済みキャラから自軍・敵軍を最大3体ずつ選ぶ ---
const Team = (() => {
  const $ = id => document.getElementById(id);
  const MAX = 3;

  let roster = [];
  const sheets = {};          // id → 切り出し済みシート
  let player = [], enemy = [];
  let canvases = [];          // 待機アニメを描くキャンバス

  async function refresh() {
    roster = await Storage.getAll().catch(() => []);
    for (const ch of roster) {
      if (!sheets[ch.id]) {
        try {
          sheets[ch.id] = await Sprite.load(ch.sheet);
        } catch (e) {
          console.warn(ch.name, e);
        }
      }
    }
    // 削除されたキャラを編成から外す
    const ids = new Set(roster.map(c => c.id));
    player = player.filter(c => ids.has(c.id));
    enemy = enemy.filter(c => ids.has(c.id));
    render();
  }

  function render() {
    const box = $('roster');
    box.innerHTML = '';
    canvases = [];
    if (!roster.length) {
      box.textContent = 'まだキャラが登録されていません。「キャラ登録」から登録してください。';
    }
    for (const ch of roster) {
      const item = document.createElement('div');
      item.className = 'roster-item';
      const cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      canvases.push({ cv, id: ch.id });
      const w = Stats.WEAPONS[ch.weapon];
      item.innerHTML = `<div class="name"></div><div class="sub"></div><div class="sub">${w.icon} ${ch.weapon}　TOTAL ${ch.total}${ch.qr ? '' : '　（裏データなし）'}</div>`;
      item.querySelector('.name').textContent = ch.name;
      item.querySelector('.sub').textContent = ch.xid || '';
      item.prepend(cv);

      const btns = document.createElement('div');
      btns.className = 'btns';
      btns.append(
        button('自軍へ', () => add(player, ch), player.length >= MAX || !sheets[ch.id]),
        button('敵軍へ', () => add(enemy, ch), enemy.length >= MAX || !sheets[ch.id]),
        button('削除', () => removeChar(ch)),
      );
      item.append(btns);
      box.append(item);
    }
    renderSlots('playerSlots', player);
    renderSlots('enemySlots', enemy);
    $('startBtn').disabled = !(player.length && enemy.length);
  }

  function button(text, onClick, disabled = false) {
    const b = document.createElement('button');
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderSlots(id, list) {
    const box = $(id);
    box.innerHTML = '';
    list.forEach((ch, i) => {
      const row = document.createElement('div');
      row.className = 'slot';
      const name = document.createElement('span');
      name.textContent = `${ch.name}（${Stats.WEAPONS[ch.weapon].icon}${ch.weapon}）`;
      row.append(name, button('外す', () => { list.splice(i, 1); render(); }));
      box.append(row);
    });
    for (let i = list.length; i < MAX; i++) {
      const row = document.createElement('div');
      row.className = 'slot';
      row.style.opacity = 0.4;
      row.textContent = '（空き）';
      box.append(row);
    }
  }

  function add(list, ch) {
    if (list.length < MAX) list.push(ch);
    render();
  }

  async function removeChar(ch) {
    if (!(await App.confirm(`「${ch.name}」を削除しますか？（元に戻せません）`))) return;
    await Storage.remove(ch.id).catch(() => {});
    delete sheets[ch.id];
    await refresh();
  }

  function start() {
    const pick = list => list.map(ch => ({ ch, sheet: sheets[ch.id] }));
    Battle.start(pick(player), pick(enemy));
  }

  function loop(ms) {
    if (App.current === 'team') {
      const t = ms / 1000;
      for (const { cv, id } of canvases) {
        const sheet = sheets[id];
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (sheet) Sprite.draw(ctx, sheet, Sprite.pick(Sprite.SEQ.idle, t), 48, 90, 80);
      }
    }
    requestAnimationFrame(loop);
  }

  function init() {
    $('startBtn').addEventListener('click', start);
    requestAnimationFrame(loop);
  }

  return { init, refresh };
})();
