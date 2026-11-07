'use strict';
// ---------------------------------------------------------------------------
// The first time the game opens (game/UX_IDEAS.md「第一次进入的引导」): 0 the user agreement and privacy notice
// (agreed to before playing; again when they change), 1 which kind of player (first time / played Minecraft /
// played this version), 2 picture quality and shaders on big cards over the live title world (the device detected,
// a few seconds measured, the best fit recommended), 3 logging in. What a player gets follows their kind: the
// tutorial and situational tips, the "what is different here" overview, the minimap / death marker / recipe hints
// on or off, what changed in an update.
// ---------------------------------------------------------------------------
const LEGAL = {
  v: 1,
  agreement: [
    '《用户协议》（2026 年 10 月 30 日生效）',
    '1. 本游戏是 UP 主「土豆味小哲」独立制作的非官方作品，与 Mojang、微软无关；免费游玩。',
    '2. 游戏中保留的部分原版素材（音效、模型、方块结构等）版权归原作者所有；我们原创的代码、界面、披风、玩法等受著作权法保护。',
    '3. 禁止：逆向、反编译游戏代码；抓取后未经书面许可公开或分发；搭建仿冒服务器或镜像站；使用作弊程序、改包连接我们的服务器。',
    '   违反的会被封号，必要时追究法律责任。',
    '4. 联机时请文明游戏：不骂人、不刷屏、不破坏别人的建筑；房主可以踢人、禁言、封禁，我们也会处理举报。',
    '5. 账号由你自己保管：个人识别码可以登录你的账号，请不要告诉别人。',
    '6. 服务器可能维护或调整；云存档、房间按说明的时间清理。因不可抗力或第三方原因造成的数据损失，我们会尽力恢复但不承担责任。',
    '7. 协议更新时会在游戏里再提示一次。问题和建议：游戏里的「反馈问题」，或 B站 私信 UP 主。',
  ],
  privacy: [
    '《隐私说明》',
    '我们收集：B站 昵称、头像链接和这个游戏专用的用户编号（toyOpenId，只存加密后的值）；你的游戏名、识别码（只存加密后的值）、',
    '设置、皮肤和披风选择、解锁记录；云存档；进过的房间；IP 地址（防刷、限流，不长期保存）；',
    '匿名的游戏统计（帧率、设备、显卡、报错，用来改进游戏，可以在 选项 → 遥测数据 里关掉）；你主动提交的反馈和截图。',
    '用途：登录、联机、云存档、防止作弊和刷屏、改进游戏。不出售、不用于广告。',
    '保存多久：云存档 7 天不玩删除；房间 30 天没人用删除；统计 180 天、反馈 365 天后删除。',
    '删除：选项 → 账号 → 删除账号，会删掉账号、云存档和解锁记录（设备上的存档不受影响）。',
  ],
};

