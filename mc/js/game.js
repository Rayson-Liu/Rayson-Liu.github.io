'use strict';
// ---------------------------------------------------------------------------
// Game: state, main loop, chunk streaming, interaction, rendering glue
// ---------------------------------------------------------------------------
// an iPhone or iPad (iPads ask for the Mac page: a Mac with a touch screen) - see render's title freeze
const IOS_WEBGL = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
// Apple's engine anywhere: every browser on an iPhone / iPad, Safari on a Mac (render's freeze is off on all of them:
// telemetry 11-07 - the WebGL context lost on Apple devices 0.9% -> 4.5% of sessions with the 11-06 version's freeze,
// Mac Safari 7%, each one a "画面中断了" and a reload)
const WEBKIT_GL = IOS_WEBGL || (typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent) && /Version\/[\d.]+.*Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(navigator.userAgent));
const ADVANCEMENTS = {
  wood: ['获得木头', 'oak_log'], crafting_table: ['这是？工作台！', 'crafting_table'], pickaxe: ['采矿时间到！', 'wooden_pickaxe'],
  stone_pickaxe: ['获得升级', 'stone_pickaxe'], furnace: ['热门话题', 'furnace'], iron: ['来硬的', 'iron_ingot'],
  diamond: ['钻石！', 'diamond'], bread: ['烤面包', 'bread'], kill: ['怪物猎人', 'iron_sword'], armor: ['整装上阵', 'iron_chestplate'],
  tnt: ['轰隆隆！', 'tnt'], deep: ['深入地底', 'deepslate'], night: ['活过第一夜', 'torch'], build: ['建筑师', 'bricks'], farm: ['开始耕作', 'wheat'],
  cook: ['美味佳肴', 'cooked_beef'], bow: ['狙击手', 'bow'], sleep: ['甜蜜的梦', 'red_bed'],
};

const TUTORIAL = [
  { title: '移动', text: '使用 W A S D 键四处走走', touch: '用左下角的摇杆四处走走', icon: 'grass_block', done: (g) => g.tutStat.moved > 8 },
  { title: '获取木头', text: '对着树干按住鼠标左键', touch: '准星对准树干，按住右下的攻击按钮', icon: 'oak_log', done: (g) => g.adv.wood },
  { title: '打开物品栏', text: '按 E 键打开物品栏', touch: '点快捷栏右侧的 … 按钮', icon: 'chest', done: (g) => g.tutStat.inv },
  { title: '合成木板', text: '用左侧配方书或 2x2 合成格', icon: 'oak_planks', done: (g) => g.tutStat.planks },
  { title: '制作工作台', text: '用 4 个木板合成工作台', icon: 'crafting_table', done: (g) => g.adv.crafting_table },
  { title: '制作木镐', text: '放下工作台，右键打开它', touch: '放下工作台，对准它点使用按钮', icon: 'wooden_pickaxe', done: (g) => g.adv.pickaxe },
];

class Game {
  constructor() {
    const saved = this.loadSettings();
    this.hadSettings = Object.keys(saved).length > 0;
    this.settings = Object.assign({ fov: 70, renderDist: 8, sens: 0.5, volume: 0.8, gamma: 0.5, guiScale: 0, clouds: true, bobbing: true, advTooltips: false, resScale: 1, shaders: 0,
      maxFps: 0, vsync: true, graphics: 'fancy', dynRes: false }, saved); // maxFps 0 + VSync: the display's own rate
    // the shader level is 0 - 4 (关 ... 极限); an older version saved it as on / off (true): that is 高 now. Any
    // other value made the shader pack find no settings and every frame failed to draw
    const sv = this.settings.shaders;
    this.settings.shaders = sv === true ? 3 : Math.max(0, Math.min(FX_NAMES.length - 1, Math.round(Number(sv)) || 0));
    this.state = 'boot';
    this.mode = 'survival';
    this.entities = []; this.blockEntities = new Map();
    this.keys = {}; this.mouseBtn = [false, false, false];
    this.tickCount = 0; this.worldTime = 1000; this.fps = 0;
    this.perspective = 0;
    this.weather = 0; this.rainTarget = 0; this.weatherTimer = 12000 + Math.random() * 24000;
    this.breaking = null; this.useCd = 0; this.attackCd = 0;
    this.stats = { kills: 0, placed: 0, mined: 0 };
    this.adv = {}; this.openChests = new Set(); this.chestLids = new Map(); this.signs = new Map();
    this.lastTap = {};
    this.sleepFade = 0;
  }
  loadSettings() { try { return JSON.parse(localStorage.getItem('mcjs-settings') || '{}'); } catch (e) { return {}; } }
  saveSettings() { try { localStorage.setItem('mcjs-settings', JSON.stringify(this.settings)); } catch (e) { } }

