'use strict';
// ---------------------------------------------------------------------------
// Vanilla-terrain worlds ("gen 2"): biome tables from the bundled biome JSON, the worldgen worker
// pool, and the chunk pipeline
//   worker: noise + aquifers + surface  ->  proto chunk (stage 1)
//   main:   features, once the 8 neighbours are proto chunks  ->  decorated (stage 2)
//   main:   a decorated chunk whose 8 neighbours are decorated is final: lit, meshed, playable
// (features write into neighbouring chunks, so this mirrors vanilla's FEATURES -> LIGHT -> FULL).
// ---------------------------------------------------------------------------
const VB_BASE = 32;            // biome ids of gen-2 chunks: VB_BASE + index in WG_DATA.biome_order
const VBIOME = [];
function hexRGB(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function initVanillaBiomes(grassMap, foliageMap) {
  if (VBIOME.length) return;
  const D = self.WG_DATA;
  D.biome_order.forEach((name, i) => {
    const id = VB_BASE + i, b = D.biome[name], e = b.effects || {}, at = b.attributes || {};
    // GrassColor / FoliageColor: colormap at (1 - temperature, 1 - downfall * temperature)
    const col = (map, override) => {
      if (override) return hexRGB(override);
      const t = clamp(b.temperature, 0, 1), d = clamp(b.downfall, 0, 1) * t;
      const k = ((((1 - d) * 255) | 0) * 256 + (((1 - t) * 255) | 0)) * 4;
      return [map[k], map[k + 1], map[k + 2]];
    };
    let grass = col(grassMap, e.grass_color);
    if (e.grass_color_modifier === 'dark_forest') {
      const v = ((((grass[0] << 16) | (grass[1] << 8) | grass[2]) & 0xFEFEFE) + 0x28340A) >> 1;
      grass = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    const sky = at['minecraft:visual/sky_color'], fog = at['minecraft:visual/fog_color'];
    const music = at['minecraft:audio/background_music'];
    VBIOME[id] = {
      name, def: b, cn: D.biome_cn[name] || name, precip: !!b.has_precipitation,
      sky: sky ? hexRGB(sky) : null, fog: fog ? hexRGB(fog) : null,
      grass, foliage: col(foliageMap, e.foliage_color), swamp: e.grass_color_modifier === 'swamp',
      water: hexRGB(e.water_color || '#3f76e4'),
      music: music && music.default ? music.default.sound.replace('minecraft:', '') : null,
      amb: at['minecraft:audio/ambient_sounds'] || null, // (loop / mood / additions: audio.js ambientSounds)
    };
    BIOMES[id] = VBIOME[id].cn; BIOME_TEMP[id] = b.temperature; BIOME_WATER[id] = VBIOME[id].water;
  });
}
const vbiomeIndex = (name) => self.WG_DATA.biome_order.indexOf(name) + VB_BASE;
// vanilla parses numeric seeds as longs and hashes anything else with String.hashCode
function parseSeed(str) {
  str = (str || '').trim();
  if (!str) { const r = () => BigInt(Math.floor(Math.random() * 4294967296)); return BigInt.asIntN(64, (r() << 32n) | r()).toString(); }
  if (/^[-+]?\d+$/.test(str)) { const v = BigInt(str); if (v >= -(2n ** 63n) && v < 2n ** 63n) return v.toString(); }
  let h = 0; for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return String(h);
}
const seed32 = (s) => typeof s === 'number' ? s | 0 : Number(BigInt.asIntN(32, BigInt(s)));

// ---- worker pool ---------------------------------------------------------------------------------
// vanilla block-state strings of the structure templates -> [id, meta] in this game (id -1: not placed)
const STATE_ALIAS = { cave_air: 'air', void_air: 'air', wall_torch: 'torch', suspicious_gravel: 'gravel', suspicious_sand: 'sand', lit_furnace: 'furnace',
  bubble_column: 'water', end_gateway: 'end_portal' };
const FACE_META = { west: 0, east: 1, north: 4, south: 5 };
function mapVanillaState(str) {
  const k = str.indexOf('['), name = k < 0 ? str : str.slice(0, k), props = {};
  if (k >= 0) for (const kv of str.slice(k + 1, -1).split(',')) { const [a, v] = kv.split('='); props[a] = v; }
  const key = BID[name] !== undefined ? name : STATE_ALIAS[name];
  if (key === 'air' || name === 'air') return [0, 0];
  const id = BID[key];
  if (id === undefined) return null;
  // water and lava: level 0 a source, 1-7 flowing, 8-15 falling (this game's metas 0, 1-7, 8); every flowing
  // fluid came in as a source before - imported worlds flooded, and a server's streams were drawn full
  if ((id === WATER || id === LAVA) && props.level !== undefined) { const l = +props.level || 0; return [id, l >= 8 ? 8 : l]; }
  const b = BLOCKS[id];
  if (key === 'redstone_wire' && +props.power > 0 && typeof WIRE_ID !== 'undefined') { const r = Features.stateOf({ Name: key, Properties: props }) || [id, 0]; return [WIRE_ID[+props.power], r[1]]; }
  if (b.states) return Features.stateOf({ Name: key, Properties: props }) || [id, 0];
  if (b.facing && props.facing) {
    let m = FACE_META[props.facing] ?? 0;
    if (b.chestLike) { if (props.type === 'left') m |= 16; else if (props.type === 'right') m |= 32; }
    return [id, m];
  }
  if (b.axis && props.axis) return [id, { y: 0, x: 1, z: 2 }[props.axis]];
  if (k < 0) return [id, 0];
  // compact-meta blocks: the meta whose vanilla state matches best
  let best = 0, bestScore = -1e9;
  for (let m = 0; m < 64; m++) {
    const vs = vanillaState(b, m, null);
    if (vs.key !== name && !(name === 'wall_torch' && vs.key === 'wall_torch')) continue;
    let sc = 0;
    for (const a in props) if (vs.p[a] !== undefined) sc += String(vs.p[a]) === props[a] ? 1 : -10;
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  return [id, best];
}
// A vanilla block this game doesn't have, shown as the closest one it does (same properties: facing, half, ...):
// without its variant prefix (stripped_, waxed_, oxidised copper, potted_, dead coral), in oak instead of another
// wood, in another colour, or as the plain block of its shape (stairs -> stone stairs ...). Banners, heads and
// such stay air. Returns [id, meta, true] for a substitute; null when nothing fits.
const NEAR_WOODS = ['spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'crimson', 'warped'];
const NEAR_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const NEAR_SHAPES = [
  ['_wall_hanging_sign', 'oak_wall_sign'], ['_hanging_sign', 'oak_sign'], ['_wall_sign', 'oak_wall_sign'], ['_sign', 'oak_sign'],
  ['_fence_gate', 'oak_fence_gate'], ['_pressure_plate', 'stone_pressure_plate', 'oak_pressure_plate'], ['_trapdoor', 'oak_trapdoor'], ['_door', 'oak_door'],
  ['_stairs', 'stone_stairs', 'cobblestone_stairs', 'oak_stairs'], ['_slab', 'stone_slab', 'smooth_stone_slab', 'cobblestone_slab', 'oak_slab'],
  ['_wall', 'cobblestone_wall'], ['_fence', 'oak_fence'], ['_button', 'stone_button', 'oak_button'], ['_planks', 'oak_planks'], ['_log', 'oak_log'],
  ['_wood', 'oak_log'], ['_hyphae', 'oak_log'], ['_stem', 'oak_log'], ['_leaves', 'oak_leaves'], ['_sapling', 'oak_sapling'],
  ['_bricks', 'stone_bricks', 'bricks'], ['_tiles', 'stone_bricks'], ['_pillar', 'quartz_block', 'stone'], ['_ore', 'stone'], ['_rail', 'rail'],
  ['shulker_box', 'chest'], ['_carpet', 'white_carpet'], ['_candle', 'candle'], ['_wall_torch', 'wall_torch'], ['_torch', 'torch'],
  ['_lantern', 'lantern'], ['_bars', 'iron_bars'], ['_chain', 'chain', 'iron_chain'], ['_grate', 'glass'], ['_bulb', 'redstone_lamp'],
  ['_froglight', 'glowstone'], ['_coral_block', 'stone'], ['_concrete_powder', 'sand'], ['_block', 'stone'],
];
function nearNames(n) {
  const out = [], add = (x) => { if (x && x !== n && !out.includes(x)) out.push(x); };
  const b = n.replace(/^(waxed_|stripped_|infested_|potted_|dead_)+/, '').replace(/^(exposed_|weathered_|oxidized_)/, '');
  add(b);
  for (const wd of NEAR_WOODS) if (b.startsWith(wd + '_')) add('oak_' + b.slice(wd.length + 1));
  for (const c of NEAR_COLORS) if (b.startsWith(c + '_')) { const rest = b.slice(c.length + 1); for (const c2 of NEAR_COLORS) add(c2 + '_' + rest); add(rest); }
  add(b.replace(/_concrete_powder$/, '_concrete')); add(b.replace(/_glazed_terracotta$/, '_terracotta'));
  if (/glass_pane$/.test(b)) add('glass_pane'); else if (/glass$/.test(b)) add('glass');
  if (b.includes('copper_')) { add(b.replace('copper_', 'iron_')); add(b.replace('copper_', '')); }
  if (b.startsWith('soul_')) add(b.slice(5));
  if (b.endsWith('candle_cake')) add('cake');
  for (const [suf, ...to] of NEAR_SHAPES) if (b.endsWith(suf)) { for (const t of to) add(t); break; }
  return out;
}
const nearCache = new Map();
function mapVanillaStateNear(str) {
  const exact = mapVanillaState(str);
  if (exact) return exact;
  let r = nearCache.get(str);
  if (r !== undefined) return r;
  r = null;
  const k = str.indexOf('['), name = k < 0 ? str : str.slice(0, k), props = k < 0 ? '' : str.slice(k);
  for (const cand of nearNames(name)) {
    let m = null;
    try { m = mapVanillaState(cand + props); } catch (e) { }
    if (m && m[0]) { r = [m[0], m[1], true]; break; }
  }
  nearCache.set(str, r);
  return r;
}
function structStateMap() {
  if (structStateMap.cache) return structStateMap.cache;
  const S = self.STRUCT_DATA;
  if (!S || typeof Features === 'undefined') return null;
  const out = new Int32Array(S.states.length * 2), missing = new Set();
  // per state: 2 = the block can hold water, 1 = the template has it waterlogged (structStateMap.wl)
  const wl = structStateMap.wl = new Uint8Array(S.states.length);
  S.states.forEach((str, i) => {
    // the template's own markers are not placed
    let r = null;
    const name = str.split('[')[0];
    if (!['structure_void', 'structure_block', 'jigsaw'].includes(name)) try { r = mapVanillaState(str); } catch (e) { r = null; }
    if (!r) { out[i * 2] = -1; const n = str.split('[')[0]; if (!['structure_void', 'structure_block', 'jigsaw'].includes(n)) missing.add(n); }
    else {
      out[i * 2] = r[0]; out[i * 2 + 1] = r[1];
      if (r[0] > 0 && canWaterlog(r[0], r[1])) wl[i] = 2 | (str.includes('waterlogged=true') ? 1 : 0);
    }
  });
  if (missing.size) console.info('structure blocks the game does not have:', [...missing].join(' '));
  return (structStateMap.cache = out);
}

// the generator inside the page, for when workers cannot be started (pages opened from file://):
// one message at a time between frames, and at most one chunk a frame (InlineGenWorker.frame is counted up
// by the game's frame loop) - a chunk takes 30 ms or more, and generating them back to back left 4 frames a
// second. While playing, a chunk is also followed by twice its time without one: on a phone a chunk takes 300 ms
// and more, and one every frame left the game at 2 - 3 frames a second for as long as chunks were missing
class InlineGenWorker {
  constructor() { this.core = self.makeGenCore(); this.q = []; this.running = false; this.onmessage = null; this.inline = true; this.genFrame = -1; this.nextT = 0; }
  postMessage(m) { this.q.push(m); this.kick(); }
  kick() { if (!this.running && !this.dead) { this.running = true; setTimeout(() => this.step(), 0); } }
  async step() {
    const gen = this.q.length && this.q[0].type === 'gen';
    if (gen) {
      const now = performance.now();
      if (this.genFrame === InlineGenWorker.frame || now < this.nextT) { this.running = false; setTimeout(() => this.kick(), Math.max(4, Math.min(50, this.nextT - now))); return; }
      this.genFrame = InlineGenWorker.frame;
    }
    const m = this.q.shift(), t0 = performance.now();
    if (m && !this.dead) await this.core(m, (msg) => { if (!this.dead && this.onmessage) this.onmessage({ data: msg }); });
    if (gen) { const t = performance.now(), loading = window.game && game.state === 'loading'; this.nextT = loading ? 0 : t + Math.min(1000, 2 * (t - t0)); }
    this.running = false;
    if (this.q.length) this.kick();
  }
  terminate() { this.dead = true; this.q = []; }
}
InlineGenWorker.frame = 0;
const newGenWorker = () => {
  if (!GenPool.inline) { try { return new Worker('js/gen_worker.js'); } catch (e) { GenPool.inline = true; console.info('worldgen: workers unavailable (' + e.name + '), generating in the page'); } }
  return new InlineGenWorker();
};

class GenPool {
  constructor(seed) {
    this.seed = String(seed);
    if (location.protocol === 'file:') GenPool.inline = true;
    const n = GenPool.inline ? 1 : genWorkerCount();
    const palette = { air: 0 };
    for (const k in BID) palette[k] = BID[k];
    this.workers = []; this.queue = []; this.wait = new Map(); this.nextId = 1; this.dead = false;
    // gen jobs asked for and not yet answered, by dimension and chunk (asked): game.js chunkWatchdog forgets
    // game.genPending, and the same chunks were asked for again while the first jobs still waited - on a slow phone the
    // generator then spent its time on duplicates (a world at 350 ms a chunk never finished loading)
    this.keys = new Map();
    this.okN = 0; this.errRun = 0; this.errSeen = new Set(); // chunks made, errors in a row, error kinds reported
    this.init = { type: 'init', seed: this.seed, palette, smap: structStateMap(), swl: structStateMap.wl };
    // ready once a worker has built its generator (jobs sent before that wait in it)
    this.ready = new Promise((res) => { this.readyRes = res; });
    for (let i = 0; i < n; i++) this.spawn(0);
  }
  // a worker that fails (its scripts didn't load, it crashed) is replaced and its jobs go back in the queue;
  // before, its jobs never answered and chunk generation stalled
  spawn(tries) {
    const w = newGenWorker();
    w.busy = 0; w.jobs = new Map();
    // (any answer: it is alive; a job done: it works, and its restarts count from 0 again - they used to add up over a
    // session, and the 5th moved generation into the page for good, one chunk a frame on the main thread)
    w.onmessage = (e) => { const m = e.data; w.jobT = performance.now(); w.heard = true; if (m && m.type !== 'error' && m.type !== 'ready') tries = 0; this.onMessage(w, m); };
    w.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!this.workers.includes(w)) return;
      console.warn('worldgen: worker failed (' + (e && e.message || 'error') + '), restarting');
      this.workers = this.workers.filter(x => x !== w);
      try { w.terminate(); } catch (err) { }
      this.queue.unshift(...w.jobs.values()); w.jobs.clear();
      if (this.dead) return;
      if (tries < 5) setTimeout(() => { if (!this.dead) this.spawn(tries + 1); }, 250 * (tries + 1));
      else if (!this.workers.length) { GenPool.inline = true; this.spawn(0); }
      this.pump();
    };
    w.postMessage(this.init);
    this.workers.push(w);
    this.pump();
  }
  onMessage(w, m) {
    if (!m || !this.workers.includes(w)) return; // (a replaced worker's late answer: its jobs went back in the queue)
    if (m.type === 'ready') { this.readyRes(); return; }
    if (m.type === 'error') this.workerError(m);
    else if (m.type === 'chunk') {
      this.okN++; this.errRun = 0;
      if (m.warn) this.workerError({ message: m.warn }, true);
    }
    if (m.id === undefined) { // (no job: building its generator failed - when every worker's did, the page tries)
      w.broken = true;
      if (!this.okN && !GenPool.inline && !this.dead && this.workers.every(x => x.broken)) this.goInline(String(m.message || '').split('\n')[0]);
      return;
    }
    if (!w.jobs.has(m.id)) return;
    w.jobs.delete(m.id);
    w.busy = Math.max(0, w.busy - 1);
    this.answer(m.id, m);
    this.pump();
  }
  // (a callback that throws is reported, and the queue still moves on)
  answer(id, m) {
    const j = this.wait.get(id);
    if (!j) return;
    this.wait.delete(id);
    if (j.key) { const n = this.keys.get(j.key) - 1; if (n > 0) this.keys.set(j.key, n); else this.keys.delete(j.key); }
    if (this.dead) return;
    try { j.cb(m); } catch (e) { if (window.game && game.reportError) game.reportError('worldgen ' + (m && m.type), e, true); }
  }
  // a worker's error: in the error log once per kind with the worker's own message and place (it was only in the
  // console - telemetry showed what it broke on the page, never why)
  workerError(m, warnOnly) {
    const text = String(m.message || 'error'), line = text.split('\n')[0].slice(0, 200);
    if (!this.errSeen.has(line) && this.errSeen.size < 8) {
      this.errSeen.add(line);
      console.error('worldgen:', text);
      const e = new Error(line); e.stack = text;
      if (window.game && game.reportError) game.reportError(warnOnly ? '地形生成线程（结构）' : '地形生成线程出错', e, true);
    }
    if (warnOnly) return;
    this.errRun++;
    // workers that answer every job with an error and never with a chunk (telemetry 11-02/03: all 28 Firefox devices,
    // every frame) are replaced by the same generator in the page
    if (!this.okN && this.errRun >= 6 && !GenPool.inline && !this.dead) this.goInline(line);
  }
  goInline(why) {
    console.warn('worldgen: the workers only fail (' + why + '), generating in the page');
    if (window.game && game.reportError) game.reportError('地形生成线程不能用，改在页面里生成', new Error(why), true);
    GenPool.inline = true;
    for (const w of this.workers) { try { w.terminate(); } catch (e) { } this.queue.unshift(...w.jobs.values()); w.jobs.clear(); }
    this.workers = [];
    this.spawn(0);
  }
  request(msg, cb) {
    msg.id = this.nextId++;
    const key = msg.type === 'gen' ? (msg.dim || 'overworld') + ':' + ckey(msg.cx, msg.cz) : null;
    if (key) this.keys.set(key, (this.keys.get(key) || 0) + 1);
    this.wait.set(msg.id, { cb, key }); this.queue.push(msg); this.pump();
  }
  asked(dim, k) { return this.keys.has((dim || 'overworld') + ':' + k); }
  pump() {
    for (const w of this.workers) {
      while (w.busy < 2 && this.queue.length) { const m = this.queue.shift(); if (!w.busy) w.jobT = performance.now(); w.busy++; w.jobs.set(m.id, m); w.postMessage(m); }
    }
  }
  // a worker that hasn't answered any job for 30 s (a chunk takes milliseconds) is stuck: it is replaced and
  // its jobs go back in the queue, like a crashed one. (One that has said nothing yet is still loading its scripts and
  // building the generator, which on a slow phone is a good part of that: it gets a minute. A /locate search or an
  // export's biomes can take longer than a chunk by far: 90 s - restarted at 30 s, the same search started over.)
  check() {
    if (GenPool.inline || this.dead) return;
    const now = performance.now();
    if (now - (this.checkT || 0) < 2000) return;
    this.checkT = now;
    for (const w of [...this.workers]) {
      if (!w.busy) { w.jobT = 0; w.suspect = 0; continue; }
      const j0 = w.jobs.values().next().value, lim = !w.heard ? 60000 : j0 && j0.type !== 'gen' ? 90000 : 30000;
      if (now - w.jobT < lim) { w.suspect = 0; continue; }
      // (still silent at the next check, 2 s on: not an answer held up by a long pause of this page)
      if (!w.suspect) { w.suspect = now; continue; }
      console.warn('worldgen: a worker stopped answering, restarting it');
      if (window.game && game.reportError) game.reportError('地形生成线程无响应（已重启）', new Error('worker timeout'), true);
      // the job it was on (its oldest) gets a strike, and one that has stopped two workers is answered as failed
      // instead of going to the next one: a job that never ends restarted the workers forever, and after the 5th
      // restart it ran in the page and froze the game
      const j = w.jobs.values().next().value;
      if (j && (j.strikes = (j.strikes || 0) + 1) >= 2) {
        w.jobs.delete(j.id); w.busy--;
        this.answer(j.id, { type: 'error', id: j.id, message: 'timeout: the job stopped two workers', timeout: true });
      }
      w.onerror({ message: 'timeout' });
    }
  }
  inflight() { return this.wait.size; }
  terminate() { this.dead = true; for (const w of this.workers) w.terminate(); this.workers = []; }
}

Game.prototype.genSetup = function (seed) {
  if (this.genPool && this.genPool.seed === String(seed)) return this.genPool.ready;
  if (this.genPool) this.genPool.terminate();
  if (!this.chunkWorker) this.chunkWorker = new ChunkWorker(this);
  initVanillaBiomes(this.renderer.grassMap, this.renderer.foliageMap);
  this.genPool = new GenPool(seed);
  this.genPending = new Set();
  return this.genPool.ready;
};
// ---- chunk worker (chunk_worker.js): decoration, finishing and meshing off the main thread -------------
// The world it works on is the one last reset into it; its protos are counted in w.protoKeys.
class ChunkWorker {
  constructor(game) {
    this.game = game; this.ready = false; this.failed = false; this.epoch = 0; this.world = null;
    this.meshCb = new Map(); this.nextId = 1;
    // keys the page told it to forget ('unloaded') and not answered yet: not asked for again meanwhile (see 'held');
    // keys of finished chunks waiting in game.finalQ: not asked for again either (they were, while the queue waited
    // for saved data or the frame budget)
    this.asking = new Map(); this.askN = 0; this.inQ = new Set();
    // chunks a stuck worker hung on (key -> stage) in the generated world poisonId names (seed, dimension, structures:
    // the same chunk hangs again there, and only there - another world's chunk at that place is fine), restarts so far
    this.poison = new Map(); this.poisonId = ''; this.restarts = 0;
    if (location.protocol === 'file:' || typeof Worker === 'undefined') { this.failed = true; return; }
    if (!this.start()) this.failed = true;
  }
  start() {
    let w;
    try { w = this.w = new Worker('js/chunk_worker.js'); } catch (e) { return false; }
    this.startT = performance.now(); this.ready = false; this.pingT = 0; this.suspect = 0; this.last = null;
    // (last: its last message when that said which chunk it started on - see stuck())
    w.onmessage = (e) => { if (w !== this.w) return; const m = e.data; this.lastMsg = performance.now(); this.last = m && m.type === 'work' ? m : null; this.onMessage(m); };
    w.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (w !== this.w || this.failed) return;
      const err = new Error(e && e.message || 'error'); err.stack = e && e.filename ? e.filename + ':' + e.lineno : '';
      this.game.reportError('区块线程出错', err, true);
      this.restart(e && e.message);
    };
    return true;
  }
  fail(why) {
    if (this.failed) return;
    console.warn('chunk worker unavailable (' + why + '), staying on the main thread');
    this.failed = true; this.ready = false;
    try { this.w.terminate(); } catch (e) { }
    // whatever it held is lost: its world regenerates on the main thread
    if (this.world) { this.world.protoKeys = null; this.world.useCW = false; }
    this.asking.clear(); this.inQ.clear();
    for (const cb of this.meshCb.values()) cb(null);
    this.meshCb.clear();
  }
  // a worker that stopped answering or crashed is replaced (3 times, then the page goes on without one): the new one is
  // told what the page has, and the chunks the old one was building are asked for again. Before, the first 20 s of
  // silence moved decoration, lighting and meshing to the main thread for good - on a phone the game then crawled - and
  // the chunk it had hung on was then built on the main thread, which froze the page
  restart(why) {
    if (this.failed) return;
    if (this.restarts >= 3) { this.fail(why); return; }
    this.restarts++;
    console.warn('chunk worker: ' + why + ', starting a new one');
    try { this.w.terminate(); } catch (e) { }
    for (const cb of this.meshCb.values()) cb(null);
    this.meshCb.clear(); this.asking.clear();
    if (!this.start()) { this.fail(why + '; no new worker'); return; }
    if (!this.world) return;
    // (messages sent before its scripts have loaded wait in its queue)
    if (this.world === this.game.world) this.reset(this.world, true); else this.world = null;
  }
  // every 5 s: a ping it must answer. One that answers nothing for 20 s is stuck (a loop in a chunk's generation), and
  // one that hasn't started after a minute (its 10 MB of scripts didn't load) won't: either is replaced
  check() {
    if (this.failed) return;
    const now = performance.now();
    if (!this.ready) { if (now - this.startT > 60000) { this.game.reportError('区块线程启动不了', new Error('chunk worker not ready after 60 s'), true); this.restart('not ready after 60 s'); } return; }
    const waiting = this.pingT && !(this.lastMsg >= this.pingT);
    if (waiting) {
      // (still silent 3 s after it was first noticed: an answer held up by a long pause of this page is
      // handled in between)
      if (now - this.pingT > 20000) {
        if (!this.suspect) this.suspect = now;
        else if (now - this.suspect > 3000) this.stuck();
      }
      return;
    }
    this.suspect = 0;
    if (now - (this.pingT || 0) > 5000) { this.pingT = now; this.post({ type: 'ping' }); }
  }
  // the chunk it went quiet on (its last message said it started on it) is skipped from then on, in the new worker and
  // on the main thread alike
  stuck() {
    const last = this.last, k = last && last.type === 'work' && this.world ? last.k : undefined;
    if (k !== undefined) {
      const id = ChunkWorker.genId(this.world);
      if (id !== this.poisonId) { this.poison.clear(); this.poisonId = id; }
      this.poison.set(k, last.s);
    }
    const at = k !== undefined ? ' at chunk ' + (Math.floor(k / 65536) - 32768) + ',' + (k % 65536 - 32768) + ' stage ' + last.s : '';
    this.game.reportError(this.restarts < 3 ? '区块线程无响应（已重启）' : '区块线程无响应（改在主线程生成）', new Error('chunk worker timeout' + at), true);
    this.restart('no answer for 20 s' + at);
  }
  post(m, tr) {
    // (the worker answers which of these it still holds: 'held')
    if (m.type === 'unloaded' && m.keys.length) { m.ask = ++this.askN; for (const k of m.keys) this.asking.set(k, m.ask); }
    this.w.postMessage(m, tr || []);
  }
  // a world (re)starts in the worker. keepQ (a replaced worker): finished chunks waiting in finalQ stay, and the
  // worker is told about them and every chunk the page has - it builds their neighbours against them
  reset(w, keepQ) {
    const g = this.game, q = keepQ && this.world === w ? (g.finalQ || []).filter((m) => m.epoch === this.epoch) : [];
    this.epoch++; this.world = w; w.protoKeys = new Set(); this.sent = null; this.asking.clear(); this.inQ.clear(); g.finalQ = q;
    this.post({ type: 'reset', epoch: this.epoch, seed: w.seedStr, dim: w.dim, minY: w.minY || 0, structures: w.structures !== false });
    this.opts();
    const keys = [], bio = [];
    for (const ch of w.chunks.values()) { keys.push(ckey(ch.cx, ch.cz)); bio.push(ch.biome); }
    for (const m of q) { m.epoch = this.epoch; const k = ckey(m.cx, m.cz); this.inQ.add(k); keys.push(k); bio.push(m.biome); }
    if (keys.length) {
      const b = new Uint8Array(keys.length * 256);
      bio.forEach((x, i) => { if (x) b.set(x, i * 256); });
      this.post({ type: 'have', epoch: this.epoch, keys, biomes: b }, [b.buffer]);
    }
    const p = this.poisonFor(w);
    if (p) this.post({ type: 'skip', keys: [...p.keys()], stages: [...p.values()] });
  }
  poisonFor(w) { return this.poison.size && w && this.poisonId === ChunkWorker.genId(w) ? this.poison : null; }
  static genId(w) { return w.seedStr + ':' + (w.dim || 'overworld') + ':' + (w.structures !== false); }
  // meshing options (图形品质)
  opts() { if (!this.failed) this.post({ type: 'opts', fastLeaves: FAST_LEAVES }); }
  center(cx, cz, R) {
    const s = cx + ',' + cz + ',' + R;
    if (s === this.sent) return;
    this.sent = s;
    this.post({ type: 'center', epoch: this.epoch, cx, cz, R });
  }
  mesh(snap, cb) {
    const id = this.nextId++;
    this.meshCb.set(id, cb);
    snap.type = 'mesh'; snap.id = id;
    this.post(snap, [snap.ids.buffer, snap.metas.buffer, snap.lights.buffer, snap.tints.buffer, snap.biomes.buffer]);
  }
  onMessage(m) {
    const g = this.game, w = this.world;
    switch (m.type) {
      case 'ready': this.ready = true; break;
      case 'mesh': { this.lastMesh = performance.now(); const cb = this.meshCb.get(m.id); this.meshCb.delete(m.id); if (cb) cb(m.error ? null : m); break; }
      case 'final': {
        if (m.epoch !== this.epoch || !w || !w.protoKeys) break;
        const k = ckey(m.cx, m.cz);
        w.protoKeys.delete(k);
        g.genProgressT = performance.now();
        // it was on its way while the page told the worker to forget it (game.js chunkWatchdog): the worker drops it from
        // its finished set when that message arrives, so it is told again that the page has it - without, the chunks
        // next to it waited for it there for good
        if (this.asking.has(k)) { const b = new Uint8Array(256); if (m.biome) b.set(m.biome); this.post({ type: 'have', epoch: this.epoch, keys: [k], biomes: b }, [b.buffer]); }
        this.inQ.add(k);
        (g.finalQ || (g.finalQ = [])).push(m);
        break;
      }
      // of the chunks the page told it to forget, the ones it still holds: back on the page's list (the watchdog had them
      // generated all over again, every 8 s, and on a slow phone the area never filled in). What such a chunk waits for
      // may be a neighbour the page has and the worker forgot (pruned while the player was away for a moment): the page's
      // chunks around it are told again
      case 'held': {
        for (const [k, a] of this.asking) if (a === m.ask) this.asking.delete(k);
        if (m.epoch !== this.epoch || !w || !w.protoKeys) break;
        const nb = new Set();
        for (const k of m.keys) {
          if (w.chunks.has(k)) continue;
          w.protoKeys.add(k);
          const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const n = ckey(cx + a, cz + b); if ((a || b) && w.chunks.has(n)) nb.add(n); }
        }
        if (nb.size) {
          const keys = [...nb], b = new Uint8Array(keys.length * 256);
          keys.forEach((n, i) => b.set(w.chunks.get(n).biome, i * 256));
          this.post({ type: 'have', epoch: this.epoch, keys, biomes: b }, [b.buffer]);
        }
        break;
      }
      case 'work': break; // (the chunk it is building: this.last, for stuck())
      case 'dropped': if (m.epoch === this.epoch && w && w.protoKeys) for (const k of m.keys) w.protoKeys.delete(k); break;
      case 'stats': this.stats = m; break;
      case 'pong': break;
      case 'error': { const e = new Error(m.msg); e.stack = m.stack; g.reportError('区块线程 ' + m.where, e, true); break; }
    }
  }
  inflightMeshes() { return this.meshCb.size; }
}
// a chunk the worker finished: saved edits, structure loot and mobs, tints, light (like finaliseChunk)
Game.prototype.finishFromWorker = function (m) {
  const w = this.world, k = ckey(m.cx, m.cz), cw = this.chunkWorker;
  if (w.chunks.has(k) || !cw || cw.world !== w || m.epoch !== cw.epoch) return;
  // a chunk that can't be built is replaced by an empty one (it comes back generated next time the world
  // loads): a missing chunk keeps its neighbours from ever being drawn, and the world stops loading there
  if (m.broken) { this.reportError('chunk ' + m.cx + ',' + m.cz, new Error(m.broken), true); this.finishStub(w, m.cx, m.cz); return; }
  try { this.finishFromWorkerIn(m, w, k); }
  catch (e) {
    this.reportError('chunk ' + m.cx + ',' + m.cz, e, true);
    if (!w.chunks.has(k)) { try { this.finishChunk(new Chunk(m.cx, m.cz), false); } catch (e2) { w.chunks.set(k, new Chunk(m.cx, m.cz)); } }
  }
};
Game.prototype.finishFromWorkerIn = function (m, w, k) {
  const ch = Chunk.fromWire(m.cx, m.cz, m.sec); // sections, already lit inside
  ch.biome.set(m.biome);
  ch.final = true; ch.sx = m.sx; ch.nb = m.nb;
  if (m.sx && m.sx.wl) ch.wl = new Set(m.sx.wl);
  const saved = w.savedChunks && w.savedChunks.get(k);
  if (saved) decodeChunk(saved, ch);
  if (ch.sx) this.structureExtras(ch, !!saved);
  this.chunkTints(ch);
  ch.nb = null;
  this.finishChunk(ch, !!saved);
};
// the stand-in for a chunk that can't be built (its generation hung a chunk worker, or failed): empty, or the player's
// saved chunk when there is one - its blocks don't come from the generator. (Empty, the next edit there saved the empty
// chunk over the player's build; before chunks that hung a worker were skipped, that saved chunk was built on the main
// thread.) Tints from a finished neighbour's biome
Game.prototype.finishStub = function (w, cx, cz) {
  const saved = w.savedChunks && w.savedChunks.get(ckey(cx, cz));
  if (saved) {
    try {
      const ch = new Chunk(cx, cz);
      decodeChunk(saved, ch); ch.final = true;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = w.chunks.get(ckey(cx + a, cz + b)); if (n) { ch.biome.set(n.biome); break; } }
      this.chunkTints(ch);
      this.finishChunk(ch, true);
      return;
    } catch (e) { this.reportError('chunk ' + cx + ',' + cz, e, true); }
  }
  if (!w.chunks.has(ckey(cx, cz))) this.finishChunk(new Chunk(cx, cz), false);
};