// ---- step 0: the agreement: a window in the middle ("I have read and agree to 《用户协议》 and 《隐私说明》", the two
// names links to the whole text); viewOnly: the whole text (from those links, or 选项), at: which part to start at ----
class AgreementScreen extends MenuScreen {
  constructor(game, next, viewOnly, at) {
    super(game, viewOnly ? '用户协议和隐私说明' : null); this.next = next; this.viewOnly = viewOnly; this.pauses = false; this.titleY = 8; this.agree = false; this.scroll = 0;
    this.updated = !viewOnly && (game.settings.legalV || 0) > 0 && game.settings.legalV < LEGAL.v;
    if (viewOnly && at === 'privacy') { const L = this.lines(), i = L.findIndex((t) => t.startsWith('《隐私说明》')); this.scroll = clamp(i, 0, Math.max(0, L.length - this.rows())); }
  }
  // the window and its pieces: the check row's parts (box, words, the two links) and the button
  box() {
    const u = this.game.ui, w = Math.min(290, u.w - 16), h = 132;
    return { x: Math.floor(u.w / 2 - w / 2), y: Math.floor(u.h / 2 - h / 2), w, h };
  }
  rowParts() {
    const B = this.box(), parts = [['check', '我已阅读并同意'], ['agreement', '《用户协议》'], ['and', '和'], ['privacy', '《隐私说明》']];
    const total = 12 + parts.reduce((s, p) => s + Font.width(p[1]), 0);
    let x = Math.floor(B.x + B.w / 2 - total / 2) + 12;
    const y = B.y + 70, out = [{ k: 'box', x: x - 12, y: y - 1, w: 9, h: 9 }];
    for (const [k, t] of parts) { const w = Font.width(t); out.push({ k, t, x, y, w, h: 9 }); x += w; }
    return out;
  }
  rowHit(mx, my) { return this.rowParts().find((p) => mx >= p.x - 1 && mx < p.x + p.w + 1 && my >= p.y - 2 && my < p.y + p.h + 2); }
  mouseDown(ui, mx, my, button) {
    if (!this.viewOnly && button === 0) {
      const p = this.rowHit(mx, my);
      if (p && (p.k === 'agreement' || p.k === 'privacy')) { Sound.click(); return this.game.ui.open(new AgreementScreen(this.game, () => this.game.ui.open(this), true, p.k)); }
      if (p) { Sound.click(); this.agree = !this.agree; this.warn = 0; return; }
    }
    return super.mouseDown(ui, mx, my, button);
  }
  lines() {
    const out = [], max = this.game.ui.w - 40;
    for (const t of [...LEGAL.agreement, '', ...LEGAL.privacy]) {
      if (!t) { out.push(''); continue; }
      let s = t;
      while (s.length) { let n = s.length; while (n > 1 && Font.width(s.slice(0, n)) > max) n--; out.push(s.slice(0, n)); s = s.slice(n); }
    }
    return out;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    if (this.viewOnly) { this.widgets = [{ x: cx - 100, y: u.h - 26, w: 200, h: 20, label: '返回', onClick: () => this.done() }]; return; }
    const B = this.box();
    this.widgets = [{ x: cx - 70, y: B.y + B.h - 32, w: 140, h: 20, gold: true, label: '同意并继续', onClick: () => { if (!this.agree) { this.warn = performance.now(); return; } this.game.settings.legalV = LEGAL.v; this.game.saveSettings(); this.done(); } }];
  }
  drawWindow(ui) {
    const c = ui.ctx, B = this.box(), cx = B.x + B.w / 2, m = ui.mouse;
    ui.dim(0.35);
    drawCard(c, B.x, B.y, B.w, B.h, false);
    Font.center(c, this.updated ? '用户协议有更新' : '欢迎来到 OpusMC', cx, B.y + 10, '#FFFFFF');
    const intro = this.updated ? ['协议内容有调整，请重新阅读并同意后继续游戏。'] : ['这是 UP 主「土豆味小哲」自制的非官方作品，免费游玩。', '开始之前，请阅读并同意下面的协议。'];
    intro.forEach((t, i) => Font.center(c, fitText(t, B.w - 16), cx, B.y + 28 + i * 11, '#A0A0A0'));
    // the check row: the box, the words, the two links (blue, underlined; lighter under the pointer)
    const hit = this.rowHit(m.x, m.y);
    for (const p of this.rowParts()) {
      if (p.k === 'box') {
        c.fillStyle = '#000000'; c.fillRect(p.x, p.y, p.w, p.h);
        c.strokeStyle = hit && (hit.k === 'box' || hit.k === 'check') ? '#FFFFFF' : this.warn && performance.now() - this.warn < 1500 ? '#FF6060' : '#A0A0A0';
        c.lineWidth = 1; c.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
        if (this.agree) { c.fillStyle = '#55FF55'; c.fillRect(p.x + 2, p.y + 4, 2, 2); c.fillRect(p.x + 3, p.y + 5, 2, 2); c.fillRect(p.x + 5, p.y + 3, 1, 2); c.fillRect(p.x + 6, p.y + 2, 1, 2); }
        continue;
      }
      const link = p.k === 'agreement' || p.k === 'privacy', on = hit === p || (hit && hit.k === p.k);
      const col = link ? (on ? '#9FD0FF' : '#55AAFF') : '#E0E0E0';
      Font.draw(c, p.t, p.x, p.y, col);
      if (link) { c.fillStyle = col; c.fillRect(p.x, p.y + 9, p.w, 1); }
    }
    if (this.warn && performance.now() - this.warn < 1500) Font.center(c, '请先勾选「我已阅读并同意」', cx, B.y + 84, '#FF6060');
    else Font.center(c, '点蓝色的名字可以查看全文', cx, B.y + 84, '#707070');
  }
  done() { const n = this.next; this.next = null; n && n(); }
  wheel(d) { this.scroll = clamp(this.scroll - d * 3, 0, Math.max(0, this.lines().length - this.rows())); }
  rows() { return Math.floor((this.game.ui.h - 24 - 34) / 10); }
  drawExtra(ui) {
    if (!this.viewOnly) return this.drawWindow(ui);
    const c = ui.ctx, L = this.lines(), n = this.rows();
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(12, 20, ui.w - 24, n * 10 + 6);
    L.slice(this.scroll, this.scroll + n).forEach((t, i) => Font.draw(c, t, 18, 24 + i * 10, /^《/.test(t) ? '#FFD24A' : '#E0E0E0'));
    if (L.length > n) Font.draw(c, `${this.scroll + n < L.length ? '↓ 滑动或滚动查看更多' : '— 完 —'}`, ui.w - 120, 24 + n * 10 - 9, '#808080');
  }
  onEsc() { if (this.viewOnly) this.done(); }
}
// (touch: dragging scrolls it - the touch layer scrolls screens that have wheel())

// ---- step 1: which kind of player ----
const PLAYER_KINDS = [
  { id: 'new', title: '第一次玩 Minecraft', sub: '从头教我怎么玩', icon: 'grass_block' },
  { id: 'mc', title: '玩过 Minecraft', sub: '看看这个网页版有什么不一样', icon: 'crafting_table' },
  { id: 'vet', title: '这个版本我玩过', sub: '直接开始', icon: 'diamond_pickaxe' },
];
class PlayerKindScreen extends MenuScreen {
  constructor(game, next) { super(game, '你是哪种玩家？'); this.next = next; this.pauses = false; this.titleY = 14; }
  cards() {
    const u = this.game.ui, w = Math.min(130, Math.floor((u.w - 24) / 3) - 6), h = Math.min(120, u.h - 80), y = Math.floor(u.h / 2 - h / 2) + 6;
    return PLAYER_KINDS.map((k, i) => ({ ...k, x: Math.floor(u.w / 2 - (3 * w + 12) / 2) + i * (w + 6), y, w, h }));
  }
  layout() { this.widgets = this.cards().map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h, label: '', card: k, onClick: () => this.pick(k.id) })); }
  pick(id) {
    const s = this.game.settings;
    s.playerKind = id;
    // what each kind starts with (UX_IDEAS.md 各类玩家得到什么)
    if (id === 'new') Object.assign(s, { tutorial: true, tips: true, recipeHints: true, minimap: true, deathMarker: true });
    if (id === 'mc') Object.assign(s, { tutorial: false, tips: false, recipeHints: true, minimap: false, deathMarker: false });
    if (id === 'vet') Object.assign(s, { tutorial: false, tips: false });
    this.game.saveSettings();
    Telemetry.count && Telemetry.count('kind_' + id);
    const n = this.next; this.next = null; n && n();
  }
  draw(ui) {
    super.draw(ui);
    const c = ui.ctx;
    for (const w of this.widgets) {
      const k = w.card, hover = ui.hit(w);
      drawCard(c, k.x, k.y, k.w, k.h, hover);
      ui.drawItem && ui.drawItem(makeStack(k.icon, 1), Math.floor(k.x + k.w / 2 - 8), k.y + 14);
      Font.center(c, fitText(k.title, k.w - 8), k.x + k.w / 2, k.y + 44, '#FFFFFF');
      Font.center(c, fitText(k.sub, k.w - 8), k.x + k.w / 2, k.y + 58, '#A0A0A0');
    }
  }
  onEsc() { }
}

