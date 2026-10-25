// --- スプライトシート（4×4＝16コマ）の切り出しと描画 ---
// sheet_demo.html の処理を移植。位置合わせは「胴体」基準に変更
// （剣を振りかぶるコマなどで、頭基準だとコマがずれるため）
const Sprite = (() => {
  // コマ番号（1始まり）と表示秒数
  const SEQ = {
    idle: [[1, 0.6], [2, 0.6]],
    walk: [[3, 0.12], [4, 0.12], [5, 0.12], [6, 0.12]],
    victory: [[14, 0.5], [15, 1.2]],
  };

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = src;
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // 長辺を maxSize 以下に縮小した dataURL
  function shrink(img, maxSize, type = 'image/png', quality) {
    const k = Math.min(1, maxSize / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  }

  // 背景透明化（マゼンタ背景・透明背景の両対応） → 16コマ切り出し
  function cut(img) {
    const W = img.width, H = img.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, W, H);
    const p = data.data;
    const mask = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < p.length; i += 4, j++) {
      // 透明背景のシート：半透明のもやは消し、残りはくっきり不透明に
      if (p[i + 3] < 128) {
        p[i + 3] = 0;
        continue;
      }
      p[i + 3] = 255;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const d = Math.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2);
      if (d < 120) {
        p[i + 3] = 0;
      } else {
        mask[j] = 1;
        // 縁に残るピンクのにじみを抑える
        if (r > 150 && b > 150 && g < 120) p[i] = p[i + 2] = g;
      }
    }
    cx.putImageData(data, 0, 0);

    // 塊（連結成分）ごとに、重心がある4×4マスへ振り分ける
    const label = new Int32Array(W * H);
    const cells = {};
    const stack = [];
    let next = 0;
    for (let start = 0; start < W * H; start++) {
      if (!mask[start] || label[start]) continue;
      next++;
      label[start] = next;
      stack.push(start);
      let area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      while (stack.length) {
        const k = stack.pop();
        const x = k % W, y = (k - x) / W;
        area++; sx += x; sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nk = ny * W + nx;
            if (mask[nk] && !label[nk]) {
              label[nk] = next;
              stack.push(nk);
            }
          }
        }
      }
      if (area < 15) continue; // ゴミ点は無視
      const col = Math.min(3, Math.floor(sx / area / (W / 4)));
      const row = Math.min(3, Math.floor(sy / area / (H / 4)));
      const idx = row * 4 + col;
      const b = cells[idx];
      if (!b) cells[idx] = { x0, y0, x1, y1 };
      else {
        b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0);
        b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1);
      }
    }

    const frames = [];
    for (let i = 0; i < 16; i++) {
      const b = cells[i];
      if (!b) return { error: `${i + 1}コマ目が見つかりません（4×4の16コマになっているか確認してください）` };
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
      const f = document.createElement('canvas');
      f.width = w;
      f.height = h;
      const fx = f.getContext('2d');
      fx.drawImage(c, b.x0, b.y0, w, h, 0, 0, w, h);
      frames.push({ img: f, ax: torsoX(fx, w, h) });
    }
    return {
      base: frames,
      white: frames.map(f => tint(f, () => [255, 255, 255])),
      gray: frames.map(f => tint(f, (r, g, b) => {
        const v = Math.round((r + g + b) / 3 * 0.7);
        return [v, v, v];
      })),
    };
  }

  // 胴体（高さ35〜70%の帯）にある不透明ピクセルのx中央値
  function torsoX(fx, w, h) {
    const y0 = Math.floor(h * 0.35), y1 = Math.max(y0 + 1, Math.floor(h * 0.7));
    const band = fx.getImageData(0, y0, w, y1 - y0).data;
    const xs = [];
    for (let k = 3; k < band.length; k += 4) {
      if (band[k]) xs.push(((k - 3) / 4) % w);
    }
    if (!xs.length) return w / 2;
    xs.sort((a, b) => a - b);
    return xs[xs.length >> 1];
  }

  function tint(frame, fn) {
    const src = frame.img;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const cx = c.getContext('2d');
    cx.drawImage(src, 0, 0);
    const data = cx.getImageData(0, 0, c.width, c.height);
    const p = data.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const [r, g, b] = fn(p[i], p[i + 1], p[i + 2]);
      p[i] = r; p[i + 1] = g; p[i + 2] = b;
    }
    cx.putImageData(data, 0, 0);
    return { img: c, ax: frame.ax };
  }

  async function load(src) {
    const result = cut(await loadImage(src));
    if (result.error) throw new Error(result.error);
    return result;
  }

  // [コマ番号, 秒数] の列から、時刻tのコマを返す
  function pick(seq, t) {
    const total = seq.reduce((s, [, d]) => s + d, 0);
    let r = ((t % total) + total) % total;
    for (const [n, d] of seq) {
      if (r < d) return n;
      r -= d;
    }
    return seq[0][0];
  }

  // コマ描画（x=胴体の位置, y=足元。高さは1コマ目を基準に統一）
  function draw(ctx, sheet, n, x, y, height, opt = {}) {
    const frames = sheet[opt.variant || 'base'];
    const f = frames[n - 1];
    const k = height / sheet.base[0].img.height;
    const w = f.img.width * k, h = f.img.height * k;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (opt.flip) ctx.scale(-1, 1);
    ctx.globalAlpha = opt.alpha === undefined ? 1 : opt.alpha;
    ctx.drawImage(f.img, -f.ax * k, -h, w, h);
    ctx.restore();
  }

  return { SEQ, loadImage, readFile, shrink, load, pick, draw };
})();