// (an answer without a spawn point - a worker's error - is asked for again a few times, then the world starts at 0, 0:
// it used to be NaN, and the player stood nowhere)
Game.prototype.genSpawn = function () {
  const pool = this.genPool;
  const ask = (n) => new Promise((res) => pool.request({ type: 'spawn' }, res)).then((m) =>
    m && m.type === 'spawn' && Number.isFinite(m.x) && Number.isFinite(m.z) ? [m.x, m.z]
      : n < 4 && !pool.dead ? new Promise((r) => setTimeout(r, 1000)).then(() => ask(n + 1)) : [0, 0]);
  return pool.ready.then(() => ask(0));
};

// one streaming step for a gen-2 world: request, decorate, finalise, forget far proto chunks
Game.prototype.genStep = function (pcx, pcz, R, t0, budget) {
  const w = this.world, pool = this.genPool;
  if (!pool) return;
  pool.check();
  const cw = this.chunkWorker;
  if (cw) cw.check();
  const proto = w.proto || (w.proto = new Map()), pending = this.genPending;
  // decoration / finishing happen in the chunk worker, also when it is still loading its scripts as the world starts
  // streaming (what is sent to it waits in its queue): it used to have to be up already, and a world that started
  // before it - the title's, and on a phone often the first one opened - did all of it on the main thread for good
  if (w.useCW === undefined) w.useCW = !!(cw && !cw.failed && !proto.size);
  if (w.useCW && (!cw || cw.failed)) w.useCW = false;
  const useCW = w.useCW;
  if (useCW && cw.world !== w) cw.reset(w);
  const has = useCW ? (cx, cz) => { const k = ckey(cx, cz); return w.chunks.has(k) || w.protoKeys.has(k) || cw.asking.has(k) || cw.inQ.has(k); }
    : (cx, cz) => w.chunks.has(ckey(cx, cz)) || proto.has(ckey(cx, cz));
  // 1) request proto chunks: finalising out to R + 1.5 needs decorated neighbours (up to sqrt 2 further on the
  // diagonals), which need proto neighbours again: R + 1.5 + 2 * 1.42 -> R + 4.5
  // (not a chunk whose job is still waiting in the pool, whatever genPending says, nor one that just failed: genAnswer)
  const GR = R + 4, now = performance.now(), fails = w.genFails;
  if (pool.inflight() < pool.workers.length * 3) {
    const want = [];
    for (let dx = -GR; dx <= GR; dx++) for (let dz = -GR; dz <= GR; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + 4.5) * (R + 4.5)) continue;
      const cx = pcx + dx, cz = pcz + dz, k = ckey(cx, cz);
      if (pending.has(k) || has(cx, cz) || pool.asked(w.dim, k)) continue;
      if (fails) { const f = fails.get(k); if (f && now < f.until) continue; }
      want.push([cx, cz, d2]);
    }
    want.sort((a, b) => a[2] - b[2]);
    const epoch = this.genEpoch;
    for (const [cx, cz] of want.slice(0, pool.workers.length * 3 - pool.inflight())) {
      const k = ckey(cx, cz);
      pending.add(k);
      this.savedReady(w, k); // start reading its saved data, if any, while it generates
      pool.request({ type: 'gen', cx, cz, dim: w.dim, height: HEIGHT, structures: w.structures !== false }, (m) => { pending.delete(k); if (this.genEpoch === epoch && this.world === w) this.genAnswer(w, cx, cz, m); });
    }
  }
  if (useCW) {
    cw.center(pcx, pcz, R);
    // finished chunks from the worker: light and add them, nearest first, within the frame's budget
    const q = this.finalQ;
    if (q && q.length) {
      q.sort((a, b) => ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2) - ((a.cx - pcx) ** 2 + (a.cz - pcz) ** 2));
      const later = [];
      while (q.length && this.workFits(t0, budget * 0.8, 'finalise')) {
        const m = q.pop(), k = ckey(m.cx, m.cz);
        if (!this.savedReady(w, k)) { later.push(m); continue; } // its saved data is still being read
        cw.inQ.delete(k);
        this.timedWork('finalise', () => this.finishFromWorker(m));
      }
      for (const m of later) q.push(m);
    }
    return;
  }
  // 2) decorate / 3) finalise, nearest first, within the time budget
  const cand = [];
  for (const ch of proto.values()) {
    const dx = ch.cx - pcx, dz = ch.cz - pcz, d2 = dx * dx + dz * dz;
    if (d2 > (R + 3) * (R + 3)) continue;
    cand.push([ch, d2]);
  }
  cand.sort((a, b) => a[1] - b[1]);
  const around = (ch, ok) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { if (!a && !b) continue; const n = proto.get(ckey(ch.cx + a, ch.cz + b)); if (!n || !ok(n)) { if (!n && w.chunks.has(ckey(ch.cx + a, ch.cz + b))) continue; return false; } } return true; };
  // (a chunk the chunk worker hung on - ChunkWorker.poison - isn't built here either: it would freeze the page. Hung
  // decorating it goes on undecorated, hung finishing it becomes an empty chunk)
  const poison = cw ? cw.poisonFor(w) : null;
  for (const [ch, d2] of cand) {
    if (!this.workFits(t0, budget * 0.6, 'decorate')) break;
    // (a chunk whose decoration fails goes on without it; one that can't be finished becomes empty - either
    // way the nearest chunk isn't stuck failing every frame with everything behind it waiting)
    if (ch.stage === 1 && around(ch, () => true)) {
      if (!(poison && poison.get(ckey(ch.cx, ch.cz)) === 1)) this.timedWork('decorate', () => this.guard('decorate ' + ch.cx + ',' + ch.cz, () => this.decorateChunk(ch)));
      ch.stage = 2;
    }
  }
  for (const [ch, d2] of cand) {
    if (!this.workFits(t0, budget * 0.8, 'finalise')) break;
    if (ch.stage === 2 && d2 <= (R + 1.5) * (R + 1.5) && around(ch, (n) => n.stage === 2) && this.savedReady(w, ckey(ch.cx, ch.cz))) this.timedWork('finalise', () => {
      const k = ckey(ch.cx, ch.cz);
      if (poison && poison.get(k) === 2) { proto.delete(k); if (!w.chunks.has(k)) this.finishStub(w, ch.cx, ch.cz); return; }
      try { this.finaliseChunk(ch); }
      catch (e) {
        this.reportError('chunk ' + ch.cx + ',' + ch.cz, e, true);
        const k = ckey(ch.cx, ch.cz);
        proto.delete(k);
        if (!w.chunks.has(k)) this.finishChunk(new Chunk(ch.cx, ch.cz), false);
      }
    });
  }
  // 4) forget proto chunks that drifted far away
  if (this.tickCount % 40 === 0) for (const ch of [...proto.values()]) {
    const dx = ch.cx - pcx, dz = ch.cz - pcz;
    if (dx * dx + dz * dz > (R + 5.5) * (R + 5.5)) proto.delete(ckey(ch.cx, ch.cz)); // requested out to R + 4.5
  }
};
// a gen job's answer: the chunk, or a failure (a worker's error, a job that hung two workers). A failed chunk is asked for
// again after a pause that doubles each time - it was asked for again at once, and a worker's error went on as a chunk:
// telemetry 11-02/03, all 28 Firefox devices, "m.blocks is undefined" here and "B is undefined" in Chunk.packFrom 26 000 -
// 158 000 times each, every frame, and the world never loaded. One that keeps failing while others generate becomes an
// empty chunk, like a chunk that can't be finished: a missing one keeps its neighbours from being drawn
Game.prototype.genAnswer = function (w, cx, cz, m) {
  const k = ckey(cx, cz);
  this.genProgressT = performance.now();
  if (m && m.type === 'chunk' && m.blocks && m.sb) { if (w.genFails) w.genFails.delete(k); this.genReceive(m); return; }
  const f = w.genFails || (w.genFails = new Map()), r = f.get(k) || { n: 0 };
  r.n++; r.until = performance.now() + Math.min(10000, 250 * 2 ** r.n); f.set(k, r);
  if ((r.n >= 4 || (m && m.timeout)) && this.genPool && this.genPool.okN > 0) {
    f.delete(k);
    this.reportError('chunk ' + cx + ',' + cz, new Error('generation failed (' + String(m && m.message || 'no answer').split('\n')[0] + '): left empty'), true);
    // (an empty chunk: heightmap below the world, biome the_void)
    const bi = Math.max(0, vbiomeIndex('the_void') - VB_BASE);
    this.genReceive({ type: 'chunk', cx, cz, blocks: new Uint16Array(256 * HEIGHT), qb: new Uint8Array(16 * (HEIGHT >> 2)).fill(bi), hm: new Int16Array(256).fill((w.minY || 0) - 1), sb: new Uint8Array(256).fill(bi) });
  }
};
Game.prototype.genReceive = function (m) {
  if (!m || m.type !== 'chunk' || !m.blocks || !m.sb) return; // (a chunk only: genAnswer)
  const w = this.world, k = ckey(m.cx, m.cz);
  if (w.useCW && this.chunkWorker && !this.chunkWorker.failed) {
    // (nor one finished and waiting in finalQ: sent again, the worker took it back as a proto and decorated it twice)
    if (w.chunks.has(k) || w.protoKeys.has(k) || this.chunkWorker.inQ.has(k)) return;
    if (m.sx) { const refs = w.structRefs || (w.structRefs = new Map()); for (const [name, box, f] of m.sx.refs) refs.set(name + ':' + box[0] + ',' + box[2], { name, box, f }); }
    const msg = { type: 'proto', epoch: this.chunkWorker.epoch, cx: m.cx, cz: m.cz, blocks: m.blocks, qb: m.qb, hm: m.hm, sb: m.sb, meta: m.meta, sx: m.sx };
    const tr = [m.blocks.buffer]; if (m.meta) tr.push(m.meta.buffer);
    try { this.chunkWorker.post(msg, tr); w.protoKeys.add(k); } catch (e) { this.reportError('chunk ' + m.cx + ',' + m.cz, e, true); } // (not sent: asked for again)
    return;
  }
  if (w.chunks.has(k) || w.proto.has(k)) return;
  const ch = Chunk.from(m.cx, m.cz, m.blocks, m.sx ? m.meta : null);
  ch.qb = m.qb; ch.hm = m.hm;
  if (m.sx) {
    ch.sx = m.sx;
    if (m.sx.wl && m.sx.wl.length) ch.wl = new Set(m.sx.wl); // structure blocks holding water
    const refs = w.structRefs || (w.structRefs = new Map());
    for (const [name, box, f] of m.sx.refs) refs.set(name + ':' + box[0] + ',' + box[2], { name, box, f });
  }
  for (let i = 0; i < 256; i++) ch.biome[i] = VB_BASE + m.sb[i];
  ch.stage = 1;
  w.proto.set(k, ch);
};
// stage 2: vanilla features (placed in worldfeatures.js); writes may reach the 8 neighbours
Game.prototype.decorateChunk = function (ch) {
  // strongholds (needed to reach the End) still come from the original structure builder
  const w = this.world;
  if (w.structures !== false) for (const sb of w.structuresFor(ch.cx, ch.cz)) sb.apply(ch);
  if (typeof Features !== 'undefined') Features.decorate(this, w, ch);
};
Game.prototype.finaliseChunk = function (ch) {
  const w = this.world, k = ckey(ch.cx, ch.cz);
  w.proto.delete(k);
  ch.final = true; // decoration of a (re)generated neighbour must not write into it any more
  const saved = w.savedChunks && w.savedChunks.get(k);
  if (saved) decodeChunk(saved, ch);
  if (ch.sx) { this.structureExtras(ch, !!saved); }
  this.chunkTints(ch);
  ch.recount();
  this.finishChunk(ch, !!saved);
};
// grass / foliage colours per column, blended over a 5x5 area like the default biome blend
Game.prototype.chunkTints = function (ch) {
  const w = this.world, x0 = ch.cx * 16, z0 = ch.cz * 16;
  const nb = ch.nb; // from the chunk worker: biomes of the 3x3 chunks
  const biomeAt = nb ? (x, z) => nb[((((z >> 4) - ch.cz + 1) * 3 + (x >> 4) - ch.cx + 1) << 8) | ((z & 15) << 4) | (x & 15)] : (x, z) => {
    const c = (x >> 4) === ch.cx && (z >> 4) === ch.cz ? ch : (w.chunks.get(ckey(x >> 4, z >> 4)) || (w.proto && w.proto.get(ckey(x >> 4, z >> 4))));
    return c ? c.biome[((z & 15) << 4) | (x & 15)] : ch.biome[((z & 15) << 4) | (x & 15)];
  };
  const swamp = (x, z) => (WG.infoNoise().get(x * 0.0225, z * 0.0225) < -0.1 ? [76, 118, 60] : [106, 112, 57]);
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = x0 + lx + dx, z = z0 + lz + dz, v = VBIOME[biomeAt(x, z)];
      if (!v) continue;
      const g = v.swamp ? swamp(x, z) : v.grass;
      gr += g[0]; gg += g[1]; gb += g[2]; fr += v.foliage[0]; fg += v.foliage[1]; fb += v.foliage[2];
    }
    const o = (lz * 16 + lx) * 3;
    ch.grass[o] = gr / 25; ch.grass[o + 1] = gg / 25; ch.grass[o + 2] = gb / 25;
    ch.foliage[o] = fr / 25; ch.foliage[o + 1] = fg / 25; ch.foliage[o + 2] = fb / 25;
  }
};
// biome of a column in a gen-2 world, and vanilla precipitation rules
Game.prototype.vbiomeAt = function (x, z) {
  const ch = this.world.getChunk(x >> 4, z >> 4);
  return ch ? VBIOME[ch.biome[((z & 15) << 4) | (x & 15)]] : null;
};
Game.prototype.snowsAt = function (x, y, z) {
  const v = this.vbiomeAt(x, z);
  return !!v && v.precip && WG.coldEnoughToSnow(v.def, x, y + MIN_Y, z, 63);
};