// ---- step 2: quality and shaders, on the live title world ----
const QUALITY_CARDS = [
  { id: 'low', name: '流畅', sub: '近处清楚、远处少', cost: 0.45 },
  { id: 'medium', name: '均衡', sub: '大多数设备', cost: 0.65 },
  { id: 'high', name: '高', sub: '看得更远', cost: 1 },
  { id: 'ultra', name: '极致', sub: '最远视距', cost: 1.6 },
];
const SHADER_CARDS = [
  { lv: 0, name: '关闭', sub: '原版画面', cost: 1 },
  { lv: 1, name: '柔和', sub: '轻微阴影和雾', cost: 1.25 },
  { lv: 2, name: '原版光影', sub: '阴影、水面反射', cost: 1.6 },
  { lv: 3, name: '增强', sub: '更强的光影效果', cost: 2.2 },
  { lv: 4, name: '极限', sub: '体积光，最吃显卡', cost: 3 },
];
class QualityScreen extends MenuScreen {
  constructor(game, next) {
    super(game, null); this.next = next; this.pauses = false; this.blurBg = false; this.bgDim = 0;
    this.phase = 'detect'; this.t0 = performance.now(); this.rec = null;
    const g = game, gl = g.renderer.gl;
    this.hw = { gpu: PerfMon.gpuName(gl) || '未知显卡', cores: navigator.hardwareConcurrency || 0, mem: navigator.deviceMemory || 0, phone: TouchDevice.kind === 'phone' || TouchDevice.kind === 'tablet' };
    this.q = g.settings.preset && QUALITY_CARDS.some((c) => c.id === g.settings.preset) ? g.settings.preset : detectPreset(gl);
    // (a level the cards don't have - an older setting - becomes the nearest one)
    this.sh = Math.max(0, Math.min(SHADER_CARDS.length - 1, Math.round(g.settings.shaders) || 0));
    applyPreset(g, this.q); g.applySettings();
    this.fxOk = !!(g.renderer.fx && g.renderer.fx.ok);
    this.startBench();
  }
  get hz() { const p = this.game.pacer; return p && p.refresh ? Math.round(1000 / p.refresh) : 60; }
  // the frame rate a game gets here (60 on a 90/120 Hz phone unless the player chose more: perf.js playLimit)
  get gameFps() { const p = this.game.pacer; return Math.min(this.hz, (p && p.playLimit) || 1000); }
  // the measurement: how long the device really works on a frame of the live world, for each shader level in
  // turn. Not the time between frames - with VSync that is only the display's rate, whatever the card could do;
  // reading a pixel back after the frame waits until the graphics card has finished it
  startBench() {
    const g = this.game, gl = g.renderer.gl, px = new Uint8Array(4), self = this;
    this.levels = this.fxOk && !this.hw.phone ? SHADER_CARDS.map((c) => c.lv) : [0];
    this.li = 0; this.got = []; this.skip = 6; this.ms = {}; this.lt0 = performance.now(); this.benchFrom = 0;
    this.setLevel(this.levels[0]);
    const own = Object.prototype.hasOwnProperty.call(g, 'render') ? g.render : null, orig = g.render;
    g.render = function (...a) {
      const t = performance.now(), r = orig.apply(this, a);
      if (self.phase === 'detect' && !document.hidden && self.loaded()) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); self.sample(performance.now() - t); }
      return r;
    };
    this.unhook = () => { if (own) g.render = own; else delete g.render; this.unhook = null; };
  }
  // measured only once the title world is built: nothing generating or waiting to be meshed and as many sections for
  // 1 s (at most 10 s). It used to start at once - frames building the world and uploading its meshes measured
  // light on a fresh page, and phones were recommended 高 / 极致 they could not keep up with
  loaded() {
    if (this.benchFrom) return true;
    const g = this.game, now = performance.now(), n = g.renderer.sections ? g.renderer.sections.size : 0;
    const busy = g.titleGround || (g.genQueue && g.genQueue.length) || g.meshPending || (g.genPending && g.genPending.size) || (g.finalQ && g.finalQ.length);
    if (busy || n !== this.secN) { this.secN = n; this.secT = now; }
    if ((!busy && n && now - this.secT >= 1000) || now - this.t0 > 10000) { this.benchFrom = this.lt0 = now; this.skip = 6; return true; }
    return false;
  }
  setLevel(lv) { const g = this.game; g.settings.shaders = lv; g.applySettings(); }
  sample(ms) {
    // (the first frames after a change build the shaders; a stall says nothing about the device)
    if (this.skip > 0) { this.skip--; return; }
    if (ms < 250) this.got.push(ms);
    // (at least 48 frames over at least 2 s - 24 in 1.2 s was a moment, often a lucky one; a level slower than that
    // gets 5 s and goes by what it has)
    const now = performance.now();
    if ((this.got.length < 48 || now - this.lt0 < 2000) && now - this.lt0 < 5000) return;
    const v = this.got.sort((a, b) => a - b);
    if (v.length >= 5) this.ms[this.levels[this.li]] = v[Math.floor(v.length / 2)];
    if (++this.li < this.levels.length) { this.got = []; this.skip = 6; this.lt0 = now; this.setLevel(this.levels[this.li]); }
    else this.finish();
  }
  tick() {
    // (a page in the background draws nothing: it goes on with what it has - 12 s without the world built, or the
    // levels' time once measuring)
    if (this.phase !== 'detect') return;
    const now = performance.now();
    if (this.benchFrom ? now - this.benchFrom > this.levels.length * 5500 + 1500 : now - this.t0 > 12000) this.finish();
  }
  finish() {
    if (this.phase !== 'detect') return;
    this.unhook && this.unhook();
    const s = this.game.settings, phone = this.hw.phone, measured = Object.keys(this.ms).length > 0;
    // phones and tablets: a margin - they slow down as they warm up, and a game's world (mobs, particles, the HUD, chunks
    // loading) costs more than the title's
    if (phone) for (const k in this.ms) this.ms[k] *= 1.4;
    // a level that could not be measured: from the measured ones by the cards' rough cost (nothing measured: a guess
    // from the hardware)
    const m0 = this.ms[0] || (this.q === 'low' ? 12 : this.q === 'medium' ? 8 : 5);
    for (const c of SHADER_CARDS) if (!this.ms[c.lv]) this.ms[c.lv] = m0 * c.cost;
    this.base = { ms: this.ms, rd: s.renderDist || 8, res: s.resScale || 1 };
    // recommended: the best pair still at least ~55 fps (or the rate a game gets if lower), shaders only on capable
    // devices; never 极致 on a phone. Nothing measured: the hardware's guess stays
    const goal = Math.min(55, this.gameFps * 0.9);
    let best = { q: 'low', sh: 0 };
    if (!measured) best = { q: phone && this.q === 'ultra' ? 'high' : this.q, sh: 0 };
    else for (const qc of QUALITY_CARDS) for (const sc of SHADER_CARDS) {
      if ((sc.lv && (!this.fxOk || phone)) || (phone && qc.id === 'ultra')) continue;
      if (this.estimate(qc, sc) >= goal && qc.cost * sc.cost >= QUALITY_CARDS.find((x) => x.id === best.q).cost * SHADER_CARDS[best.sh].cost) best = { q: qc.id, sh: sc.lv };
    }
    this.rec = best; this.q = best.q; this.sh = best.sh; this.apply();
    this.phase = 'pick';
    if (this.game.ui.screen === this) this.layout();
  }
  // a pair's frame rate from the measured times: the world without shaders grows with the chunks in view (the
  // render distance squared) and the pixels; what the shaders add grows with the pixels and, for the shadows, the
  // chunks. In a game the world's own work comes on top (a margin and a millisecond); never above the display's rate
  estimate(qc, sc) {
    const b = this.base; if (!b) return 0;
    const p = PRESETS[qc.id] || {}, rdR = ((p.renderDist || b.rd) / b.rd) ** 2, pxR = ((p.resScale || 1) / b.res) ** 2;
    const m0 = b.ms[0], extra = Math.max(0, (b.ms[sc.lv] || m0 * sc.cost) - m0);
    const ms = m0 * (0.6 * rdR + 0.4 * pxR) + extra * (0.5 * rdR + 0.5 * pxR);
    return Math.min(this.gameFps, Math.round(1000 / (ms * 1.15 + 1)));
  }
  apply() {
    const g = this.game, s = g.settings;
    applyPreset(g, this.q); s.shaders = this.fxOk ? this.sh : 0;
    g.applySettings(); g.saveSettings();
  }
  cardRects() {
    // (both rows as wide as the longer one; each row centred)
    const u = this.game.ui, n = Math.max(QUALITY_CARDS.length, SHADER_CARDS.length), w = Math.min(90, Math.floor((u.w - 20) / n) - 4), h = 36;
    const x0 = (k) => Math.floor(u.w / 2 - (k * w + (k - 1) * 4) / 2);
    const y1 = u.h - 2 * h - 54, y2 = y1 + h + 14;
    return {
      q: QUALITY_CARDS.map((c, i) => ({ ...c, x: x0(QUALITY_CARDS.length) + i * (w + 4), y: y1, w, h })),
      s: SHADER_CARDS.map((c, i) => ({ ...c, x: x0(SHADER_CARDS.length) + i * (w + 4), y: y2, w, h })),
    };
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, R = this.cardRects();
    this.widgets = [];
    if (this.phase !== 'pick') return;
    for (const c of R.q) this.widgets.push({ x: c.x, y: c.y, w: c.w, h: c.h, label: '', card: c, kind: 'q', onClick: () => { this.q = c.id; this.apply(); } });
    for (const c of R.s) this.widgets.push({ x: c.x, y: c.y, w: c.w, h: c.h, label: '', card: c, kind: 's', enabled: this.fxOk || c.lv === 0, onClick: () => { this.sh = c.lv; this.apply(); } });
    // (the frame rate: the frame-rate test right after this decides it - FpsTestScreen)
    this.widgets.push({ x: cx - 49, y: u.h - 24, w: 98, h: 20, gold: true, label: '就这样', onClick: () => { const n = this.next; this.next = null; n && n(); } });
  }
  draw(ui) {
    this.tick();
    const c = ui.ctx, cx = ui.w / 2, R = this.cardRects();
    // the top: what was found
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, ui.w, 42);
    Font.center(c, '选择画质和光影（上面就是实时画面）', cx, 4, '#FFFFFF');
    const hw = this.hw, info = `${hw.gpu.replace(/^ANGLE \(|\)$/g, '').slice(0, 48)}${hw.cores ? ' · ' + hw.cores + ' 线程' : ''}${hw.mem ? ' · ' + hw.mem + ' GB 内存' : ''}`;
    if (this.phase === 'detect') {
      const lv = this.levels[this.li], what = this.levels.length > 1 && lv !== undefined ? `（光影「${SHADER_CARDS[lv].name}」）` : '';
      Font.center(c, fitText('正在测试你的设备' + what + '… ' + info, ui.w - 8), cx, 18, '#A0A0A0');
      const f = Math.min(1, (this.li + Math.min(1, this.got.length / 48)) / this.levels.length);
      c.fillStyle = '#555555'; c.fillRect(cx - 80, 29, 160, 2); c.fillStyle = '#80FF80'; c.fillRect(cx - 80, 29, Math.round(160 * f), 2);
    } else {
      Font.center(c, fitText('检测到：' + info, ui.w - 8), cx, 16, '#A0A0A0');
      Font.center(c, `推荐：${QUALITY_CARDS.find((q) => q.id === this.rec.q).name}画质 + ${SHADER_CARDS[this.rec.sh].name}光影（已经帮你选好）`, cx, 28, '#80FF80');
    }
    // the bottom: the cards
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, R.q[0].y - 14, ui.w, ui.h - R.q[0].y + 14);
    if (this.phase === 'pick') {
      Font.draw(c, '画质', R.q[0].x, R.q[0].y - 11, '#FFFFFF'); Font.draw(c, '光影', R.s[0].x, R.s[0].y - 11, '#FFFFFF');
      for (const w of this.widgets) {
        if (!w.card) continue;
        const k = w.card, sel = w.kind === 'q' ? this.q === k.id : this.sh === k.lv, rec = w.kind === 'q' ? this.rec.q === k.id : this.rec.sh === k.lv, off = w.enabled === false;
        c.fillStyle = sel ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.5)'; c.fillRect(k.x, k.y, k.w, k.h);
        c.strokeStyle = sel ? '#FFFFFF' : ui.hit(w) ? '#A0A0A0' : '#555555'; c.lineWidth = sel ? 2 : 1; c.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1);
        Font.draw(c, k.name, k.x + 4, k.y + 4, off ? '#707070' : '#FFFFFF');
        Font.draw(c, fitText(off ? '设备不支持' : k.sub, k.w - 8), k.x + 4, k.y + 15, '#A0A0A0');
        if (!off) { const e = w.kind === 'q' ? this.estimate(k, SHADER_CARDS[this.sh]) : this.estimate(QUALITY_CARDS.find((q) => q.id === this.q), k); Font.draw(c, `预计 ${e} 帧`, k.x + 4, k.y + 26, e >= 55 ? '#80FF80' : e >= 30 ? '#FFFF55' : '#FF8080'); }
        if (rec) { c.fillStyle = '#E8B830'; c.fillRect(k.x + k.w - 26, k.y, 26, 10); Font.draw(c, '推荐', k.x + k.w - 25, k.y + 1, '#3A2A00'); }
      }
      Font.center(c, fitText('之后可以在 选项 → 视频设置 里改；帧率太低时会自动降低分辨率', ui.w - 8), cx, ui.h - 40, '#808080');
    } else Font.center(c, '马上就好…', cx, R.q[0].y + 20, '#A0A0A0');
    for (const w of this.widgets) if (!w.card) ui.button(w);
    for (const w of this.widgets) if (w.tip && ui.hit(w)) ui.tooltip(w.tip.map((t) => ({ text: t })), ui.mouse.x, ui.mouse.y);
  }
  onEsc() { }
}

