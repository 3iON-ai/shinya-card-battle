// --- 敵AI：カードの行動エンジン（be）どおりの性格で動く ---
// 「移動先 × 攻撃対象」の候補をすべて採点し、一番点の高い行動をとる
//
// api = {
//   reach(unit)                 → 移動できるマス [{x, y, path}]
//   forecast(att, def, ax, ay)  → { dmg, hit, crit }
// }
const AI = (() => {
  function decide(unit, units, api) {
    const be = k => Stats.trait(unit.ch, k);
    const foes = units.filter(u => u.alive && u.team !== unit.team);
    const allies = units.filter(u => u.alive && u.team === unit.team && u.uid !== unit.uid);
    const stay = { path: [{ x: unit.x, y: unit.y }], target: null, score: -Infinity };
    if (!foes.length) return stay;

    // 情報収集が低いと、一番近い相手しか見ない
    let watched = foes;
    if (be('情報収集') < 0.5) {
      watched = [foes.reduce((a, b) =>
        Stats.dist(a.x, a.y, unit.x, unit.y) <= Stats.dist(b.x, b.y, unit.x, unit.y) ? a : b)];
    }

    // ピンチで無茶：HPが減るほど慎重さが消える
    const pinch = unit.hp <= unit.gs.maxHp * 0.4;
    const reckless = pinch ? be('ピンチで無茶') : 0;
    const caution = Math.max(0, be('安全策優先') - be('リスク許容') * 0.5) * (1 - reckless);
    const drive = 2 + 3 * be('勝利優先') + 3 * be('挑戦');
    // 面白さ優先＋予測不能性：採点のブレ幅
    const noise = 20 * (be('面白さ優先') + Stats.hidden(unit.ch, '予測不能性')) / 2;
    const power = u => u.gs.atk + u.gs.maxHp / 3;

    let best = stay;
    const consider = (plan, score) => {
      score += (Math.random() * 2 - 1) * noise;
      if (score > best.score) best = { ...plan, score };
    };

    for (const r of api.reach(unit)) {
      const me = { ...unit, x: r.x, y: r.y };

      // 次のターンに狙われる危険度
      let danger = 0;
      for (const f of foes) {
        if (Stats.dist(f.x, f.y, r.x, r.y) <= f.gs.move + f.gs.maxRange) {
          const fc = api.forecast(f, me, f.x, f.y);
          danger += fc.dmg * fc.hit / 100;
        }
      }
      const together = allies.filter(a => Stats.dist(a.x, a.y, r.x, r.y) <= 2).length;
      const base = -caution * danger * 1.5 + be('仲間優先') * together * 3;

      // 攻撃しない：見ている相手に近づく
      const near = Math.min(...watched.map(w => Stats.dist(w.x, w.y, r.x, r.y)));
      consider({ path: r.path, target: null }, base - near * drive * (1 - caution * 0.5));

      // 攻撃する
      for (const t of watched) {
        if (!Stats.inRange(unit, r.x, r.y, t)) continue;
        const fc = api.forecast(unit, t, r.x, r.y);
        const expDmg = fc.dmg * fc.hit / 100;
        const kill = fc.dmg >= t.hp ? fc.hit / 100
          : fc.dmg * 3 >= t.hp ? fc.hit / 100 * fc.crit / 100 : 0;
        let counter = 0;
        if (Stats.inRange(t, t.x, t.y, me)) {
          const cf = api.forecast(t, me, t.x, t.y);
          counter = cf.dmg * cf.hit / 100 * (1 - kill);
        }
        const score = base + 20
          + be('勝利優先') * (expDmg * 2 + kill * 40)
          + be('挑戦') * (power(t) - power(unit)) * 1.5
          - caution * counter * 2;
        consider({ path: r.path, target: t }, score);
      }
    }
    return best;
  }

  return { decide };
})();

if (typeof module !== 'undefined') module.exports = AI;