// all log / leaf ids (vanilla tags) for leaf decay
const LOG_IDS = new Set(), LEAF_IDS = new Set();
for (const k of (self.BLOCK_TAGS && self.BLOCK_TAGS.logs) || []) if (BID[k] !== undefined) LOG_IDS.add(BID[k]);
for (const k of (self.BLOCK_TAGS && self.BLOCK_TAGS.leaves) || []) if (BID[k] !== undefined) LEAF_IDS.add(BID[k]);

// a live-world view with the Region API, so vanilla features can run on finished chunks (sapling growth)
class LiveRegion {
  constructor(world) { this.w = world; this.minY = world.minY || 0; this.maxY = this.minY + HEIGHT; }
  id(x, y, z) { return this.w.getBlock(x, y - this.minY, z); }
  meta(x, y, z) { return this.w.getMeta(x, y - this.minY, z); }
  canWrite(x, y, z) { return y >= this.minY && y < this.maxY && this.w.isLoaded(x, z); }
  set(x, y, z, id, meta = 0) { if (!this.canWrite(x, y, z)) return false; this.w.setBlock(x, y - this.minY, z, id, meta); return true; }
  setState(x, y, z, s) { return s ? this.set(x, y, z, s[0], s[1]) : false; }
  isAir(x, y, z) { return this.id(x, y, z) === 0; }
  chunk(x, z) { return this.w.getChunk(x >> 4, z >> 4); }
  height(type, x, z) { for (let y = this.maxY - 1; y >= this.minY; y--) { const id = this.id(x, y, z); if (id && (type.startsWith('WORLD_SURFACE') || (BLOCKS[id].solid || IS_FLUID[id]))) return y + 1; } return this.minY; }
}
// SaplingBlock.advanceTree with the vanilla tree growers (2x2 variants where they exist)
const TREE_GROWERS = {
  oak_sapling: { one: [['oak', 0.9], ['fancy_oak', 0.1]] }, birch_sapling: { one: [['birch', 1]] },
  spruce_sapling: { one: [['spruce', 1]], mega: [['mega_spruce', 0.5], ['mega_pine', 0.5]] },
  jungle_sapling: { one: [['jungle_tree_no_vine', 1]], mega: [['mega_jungle_tree', 1]] },
  acacia_sapling: { one: [['acacia', 1]] }, cherry_sapling: { one: [['cherry', 1]] },
  dark_oak_sapling: { mega: [['dark_oak', 1]] }, pale_oak_sapling: { mega: [['pale_oak_bonemeal', 1]] },
  mangrove_propagule: { one: [['mangrove', 0.85], ['tall_mangrove', 0.15]] },
};
Game.prototype.growTreeV = function (x, y, z, id) {
  const b = BLOCKS[id], G = TREE_GROWERS[b.key], w = this.world;
  if (!G || typeof Features === 'undefined') return false;
  const R = new LiveRegion(w), r = new Features.WRand();
  r.setSeed(BigInt(Math.floor(Math.random() * 2 ** 52)));
  const pick = (list) => { let t = Math.random(); for (const [n, p] of list) { if ((t -= p) < 0) return n; } return list[0][0]; };
  const vy = y + R.minY;
  const ctx = { R, top: null, seed: w.seedStr || '0', biomeAt: () => 'plains', biomeHas: () => true };
  if (G.mega) for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const ax = x + ox, az = z + oz;
    if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, c]) => w.getBlock(ax + a, y, az + c) === id)) {
      for (const [a, c] of [[0, 0], [1, 0], [0, 1], [1, 1]]) w.setBlock(ax + a, y, az + c, 0, 0);
      if (Features.placeCF(ctx, pick(G.mega), r, [ax, vy, az])) return true;
      for (const [a, c] of [[0, 0], [1, 0], [0, 1], [1, 1]]) w.setBlock(ax + a, y, az + c, id, 0);
      return false;
    }
  }
  if (!G.one) return false;
  w.setBlock(x, y, z, 0, 0);
  if (Features.placeCF(ctx, pick(G.one), r, [x, vy, z])) return true;
  w.setBlock(x, y, z, id, 0);
  return false;
};