// ---- the frame-rate test (the user, 11-06: every player once after this update, new players after the quality): the
// live title world at the display's own rate for 4 s, then the highest limit it keeps up with - 120 / 90 / 60 of what
// the screen has, 30 where it cannot hold ~40. The frames' own work counts too, with a margin (a game's world - mobs,
// particles, chunks loading - costs more than the title's, and a phone slows down as it warms up); a phone that cannot
// keep the limit in play still drops to 60 by itself (mobile.js). The player may pick another ----
const FPS_TEST_V = 1;
const FPS_SUB = { 120: '最流畅，最耗电', 90: '很流畅，较耗电', 60: '流畅，省电', 30: '最省电，低配设备' };
class FpsTestScreen extends MenuScreen {
  constructor(game, next) {
    super(game, null); this.next = next; this.pauses = false; this.blurBg = false; this.bgDim = 0.3;
    this.phase = 'wait'; this.t0 = performance.now(); this.from = 0; this.ts = []; this.cpu = []; this.skip = 10;
    const P = game.pacer; this.phone = !!(P && P.touch);
    if (P) P.free = this;
    Telemetry.count && Telemetry.count('fpstest_start');
  }
  get hz() { const P = this.game.pacer; return P ? P.hz : 60; }
  // the choices: 120 / 90 / 60 / 30 of what the screen has; a PC's screen above 125 Hz gets its own rate too
  options() {
    const hz = this.hz, L = [120, 90, 60, 30].filter((r) => r <= hz + 5);
    if (!this.phone && hz > 125) L.unshift(hz);
    return L;
  }
  // the setting for a choice: 60 is the default (0: 自动 60 on a 90/120 Hz phone, the screen's rate on a 60 Hz one),
  // a PC's own rate 0 (跟随屏幕), the others the number
  value(f) { const hz = this.hz; return f === 60 ? (this.phone || hz <= 65 ? 0 : 60) : !this.phone && f >= hz - 5 && f > 125 ? 0 : f; }
  label(f) { return !this.phone && f > 125 ? `跟随屏幕 ${f}` : f + ' 帧'; }
  // measured once the title world is built (as the quality test: nothing generating or meshing and as many sections
  // for 1 s, at most 10 s)
  loaded() {
    if (this.from) return true;
    const g = this.game, now = performance.now(), n = g.renderer.sections ? g.renderer.sections.size : 0;
    const busy = g.titleGround || (g.genQueue && g.genQueue.length) || g.meshPending || (g.genPending && g.genPending.size) || (g.finalQ && g.finalQ.length);
    if (busy || n !== this.secN) { this.secN = n; this.secT = now; }
    if ((!busy && n && now - this.secT >= 1000) || now - this.t0 > 10000) { this.from = now; this.phase = 'test'; return true; }
    return false;
  }
  // one frame (from draw): its start and the last frame's own work (PerfMon)
  sample() {
    // (no frames for a while - the page in the background, the phone's screen off: the time starts again, and frames
    // measured before the gap are dropped)
    const t = performance.now(), gap = this.lastDraw ? t - this.lastDraw : 0; this.lastDraw = t;
    if (gap > 1000 && this.phase !== 'pick') { this.t0 += gap; if (this.from) { this.from = t; this.ts = []; this.cpu = []; this.skip = 10; } }
    if (this.phase === 'pick' || document.hidden || !this.loaded()) return;
    if (this.skip > 0) { this.skip--; this.from = performance.now(); return; }
    const now = performance.now(), N = PerfMon.N;
    this.ts.push(now); this.cpu.push(PerfMon.cpu[(PerfMon.i + N - 1) % N]);
    if (now - this.from >= 4000 && this.ts.length >= 20) this.finish();
  }
  tick() {
    // (a page in the background draws nothing: it goes by what it has after 20 s)
    if (this.phase !== 'pick' && performance.now() - this.t0 > 20000) this.finish();
  }
  finish() {
    if (this.phase === 'pick') return;
    const ts = this.ts, n = ts.length, hz = this.hz, L = this.options();
    let fps = 0, work = 0, sustain = 0;
    if (n >= 20) {
      fps = (n - 1) * 1000 / (ts[n - 1] - ts[0]);
      const c = [...this.cpu].sort((a, b) => a - b); work = c[Math.floor(c.length * 0.75)];
      // the rate the frames' own work allows in a game: a margin on the title's (phones more), a millisecond on top
      const byWork = 1000 / (work * (this.phone ? 1.6 : 1.25) + 1);
      sustain = Math.min(fps, byWork);
    }
    // the highest choice it keeps up with (8 % short still counts: a frame now and then); 60 down to ~40 still 60 -
    // dynamic resolution takes it the rest of the way; below that 30. Nothing measured: 60
    let rec = 60;
    if (n >= 20) { rec = 30; for (const f of L) if (f >= 60 && sustain >= f * 0.92) { rec = f; break; } if (rec === 30 && sustain >= 40) rec = 60; }
    this.res = { fps: Math.round(fps), work: Math.round(work * 10) / 10, sustain: Math.round(sustain), hz, measured: n >= 20 };
    this.rec = rec; this.sel = rec; this.phase = 'pick';
    const P = this.game.pacer; if (P && P.free === this) P.free = null;
    if (this.game.ui.screen === this) this.layout();
  }
  cardRects() {
    const u = this.game.ui, L = this.options(), w = Math.min(100, Math.floor((u.w - 20) / L.length) - 6), h = 40;
    const x0 = Math.floor(u.w / 2 - (L.length * w + (L.length - 1) * 6) / 2), y = Math.floor(u.h / 2) - 6;
    return L.map((f, i) => ({ f, x: x0 + i * (w + 6), y, w, h }));
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [];
    if (this.phase !== 'pick') { this.widgets.push({ x: cx - 50, y: u.h - 28, w: 100, h: 20, label: '跳过', onClick: () => this.skipTest() }); return; }
    for (const k of this.cardRects()) this.widgets.push({ x: k.x, y: k.y, w: k.w, h: k.h, label: '', card: k, onClick: () => { this.sel = k.f; } });
    this.widgets.push({ x: cx - 100, y: u.h - 30, w: 200, h: 20, gold: true, label: '确定', onClick: () => this.done() });
  }
  // skipped: the setting stays as it was (the test comes no more)
  skipTest() {
    const P = this.game.pacer; if (P && P.free === this) P.free = null;
    Telemetry.count && Telemetry.count('fpstest_skip');
    this.game.settings.fpsTestV = FPS_TEST_V; this.game.saveSettings();
    const n = this.next; this.next = null; n && n();
  }
  done() {
    const g = this.game, s = g.settings;
    s.maxFps = this.value(this.sel); s.fpsTestV = FPS_TEST_V;
    s.fpsTest = { ...this.res, rec: this.rec, pick: this.sel, at: Date.now() };
    g.saveSettings(); g.applySettings && g.applySettings();
    Telemetry.count && Telemetry.count('fpstest_' + this.rec + (this.sel === this.rec ? '' : '_pick' + this.sel));
    const n = this.next; this.next = null; n && n();
  }
  draw(ui) {
    this.sample(); this.tick();
    super.draw(ui);
    const c = ui.ctx, cx = ui.w / 2, cy = Math.floor(ui.h / 2);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, ui.w, 44);
    Font.center(c, '帧率检测', cx, 6, '#FFFFFF');
    if (this.phase !== 'pick') {
      Font.center(c, fitText('正在测试你的设备能跑多少帧，找出最合适的帧率上限（约 5 秒）…', ui.w - 8), cx, 20, '#A0A0A0');
      const f = this.phase === 'test' ? Math.min(1, (performance.now() - this.from) / 4000) : 0;
      c.fillStyle = '#555555'; c.fillRect(cx - 80, 33, 160, 2); c.fillStyle = '#80FF80'; c.fillRect(cx - 80, 33, Math.round(160 * f), 2);
      const ts = this.ts, k = ts.length, live = k > 10 ? Math.round(10 * 1000 / (ts[k - 1] - ts[k - 11])) : 0;
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(cx - 90, cy - 22, 180, 44);
      Font.center(c, this.phase === 'test' ? `当前 ${live || '…'} 帧` : '正在准备画面…', cx, cy - 12, '#FFFFFF');
      Font.center(c, `屏幕刷新率 ${this.hz} Hz`, cx, cy + 4, '#A0A0A0');
    } else {
      const r = this.res;
      Font.center(c, fitText(r.measured ? `屏幕刷新率 ${r.hz} Hz，测试中每秒 ${r.fps} 帧，游戏里预计能稳定 ${r.sustain} 帧` : `屏幕刷新率 ${r.hz} Hz（没有测出来，先用 60 帧）`, ui.w - 8), cx, 19, '#A0A0A0');
      Font.center(c, `推荐帧率上限：${this.label(this.rec)}（已经帮你选好）`, cx, 31, '#80FF80');
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, cy - 26, ui.w, 72);
      Font.center(c, '帧率上限', cx, cy - 20, '#FFFFFF');
      for (const w of this.widgets) {
        const k = w.card; if (!k) continue;
        const sel = this.sel === k.f;
        c.fillStyle = sel ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.5)'; c.fillRect(k.x, k.y, k.w, k.h);
        c.strokeStyle = sel ? '#FFFFFF' : ui.hit(w) ? '#A0A0A0' : '#555555'; c.lineWidth = sel ? 2 : 1; c.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1); c.lineWidth = 1;
        Font.draw(c, this.label(k.f), k.x + 4, k.y + 5, '#FFFFFF');
        Font.draw(c, fitText(FPS_SUB[k.f] || '跟屏幕一样快，最耗电', k.w - 8), k.x + 4, k.y + 17, '#A0A0A0');
        if (r.measured && k.f > this.rec) Font.draw(c, fitText('可能跟不上', k.w - 8), k.x + 4, k.y + 28, '#FFAA55');
        if (this.rec === k.f) { c.fillStyle = '#E8B830'; c.fillRect(k.x + k.w - 26, k.y, 26, 10); Font.draw(c, '推荐', k.x + k.w - 25, k.y + 1, '#3A2A00'); }
      }
      Font.center(c, fitText(this.phone ? '之后可以在 选项 → 控制 → 触屏操作 里改；手机发热跟不上时会自动降到 60 帧' : '之后可以在 选项 → 视频设置 → 最大帧率 里改', ui.w - 8), cx, ui.h - 44, '#808080');
    }
    for (const w of this.widgets) if (!w.card) ui.button(w);
  }
  onEsc() { if (this.phase === 'pick') this.done(); }
}

