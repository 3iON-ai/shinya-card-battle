// --- 登録画面：カード（QR＋手入力）とスプライトシートを1キャラとして保存 ---
const Register = (() => {
  const $ = id => document.getElementById(id);

  let cardThumb = null;  // 縮小したカード画像（dataURL）
  let qrData = null;     // QRの裏データ（読めなければ null）
  let sheetURL = null;   // 縮小したシート画像（dataURL）
  let sheet = null;      // 切り出し済みシート
  let sample = null;     // Claudeにカードを読ませる機能（claude.ai上で開いたときだけ使える）
  let readCtl = null;

  const READ_PROMPT = `添付画像はキャラクターカードです。カードに印刷されている値を、書かれているとおりに読み取ってください。
計算や補正はしないでください。TOTALが6項目の合計と違っていても、カードに印刷されたTOTALをそのまま返してください。

説明の文章は不要です。次の形のJSONだけを返してください（項目名は変えないでください）：
{"name": "キャラクター名（カードで一番大きく書かれた名前。日本語表記があれば日本語）",
 "xid": "@から始まるXアカウントID",
 "stats": {"身体能力": 数値, "技巧": 数値, "判断力": 数値, "精神力": 数値, "対人力": 数値, "運": 数値},
 "total": 数値}
読めない項目は null にしてください。`;

  function setupDrop(dropId, inputId, onFile) {
    const drop = $(dropId), input = $(inputId);
    input.addEventListener('change', () => input.files[0] && onFile(input.files[0]));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
  }

  function setStatus(id, text, cls = '') {
    const el = $(id);
    el.textContent = text;
    el.className = 'status ' + cls;
  }

  async function onCard(file) {
    const url = await Sprite.readFile(file);
    const img = await Sprite.loadImage(url);
    $('cardPreview').src = url;
    cardThumb = Sprite.shrink(img, 360, 'image/jpeg', 0.85);
    setStatus('qrStatus', 'QRを読み取り中…');
    qrData = await QR.read(img);
    if (qrData) {
      const top = Object.entries(qrData.be).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${k}${v}`).join('・');
      setStatus('qrStatus', `QR読み取りOK（ID：${qrData.id || 'なし'}）　性格：${top}`, 'ok');
    } else {
      setStatus('qrStatus', 'QRを読み取れませんでした。裏データなし（標準の性格）で登録できます。', 'ng');
    }
    validate();
    if (sample) await readCard(file);
  }

  // Claudeがカードを読んで、②の入力欄を埋める
  async function readCard(file) {
    if (readCtl) readCtl.abort();
    const ctl = readCtl = new AbortController();
    for (const el of document.querySelectorAll('#screen-register .form input')) el.value = '';
    validate();
    setStatus('aiStatus', 'Claudeがカードを読み取り中…（10〜30秒ほどかかります）');
    try {
      fillForm(await sample.json(READ_PROMPT, { images: file, signal: ctl.signal }));
      setStatus('aiStatus', 'Claudeが読み取りました。カードと見比べて、違うところがあれば直してください。', 'ok');
    } catch (e) {
      if (e.code === 'cancelled') return;
      const lost = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable'];
      if (lost.includes(e.code)) {
        sample = null;
        $('formHint').textContent = '貼り付けると下の欄が埋まります。違うところがあれば直してください。';
        setStatus('aiStatus', 'Claudeによる自動読み取りが使えないため、上の手順（AIに貼ってコピペ）で入力してください。', 'ng');
      } else if (e.code === 'rate_limited') {
        setStatus('aiStatus', 'Claudeの利用が混み合っています。少し待ってからカードを入れ直すか、手入力してください。', 'ng');
      } else if (e.code === 'image_rejected') {
        setStatus('aiStatus', 'この画像はClaudeに渡せませんでした（20MB以下のJPEG/PNG/WebPにしてください）。手入力もできます。', 'ng');
      } else {
        setStatus('aiStatus', '読み取りに失敗しました。カードを入れ直すか、手入力してください。', 'ng');
      }
    } finally {
      if (readCtl === ctl) readCtl = null;
    }
    validate();
  }

  // 読み取り結果（JSON）で②の入力欄を埋める。埋めた項目数を返す
  function fillForm(r) {
    if (!r || typeof r !== 'object') return 0;
    let n = 0;
    const set = (id, v) => { $(id).value = v; n++; };
    if (r.name) set('fName', String(r.name));
    if (r.xid) set('fXid', String(r.xid));
    for (const k of Stats.STAT_KEYS) {
      const v = r.stats && Number(r.stats[k]);
      if (v >= 1 && v <= 99) set('fStat-' + k, Math.round(v));
    }
    const total = Number(r.total ?? r.TOTAL);
    if (total > 0) set('fTotal', Math.round(total));
    validate();
    return n;
  }

  // AIの返事を貼り付け：前後に文章やコードブロックの記号があっても { 〜 } を取り出して読む
  function onPaste() {
    const text = $('pasteBox').value;
    if (!text.trim()) {
      setStatus('pasteStatus', '');
      return;
    }
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    let r = null;
    try {
      if (s >= 0 && e > s) r = JSON.parse(text.slice(s, e + 1));
    } catch (err) { /* 下でエラー表示 */ }
    const n = fillForm(r);
    if (n) setStatus('pasteStatus', `${n}項目を入力しました。カードと見比べてください。`, 'ok');
    else setStatus('pasteStatus', '読み取れませんでした。AIの返事を { から } まで全部貼り付けてください。', 'ng');
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(READ_PROMPT);
      setStatus('pasteStatus', '指示文をコピーしました。AIにカード画像と一緒に貼ってください。', 'ok');
    } catch (e) {
      // コピーできない環境では、指示文を表示して選択状態にする
      const box = $('promptText');
      box.hidden = false;
      box.value = READ_PROMPT;
      box.select();
      setStatus('pasteStatus', '自動でコピーできなかったので、上の指示文を選択してコピーしてください。', 'ng');
    }
  }

  async function onSheet(file) {
    sheet = null;
    setStatus('sheetStatus', 'シートを解析中…');
    try {
      const img = await Sprite.loadImage(await Sprite.readFile(file));
      sheetURL = Sprite.shrink(img, 640);
      sheet = await Sprite.load(sheetURL);
      setStatus('sheetStatus', '16コマを切り出しました。', 'ok');
      drawFrameList();
    } catch (e) {
      setStatus('sheetStatus', e.message, 'ng');
    }
    validate();
  }

  function drawFrameList() {
    const cv = $('sheetFrames');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 16; i++) Sprite.draw(ctx, sheet, i + 1, 12 + i * 25, 56, 46);
  }

  function readForm() {
    const stats = {};
    for (const k of Stats.STAT_KEYS) {
      const v = Number($('fStat-' + k).value);
      if (!$('fStat-' + k).value || !(v >= 1 && v <= 99)) return null;
      stats[k] = v;
    }
    const total = Number($('fTotal').value);
    const name = $('fName').value.trim();
    if (!name || !(total > 0)) return null;
    let xid = $('fXid').value.trim();
    if (xid && !xid.startsWith('@')) xid = '@' + xid;
    return { name, xid, stats, total };
  }

  function validate() {
    const total = Number($('fTotal').value);
    if (total > 0) {
      const w = Stats.weaponFromTotal(total);
      $('weaponView').textContent = `武器：${Stats.WEAPONS[w].icon} ${w}（${total} ÷ 4 の余り ${total % 4}）`;
    } else {
      $('weaponView').textContent = '';
    }
    $('saveBtn').disabled = !(readForm() && sheet && cardThumb);
  }

  async function save() {
    const form = readForm();
    if (!form || !sheet) return;
    const id = (qrData && qrData.id) || 'local-' + Date.now();
    try {
      const exists = await Storage.get(id);
      if (exists && !(await App.confirm(`「${exists.name}」は登録済みです。上書きしますか？`))) return;
      await Storage.put({
        id,
        ...form,
        weapon: Stats.weaponFromTotal(form.total),
        qr: qrData,
        cardThumb,
        sheet: sheetURL,
      });
    } catch (e) {
      setStatus('saveStatus', 'ブラウザに保存できませんでした。プライベートウィンドウでは保存できないことがあります。', 'ng');
      return;
    }
    setStatus('saveStatus', `「${form.name}」を登録しました。続けて登録するか、編成画面へ進んでください。`, 'ok');
    reset();
  }

  function reset() {
    cardThumb = qrData = sheetURL = sheet = null;
    $('cardPreview').removeAttribute('src');
    for (const el of document.querySelectorAll('#screen-register input')) el.value = '';
    $('pasteBox').value = '';
    setStatus('pasteStatus', '');
    setStatus('qrStatus', '');
    setStatus('aiStatus', '');
    setStatus('sheetStatus', '');
    for (const id of ['sheetIdle', 'sheetFrames']) {
      const cv = $(id);
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    }
    validate();
  }

  // シートの待機アニメ
  function loop(ms) {
    if (sheet && App.current === 'register') {
      const cv = $('sheetIdle');
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      Sprite.draw(ctx, sheet, Sprite.pick(Sprite.SEQ.idle, ms / 1000), cv.width / 2, cv.height - 8, 100);
    }
    requestAnimationFrame(loop);
  }

  function init() {
    const box = $('statInputs');
    for (const k of Stats.STAT_KEYS) {
      const label = document.createElement('label');
      label.textContent = k;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = 1;
      input.max = 99;
      input.id = 'fStat-' + k;
      label.append(input);
      box.append(label);
    }
    for (const el of document.querySelectorAll('#screen-register .form input')) {
      el.addEventListener('input', validate);
    }
    setupDrop('cardDrop', 'cardFile', onCard);
    setupDrop('sheetDrop', 'sheetFile', onSheet);
    $('saveBtn').addEventListener('click', save);
    $('copyPromptBtn').addEventListener('click', copyPrompt);
    $('pasteBox').addEventListener('input', onPaste);
    requestAnimationFrame(loop);

    // claude.ai上で開いたときだけ、Claudeによる自動読み取りを使う
    if (window.claude && claude.use) {
      claude.use('sample').then(async s => {
        if (!s) return;
        const limits = await s.limits().catch(() => null);
        if (!limits || !limits.images) return;
        sample = s;
        $('formHint').textContent = 'claude.aiで開いているので、カードを入れるとClaudeが自動で読み取ります（上の貼り付けは不要）。違うところがあれば直してください。';
      });
    }
  }

  return { init };
})();
