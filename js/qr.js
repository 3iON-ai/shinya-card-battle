// --- キャラカードのQR読み取り ---
// QRの形式は2種類：
//   生のJSON（例：ちゃま）            → "{" で始まる
//   zlib圧縮＋base64url（例：鹿さん） → "eNp" で始まる
const QR = (() => {
  async function decode(text) {
    const t = text.trim();
    if (t.startsWith('{')) return normalize(JSON.parse(t));

    const b64 = t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - t.length % 4) % 4);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const json = await new Response(stream).text();
    return normalize(JSON.parse(json));
  }

  function normalize(d) {
    return {
      id: d.id || null,
      ls: Array.isArray(d.ls) ? d.ls : [],
      hs: d.hs || {},
      be: d.be || {},
    };
  }

  // 画像からQRを探す。全体 → 右下・右側・下側を拡大、の順に試す
  const TRIES = [
    { crop: [0, 0, 1, 1], scale: 1 },
    { crop: [0.5, 0.5, 1, 1], scale: 2 },
    { crop: [0.5, 0, 1, 1], scale: 2 },
    { crop: [0, 0.5, 1, 1], scale: 2 },
    { crop: [0.6, 0.6, 1, 1], scale: 3 },
  ];

  function scan(img) {
    for (const { crop, scale } of TRIES) {
      const sx = img.width * crop[0], sy = img.height * crop[1];
      const sw = img.width * (crop[2] - crop[0]), sh = img.height * (crop[3] - crop[1]);
      const c = document.createElement('canvas');
      c.width = Math.round(sw * scale);
      c.height = Math.round(sh * scale);
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const data = cx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(data.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code.data;
    }
    return null;
  }

  // 戻り値：裏データ（読めなければ null）
  async function read(img) {
    const text = scan(img);
    if (!text) return null;
    try {
      return await decode(text);
    } catch (e) {
      console.warn('QRの中身を解読できませんでした', e);
      return null;
    }
  }

  return { read, decode };
})();

if (typeof module !== 'undefined') module.exports = QR;