// ---- step 2b (after the quality): which device - the detected one chosen already, the player may pick the other.
// A phone goes on to the button layout editor; the setup goes on once the layout is saved (the user, 2026-11-01) ----
class DeviceScreen extends MenuScreen {
  constructor(game, next) {
    super(game, '你用什么设备玩？'); this.next = next; this.pauses = false; this.titleY = 14;
    this.detected = TouchDevice.defaultOn ? 'phone' : 'pc'; this.pick = this.detected;
  }
  cards() {
    const u = this.game.ui, w = Math.min(150, Math.floor((u.w - 30) / 2)), h = Math.min(100, u.h - 110), y = Math.floor(u.h / 2 - h / 2) - 4;
    return [
      { id: 'pc', title: '用电脑玩', sub: '键盘 + 鼠标', icon: 'comparator' },
      { id: 'phone', title: '用手机玩', sub: '触屏操作（平板也选这个）', icon: 'compass' },
    ].map((k, i) => ({ ...k, x: Math.floor(u.w / 2 - (2 * w + 8) / 2) + i * (w + 8), y, w, h }));
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = this.cards().map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h, label: '', card: k, onClick: () => { this.pick = k.id; } }));
    this.widgets.push({ x: cx - 100, y: u.h - 34, w: 200, h: 20, gold: true, label: () => this.pick === 'phone' ? '继续：设置触控按钮' : '继续', onClick: () => this.go() });
  }
  go() {
    const g = this.game, s = g.settings, phone = this.pick === 'phone';
    // phone: the buttons on (the option). PC: no buttons to start with, but not switched off - a finger on the screen
    // still brings them (a phone chosen as PC by mistake, feedback 2026-11-01), the mouse takes them away again
    if (phone) s.touch = true; else delete s.touch;
    s.touchPick = this.pick; g.touchAuto = undefined; g.saveSettings(); g.applySettings && g.applySettings();
    Telemetry.count && Telemetry.count('device_' + this.pick + (this.pick === this.detected ? '' : '_changed'));
    const n = this.next; this.next = null;
    if (phone) g.ui.open(new TouchLayoutScreen(g, this, () => n && n()));
    else n && n();
  }
  draw(ui) {
    super.draw(ui);
    const c = ui.ctx;
    for (const w of this.widgets) {
      const k = w.card; if (!k) { ui.button(w); continue; }
      drawCard(c, k.x, k.y, k.w, k.h, ui.hit(w) || this.pick === k.id);
      if (this.pick === k.id) { c.strokeStyle = '#FFD24A'; c.lineWidth = 2; c.strokeRect(k.x + 1, k.y + 1, k.w - 2, k.h - 2); c.lineWidth = 1; }
      ui.drawItem && ui.drawItem(makeStack(k.icon, 1), Math.floor(k.x + k.w / 2 - 8), k.y + 12);
      Font.center(c, k.title, k.x + k.w / 2, k.y + 40, '#FFFFFF');
      Font.center(c, fitText(k.sub, k.w - 8), k.x + k.w / 2, k.y + 54, '#A0A0A0');
      if (this.detected === k.id) Font.center(c, '检测到的设备', k.x + k.w / 2, k.y + k.h - 14, '#E8B830');
    }
    Font.center(c, fitText(this.pick === 'pc' ? '选错了也没关系：用手指点屏幕会自动出现触控按钮' : '之后可以在 选项 → 控制 → 触屏操作 里改', ui.w - 8), ui.w / 2, ui.h - 46, '#808080');
  }
  onEsc() { }
}

