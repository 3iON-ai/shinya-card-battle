// --- カードの値 → ゲーム用ステータス変換・武器判定・戦闘計算 ---
const Stats = (() => {
  const STAT_KEYS = ['身体能力', '技巧', '判断力', '精神力', '対人力', '運'];
  const BE_KEYS = ['面白さ優先', '勝利優先', '安全策優先', 'リスク許容', '仲間優先', '情報収集', '挑戦', 'ピンチで無茶', '失敗時の再挑戦'];

  // TOTAL÷4の余り → 武器（dot_sheet_prompt.md と同じ計算）
  const WEAPON_ORDER = ['武道家', '剣', '槍', '弓'];
  const WEAPONS = {
    '武道家': { minRange: 1, maxRange: 1, move: 5, atk: 0, ranged: false, icon: '👊' },
    '剣':     { minRange: 1, maxRange: 1, move: 5, atk: 2, ranged: false, icon: '🗡️' },
    '槍':     { minRange: 1, maxRange: 1, move: 4, atk: 3, ranged: false, icon: '🔱' },
    '弓':     { minRange: 2, maxRange: 2, move: 4, atk: 2, ranged: true,  icon: '🏹' },
  };

  function weaponFromTotal(total) {
    return WEAPON_ORDER[((Math.round(total) % 4) + 4) % 4];
  }

  // 行動エンジン・隠しステータス（0〜1）。QRが無いキャラは標準の0.5
  function trait(ch, key) {
    const v = ch.qr && ch.qr.be && ch.qr.be[key];
    return typeof v === 'number' ? v / 100 : 0.5;
  }
  function hidden(ch, key) {
    const v = ch.qr && ch.qr.hs && ch.qr.hs[key];
    return typeof v === 'number' ? v / 100 : 0.5;
  }

  function toGameStats(ch) {
    const s = ch.stats;
    const w = WEAPONS[ch.weapon];
    return {
      maxHp: Math.round(18 + s['身体能力'] / 6),
      atk: Math.round(4 + s['身体能力'] / 8 + w.atk),
      def: Math.round(s['精神力'] / 15),
      hit: Math.round(70 + s['技巧'] / 4),
      avo: Math.round(s['判断力'] / 4),
      crit: Math.round(s['運'] / 8),
      support: Math.round(s['対人力'] / 5),
      clutch: Math.round(hidden(ch, '土壇場力') * 100 / 20),
      move: w.move,
      minRange: w.minRange,
      maxRange: w.maxRange,
      ranged: w.ranged,
    };
  }

  function dist(ax, ay, bx, by) {
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }

  // unit が (fromX, fromY) から target を攻撃できるか
  function inRange(unit, fromX, fromY, target) {
    const d = dist(fromX, fromY, target.x, target.y);
    return d >= unit.gs.minRange && d <= unit.gs.maxRange;
  }

  // 隣接する味方の対人力による支援（命中・回避に加算）
  function supportBonus(unit, x, y, units) {
    let bonus = 0;
    for (const a of units) {
      if (!a.alive || a.team !== unit.team || a.uid === unit.uid) continue;
      if (dist(a.x, a.y, x, y) === 1) bonus += a.gs.support;
    }
    return bonus;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // 戦闘予測（ax, ay = 攻撃側の立ち位置）
  function forecast(att, def, units, ax = att.x, ay = att.y) {
    const clutch = att.hp <= att.gs.maxHp * 0.3 ? att.gs.clutch : 0;
    const dmg = Math.max(1, att.gs.atk + clutch - def.gs.def);
    const hit = clamp(
      att.gs.hit + supportBonus(att, ax, ay, units) - def.gs.avo - supportBonus(def, def.x, def.y, units),
      5, 100);
    const crit = clamp(att.gs.crit, 0, 100);
    return { dmg, hit, crit, clutch: clutch > 0 };
  }

  function roll(f) {
    const hit = Math.random() * 100 < f.hit;
    const crit = hit && Math.random() * 100 < f.crit;
    return { hit, crit, dmg: hit ? (crit ? f.dmg * 3 : f.dmg) : 0 };
  }

  return { STAT_KEYS, BE_KEYS, WEAPONS, weaponFromTotal, trait, hidden, toGameStats, dist, inRange, forecast, roll };
})();

if (typeof module !== 'undefined') module.exports = Stats;