  async init() {
    this.canvas = document.getElementById('gl');
    this.renderer = new Renderer(this.canvas);
    this.renderer.resScale = this.settings.resScale;
    await this.renderer.init();
    Font.init(this.renderer.images.font);
    this.renderer.buildIcons();
    this.ui = new UI(this, document.getElementById('ui'));
    this.particles = new Particles(this);
    initPresets(this, this.hadSettings);
    setFastLeaves(this.settings.graphics === 'fast');
    this.applySettings();
    await DB.open();
    this.resize();
    // (with the phone stage up - mobile.js Stage - its own listener resizes, once a frame; this one made each resize
    // event two, and an on-screen keyboard sends a run of them)
    window.addEventListener('resize', () => { if (!(typeof Stage !== 'undefined' && Stage.el)) this.resize(); });
    bindInput(this);
    Sound.loadPack();
    this.startTitle();
    let acc = 0, frames = 0, fpsT = performance.now();
    // frames are started by the pacer (perf.js): the display's refresh, the frame-rate limit or unlimited
    this.pacer = new FramePacer(this, (now, dt) => {
      InlineGenWorker.frame++;
      if (dt > 250) dt = 250;
      if (!(dt >= 0)) dt = 0; if (!(acc >= 0)) acc = 0; // (a bad time once - NaN - stopped the ticks and broke the view for good)
      acc += dt;
      frames++;
      if (now - fpsT > 1000) { this.fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
      if (this.debugPause) { try { this.render(1, now); } catch (e) { this.reportError('render', e); } return; }
      // chunk work, game ticks and drawing each go on when another one fails: one error that comes back every
      // frame (a broken mob, a bad chunk) used to stop all three, and the game froze on its last picture
      try { this.frame(dt, now); } catch (e) { this.reportError('frame', e); }
      let n = 0;
      while (acc >= 50 && n < 5) { try { this.tick(); } catch (e) { this.reportError('tick', e); } acc -= 50; n++; }
      if (n === 5) acc = 0;
      // while a pausing screen is open nothing ticks: freeze the interpolation too, or the view
      // keeps sliding between the last two tick positions. (In a room - a server's or a local one - the world goes on
      // ticking under such a screen, net.js / p2p.js: the interpolation goes on with it)
      const paused = this.state === 'play' && this.ui.screen && this.ui.screen.pauses && !(this.net || this.p2pHost || this.p2pGuest);
      if (paused) { if (this.pauseA == null) this.pauseA = acc / 50; } else this.pauseA = null;
      const r0 = performance.now();
      PerfMon.gpuBegin(this.renderer.gl);
      // (the interface is drawn at the end of render: when the world fails to draw it still is, or the screen
      // stays on its last picture - a loading screen that seemed stuck)
      try { this.render(paused ? this.pauseA : acc / 50, now); } catch (e) { this.reportError('render', e); try { this.ui.draw(); } catch (e2) { } }
      PerfMon.gpuEnd();
      PerfMon.renderMs = performance.now() - r0;
    });
    this.pacer.start();
  }
  showError(e) { this.reportError('', e); }
  // an error the game stepped over: kept in a log (the performance report, F3 + L, lists it) and shown again
  // every 15 s while it keeps happening, so a problem that recurs is not silent after its first time
  reportError(where, e, quiet) {
    const msg = String(e && e.message || e), stack = String(e && e.stack || '').split('\n').slice(1, 4).map(s => s.trim()).join(' | ');
    const key = where + '|' + msg + '|' + stack, log = this.errLog || (this.errLog = new Map()), now = performance.now();
    let r = log.get(key);
    if (!r) {
      if (log.size >= 30) log.delete(log.keys().next().value);
      log.set(key, r = { where, msg, stack, n: 0, first: Date.now(), shown: -1e9 });
      console.error('[' + (where || 'error') + ']', e);
    }
    r.n++; r.last = Date.now();
    if (!quiet && now - r.shown > 15000 && this.ui) { r.shown = now; this.ui.message('错误（已跳过）: ' + msg, '#FF5555'); }
  }
  // run fn; an error in it is logged and stepped over (what = where it happened, for the log)
  guard(what, fn) { try { return fn(); } catch (e) { this.reportError(what, e, true); } }
  applySettings() {
    const s = this.settings;
    this.renderer.renderDist = s.renderDist; this.renderer.gamma = s.gamma; this.renderer.showClouds = s.clouds;
    Sound.setVolume(s.volume);
    const rs = s.resScale * DynRes.scale;
    // (only the 3D canvas changes size: the interface's canvas was laid out again too, every dynamic-resolution step -
    // the HUD blinked)
    if (this.renderer.resScale !== rs) { this.renderer.resScale = rs; this.sizeCanvas(); }
  }
  resize() { this.sizeCanvas(); if (this.ui) this.ui.resize(); }
  // the 3D canvas to the window's size and the resolution scale (Renderer.resize). A new size clears the canvas: canvasGen
  // counts them, for the frames that draw no world and leave its last picture up (render: frozen, halfWorld) - a canvas
  // resized and back between two frames is cleared too, its size alone doesn't tell
  sizeCanvas() {
    const c = this.renderer.canvas, w = c.width, h = c.height;
    this.renderer.resize();
    if (c.width !== w || c.height !== h) this.canvasGen = (this.canvasGen || 0) + 1;
  }

  // ---- worlds -----------------------------------------------------------------
  setupWorld(seed, gen2) {
    if (this.world) this.unloadAll();
    this.dim = 'overworld'; this.dimData = null; this.portalOverlay = 0;
    this.genEpoch = (this.genEpoch || 0) + 1;
    setWorldFormat(gen2 ? 2 : 1);
    this.world = new World(seed32(seed));
    if (gen2) { this.world.gen2 = true; this.world.minY = MIN_Y; this.world.seedStr = String(seed); this.genSetup(seed); }
    this.world.grassMap = this.renderer.grassMap; this.world.foliageMap = this.renderer.foliageMap;
    this.world.listener = this;
    this.entities = []; this.blockEntities = new Map(); this.particles.list = [];
    this.genQueue = []; this.meshQueue = [];
  }
  unloadAll() {
    for (const ch of this.world.chunks.values()) this.renderer.dropChunk(ch.cx, ch.cz);
    this.world.chunks.clear();
    if (this.world.proto) this.world.proto.clear();
    this.renderer.clearSections();
  }
  startTitle() {
    this.state = 'title'; this.saveQ = null; // (an autosave spread over frames - autosaveStart - held the world it left)
    if (this.ui) this.ui.pinned = null; this.pendingPin = null;
    // the title background is a vanilla-terrain world: the panorama's seed and camera, so the panorama is on
    // screen at once and fades into the live world when it is built (panorama.js)
    // (extras.js TITLE_SCENES: one of the chosen scenes each time - its seed, place, time of day and weather)
    const S = typeof TITLE_SCENES !== 'undefined' && this.settings.titleScenes !== false ? TITLE_SCENES[(Math.random() * TITLE_SCENES.length) | 0] : null;
    const P = S ? null : window.PANORAMA;
    this.titleScene = S;
    this.setupWorld(S ? parseSeed(S.seed) : P ? P.seed : parseSeed(''), true);
    const epoch = this.genEpoch;
    this.player = new Player(this, 0.5, 200, 0.5);
    this.titleCam = [0.5, 200, 0.5];
    this.panoAlpha = P ? 1 : 0; this.panoT = 0; this.panoFading = false;
    if (P) { this.titleCam = [...P.pos]; this.player.pos = [...P.pos]; this.player.prev = [...P.pos]; this.titleGround = false; }
    else if (S) { this.titleCam = [S.x + 0.5, 200, S.z + 0.5]; this.player.pos = [...this.titleCam]; this.player.prev = [...this.titleCam]; this.titleGround = true; this.titleYaw = S.yaw || 0; }
    else this.genSpawn().then(([x, z]) => {
      if (this.genEpoch !== epoch) return;
      this.titleCam = [x + 0.5, 200, z + 0.5]; this.player.pos = [x + 0.5, 200, z + 0.5]; this.player.prev = [...this.player.pos];
      this.titleGround = true;
    });
    // (always daytime, the user 2026-10-30: a dark title screen looks wrong - a dusk or night scene shows in the morning)
    this.worldTime = S && S.time >= 500 && S.time <= 11000 ? S.time : 4000; this.weather = S && S.rain ? 1 : 0; this.rainTarget = this.weather;
    this.ui.open(new TitleScreen(this));
  }
  findInland() {
    const w = this.world;
    for (let r = 0; r < 3000; r += 48) for (let a = 0; a < 12; a++) {
      const x = Math.round(Math.cos(a / 12 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 12 * Math.PI * 2) * r);
      const c = w.column(x, z);
      if (c.h < SEA + 4 || c.h > 105) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) { const cc = w.column(x + Math.cos(k / 8 * Math.PI * 2) * 56, z + Math.sin(k / 8 * Math.PI * 2) * 56); if (cc.h <= SEA + 1) ok = false; }
      if (ok) { let top = c.h; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) top = Math.max(top, w.column(x + dx, z + dz).h + (w.biomeOf(w.column(x + dx, z + dz)) === BI.FOREST ? 7 : 0)); return [x, top, z]; }
      if (r === 0) break;
    }
    return this.findSpawn();
  }
  findSpawn() {
    const w = this.world;
    if (w.flat) return [0, 61, 0];
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const c = w.column(x, z), b = w.biomeOf(c);
        if (c.h > SEA + 1 && c.h < 100 && b !== BI.OCEAN && b !== BI.RIVER && b !== BI.BEACH) return [x, c.h + 1, z];
        if (r === 0) break;
      }
    }
    return [0, 80, 0];
  }
  async createWorld(name, seedStr, mode, flat, opts = {}) {
    // new worlds use the vanilla 1.18+ generator (gen 2); superflat keeps the original format
    const gen = flat ? 1 : 2;
    let seed;
    if (gen === 2) seed = parseSeed(seedStr);
    else { seed = parseInt(seedStr, 10); if (!seedStr) seed = (Math.random() * 2 ** 31) | 0; else if (isNaN(seed) || String(seed) !== seedStr.trim()) seed = hashStr(seedStr); }
    const id = 'w' + Date.now().toString(36);
    const meta = { id, name: name || '新的世界', seed, gen, mode, flat: !!flat, created: Date.now(), lastPlayed: Date.now(), time: 1000, player: null,
      hardcore: !!opts.hardcore, difficulty: opts.difficulty ?? 2, cheats: opts.cheats ?? mode === 'creative', structures: opts.structures !== false, bonus: !!opts.bonus };
    await DB.putWorld(meta);
    return this.loadWorld(id);
  }
  async loadWorld(id) {
    // (a read that fails - the browser's storage refused or gone - was an unhandled rejection: the click did nothing and
    // said nothing. The reason is shown, with another try)
    let meta;
    try { meta = await DB.getWorld(id); }
    catch (e) {
      this.reportError('读取世界', e, true);
      // (取消 goes back to the screen the world was opened from - through retries that failed again too - but never to a
      // loading screen: cloudsave.js shows one while it downloads a newer copy, and it would have stayed up for good)
      const sc = this.ui.screen, back = sc && sc.loadBack !== undefined ? sc.loadBack : sc instanceof LoadingScreen ? null : sc;
      const cs = new ConfirmScreen(this, '无法读取这个世界', String(e && e.message || e).slice(0, 60), '重试', (yes) => {
        if (yes) this.loadWorld(id); else this.ui.open(back || (this.state === 'title' ? new TitleScreen(this) : null));
      });
      cs.loadBack = back; this.ui.open(cs);
      return;
    }
    if (!meta) return;
    this.ui.open(new LoadingScreen(this, '正在载入世界…'));
    this.worldMeta = meta;
    if (this.world) this.unloadAll();
    this.entities = []; this.particles.list = []; this.sleeping = null; this.portalOverlay = 0;
    this.welcome = true;
    setWorldFormat(meta.gen || 1);
    if (meta.gen === 2) this.genSetup(meta.seed);
    await this.initDims(meta);
    this.mode = meta.mode;
    this.hardcore = !!meta.hardcore; this.difficulty = this.hardcore ? 3 : (meta.difficulty ?? 2); this.cheats = !this.hardcore && (meta.cheats ?? true);
    this.iconAt = meta.icon ? 0 : performance.now() + 2500;
    this.worldTime = meta.time || 1000;
    this.weather = meta.weather || 0; this.rainTarget = meta.rainTarget || 0;
    this.adv = meta.adv || {}; this.stats = meta.stats || { kills: 0, placed: 0, mined: 0 };
    this.tutorial = meta.tutorial ?? (meta.mode === 'survival' && !['mc', 'vet'].includes(this.settings.playerKind) ? 0 : -1); this.tutStat = { moved: 0 }; // (onboard.js: players who know the game skip it)
    let sp = meta.spawn;
    if (!sp) {
      if (meta.gen === 2) { const [x, z] = await this.genSpawn(); sp = [x, 200, z]; }
      else sp = this.findSpawn();
    }
    const p = this.player = new Player(this, sp[0] + 0.5, sp[1], sp[2] + 0.5);
    p.spawn = sp;
    if (meta.player) {
      const d = meta.player;
      p.pos = [...d.pos]; p.prev = [...d.pos]; p.yaw = d.yaw; p.pitch = d.pitch;
      p.health = d.health; p.food = d.food; p.saturation = d.sat; p.xp = d.xp || 0; p.flying = !!d.flying; p.enchSeed = d.enchSeed ?? ((Math.random() * 2 ** 31) | 0);
      p.inv.slots = d.inv.map(s => s ? fixSavedStack({ ...s }) : null); while (p.inv.slots.length < 41) p.inv.slots.push(null);
      p.inv.sel = d.sel || 0;
      for (const [k, a, t, amb] of d.effects || []) p.addEffect(k, a, t, amb);
      p.absorption = d.absorption || 0; p.bedSpawn = !!d.bedSpawn;
      p.air = 300;
      if (this.mode === 'spectator') p.noClip = true;
    } else {
      p.needsGround = true; // (a new world starts with an empty inventory in every mode, like vanilla)
    }
    this.state = 'loading';
    this.loadStart = performance.now();
  }
  // vanilla spawn_bonus_chest: a chest on the surface near spawn, a torch on each side
  placeBonusChest(sx, sz) {
    const w = this.world;
    for (let t = 0; t < 64; t++) {
      const x = sx + ((Math.random() * 21) | 0) - 10, z = sz + ((Math.random() * 21) | 0) - 10;
      const y = w.surfaceY(x, z) + 1, below = w.getBlock(x, y - 1, z);
      if (!SOLIDCUBE[below] || IS_FLUID[below] || w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0) continue;
      w.setBlock(x, y, z, 52, 4, 0);
      const be = this.getBlockEntity(x, y, z, 'chest');
      const pick = (opts) => { opts = opts.filter(o => ITEM_KEY[o[0]] !== undefined); let t = 0; for (const o of opts) t += o[1]; let r = Math.random() * t; for (const o of opts) { if ((r -= o[1]) < 0) return o; } return opts[0]; };
      const put = (k, n) => { if (ITEM_KEY[k] === undefined) return; let s = (Math.random() * 27) | 0, guard = 0; while (be.slots[s] && guard++ < 40) s = (Math.random() * 27) | 0; be.slots[s] = makeStack(k, n); };
      const rnd = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
      put(pick([['stone_axe', 1], ['wooden_axe', 3]])[0], 1);
      put(pick([['stone_pickaxe', 1], ['wooden_pickaxe', 3]])[0], 1);
      for (let i = 0; i < 3; i++) put(pick([['apple', 5], ['bread', 3], ['cod', 3]])[0], rnd(1, 2));
      for (let i = 0; i < 4; i++) { const o = pick([['stick', 10], ['oak_planks', 10], ['oak_log', 3], ['spruce_log', 3], ['birch_log', 3], ['jungle_log', 3], ['acacia_log', 3], ['dark_oak_log', 3]]); put(o[0], o[0].endsWith('_log') ? rnd(1, 3) : rnd(1, 12)); }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getBlock(x + dx, y, z + dz) === 0 && SOLIDCUBE[w.getBlock(x + dx, y - 1, z + dz)]) w.setBlock(x + dx, y, z + dz, 21, 0, 0);
      return;
    }
  }
  captureIcon() {
    this.iconAt = 0;
    const src = this.canvas, s = Math.min(src.width, src.height), cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high';
    c.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, 64, 64);
    // (the write's own failure is not worth a word - the icon is taken again next time - but it was an unhandled rejection)
    try { this.worldMeta.icon = cv.toDataURL('image/png'); Promise.resolve(DB.putWorld(this.worldMeta)).catch(() => { }); } catch (e) { }
  }
  async saveWorld(quiet) {
    // (an autosave being spread over frames is overtaken: this save encodes and writes all of it - autosaveStart)
    this.saveQ = null;
    if (!this.worldMeta || this.state !== 'play') return;
    const p = this.player;
    const lists = this.collectDimSave();
    const m = this.worldMeta;
    m.lastPlayed = Date.now(); m.time = this.worldTime; m.mode = this.mode; m.difficulty = this.difficulty; m.weather = this.weather; m.rainTarget = this.rainTarget;
    m.spawn = p.spawn; m.adv = this.adv; m.stats = this.stats; m.tutorial = this.tutorial;
    if (this.animalChunks && this.animalChunksFor === m.id) m.animalChunks = [...this.animalChunks];
    // (what an open screen holds for now goes into empty slots of the saved copy - see Ui.pendingStacks)
    let inv = p.inv.slots;
    const pend = this.ui && this.ui.pendingStacks ? this.ui.pendingStacks() : [];
    if (pend.length) { inv = inv.slice(); for (const st of pend) { const i = inv.findIndex((x, j) => j < 36 && !x); if (i >= 0) inv[i] = { ...st }; } }
    m.player = { pos: [...p.pos], yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, sat: p.saturation, xp: p.xp, inv, sel: p.inv.sel, flying: p.flying,
      effects: p.effects ? [...p.effects].map(([k, e]) => [k, e.amp, e.dur, e.ambient]) : [], absorption: p.absorption || 0, enchSeed: p.enchSeed, bedSpawn: !!p.bedSpawn };
    let done = 0;
    try {
      for (const [sid, list] of lists) { await DB.putChunks(sid, list); done++; }
      await DB.putWorld(m);
      if (!quiet) this.ui.message('世界已保存', '#AAAAAA');
    } catch (e) {
      // (the chunks not written go back on the list: they were taken off it before the write, so one failed save
      // used to lose them for good - the next save wrote only what changed after it)
      for (const [sid, list] of lists.slice(done)) {
        const dim = Object.keys(this.dimData || {}).find((d) => this.dimStoreId(d) === sid), d = dim && this.dimData[dim];
        if (d && d.dirtySaved) for (const [cx, cz] of list) d.dirtySaved.add(ckey(cx, cz));
      }
      this.ui.message('保存失败: ' + e.message, '#FF5555');
      if (typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count('save_fail');
    }
  }
  async quitToTitle() {
    if (this.net) { this.leaveServer(); return; }
    await this.saveWorld(true);
    this.worldMeta = null;
    this.ui.cursor = null;
    this.startTitle();
  }

  // ---- chunk streaming ------------------------------------------------------------
  updateChunks(budgetMs) {
    const t = performance.now();
    try { this.updateChunksIn(budgetMs); } finally { if (this.pacer) this.pacer.chunkMs += performance.now() - t; }
  }
  // the time a frame may give chunk work: set by the pacer (perf.js) from the display's refresh and the
  // measured rest of the frame
  chunkBudget() { return this.pacer ? this.pacer.budget() : 6; }
  updateChunksIn(budgetMs) {
    const w = this.world, R = this.state === 'title' ? 6 : this.settings.renderDist;
    const center = this.state === 'title' ? this.titleCam : this.player.pos;
    const pcx = Math.floor(center[0]) >> 4, pcz = Math.floor(center[2]) >> 4;
    const t0 = performance.now();
    this.workDone = 0;
    // generation queue: nearest missing chunks within R+1 (a server's world sends its own: net.js)
    if (!w.remote && (!this.genQueue.length || this._lastCC !== pcx + ',' + pcz)) {
      this._lastCC = pcx + ',' + pcz;
      const q = [];
      for (let dx = -R - 1; dx <= R + 1; dx++) for (let dz = -R - 1; dz <= R + 1; dz++) {
        if (dx * dx + dz * dz > (R + 1.5) * (R + 1.5)) continue;
        if (!w.chunks.has(ckey(pcx + dx, pcz + dz))) q.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
      }
      q.sort((a, b) => b[2] - a[2]);
      this.genQueue = q;
    }
    this.genQueueLen = this.genQueue.length;
    let gen = 0;
    if (w.gen2 && !w.remote) { this.genQueue.length = 0; this.genStep(pcx, pcz, R, t0, budgetMs); }
    while (this.genQueue.length && (performance.now() - t0 < budgetMs * 0.5 || gen === 0)) {
      const [cx, cz] = this.genQueue.pop();
      if (w.chunks.has(ckey(cx, cz)) || !this.savedReady(w, ckey(cx, cz))) continue; // saved data still being read: next round
      this.loadChunk(cx, cz);
      gen++;
    }
    if (this.meshResQ && this.meshResQ.length) this.applyMeshResults(t0, budgetMs);
    // meshing: dirty chunks whose neighbours exist
    const cand = [];
    for (const ch of w.chunks.values()) {
      if (!ch.dirty) continue;
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (!w.chunks.has(ckey(ch.cx + a, ch.cz + b))) { ok = false; break; }
      if (ok) cand.push([ch, dx * dx + dz * dz]);
    }
    cand.sort((a, b) => a[1] - b[1]);
    // streamed chunks are meshed in the chunk worker (only gathering their blocks happens here); while
    // loading, and for the player's own edits (flushMesh), meshing stays immediate
    const cw = this.chunkWorker, async = w.useCW && cw && cw.ready && !cw.failed && this.state !== 'loading';
    for (const [ch] of cand) {
      if (async && !ch.syncMesh) {
        if (cw.inflightMeshes() > 64 || !this.workFits(t0, budgetMs, 'gather')) break;
        this.timedWork('gather', () => this.meshChunkAsync(ch));
      } else {
        if (!this.workFits(t0, budgetMs, 'mesh')) break;
        this.timedWork('mesh', () => this.meshChunk(ch));
      }
    }
    this.meshPending = cand.length;
    // unload far chunks (the server unloads its own)
    if (this.tickCount % 40 === 0 && !w.remote) {
      const gone = [];
      for (const ch of [...w.chunks.values()]) {
        const dx = ch.cx - pcx, dz = ch.cz - pcz;
        if (dx * dx + dz * dz > (R + 2.5) * (R + 2.5)) { // finished chunks only exist out to R + 1.5
          const k = ckey(ch.cx, ch.cz);
          if (ch.modified && w.savedChunks && this.state === 'play') { w.savedChunks.set(k, encodeChunk(ch)); if (w.savedIndex) w.savedIndex.add(k); this.dirtySaved.add(k); }
          // saved data already on disk is read again if the chunk comes back
          else if (w.savedIndex && w.savedIndex.has(k) && !this.dirtySaved.has(k)) w.savedChunks.delete(k);
          this.renderer.dropChunk(ch.cx, ch.cz);
          w.chunks.delete(ckey(ch.cx, ch.cz));
          gone.push(ckey(ch.cx, ch.cz));
          if (this.meshVer) for (let sy = 0; sy < SECTIONS; sy++) this.meshVer.delete(ckey(ch.cx, ch.cz) * 32 + sy);
        }
      }
      if (gone.length && w.useCW && cw && cw.world === w && !cw.failed) cw.post({ type: 'unloaded', epoch: cw.epoch, keys: gone });
      if (gone.length && this.state === 'play') this.parkEntities(new Set(gone));
      // saved data read ahead for chunks that never loaded (the player turned back) is dropped again
      if (w.savedIndex && w.savedChunks.size > 64) for (const k of [...w.savedChunks.keys()]) {
        if (w.chunks.has(k) || this.dirtySaved.has(k)) continue;
        const dx = Math.floor(k / 65536) - 32768 - pcx, dz = (k % 65536) - 32768 - pcz;
        if (dx * dx + dz * dz > (R + 8) * (R + 8)) w.savedChunks.delete(k);
      }
    }
  }
  // a chunk's saved data, read from the database on demand: true when it is known (in memory, or the chunk has
  // none); otherwise the read starts (once) and the chunk waits
  // A read that fails, or hasn't answered after 8 s, is tried again (3 times): giving up at once used to
  // treat the chunk as never saved, so it came back as fresh terrain and the next save wrote over the edits
  savedReady(w, k) {
    if (!w.savedIndex || !w.savedIndex.has(k) || w.savedChunks.has(k)) return true;
    const f = w.savedFetch instanceof Map ? w.savedFetch : (w.savedFetch = new Map()), now = performance.now();
    const t = f.get(k);
    if (t === undefined || now - t > 8000) {
      f.set(k, now);
      const tries = w.savedTries || (w.savedTries = new Map());
      DB.getChunk(w.savedStore, Math.floor(k / 65536) - 32768, (k % 65536) - 32768).then(
        (rec) => { f.delete(k); tries.delete(k); if (rec) w.savedChunks.set(k, rec); else w.savedIndex.delete(k); },
        (e) => {
          f.delete(k);
          const n = (tries.get(k) || 0) + 1; tries.set(k, n);
          if (n >= 3) { tries.delete(k); w.savedIndex.delete(k); this.reportError('读取存档区块', e); }
        });
    }
    return false;
  }
  // chunk jobs (decorate / finalise / mesh) take several ms each and can't be split: after the first one in a
  // frame, start another only if its typical cost still fits the frame's budget, so walking doesn't hitch
  workFits(t0, budget, kind) {
    return !this.workDone || performance.now() - t0 + ((this.workCost && this.workCost[kind]) || 2) <= budget;
  }
  timedWork(kind, fn) {
    const s = performance.now();
    fn();
    const d = performance.now() - s, c = this.workCost || (this.workCost = {});
    c[kind] = c[kind] === undefined ? d : c[kind] * 0.8 + d * 0.2;
    this.workDone++;
  }
  // mesh in the chunk worker: each section request carries a version, and only the latest one is kept
  meshChunkAsync(ch) {
    const w = this.world, r = this.renderer, cw = this.chunkWorker, mv = this.meshVer || (this.meshVer = new Map());
    for (let sy = 0; sy < SECTIONS; sy++) {
      if (!(ch.dirty & (1 << sy))) continue;
      const key = ckey(ch.cx, ch.cz) * 32 + sy, ver = (mv.get(key) || 0) + 1;
      mv.set(key, ver);
      if (!ch.sectionCount[sy]) {
        const s = r.sections.get(key);
        if (s) { r.freeSection(s); r.sections.delete(key); }
        r.setSectionVis(key, VIS_ALL);
        continue;
      }
      // results wait in meshResQ: uploads are spread over frames like the rest of the chunk work
      try {
        Mesher.gather(w, ch.cx, sy, ch.cz);
        cw.mesh(Object.assign(Mesher.snapshot(w.dim), { cx: ch.cx, sy, cz: ch.cz }), (res) => (this.meshResQ || (this.meshResQ = [])).push({ res, key, ver, ch, sy, w }));
      } catch (e) { this.reportError('mesh ' + ch.cx + ',' + sy + ',' + ch.cz, e, true); ch.syncMesh = true; } // (meshed here next time)
    }
    ch.dirty = ch.syncMesh ? ALL_SECTIONS : 0;
  }
  // upload worker meshes that are still current (newest request for the section, chunk still loaded)
  applyMeshResults(t0, budget) {
    const q = this.meshResQ, r = this.renderer, mv = this.meshVer;
    let i = 0;
    for (; i < q.length; i++) {
      const m = q[i], w = m.w, ch = m.ch;
      if (!mv || mv.get(m.key) !== m.ver || this.world !== w || w.chunks.get(ckey(ch.cx, ch.cz)) !== ch) continue;
      // the worker went away or couldn't mesh it: mesh it here next time (not in the worker again)
      if (!m.res) { ch.dirty |= 1 << m.sy; ch.syncMesh = true; continue; }
      if (!this.workFits(t0, budget, 'upload')) break;
      this.timedWork('upload', () => this.guard('upload ' + ch.cx + ',' + m.sy + ',' + ch.cz, () => { r.setSection(m.key, ch.cx, m.sy, ch.cz, m.res); r.setSectionVis(m.key, m.res.vis); }));
    }
    q.splice(0, i);
  }
  meshChunk(ch) {
    const w = this.world;
    for (let sy = 0; sy < SECTIONS; sy++) {
      if (!(ch.dirty & (1 << sy))) continue;
      const key = ckey(ch.cx, ch.cz) * 32 + sy;
      if (this.meshVer) this.meshVer.set(key, (this.meshVer.get(key) || 0) + 1); // a worker result still on its way is stale
      if (!ch.sectionCount[sy]) {
        // also check if neighbours could make faces visible (only needed when this section has blocks)
        const s = this.renderer.sections.get(key);
        if (s) { this.renderer.freeSection(s); this.renderer.sections.delete(key); }
        this.renderer.setSectionVis(key, VIS_ALL);
        continue;
      }
      // (a section that fails to mesh stays undrawn; the rest of the chunk and the world go on)
      this.guard('mesh ' + ch.cx + ',' + sy + ',' + ch.cz, () => {
        const res = Mesher.build(w, ch.cx, sy, ch.cz);
        this.renderer.setSection(key, ch.cx, sy, ch.cz, res);
        this.renderer.setSectionVis(key, res.vis);
      });
    }
    ch.dirty = 0;
    ch.syncMesh = false;
  }
  // (a chunk that fails to load or generate becomes an empty one: a missing chunk would keep its neighbours
  // from being drawn and the world would stop loading around it)
  loadChunk(cx, cz) {
    try { this.loadChunkIn(cx, cz); }
    catch (e) {
      this.reportError('chunk ' + cx + ',' + cz, e, true);
      if (!this.world.chunks.has(ckey(cx, cz))) this.finishChunk(new Chunk(cx, cz), false);
    }
  }
  loadChunkIn(cx, cz) {
    const w = this.world;
    const saved = w.savedChunks && w.savedChunks.get(ckey(cx, cz));
    let ch;
    if (saved) {
      ch = new Chunk(cx, cz);
      decodeChunk(saved, ch);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const c = w.flat ? { temp: 0.3, humid: 0.2, h: 60, river: 0, cont: 0.3, mount: 0 } : w.column(cx * 16 + x, cz * 16 + z);
        ch.biome[z * 16 + x] = w.biomeOf(c);
        w.tintFor(w.grassMap, c.temp, c.humid, ch.grass, (z * 16 + x) * 3);
        w.tintFor(w.foliageMap, c.temp, c.humid, ch.foliage, (z * 16 + x) * 3);
      }
      ch.recount();
    } else {
      ch = w.generate(cx, cz);
    }
    this.finishChunk(ch, !!saved);
  }
  // a finished chunk enters the world: light it, mark it (and its neighbours) for meshing, restore its mobs
  finishChunk(ch, saved) {
    const w = this.world, cx = ch.cx, cz = ch.cz;
    w.chunks.set(ckey(cx, cz), ch);
    ch.dirty = ALL_SECTIONS;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const n = w.getChunk(cx + a, cz + b); if (n && n !== ch) n.dirty |= ALL_SECTIONS; }
    // (a failure in either still leaves the chunk in the world and on its way to being drawn)
    if (saved && !this.net && typeof RS !== 'undefined') this.guard('redstone ' + cx + ',' + cz, () => RS.settleChunk(this, ch));
    this.guard('light ' + cx + ',' + cz, () => w.initLight(ch));
    if (this.state === 'play' || this.state === 'loading') {
      // restore saved mobs
      if (this.pendingMobs && this.pendingMobs.length) {
        this.pendingMobs = this.pendingMobs.filter(m => {
          if ((Math.floor(m.pos[0]) >> 4) === cx && (Math.floor(m.pos[2]) >> 4) === cz) {
            this.entities.push(this.restoreMob(m)); return false;
          }
          return true;
        });
      }
      // dropped items, orbs and arrows parked when the chunk unloaded (dims.js parkEntities)
      const parked = w.parked && w.parked.get(ckey(cx, cz));
      if (parked) { w.parked.delete(ckey(cx, cz)); for (const e of parked) this.entities.push(e); }
      if (!saved && this.dim === 'overworld' && !(this.worldMeta && this.worldMeta.noAnimals)) this.spawnAnimals(ch);
    }
  }
  spawnAnimals(ch) {
    const r = RNG(hashStr('animals' + this.world.seed + ch.cx + ':' + ch.cz));
    if (r() > 0.1) return;
    // like vanilla, only when the chunk is first generated: chunks the player never changed are not saved, so
    // without this record every reload of one added its animals again (worldMeta.animalChunks, saved with the world)
    const m = this.worldMeta, id = m ? m.id : null;
    if (this.animalChunksFor !== id || !this.animalChunks) { this.animalChunksFor = id; this.animalChunks = new Set((m && m.animalChunks) || []); }
    const k = ckey(ch.cx, ch.cz);
    if (this.animalChunks.has(k)) return;
    this.animalChunks.add(k);
    const types = ['pig', 'cow', 'sheep', 'sheep', 'chicken'];
    const t = types[r.int(types.length)];
    const n = 2 + r.int(3);
    for (let i = 0; i < n; i++) {
      const x = ch.cx * 16 + r.int(16), z = ch.cz * 16 + r.int(16);
      for (let y = HEIGHT - 2; y > SEA; y--) {
        const id = ch.getB((y << 8) | ((z & 15) << 4) | (x & 15));
        if (id === 0 || !BLOCKS[id].solid) continue;
        if (id === 2) this.entities.push(new Mob(this, t, x + 0.5, y + 1, z + 0.5));
        break;
      }
    }
  }

  // ---- per-frame update ---------------------------------------------------------------
  frame(dt, now) {
    if (!this.world) return;
    if (this.state === 'title') {
      // (under a blurred menu the scene is frozen - render: it turns on, and the panorama fades, from where it stopped)
      if (!this.titleFrozen) { this.titleYaw = (this.titleYaw || 0) + dt * 0.00004; this.updatePanorama(dt); }
      this.updateChunks(this.chunkBudget());
      // once the spawn area exists, float the camera a little above its highest point
      if (this.titleGround && this.world.isLoaded(Math.floor(this.titleCam[0]), Math.floor(this.titleCam[2]))) {
        let top = 0;
        for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) top = Math.max(top, this.world.surfaceY(Math.floor(this.titleCam[0]) + dx, Math.floor(this.titleCam[2]) + dz));
        this.titleCam[1] = top + 14; this.titleGround = false;
      }
      return;
    }
    if (this.state === 'loading') {
      this.updateChunks(30);
      const p = this.player, pcx = Math.floor(p.pos[0]) >> 4, pcz = Math.floor(p.pos[2]) >> 4;
      // (the ring waited for stays inside the view: at a view distance of 2 the 5 x 5's corners never got their
      // neighbours to be meshed and a new world stayed at「区块: 37」for good - players' feedback 2026-10-31)
      let ready = 0, need = 0;
      const R = Math.max(0, Math.min(2, (this.settings.renderDist | 0) - 1));
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) { need++; const ch = this.world.getChunk(pcx + dx, pcz + dz); if (ch && !ch.dirty) ready++; }
      this.loadProgress = ready / need;
      this.chunkWatchdog(pcx, pcz, now);
      if (ready === need) {
        if (this.onDimReady) { const f = this.onDimReady; this.onDimReady = null; f(); this.flushMesh(); }
        if (p.needsGround) {
          const x = Math.floor(p.pos[0]), z = Math.floor(p.pos[2]);
          let y = HEIGHT - 2;
          while (y > 0 && !BLOCKS[this.world.getBlock(x, y, z)].solid && !IS_FLUID[this.world.getBlock(x, y, z)]) y--;
          p.pos[1] = y + 1; p.prev[1] = y + 1; p.spawn = [x, y + 1, z]; p.needsGround = false;
          this.worldMeta.spawn = p.spawn;
          if (this.worldMeta.bonus && !this.worldMeta.bonusPlaced) { this.worldMeta.bonusPlaced = true; this.placeBonusChest(x, z); }
        }
        this.state = 'play';
        this.ui.close();
        // a new world (or dimension) starts at full resolution, whatever the last one had come down to
        if (typeof DynRes !== 'undefined') DynRes.reset(this);
        // the room service's sponsor line, held on the chat's bottom row from the moment the world shows
        if (this.pendingPin) { const q = this.pendingPin; this.pendingPin = null; this.ui.pinMessage(q.text, q.ms); }
        if (this.welcome) { this.welcome = false; this.ui.message(`欢迎来到 ${this.worldMeta.name}！` + (touchOn(this) ? '点右上角的暂停 → 游戏说明 查看触屏操作。' : '按 H 查看操作说明。'), '#FFFF55'); }
        // opened as a file: no background threads, so world generation runs here and stutters
        if (location.protocol === 'file:' && !this.fileHint) { this.fileHint = true; this.ui.message('当前是直接打开 index.html 的方式，浏览器不允许后台线程，地形生成会让游戏很卡。请双击“启动游戏.bat”启动（会自动开本地服务器）。', '#FF5555'); }
        this.lastSave = now;
        Sound.init();
      }
      return;
    }
    if (this.state !== 'play') return;
    this.updateChunks(this.chunkBudget());
    if (!this.net) this.chunkWatchdog(Math.floor(this.player.pos[0]) >> 4, Math.floor(this.player.pos[2]) >> 4, now);
    if (this.saveQ) this.autosaveStep();
    else if (now - this.lastSave > 45000) { this.lastSave = now; this.autosaveStart(); }
    // mouse look handled in input; continuous mining handled in tick
  }
  // The 45 s autosave: the modified chunks of the dimension the player is in are encoded a few a frame first - each as
  // collectDimSave would (into the world's saved records and the dimension's list to write, no longer modified) - and
  // then saveWorld writes them with the rest. It encodes again any changed meanwhile (modified again), so what it writes
  // is the world at that moment; until then nothing was written, the last save stands. All at once it took 19 - 20 ms
  // on a desktop for 60 chunks (0.33 ms each - random ticks alone mark the chunks around the player), a hitch every 45 s
  // several times that on a phone; now at most ~1.8 ms a frame over ~12 frames, then 0.2 ms. Leaving, hiding the page,
  // changing dimension save at once as before (saveWorld drops the queue), the chunks already encoded with the rest
  autosaveStart() {
    const w = this.world, q = [];
    if (this.worldMeta && !this.net && !this.p2pGuest && w && w.savedChunks && this.dirtySaved) for (const ch of w.chunks.values()) if (ch.modified) q.push(ch);
    if (q.length) this.saveQ = { w, dirty: this.dirtySaved, q, i: 0 }; else this.saveWorld(true);
  }
  autosaveStep() {
    const S = this.saveQ, w = this.world;
    // (another world or dimension meanwhile: what was encoded waits in that dimension's list for the next save, the
    // switch encoded the rest - dims.js)
    if (w !== S.w || this.dirtySaved !== S.dirty || this.state !== 'play') { this.saveQ = null; return; }
    const t0 = performance.now();
    do {
      const ch = S.q[S.i++], k = ckey(ch.cx, ch.cz);
      if (!ch.modified || w.chunks.get(k) !== ch) continue; // (unloaded since: encoded then)
      const rec = encodeChunk(ch);
      w.savedChunks.set(k, rec); if (w.savedIndex) w.savedIndex.add(k); S.dirty.add(k); ch.modified = false;
    } while (S.i < S.q.length && performance.now() - t0 < 1.5);
    if (S.i < S.q.length) return;
    // (one changed again since it was encoded is encoded and listed again by collectDimSave: not from the list too, or
    // it was written twice)
    for (const ch of S.q) if (ch.modified && w.chunks.get(ckey(ch.cx, ch.cz)) === ch) S.dirty.delete(ckey(ch.cx, ch.cz));
    this.saveQ = null; this.saveWorld(true);
  }

  // vanilla's FOV modifier: flying x1.1, movement speed (sprinting 1.3x -> (1.3 + 1) / 2), the bow drawn; it moves
  // half way to its target each tick (and is drawn between ticks), so the change takes about 0.2 s at any frame rate
  tickFov() {
    const p = this.player; if (!p) return;
    let t = 1;
    if (p.flying) t *= 1.1;
    if (p.sprinting) t *= 1.15;
    if (p.usingItem === item('bow')) { const f = Math.min(1, p.useT / 20); t *= 1 - f * f * 0.15; }
    this.oFovMod = this.fovMod ?? 1;
    this.fovMod = this.oFovMod + (t - this.oFovMod) * 0.5;
  }
  // ---- 20 TPS tick ---------------------------------------------------------------------------
  tick() {
    if (!this.world) return;
    if (this.state === 'title') { this.world.time++; return; } // (the sun stays where it is behind the title screen)
    if (this.state !== 'play') return;
    if (this.ui.screen && this.ui.screen.pauses) return;
    this.tickCount++;
    this.tickFov();
    this.world.time++;
    this.worldTime += this.net && this.timeRate != null ? this.timeRate : 1; // a server's clock may be stopped
    const p = this.player;
    // an item this game doesn't have in the inventory (put there from an old world's chest, a room's, a bad drop): every
    // use of the hand threw with it each tick and the hand wasn't drawn - "interaction: reading 'tool'", "render: reading
    // 'block'" (telemetry 11-02/03). It goes (entity.js knownStack)
    for (let i = 0, s = p.inv.slots; i < s.length; i++) if (s[i] && !ITEMS[s[i].id]) s[i] = knownStack(s[i], this, 'inventory');
    // weather
    if (this.dim !== 'overworld') { /* no weather outside the overworld */ }
    else if (!this.net && !this.p2pGuest && --this.weatherTimer < 0) { this.rainTarget = this.rainTarget ? 0 : 1; this.weatherTimer = this.rainTarget ? 6000 + Math.random() * 12000 : 12000 + Math.random() * 36000; }
    this.weather += clamp(this.rainTarget - this.weather, -0.01, 0.01);
    const input = this.ui.screen ? { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false } : this.readInput();
    if (this.tickSleep()) { }
    else if (!p.loadedHere()) { p.savePrev(); }
    else { if (p.respawnGround) this.guard('respawn', () => this.respawnSettle()); this.guard('player', () => p.tick(input)); }
    this.tickPlayerBody(p);
    if (this.net) { this.guard('interaction', () => this.handleInteraction()); this.guard('net', () => this.netTick()); return; }
    if (this.p2pGuest) { this.guard('interaction', () => this.handleInteraction()); this.guard('p2p', () => this.p2pGuest.tick()); return; } // a local room's guest (p2p.js): the host runs the world // on a server: everything else is the server's (net.js)
    if (p.pos[1] + (this.world.minY || 0) < 16 && p.pos[1] < SEA - 30 && !this.adv.deep) this.grant('deep');
    if (!this.sleeping) this.guard('interaction', () => this.handleInteraction()); // (asleep: no mining the bed away)
    this.guard('portals', () => this.tickPortals());
    // in a wall (vanilla isInWall: a small box at the eyes inside a full, opaque block - sand fallen on the player,
    // a block placed into them): 1 damage every half second. There was none - buried players just saw through the
    // ground: "沙子埋住不窒息还会透视", feedback 2026-11-01/02 (the view is covered too: Ui, inWallBlock)
    if (this.tickCount % 10 === 0 && !p.creative && !p.noClip && p.deathTime === 0 && this.inWallBlock()) p.hurt(1, { type: 'in_wall' });
    if (this.state !== 'play') return;
    if (this.tickCount % 2 === 0) this.guard('ender stare', () => this.checkEnderStare());
    if (this.tickCount % 20 === 0) this.guard('spawners', () => this.tickSpawners());
    this.guard('chest lids', () => this.tickChestLids());
    // entities
    for (const e of this.entities) {
      if (e.dead) continue;
      if (!e.alwaysTick && (!this.world.isLoaded(Math.floor(e.pos[0]), Math.floor(e.pos[2])) || !this.world.isLoaded(Math.floor(e.pos[0]) + 16, Math.floor(e.pos[2])) || !this.world.isLoaded(Math.floor(e.pos[0]) - 16, Math.floor(e.pos[2])))) { e.savePrev(); continue; }
      this.tickEntity(e);
    }
    this.guard('passengers', () => this.seatPassengers());
    // (every monster, as vanilla's peaceful: some count as monsters by their spawn category only - they stayed and attacked)
    if (this.difficulty === 0) for (const e of this.entities) if (e instanceof Mob && (e.T.hostile || e.T.cat === 'monster')) e.dead = true;
    this.entities = this.entities.filter(e => !e.dead);
    this.guard('particles', () => this.particles.tick());
    this.guard('scheduled ticks', () => this.world.tickScheduled());
    this.guard('random ticks', () => this.world.randomTick(Math.floor(p.pos[0]), Math.floor(p.pos[2]), this.rng || (this.rng = RNG(12345))));
    this.guard('furnaces', () => this.tickFurnaces());
    if (this.ui.screen && this.ui.screen.stillValid) this.guard('screen', () => this.ui.screen.stillValid());
    if (this.tickCount % 20 === 0) this.guard('spawning', () => { if (this.dim === 'overworld') this.spawnMobs(); else this.spawnMobsDim(); });
    if (this.tutorial >= 0) {
      this.tutStat.moved += Math.hypot(p.pos[0] - p.prev[0], p.pos[2] - p.prev[2]);
      if (this.ui.screen instanceof ContainerScreen) this.tutStat.inv = true;
      if (TUTORIAL[this.tutorial].done(this)) { Sound.toast(); this.tutorial++; if (this.tutorial >= TUTORIAL.length) this.tutorial = -1; }
    }
    if (this.tickCount % 20 === 0) {
      const px = Math.floor(p.pos[0]), py = Math.floor(p.pos[1]), pz = Math.floor(p.pos[2]);
      if (!this.adv.fortress && this.dim === 'nether' && this.world.inFortress(px, py, pz)) this.grant('fortress');
      if (!this.adv.eye_spy && this.dim === 'overworld') { const s = this.nearestStronghold(); if (s && Math.abs(s.x - px) < 40 && Math.abs(s.z - pz) < 40 && py < s.y + 8 && py >= s.y - 1) this.grant('eye_spy'); }
    }
    this.armorSounds();
    if (this.tickCount % 20 === 0 && !this.adv.armor && p.inv.slots.slice(36).some(s => s && ITEMS[s.id].key.startsWith('iron_'))) this.grant('armor');
    // first night advancement
    if (!this.adv.night && this.mode === 'survival' && this.dayTime() > 23500 && this.worldTime > 20000) this.grant('night');
    // rain splashes
    if (this.dim === 'overworld' && this.weather > 0.2 && this.tickCount % 2 === 0) this.rainParticles();
    // eye in fluid
    const eyeY = p.pos[1] + p.eye();
    const eb = this.world.getBlock(Math.floor(p.pos[0]), Math.floor(eyeY), Math.floor(p.pos[2]));
    this.headInWater = this.world.waterAt(Math.floor(p.pos[0]), Math.floor(eyeY), Math.floor(p.pos[2])); this.headInLava = eb === LAVA;
    this.headInPowder = eb === BID.powder_snow && this.mode !== 'spectator';
    // vanilla water vision: the view under water clears up over ~30 s
    this.waterVisionT = this.headInWater ? (this.waterVisionT || 0) + 1 : 0;
    { const t = this.waterVisionT; this.waterVision = t >= 600 ? 1 : clamp(t / 100, 0, 1) * 0.6 + (t < 100 ? 0 : clamp((t - 100) / 500, 0, 1)) * 0.4; }
    if (this.headInWater && Math.random() < 0.1) this.particles.spawn('bubble', p.pos[0] + (Math.random() - 0.5), eyeY - 0.5, p.pos[2] + (Math.random() - 0.5), 0, 0.05, 0);
    // torch / lava ambient particles near player
    this.ambientParticles();
    this.bubbleColumnFx();
    this.guard('ambient sounds', () => this.ambientSounds());
    Sound.listener = { x: p.pos[0], y: p.pos[1] + 1.6, z: p.pos[2], yaw: p.yaw };
  }
  // Chunks next to the player (the 7 x 7 the loading screen and drawing need) that have been missing for 8 s
  // while nothing around them arrived: whatever they wait for (a generation job, the chunk worker, a saved
  // record being read) is forgotten and they are asked for again. Before, a chunk lost on its way (an error,
  // an answer that never came) was never asked for again: loading stopped (区块：60) or a hole stayed open
  // with its neighbours undrawn.
  chunkWatchdog(pcx, pcz, now) {
    const w = this.world;
    if (!w || w.remote || now - (this.wdT || 0) < 1000) return;
    // (frames back after a hidden tab / an app in the background: nothing could arrive meanwhile - start the wait
    // again instead of reporting, and throwing away, the work still on its way)
    const gap = now - (this.wdT || 0) > 3000;
    this.wdT = now;
    const missing = [], R = this.state === 'title' ? 6 : this.settings.renderDist, R2 = (R + 1.5) * (R + 1.5);
    // (only chunks that are ever made: generation stops at R + 1.5 - at a view distance of 2 the 7 x 7's corners never
    // come, and they were reported, and asked for again, every 8 s for good)
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (dx * dx + dz * dz <= R2 && !w.chunks.has(ckey(pcx + dx, pcz + dz))) missing.push(ckey(pcx + dx, pcz + dz));
    // (the same chunks still missing, however many others arrived meanwhile: the nearest come first, so these
    // are not just slow)
    const sig = pcx + ',' + pcz + ':' + missing.join(',');
    if (!missing.length || sig !== this.wdSig || gap) { this.wdSig = sig; this.wdSince = now; return; }
    if (now - this.wdSince < 8000) return;
    // (generation still moving - terrain2.js genProgressT, a job finished in the last 4 s - is not a stall: these wait
    // behind work still being done, on a slow phone for more than 8 s, and were reported, their jobs thrown away)
    if (now - (this.genProgressT || 0) < 4000) { this.wdSince = now; return; }
    this.wdSince = now;
    this.reportError('区块加载停住了，重新请求 ' + missing.length + ' 个区块', new Error('chunk stall'), true);
    const cw = this.chunkWorker, gone = [];
    for (const k of missing) {
      if (this.genPending) this.genPending.delete(k);
      if (w.protoKeys && w.protoKeys.delete(k)) gone.push(k);
      if (w.savedFetch instanceof Map) w.savedFetch.delete(k);
    }
    if (gone.length && cw && !cw.failed && cw.world === w) cw.post({ type: 'unloaded', epoch: cw.epoch, keys: gone });
    if (cw && !cw.failed && cw.meshCb.size && now - (cw.lastMesh || 0) > 10000) { for (const cb of cw.meshCb.values()) cb(null); cw.meshCb.clear(); }
    this._lastCC = null; // the (non-gen-2) generation queue is built again
  }
  // one entity's tick: an entity whose tick keeps failing (5 ticks in a row) is taken out of the world, so
  // one broken mob can't stop everything else
  tickEntity(e) {
    try { e.tick(); e.tickErrs = 0; }
    catch (err) {
      e.tickErrs = (e.tickErrs || 0) + 1;
      this.reportError('entity ' + (e.type || e.constructor.name), err, e.tickErrs < 5);
      if (e.tickErrs >= 5) e.dead = true;
    }
  }
  readInput() {
    const k = this.keys;
    const d = (n) => bindDown(this, n), s = this.settings, th = this.touchHeld || {};
    return {
      fwd: (d('forward') ? 1 : 0) - (d('back') ? 1 : 0), strafe: (d('right') ? 1 : 0) - (d('left') ? 1 : 0),
      jump: d('jump'), sneak: (s.toggleSneak ? !!this.sneakToggled : d('sneak')) || !!th.sneak || !!th.down,
      sprint: (s.toggleSprint ? !!this.sprintToggled : d('sprint')) || !!this.sprintToggle || !!th.sprint,
    };
  }
  ambientParticles() {
    const p = this.player, w = this.world;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(p.pos[0] + (Math.random() - 0.5) * 24), y = Math.floor(p.pos[1] + (Math.random() - 0.5) * 16), z = Math.floor(p.pos[2] + (Math.random() - 0.5) * 24);
      const id = w.getBlock(x, y, z);
      if (id === 21) {
        const m = w.getMeta(x, y, z), D = DIRS[m]; // (a meta past the 6 sides - an imported or a room's torch: as a standing one)
        let fx = x + 0.5, fy = y + 0.7, fz = z + 0.5;
        if (m && D) { fx = x + 0.5 + D[0] * 0.38 - D[0] * 0.32 * 0.6; fz = z + 0.5 + D[2] * 0.38 - D[2] * 0.32 * 0.6; fy = y + 0.92; }
        this.particles.spawn('flame', fx, fy, fz, 0, 0.002, 0).life = 12;
        this.particles.spawn('smoke', fx, fy + 0.05, fz, 0, 0.01, 0).size = 0.06;
      } else if (id === LAVA && w.getBlock(x, y + 1, z) === 0 && Math.random() < 0.05) {
        this.particles.spawn('lava', x + Math.random(), y + 1, z + Math.random(), (Math.random() - 0.5) * 0.1, 0.25, (Math.random() - 0.5) * 0.1);
        if (Math.random() < 0.3) Sound.noise([x, y, z], { type: 'bandpass', freq: 400, q: 2, dur: 0.1, vol: 0.3 });
      }
    }
  }
  // bubble columns near the player (vanilla BubbleColumnBlock.animateTick): found once a second within 12 blocks, then
  // every tick bubbles rise through the ones over soul sand and the water swirls down at the top of the ones over magma
  bubbleColumnFx() {
    const p = this.player, w = this.world;
    if (BID.soul_sand === undefined) return;
    if (!this.bubbleCols || this.tickCount % 20 === 0) {
      const cols = [], px = Math.floor(p.pos[0]), py = Math.floor(p.pos[1]), pz = Math.floor(p.pos[2]);
      for (let x = px - 12; x <= px + 12; x++) for (let z = pz - 12; z <= pz + 12; z++) for (let y = py - 12; y <= py + 12; y++) {
        const b = w.getBlock(x, y, z);
        if ((b !== BID.soul_sand && b !== BID.magma_block) || w.getBlock(x, y + 1, z) !== WATER || w.getMeta(x, y + 1, z) !== 0) continue;
        let top = y + 1; while (top < y + 64 && w.getBlock(x, top + 1, z) === WATER && w.getMeta(x, top + 1, z) === 0) top++;
        if (cols.length < 64) cols.push([x, y + 1, z, top, b === BID.soul_sand]);
      }
      this.bubbleCols = cols;
    }
    for (const [x, y0, z, top, up] of this.bubbleCols) {
      if (w.getBlock(x, y0, z) !== WATER) continue; // (changed since the last look)
      if (up) {
        // two a tick: one up the middle, one anywhere in a random block of the column
        const y = y0 + Math.floor(Math.random() * (top - y0 + 1));
        this.particles.spawn('bubble', x + 0.5, y, z + 0.5, 0, 0.04, 0);
        this.particles.spawn('bubble', x + Math.random(), y + Math.random(), z + Math.random(), 0, 0.04, 0);
        if (Math.random() < 1 / 200) Sound.ev('block.bubble_column.upwards_ambient', [x + 0.5, top, z + 0.5], 0.2 + Math.random() * 0.2, 0.9 + Math.random() * 0.15);
      } else {
        this.particles.spawn('bubble', x + 0.2 + Math.random() * 0.6, top + 0.8, z + 0.2 + Math.random() * 0.6, 0, -0.05, 0);
        if (Math.random() < 1 / 200) Sound.ev('block.bubble_column.whirlpool_ambient', [x + 0.5, top, z + 0.5], 0.2 + Math.random() * 0.2, 0.9 + Math.random() * 0.15);
      }
    }
  }
  // armor put on - by hand or in the inventory - sounds of its material (vanilla LivingEntity.onEquipItem)
  armorSounds() {
    const p = this.player, arm = p.inv.slots.slice(36, 40).map(s => s ? s.id : 0);
    if (this.lastArmor) arm.forEach((id, i) => { if (id && id !== this.lastArmor[i]) Sound.ev(armorEquipSound(ITEMS[id].key), p.pos, 1, 1); });
    this.lastArmor = arm;
    // gliding: the wind (ElytraOnPlayerSoundInstance - louder with speed, silent the first second, then fading in)
    if (p.gliding) {
      this.glideT = (this.glideT || 0) + 1;
      const v2 = p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1] + p.vel[2] * p.vel[2];
      let vol = v2 >= 1e-7 ? clamp(v2 / 4, 0, 1) : 0;
      if (this.glideT < 20) vol = 0; else if (this.glideT < 40) vol *= (this.glideT - 20) / 20;
      if (!(this.glideSnd && this.glideSnd.live)) this.glideSnd = Sound.loop('item.elytra.flying');
      this.glideSnd.update(null, vol, vol > 0.8 ? 1 + (vol - 0.8) : 1);
    } else this.glideT = 0; // (the loop stops by itself without updates)
  }
  // ambient sounds (vanilla BiomeAmbientSoundsHandler / UnderwaterAmbientSoundHandler): the biome's loop, faded in
  // and out over 40 ticks; its mood - a random block around the eyes each tick, dark ones adding to the moodiness
  // (the darker the faster), at full it plays from past that block (the Overworld's is the cave sound); its
  // additions by chance. Under water: entering / leaving sounds, the underwater loop, and its additions by chance
  ambientSounds() {
    const p = this.player, w = this.world, A = this.amb || (this.amb = { loops: new Map(), mood: 0 });
    if (!p || !w || p.deathTime > 0) return;
    const x = Math.floor(p.pos[0]), ey = p.pos[1] + p.eye(), z = Math.floor(p.pos[2]);
    const under = !!this.headInWater, v = this.vbiomeAt(x, z), s = v && v.amb;
    if (A.under !== undefined && under !== A.under) Sound.ev(under ? 'ambient.underwater.enter' : 'ambient.underwater.exit', null, 1, 1);
    A.under = under;
    // loops: the one wanted gets louder, the others fade out
    const want = under ? 'ambient.underwater.loop' : s && s.loop ? s.loop.replace('minecraft:', '') : null;
    if (want && !A.loops.has(want)) A.loops.set(want, { h: null, f: 0 });
    for (const [ev, L] of A.loops) {
      L.f = clamp(L.f + (ev === want ? 1 : -1), 0, 40);
      if (!L.f && ev !== want) { if (L.h) L.h.stop(); A.loops.delete(ev); continue; }
      if (!(L.h && L.h.live)) L.h = Sound.loop(ev);
      L.h.update(null, L.f / 40, 1);
    }
    if (under) {
      if (Math.random() < 0.01) { const f = Math.random(); Sound.ev(f < 1e-4 ? 'ambient.underwater.loop.additions.ultra_rare' : f < 0.001 ? 'ambient.underwater.loop.additions.rare' : 'ambient.underwater.loop.additions', null, 1, 1); }
      return;
    }
    const mood = s && s.mood ? s.mood : this.dim === 'overworld' ? { sound: 'ambient.cave', tick_delay: 6000, block_search_extent: 8, offset: 2 } : null;
    if (mood) {
      const ext = mood.block_search_extent, n = ext * 2 + 1;
      const bx = x + Math.floor(Math.random() * n) - ext, by = Math.floor(ey) + Math.floor(Math.random() * n) - ext, bz = z + Math.floor(Math.random() * n) - ext;
      const sky = w.skyAt(bx, by, bz);
      if (sky > 0) A.mood -= sky / 15 * 0.001; else A.mood -= (w.blockLightAt(bx, by, bz) - 1) / mood.tick_delay;
      if (A.mood >= 1) {
        const dx = bx + 0.5 - p.pos[0], dy = by + 0.5 - ey, dz = bz + 0.5 - p.pos[2], d = Math.hypot(dx, dy, dz) || 1, k = (d + mood.offset) / d;
        Sound.ev(mood.sound.replace('minecraft:', ''), [p.pos[0] + dx * k, ey + dy * k, p.pos[2] + dz * k], 0.5, 1);
        A.mood = 0;
      } else A.mood = Math.max(A.mood, 0);
    }
    if (s && s.additions && Math.random() < s.additions.tick_chance) Sound.ev(s.additions.sound.replace('minecraft:', ''), null, 0.5, 1);
  }
  rainParticles() {
    const p = this.player, w = this.world;
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(p.pos[0] + (Math.random() - 0.5) * 20), z = Math.floor(p.pos[2] + (Math.random() - 0.5) * 20);
      const ch = w.getChunk(x >> 4, z >> 4); if (!ch) continue;
      if (this.isCold(x, z) || this.dryAt(x, z)) continue;
      let y = Math.floor(p.pos[1]) + 10;
      while (y > p.pos[1] - 10 && !BLOCKS[w.getBlock(x, y, z)].solid && !IS_FLUID[w.getBlock(x, y, z)]) y--;
      if (y > p.pos[1] - 10) this.particles.spawn('rain', x + Math.random(), y + 1.05, z + Math.random(), 0, 0.05, 0);
    }
  }
  // gen-2 worlds: vanilla precipitation (biome flag, temperature with height); dryAt: no rain or snow at all
  dryAt(x, z) { if (!this.world.gen2) return false; const v = this.vbiomeAt(x, z); return !!v && !v.precip; }
  isCold(x, z) {
    if (this.world.gen2) return this.snowsAt(x, this.world.surfaceY(x, z) + 1, z);
    const ch = this.world.getChunk(x >> 4, z >> 4);
    if (!ch) return false;
    const b = ch.biome[((z & 15) << 4) | (x & 15)];
    return b === BI.SNOWY || b === BI.SNOWPEAK || b === BI.FROZEN_OCEAN;
  }
  tintAt(x, z, kind) {
    const ch = this.world.getChunk(x >> 4, z >> 4);
    if (!ch) return [124, 189, 107];
    const i = (((z & 15) << 4) | (x & 15)) * 3, a = kind === 'foliage' ? ch.foliage : ch.grass;
    if (kind === 'birch') return [128, 167, 85]; if (kind === 'spruce') return [97, 153, 97]; if (kind === 'water') return [63, 118, 228];
    return [a[i], a[i + 1], a[i + 2]];
  }

  // ---- time ---------------------------------------------------------------------------
  dayTime() { return ((this.worldTime % 24000) + 24000) % 24000; }
  celestial() {
    const f0 = this.dayTime() / 24000 - 0.25;
    const f = f0 - Math.floor(f0);
    const g = 0.5 - Math.cos(f * Math.PI) / 2;
    return f + (g - f) / 3;
  }
  isDay() { const c = Math.cos(this.celestial() * Math.PI * 2); return c > 0.0; }
  daylight() { const c = Math.cos(this.celestial() * Math.PI * 2); return clamp(c * 2 + 0.5, 0, 1); }

  // ---- XP ----------------------------------------------------------------------------
  xpNeeded(l) { return l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2; }
  xpTotalFor(l) { let t = 0; for (let i = 0; i < l; i++) t += this.xpNeeded(i); return t; }
  xpLevel() { let l = 0, t = 0, x = this.player.xp; while (t + this.xpNeeded(l) <= x) { t += this.xpNeeded(l); l++; } return l; }
  addXp(n) {
    if (n <= 0) return;   // (creative players collect experience too, like vanilla)
    const before = this.xpLevel();
    this.player.xp += n;
    const after = this.xpLevel();
    if (after > before && after % 5 === 0) Sound.levelup();
  }
  // vanilla: experience drops as orbs, split into the standard orb sizes
  dropXp(x, y, z, n) {
    n = Math.floor(n);
    while (n > 0) {
      const v = XP_SIZES.find(s => s <= n) || 1;
      n -= v;
      this.entities.push(new ExperienceOrb(this, x, y, z, v));
    }
  }

  grant(key) {
    if (this.adv[key] || this.state === 'title' || !ADVANCEMENTS[key]) return;
    this.adv[key] = Date.now();
    const a = ADVANCEMENTS[key];
    this.ui.toast('进度达成！', a[0], item(a[1]));
    this.ui.message(`玩家取得了进度 [${a[0]}]`, '#55FF55');
  }

  // ---- hooks from world/entities ------------------------------------------------------------
  onBlockChanged(x, y, z, old, id, oldMeta) {
    if (old === id) return;
    // (beDraw: drawn by blockents.js besides its block model - bells)
    const beOld = BLOCKS[old] && (BLOCKS[old].beRender || BLOCKS[old].beDraw), beNew = BLOCKS[id] && (BLOCKS[id].beRender || BLOCKS[id].beDraw);
    if (beOld || beNew || old === 127 || id === 127) {
      const ch = this.world.getChunk(x >> 4, z >> 4);
      if (ch) { if (beOld || beNew) ch.chests = null; else ch.spawners = null; }
    }
    const k = `${x},${y},${z}`;
    const be = this.blockEntities.get(k);
    if (be && !(BLOCKS[id] && BLOCKS[id].chestLike) && id !== 20 && id !== 117) {
      const drops = be.type === 'brewing' ? [...(be.bottles || []), be.ingredient, be.fuel] : be.items ? be.items : be.slots ? be.slots : [be.input, be.fuel, be.output]; // (items: a campfire's food)
      // (stacks only: a command block's output is its last message - the text was spread into a "stack" with no item
      // and dropped each time one with an output broke or changed mode, then threw every frame: telemetry 11-02/03)
      for (const s of drops) if (s && typeof s === 'object') this.dropItem(x + 0.5, y + 0.5, z + 0.5, { ...s });
      this.blockEntities.delete(k);
      if (this.ui.screen && (this.ui.screen.be === be || (this.ui.screen.owns && this.ui.screen.owns(be)))) this.ui.close();
    }
  }
  onNeighborUpdate(x, y, z, id) {
    const w = this.world, b = BLOCKS[id];
    if (b && b.chestLike) {
      const m = w.getMeta(x, y, z), s = chestSeam(m);
      if (s) { const nm = w.getMeta(x + s[0], y, z + s[1]); if (w.getBlock(x + s[0], y, z + s[1]) !== id || (nm & 7) !== (m & 7) || chestType(nm) === chestType(m) || !chestType(nm)) w.setMeta(x, y, z, m & ~48); }
      return;
    }
    if (id === 170) { if (!this.portalValid(x, y, z)) w.setBlock(x, y, z, 0, 0); return; }
    if (id === 171) { if (!this.fireSupported(x, y, z)) w.setBlock(x, y, z, 0, 0); return; }
    if (b.gravity) {
      // (the id came with the update: two updates for the cell in one tick spawned a second falling block from a
      // cell already empty - one more sand)
      if (w.getBlock(x, y, z) !== id) return;
      const below = w.getBlock(x, y - 1, z);
      if (y > 0 && (below === 0 || REPLACEABLE[below] || IS_FLUID[below]) && w.isLoaded(x, z)) {
        const meta = w.getMeta(x, y, z);
        w.setBlock(x, y, z, 0, 0);
        this.entities.push(new FallingBlock(this, x, y, z, id, meta));
      }
      return;
    }
    if (this.blasting && this.blasting.has(x + ',' + y + ',' + z)) return;   // (explode: the blast takes it)
    if (b.needsSupport || b.door) {
      if (this.cmdPlaced && this.cmdPlaced === x + ',' + y + ',' + z) return;   // (cmdrun.js cmdSetBlock)
      if (this.pairBreak === x + ',' + y + ',' + z) return;   // (breakBlock taking the other half itself)
      if (!this.supported(x, y, z, id, w.getMeta(x, y, z))) this.breakBlock(x, y, z, true);
    } else if (!this.net && this.attachLost(x, y, z, id, w.getMeta(x, y, z))) this.breakBlock(x, y, z, true);
  }
  // the block a wall torch, sign, banner, ladder, lantern, button, lever, rail, dripstone, bamboo ... hangs on or stands
  // on is gone (air, a plant, a fluid): it pops off like in vanilla (players' feedback 2026-10-31: they were left floating)
  attachLost(x, y, z, id, meta) {
    const b = BLOCKS[id], k = b.key;
    if (b.attaches === undefined) b.attaches = /(^|_)(sign|banner|pressure_plate|carpet|rail|torch|fan|head|skull|button|lantern|amethyst_cluster|amethyst_bud)$|^(ladder|lever|pointed_dripstone|bamboo|redstone_wire|repeater|comparator)$/.test(k);
    if (!b.attaches) return false;
    const w = this.world, P = (n) => Features.propOf(id, meta, n);
    const gone = (dx, dy, dz) => { const n = w.getBlock(x + dx, y + dy, z + dz); return n === 0 || !!REPLACEABLE[n] || !!IS_FLUID[n]; };
    const back = (f) => { const v = { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0], up: [0, -1, 0], down: [0, 1, 0] }[f]; return !!v && gone(...v); };
    if (k === 'ladder' && !b.states) return !!DIRS[meta] && gone(DIRS[meta][0], 0, DIRS[meta][2]);
    if (IS_WALL_FORM.has(k)) return !/_wall_(head|skull|hanging_sign)$/.test(k) && back(P('facing'));
    if (k === 'lever' || /_button$/.test(k)) { const f = P('face'); return f === 'floor' ? gone(0, -1, 0) : f === 'ceiling' ? gone(0, 1, 0) : back(P('facing')); }
    if (k === 'lantern' || k === 'soul_lantern' || /copper_lantern$/.test(k)) return P('hanging') === 'true' ? gone(0, 1, 0) : gone(0, -1, 0);
    if (k === 'pointed_dripstone') return P('vertical_direction') === 'down' ? gone(0, 1, 0) : gone(0, -1, 0);
    if (/_hanging_sign$/.test(k)) return gone(0, 1, 0);
    if (/(amethyst_cluster|amethyst_bud)$/.test(k) || k === 'ladder') return back(P('facing'));
    if (/(^|_)(sign|banner|pressure_plate|carpet|rail)$/.test(k) || k === 'bamboo' || k === 'redstone_wire' || k === 'repeater' || k === 'comparator') return gone(0, -1, 0);
    return false;
  }
  // state for a block with a vanilla state list, from how it is placed (facing, axis, hanging, ...)
  placeState(b, t, hdir) {
    const F = Features, id = b.id, s0 = b.states[0];
    const NAME = ['west', 'east', 'down', 'up', 'north', 'south'];
    let m = 0;
    const set = (k, v) => { if (k in s0) m = F.withProp(id, m, k, v); };
    const has = (k, v) => b.states.some(s => s[k] === v);
    const toward = NAME[OPP[hdir]], away = NAME[hdir];
    const fy = t.point[1] - Math.floor(t.point[1]);
    if ('facing' in s0) {
      if (b.gate) set('facing', away);
      else if (has('facing', 'up') && (b.key === 'end_rod' || b.key === 'iron_chain')) set('facing', NAME[t.face]);
      else if (has('facing', 'up')) { const look = this.lookDir(); set('facing', look[1] > 0.8 ? 'down' : look[1] < -0.8 ? 'up' : toward); }
      else set('facing', toward);
    }
    if ('axis' in s0) set('axis', t.face <= 1 ? 'x' : t.face <= 3 ? 'y' : 'z');
    // standing signs, banners, heads: one of 16 turns toward the player; wall forms face away from the wall
    if ('rotation' in s0) set('rotation', String(Math.floor(16 - this.player.yaw * 8 / Math.PI + 0.5) & 15));
    if ('facing' in s0 && IS_WALL_FORM.has(b.key)) set('facing', NAME[t.face]);
    if ('hanging' in s0) set('hanging', t.face === 2 ? 'true' : 'false');
    if ('half' in s0 && has('half', 'top')) set('half', t.face === 2 || (t.face !== 3 && fy > 0.5) ? 'top' : 'bottom');
    if ('face' in s0) set('face', t.face === 3 ? 'floor' : t.face === 2 ? 'ceiling' : 'wall');
    if ('attachment' in s0) set('attachment', t.face === 3 ? 'floor' : t.face === 2 ? 'ceiling' : 'single_wall');
    if (t.face !== 2 && t.face !== 3 && ('face' in s0 || 'attachment' in s0)) set('facing', NAME[t.face]);
    if ('lit' in s0) set('lit', b.key.includes('campfire') ? 'true' : 'false');
    if ('waterlogged' in s0) set('waterlogged', 'false');
    return m;
  }
  supported(x, y, z, id, meta) {
    const w = this.world, below = w.getBlock(x, y - 1, z);
    const solidBelow = SOLIDCUBE[below] || (BLOCKS[below].slab && (w.getMeta(x, y - 1, z) & 3) !== 0) || BLOCKS[below].stairs && (w.getMeta(x, y - 1, z) & 4) === 0 || below === 63;
    const b = BLOCKS[id];
    switch (b.key) {
      case 'torch': if (!meta || !DIRS[meta]) return solidBelow; return !!SOLIDCUBE[w.getBlock(x + DIRS[meta][0], y, z + DIRS[meta][2])];
      case 'ladder': return !!SOLIDCUBE[w.getBlock(x + DIRS[meta][0], y, z + DIRS[meta][2])];
      case 'wheat': return below === 63;
      case 'sugar_cane': return below === 38 || below === 2 || below === 3 || below === 9 || below === 97;
      case 'cactus': return below === 37 || below === 9 || below === 97;
      case 'dead_bush': return below === 9 || below === 97 || below === 3 || below === 2 || below === 83;
      case 'snow': return (!!SOLIDCUBE[below] && below !== 35 && below !== 96) || (below === id && (w.getMeta(x, y - 1, z) & 7) === 7);
      case 'oak_door': return (meta & 8) ? w.getBlock(x, y - 1, z) === 69 : (SOLIDCUBE[below] && w.getBlock(x, y + 1, z) === 69);
    }
    if (b.door) return (meta & 8) ? w.getBlock(x, y - 1, z) === id : (!!SOLIDCUBE[below] && w.getBlock(x, y + 1, z) === id);
    switch (b.key) {
      case 'red_mushroom': case 'brown_mushroom': return !!SOLIDCUBE[below];
      case 'nether_wart': return below === 120;
    }
    // vanilla survival rules (supports_* tags) for everything else, incl. the data-driven plants
    if (typeof Features !== 'undefined' && (b.states || b.id >= 1024 || b.needsSupport)) return Features.canSurvive({ id: (a, c, d) => w.getBlock(a, c, d) }, id, meta, x, y, z);
    if (b.needsSupport) return below === 2 || below === 3 || below === 63 || below === 88;
    return true;
  }
  onFizz(x, y, z) { Sound.fizz([x, y, z]); for (let i = 0; i < 6; i++) this.particles.spawn('smoke', x + Math.random(), y + 1, z + Math.random(), 0, 0.05, 0); }
  onFluidDestroy(x, y, z, id, water = true) {
    const b = BLOCKS[id];
    // lava burns what it flows into (fizz, no drops)
    if (!water) { this.onFizz(x, y - 1, z); return; }
    if (b && !REPLACEABLE[id] && this.mode !== 'creative') this.dropBlockLoot(x, y, z, id, this.world.getMeta(x, y, z), null);
    else if (b && b.drops && id !== 39 && id !== 40) this.dropBlockLoot(x, y, z, id, 0, null);
  }
  // the blocks onRandomTick does something for, 1 by id (World.randomTick picks only these, and skips sections holding none):
  // the cases below; past 1023 every *_leaves, *_sapling and mangrove_propagule (its default case); mobs_animals.js
  // BLOCK_RANDOM_TICK's keys (its wrapper). A new random tick goes in here too. Made on the first tick, when every script
  // has added its own. (Of ~2500 calls a tick in a 9 x 9 chunk area all but 23 were stone, deepslate, water... through
  // two wrappers and the switch for nothing: 0.98 -> 0.25 ms a tick on a desktop, handlers included)
  randomTickTable() {
    if (this.rtTable) return this.rtTable;
    const t = new Uint8Array(MAX_BLOCKS), extra = typeof BLOCK_RANDOM_TICK !== 'undefined' ? BLOCK_RANDOM_TICK : {};
    for (const id of [2, 15, 34, 35, 37, 38, 47, 50, 63, 64, 65, 66, 67, 126, 171]) t[id] = 1;
    for (let i = 0; i < MAX_BLOCKS; i++) {
      const b = BLOCKS[i], k = b && b.key;
      if (k && (Object.prototype.hasOwnProperty.call(extra, k) || (i >= 1024 && (k.endsWith('_leaves') || k.endsWith('_sapling') || k === 'mangrove_propagule')))) t[i] = 1;
    }
    return (this.rtTable = t);
  }
  onRandomTick(x, y, z, id, ch) {
    const w = this.world;
    switch (id) {
      case 2: {
        const above = w.getBlock(x, y + 1, z);
        if (SOLIDCUBE[above] || IS_FLUID[above]) { w.setBlock(x, y, z, 3, 0); break; }
        if (w.skyAt(x, y + 1, z) >= 9 || w.blockLightAt(x, y + 1, z) >= 9) {
          const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 5) | 0) - 3, nz = z + ((Math.random() * 3) | 0) - 1;
          if (w.getBlock(nx, ny, nz) === 3 && !SOLIDCUBE[w.getBlock(nx, ny + 1, nz)] && !IS_FLUID[w.getBlock(nx, ny + 1, nz)] && (w.getLight(nx, ny + 1, nz) >> 4) >= 4) w.setBlock(nx, ny, nz, 2, 0);
        }
        break;
      }
      case 64: {
        const m = w.getMeta(x, y, z);
        if (m < 7 && Math.max(w.skyAt(x, y, z) * this.daylight(), w.blockLightAt(x, y, z)) >= 9 && Math.random() < (w.getMeta(x, y - 1, z) ? 0.5 : 0.25)) w.setMeta(x, y, z, m + 1);
        break;
      }
      case 65: case 66: case 67:
        if (Math.random() < 0.15 && (w.skyAt(x, y, z) >= 9 || w.blockLightAt(x, y, z) >= 9)) { if (!(w.gen2 && this.growTreeV(x, y, z, id))) this.growTree(x, y, z, id); }
        break;
      case 63: {
        let wet = false;
        for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4 && !wet; dz++) for (let dy = 0; dy <= 1; dy++) if (w.waterAt(x + dx, y + dy, z + dz)) { wet = true; break; }
        const m = w.getMeta(x, y, z);
        if (wet && !m) w.setMeta(x, y, z, 1);
        else if (!wet) { if (m) w.setMeta(x, y, z, 0); else if (w.getBlock(x, y + 1, z) !== 64 && Math.random() < 0.3) w.setBlock(x, y, z, 3, 0); }
        break;
      }
      case 38: case 37: {
        if (w.getBlock(x, y + 1, z) === 0 && Math.random() < 0.08) {
          let h = 1; while (w.getBlock(x, y - h, z) === id) h++;
          if (h < 3) w.setBlock(x, y + 1, z, id, 0);
        }
        break;
      }
      case 15: case 47: case 50: {
        if (w.getMeta(x, y, z) & 4) break; // player placed
        if (!this.nearLog(x, y, z)) this.breakBlock(x, y, z, true, true);
        break;
      }
      default: {
        const b = BLOCKS[id];
        if (!b || id < 1024) break;
        if (b.key.endsWith('_leaves')) { if (!(w.getMeta(x, y, z) & 4) && !this.nearLog(x, y, z)) this.breakBlock(x, y, z, true, true); }
        else if ((b.key.endsWith('_sapling') || b.key === 'mangrove_propagule') && Math.random() < 0.15 && (w.skyAt(x, y, z) >= 9 || w.blockLightAt(x, y, z) >= 9)) this.growTreeV(x, y, z, id);
        break;
      }
      case 171: this.fireTick(x, y, z); break;
      case 126: { const m = w.getMeta(x, y, z); if (m < 3 && Math.random() < 0.15) w.setMeta(x, y, z, m + 1); break; }
      case 34: case 35:
        if (w.blockLightAt(x, y, z) > 11 || (id === 35 && w.blockLightAt(x, y + 1, z) > 11)) { if (id === 35) w.setBlock(x, y, z, WATER, 0); else w.setBlock(x, y, z, 0, 0); }
        break;
    }
  }
  nearLog(x, y, z) {
    const w = this.world, seen = new Set([`${x},${y},${z}`]), q = [[x, y, z, 0]];
    while (q.length) {
      const [a, b, c, d] = q.shift();
      for (const D of DIRS) {
        const nx = a + D[0], ny = b + D[1], nz = c + D[2], k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue; seen.add(k);
        if (!w.isLoaded(nx, nz)) return true;
        const id = w.getBlock(nx, ny, nz);
        if (id === 14 || id === 46 || id === 49 || LOG_IDS.has(id)) return true;
        if ((id === 15 || id === 47 || id === 50 || LEAF_IDS.has(id)) && d < 6) q.push([nx, ny, nz, d + 1]);
      }
    }
    return false;
  }
  growTree(x, y, z, sap) {
    const w = this.world;
    const type = sap === 66 ? 'birch' : sap === 67 ? 'spruce' : (Math.random() < 0.1 ? 'big' : 'oak');
    const h = 4 + ((Math.random() * 3) | 0);
    for (let dy = 1; dy <= h + 1; dy++) { const id = w.getBlock(x, y + dy, z); if (id && !BLOCKS[id].replaceable && id !== 15 && id !== 47 && id !== 50) return false; }
    w.setBlock(x, y, z, 0, 0, 0);
    this.world.placeTree((wx, wy, wz, id, meta, force) => {
      const cur = w.getBlock(wx, wy, wz);
      if (force ? cur !== 6 : (cur === 0 || REPLACEABLE[cur])) w.setBlock(wx, wy, wz, id, meta);
    }, { x, y, z, type, h, seed: (Math.random() * 1e9) | 0 });
    return true;
  }

  // ---- mob spawning ----------------------------------------------------------------------
  spawnMobs() {
    if (this.mode === 'creative' && !this.settings.creativeMobs) { }
    const p = this.player, w = this.world;
    const hostiles = this.entities.filter(e => e instanceof Mob && e.T.hostile).length;
    const passives = this.entities.filter(e => e instanceof Mob && e.T.passive && e.distTo(p) < 96).length;
    const day = this.daylight();
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 40;
      const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
      if (!w.isLoaded(x, z)) continue;
      const surface = w.surfaceY(x, z);
      // choose y: surface or random cave spot
      let y = surface + 1;
      if (Math.random() < 0.5) {
        const ty = 8 + Math.floor(Math.random() * Math.max(1, surface - 10));
        if (w.getBlock(x, ty, z) === 0 && w.getBlock(x, ty + 1, z) === 0 && BLOCKS[w.getBlock(x, ty - 1, z)].solid) y = ty;
      }
      if (w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0 || !SOLIDCUBE[w.getBlock(x, y - 1, z)]) continue;
      const l = w.getLight(x, y, z), sky = (l >> 4) * day, blk = l & 15;
      if (blk === 0 && sky <= 7 && hostiles < 22 && this.difficulty > 0 && Math.random() < 0.6 && Math.hypot(x - p.pos[0], z - p.pos[2]) > 24) {
        const r = Math.random();
        const type = r < 0.32 ? 'zombie' : r < 0.55 ? 'skeleton' : r < 0.76 ? 'creeper' : r < 0.89 ? 'spider' : 'enderman';
        const m = createMob(this, type, x + 0.5, y, z + 0.5);
        m.persistent = false;
        if (!m.collides(m.box())) this.entities.push(m);
      } else if (passives < 12 && day > 0.8 && w.getBlock(x, y - 1, z) === 2 && sky >= 9 && Math.random() < 0.02) {
        const t = ['pig', 'cow', 'sheep', 'chicken'][(Math.random() * 4) | 0];
        for (let i = 0; i < 2 + Math.random() * 2; i++) this.entities.push(new Mob(this, t, x + 0.5 + Math.random(), y, z + 0.5 + Math.random()));
      }
    }
  }

  // ---- furnaces ---------------------------------------------------------------------------
  tickFurnaces() {
    for (const [k, be] of this.blockEntities) {
      if (be.type !== 'furnace') continue;
      const [x, y, z] = be.pos;
      if (!this.world.isLoaded(x, z)) continue;
      const wasBurning = be.burn > 0;
      if (be.burn > 0) be.burn--;
      const kind = be.kind || 'smelting', rec = be.input && COOKING[kind][be.input.id];
      be.cookMax = rec ? rec.time : be.cookMax || 200;
      const canSmelt = rec && (!be.output || (be.output.id === rec.result && be.output.count < maxStack(rec.result)));
      if (be.burn === 0 && canSmelt && be.fuel) {
        const f = Math.floor(fuelValue(be.fuel.id) / (kind === 'smelting' ? 1 : 2));
        if (f) {
          be.burn = be.burnMax = f;
          if (be.fuel.id === item('lava_bucket')) be.fuel = makeStack('bucket');
          else { be.fuel.count--; if (!be.fuel.count) be.fuel = null; }
        }
      }
      if (be.burn > 0 && canSmelt) {
        if (++be.cook >= be.cookMax) {
          be.cook = 0;
          if (be.output) be.output.count++; else be.output = { id: rec.result, count: 1, dmg: 0 };
          be.xp = (be.xp || 0) + rec.xp;
          be.input.count--; if (!be.input.count) be.input = null;
        }
      } else if (be.cook > 0) be.cook = Math.max(0, be.cook - 2);
      const burning = be.burn > 0;
      if (burning !== wasBurning) {
        const id = this.world.getBlock(x, y, z), meta = this.world.getMeta(x, y, z), fb = BLOCKS[id];
        if (id === 20 || id === 117) this.world.setBlock(x, y, z, burning ? 117 : 20, meta, 0);
        else if (fb && fb.states && 'lit' in fb.states[0]) this.world.setMeta(x, y, z, Features.withProp(id, meta, 'lit', burning ? 'true' : 'false'));
      }
    }
  }
  markBlockEntity() { }
  getBlockEntity(x, y, z, type) {
    const k = `${x},${y},${z}`;
    let be = this.blockEntities.get(k);
    if (!be) {
      be = type === 'chest' ? { type, pos: [x, y, z], slots: new Array(27).fill(null) } : { type, pos: [x, y, z], input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
      this.blockEntities.set(k, be);
    }
    return be;
  }
  trySleep(x, y, z) {
    const p = this.player, w = this.world;
    const meta = w.getMeta(x, y, z);
    let hx = x, hz = z;
    if (!(meta & 4)) { const D2 = DIRS[[4, 1, 5, 0][meta & 3]]; hx += D2[0]; hz += D2[2]; }
    p.spawn = [hx, y + 1, hz]; p.bedSpawn = true;
    const t = this.dayTime();
    // (vanilla's night: 12542 to 23459 - before, from 23459 to 1000 of the morning counted as night too, and a player
    // just woken could lie down again at once: "睡醒后点床还能再睡", "白天也能睡觉"; no thunderstorms here, rain doesn't count)
    if (t < 12542 || t > 23459) { this.ui.actionBar = { text: '你只能在夜间或雷暴中入睡（已设置重生点）', t: performance.now() }; return; }
    if (Math.hypot(p.pos[0] - hx - 0.5, p.pos[2] - hz - 0.5) > 3) { this.ui.actionBar = { text: '你离床太远了', t: performance.now() }; return; }
    const danger = this.entities.some(e => e instanceof Mob && e.T.hostile && e.deathTime === 0 && Math.abs(e.pos[0] - hx) < 8 && Math.abs(e.pos[1] - y) < 5 && Math.abs(e.pos[2] - hz) < 8);
    if (danger) { this.ui.actionBar = { text: '你现在不能休息，周围有怪物在游荡', t: performance.now(), color: '#FF5555' }; return; }
    this.sleeping = { x: hx + 0.5, y: y + 0.5625, z: hz + 0.5, t: 0, rot: meta & 3, bed: [hx, y, hz], foot: [x === hx && z === hz ? hx - DIRS[[4, 1, 5, 0][meta & 3]][0] : x, y, x === hx && z === hz ? hz - DIRS[[4, 1, 5, 0][meta & 3]][2] : z] };
    p.vel = [0, 0, 0];
    this.ui.message('正在睡觉…（' + (touchOn(this) ? '点击潜行按钮' : '按 Shift ') + '起床）', '#AAAAAA');
  }
  tickSleep() {
    const s = this.sleeping, p = this.player;
    if (!s) { if (this.sleepFade > 0) this.sleepFade = Math.max(0, this.sleepFade - 0.05); return false; }
    s.t++;
    p.pos = [s.x, s.y, s.z]; p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
    this.sleepFade = Math.min(1, s.t / 80);
    const wake = bindDown(this, 'sneak') || p.hurtTime > 0;
    // in a room the server keeps the night and wakes everyone (netSelfMeta ends this); sneaking asks it to get up
    // (not all dark there: the others may stay up a long while)
    if (s.net) { this.sleepFade = Math.min(0.7, this.sleepFade); if (wake && !s.asked && this.net) { s.asked = true; this.net.send({ t: 'wake' }); } return true; }
    if (s.t >= 100) {
      this.worldTime = (Math.floor(this.worldTime / 24000) + 1) * 24000;
      if (this.rainTarget) { this.rainTarget = 0; this.weather = 0; }
      this.ui.message('早上好！', '#FFFF55'); this.grant('sleep');
    }
    if (s.t >= 100 || wake) {
      this.sleeping = null;
      this.standUp(s);
    }
    return true;
  }
  // getting out of bed (vanilla BedBlock.findStandUpPosition): a free spot with a floor beside the bed, around the head
  // then the foot; only without one on top of the bed. It used to go straight up until free - through a low ceiling
  // onto the roof: "睡醒后在房顶上", feedback 2026-11-01/02
  standUp(s) {
    const p = this.player, w = this.world;
    const fits = (x, y, z) => { p.pos = [x + 0.5, y, z + 0.5]; return !p.collides(p.box()); };
    const floor = (x, y, z) => { const id = w.getBlock(x, y - 1, z); return !!(BLOCKS[id] && BLOCKS[id].solid) && !IS_FLUID[w.getBlock(x, y, z)]; };
    for (const c of [s.bed, s.foot].filter(Boolean)) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = c[0] + dx, z = c[2] + dz;
        for (const y of [c[1], c[1] + 1, c[1] - 1]) if (floor(x, y, z) && fits(x, y, z)) { p.prev = [...p.pos]; return; }
      }
    }
    p.pos = [s.x, s.y, s.z];
    while (p.collides(p.box()) && p.pos[1] < HEIGHT) p.pos[1] += 1;
    p.prev = [...p.pos];
  }
  fillLoot(be, x, y, z) {
    const r = RNG(hashStr('loot' + this.world.seed + ':' + x + ':' + y + ':' + z));
    // vanilla loot table of a structure chest
    if (be.loot) { if (typeof Loot !== 'undefined') Loot.fill(be.slots, be.loot, r); delete be.loot; return; }
    const table = [['bread', 1, 3, 0.5], ['wheat', 1, 4, 0.5], ['iron_ingot', 1, 4, 0.55], ['gold_ingot', 1, 3, 0.35], ['coal', 3, 8, 0.5], ['string', 1, 4, 0.4],
      ['bone', 2, 6, 0.5], ['rotten_flesh', 2, 5, 0.5], ['gunpowder', 1, 4, 0.4], ['diamond', 1, 2, 0.2], ['golden_apple', 1, 1, 0.12], ['bucket', 1, 1, 0.15],
      ['iron_pickaxe', 1, 1, 0.08], ['apple', 1, 3, 0.3], ['redstone', 2, 6, 0.25], ['emerald', 1, 2, 0.12], ['wheat_seeds', 2, 5, 0.3], ['iron_chestplate', 1, 1, 0.06], ['bow', 1, 1, 0.1], ['arrow', 4, 12, 0.25]];
    for (const [k, mn, mx, ch] of table) {
      if (r() > ch) continue;
      let slot = r.int(27); let guard = 0;
      while (be.slots[slot] && guard++ < 30) slot = r.int(27);
      be.slots[slot] = makeStack(k, mn + r.int(mx - mn + 1));
    }
  }
  onSmeltTake(st, be) {
    const id = st.id;
    if (id === item('iron_ingot')) this.grant('iron');
    if (['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken'].some(k => item(k) === id)) this.grant('cook');
    if (be.xp) { const p = this.player; this.dropXp(p.pos[0], p.pos[1] + 0.5, p.pos[2], Math.floor(be.xp + Math.random())); be.xp = 0; }
  }
  onCraft(id, count) {
    const k = ITEMS[id].key;
    if (k.endsWith('_planks') && this.tutStat) this.tutStat.planks = true;
    if (k === 'crafting_table') this.grant('crafting_table');
    if (k === 'wooden_pickaxe') this.grant('pickaxe');
    if (k === 'stone_pickaxe') this.grant('stone_pickaxe');
    if (k === 'furnace') this.grant('furnace');
    if (k === 'bread') this.grant('bread');
    if (k === 'bow') this.grant('bow');
  }
  onPickup(id, n) {
    const k = ITEMS[id].key;
    if (k.endsWith('_log')) this.grant('wood');
    if (k === 'diamond') this.grant('diamond');
    if (k === 'wheat') this.grant('farm');
    if (k === 'blaze_rod') this.grant('blaze_rod');
    if (k === 'dragon_egg') this.grant('next_gen');
  }
  onMobKilled(m, src) {
    if (src && (src.attacker === this.player || src.player)) {
      const xp = m.T.hostile ? 5 : 1 + ((Math.random() * 3) | 0);
      if (m.T.hostile) this.grant('kill');
      this.dropXp(m.pos[0], m.pos[1] + 0.5, m.pos[2], xp);
    }
  }
  onPlayerHurt(src) { this.hurtTilt = 1; }
  onPlayerDeath(src) {
    const p = this.player;
    const msgs = { in_wall: '在墙里窒息而亡', fall: '从高处摔了下来', lava: '试图在熔岩里游泳', fire: '被烧死了', drown: '淹死了', starve: '饿死了', mob: '被杀死了', arrow: '被射杀', explosion: '爆炸了', cactus: '被戳死了', void: '掉出了这个世界', hotFloor: '发现了地板是熔岩做的', lightning: '被闪电击中', freeze: '被冻死了', berry: '被甜浆果丛戳死了' };
    let msg = msgs[src && src.type] || '死了';
    if (src && src.attacker && src.attacker.T) msg = (src.type === 'arrow' ? '被' + src.attacker.T.cn + '射杀' : '被' + src.attacker.T.cn + '杀死了');
    if (src && src.type === 'explosion' && src.attacker && src.attacker.T) msg = '被' + src.attacker.T.cn + '炸死了';
    this.deathMsg = '玩家' + msg;
    this.ui.message(this.deathMsg, '#FFFFFF');
    // drop inventory
    for (let i = 0; i < 41; i++) { const s = p.inv.slots[i]; if (s && enchLevel(s, 'vanishing_curse')) { p.inv.slots[i] = null; continue; } if (s) { this.dropItem(p.pos[0], p.pos[1] + 1, p.pos[2], s, [(Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5]); p.inv.slots[i] = null; } }
    this.deathScore = p.xp; p.xp = 0;
    // effects end with death, like vanilla (players' feedback 2026-10-31: they stayed after respawning)
    if (p.clearEffects) p.clearEffects();
    setTimeout(() => { if (this.state === 'play') this.ui.open(new DeathScreen(this)); }, 1000);
  }
  respawn() {
    const p = this.player, s = p.spawn;
    if (this.net) { this.net.send({ t: 'respawn' }); p.deathTime = 0; this.ui.close(); return; } // the server places us
    if (this.dim !== 'overworld') {
      p.health = 20; p.food = 20; p.saturation = 5; p.deathTime = 0; p.fire = 0; p.air = 300; p.dead = false;
      this.ui.close();
      this.changeDimension('overworld', [s[0] + 0.5, s[1], s[2] + 0.5], () => { let y = s[1]; while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; } p.prev = [...p.pos]; });
      return;
    }
    // a bed broken or gone (where it can be seen now): the world's spawn instead, as vanilla
    if (p.bedSpawn && this.world.isLoaded(s[0], s[2]) && !(BLOCKS[this.world.getBlock(s[0], s[1] - 1, s[2])] || {}).bed) {
      p.bedSpawn = false; p.spawn = (this.worldMeta && this.worldMeta.spawn) || s; this.ui.message('你的床已丢失或被阻挡', '#FFFFFF');
      return this.respawn();
    }
    p.pos = [s[0] + 0.5, s[1], s[2] + 0.5]; p.prev = [...p.pos]; p.vel = [0, 0, 0];
    p.health = 20; p.food = 20; p.saturation = 5; p.deathTime = 0; p.fire = 0; p.air = 300; p.fallDist = 0; p.dead = false;
    let y = s[1];
    while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
    p.prev = [...p.pos];
    p.respawnGround = true;
    this.ui.close();
  }
  // after a respawn, once the spot's chunk is there: down onto the ground if it is in the air (the spawn's chunk was
  // often not loaded at the respawn - nothing to stand on, the player left at the saved height and fell: "复活在高空摔死",
  // feedback 2026-11-01/02), up out of blocks if in them
  // the full opaque block at the player's eyes, or 0
  inWallBlock() {
    const p = this.player, w = this.world; if (!p || !w) return 0; // (no world while joining a room: the HUD asked - "render: reading 'getBlock'")
    const y = Math.floor(p.pos[1] + p.eye()), r = p.w * 0.4;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const id = w.getBlock(Math.floor(p.pos[0] + dx), y, Math.floor(p.pos[2] + dz));
      if (SOLIDCUBE[id] && AOCUBE[id]) return id;
    }
    return 0;
  }
  respawnSettle() {
    const p = this.player, w = this.world, x = Math.floor(p.pos[0]), z = Math.floor(p.pos[2]);
    if (!w.isLoaded(x, z) || !w.isLoaded(x + 16, z) || !w.isLoaded(x - 16, z)) return;
    p.respawnGround = false;
    if (p.flying || p.noClip) return;
    let y = Math.floor(p.pos[1]);
    while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
    const solid = (yy) => { const id = w.getBlock(x, yy, z); return !!(BLOCKS[id] && BLOCKS[id].solid) || IS_FLUID[id]; };
    let g = y - 1; while (g > 0 && !solid(g)) g--;
    if (y - 1 - g > 1 && g > 0) { p.pos[1] = g + 1; p.vel = [0, 0, 0]; p.fallDist = 0; }
    p.prev = [...p.pos];
  }

  // ---- items & drops ---------------------------------------------------------------------
  dropItem(x, y, z, stack, vel) {
    stack = knownStack(stack, this, 'drop'); // (no item this game has, or none of it: nothing drops - entity.js knownStack)
    if (!stack) return;
    const e = new ItemEntity(this, x, y, z, { ...stack, dmg: stack.dmg || 0 }, vel); // the whole stack (enchantments, name, potion ...)
    this.entities.push(e);
    return e;
  }
  dropFromPlayer(stack) {
    const p = this.player;
    const dir = this.lookDir();
    const e = this.dropItem(p.pos[0], p.pos[1] + p.eye() - 0.3, p.pos[2], stack, [dir[0] * 0.3, dir[1] * 0.3 + 0.1, dir[2] * 0.3]);
    if (e) e.pickup = 40;
  }
  addEntity(e) { this.entities.push(e); }
  dropBlockLoot(x, y, z, id, meta, tool) {
    const b = BLOCKS[id];
    let drops;
    if (tool && ITEMS[tool.id].key === 'shears' && (b.key.endsWith('leaves') || id === 39 || id === 40 || id === 45 || b.key === 'cobweb')) drops = [[id, 1]];
    else if (b.drops && enchLevel(tool, 'silk_touch') && ITEMS[id] && !b.noItem && !NO_SILK.has(b.key)) drops = [[id, 1]];
    else if (b.drops) {
      drops = b.drops(meta, Math.random, tool);
      const f = enchLevel(tool, 'fortune');
      if (f && /_ore$/.test(b.key)) drops = drops.map(([k, n]) => [k, (k === id || k === b.key) ? n : fortuneCount(n, f)]);
    }
    else if (!b.noItem) drops = [[id, 1]];
    else drops = [];
    for (const [k, n] of drops) if (n > 0) this.dropItem(x + 0.5 + (Math.random() - 0.5) * 0.3, y + 0.3, z + 0.5 + (Math.random() - 0.5) * 0.3, makeStack(k, n));
  }

  // ---- explosions ----------------------------------------------------------------------------
  explode(x, y, z, power, source, inWater, fire) {
    const w = this.world;
    Sound.explode([x, y, z]);
    if (source instanceof PrimedTNT) this.grant('tnt');
    const destroy = new Set();
    if (!inWater) {
      const r = Math.random;
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
        if (i > 0 && i < 15 && j > 0 && j < 15 && k > 0 && k < 15) continue;
        let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        let s = power * (0.7 + r() * 0.6), px = x, py = y, pz = z;
        while (s > 0) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          const id = w.getBlock(bx, by, bz);
          if (id) {
            const b = BLOCKS[id];
            const res = b.hardness < 0 ? 3600000 : IS_FLUID[id] ? 100 : b.hardness >= 50 ? 1200 : (b.tool === 'pickaxe' ? b.hardness * 4 : b.hardness);
            s -= (res + 0.3) * 0.3;
            if (s > 0 && by >= 0) destroy.add(bx + ',' + by + ',' + bz);
          }
          px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3; s -= 0.225;
        }
      }
    }
    // (a block the blast takes is the blast's: not broken "naturally" first by losing what held it - the ground under a
    // door went first and the door dropped for sure, then the blast's own roll too)
    this.blasting = destroy;
    try { for (const k of destroy) {
      const [bx, by, bz] = k.split(',').map(Number);
      const id = w.getBlock(bx, by, bz);
      if (!id || IS_FLUID[id]) continue;
      if (id === 26) { w.setBlock(bx, by, bz, 0, 0); this.entities.push(new PrimedTNT(this, bx, by, bz, 10 + ((Math.random() * 20) | 0))); continue; }
      // a door, bed or double plant: one roll for the pair, the other half taken quietly - each half rolled on its own
      // and the half left behind broke "naturally" with a drop of its own: two doors from one (feedback 2026-11-02)
      const b = BLOCKS[id], m = w.getMeta(bx, by, bz), half = b.states && b.states[m] && b.states[m].half;
      let other = null;
      if (b.door) other = [bx, (m & 8) ? by - 1 : by + 1, bz];
      else if (half === 'upper' || half === 'lower') other = [bx, half === 'upper' ? by - 1 : by + 1, bz];
      else if (b.bed) { const R = [4, 1, 5, 0][m & 3], D2 = DIRS[(m & 4) ? OPP[R] : R]; other = [bx + D2[0], by, bz + D2[2]]; }
      let lootAt = [bx, by, bz, m];
      if (other && w.getBlock(other[0], other[1], other[2]) === id) {
        const om = w.getMeta(other[0], other[1], other[2]);
        // (the loot from the half that has it: a door's lower half, a double plant's lower, a bed's head)
        if ((b.door && (m & 8)) || half === 'upper' || (b.bed && !(m & 4))) lootAt = [other[0], other[1], other[2], om];
        destroy.delete(other.join(','));
        this.pairBreak = bx + ',' + by + ',' + bz;
        try { w.setBlock(other[0], other[1], other[2], WLOG[id] ? WATER : 0, 0); } finally { this.pairBreak = null; }
      }
      if (Math.random() < 1 / power && this.mode !== 'creative') this.dropBlockLoot(lootAt[0], lootAt[1], lootAt[2], id, lootAt[3], null);
      w.setBlock(bx, by, bz, 0, 0);
    } } finally { this.blasting = null; }
    if (fire) for (const k of destroy) { const [bx, by, bz] = k.split(',').map(Number); if (Math.random() < 0.33 && w.getBlock(bx, by, bz) === 0 && SOLIDCUBE[w.getBlock(bx, by - 1, bz)]) w.setBlock(bx, by, bz, 171, 0); }
    // damage entities
    const R = power * 2;
    for (const e of [...this.entities, this.player]) {
      if (e === source) continue;
      const d = Math.hypot(e.pos[0] - x, e.pos[1] + e.h / 2 - y, e.pos[2] - z);
      if (d > R) continue;
      // (vanilla getSeenPercent: how much of it the blast can see - a wall in between shields it; it hurt through
      // walls and doors the same: "苦力怕隔着墙把我炸死", feedback 2026-11-01/02)
      const imp = (1 - d / R) * this.blastSeen(x, y, z, e);
      if (imp <= 0) continue;
      const dir = [(e.pos[0] - x) / (d || 1), (e.pos[1] + e.h / 2 - y) / (d || 1), (e.pos[2] - z) / (d || 1)];
      if (e instanceof Living) e.hurt(Math.floor((imp * imp + imp) / 2 * 7 * R + 1), { type: 'explosion', attacker: source && source.T ? source : null });
      else if (e.hittable && e instanceof EndCrystal && !e.dead) { setTimeout(() => e.hurt(1, { type: 'explosion' }), 50); continue; }
      if (e instanceof EnderDragon || e instanceof EndCrystal) continue;
      e.vel[0] += dir[0] * imp; e.vel[1] += dir[1] * imp + 0.1; e.vel[2] += dir[2] * imp;
    }
    for (let i = 0; i < 24; i++) this.particles.spawn('explosion', x + (Math.random() - 0.5) * power * 1.5, y + (Math.random() - 0.5) * power * 1.5, z + (Math.random() - 0.5) * power * 1.5, 0, 0, 0);
    for (let i = 0; i < 40; i++) this.particles.spawn('smoke', x + (Math.random() - 0.5) * power * 2, y + (Math.random() - 0.5) * power * 2, z + (Math.random() - 0.5) * power * 2, (Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
    const p = this.player;
    const pd = Math.hypot(p.pos[0] - x, p.pos[1] - y, p.pos[2] - z);
    if (pd < 30) this.shake = Math.max(this.shake || 0, (1 - pd / 30) * power / 4);
  }

  // the share of points through an entity's box with a clear line to the blast (full collision blocks stop it)
  blastSeen(x, y, z, e) {
    const w = this.world, b = e.box(); let seen = 0, n = 0;
    for (let i = 0; i <= 1; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 1; k++) {
      const px = b[0] + (b[3] - b[0]) * (0.1 + 0.8 * i), py = b[1] + (b[4] - b[1]) * (0.1 + 0.4 * j), pz = b[2] + (b[5] - b[2]) * (0.1 + 0.8 * k);
      const dx = x - px, dy = y - py, dz = z - pz, L = Math.hypot(dx, dy, dz), steps = Math.ceil(L / 0.3);
      let clear = true;
      for (let t = 1; t < steps; t++) { const f = t / steps, bx = Math.floor(px + dx * f), by = Math.floor(py + dy * f), bz = Math.floor(pz + dz * f); const id = w.getBlock(bx, by, bz); if (SOLIDCUBE[id] || (BLOCKS[id] && ((BLOCKS[id].door && !(w.getMeta(bx, by, bz) & 4)) || (BLOCKS[id].shape === SH_CUBE && BLOCKS[id].solid)))) { clear = false; break; } }
      n++; if (clear) seen++;
    }
    return n ? seen / n : 1;
  }
  // ---- raycasting ----------------------------------------------------------------------------
  lookDir() { const p = this.player, cp = Math.cos(p.pitch); return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp]; }
  selBoxes(x, y, z, id) {
    const b = BLOCKS[id], m = this.world.getMeta(x, y, z);
    if (b.shape === SH_BOXES || b.shape === SH_MODEL) return b.boxes(m).map(a => a.map(v => v / 16));
    if (b.shape === SH_CROSS || b.shape === SH_CROP) return [[0.15, 0, 0.15, 0.85, b.key === 'wheat' ? 0.25 + (m & 7) / 10 : 0.8, 0.85]];
    if (b.shape === SH_TORCH) {
      // (a meta past the 6 sides - an imported or a room's torch: the standing box; "render: reading '0'", telemetry 11-02/03)
      const D = DIRS[m];
      if (!m || !D) return [[0.4, 0, 0.4, 0.6, 0.6, 0.6]];
      const cx = 0.5 + D[0] * 0.35, cz = 0.5 + D[2] * 0.35;
      return [[cx - 0.15, 0.2, cz - 0.15, cx + 0.15, 0.8, cz + 0.15]];
    }
    if (b.shape === SH_CACTUS) return [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]];
    return [[0, 0, 0, 1, 1, 1]];
  }
  raycast(origin, dir, maxD, fluids) {
    const w = this.world;
    let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
    const sx = Math.sign(dir[0]), sy = Math.sign(dir[1]), sz = Math.sign(dir[2]);
    const tdx = Math.abs(1 / dir[0]), tdy = Math.abs(1 / dir[1]), tdz = Math.abs(1 / dir[2]);
    let tx = (sx > 0 ? x + 1 - origin[0] : origin[0] - x) * tdx, ty = (sy > 0 ? y + 1 - origin[1] : origin[1] - y) * tdy, tz = (sz > 0 ? z + 1 - origin[2] : origin[2] - z) * tdz;
    for (let i = 0; i < 200; i++) {
      const id = w.getBlock(x, y, z);
      if (id && (!IS_FLUID[id] || (fluids && w.getMeta(x, y, z) === 0))) {
        const boxes = IS_FLUID[id] ? [[0, 0, 0, 1, 0.9, 1]] : this.selBoxes(x, y, z, id);
        let best = null;
        for (const bx of boxes) {
          const hit = rayBox(origin, dir, x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]);
          if (hit && (!best || hit.t < best.t)) best = { ...hit, box: bx };
        }
        if (best && best.t <= maxD) return { pos: [x, y, z], face: best.face, t: best.t, point: [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t], id, box: best.box };
      }
      if (tx < ty && tx < tz) { if (tx > maxD) break; x += sx; tx += tdx; }
      else if (ty < tz) { if (ty > maxD) break; y += sy; ty += tdy; }
      else { if (tz > maxD) break; z += sz; tz += tdz; }
    }
    return null;
  }
  rayEntity(origin, dir, maxD) {
    let best = null;
    for (const e of this.entities) {
      if (e.dead || (!(e instanceof Living) && !e.hittable) || e.deathTime > 0) continue;
      const parts = e.parts ? e.parts() : [{ box: e.box() }];
      for (const part of parts) {
        const b = part.box;
        const hit = rayBox(origin, dir, b[0] - 0.1, b[1] - 0.1, b[2] - 0.1, b[3] + 0.1, b[4] + 0.1, b[5] + 0.1);
        if (hit && hit.t <= maxD && (!best || hit.t < best.t)) best = { e, t: hit.t, part: e.parts ? part : null };
      }
    }
    return best;
  }

  // ---- interaction ---------------------------------------------------------------------------
  reach() { return this.mode === 'creative' ? 5 : 4.5; }
  updateTarget() {
    const p = this.player;
    const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]];
    const dir = this.lookDir();
    this.target = this.raycast(eye, dir, this.reach(), false);
    const ent = this.rayEntity(eye, dir, this.mode === 'creative' ? 5 : 3);
    this.targetEntity = ent && (!this.target || ent.t < this.target.t) ? ent.e : null;
    this.targetPart = this.targetEntity ? ent.part : null;
    return { eye, dir };
  }
  handleInteraction() {
    const p = this.player;
    if (this.ui.screen || p.deathTime > 0 || this.mode === 'spectator') { this.breaking = null; p.usingItem = null; this.target = null; this.targetEntity = null; return; }
    this.updateTarget();
    if (this.net) { this.netInteraction(); return; }
    if (this.useCd > 0) this.useCd--;
    if (this.attackCd > 0) this.attackCd--;
    // continuous using (eating / bow)
    if (p.usingItem) {
      const held = p.useHand === 'off' ? p.inv.slots[40] : p.inv.held;
      if (!this.mouseBtn[2] || !held || held.id !== p.usingItem) { if (held && held.id === p.usingItem) this.releaseUsing(held); p.usingItem = null; p.useT = 0; p.useHand = null; }
      else {
        p.useT++;
        this.usingTick(held);
        const def = ITEMS[held.id], drink = def.key === 'potion' || def.key === 'milk_bucket' || def.key === 'honey_bottle';
        if (def.food || drink) {
          if (p.useT % 4 === 0 && p.useT > 6) { if (drink) Sound.ev('entity.generic.drink', p.pos, 0.5, 1); else { Sound.eat(p.pos); this.foodParticles(held.id); } }
          if (p.useT >= this.useTicks(def)) this.finishEating(held);
        }
      }
    }
    // breaking
    if (this.mouseBtn[0]) {
      if (this.targetEntity) {
        // like vanilla, each click attacks once (holding the button only keeps mining)
        if (this.mouseClicked0 && this.attackCd <= 0) this.attack(this.targetEntity);
        this.breaking = null;
      } else if (this.target) {
        const t = this.target;
        // (a spear's jab goes off at a block or the air too - its lunge with it: "没对准生物就不能突进", feedback
        // 2026-11-01/02)
        const hk = p.inv.held && ITEMS[p.inv.held.id].key, spear = typeof isSpear === 'function' && isSpear(hk);
        if (spear && this.mouseClicked0 && this.attackCd <= 0 && this.spearJab) { this.spearJab(); p.swing(); }
        if (this.mode === 'creative') {
          if (this.attackCd <= 0) {
            const held = p.inv.held;
            // (vanilla: swords, spears, maces and tridents break nothing in creative)
            if (!(held && ((ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') || spear || hk === 'mace' || hk === 'trident'))) this.breakBlock(...t.pos, false);
            this.attackCd = 5; p.swing();
          }
        } else {
          const key = t.pos.join(',');
          if (!this.breaking || this.breaking.key !== key) this.breaking = { key, pos: t.pos, progress: 0, id: t.id };
          const b = BLOCKS[t.id];
          if (t.id === 171 || t.id === 176) { if (t.id === 171) { this.world.setBlock(...t.pos, 0, 0); Sound.ev('block.fire.extinguish', t.pos, 0.5, 2); } else this.teleportEgg(...t.pos); this.breaking = null; this.attackCd = 5; p.swing(); this.mouseBtn[0] = false; return; }
          if (b.hardness < 0 || this.attackCd > 0) { if (b.hardness < 0) this.breaking.progress = 0; }
          else {
            this.breaking.progress += this.breakSpeed(t.id);
            p.swing(); // vanilla swings every tick while mining (restarting past half a swing)
            if (this.tickCount % 4 === 0) { Sound.block('hit', b.sound, [t.pos[0] + 0.5, t.pos[1] + 0.5, t.pos[2] + 0.5]); this.particles.blockHit(...t.pos, t.face, t.id, this.world.getMeta(...t.pos)); }
            if (this.breaking.progress >= 1) { this.breakBlock(...t.pos, false); this.breaking = null; this.attackCd = 5; }
          }
        }
      } else {
        this.breaking = null;
        if (this.mouseClicked0) {
          const hk = p.inv.held && ITEMS[p.inv.held.id].key;
          if (typeof isSpear === 'function' && isSpear(hk) && this.attackCd <= 0 && this.spearJab) { this.spearJab(); p.swing(); this.attackCd = 2; }
          else { p.swing(); p.attackT = 0; }
        }
      }
    } else this.breaking = null;
    this.mouseClicked0 = false;
    // using / placing (hold to repeat)
    if (this.mouseBtn[2] && this.useCd <= 0 && !p.usingItem) {
      this.use();
    }
  }
  breakSpeed(id) {
    const p = this.player, b = BLOCKS[id];
    if (b.hardness === 0) return 1;
    const held = p.inv.held, def = held && ITEMS[held.id];
    let speed = 1, canHarvest = !b.needsTool;
    if (def && def.tool) {
      const t = def.tool;
      if (t.type === b.tool) { speed = t.speed; if (t.level >= b.level) canHarvest = true; }
      if (t.type === 'sword' && (b.key.endsWith('leaves') || b.key === 'cactus' || b.key === 'pumpkin' || b.key === 'melon')) speed = 1.5;
    }
    if (def && def.key === 'shears' && (b.key.endsWith('leaves') || b.key.endsWith('wool'))) { speed = b.key.endsWith('wool') ? 5 : 15; canHarvest = true; }
    // shears and swords cut cobwebs quickly (vanilla 15; players' feedback 2026-10-31: shears could not)
    if (b.key === 'cobweb' && def && (def.key === 'shears' || (def.tool && def.tool.type === 'sword'))) { speed = 15; canHarvest = true; }
    if (b.tool === 'shears') canHarvest = true;
    const eff = heldEnch(p, 'efficiency');
    if (eff && speed > 1) speed += eff * eff + 1;
    let s = speed * effectMineFactor(p) / b.hardness / (canHarvest ? 30 : 100);
    if (p.eyeInWater && !armorEnch(p, 'aqua_affinity', [36])) s /= 5;
    if (!p.onGround && !p.flying) s /= 5;
    return s;
  }
  canHarvest(id, held) {
    const b = BLOCKS[id];
    if (!b.needsTool) return true;
    const def = held && ITEMS[held.id];
    if (b.tool === 'shears') return true;
    return !!(def && def.tool && def.tool.type === b.tool && def.tool.level >= b.level);
  }
  teleportEgg(x, y, z) {
    const w = this.world;
    for (let i = 0; i < 100; i++) {
      const nx = x + ((Math.random() * 31) | 0) - 15, ny = y + ((Math.random() * 15) | 0) - 7, nz = z + ((Math.random() * 31) | 0) - 15;
      if (w.getBlock(nx, ny, nz) === 0 && BLOCKS[w.getBlock(nx, ny - 1, nz)].solid) {
        w.setBlock(x, y, z, 0, 0); w.setBlock(nx, ny, nz, 176, 0);
        for (let k = 0; k < 40; k++) { const t = k / 40; this.particles.spawn('portal', lerp(x, nx, t) + 0.5, lerp(y, ny, t) + 0.5, lerp(z, nz, t) + 0.5, 0, 0, 0); }
        this.flushMesh(); return;
      }
    }
  }
  breakBlock(x, y, z, natural, silent) {
    const w = this.world, id = w.getBlock(x, y, z), meta = w.getMeta(x, y, z);
    if (!id || IS_FLUID[id]) return;
    if (id === 176 && !natural && this.mode !== 'creative') { this.teleportEgg(x, y, z); return; }
    const b = BLOCKS[id];
    const p = this.player, held = natural ? null : p.inv.held;
    if (!silent) { Sound.block('break', b.sound, [x + 0.5, y + 0.5, z + 0.5]); this.particles.blockBreak(x, y, z, id, meta); }
    else this.particles.blockBreak(x, y, z, id, meta);
    if (this.mode !== 'creative' || natural) {
      if (natural || this.canHarvest(id, held)) this.dropBlockLoot(x, y, z, id, meta, held);
      if (!natural) {
        p.exhaust(0.005);
        if (held && ITEMS[held.id].durability && b.hardness > 0) this.damageHeld(1);
        const xp = { coal_ore: [0, 2], deepslate_coal_ore: [0, 2], diamond_ore: [3, 7], deepslate_diamond_ore: [3, 7], redstone_ore: [1, 5], lapis_ore: [2, 5], emerald_ore: [3, 7] }[b.key] || (b.id >= 1024 && b.xp);
        if (xp && this.canHarvest(id, held)) this.dropXp(x + 0.5, y + 0.5, z + 0.5, xp[0] + Math.floor(Math.random() * (xp[1] - xp[0] + 1)));
        this.stats.mined++;
      }
    }
    // door: remove other half (the half broken, still there, isn't broken again by losing it: that dropped a second
    // door, players' feedback 2026-10-31; the same for the double plants below)
    const pair = (oy, nb) => { this.pairBreak = x + ',' + y + ',' + z; try { w.setBlock(x, oy, z, nb, 0, 1); } finally { this.pairBreak = null; } };
    if (b.door) { const oy = (meta & 8) ? y - 1 : y + 1; if (w.getBlock(x, oy, z) === id) pair(oy, 0); }
    if (b.bed) {
      const R = [4, 1, 5, 0][meta & 3], D2 = DIRS[(meta & 4) ? OPP[R] : R];
      const ox = x + D2[0], oz = z + D2[2];
      if (w.getBlock(ox, y, oz) === id) { if ((meta & 4) && this.mode !== 'creative' && !natural) this.dropBlockLoot(ox, y, oz, id, 0, null); w.setBlock(ox, y, oz, 0, 0, 1); }
    }
    // double plants: remove the other half too
    const half = b.states && b.states[meta] && b.states[meta].half;
    if (half === 'upper' || half === 'lower') { const oy = half === 'upper' ? y - 1 : y + 1; if (w.getBlock(x, oy, z) === id) pair(oy, WLOG[id] ? WATER : 0); }
    // water fills in when breaking next to water? (handled by fluid ticks via notify); waterlogged plants leave their water
    w.setBlock(x, y, z, WLOG[id] ? WATER : 0, 0);
    if (id === 35 && w.getBlock(x, y - 1, z) !== 0 && this.mode !== 'creative' && !natural) w.setBlock(x, y, z, WATER, 0);
    if (!natural) this.flushMesh();
  }
  damageHeld(n) {
    const p = this.player, h = p.inv.held;
    if (!h || this.mode === 'creative') return;
    for (let i = n; i > 0; i--) if (unbreakingSkips(h, false)) n--;
    if (n <= 0) return;
    h.dmg = (h.dmg || 0) + n;
    if (h.dmg >= ITEMS[h.id].durability) { p.inv.slots[p.inv.sel] = null; Sound.block('break', 'wood', p.pos); this.ui.actionBar = { text: ITEMS[h.id].cn + ' 损坏了', t: performance.now(), color: '#FF5555' }; }
  }
  flushMesh() {
    // remesh dirty sections near the player immediately for responsive edits
    const p = this.player, pcx = Math.floor(p.pos[0]) >> 4, pcz = Math.floor(p.pos[2]) >> 4;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const ch = this.world.getChunk(pcx + a, pcz + b);
      if (!ch || !ch.dirty) continue;
      let ok = true;
      for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1; j++) if (!this.world.getChunk(ch.cx + i, ch.cz + j)) { ok = false; break; }
      if (ok) this.meshChunk(ch);
    }
  }
  // vanilla attack speed (attacks per second) of the held item
  attackSpeed() {
    const held = this.player.inv.held, def = held && ITEMS[held.id], t = def && def.tool;
    if (def && def.attackSpeed) return def.attackSpeed;
    if (!t) return 4;
    const mat = def.key.split('_')[0];
    switch (t.type) {
      case 'sword': return 1.6;
      case 'pickaxe': return 1.2;
      case 'shovel': return 1.0;
      case 'axe': return { wooden: 0.8, stone: 0.8, iron: 0.9 }[mat] || 1.0;
      case 'hoe': return { wooden: 1, stone: 2, iron: 3, golden: 1, diamond: 4 }[mat] || 1;
    }
    return 4;
  }
  // 0..1: how recharged the next swing is (vanilla getAttackStrengthScale(0.5))
  attackStrength(a = 0.5) { return clamp(((this.player.attackT || 0) + a) / (20 / this.attackSpeed()), 0, 1); }
  attack(e) {
    const p = this.player, held = p.inv.held, def = held && ITEMS[held.id];
    const str = this.attackStrength();
    let dmg = Math.max(0, (def && def.attack ? def.attack : 1) + effectAttackBonus(p)) * (0.2 + str * str * 0.8);
    const crit = str > 0.9 && p.vel[1] < -0.05 && !p.onGround && !p.inWater;
    if (crit) { dmg *= 1.5; for (let i = 0; i < 12; i++) this.particles.spawn('crit', e.pos[0] + (Math.random() - 0.5) * e.w, e.pos[1] + Math.random() * e.h, e.pos[2] + (Math.random() - 0.5) * e.w, (Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3); }
    dmg += enchantAttackBonus(held, e) * str;
    const knock = (p.sprinting && str > 0.9 ? 0.8 : 0.4) + heldEnch(p, 'knockback') * 0.5;
    const src = { type: 'player', attacker: p, knockFrom: p.pos, knock, player: true, looting: heldEnch(p, 'looting') };
    p.attackT = 0;
    const fa = heldEnch(p, 'fire_aspect');
    if (fa && !e.fireproof && e instanceof Living) e.fire = Math.max(e.fire || 0, 80 * fa);
    if (e.parts && this.targetPart ? e.hurtPart(this.targetPart, dmg, src) : e.hurt(dmg, src)) {
      if (def && def.durability) this.damageHeld(def.tool && def.tool.type === 'sword' ? 1 : 2);
      p.exhaust(0.1);
      if (p.sprinting) p.sprinting = false;
    }
    p.swing();
    this.attackCd = 2; // 1.9 combat: no hard limit, the cool-down only scales damage
  }
  foodParticles(id) {
    const p = this.player, d = this.lookDir();
    for (let i = 0; i < 3; i++) {
      const pa = this.particles.spawn('block', p.pos[0] + d[0] * 0.5, p.pos[1] + p.eye() - 0.2, p.pos[2] + d[2] * 0.5, (Math.random() - 0.5) * 0.1, 0.1, (Math.random() - 0.5) * 0.1, { id: 1, layer: ITEMS[id].tex });
    }
  }
  finishEating(held) {
    const p = this.player, def = ITEMS[held.id];
    p.food = Math.min(20, p.food + def.food[0]);
    p.saturation = Math.min(p.food, p.saturation + def.food[1]);
    if (def.heal) p.health = Math.min(20, p.health + def.heal);
    if (def.key === 'rotten_flesh' && Math.random() < 0.8) p.food = Math.max(0, p.food - 1);
    Sound.burp(p.pos);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.usingItem = null; p.useT = 0;
    this.useCd = 4;
  }
  releaseBow() {
    const p = this.player, t = p.useT;
    let f = t / 20; f = (f * f + f * 2) / 3; if (f > 1) f = 1;
    if (f < 0.1) return;
    // any arrow (the other hand's first, like vanilla); infinity keeps plain arrows
    const found = this.findAmmo(false);
    if (!found && this.mode !== 'creative') return;
    const bow = p.inv.held, ammo = found ? found[1] : null, ak = ammo ? ITEMS[ammo.id].key : 'arrow';
    const inf = enchLevel(bow, 'infinity') > 0 && ak === 'arrow';
    if (this.mode !== 'creative' && !inf) { ammo.count--; if (!ammo.count) p.inv.slots[found[0]] = null; }
    const d = this.lookDir(), sp = f * 3;
    const a = new Arrow(this, p.pos[0] + d[0] * 0.3, p.pos[1] + p.eye() - 0.1, p.pos[2] + d[2] * 0.3, [d[0] * sp, d[1] * sp, d[2] * sp], p);
    const pw = enchLevel(bow, 'power'), pu = enchLevel(bow, 'punch');
    if (pw) a.baseDmg = 2 + 0.5 * pw + 0.5;
    if (pu) a.punch = pu;
    if (enchLevel(bow, 'flame')) a.fire = 100;
    if (inf || this.mode === 'creative') a.noPickup = true;
    if (ammo) { a.stack = { ...ammo, count: 1 }; if (ak !== 'arrow') a.tip = a.stack; }
    this.entities.push(a);
    Sound.bow(p.pos);
    this.damageHeld(1);
  }
  use() {
    const p = this.player, w = this.world, held = p.inv.held, def = held && ITEMS[held.id];
    const t = this.target;
    this.useCd = 4;
    // entity interaction
    if (this.targetEntity && this.targetEntity.interact && !(held && ITEMS[held.id] && ITEMS[held.id].spawnEgg)) {
      if (this.targetEntity.interact(p, held)) { p.swing(); return; }
    }
    if (this.targetEntity && held) {
      const e = this.targetEntity;
      // hand a gold ingot to a piglin to barter
      if (typeof Piglin !== 'undefined' && e instanceof Piglin && held.id === ITEM_KEY.gold_ingot) {
        if (e.give(held)) { if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; } p.swing(); }
        return;
      }
      if (def.key === 'shears' && e.type === 'sheep' && !e.sheared) {
        e.sheared = true;
        for (let i = 0, n = 1 + ((Math.random() * 3) | 0); i < n; i++) this.dropItem(e.pos[0], e.pos[1] + 1, e.pos[2], makeStack(128 + e.woolColor, 1));
        Sound.ev('entity.sheep.shear', e.pos, 1, 1) || Sound.noise(e.pos, { freq: 3000, q: 3, dur: 0.15, vol: 0.4 });
        this.damageHeld(1); p.swing(); return;
      }
      if (e.T && e.T.food && held.id === item(e.T.food) && !e.loveT && !e.baby) {
        e.loveT = 600;
        for (let i = 0; i < 6; i++) this.particles.spawn('heart', e.pos[0] + (Math.random() - 0.5), e.pos[1] + e.h + Math.random() * 0.5, e.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        // breed with a nearby partner in love
        const mate = this.entities.find(o => o !== e && o instanceof Mob && o.type === e.type && o.loveT > 0 && o.distTo(e) < 8);
        if (mate) {
          e.loveT = 0; mate.loveT = 0;
          const baby = new Mob(this, e.type, (e.pos[0] + mate.pos[0]) / 2, e.pos[1], (e.pos[2] + mate.pos[2]) / 2).makeBaby();
          this.entities.push(baby);
          for (let i = 0; i < 8; i++) this.particles.spawn('heart', baby.pos[0] + (Math.random() - 0.5), baby.pos[1] + 1 + Math.random() * 0.5, baby.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
          this.dropXp(baby.pos[0], baby.pos[1] + 0.5, baby.pos[2], 1 + ((Math.random() * 7) | 0));
        }
        p.swing(); return;
      }
    }
    // block interaction
    if (t && !p.sneaking) {
      const b = BLOCKS[t.id];
      const [x, y, z] = t.pos;
      // components with a use of their own (redstone.js: levers, buttons, repeaters, hoppers ...)
      if (typeof b.onUse === 'function' && b.onUse(this, x, y, z, t)) { p.swing(); return; }
      if (b.onUse === 'crafting') { this.ui.open(new CraftingScreen(this, 3)); return; }
      if (WORKSTATIONS[b.onUse]) { this.openWorkstation(b, x, y, z); return; }
      if (b.onUse === 'furnace') {
        const be = this.getBlockEntity(x, y, z, 'furnace'); be.kind = FURNACE_KIND[b.key] || 'smelting';
        const sc = new FurnaceScreen(this, be); sc.title = b.cn; this.ui.open(sc); return;
      }
      if (b.onUse === 'chest') {
        const m = w.getMeta(x, y, z), s = chestSeam(m);
        const halves = [[x, z]];
        if (s && w.getBlock(x + s[0], y, z + s[1]) === t.id) halves.push([x + s[0], z + s[1]]);
        // the half on the viewer's left is shown on top (that is the "right" texture half)
        if (halves.length === 2 && chestType(m) === 1) halves.reverse();
        const bes = halves.map(([hx, hz]) => {
          const be = this.getBlockEntity(hx, y, hz, 'chest');
          if (w.getMeta(hx, y, hz) & 8) { this.fillLoot(be, hx, y, hz); w.setMeta(hx, y, hz, w.getMeta(hx, y, hz) & ~8); }
          return be;
        });
        this.ui.open(new ChestScreen(this, bes, bes.length > 1 ? '大型' + b.cn : b.cn));
        Sound.chest([x + 0.5, y + 0.5, z + 0.5], true); return;
      }
      if (b.onUse === 'barrel') {
        const be = this.getBlockEntity(x, y, z, 'chest');
        if (be.loot) this.fillLoot(be, x, y, z);
        this.ui.open(new ChestScreen(this, [be], b.cn));
        Sound.chest([x + 0.5, y + 0.5, z + 0.5], true); return;
      }
      if (b.onUse === 'note') { const m = (w.getMeta(x, y, z) + 1) % 25; w.setMeta(x, y, z, m); Sound.note([x, y, z], m); this.particles.spawn('note', x + 0.5, y + 1.2, z + 0.5, 0, 0.02, 0, { col: [255, Math.round(m * 10), Math.round(255 - m * 10)] }); p.swing(); return; }
      if (b.door) {
        const m = w.getMeta(x, y, z), base = (m & 8) ? y - 1 : y;
        const bm = w.getMeta(x, base, z) ^ 4;
        w.setMeta(x, base, z, bm); w.setMeta(x, base + 1, z, bm | 8);
        Sound.door([x, y, z], !!(bm & 4)); p.swing(); this.flushMesh(); return;
      }
      if (b.bed) { if (this.dim !== 'overworld') this.bedExplode(x, y, z); else this.trySleep(x, y, z); p.swing(); return; }
      if (t.id === 176) { this.teleportEgg(x, y, z); p.swing(); return; }
      if (b.trapdoor) { w.setMeta(x, y, z, w.getMeta(x, y, z) ^ 4); Sound.door([x, y, z], true); p.swing(); this.flushMesh(); return; }
      if (b.gate && typeof Features !== 'undefined') {
        // fence gates swing open away from the player
        const id = t.id, m = w.getMeta(x, y, z), open = Features.propOf(id, m, 'open') === 'true';
        let nm = Features.withProp(id, m, 'open', !open);
        if (!open) {
          const f = Features.propOf(id, m, 'facing'), look = this.lookDir();
          const want = Math.abs(look[0]) > Math.abs(look[2]) ? (look[0] > 0 ? 'east' : 'west') : (look[2] > 0 ? 'south' : 'north');
          if (want === OPPOSITE[f]) nm = Features.withProp(id, nm, 'facing', want);
        }
        w.setMeta(x, y, z, nm); Sound.door([x, y, z], !open); p.swing(); this.flushMesh(); return;
      }
      if (t.id === 26 && def && def.key === 'flint_and_steel') { w.setBlock(x, y, z, 0, 0); this.entities.push(new PrimedTNT(this, x, y, z)); this.damageHeld(1); p.swing(); return; }
    }
    if (this.useEquipment(held, def)) return;
    if (!held) return;
    if (def.armor) {
      const slot = 36 + def.armor.slot;
      const cur = p.inv.slots[slot];
      p.inv.slots[slot] = held; p.inv.slots[p.inv.sel] = cur;
      p.swing(); // (the equip sound: armorSounds)
      if (def.key.startsWith('iron')) this.grant('armor');
      return;
    }
    // food - one that is also planted (sweet / glow berries, carrots, potatoes) is planted where it can be, like
    // vanilla's useOn before use (players' feedback 2026-10-31: sweet berries could not be planted)
    const plantFirst = def.food && def.places && t && !this.targetEntity && BID[def.places] !== undefined && (() => {
      const pid = BID[def.places], pb = BLOCKS[pid], D = DIRS[t.face], tb = BLOCKS[t.id];
      let [qx, qy, qz] = t.pos;
      if (!(tb.replaceable && !IS_FLUID[t.id])) { qx += D[0]; qy += D[1]; qz += D[2]; }
      const cur = this.world.getBlock(qx, qy, qz);
      if (cur && !REPLACEABLE[cur]) return false;
      return !pb.needsSupport || this.supportedForPlace(qx, qy, qz, pid, 0);
    })();
    if (!plantFirst && (def.food || def.key === 'potion' || def.key === 'milk_bucket')) { if (this.canConsume(def)) { p.usingItem = held.id; p.useT = 0; } return; }
    if (def.key === 'splash_potion' || def.key === 'lingering_potion') { this.throwPotion(held); return; }
    if (def.key === 'bow') { if (this.mode === 'creative' || this.findAmmo(false)) { p.usingItem = held.id; p.useHand = 'main'; p.useT = 0; } return; }
    if (def.key === 'ender_pearl') {
      if (this.pearlCd > this.tickCount) return;
      const d = this.lookDir();
      this.entities.push(new ThrownPearl(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], [d[0] * 1.5, d[1] * 1.5, d[2] * 1.5], p));
      Sound.ev('entity.ender_pearl.throw', p.pos, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      this.pearlCd = this.tickCount + 20; p.swing(); return;
    }
    if (def.key === 'ender_eye' && !(t && t.id === 174)) {
      if (this.dim !== 'overworld') { this.ui.actionBar = { text: '末影之眼在这里没有反应……', t: performance.now() }; return; }
      const sh = this.nearestStronghold();
      if (!sh) return;
      this.entities.push(new EyeOfEnder(this, p.pos[0], p.pos[1] + p.eye() - 0.2, p.pos[2], sh.x, sh.z));
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      p.swing(); return;
    }
    if (def.key === 'snowball' || def.key === 'egg') {
      const d = this.lookDir();
      const a = new Arrow(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], [d[0] * 1.5, d[1] * 1.5, d[2] * 1.5], p);
      a.snowball = held.id; this.entities.push(a);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      Sound.bow(p.pos); p.swing(); return;
    }
    // buckets
    if (def.key === 'bucket') {
      const ft = this.raycast([p.pos[0], p.pos[1] + p.eye(), p.pos[2]], this.lookDir(), this.reach(), true);
      // (a waterlogged block gives up its water and stays)
      const wl = ft && !IS_FLUID[ft.id] && w.isWaterlogged(...ft.pos);
      if (ft && (wl || (IS_FLUID[ft.id] && w.getMeta(...ft.pos) === 0))) {
        if (wl) w.setWaterlogged(...ft.pos, false); else w.setBlock(...ft.pos, 0, 0);
        const filled = makeStack(wl || ft.id === WATER ? 'water_bucket' : 'lava_bucket');
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = filled; else if (p.inv.add(filled)) this.dropFromPlayer(filled); }
        Sound.ev(!wl && ft.id === LAVA ? 'item.bucket.fill_lava' : 'item.bucket.fill', ft.pos, 1, 1) || Sound.splash(ft.pos); p.swing(); this.flushMesh();
      }
      return;
    }
    if (!t) return;
    const [x, y, z] = t.pos, D = DIRS[t.face];
    // tools acting on blocks
    if (def.tool && def.tool.type === 'hoe' && (t.id === 2 || t.id === 3) && w.getBlock(x, y + 1, z) === 0) {
      w.setBlock(x, y, z, 63, 0); Sound.ev('item.hoe.till', [x + 0.5, y + 0.5, z + 0.5], 1, 1) || Sound.block('step', 'gravel', [x, y, z]); this.damageHeld(1); p.swing(); this.flushMesh(); return;
    }
    if (def.key === 'bone_meal') {
      let ok = false;
      const tb = BLOCKS[t.id], tst = tb && tb.states && tb.states[w.getMeta(x, y, z)];
      if (t.id === 64 && w.getMeta(x, y, z) < 7) { w.setMeta(x, y, z, Math.min(7, w.getMeta(x, y, z) + 2 + ((Math.random() * 3) | 0))); ok = true; }
      // the vanilla-state crops (carrots, potatoes, beetroots, stems, sweet berries, cocoa, torchflowers): older by 2-5
      // stages (crops and stems) or 1 (players' feedback 2026-10-31: bone meal did nothing on them)
      else if (tst && tst.age !== undefined && /^(carrots|potatoes|beetroots|melon_stem|pumpkin_stem|sweet_berry_bush|cocoa|torchflower_crop)$/.test(tb.key)) {
        const max = Math.max(...tb.states.map((s) => +s.age).filter((n) => !isNaN(n))), age = +tst.age;
        if (age < max) {
          const add = /^(carrots|potatoes|beetroots|melon_stem|pumpkin_stem)$/.test(tb.key) ? 2 + ((Math.random() * 4) | 0) : 1;
          w.setMeta(x, y, z, Features.withProp(t.id, w.getMeta(x, y, z), 'age', String(Math.min(max, age + add)))); ok = true;
        }
      }
      else if (t.id >= 65 && t.id <= 67 || (BLOCKS[t.id] && (BLOCKS[t.id].key.endsWith('_sapling') || BLOCKS[t.id].key === 'mangrove_propagule'))) {
        if (Math.random() < 0.45 && !(w.gen2 && this.growTreeV(x, y, z, t.id)) && t.id <= 67) this.growTree(x, y, z, t.id);
        ok = true;
      }
      else if (t.id === 2) {
        for (let i = 0; i < 40; i++) {
          const nx = x + ((Math.random() * 7) | 0) - 3, nz = z + ((Math.random() * 7) | 0) - 3;
          if (w.getBlock(nx, y, nz) === 2 && w.getBlock(nx, y + 1, nz) === 0) w.setBlock(nx, y + 1, nz, Math.random() < 0.85 ? 39 : FLOWER_IDS[(Math.random() * 4) | 0], 0);
        }
        ok = true;
      }
      if (ok) {
        for (let i = 0; i < 12; i++) this.particles.spawn('bone_meal', x + Math.random(), y + 1 + Math.random() * 0.5, z + Math.random(), 0, 0.02, 0);
        Sound.ev('item.bone_meal.use', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swing(); this.flushMesh();
      }
      return;
    }
    if (def.key === 'ender_eye' && t.id === 174) {
      if (!(w.getMeta(x, y, z) & 4)) {
        this.fillEndFrame(x, y, z);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swing(); this.flushMesh();
      }
      return;
    }
    if (def.key === 'end_crystal') {
      if ((t.id === 28 || t.id === 6) && t.face === 3 && w.getBlock(x, y + 1, z) === 0) {
        const c = new EndCrystal(this, x + 0.5, y + 1, z + 0.5); c.showBase = false; this.entities.push(c);
        if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
        p.swing();
      }
      return;
    }
    if (def.key === 'flint_and_steel' || def.key === 'fire_charge') {
      // an unlit candle, candle cake or campfire (not under water) is lit instead (vanilla canLight)
      const bk = BLOCKS[t.id].key, m0 = w.getMeta(x, y, z);
      if (/(^|_)(candle|candle_cake|campfire)$/.test(bk) && Features.propOf(t.id, m0, 'lit') === 'false' && Features.propOf(t.id, m0, 'waterlogged') !== 'true' && !w.isWaterlogged(x, y, z)) {
        w.setBlock(x, y, z, t.id, Features.withProp(t.id, m0, 'lit', 'true'));
        if (def.key === 'fire_charge') { Sound.ev('item.firecharge.use', [x + 0.5, y + 0.5, z + 0.5], 1, 1); if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; } }
        else { Sound.ev('item.flintandsteel.use', [x + 0.5, y + 0.5, z + 0.5], 1, Math.random() * 0.4 + 0.8); this.damageHeld(1); }
        p.swing(); this.flushMesh(); return;
      }
      const fx = x + D[0], fy = y + D[1], fz = z + D[2];
      if (w.getBlock(fx, fy, fz) !== 0) return;
      if (!this.tryLightPortal(fx, fy, fz)) {
        if (!this.fireSupported(fx, fy, fz)) return;
        w.setBlock(fx, fy, fz, 171, 0);
      }
      if (def.key === 'fire_charge') { Sound.ev('item.firecharge.use', [fx, fy, fz], 1, 1) || Sound.fizz([fx, fy, fz]); if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; } }
      else { Sound.ev('item.flintandsteel.use', [fx, fy, fz], 1, Math.random() * 0.4 + 0.8); this.damageHeld(1); }
      p.swing(); this.flushMesh(); return;
    }
    if (def.spawnEgg) {
      const m = createMob(this, def.spawnEgg, x + D[0] + 0.5, y + Math.max(0, D[1]) + (D[1] < 0 ? -2 : 0), z + D[2] + 0.5);
      m.persistent = true; m.yaw = m.bodyYaw = p.yaw + Math.PI;
      this.entities.push(m);
      for (let i = 0; i < 8; i++) this.particles.spawn('poof', m.pos[0] + (Math.random() - 0.5), m.pos[1] + Math.random(), m.pos[2] + (Math.random() - 0.5), 0, 0.05, 0);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      p.swing(); return;
    }
    // placement
    let placeId = null;
    if (def.block !== undefined && BLOCKS[def.block]) placeId = def.block;
    else if (def.places) placeId = BID[def.places];
    if (placeId == null) return;
    // standing and wall forms (signs, banners, heads, torches, coral fans): a block's side takes the wall form,
    // hanging signs hang from a block's underside; standing banners and signs can't go under a block
    const wallForm = WALL_FORM[BLOCKS[placeId].key];
    if (wallForm && BID[wallForm] !== undefined && t.face !== 2 && t.face !== 3) placeId = BID[wallForm];
    else if (wallForm && t.face === 2 && !BLOCKS[placeId].key.endsWith('hanging_sign') && /_(sign|banner)$/.test(BLOCKS[placeId].key)) return;
    const pb = BLOCKS[placeId];
    // a water bucket fills a block that can hold water: the one clicked, else the one in front of it
    // (BucketItem.emptyContents with a LiquidBlockContainer)
    if (placeId === WATER && this.dim !== 'nether') {
      for (const [qx, qy, qz] of [[x, y, z], [x + D[0], y + D[1], z + D[2]]]) {
        if (!canWaterlog(w.getBlock(qx, qy, qz), w.getMeta(qx, qy, qz)) || w.isWaterlogged(qx, qy, qz)) continue;
        w.setWaterlogged(qx, qy, qz, true);
        if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket');
        Sound.ev('item.bucket.empty', [qx, qy, qz], 1, 1) || Sound.splash([qx, qy, qz]); p.swing(); this.flushMesh();
        return;
      }
    }
    // snow on snow: one layer more, up to 8 (SnowLayerBlock.canBeReplaced)
    if (pb.key === 'snow' && t.id === placeId && (w.getMeta(x, y, z) & 7) < 7) { this.placeAt(x, y, z, placeId, (w.getMeta(x, y, z) & 7) + 1, held, true); return; }
    // slab merging
    if (pb.slab && t.id === placeId) {
      const m = w.getMeta(x, y, z) & 3;
      if ((m === 0 && t.face === 3) || (m === 1 && t.face === 2)) { this.placeAt(x, y, z, placeId, 2, held, true); return; }
    }
    let px = x, py = y, pz = z;
    const tb = BLOCKS[t.id];
    if (!(tb.replaceable && !IS_FLUID[t.id] && t.id !== placeId)) { px += D[0]; py += D[1]; pz += D[2]; }
    if (py < 0 || py >= HEIGHT) return;
    const cur = w.getBlock(px, py, pz);
    if (pb.slab && cur === placeId) {
      const m = w.getMeta(px, py, pz) & 3;
      if (m !== 2) { this.placeAt(px, py, pz, placeId, 2, held, true); return; }
    }
    if (cur && !REPLACEABLE[cur]) return;
    if (IS_FLUID[placeId] && cur && IS_FLUID[cur] && w.getMeta(px, py, pz) === 0 && cur === placeId) return;
    // placed into a water source, a block that can hold water is waterlogged (getStateForPlacement)
    const intoSource = cur === WATER && w.getMeta(px, py, pz) === 0;
    // meta from placement context
    let meta = 0;
    const look = this.lookDir();
    const hdir = Math.abs(look[0]) > Math.abs(look[2]) ? (look[0] > 0 ? 1 : 0) : (look[2] > 0 ? 5 : 4);
    if (pb.facing) meta = OPP[hdir];
    if (pb.axis) meta = (t.face === 0 || t.face === 1) ? 1 : (t.face === 4 || t.face === 5) ? 2 : 0;
    if (pb.slab) { const fy = t.point[1] - Math.floor(t.point[1]); meta = t.face === 2 || (t.face !== 3 && fy > 0.5) ? 1 : 0; }
    if (pb.stairs) {
      meta = { 1: 0, 0: 1, 5: 2, 4: 3 }[hdir];
      const fy = t.point[1] - Math.floor(t.point[1]);
      if (t.face === 2 || (t.face !== 3 && fy > 0.5)) meta |= 4;
    }
    if (pb.trapdoor) {
      const fy = t.point[1] - Math.floor(t.point[1]); if (t.face === 2 || (t.face !== 3 && fy > 0.5)) meta |= 8;
      // facing bits: 0 north, 1 south, 2 west, 3 east (the clicked side, else facing away from the player)
      const fdir = t.face === 2 || t.face === 3 ? OPP[hdir] : t.face;
      meta |= { 4: 0, 5: 1, 0: 2, 1: 3 }[fdir] || 0;
    }
    if (placeId === 21) { if (t.face === 2) return; meta = t.face === 3 ? 0 : OPP[t.face]; }
    if (pb.ladder) { if (t.face < 2 && false) return; if (t.face === 2 || t.face === 3) return; meta = OPP[t.face]; }
    if (pb.key.endsWith('leaves')) meta = 4;
    if (pb.states && typeof Features !== 'undefined') meta = this.placeState(pb, t, hdir);
    if (pb.bed) {
      const rot = { 4: 0, 1: 1, 5: 2, 0: 3 }[hdir];
      const D2 = DIRS[hdir], hx = px + D2[0], hz = pz + D2[2];
      const hcur = w.getBlock(hx, py, hz);
      if (hcur && !REPLACEABLE[hcur]) return;
      if (!SOLIDCUBE[w.getBlock(px, py - 1, pz)] || !SOLIDCUBE[w.getBlock(hx, py - 1, hz)]) return;
      w.setBlock(hx, py, hz, placeId, rot | 4, 0);
      this.placeAt(px, py, pz, placeId, rot, held, false);
      return;
    }
    if (pb.door) {
      if (w.getBlock(px, py + 1, pz) !== 0 && !REPLACEABLE[w.getBlock(px, py + 1, pz)]) return;
      meta = { 1: 0, 0: 1, 5: 2, 4: 3 }[hdir];
      // double doors: next to a left-hinged door with the same facing, hinge on the right
      const ccw = [[0, -1], [0, 1], [1, 0], [-1, 0]][meta]; // counter-clockwise of east, west, south, north
      const nb = w.getBlock(px + ccw[0], py, pz + ccw[1]), nm = w.getMeta(px + ccw[0], py, pz + ccw[1]);
      if (BLOCKS[nb] && BLOCKS[nb].door && (nm & 3) === meta && !(nm & 16)) meta |= 16;
    }
    if (pb.needsSupport || pb.door) { if (!this.supportedForPlace(px, py, pz, placeId, meta)) return; }
    // a double plant (sunflower, lilac, peony, rose bush, tall grass, large fern ...): its upper half too, if there is
    // room (only the lower half was placed: players' feedback 2026-10-31)
    const tall = pb.states && pb.states[meta] && pb.states[meta].half === 'lower' && !pb.door && typeof Features !== 'undefined';
    if (tall && (py + 1 >= HEIGHT || (w.getBlock(px, py + 1, pz) && !REPLACEABLE[w.getBlock(px, py + 1, pz)]))) return;
    // collision with entities
    if (pb.solid) {
      const boxes = pb.shape === SH_BOXES ? pb.boxes(meta) : [[0, 0, 0, 16, 16, 16]];
      for (const e of [p, ...this.entities]) {
        if (!(e instanceof Living) || e.deathTime > 0) continue;
        const eb = e.box();
        for (const bx of boxes) {
          if (eb[0] < px + bx[3] / 16 && eb[3] > px + bx[0] / 16 && eb[1] < py + bx[4] / 16 && eb[4] > py + bx[1] / 16 && eb[2] < pz + bx[5] / 16 && eb[5] > pz + bx[2] / 16) return;
        }
      }
    }
    if (IS_FLUID[placeId]) {
      if (placeId === WATER && this.dim === 'nether') {
        if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket');
        Sound.fizz([px, py, pz]); for (let i = 0; i < 8; i++) this.particles.spawn('smoke', px + Math.random(), py + Math.random(), pz + Math.random(), 0, 0.05, 0);
        p.swing(); return;
      }
      if (cur && !IS_FLUID[cur]) this.dropBlockLoot(px, py, pz, cur, w.getMeta(px, py, pz), null);
      w.setBlock(px, py, pz, placeId, 0);
      if (this.mode !== 'creative') p.inv.slots[p.inv.sel] = makeStack('bucket');
      Sound.ev(placeId === LAVA ? 'item.bucket.empty_lava' : 'item.bucket.empty', [px, py, pz], 1, 1) || Sound.splash([px, py, pz]); p.swing(); this.flushMesh();
      return;
    }
    if (pb.door) w.setBlock(px, py + 1, pz, placeId, meta | 8, 0);
    if (pb.chestLike && pb.key !== 'ender_chest' && !p.sneaking) {
      for (const t of [1, 2]) {
        const s = chestSeam(meta | (t === 1 ? 16 : 32)), nx = px + s[0], nz = pz + s[1];
        const nm = w.getMeta(nx, py, nz);
        if (w.getBlock(nx, py, nz) === placeId && !chestType(nm) && (nm & 7) === meta) {
          meta |= t === 1 ? 16 : 32;
          w.setMeta(nx, py, nz, nm | (t === 1 ? 32 : 16));
          break;
        }
      }
    }
    this.placeAt(px, py, pz, placeId, meta, held, false);
    if (tall && w.getBlock(px, py, pz) === placeId) { this.pairBreak = px + ',' + py + ',' + pz; try { w.setBlock(px, py + 1, pz, placeId, Features.withProp(placeId, meta, 'half', 'upper'), 1); } finally { this.pairBreak = null; } }
    if (intoSource && w.getBlock(px, py, pz) === placeId && canWaterlog(placeId, meta)) w.setWaterlogged(px, py, pz, true);
  }
  supportedForPlace(x, y, z, id, meta) {
    const w = this.world, old = w.getBlock(x, y, z);
    if (BLOCKS[id].door) return !!SOLIDCUBE[w.getBlock(x, y - 1, z)];
    return this.supported(x, y, z, id, meta);
  }
  placeAt(x, y, z, id, meta, held, merge) {
    const p = this.player, w = this.world;
    w.setBlock(x, y, z, id, meta);
    // (crops and nether wart have their own planting sound: SoundType.CROP / NETHER_WART, placed at pitch 0.8)
    const plant = /^(wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|torchflower_crop|pitcher_crop)$/.test(BLOCKS[id].key) ? 'item.crop.plant' : BLOCKS[id].key === 'nether_wart' ? 'item.nether_wart.plant' : null;
    if (!(plant && Sound.ev(plant, [x + 0.5, y + 0.5, z + 0.5], 1, 0.8))) Sound.block('place', BLOCKS[id].sound, [x + 0.5, y + 0.5, z + 0.5]);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing();
    this.stats.placed++;
    if (this.stats.placed >= 100) this.grant('build');
    if (BLOCKS[id].gravity) this.onNeighborUpdate(x, y, z, id);
    this.flushMesh();
  }
  pickBlock() {
    const t = this.target; if (!t) return;
    let id = t.id;
    const b = BLOCKS[id];
    const map = { 2: 2, 117: 20, 64: 'wheat_seeds', 69: 'oak_door', 38: 'sugar_cane', 63: 3 };
    if (map[id] !== undefined) id = typeof map[id] === 'string' ? item(map[id]) : map[id];
    if (!ITEMS[id]) return;
    const inv = this.player.inv;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === id) { inv.sel = i; return; }
    if (this.mode === 'creative') {
      let slot = inv.slots.findIndex((s, i) => i < 9 && !s);
      if (slot < 0) slot = inv.sel;
      inv.slots[slot] = { id, count: maxStack(id), dmg: 0 }; inv.sel = slot;
    } else {
      const i = inv.slots.findIndex((s, j) => j >= 9 && j < 36 && s && s.id === id);
      if (i >= 0) { const tmp = inv.slots[inv.sel]; inv.slots[inv.sel] = inv.slots[i]; inv.slots[i] = tmp; }
    }
  }

  // ---- rendering ---------------------------------------------------------------------------
  // sky / fog / clouds / stars following vanilla's formulas (DimensionSpecialEffects, FogRenderer)
  env(a) {
    const cel = this.celestial();
    const c = Math.cos(cel * Math.PI * 2);
    const br = clamp(c * 2 + 0.5, 0, 1); // vanilla sky & fog brightness over the day
    const rain = this.weather;
    const p = this.player;
    // sky colour from the biome's temperature: HSV(0.6222 - t/3*0.05, 0.5 + t/3*0.1, 1)
    let temp = 0.8;
    if (p && this.world) {
      const ch = this.world.getChunk(Math.floor(p.pos[0]) >> 4, Math.floor(p.pos[2]) >> 4);
      if (ch) temp = BIOME_TEMP[ch.biome[(Math.floor(p.pos[2]) & 15) * 16 + (Math.floor(p.pos[0]) & 15)]] ?? 0.8;
    }
    let sky = hsv2rgb(0.62222224 - clamp(temp / 3, -1, 1) * 0.05, 0.5 + clamp(temp / 3, -1, 1) * 0.1, 1).map(v => v * br);
    // 26.x biomes carry their sky (and sometimes fog) colour as attributes
    const vb = p && this.world && this.world.gen2 ? this.vbiomeAt(Math.floor(p.pos[0]), Math.floor(p.pos[2])) : null;
    if (vb && vb.sky) sky = vb.sky.map(v => v / 255 * br);
    if (rain > 0) { const g = (sky[0] * 0.3 + sky[1] * 0.59 + sky[2] * 0.11) * 0.6, k = 1 - rain * 0.75; sky = sky.map(v => v * k + g * (1 - k)); }
    // fog: biome fog colour (#C0D8FF) by the same day factor
    let fog = [192 / 255 * (br * 0.94 + 0.06), 216 / 255 * (br * 0.94 + 0.06), 1 * (br * 0.91 + 0.09)];
    if (vb && vb.fog) fog = [vb.fog[0] / 255 * (br * 0.94 + 0.06), vb.fog[1] / 255 * (br * 0.94 + 0.06), vb.fog[2] / 255 * (br * 0.91 + 0.09)];
    // sunrise / sunset colour (vanilla getSunriseColor)
    let sunset = [0, 0, 0, 0];
    if (c >= -0.4 && c <= 0.4) {
      const f3 = c / 0.4 * 0.5 + 0.5;
      let f4 = 1 - (1 - Math.sin(f3 * Math.PI)) * 0.99; f4 *= f4;
      sunset = [f3 * 0.3 + 0.7, f3 * f3 * 0.7 + 0.2, 0.2, f4];
    }
    const sunDir = [-Math.sin(cel * Math.PI * 2), Math.cos(cel * Math.PI * 2), 0];
    const rd = this.renderer.renderDist;
    if (rd >= 4 && sunset[3] > 0 && p) {
      // looking toward the sun: fog takes the sunrise colour
      const ld = this.lookDir(), hl = Math.hypot(ld[0], ld[2]) || 1;
      const t = Math.max(0, (ld[0] / hl) * Math.sign(sunDir[0] || 1)) * sunset[3];
      fog = fog.map((v, i) => v + (sunset[i] - v) * t);
    }
    // the further you can see, the more the fog leans toward the sky colour
    const kf = 1 - Math.pow(0.25 + 0.75 * rd / 32, 0.25);
    fog = fog.map((v, i) => v + (sky[i] - v) * kf);
    if (rain > 0) fog = fog.map(v => v * (1 - rain * 0.5));
    // terrain fog: a short band at the edge of the render distance (cylindrical)
    let fogFar = rd * 16, fogNear = fogFar - clamp(fogFar / 10, 4, 64);
    const nightTint = [0.55, 0.62, 0.95];
    if (this.headInWater) {
      const wl = Math.max(0.12, br * ((this.world.getLight(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1.6), Math.floor(p.pos[2])) >> 4) / 15));
      fog = [0.05 * wl, 0.18 * wl, 0.45 * wl]; fogNear = -8; fogFar = 96 * clamp(this.waterVision || 0.25, 0.25, 1);
    } else if (this.headInLava) { fog = [0.6, 0.1, 0]; fogNear = 0.25; fogFar = 1; }
    else if (this.headInPowder) { fog = [0.623, 0.734, 0.785]; fogNear = 0; fogFar = 2; } // (vanilla FogType.POWDER_SNOW)
    // blindness / darkness: black fog a few blocks out
    if (p.effects && (p.hasEffect('blindness') || p.hasEffect('darkness'))) { fog = [0, 0, 0]; fogNear = 0; fogFar = p.hasEffect('blindness') ? 5 : 15; }
    // underground with no sky light the fog sinks toward black
    if (!this.headInWater && this.state === 'play') {
      const sl = this.world.skyAt(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1.6), Math.floor(p.pos[2]));
      const k = clamp(sl / 10, 0.25, 1);
      fog = fog.map(v => v * k + (1 - k) * 0.02);
    }
    // stars and clouds (vanilla getStarBrightness / getCloudColor)
    let stars = 1 - (c * 2 + 0.25); stars = clamp(stars, 0, 1); stars = stars * stars * 0.5 * (1 - rain);
    let cloud = [br * 0.9 + 0.1, br * 0.9 + 0.1, br * 0.85 + 0.15];
    if (rain > 0) { const g = (cloud[0] * 0.3 + cloud[1] * 0.59 + cloud[2] * 0.11) * 0.6, k = 1 - rain * 0.95; cloud = cloud.map(v => v * k + g * (1 - k)); }
    const moonPhase = Math.floor(this.worldTime / 24000) % 8;
    // sky darkening as used by the lightmap (also drives shader-pack daylight)
    let sd = 1 - clamp(1 - (c * 2 + 0.2), 0, 1); sd *= 1 - rain * 5 / 16; const day = sd * 0.8 + 0.2;
    return this.dimEnv({
      tick: this.worldTime + a, day, fogColor: fog, skyColor: sky, sunDir, sunset, voidColor: [sky[0] * 0.2 + 0.04, sky[1] * 0.2 + 0.04, sky[2] * 0.6 + 0.1],
      celestial: cel, starBright: stars * 2, sunAlpha: 1 - rain, rain, moonPhase, temp,
      fogNear, fogFar, nightTint, cloudColor: cloud,
    });
  }

  render(a, now) {
    const r = this.renderer, gl = r.gl, sc = this.ui.screen;
    this.lastA = a;
    // a pausing menu over the blurred world: nothing moves, so the world is drawn once (and again only
    // when the window or the video settings change) instead of every frame under the CSS blur. The title scene too, under
    // a blurred menu (the agreement, the options, onboarding): the user's decision 11-03, 150 - 580 draw calls a frame (by
    // scene; 0.6 - 0.9 ms of CPU on a desktop, 0.25 now) for a picture nobody sees sharply (its turning and the panorama's
    // fade wait meanwhile: frame). The screen wants the blur
    // and the last frame had it (ui.blurOn): the frame a blurred menu closes the world is drawn at once. (Not while the
    // panorama tool renders its faces: panoCam.) On the title the scene is drawn again while it is still filling in - its
    // sections' count in the key - so a menu opened at once, the agreement on a first visit, doesn't keep an empty sky.
    // The picture stays on screen because nothing at all is drawn into the canvas that frame: an untouched WebGL canvas
    // keeps showing its last frame (preserveDrawingBuffer is off). A new size clears it (canvasGen, sizeCanvas): drawn then
    // Not the title on an iPhone / iPad: iOS takes back a WebGL canvas left undrawn, and a new player reading the
    // agreement lost it ~5 s after the title came - after the reload the same again, a white screen (telemetry 11-06:
    // iOS onboarding sessions losing it 0% -> 6.1% with the title freeze). Nor the pause menu in a world on any Apple
    // device (WEBKIT_GL, 11-07): the same taking back - the context lost 5x as often as before the freeze, a reload each
    const frozen = !WEBKIT_GL && ((this.state === 'play' && sc && sc.pauses) || (this.state === 'title' && sc && sc.blurBg && this.ui.blurOn && !this.panoCam));
    if (frozen) {
      const key = innerWidth + 'x' + innerHeight + ':' + devicePixelRatio + ':' + r.resScale + ':' + (this.state === 'title' ? r.sections.size : '') + ':' + JSON.stringify(this.settings);
      if (this.frozenKey === key && this.frozenFrames >= 2 && this.drawnGen === this.canvasGen) { this.titleFrozen = this.state === 'title'; this.halfWorld = false; this.ui.draw(); return; }
      this.frozenFrames = this.frozenKey === key ? (this.frozenFrames || 0) + 1 : 0;
      this.frozenKey = key;
    } else this.frozenKey = null;
    this.titleFrozen = false;
    // touch devices (a phone or tablet, or touch controls on) with an inventory-type screen open (it doesn't pause: the
    // world goes on behind it): the world is drawn every other frame and the screen over it every frame - the user's
    // decision 11-03, for the battery. A skipped frame is the frozen one above: only the interface is drawn, the world's
    // last picture stays (drawn again at once when the canvas was resized since). Measured on a desktop at 8 chunks:
    // 1.3 -> 0.8 ms of CPU and 2.3 -> 1.5 ms of GPU a frame, half the draw calls. (The canvas is sized on a skipped
    // frame too: a resize asked for between frames - a phone turned, render.js inFrame - waits for a frame, and the
    // interface, laid out at once, stood over the old picture stretched to the new shape for one frame)
    this.halfWorld = this.state === 'play' && sc instanceof ContainerScreen && !sc.pauses && ((this.pacer && this.pacer.touch) || touchOn(this));
    if (this.halfWorld) {
      this.oddFrame = !this.oddFrame;
      if (this.oddFrame) this.sizeCanvas();
      if (this.oddFrame && this.drawnGen === this.canvasGen && !this.wantScreenshot) { this.ui.draw(); return; }
    } else this.oddFrame = false;
    this.sizeCanvas(); this.drawnGen = this.canvasGen;
    r.yOff = this.world && this.dim === 'overworld' ? (this.world.minY || 0) : 0;
    gl.viewport(0, 0, r.canvas.width, r.canvas.height);
    if (!this.world || this.state === 'boot') { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); this.ui.draw(); return; }
    const p = this.player;
    let eye, yaw, pitch, fov = this.settings.fov;
    if (this.state === 'title' || this.state === 'loading' || this.state === 'switching') {
      eye = this.titleCam || [0, 100, 0]; yaw = this.titleYaw || 0; pitch = -0.15;
      if (this.panoCam) { yaw = this.panoCam.yaw; pitch = this.panoCam.pitch; fov = 90; }
      else if (this.state === 'title' && this.panoAlpha >= 1 && Panorama.ready()) { r.drawPanorama(yaw, pitch, fov, 1); this.ui.draw(); return; }
      if (this.state !== 'title') { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); this.ui.draw(); return; }
    } else {
      const ip = p.ipos(a);
      const eyeH = this.sleeping ? 0.2 : p.eye();
      this.smoothEye = this.smoothEye == null ? eyeH : lerp(this.smoothEye, eyeH, 0.4);
      eye = [ip[0], ip[1] + this.smoothEye, ip[2]];
      yaw = p.yaw; pitch = p.pitch;
      if (this.sleeping) { yaw = [0, -Math.PI / 2, Math.PI, Math.PI / 2][this.sleeping.rot] + Math.PI; pitch = 0.5; }
      if (p.deathTime > 0) eye[1] -= Math.min(1.2, p.deathTime / 20);
      // vanilla FOV modifier (flying, sprinting, bow zoom: fovModTarget), eased per tick, scaled by the FOV effects
      // option; under water 6/7
      fov *= 1 + (lerp(this.oFovMod ?? 1, this.fovMod ?? 1, a) - 1) * (this.settings.fovEffects ?? 1);
      if (this.headInWater) fov *= 6 / 7;
    }
    this.curFov = fov;
    const env = this.env(a);
    env.nightVision = nightVisionScale(p);
    r.updateLightmap(env, this.dim);
    // camera transform extras: hurt tilt, bobbing, shake, third person
    let camPos = eye;
    if (this.state === 'play' && this.perspective > 0) {
      const d = this.perspective === 1 ? 4 : -4;
      const look = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      const back = [-look[0] * d, -look[1] * d, -look[2] * d];
      let dist = Math.abs(d);
      const hit = this.raycast(eye, [Math.sign(d) * -look[0], Math.sign(d) * -look[1], Math.sign(d) * -look[2]], dist, false);
      if (hit) dist = Math.max(0.5, hit.t - 0.3);
      camPos = [eye[0] - look[0] * dist * Math.sign(d), eye[1] - look[1] * dist * Math.sign(d), eye[2] - look[2] * dist * Math.sign(d)];
      if (this.perspective === 2) { yaw += Math.PI; pitch = -pitch; }
    }
    const shake = this.shake || 0;
    this.shake = shake * 0.9;
    r.setCamera(camPos, yaw + (Math.random() - 0.5) * shake * 0.05, pitch + (Math.random() - 0.5) * shake * 0.05, this.curFov, (v) => {
      if (this.state !== 'play') return;
      if (p.hurtTime > 0) { const h = (p.hurtTime - a) / 10; M4.rotZ(v, Math.sin(h * h * h * h * Math.PI) * 0.25); }
      if (p.deathTime > 0) M4.rotZ(v, Math.min(1, p.deathTime / 20) * 0.6);
      if (this.settings.bobbing && this.perspective === 0) {
        const bob = lerp(p.prevBob, p.bob, a) * Math.PI * 0.6, amt = lerp(p.prevBobAmt || 0, p.bobAmt, a);
        M4.translate(v, Math.sin(bob) * amt * 0.5, -Math.abs(Math.cos(bob) * amt), 0);
        M4.rotZ(v, Math.sin(bob) * amt * 0.05);
        M4.rotX(v, Math.abs(Math.cos(bob - 0.2) * amt) * 0.08);
      }
    });
    // cave culling is off where the camera can see through walls (vanilla: spectator inside a block)
    r.noCull = this.state !== 'play' || !!SOLIDCUBE[this.world.getBlock(Math.floor(camPos[0]), Math.floor(camPos[1]), Math.floor(camPos[2]))];
    // shader pack: shadow map + HDR target (post chain runs at the end of the frame)
    const fx = r.fx && r.fx.ok && this.settings.shaders > 0 && !!FX_CFG[this.settings.shaders];
    if (fx) { r.fx.level = this.settings.shaders; r.fx.begin(env, this); }
    if (this.headInWater || this.headInLava || this.headInPowder || env.sky === 'none') { gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    else if (env.sky === 'end') { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); r.drawEndSky(); }
    else { gl.clear(gl.DEPTH_BUFFER_BIT); r.drawSky(env); }
    r.drawTerrain(env);
    this.drawEntities(a, env);
    if (this.dim !== 'end') this.drawSpawners(a, env);
    this.drawChests(a, env);
    if (this.state === 'play') this.drawSelection(env);
    // particles
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up = [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
    r.drawSprites(this.spriteList || [], env, right, up);
    this.particles.build(r.particleBuf, a, camPos, right, up);
    r.drawDynamic(r.particleBuf, r.particleGL, env, { noCull: true });
    r.drawTranslucent(env);
    if (this.dim === 'overworld' && !this.headInLava && !this.headInPowder) r.drawClouds(env, camPos[0], camPos[2]); // (inside those nothing past 1-2 blocks shows)
    if (this.state === 'play') {
      if (this.dim === 'overworld') this.drawWeather(env, a);
      // (no hand while asleep, like vanilla: it swayed in front of the turned camera - "hands twitch", feedback 10-31)
      if (this.perspective === 0 && p.deathTime === 0 && this.mode !== 'spectator' && !this.sleeping && !(this.iconAt && now >= this.iconAt)) {
        // with the shader pack the hand goes in front through the depth range instead of a cleared depth buffer,
        // so post still sees the world's depth around it (and finds the hand by its tiny depths)
        if (r.fxOn) gl.depthRange(0, 0.01);
        this.drawHand(a, env);
        gl.depthRange(0, 1);
      }
    }
    if (fx) r.fx.end();
    if (this.iconAt && this.state === 'play' && !this.ui.screen && now >= this.iconAt) this.captureIcon();
    if (this.state === 'title' && this.panoAlpha > 0 && Panorama.ready()) r.drawPanorama(yaw, pitch, this.curFov, this.panoAlpha);
    this.ui.draw();
    if (this.wantScreenshot) { this.wantScreenshot = false; this.saveScreenshot(); }
  }
  // F2: the frame (world + interface) as a PNG download, named like vanilla screenshots
  saveScreenshot() {
    const gc = this.renderer.canvas, uc = this.ui.canvas, c = document.createElement('canvas');
    c.width = gc.width; c.height = gc.height;
    const x = c.getContext('2d');
    x.drawImage(gc, 0, 0);
    x.drawImage(uc, 0, 0, c.width, c.height);
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const name = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}.png`;
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.ui.message('已将截图保存为' + name, '#FFFFFF');
    }, 'image/png');
  }

  drawSelection(env) {
    const r = this.renderer, t = this.target;
    if (!t || this.ui.hideHud || this.perspective === 2) return;
    const [x, y, z] = t.pos;
    const v = [], e = 0.002;
    for (const bx of this.selBoxes(x, y, z, t.id)) {
      const x0 = x + bx[0] - e, y0 = y + bx[1] - e, z0 = z + bx[2] - e, x1 = x + bx[3] + e, y1 = y + bx[4] + e, z1 = z + bx[5] + e;
      const L = (a, b) => v.push(a[0], a[1], a[2], 0, 0, 0, 1, b[0], b[1], b[2], 0, 0, 0, 1);
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (let i = 0; i < 4; i++) { L(c[i], c[(i + 1) % 4]); L(c[i + 4], c[(i + 1) % 4 + 4]); L(c[i], c[i + 4]); }
    }
    r.gl.enable(r.gl.DEPTH_TEST);
    r.drawLines(v, [0, 0, 0, 0.45]);
    // crack overlay
    if (this.breaking && this.breaking.progress > 0) {
      const stage = Math.min(9, Math.floor(this.breaking.progress * 10));
      const mb = r.miscBuf; mb.reset();
      const layer = T('destroy_stage_' + stage);
      const [bx, by, bz] = this.breaking.pos;
      for (const box of this.selBoxes(bx, by, bz, this.world.getBlock(bx, by, bz))) {
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          for (const c of F.c) {
            const px = c[0] ? box[3] : box[0], py = c[1] ? box[4] : box[1], pz = c[2] ? box[5] : box[2];
            const uv = F.uv(px, py, pz);
            mb.v(bx + px + (c[0] ? 0.003 : -0.003), by + py + (c[1] ? 0.003 : -0.003), bz + pz + (c[2] ? 0.003 : -0.003), uv[0], uv[1], layer, 0, 255, 255, 255, 255, 255, 255, 0);
          }
        }
      }
      r.drawDynamic(mb, r.miscGL, { ...env, day: 1, fogNear: 1e8, fogFar: 2e8 }, { blend: 'mul', alphaTest: 0.01 });
    }
  }

  drawEntities(a, env) {
    const r = this.renderer, gl = r.gl;
    this.spriteList = [];
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    const cam = r.camPos;
    const list = this.entities.slice();
    if (this.state === 'play' && this.perspective > 0 && this.mode !== 'spectator') list.push(this.player);
    // the shader pack's entity shadows: what is drawn here is kept and drawn into the shadow map next frame
    const rec = r.fxOn && r.fx.shadowOn ? (r.fx.entRec = []) : null;
    r.shRec = rec;
    try { this.drawEntityList(list, a, env, cam); } finally { r.shRec = null; }
    // the AI companion floating by the player (companion.js)
    if (typeof Jing !== 'undefined') try { Jing.draw(this, a, env); } catch (err) { this.reportError('companion', err, true); }
    if (this.net && !this.ui.hideHud) try { this.net.drawNames(a); } catch (err) { this.reportError('name tags', err, true); }
    // in first person the player is not drawn, but still casts its shadow
    if (rec && this.state === 'play' && this.perspective === 0 && this.mode !== 'spectator' && this.player.deathTime === 0) {
      r.shRec = rec; r.shRecOnly = true;
      try { this.drawMob(this.player, this.player.ipos(a), a, env, this.player.lightAt()); } catch (err) { this.reportError('player shadow', err, true); }
      finally { r.shRec = null; r.shRecOnly = false; }
    }
  }
  // vanilla Entity.shouldRenderAtSqrDistance and its overrides: how far an entity is drawn, in blocks. vs = 64 x the view
  // scale (LevelRenderer.allChanged: clamp(view distance / 8, 1, 2.5)); the size is the box's mean edge, (w + h + w) / 3,
  // a size that is no number counts as 1 (vanilla's NaN)
  entityViewDist(e, vs) {
    const s = (e.w + e.h + e.w) / 3;
    if (e instanceof Mob || e instanceof ItemEntity) return (s === s ? s : 1) * vs;
    if (e instanceof Arrow && !e.snowball) return (s === s ? s * 10 : 1) * vs; // AbstractArrow: x 10
    // ThrowableProjectile (snowballs and eggs are arrows here, pearls, potions), AbstractHurtingProjectile (fireballs,
    // wither skulls), EyeOfEnder, ArmorStand: x 4, without the view scale
    if (e instanceof Arrow || e instanceof Fireball || e instanceof DragonFireball || e instanceof ThrownPearl || e instanceof EyeOfEnder ||
      (typeof WitherSkull !== 'undefined' && e instanceof WitherSkull) || (typeof ThrownPotion !== 'undefined' && e instanceof ThrownPotion) ||
      (typeof ArmorStand !== 'undefined' && e instanceof ArmorStand)) return (s > 0 ? s * 4 : 4) * 64;
    if (typeof ShulkerBullet !== 'undefined' && e instanceof ShulkerBullet) return 128;
    if ((typeof FireworkRocket !== 'undefined' && e instanceof FireworkRocket) || (typeof FishingHook !== 'undefined' && e instanceof FishingHook)) return 64;
    if (typeof LeashKnot !== 'undefined' && e instanceof LeashKnot) return 32;
    if (typeof ItemFrame !== 'undefined' && e instanceof ItemFrame) return 16 * vs;
    return (s === s ? s : 1) * vs;
  }
  drawEntityList(list, a, env, cam) {
    const r = this.renderer, gl = r.gl, vs = 64 * clamp(r.renderDist / 8, 1, 2.5), rd2 = (r.renderDist * 16) ** 2;
    // inside water, lava or powder snow the frame is cleared to the fog colour, and the entity program's fog goes by level
    // distance: an entity whose every part is past the fog's end is drawn in exactly that colour - nothing to see, but a
    // draw call or more each (a sea of fish and squid around a diver: 183 of 400 mobs drawn under water at 8 chunks, 30 now).
    // Not with the shader pack: its passes go by the depth buffer (light shafts, the haze), what is behind would change
    const fogged = !r.fxOn && (this.headInWater || this.headInLava || this.headInPowder), fog2 = fogged ? (env.fogFar + 4) ** 2 : Infinity;
    // (each entity on its own: one that fails to draw is skipped, the rest of the picture still comes)
    for (const e of list) try {
      const ip = e.ipos(a);
      const dx = ip[0] - cam[0], dz = ip[2] - cam[2], h2 = dx * dx + dz * dz;
      if (h2 > rd2) continue;
      // (vanilla Entity.shouldRenderAtSqrDistance, the user's decision 11-03: a mob shows within 64 x its size x the view
      // scale - a zombie 67 blocks up to 8 chunks of view distance, 100 at 12 - a dropped item 16 / 24 / 40. Every entity
      // was drawn out to the view distance: 400 mobs spread to 180 blocks at 12 chunks, all 400 drawn, ~5000 of the
      // frame's draw calls and 4.0 - 4.5 ms of it on a desktop; now ~200 and 3.0 - 3.3 ms (at 8 chunks 206 - 272 -> 92 -
      // 129 mobs). Before the frustum and the light, which the ones beyond it paid for every frame too. The ender
      // dragon and ghasts (vanilla's reach for them is past any view distance) and the other players stay, fog or not)
      if (!(e instanceof EnderDragon || e instanceof Ghast || (e.type === 'player' && e !== this.player))) {
        if (h2 > fog2) continue;
        const lim = this.entityViewDist(e, vs);
        if (h2 + (ip[1] - cam[1]) ** 2 >= lim * lim) continue;
      }
      const big = e instanceof EnderDragon ? 14 : e instanceof Ghast ? 5 : 2;
      if (!aabbInFrustum(r.planes, ip[0] - big, ip[1] - big, ip[2] - big, ip[0] + big, ip[1] + 3 + big, ip[2] + big)) continue;
      const l = e.lightAt();
      if (e.drawSelf) { e.drawSelf(this, ip, a, env, l); continue; }
      if (e instanceof EnderDragon) { this.drawDragon(e, ip, a, env); continue; }
      if (e instanceof EndCrystal) { this.drawCrystal(e, ip, a, env); continue; }
      if (e instanceof Fireball || e instanceof DragonFireball || e instanceof ThrownPearl || e instanceof EyeOfEnder || e.spriteLayer !== undefined) {
        const layer = e.spriteLayer !== undefined ? e.spriteLayer : e instanceof ThrownPearl ? T('i_ender_pearl') : e instanceof EyeOfEnder ? T('i_ender_eye') : T('i_fire_charge');
        this.spriteList.push({ pos: [ip[0], ip[1] + e.h / 2, ip[2]], size: e instanceof Fireball && !e.small ? 0.5 : e instanceof DragonFireball ? 0.5 : 0.18, layer, bright: !(e instanceof ThrownPearl), col: e instanceof DragonFireball ? [200, 80, 255] : null });
        continue;
      }
      if (e instanceof AreaCloud) continue;
      if (e instanceof ExperienceOrb) {
        const t = (e.age + a) / 2, rr = (Math.sin(t) + 1) * 0.5, bb = (Math.sin(t + 4.18879) + 1) * 0.1;
        this.spriteList.push({ pos: [ip[0], ip[1] + 0.1, ip[2]], size: 0.15, layer: T('xp_orb_' + e.icon), bright: true, col: [Math.round(rr * 255), 255, Math.round(bb * 255)] });
        continue;
      }
      if (e instanceof Mob || e === this.player) {
        this.drawMob(e, ip, a, env, l);
        // burning: stacked upright flame quads around the body (like vanilla's entity fire layer)
        if (e.fire > 0 && !e.fireproof && e.deathTime === 0 && !(e.inWater)) {
          const s = e.w * 1.4 * (e.T && e.T.scale && e.T.scale > 1 ? e.T.scale : 1), cam = r.camPos;
          const tx = cam[0] - ip[0], tz = cam[2] - ip[2], tl = Math.hypot(tx, tz) || 1;
          const L0 = T('fire_0'), L1 = T('fire_1');
          for (let k = 0, y = 0; y < e.h * 0.9; k++, y += 0.45 * s) {
            const off = 0.03 * k + s * 0.3;
            this.spriteList.push({ pos: [ip[0] + tx / tl * off, ip[1] + y + 0.7 * s, ip[2] + tz / tl * off], w: s * 0.5, h: s * 0.7, layer: k % 2 ? L1 : L0, anim: ANIM_FRAMES[k % 2 ? L1 : L0], bright: true, cyl: true });
          }
        }
      } else if (e instanceof ItemEntity) {
        const st = e.stack, def = st && ITEMS[st.id];
        if (!def) continue;
        const t = (e.age + a) / 20;
        const bob = Math.sin(t * 2 + e.bobOff) * 0.1 + 0.1;
        const n = st.count > 16 ? 3 : st.count > 1 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const m = M4.create(); M4.translate(m, ip[0] + i * 0.06, ip[1] + bob + 0.05 + i * 0.03, ip[2] + i * 0.04); M4.rotY(m, t + e.bobOff);
          this.drawItemModel(st.id, m, l, env, 'ground', st);
        }
      } else if (e instanceof FallingBlock || e instanceof PrimedTNT) {
        const id = e instanceof PrimedTNT ? 26 : e.blockId;
        const mb = this.blockMesh(id, e.meta || 0);
        const m = M4.create();
        let s = 1;
        if (e instanceof PrimedTNT && e.fuse < 10) s = 1 + (1 - e.fuse / 10) * 0.2;
        M4.translate(m, ip[0], ip[1] + 0.49, ip[2]); M4.scale(m, s, s, s); M4.translate(m, -0.5, -0.49, -0.5);
        r.drawMesh(mb, m, env, l);
        if (e instanceof PrimedTNT && (e.fuse / 5 | 0) % 2 === 0) {
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthFunc(gl.LEQUAL);
          r.drawMesh(mb, m, env, [1, 1], { color: [1, 1, 1, 0.5] });
          gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
        }
      } else if (e instanceof Arrow) {
        const lay = e.snowball ? ITEMS[e.snowball].tex : T('i_arrow');
        // two crossed planes along the shaft (vanilla's arrow), so it shows from any side
        for (let k = 0; k < (e.snowball ? 1 : 2); k++) {
          const m = M4.create(); M4.translate(m, ip[0], ip[1], ip[2]);
          M4.rotY(m, e.yaw + Math.PI / 2); M4.rotZ(m, e.pitch); if (k) M4.rotX(m, Math.PI / 2); M4.rotZ(m, -Math.PI / 4);
          M4.scale(m, 0.7, 0.7, 0.7); M4.translate(m, -0.5, -0.5, 0);
          r.drawMesh(this.spriteMesh(lay), m, env, l);
        }
      }
    } catch (err) {
      this.reportError('draw ' + (e.type || e.constructor.name), err, true);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
    }
  }
  drawMob(e, ip, a, env, l) {
    const r = this.renderer, gl = r.gl;
    const isPlayer = e === this.player;
    const pl0 = isPlayer || e.type === 'player';
    const model = pl0 && typeof Skins !== 'undefined' ? Skins.modelOf(this, e) : isPlayer ? 'steve' : e.T.model; // (skins.js: the skin's arms)
    let m = M4.create();
    if (e.displayMatrix) m = M4.copy(e.displayMatrix); // e.g. the little mob spinning inside a spawner
    else {
      M4.translate(m, ip[0], ip[1], ip[2]);
      let by = isPlayer ? this.playerBodyYaw(a) : e.bodyYaw;
      // vanilla PlayerRenderer: a crouching player is drawn 2 pixels lower
      const pl = isPlayer || e.type === 'player'; // this player or another one (multiplayer)
      if (pl && e.sneaking && !e.flying && !(e.pose === 'swim' || e.netSwim)) M4.translate(m, 0, -2 / 16, 0);
      if (!isPlayer && e.prevBodyYaw !== undefined) { let d = e.bodyYaw - e.prevBodyYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; by = e.prevBodyYaw + d * a; }
      M4.rotY(m, by);
      // swimming / crawling: lie forward (tilted with the view while swimming), like vanilla's setupRotations
      const sw = pl ? lerp(e.prevSwimAmt || 0, e.swimAmt || 0, a) : 0;
      if (pl && e.gliding) {
        // gliding: lying along the view like swimming (vanilla setupRotations for fall flying, eased in);
        // the elytra named Dinnerbone or Grumm flies upside down (the easter egg)
        const f = isPlayer ? Math.min(1, ((e.glideT || 0) + a) ** 2 / 100) : 1;
        if (e.glideFlip) M4.rotX(m, (Math.PI / 2 - e.pitch) * f);
        else { M4.rotX(m, (-Math.PI / 2 + e.pitch) * f); M4.translate(m, 0, -1 * f, 0.3 * f); }
      } else if (pl && sw > 0.01) {
        M4.rotX(m, (-Math.PI / 2 + (e.swimming ? e.pitch : 0)) * sw);
        M4.translate(m, 0, -1 * sw, 0.3 * sw);
      }
    }
    if (e.deathTime > 0) M4.rotZ(m, Math.min(1, Math.sqrt((e.deathTime + a) / 20)) * Math.PI / 2);
    let sc = isPlayer ? 0.9375 : e.T.scale;
    if (e instanceof MagmaCube) sc = e.size;
    if (e.type === 'creeper' && e.fuse >= 0) { const f = lerp(e.prevFuse, e.fuse, a) / 28; const s = 1 + Math.sin(f * 100) * f * 0.01; sc *= (1 + f * 0.4) * s; }
    if (e.baby) sc *= 0.5;
    M4.scale(m, sc, sc, sc);
    const poses = isPlayer ? this.playerPose(a) : e.pose(a);
    this.frameA = a;
    let overlay = e.hurtTime > 0 || e.deathTime > 0 ? [1, 0, 0, 0.4] : null;
    if (e.type === 'creeper' && e.fuse >= 0 && (e.fuse / 4 | 0) % 2 === 0) overlay = [1, 1, 1, 0.5];
    const lt = [l[0], l[1]];
    if (e.fire > 0) lt[1] = 1;
    let heldId = null;
    if (isPlayer && e.inv.held) heldId = e.inv.held.id;
    else if (e.heldId != null) heldId = e.heldId; // a server's entity: what it holds
    else if (e.type === 'skeleton') heldId = item('bow');
    else if (e.type === 'zombified_piglin') heldId = item('golden_sword');
    else if (e.type === 'piglin') heldId = e.holding || item('golden_sword');
    // held items: vanilla's ItemInHandLayer with each item model's third-person transform (equip.js)
    const attach = this.heldAttach(e, model, heldId != null ? (isPlayer ? e.inv.held : { id: heldId, count: 1, dmg: 0 }) : null, isPlayer ? e.inv.slots[40] : null, lt, env);
    let tex = pl0 && typeof Skins !== 'undefined' ? Skins.texOf(this, e) : model === 'steve' ? 'steve' : e.type === 'sheep' ? 'sheep' : (e.T && e.T.tex) || model;
    if (e.type === 'strider' && !e.warm) tex = 'strider_cold';
    if (e.skin) tex = e.skin(r);
    if (e instanceof Ghast && e.charge > 10) tex = 'ghast_shooting';
    if (e instanceof MagmaCube) { const sq = lerp(e.prevSquish, e.squish, a); for (let i = 0; i < 8; i++) poses['s' + i] = { t: [0, (7 - i) * sq * 0.06, 0] }; }
    // invisibility (the potion, or a server's flag): the body isn't drawn, nor its shadow - its armour, held items and
    // elytra still are (vanilla LivingEntityRenderer)
    const hidden = !!(e.invisible || (e.hasEffect && e.hasEffect('invisibility')));
    r.gl.disable(r.gl.CULL_FACE);
    r.drawModel(model, tex, m, poses, lt, env, { overlay, attach, bright: !!(e.T && e.T.bright), hidden });
    if (pl0) this.lastPlayerModel = { m, poses, lt }; // (capes.js hangs the cape from it)
    r.gl.enable(r.gl.CULL_FACE);
    if (hidden) {
      const armour = isPlayer ? e.inv.slots.slice(36, 40) : (e.armorItems || []);
      if (pl0 || e.T.model === 'zombie' || e.T.model === 'skeleton' || e.T.model === 'zombified_piglin') this.drawArmor(armour, m, poses, lt, env, { overlay });
      if (pl0 && this.drawWings) this.drawWings(e, m, lt, env, overlay);
      return;
    }
    if (e instanceof Enderman) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL); r.drawModel('enderman', 'enderman_eyes', m, poses, [1, 1], env, { bright: true }); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); }
    // worn armour (vanilla humanoid armour layers; leather is dyed #A06540 with an undyed overlay)
    const armour = isPlayer ? e.inv.slots.slice(36, 40) : (e.armorItems || []);
    // (other players too: a server's player, a guest in a room on this browser - armorItems [head, chest, legs, feet])
    if (pl0 || e.T.model === 'zombie' || e.T.model === 'skeleton' || e.T.model === 'zombified_piglin') this.drawArmor(armour, m, poses, lt, env, { overlay });
    if (pl0 && this.drawWings) this.drawWings(e, m, lt, env, overlay);
    if (e.type === 'sheep' && !e.sheared) {
      const col = WOOL_RGB[e.woolColor] || [1, 1, 1];
      r.drawModel('sheep_wool', 'sheep_wool', m, poses, lt, env, { overlay, tint: col });
    }
    if (e.type === 'spider') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL); r.drawModel('spider', 'spider_eyes', m, poses, [1, 1], env, {}); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); }
    // shadow on the ground below
    if (e.deathTime === 0 && !e.displayMatrix) {
      const fx = Math.floor(ip[0]), fz = Math.floor(ip[2]);
      let gy = Math.floor(ip[1] + 0.01);
      for (let k = 0; k < 4 && gy > 0 && !SOLIDCUBE[this.world.getBlock(fx, gy - 1, fz)] && !BLOCKS[this.world.getBlock(fx, gy - 1, fz)].solid; k++) gy--;
      const h = ip[1] - gy;
      if (h < 3) r.drawShadow(ip[0], gy, ip[2], e.w * 0.75 * (1 - h / 6), 0.55 * (1 - h / 3));
    }
  }
  // worn armour (vanilla humanoid armour layers; leather is dyed #A06540 with an undyed overlay): [helmet, chestplate,
  // leggings, boots] on a humanoid model posed by poses (opts: overlay, vp)
  drawArmor(armour, m, poses, lt, env, opts = {}) {
    const r = this.renderer;
    if (!armour.some(s => s)) return;
    const parts = [['head'], ['body', 'rarm', 'larm'], ['body', 'rleg', 'lleg'], ['rleg', 'lleg']];
    armour.forEach((st, slot) => {
      if (!st) return;
      const a = ITEMS[st.id].armor, mat = a && a.mat;
      if (!mat || mat === 'elytra') return;
      const legs = slot === 2, model = legs ? 'armor_inner' : 'armor_outer', tex = r.beTex('armor_' + mat + (legs ? '_legs' : ''));
      if (!tex) return;
      const ap = {}; for (const k of ['head', 'body', 'rarm', 'larm', 'rleg', 'lleg']) ap[k] = parts[slot].includes(k) ? ((poses && poses[k]) || {}) : { hidden: true };
      r.drawModel(model, tex, m, ap, lt, env, { ...opts, tint: mat === 'leather' ? (typeof dyeTintOf === 'function' ? dyeTintOf(st, [160 / 255, 101 / 255, 64 / 255]) : [160 / 255, 101 / 255, 64 / 255]) : null });
      if (mat === 'leather') r.drawModel(model, tex + '_overlay', m, ap, lt, env, opts);
    });
  }
  // the body's facing, like vanilla LivingEntity.tickHeadTurn: it turns towards where the player walks (walking
  // backwards: away from it), to the view while swinging, and otherwise stays put until the head is turned more
  // than 50 degrees from it; the head always follows the view
  tickPlayerBody(p) {
    const wrap = (d) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
    if (p.bodyYaw === undefined || p.prevBodyYaw === undefined) p.bodyYaw = p.prevBodyYaw = p.yaw;
    if (p.pose === 'swim' || p.gliding || p.sleeping || this.sleeping) { p.bodyYaw = p.yaw; return; }
    const dx = p.pos[0] - p.prev[0], dz = p.pos[2] - p.prev[2];
    let target = p.bodyYaw;
    if (dx * dx + dz * dz > 0.0025) {
      target = Math.atan2(-dx, -dz);
      if (Math.abs(wrap(p.yaw - target)) > 95 * Math.PI / 180) target += Math.PI;
    }
    if (p.swingT > 0) target = p.yaw;
    p.bodyYaw += wrap(target - p.bodyYaw) * 0.3;
    const d = wrap(p.yaw - p.bodyYaw), max = 50 * Math.PI / 180;
    if (Math.abs(d) > max) p.bodyYaw += d - Math.sign(d) * max;
    p.bodyYaw = p.yaw + wrap(p.bodyYaw - p.yaw);
  }
  playerBodyYaw(a) {
    const p = this.player;
    if (p.bodyYaw === undefined) return p.yaw;
    let d = p.bodyYaw - (p.prevBodyYaw ?? p.bodyYaw); while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    return (p.prevBodyYaw ?? p.bodyYaw) + d * a;
  }
  // vanilla HumanoidModel.setupAnim for the player, in this model's axes (y up, x mirrored): rx = -xRot, ry = -yRot
  playerPose(a) {
    const p = this.player;
    const swing = lerp(p.limbSwing - p.limbAmt, p.limbSwing, a) * 0.6662, amt = p.limbAmt;
    const l = Math.cos(swing) * 1.4 * amt, r = -l;
    let headY = p.yaw - this.playerBodyYaw(a); while (headY > Math.PI) headY -= Math.PI * 2; while (headY < -Math.PI) headY += Math.PI * 2;
    const P = {
      head: { rx: p.pitch, ry: headY }, body: {},
      rarm: { rx: -Math.cos(swing) * amt }, larm: { rx: Math.cos(swing) * amt }, rleg: { rx: l }, lleg: { rx: r },
    };
    // holding something: the arm half swings and stays a little raised
    if (p.inv.held) P.rarm.rx = P.rarm.rx * 0.5 + Math.PI / 10;
    // the attack swing (setupAttackAnimation): the body twists and carries the shoulders round, the arm rises fast,
    // sweeps in across the body and comes down slowly, higher when looking up
    // (a spear's stab: the twist and shoulders only, its arm is equip.js's)
    const dur = p.swingDur || 6, t = p.swingT > 0 ? clamp((dur - p.swingT + a) / dur, 0, 1) : 0;
    if (t > 0) {
      const by = -Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.2, c = Math.cos(by), s = Math.sin(by);
      P.body.ry = by;
      P.rarm.t = [6 * c - 6, 0, -6 * s]; P.larm.t = [-6 * c + 6, 0, 6 * s];
    }
    if (t > 0 && !p.swingStab) {
      const by = P.body.ry;
      P.rarm.ry = by; P.larm.ry = by; P.larm.rx += by;
      let f = 1 - t; f *= f; f *= f; f = 1 - f;
      const f1 = Math.sin(f * Math.PI), f2 = Math.sin(t * Math.PI) * (p.pitch + 0.7) * 0.75;
      P.rarm.rx += f1 * 1.2 + f2;
      P.rarm.ry += by * 2;
      P.rarm.rz = -0.4 * Math.sin(t * Math.PI);
    }
    // swimming / crawling
    if (p.pose === 'swim') return swimLimbs(P, lerp(p.limbSwing - p.limbAmt, p.limbSwing, a), p.swimming);
    // crouching (vanilla HumanoidModel offsets, converted to this model's y-up pixels; switched at once like vanilla)
    if (p.sneaking && !p.flying) {
      P.head.t = [0, -4.2 / 16, 0];
      P.body.t = [0, -1.73 / 16, 5.75 / 16]; P.body.rx = -0.5;
      for (const k of ['rarm', 'larm']) { const o = P[k].t || [0, 0, 0]; P[k].t = [o[0] / 16, o[1] / 16 - 3.2 / 16, o[2] / 16]; P[k].rx -= 0.4; }
      for (const k of ['rleg', 'lleg']) P[k].t = [0, -0.2 / 16, 4 / 16];
    } else for (const k of ['rarm', 'larm']) if (P[k].t) P[k].t = P[k].t.map((v) => v / 16);
    // the arms' idle sway (AnimationUtils.bobArms)
    const age = (p.age || this.tickCount || 0) + a;
    P.rarm.rz = (P.rarm.rz || 0) + Math.cos(age * 0.09) * 0.05 + 0.05; P.larm.rz = (P.larm.rz || 0) - (Math.cos(age * 0.09) * 0.05 + 0.05);
    P.rarm.rx -= Math.sin(age * 0.067) * 0.05; P.larm.rx += Math.sin(age * 0.067) * 0.05;
    return P;
  }
  blockMesh(id, meta) {
    if (!this._bm) this._bm = new Map();
    const k = id * 256 + meta;
    let m = this._bm.get(k);
    if (!m) { m = Mesher.single(id, meta); this._bm.set(k, m); }
    return m;
  }
  spriteMesh(layer) { return itemSpriteMesh(layer); }
  // the layers of a flat item model, each with its colour: potions by their effects, dyed leather by its dye, the rest
  // by the model's tint sources. Only the first layer used to be drawn, untinted (a potion was a grey blob of liquid
  // without its bottle)
  itemLayers(st, def, vim, b) {
    if (!(vim && vim.gen && vim.model.layers && vim.model.layers.length)) return [[b ? (def.flat ? T(def.flat) : b.tex[0]) : def.tex, null]];
    const info = VM.data.items[def.key];
    return vim.model.layers.map((l, k) => [T(l), stackTint(this.renderer, info, k, st)]);
  }
  // draws them over each other: each later layer a little thicker, so it covers the one before instead of flickering
  drawLayers(layers, m, env, light) {
    layers.forEach(([layer, c], k) => {
      let mm = m;
      if (k) { mm = new Float32Array(m); M4.scale(mm, 1, 1, 1 + 0.08 * k); }
      this.renderer.drawMesh(this.spriteMesh(layer), mm, env, light, c ? { color: [c[0] / 255, c[1] / 255, c[2] / 255, 1] } : undefined);
    });
  }
  drawItemModel(id, m, l, env, ctx, st) {
    const def = ITEMS[id], r = this.renderer;
    if (!def) return; // (an item this game doesn't have - a room's, another version's: nothing to draw instead of an error a frame)
    const b = def.block !== undefined ? BLOCKS[def.block] : null;
    const vim = r.itemModel(id);
    const flat = vim ? (vim.gen || (!b && !vim.mesh)) : (!b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door);
    if (flat) {
      const mm = new Float32Array(m);
      if (ctx === 'ground') { M4.scale(mm, 0.5, 0.5, 0.5); M4.translate(mm, -0.5, 0, 0); }
      this.drawLayers(this.itemLayers(st, def, vim, b), mm, env, l);
    } else {
      const mm = new Float32Array(m);
      // (a bed: its own two halves, renderer.itemModel, centred at z 1 - one mesh cached for every bed made all the
      // beds on the ground the colour of the first one drawn)
      if (ctx === 'ground') { M4.scale(mm, 0.25, 0.25, 0.25); M4.translate(mm, -0.5, 0, b && b.bed ? -1 : -0.5); }
      if (vim && vim.mesh) { r.drawMesh(vim.mesh, mm, env, l); return; }
      if (this.isBEItem({ id })) { this.drawBEItem(b, mm, l, env); return; } // (banners, chests, heads ...)
      let meta = b.facing ? 4 : 0; if (b.stairs) meta = 0;
      r.drawMesh(this.blockMesh(def.block, meta), mm, env, l);
    }
  }
  drawHand(a, env) {
    const r = this.renderer, gl = r.gl, p = this.player;
    if (!r.fxOn) gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = M4.create();
    M4.perspective(proj, 70 * Math.PI / 180, r.canvas.width / r.canvas.height, 0.05, 10);
    const savedVP = r.vp, savedCam = r.camPos;
    r.vp = proj; r.camPos = [0, 0, 0];
    // the item in hand (the previous one until the hand has lowered) and how far it is lowered
    const cur = p.inv.held, curId = cur ? cur.id : -1;
    const hid = p.handItem === undefined ? curId : p.handItem;
    const held = hid === curId ? cur : hid >= 0 ? { id: hid, count: 1, dmg: 0 } : null;
    const eq = 1 - lerp(p.oHandH ?? 1, p.handH ?? 1, a);
    const sw = p.swingT > 0 ? clamp((6 - p.swingT + a) / 6, 0, 1) : 0;
    const D = Math.PI / 180, PI = Math.PI;
    const m = M4.create();
    // view bobbing applied to hand as in vanilla (slight)
    if (this.settings.bobbing) {
      const bob = lerp(p.prevBob, p.bob, a) * PI * 0.6, amt = lerp(p.prevBobAmt || 0, p.bobAmt, a);
      M4.translate(m, Math.sin(bob) * amt * 0.5, -Math.abs(Math.cos(bob) * amt), 0);
    }
    const lt = p.lightAt();
    const env2 = { ...env, fogNear: 1e8, fogFar: 2e8 };
    if (!held) {
      const f1 = Math.sqrt(sw);
      M4.translate(m, -0.3 * Math.sin(f1 * PI) + 0.64, 0.4 * Math.sin(f1 * PI * 2) - 0.6 - eq * 0.6, -0.4 * Math.sin(sw * PI) - 0.72);
      M4.rotY(m, 45 * D);
      M4.rotY(m, Math.sin(f1 * PI) * 70 * D);
      M4.rotZ(m, Math.sin(sw * sw * PI) * -20 * D);
      M4.translate(m, -1, 3.6, 3.5);
      M4.rotZ(m, 120 * D); M4.rotX(m, 200 * D); M4.rotY(m, -135 * D);
      M4.translate(m, 5.6, 0, 0);
      M4.translate(m, -6 / 16, 2 / 16, 0);
      M4.rotZ(m, PI);
      r.drawModel(typeof Skins !== 'undefined' ? Skins.armOf(this, false) : 'arm', typeof Skins !== 'undefined' ? Skins.texOf(this, p) : 'steve', m, null, lt, env2, { vp: proj });
    } else {
      const def = ITEMS[held.id];
      const b = def.block !== undefined ? BLOCKS[def.block] : null;
      const vim = r.itemModel(held.id);
      const flat = vim ? (vim.gen || (!b && !vim.mesh)) : (!b || def.flat || b.shape === SH_CROSS || b.shape === SH_TORCH || b.ladder || b.door);
      // eating and drinking (potions, milk, honey, ominous bottles) share vanilla's applyEatTransform; the honey
      // bottle takes 40 ticks, the rest 32
      const eating = p.usingItem && (def.food || /^(potion|milk_bucket|honey_bottle|ominous_bottle)$/.test(def.key));
      const bowing = p.usingItem && def.key === 'bow';
      if (eating) {
        const dur = def.key === 'honey_bottle' ? 40 : 32, left = dur - p.useT - a + 1, f1 = left / dur;
        if (f1 < 0.8) M4.translate(m, 0, Math.abs(Math.cos(left / 4 * PI) * 0.1), 0);
        const f3 = 1 - Math.pow(Math.max(0, f1), 27);
        M4.translate(m, f3 * 0.6, f3 * -0.5, 0);
        M4.rotY(m, f3 * 90 * D); M4.rotX(m, f3 * 10 * D); M4.rotZ(m, f3 * 30 * D);
        M4.translate(m, 0.56, -0.52 - eq * 0.6, -0.72);
      } else if (bowing) {
        M4.translate(m, 0.56, -0.52 - eq * 0.6, -0.72);
        M4.translate(m, -0.2785682, 0.18344387, 0.15731531);
        M4.rotX(m, -13.935 * D); M4.rotY(m, 35.3 * D); M4.rotZ(m, -9.785 * D);
        let f = (p.useT + a) / 20; f = (f * f + f * 2) / 3; if (f > 1) f = 1;
        if (f > 0.1) M4.translate(m, 0, Math.sin((p.useT - 0.1) * 1.3) * (f - 0.1) * 0.004, 0);
        M4.translate(m, 0, 0, f * 0.04);
        M4.scale(m, 1, 1, 1 + f * 0.2);
        M4.rotY(m, -45 * D);
      } else {
        const f1 = Math.sqrt(sw);
        M4.translate(m, -0.4 * Math.sin(f1 * PI), 0.2 * Math.sin(f1 * PI * 2), -0.2 * Math.sin(sw * PI));
        M4.translate(m, 0.56, -0.52 - eq * 0.6, -0.72);
        const f = Math.sin(sw * sw * PI);
        M4.rotY(m, (45 + f * -20) * D);
        M4.rotZ(m, f * -20 * D * Math.sin(f1 * PI));
        M4.rotX(m, Math.sin(f1 * PI) * -80 * D);
        M4.rotY(m, -45 * D);
      }
      if (flat) {
        M4.translate(m, 1.13 / 16, 3.2 / 16, 1.13 / 16);
        M4.rotX(m, 0); M4.rotY(m, -90 * D); M4.rotZ(m, 25 * D);
        M4.scale(m, 0.68, 0.68, 0.68);
        M4.translate(m, -0.5, -0.5, 0);
        let layers = this.itemLayers(held, def, vim, b);
        if (bowing) { const f = p.useT; layers = [[T(f >= 18 ? 'i_bow_pulling_2' : f >= 13 ? 'i_bow_pulling_1' : 'i_bow_pulling_0'), null]]; }
        this.drawLayers(layers, m, env2, lt);
      } else {
        M4.rotY(m, 45 * D);
        M4.scale(m, 0.4, 0.4, 0.4);
        M4.translate(m, -0.5, -0.5, -0.5);
        const im = r.itemModel(held.id);
        if (im && im.mesh && !(b && b.bed)) { r.drawMesh(im.mesh, m, env2, lt); r.vp = savedVP; r.camPos = savedCam; return; }
        let meta = b.facing ? 4 : 0; if (b.stairs) meta = 0;
        if (b.bed) { M4.translate(m, 0.25, 0.2, 0.5); M4.scale(m, 0.6, 0.6, 0.6); r.drawMesh(this.bedMesh || (this.bedMesh = Mesher.multi([[def.block, 0, 0, 0, 0], [def.block, 4, 0, 0, -1]])), m, env2, lt); }
        else r.drawMesh(this.blockMesh(def.block, meta), m, env2, lt);
      }
    }
    r.vp = savedVP; r.camPos = savedCam;
  }
  // vanilla weather: within 10 blocks, one camera-facing quad per column from the ground (or 10
  // below the eye) to 10 above it; rain.png spans the quad's width and repeats every 4 blocks,
  // each column scrolls at its own random speed; snow falls slowly and drifts sideways.
  // Columns fade with distance and take the lightmap colour of where they are.
  // What a column is - where it starts and ends, rain or snow, its light, its random speed - is worked out once a tick (or
  // when the eye moves into another block: weatherCols); each frame only writes the vertices, into one array kept for
  // it, sent with bufferSubData. All of it every frame cost 0.66 ms and 236 KB of garbage a frame on a desktop (437
  // columns while raining; a phone takes several times that, and a collection every few seconds); now 0.03 ms and ~40
  // bytes on a frame between ticks, 0.47 ms and ~10 KB on one that works the columns out - 0.16 ms a frame at 60 Hz.
  // The same vertices as before, to the bit
  weatherCols(px, pz, cy, ticks, R) {
    const w = this.world, N = (2 * R + 1) * (2 * R + 1);
    let C = this.wxCols;
    if (!C || C.N !== N) C = this.wxCols = { N, n: 0, tick: -1, px: 0, pz: 0, cy: 0, w: null, cx: new Float64Array(N), cz: new Float64Array(N), y0: new Int32Array(N), y1: new Int32Array(N),
      sx: new Float64Array(N), sz: new Float64Array(N), cold: new Uint8Array(N), li: new Uint16Array(N), k: new Float64Array(N), i3: new Uint8Array(N), u0: new Float64Array(N),
      // rain or snow, or neither, by column for as long as its surface stays (the biome's temperature at that height:
      // the noise behind it was most of a rebuild's time and garbage), 64 x 64 columns by world position
      gx: new Int32Array(4096), gz: new Int32Array(4096), gy: new Int32Array(4096).fill(-1e9), gf: new Uint8Array(4096) };
    if (C.tick === ticks && C.px === px && C.pz === pz && C.cy === cy && C.w === w) return C;
    if (C.w !== w) C.gy.fill(-1e9);
    C.tick = ticks; C.px = px; C.pz = pz; C.cy = cy; C.w = w;
    let n = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = px + dx, z = pz + dz;
      if (!w.isLoaded(x, z)) continue;
      // a column roofed higher than the scan below starts (a cave, a deep mine) gets no rain: the scan alone missed
      // the roof and it rained in deep caves (players' feedback 2026-10-31); vanilla goes by the heightmap
      const sy = w.surfaceY(x, z);
      if (sy + 1 > cy + R) continue;
      // height of the first motion-blocking block in this column
      let ground = cy + R;
      while (ground > cy - R - 1 && !BLOCKS[w.getBlock(x, ground - 1, z)].solid && !IS_FLUID[w.getBlock(x, ground - 1, z)]) ground--;
      const y0 = Math.max(cy - R, ground), y1 = Math.max(cy + R, ground);
      if (y0 === y1) continue;
      const gi = ((z & 63) << 6) | (x & 63);
      if (C.gx[gi] !== x || C.gz[gi] !== z || C.gy[gi] !== sy) { C.gx[gi] = x; C.gz[gi] = z; C.gy[gi] = sy; C.gf[gi] = this.dryAt(x, z) ? 2 : this.isCold(x, z) ? 1 : 0; }
      if (C.gf[gi] === 2) continue;
      // column direction: the quad faces the player
      const f2 = Math.hypot(dz, dx) || 1;
      const ly = Math.max(cy, ground), L = w.getLight(x, ly, z), cold = C.gf[gi] === 1;
      // the column's own random numbers: the first two of RNG(seed) (util.js mulberry32), without making one each time
      const a1 = ((((x * x * 3121 + x * 45238971) ^ (z * z * 418711 + z * 13761)) >>> 0 | 0) + 0x6D2B79F5) | 0;
      let sl = L >> 4, bl = L & 15;
      if (cold) {
        sl = Math.min(15, Math.round(((L >> 4) * 3 + 15) / 4)); bl = Math.min(15, Math.round(((L & 15) * 3 + 15) / 4));
        C.k[n] = mulberryAt(a1); C.u0[n] = mulberryAt((a1 + 0x6D2B79F5) | 0) + 0.01 * Math.sin(ticks * 0.05 + x);
      } else { C.k[n] = 3 + mulberryAt(a1); C.i3[n] = (ticks + x * x * 3121 + x * 45238971 + z * z * 418711 + z * 13761) & 31; }
      C.cx[n] = x + 0.5; C.cz[n] = z + 0.5; C.y0[n] = y0; C.y1[n] = y1; C.sx[n] = -dx / f2 * 0.5; C.sz[n] = dz / f2 * 0.5;
      C.cold[n] = cold ? 1 : 0; C.li[n] = (sl * 16 + bl) * 4;
      n++;
    }
    C.n = n;
    return C;
  }
  drawWeather(env, a) {
    if (this.weather < 0.02) return;
    const r = this.renderer, gl = r.gl, p = this.player, w = this.world;
    // (the eye between ticks, as p.ipos(a) - without its new array)
    const ix = lerp(p.prev[0], p.pos[0], a), iz = lerp(p.prev[2], p.pos[2], a), camY = lerp(p.prev[1], p.pos[1], a) + p.eye();
    const px = Math.floor(ix), pz = Math.floor(iz), cy = Math.floor(camY);
    const R = 10, ticks = this.tickCount, C = this.weatherCols(px, pz, cy, ticks, R);
    const lm = r._lmData, wt = this.weather, fxOn = r.fxOn;
    if (!r.weatherData || r.weatherData.length < C.N * 36) r.weatherData = new Float32Array(C.N * 36);
    const V = r.weatherData;
    // rain first, then snow, each in the columns' order (the quads blend over each other)
    let o = 0, nRain = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < C.n; i++) {
      const cold = C.cold[i];
      if (cold !== pass) continue;
      const cx = C.cx[i], cz = C.cz[i], ex = cx - ix, ez = cz - iz;
      const alpha = ((1 - (ex * ex + ez * ez) / (R * R)) * 0.5 + 0.5) * wt;
      if (alpha <= 0) continue;
      let u0 = 0, vOff;
      if (!cold) vOff = -((C.i3[i] + a) / 32) * C.k[i];
      else { vOff = -(((ticks & 511) + a) / 512) + C.k[i]; u0 = C.u0[i]; }
      const li = C.li[i], lr = lm ? lm[li] / 255 : 1, lg = lm ? lm[li + 1] / 255 : 1, lb = lm ? lm[li + 2] / 255 : 1;
      // (with the shader pack rain and snow are fainter, the haze carries the weather)
      const al = alpha * (fxOn ? (cold ? 0.6 : 0.4) : 1);
      const y0 = C.y0[i], y1 = C.y1[i], sx = C.sx[i], sz = C.sz[i], v0 = y0 * 0.25 + vOff, v1 = y1 * 0.25 + vOff;
      o = weatherVert(V, o, cx - sx, y1, cz - sz, u0, v0, lr, lg, lb, al);
      o = weatherVert(V, o, cx + sx, y1, cz + sz, u0 + 1, v0, lr, lg, lb, al);
      o = weatherVert(V, o, cx + sx, y0, cz + sz, u0 + 1, v1, lr, lg, lb, al);
      o = weatherVert(V, o, cx - sx, y0, cz - sz, u0, v1, lr, lg, lb, al);
      if (!cold) nRain++;
    }
    const nSnow = o / 36 - nRain;
    if (!r.weatherProg) {
      r.weatherProg = compile(gl, `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in vec4 a_col;