// ---- the whole first run, and the agreement again when it changes ----
// ---- 离线版首次运行引导：只保留本地设置，无协议 / 登录 / 公告 / 签到 ----
const Onboarding = {
  start(g) {
    const s = g.settings;
    const done = () => { s.onboarded = true; g.saveSettings(); g.ui.open(new TitleScreen(g)); };
    const device = () => g.ui.open(new DeviceScreen(g, done));
    const fps = () => g.ui.open(new FpsTestScreen(g, device));
    const quality = () => g.ui.open(new QualityScreen(g, fps));
    g.ui.open(new PlayerKindScreen(g, quality));
  },
};
(() => {
  const st = Game.prototype.startTitle;
  Game.prototype.startTitle = function (...a) {
    const r = st.apply(this, a);
    if (!this.onboardChecked) {
      this.onboardChecked = true;
      if (!this.settings.onboarded) setTimeout(() => Onboarding.start(this), 50);
    }
    return r;
  };
})();

// ---- "this version is different": a few pages (players new to it) ----
const DIFF_PAGES = [
  ['网页里的操作', '电脑：和原版一样（WASD、鼠标、E 背包、T 聊天）；点一下画面锁定鼠标，Esc 释放', '手机：左下摇杆走路，右边滑动转视角；屏幕中间是准星，右下的攻击按钮挖掘 / 攻击、使用按钮放置 / 使用'],
  ['和朋友联机', '多人游戏 → 创建房间，把邀请码或邀请卡片发给朋友；也可以进公开房间', '房主能踢人、禁言、设成员；也可以用自己的单人存档开房间'],
  ['存档和账号', '登录后存档会同步到云端，换设备接着玩；7 天没玩的云端存档会自动删除（设备上的不动）', '识别码能在任何设备上登录你的账号，请保密'],
  ['皮肤、披风、帮助', '标题界面「皮肤和装饰」：预设皮肤、正版玩家皮肤、原创披风，签到活动的帽子、宠物和前缀', '按 F1 或 暂停 → 游戏说明 查看操作；物品图鉴（背包里的书本按钮）查合成方法'],
];
class DifferencesScreen extends MenuScreen {
  constructor(game, next) { super(game, '这个版本有什么不一样'); this.next = next; this.pauses = false; this.page = 0; this.titleY = 16; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, last = this.page >= DIFF_PAGES.length - 1;
    this.widgets = [
      { x: cx - 152, y: u.h - 30, w: 98, h: 20, label: '跳过', onClick: () => this.done() },
      { x: cx - 50, y: u.h - 30, w: 98, h: 20, label: '上一页', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } },
      { x: cx + 52, y: u.h - 30, w: 100, h: 20, gold: last, label: last ? '开始玩' : '下一页', onClick: () => { if (last) this.done(); else { this.page++; this.layout(); } } },
    ];
  }
  done() { const n = this.next; this.next = null; n && n(); }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, [t, ...lines] = DIFF_PAGES[this.page], w = Math.min(320, ui.w - 20), x = Math.floor(cx - w / 2), y = 36;
    drawCard(c, x, y, w, ui.h - y - 44, false);
    Font.center(c, `${this.page + 1} / ${DIFF_PAGES.length}　${t}`, cx, y + 8, '#FFD24A');
    let yy = y + 26;
    for (const l of lines) { let s = l; while (s.length) { let n = s.length; while (n > 1 && Font.width(s.slice(0, n)) > w - 16) n--; Font.draw(c, s.slice(0, n), x + 8, yy, '#E0E0E0'); s = s.slice(n); yy += 11; } yy += 6; }
  }
  onEsc() { this.done(); }
}
// ---- what changed (players of this version, once per update) ----
const WHATS_NEW = {
  '2026.10.30': ['B站 账号登录、个人识别码、云存档（换设备接着玩）', '原创披风 7 款（三连 / 关注解锁）、正版玩家皮肤', '手机：摇杆、准星 + 攻击 / 使用按钮、横屏', '新手引导、小地图、死亡点、物品图鉴、整理背包', '用单人存档开联机房间、邀请卡片、本地房间'],
};
class WhatsNewScreen extends MenuScreen {
  constructor(game, next) { super(game, '更新内容'); this.next = next; this.pauses = false; this.titleY = 16; }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 30, w: 200, h: 20, label: '知道了', onClick: () => this.done() }]; }
  done() { this.game.settings.seenBuild = GAME_BUILD; this.game.saveSettings(); const n = this.next; this.next = null; n && n(); }
  drawExtra(ui) { (WHATS_NEW[GAME_BUILD] || []).forEach((t, i) => Font.center(ui.ctx, fitText('· ' + t, ui.w - 16), ui.w / 2, 40 + i * 14, '#E0E0E0')); }
  onEsc() { this.done(); }
}

// (the tutorial itself is the game's own: game.js TUTORIAL, shown as toasts; only first-time players get it)
const obHas = (g, re) => g.player && g.player.inv.slots.some((s) => s && re.test(ITEMS[s.id].key));
(() => {
  const tick = Game.prototype.tick;
  Game.prototype.tick = function (...a) { const r = tick.apply(this, a); if (this.state === 'play') { try { Tips.tick(this); } catch (e) { } } return r; };
})();

// ---- situational tips (first-time players; any player can turn them on) ----
const Tips = {
  shown: new Set(),
  tick(g) {
    if (!g.settings.tips || g.net || g.tickCount % 20) return;
    const p = g.player, t = ((g.worldTime % 24000) + 24000) % 24000, seen = g.settings.tipsSeen || (g.settings.tipsSeen = {});
    const tip = (id, text) => { if (seen[id] || this.shown.has(id)) return; this.shown.add(id); seen[id] = 1; g.saveSettings(); g.ui.pinMessage(text, 7000, '#FFFF80'); };
    if (g.mode === 'survival') {
      if (t > 11000 && t < 13000) tip('dusk', '天快黑了：怪物晚上会出现，找个地方躲起来或者造个房子');
      if (p.food <= 6) tip('hungry', '饿了：吃点东西（选中食物，按住右键 / 按住屏幕）。饥饿值太低不能疾跑、不能回血');
      if (p.health <= 6) tip('lowhp', '血量很低：先躲开怪物，吃饱了会慢慢回血');
      if (obHas(g, /^cobblestone$/)) tip('stone', '有了圆石：可以在工作台上做石镐、石剑，比木头的更好用');
      if (obHas(g, /^raw_iron$/)) tip('iron', '挖到了铁：用熔炉把粗铁烧成铁锭，可以做铁工具和盔甲');
    }
  },
};
(() => {
  // the first death
  const dd = Game.prototype.onPlayerDeath;
  Game.prototype.onPlayerDeath = function (src) {
    const r = dd.call(this, src);
    if (this.settings.tips && !(this.settings.tipsSeen || {}).death) { (this.settings.tipsSeen || (this.settings.tipsSeen = {})).death = 1; this.saveSettings(); setTimeout(() => this.ui.pinMessage('死亡后东西会掉在原地：重生后屏幕上的标记会带你回去捡（5 分钟内）', 9000, '#FFFF80'), 1500); }
    return r;
  };
})();

// ---- 选项界面：仅保留本地「游戏提示」开关（账号 / 皮肤 / 协议入口已移除） ----
(() => {
  const lay = OptionsScreen.prototype.layout;
  OptionsScreen.prototype.layout = function () {
    lay.call(this);
    const u = this.game.ui, g = this.game, s = g.settings;
    const y = Math.max(...this.widgets.filter((w) => w.y < u.h - 40).map((w) => w.y)) + 24;
    if (y < u.h - 50) this.widgets.push(
      { x: u.w / 2 - 100, y, w: 200, h: 20, label: () => '游戏提示：' + (s.tips ? '开' : '关'), tip: ['情景提示：天黑、饥饿、血量低、第一次死亡……'], onClick: () => { s.tips = !s.tips; g.saveSettings(); } },
    );
  };
})();