uniform mat4 u_vp; out vec2 v_uv; out vec4 v_col;
void main(){ v_uv = a_uv; v_col = a_col; gl_Position = u_vp * vec4(a_pos, 1.0); }`, `#version 300 es
precision highp float; uniform sampler2D u_tex; in vec2 v_uv; in vec4 v_col; out vec4 o;
void main(){ vec4 t = texture(u_tex, v_uv); if (t.a * v_col.a < 0.01) discard; o = t * v_col; }`);
      r.weatherVao = gl.createVertexArray(); gl.bindVertexArray(r.weatherVao);
      r.weatherBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, r.weatherBuf);
      gl.bufferData(gl.ARRAY_BUFFER, V.byteLength, gl.DYNAMIC_DRAW); r.weatherCap = V.length; // (its size once: then only written into)
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.quadIdx);
    }
    const P = r.weatherProg;
    gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.u_vp, false, r.vp); gl.uniform1i(P.u.u_tex, 0);
    gl.bindVertexArray(r.weatherVao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    if (o) {
      gl.bindBuffer(gl.ARRAY_BUFFER, r.weatherBuf);
      if (r.weatherCap < V.length) { gl.bufferData(gl.ARRAY_BUFFER, V.byteLength, gl.DYNAMIC_DRAW); r.weatherCap = V.length; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, V, 0, o);
      gl.activeTexture(gl.TEXTURE0);
      if (nRain) { gl.bindTexture(gl.TEXTURE_2D, r.entityTex.rain); gl.drawElements(gl.TRIANGLES, nRain * 6, gl.UNSIGNED_INT, 0); }
      if (nSnow) { gl.bindTexture(gl.TEXTURE_2D, r.entityTex.snowfall); gl.drawElements(gl.TRIANGLES, nSnow * 6, gl.UNSIGNED_INT, nRain * 24); }
    }
    gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
    // vanilla rain sounds: from a random spot where rain lands nearby (quieter when it's above you)
    if (this.weather > 0.2 && this.tickCount !== this._rainSoundT && Math.random() < 0.33 * this.weather) {
      this._rainSoundT = this.tickCount;
      const x = px + ((Math.random() * 21) | 0) - 10, z = pz + ((Math.random() * 21) | 0) - 10;
      if (!this.isCold(x, z) && !this.dryAt(x, z)) {
        const gy = w.surfaceY(x, z) + 1;
        if (gy > camY + 1 && w.surfaceY(px, pz) + 1 > camY) Sound.ev('weather.rain.above', [x, gy, z], 0.1, 0.5);
        else Sound.ev('weather.rain', [x, gy, z], 0.2, 1);
      }
    }
  }

  // ---- pointer -------------------------------------------------------------------------------
  capturePointer() {
    if (this.state !== 'play') return;
    // a screen closed with Esc: the lock is taken when the key comes up - taken while it was down, the browser read
    // that same Esc as leaving the lock and the pause screen opened again (Mac, players' feedback 2026-10-31)
    if (this.escHeld && performance.now() - this.escHeld < 1500) { this.escCapture = true; return; }
    const c = this.canvas, ua = navigator.userActivation;
    // (already locked, or a request still on its way: asking again sent a change event without the lock - main.js then
    // opened the pause menu under a mouse that got locked a moment later - or, Chrome's first raw-input request still
    // pending, "Pointer lock pending": a refusal, and the game went on with the mouse free)
    if (document.pointerLockElement === c || performance.now() - (this.lockAsked || 0) < 1000) return;
    if (!this.lockHooked) {
      this.lockHooked = true;
      document.addEventListener('pointerlockchange', () => { this.lockAsked = 0; this.lockSoftAt = 0; if (document.pointerLockElement !== c) this.lockLostAt = performance.now(); });
      // A refusal that says nothing about the browser - asked with no click or key behind it (a screen closed with Esc,
      // a world that took over ~5 s to load), or again within the moment the browser holds off after the player left
      // the lock with Esc - doesn't count toward playing with the mouse free (main.js counts every pointerlockerror,
      // this listener comes after its own): the pause menu or "click to continue" asks for a click instead. Counted, it
      // left PC players with the cursor out and leaving the window, onto a second screen ("鼠标锁不住、指针露出来",
      // feedback 10-30 to 11-03, ~45). A browser that refuses a click still gets the free mouse.
      document.addEventListener('pointerlockerror', () => {
        // (Firefox, Safari: no promise to settle, the request is over with this event - the next click asks again)
        if (this.lockNoPromise) this.lockAsked = 0;
        if (this.lockSoftAt && performance.now() - this.lockSoftAt < 1500) { this.lockSoftAt = 0; this.lockFails = Math.max(0, (this.lockFails || 0) - 1); }
      });
    }
    const ask = (raw) => {
      const now = performance.now(), soft = (ua && !ua.isActive) || now - (this.lockLostAt || -1e9) < 2000;
      this.lockAsked = now; this.lockSoftAt = soft ? now : 0;
      let r;
      try { r = raw ? c.requestPointerLock({ unadjustedMovement: true }) : c.requestPointerLock(); }
      catch (e) { this.lockAsked = 0; if (raw) { this.rawLockOff = true; ask(false); } return; }
      this.lockNoPromise = !(r && r.then);
      if (r && r.then) r.then(() => { this.lockAsked = 0; }, (e) => {
        this.lockAsked = 0;
        // raw input (unadjustedMovement) isn't on every system: asked again without it at once, still inside the click,
        // and not asked for again this session (each refusal was a pointerlockerror too)
        if (raw && e && e.name === 'NotSupportedError') { this.rawLockOff = true; ask(false); this.lockSoftAt = performance.now(); }
      });
    };
    ask(this.settings.rawInput !== false && !this.rawLockOff);
  }
  releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }
}

const WOOL_RGB = [[1, 1, 1], [0.95, 0.55, 0.2], [0.75, 0.3, 0.75], [0.4, 0.6, 0.85], [0.9, 0.85, 0.2], [0.5, 0.8, 0.2], [0.95, 0.6, 0.7], [0.3, 0.3, 0.3], [0.6, 0.6, 0.6], [0.2, 0.55, 0.6], [0.5, 0.25, 0.7], [0.2, 0.3, 0.65], [0.45, 0.3, 0.2], [0.35, 0.45, 0.2], [0.65, 0.2, 0.2], [0.1, 0.1, 0.1]];

Player.prototype.loadedHere = function () {
  const w = this.world, x = Math.floor(this.pos[0]), z = Math.floor(this.pos[2]);
  return w.isLoaded(x, z) && w.getChunk(x >> 4, z >> 4).lit;
};

// one output of util.js RNG (mulberry32) for a state already stepped: RNG(seed)()'s first is mulberryAt((seed | 0) +
// 0x6D2B79F5 | 0), the next one 0x6D2B79F5 further (the weather's per-column numbers, with no generator made for them)
function mulberryAt(a) {
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// one weather vertex (position, uv, colour) into V at o; the next offset
function weatherVert(V, o, x, y, z, u, v, cr, cg, cb, ca) {
  V[o] = x; V[o + 1] = y; V[o + 2] = z; V[o + 3] = u; V[o + 4] = v; V[o + 5] = cr; V[o + 6] = cg; V[o + 7] = cb; V[o + 8] = ca;
  return o + 9;
}
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const mins = [x0, y0, z0], maxs = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mins[i] || o[i] > maxs[i]) return null; continue; }
    let t1 = (mins[i] - o[i]) / d[i], t2 = (maxs[i] - o[i]) / d[i];
    let f1 = i * 2, f2 = i * 2 + 1; // face indices: 0 -x,1 +x,2 -y,3 +y,4 -z,5 +z
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; const f = f1; f1 = f2; f2 = f; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face };
}
// swimming / crawling limbs (the player, other players): breaststroke arms and fluttering legs, at vanilla's pace:
// one stroke every 26 units of limb swing (about 1.3 s at full speed), the legs kick with cos(limbSwing / 3)
function swimLimbs(P, t, swimming) {
  const ph = (((t % 26) + 26) % 26) / 26 * Math.PI * 2;
  const reach = Math.PI * (0.5 + 0.5 * Math.cos(ph)), spread = Math.max(0, Math.sin(ph)) * 1.1;
  P.rarm = { rx: reach, rz: spread }; P.larm = { rx: reach, rz: -spread };
  P.rleg = { rx: Math.cos(t / 3) * 0.3 }; P.lleg = { rx: -Math.cos(t / 3) * 0.3 };
  P.head.rx = swimming ? Math.PI / 4 : 1.2; // vanilla: the head tilts 45 degrees up while swimming
  return P;
}
