'use strict';
// ---------------------------------------------------------------------------
// Dimensions (Overworld / Nether / End), portals, fire, spawners, the dragon
// fight and the ending.
// ---------------------------------------------------------------------------
const DIM_CN = { overworld: '主世界', nether: '下界', end: '末地' };
Object.assign(ADVANCEMENTS, {
  nether: ['我们需要更深入', 'obsidian'], fortress: ['阴森的要塞', 'nether_bricks'], blaze_rod: ['与火共舞', 'blaze_rod'],
  return_sender: ['见鬼去吧', 'fire_charge'], eye_spy: ['隔墙有眼', 'ender_eye'], the_end: ['结束了？', 'end_stone'],
  free_end: ['解放末地', 'dragon_egg'], next_gen: ['下一世代', 'dragon_egg'],
});

Game.prototype.makeWorld = function (dim) {
  const w = new World(seed32(this.worldMeta ? this.worldMeta.seed : this.world.seed), dim);
  // gen-2 worlds: overworld and Nether come from the vanilla generator (the End keeps its own)
  if ((dim === 'overworld' || dim === 'nether') && this.worldMeta && this.worldMeta.gen === 2) { w.gen2 = true; w.minY = dim === 'overworld' ? MIN_Y : 0; w.seedStr = String(this.worldMeta.seed); }
  w.grassMap = this.renderer.grassMap; w.foliageMap = this.renderer.foliageMap;
  w.listener = this;
  w.flat = dim === 'overworld' && !!(this.worldMeta && this.worldMeta.flat);
  w.structures = !this.worldMeta || this.worldMeta.structures !== false;
  return w;
};
Game.prototype.dimStoreId = function (dim) { return dim === 'overworld' ? this.worldMeta.id : this.worldMeta.id + '~' + dim; };

// Called from loadWorld: prepare the starting dimension
Game.prototype.initDims = async function (meta) {
  this.dimData = {};
  this.dim = meta.dim || 'overworld';
  meta.dims = meta.dims || {};
  if (!meta.dims.overworld) meta.dims.overworld = { blockEntities: meta.blockEntities || {}, mobs: meta.mobs || [] };
  meta.portals = meta.portals || { overworld: [], nether: [] };
  meta.end = meta.end || { dragonKilled: false, dragonSpawned: false, credits: false };
  const d = await this.loadDimData(this.dim);
  this.applyDim(d);
};
Game.prototype.loadDimData = async function (dim) {
  if (this.dimData[dim]) return this.dimData[dim];
  const w = this.makeWorld(dim);
  // which chunks have saved data; each record is read when its chunk loads (savedReady)
  w.savedStore = this.dimStoreId(dim);
  w.savedIndex = await DB.chunkKeys(w.savedStore);
  w.savedChunks = new Map();
  const md = this.worldMeta.dims[dim] || { blockEntities: {}, mobs: [] };
  const d = { dim, world: w, entities: [], blockEntities: new Map(Object.entries(md.blockEntities || {})), pendingMobs: (md.mobs || []).slice(), dirtySaved: new Set() };
  this.dimData[dim] = d;
  return d;
};
Game.prototype.applyDim = function (d) {
  this.dim = d.dim; this.world = d.world; this.entities = d.entities; this.blockEntities = d.blockEntities;
  this.pendingMobs = d.pendingMobs; this.dirtySaved = d.dirtySaved;
  this.genQueue = []; this._lastCC = null; this.particles.list = [];
  for (const e of this.entities) e.world = this.world;
};
// keep the current dimension in memory but release its chunks and GPU meshes
Game.prototype.stashDim = function () {
  const w = this.world, d = this.dimData[this.dim];
  for (const ch of w.chunks.values()) {
    if (ch.modified) { const k = ckey(ch.cx, ch.cz); w.savedChunks.set(k, encodeChunk(ch)); if (w.savedIndex) w.savedIndex.add(k); d.dirtySaved.add(k); }
    this.renderer.dropChunk(ch.cx, ch.cz);
  }
  w.chunks.clear();
  this.renderer.clearSections();
  d.entities = this.entities.filter(e => !e.dead && !(e instanceof ItemEntity && e.age > 5000));
  d.pendingMobs = this.pendingMobs;
};
// Switch dimension; `place` runs once the destination chunks are loaded and must position the player
Game.prototype.changeDimension = async function (target, pos, place) {
  if (this.state !== 'play') return;
  this.state = 'switching';
  const ls = new LoadingScreen(this, target === 'nether' ? '正在进入下界…' : target === 'end' ? '正在进入末地…' : '正在返回主世界…');
  ls.keepPointer = true;
  this.ui.open(ls);
  this.stashDim();
  const d = await this.loadDimData(target);
  this.applyDim(d);
  const p = this.player;
  p.world = this.world;
  p.pos = [...pos]; p.prev = [...pos]; p.vel = [0, 0, 0]; p.fallDist = 0; p.fire = 0;
  this.sleeping = null; this.breaking = null;
  this.onDimReady = place || null;
  this.state = 'loading';
  Sound.ev('block.portal.travel', null, 0.25, 0.8 + Math.random() * 0.4);
};

// ---- saving all dimensions --------------------------------------------------------------------
Game.prototype.collectDimSave = function () {
  const m = this.worldMeta, out = [];
  // current dimension: refresh in-memory data
  const cur = this.dimData[this.dim];
  cur.entities = this.entities; cur.pendingMobs = this.pendingMobs;
  for (const [dim, d] of Object.entries(this.dimData)) {
    const w = d.world, list = [];
    if (dim === this.dim) for (const ch of w.chunks.values()) if (ch.modified) { const rec = encodeChunk(ch), k = ckey(ch.cx, ch.cz); w.savedChunks.set(k, rec); if (w.savedIndex) w.savedIndex.add(k); list.push([ch.cx, ch.cz, rec]); ch.modified = false; }
    for (const k of d.dirtySaved) { const rec = w.savedChunks.get(k); if (rec) list.push([Math.floor(k / 65536) - 32768, (k % 65536) - 32768, rec]); }
    d.dirtySaved.clear();
    const ents = (dim === this.dim ? this.entities : d.entities);
    m.dims[dim] = {
      blockEntities: Object.fromEntries(d.blockEntities),
      mobs: ents.filter(e => !e.dead && this.isSavedEntity(e)).map(e => this.mobRecord(e)).concat(d.pendingMobs || []),
    };
    out.push([this.dimStoreId(dim), list]);
  }
  m.dim = this.dim;
  delete m.blockEntities; delete m.mobs;
  return out;
};

// the entities a save keeps, and the record each is saved as (restoreMob reads it back)
Game.prototype.isSavedEntity = function (e) { return (e instanceof Mob && e.persistent) || e instanceof EnderDragon || e instanceof EndCrystal || e.isVehicle || e.keepSaved; };
Game.prototype.mobRecord = function (e) {
  return { type: e.type, pos: [...e.pos], yaw: e.yaw, health: e.health, sheared: e.sheared, wool: e.woolColor, baby: e.baby ? e.growT : 0, size: typeof e.size === 'number' ? e.size : undefined, x: e.saveData ? e.saveData() : undefined, ride: e.vehicleRef && !e.remote ? 1 : undefined };
};
// Chunks that unload take their entities with them, like vanilla's: the saved kinds go back to the pending
// list (restored when the chunk loads again, and saved from there), mobs that may despawn are dropped (they
// would despawn that far away anyway), and the rest - dropped items, orbs, arrows - wait in the world's
// parked list until their chunk comes back (they are not saved, as before). Until now they all stayed in the
// entity list without ticking, so they never despawned and wandering far piled them up for good.
Game.prototype.parkEntities = function (gone) {
  const p = this.player, w = this.world, keep = [];
  for (const e of this.entities) {
    const k = ckey(Math.floor(e.pos[0]) >> 4, Math.floor(e.pos[2]) >> 4);
    if (e.dead || e === p || e.alwaysTick || e.remote || !gone.has(k) || p.vehicle === e || e.leashHolder === p) { keep.push(e); continue; }
    if (this.isSavedEntity(e)) this.pendingMobs.push(this.mobRecord(e));
    else if (!(e instanceof Mob)) {
      const parked = w.parked || (w.parked = new Map());
      if (!parked.has(k)) parked.set(k, []);
      parked.get(k).push(e);
    }
  }
  this.entities = keep;
};

Game.prototype.restoreMob = function (m) {
  const e = createMob(this, m.type, m.pos[0], m.pos[1], m.pos[2]);
  e.yaw = m.yaw || 0;
  if (m.health != null && e.health != null) e.health = m.health;
  if (e instanceof Mob) {
    e.sheared = m.sheared; e.woolColor = m.wool || 0;
    if (m.baby) { e.makeBaby(); e.growT = m.baby; }
    if (m.size && e.setSize) { e.setSize(m.size); e.health = m.health; }
    if (m.x && e.loadData) e.loadData(m.x);
    if (m.ride) e.wantsRide = true; // (seatPassengers puts it back in its boat / minecart)
    e.persistent = true;
  } else if (m.x && e.loadData) e.loadData(m.x); // boats, minecarts
  return e;
};

// ---- environment per dimension ----------------------------------------------------------------
Game.prototype.dimEnv = function (env) {
  if (this.dim === 'nether') {
    // vanilla nether wastes fog #330808; the nether is "foggy": 5% .. 50% of the view distance.
    // Gen-2 Nethers take the fog colour of the surrounding biomes (blended over nearby quarts like vanilla)
    let fog = [51 / 255, 8 / 255, 8 / 255];
    const R = this.renderer.renderDist * 16, p = this.player;
    if (this.world.gen2 && p) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) {
        const v = this.vbiomeAt(Math.floor(p.pos[0]) + dx, Math.floor(p.pos[2]) + dz);
        if (v && v.fog) { r += v.fog[0]; g += v.fog[1]; b += v.fog[2]; n++; }
      }
      if (n) {
        const t = [r / n / 255, g / n / 255, b / n / 255], f = this._netherFog || t;
        this._netherFog = f.map((v, i) => v + (t[i] - v) * 0.05);
        fog = this._netherFog;
      }
    }
    return Object.assign(env, { day: 0, fogColor: fog, skyColor: fog, starBright: 0, sunAlpha: 0, rain: 0, fogNear: R * 0.05, fogFar: Math.min(R, 192) * 0.5, ambient: [0.55, 0.42, 0.38], nightTint: [1, 1, 1], cloudColor: [0, 0, 0], sky: 'none' });
  }
  if (this.dim === 'end') {
    // vanilla end fog: #A080A0 x 0.15, normal terrain fog band
    const fog = [160 / 255 * 0.15, 128 / 255 * 0.15, 160 / 255 * 0.15], R = this.renderer.renderDist * 16;
    return Object.assign(env, { day: 0, fogColor: fog, skyColor: fog, starBright: 0, sunAlpha: 0, rain: 0, fogNear: R - clamp(R / 10, 4, 64), fogFar: R, ambient: [0.36, 0.33, 0.4], nightTint: [1, 1, 1], cloudColor: [0, 0, 0], sky: 'end' });
  }
  env.ambient = [0.03 + 0.11 * this.renderer.gamma, 0.03 + 0.11 * this.renderer.gamma, 0.03 + 0.11 * this.renderer.gamma];
  env.sky = 'overworld';
  return env;
};

// ---- portals -----------------------------------------------------------------------------------
// Try to light a nether portal whose interior contains (x,y,z). Returns true on success.
Game.prototype.tryLightPortal = function (x, y, z) {
  const w = this.world;
  if (this.dim === 'end') return false;
  const isFrame = (id) => id === 28;
  const inner = (id) => id === 0 || id === 171;
  for (const axis of [0, 1]) {
    const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
    if (!inner(w.getBlock(x, y, z))) return false;
    let by = y; while (by > y - 22 && inner(w.getBlock(x, by - 1, z))) by--;
    if (!isFrame(w.getBlock(x, by - 1, z))) continue;
    let left = 0; while (left < 22 && inner(w.getBlock(x - dx * (left + 1), by, z - dz * (left + 1)))) left++;
    if (!isFrame(w.getBlock(x - dx * (left + 1), by, z - dz * (left + 1)))) continue;
    const x0 = x - dx * left, z0 = z - dz * left;
    let width = 0; while (width < 22 && inner(w.getBlock(x0 + dx * width, by, z0 + dz * width))) width++;
    if (width < 2 || width > 21 || !isFrame(w.getBlock(x0 + dx * width, by, z0 + dz * width))) continue;
    let height = 0; while (height < 22 && inner(w.getBlock(x0, by + height, z0))) height++;
    if (height < 3 || height > 21) continue;
    let ok = true;
    for (let i = 0; i < width && ok; i++) {
      if (!isFrame(w.getBlock(x0 + dx * i, by - 1, z0 + dz * i)) || !isFrame(w.getBlock(x0 + dx * i, by + height, z0 + dz * i))) ok = false;
      for (let j = 0; j < height && ok; j++) if (!inner(w.getBlock(x0 + dx * i, by + j, z0 + dz * i))) ok = false;
    }
    for (let j = 0; j < height && ok; j++) if (!isFrame(w.getBlock(x0 - dx, by + j, z0 - dz)) || !isFrame(w.getBlock(x0 + dx * width, by + j, z0 + dz * width))) ok = false;
    if (!ok) continue;
    for (let i = 0; i < width; i++) for (let j = 0; j < height; j++) w.setBlock(x0 + dx * i, by + j, z0 + dz * i, 170, axis, 0);
    this.recordPortal(this.dim, [x0, by, z0, axis]);
    Sound.ev('block.portal.trigger', [x, y, z], 0.4, 1.4);
    this.flushMesh();
    return true;
  }
  return false;
};
Game.prototype.recordPortal = function (dim, p) {
  const list = this.worldMeta.portals[dim] || (this.worldMeta.portals[dim] = []);
  if (!list.some(q => Math.abs(q[0] - p[0]) < 4 && Math.abs(q[1] - p[1]) < 4 && Math.abs(q[2] - p[2]) < 4)) list.push(p);
};
Game.prototype.portalValid = function (x, y, z) {
  const w = this.world, axis = w.getMeta(x, y, z) & 1;
  const ok = (id) => id === 170 || id === 28;
  const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
  return ok(w.getBlock(x, y + 1, z)) && ok(w.getBlock(x, y - 1, z)) && ok(w.getBlock(x + dx, y, z + dz)) && ok(w.getBlock(x - dx, y, z - dz));
};
// player standing in portal blocks
Game.prototype.tickPortals = function () {
  const p = this.player, w = this.world, b = p.box();
  if (!p.portalT) p.portalT = 0;
  let inNether = false, inEnd = false;
  for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) for (let y = Math.floor(b[1]); y <= Math.floor(b[4]); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) {
    const id = w.getBlock(x, y, z);
    if (id === 170) inNether = true;
    else if (id === 175 && b[1] < y + 0.75) inEnd = true;
  }
  if (inEnd && !p.portalLock) { p.portalLock = true; this.enterEndPortal(); return; }
  if (inNether && p.deathTime === 0) {
    if (!p.portalLock) {
      if (p.portalT === 0) Sound.ev('block.portal.trigger', null, 0.25, 0.8 + Math.random() * 0.4);
      p.portalT++;
      if (p.portalT >= (p.creative ? 1 : 80)) { p.portalLock = true; p.portalT = 0; this.useNetherPortal(); }
    }
  } else {
    p.portalT = Math.max(0, (p.portalT || 0) - 4);
    if (!inEnd && !inNether) p.portalLock = false;
  }
  this.portalOverlay = Math.min(1, (p.portalT || 0) / 80);
};
Game.prototype.useNetherPortal = function () {
  const p = this.player, toNether = this.dim === 'overworld';
  const target = toNether ? 'nether' : 'overworld', scale = toNether ? 1 / 8 : 8;
  const tx = Math.floor(p.pos[0] * scale), tz = Math.floor(p.pos[2] * scale);
  const list = this.worldMeta.portals[target] || [], range = toNether ? 16 : 128;
  let best = null, bd = 1e9;
  for (const q of list) { const d = Math.hypot(q[0] - tx, q[2] - tz); if (d < range && d < bd) { bd = d; best = q; } }
  const dest = best ? [best[0] + 0.5, best[1], best[2] + 0.5] : [tx + 0.5, toNether ? 70 : 80, tz + 0.5];
  this.changeDimension(target, dest, () => {
    const w = this.world;
    if (best && w.getBlock(best[0], best[1], best[2]) === 170) this.placeAtPortal(best);
    else this.placeAtPortal(this.buildPortalNear(best ? best[0] : tx, best ? best[2] : tz));
    if (target === 'nether') this.grant('nether');
  });
};
Game.prototype.placeAtPortal = function (q) {
  const p = this.player, [x, y, z, axis] = q;
  p.pos = [x + (axis === 0 ? 1 : 0.5), y, z + (axis === 0 ? 0.5 : 1)]; p.prev = [...p.pos];
  p.yaw = axis === 0 ? 0 : Math.PI / 2; p.portalLock = true; p.portalT = 0;
};
// find a spot and build a 4x5 obsidian portal with platform; returns [x0,y,z0,axis]
Game.prototype.buildPortalNear = function (tx, tz) {
  const w = this.world, nether = this.dim === 'nether';
  const fits = (x, y, z) => {
    for (let i = -1; i <= 2; i++) for (let k = -1; k <= 1; k++) {
      if (!SOLIDCUBE[w.getBlock(x + i, y - 1, z + k)]) return false;
      for (let j = 0; j < 4; j++) { const id = w.getBlock(x + i, y + j, z + k); if (id && !REPLACEABLE[id]) return false; }
    }
    return true;
  };
  let spot = null;
  outer: for (let r = 0; r <= 12; r += 2) for (let a = 0; a < (r ? 8 : 1); a++) {
    const x = tx + Math.round(Math.cos(a / 8 * Math.PI * 2) * r), z = tz + Math.round(Math.sin(a / 8 * Math.PI * 2) * r);
    if (nether) { for (let y = 100; y > 33; y--) if (fits(x, y, z)) { spot = [x, y, z]; break outer; } }
    else { const y = w.surfaceY(x, z) + 1; if (y > SEA && y < HEIGHT - 16 && fits(x, y, z)) { spot = [x, y, z]; break outer; } }
  }
  if (!spot) {
    let y = nether ? 70 : Math.max(SEA + 2, w.surfaceY(tx, tz) + 1);
    spot = [tx, y, tz];
    for (let i = -2; i <= 3; i++) for (let k = -2; k <= 2; k++) {
      w.setBlock(tx + i, y - 1, tz + k, 28, 0, 0);
      for (let j = 0; j < 5; j++) w.setBlock(tx + i, y + j, tz + k, 0, 0, 0);
    }
  }
  const [x, y, z] = spot;
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const edge = i === -1 || i === 2 || j === -1 || j === 3;
    w.setBlock(x + i, y + j, z, edge ? 28 : 170, 0, 0);
  }
  for (let i = -1; i <= 2; i++) for (const k of [-1, 1]) { if (!SOLIDCUBE[w.getBlock(x + i, y - 1, z + k)]) w.setBlock(x + i, y - 1, z + k, 28, 0, 0); for (let j = 0; j < 3; j++) if (w.getBlock(x + i, y + j, z + k) && !REPLACEABLE[w.getBlock(x + i, y + j, z + k)]) w.setBlock(x + i, y + j, z + k, 0, 0, 0); }
  const q = [x, y, z, 0];
  this.recordPortal(this.dim, q);
  return q;
};

// ---- End portal ----------------------------------------------------------------------------------
Game.prototype.fillEndFrame = function (x, y, z) {
  const w = this.world;
  w.setMeta(x, y, z, w.getMeta(x, y, z) | 4);
  Sound.ev('block.end_portal_frame.fill', [x, y, z], 1, 1);
  for (let i = 0; i < 12; i++) this.particles.spawn('smoke', x + 0.2 + Math.random() * 0.6, y + 1, z + 0.2 + Math.random() * 0.6, 0, 0.02, 0);
  const isEye = (a, b, c) => w.getBlock(a, b, c) === 174 && (w.getMeta(a, b, c) & 4);
  for (let cx = x - 2; cx <= x + 2; cx++) for (let cz = z - 2; cz <= z + 2; cz++) {
    let ok = true;
    for (let k = -1; k <= 1 && ok; k++) ok = isEye(cx + k, y, cz - 2) && isEye(cx + k, y, cz + 2) && isEye(cx - 2, y, cz + k) && isEye(cx + 2, y, cz + k);
    if (!ok) continue;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) w.setBlock(cx + a, y, cz + b, 175, 0);
    Sound.ev('block.end_portal.spawn', null, 1, 1);
    this.ui.message('末地传送门已激活！', '#AA55FF');
    this.flushMesh();
    return;
  }
};
Game.prototype.enterEndPortal = function () {
  if (this.dim === 'end') { this.leaveEnd(); return; }
  this.changeDimension('end', [100.5, 49, 0.5], () => {
    const w = this.world;
    for (let x = 98; x <= 102; x++) for (let z = -2; z <= 2; z++) {
      w.setBlock(x, 48, z, 28, 0, 0);
      for (let y = 49; y <= 51; y++) w.setBlock(x, y, z, 0, 0, 0);
    }
    const p = this.player; p.pos = [100.5, 49, 0.5]; p.prev = [...p.pos]; p.yaw = Math.PI / 2;
    this.grant('the_end');
    this.setupDragonFight();
  });
};
Game.prototype.setupDragonFight = function () {
  const end = this.worldMeta.end, w = this.world;
  if (end.dragonKilled) return;
  if (!end.dragonSpawned) {
    end.dragonSpawned = true;
    for (const pl of w.endPillars) {
      const c = new EndCrystal(this, pl.x + 0.5, pl.h + 2, pl.z + 0.5);
      this.entities.push(c);
    }
    this.entities.push(new EnderDragon(this, 0, 110, -60));
    this.ui.message('末影龙出现了……', '#AA55FF');
  }
};
Game.prototype.dragon = function () { return this.dim === 'end' ? this.entities.find(e => e instanceof EnderDragon && !e.dead) : null; };
Game.prototype.onDragonKilled = function (dr) {
  const w = this.world, end = this.worldMeta.end, first = !end.dragonKilled;
  end.dragonKilled = true;
  const yb = w.endTop0 + 1;
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const d = Math.hypot(x, z); if (d <= 2.5 && (x || z)) w.setBlock(x, yb + 1, z, 175, 0); }
  if (first) { w.setBlock(0, yb + 5, 0, 176, 0); this.dropXp(0.5, yb + 3, 0.5, 12000); } else this.dropXp(0.5, yb + 3, 0.5, 500);
  this.grant('free_end');
  this.ui.message('末影龙被击败了！中央的返回传送门已经开启。', '#FFFF55');
  this.flushMesh();
};
Game.prototype.leaveEnd = function () {
  const end = this.worldMeta.end;
  const go = () => {
    const s = this.player.spawn;
    this.changeDimension('overworld', [s[0] + 0.5, s[1], s[2] + 0.5], () => {
      const p = this.player;
      let y = s[1];
      while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
      p.prev = [...p.pos];
    });
  };
  if (end.dragonKilled && !end.credits) { end.credits = true; this.ui.open(new CreditsScreen(this, go)); }
  else go();
};

// ---- fire --------------------------------------------------------------------------------------
const FLAMMABLE = new Set([5, 14, 15, 25, 26, 46, 47, 48, 49, 50, 51, 58, 60, 87, 104, 105, 106, 107, 115, 116, 178, 39, 40, 45, ...Array.from({ length: 16 }, (_, i) => 128 + i)]);
Game.prototype.fireSupported = function (x, y, z) {
  const w = this.world, below = w.getBlock(x, y - 1, z);
  if (SOLIDCUBE[below] || below === 119 || below === 120) return true;
  for (const D of DIRS) if (FLAMMABLE.has(w.getBlock(x + D[0], y + D[1], z + D[2]))) return true;
  return false;
};
Game.prototype.fireTick = function (x, y, z) {
  const w = this.world, below = w.getBlock(x, y - 1, z);
  const eternal = below === 119 || below === 103 || (this.dim === 'end' && below === 6);
  if (!eternal && (this.dim === 'overworld' && this.weather > 0.5 && w.skyAt(x, y, z) >= 15 || Math.random() < 0.15)) {
    let fuel = false;
    for (const D of DIRS) if (FLAMMABLE.has(w.getBlock(x + D[0], y + D[1], z + D[2]))) fuel = true;
    if (!fuel || Math.random() < 0.3) { w.setBlock(x, y, z, 0, 0); return; }
  }
  // spread: burn neighbours and ignite nearby air
  for (const D of DIRS) {
    const nx = x + D[0], ny = y + D[1], nz = z + D[2], id = w.getBlock(nx, ny, nz);
    if (FLAMMABLE.has(id) && Math.random() < 0.08) {
      if (id === 26) { w.setBlock(nx, ny, nz, 0, 0); this.addEntity(new PrimedTNT(this, nx, ny, nz, 40)); }
      else w.setBlock(nx, ny, nz, Math.random() < 0.6 ? 171 : 0, 0);
    }
  }
  for (let i = 0; i < 2; i++) {
    const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 4) | 0) - 1, nz = z + ((Math.random() * 3) | 0) - 1;
    if (w.getBlock(nx, ny, nz) === 0 && this.fireSupported(nx, ny, nz) && Math.random() < 0.3) {
      let fuel = false; for (const D of DIRS) if (FLAMMABLE.has(w.getBlock(nx + D[0], ny + D[1], nz + D[2]))) fuel = true;
      if (fuel) w.setBlock(nx, ny, nz, 171, 0);
    }
  }
};

// ---- spawners ------------------------------------------------------------------------------------
const SPAWNER_MOBS = ['zombie', 'skeleton', 'spider', 'blaze'];
Game.prototype.tickSpawners = function () {
  const p = this.player, w = this.world, px = Math.floor(p.pos[0]), py = Math.floor(p.pos[1]), pz = Math.floor(p.pos[2]);
  this.spawnerT = this.spawnerT || new Map();
  for (let cx = (px >> 4) - 1; cx <= (px >> 4) + 1; cx++) for (let cz = (pz >> 4) - 1; cz <= (pz >> 4) + 1; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    if (!ch.spawners) { ch.spawners = []; ch.findAll([127], (i) => ch.spawners.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)])); }
    for (const s of ch.spawners) {
      const [x, y, z] = s;
      if (w.getBlock(x, y, z) !== 127) continue;
      if (Math.hypot(x - px, y - py, z - pz) > 16) continue;
      if (Math.random() < 0.3) this.particles.spawn('flame', x + Math.random(), y + Math.random(), z + Math.random(), 0, 0.01, 0);
      const k = s.join(',');
      let t = this.spawnerT.get(k);
      if (t === undefined) t = 20;
      t -= 20; // called once every 20 ticks
      if (t > 0) { this.spawnerT.set(k, t); continue; }
      this.spawnerT.set(k, 200 + Math.random() * 600);
      const type = SPAWNER_MOBS[w.getMeta(x, y, z) & 3];
      const near = this.entities.filter(e => e instanceof Mob && e.type === type && e.distTo({ pos: [x, y, z] }) < 9).length;
      if (near >= 6) continue;
      for (let n = 0; n < 4; n++) {
        const sx = x + (Math.random() - 0.5) * 8, sy = y + ((Math.random() * 3) | 0) - 1, sz = z + (Math.random() - 0.5) * 8;
        const m = createMob(this, type, Math.floor(sx) + 0.5, sy, Math.floor(sz) + 0.5);
        if (m.collides(m.box()) || (!m.T.flying && !BLOCKS[w.getBlock(Math.floor(sx), sy - 1, Math.floor(sz))].solid)) continue;
        m.persistent = false;
        this.entities.push(m);
        for (let i = 0; i < 10; i++) this.particles.spawn('smoke', m.pos[0] + (Math.random() - 0.5), m.pos[1] + Math.random() * m.h, m.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
      }
    }
  }
};

// ---- per-dimension mob spawning ------------------------------------------------------------------
Game.prototype.spawnMobsDim = function () {
  const p = this.player, w = this.world;
  if (this.difficulty === 0) return;
  if (this.dim === 'nether' && w.gen2 && this.spawnNetherV) return this.spawnNetherV();
  const hostiles = this.entities.filter(e => e instanceof Mob && e.T.hostile).length;
  if (this.dim === 'end') {
    if (hostiles >= 14) return;
    const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 40;
    const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
    if (!w.isLoaded(x, z)) return;
    const y = w.surfaceY(x, z) + 1;
    if (y < 10 || w.getBlock(x, y - 1, z) !== 172) return;
    const m = new Enderman(this, x + 0.5, y, z + 0.5);
    if (!m.collides(m.box())) this.entities.push(m);
    return;
  }
  if (this.dim !== 'nether' || hostiles >= 24) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 40;
    const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
    if (!w.isLoaded(x, z)) continue;
    let y = Math.floor(p.pos[1]) + ((Math.random() * 40) | 0) - 20;
    y = clamp(y, 32, 120);
    while (y > 31 && w.getBlock(x, y, z) !== 0) y++;
    while (y > 31 && w.getBlock(x, y - 1, z) === 0) y--;
    if (y <= 31 || w.getBlock(x, y + 1, z) !== 0 || !SOLIDCUBE[w.getBlock(x, y - 1, z)]) continue;
    const r = Math.random();
    let type;
    if (w.inFortress(x, y, z) && r < 0.5) type = 'blaze';
    else if (r < 0.55) type = 'zombified_piglin';
    else if (r < 0.7) type = 'magma_cube';
    else if (r < 0.82) type = 'ghast';
    else if (r < 0.88) type = 'enderman';
    else continue;
    if (type === 'ghast') {
      let ok = true;
      for (let dy = 2; dy < 8 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx += 2) for (let dz = -2; dz <= 2 && ok; dz += 2) if (w.getBlock(x + dx, y + dy, z + dz) !== 0) ok = false;
      if (!ok || this.entities.filter(e => e instanceof Ghast).length >= 3) continue;
      this.entities.push(new Ghast(this, x + 0.5, y + 3, z + 0.5));
      continue;
    }
    const n = type === 'zombified_piglin' ? 2 + ((Math.random() * 3) | 0) : 1;
    for (let i = 0; i < n; i++) {
      const m = createMob(this, type, x + 0.5 + (i ? (Math.random() - 0.5) * 3 : 0), y, z + 0.5 + (i ? (Math.random() - 0.5) * 3 : 0));
      if (type === 'magma_cube') m.setSize([1, 2, 4][(Math.random() * 3) | 0]);
      if (!m.collides(m.box())) this.entities.push(m);
    }
  }
};

// endermen notice being stared at
Game.prototype.checkEnderStare = function () {
  const p = this.player;
  if (p.creative || p.deathTime > 0) return;
  const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]], dir = this.lookDir();
  for (const e of this.entities) {
    if (!(e instanceof Enderman) || e.angry || e.deathTime > 0) continue;
    const hx = e.pos[0] - eye[0], hy = e.pos[1] + 2.6 - eye[1], hz = e.pos[2] - eye[2], d = Math.hypot(hx, hy, hz);
    if (d > 64 || d < 0.5) continue;
    // (vanilla isLookingAtMe: 1 - 0.025 / d - it was half as wide again: angry without being looked at, feedback 2026-11-01/02)
    if ((hx * dir[0] + hy * dir[1] + hz * dir[2]) / d > 1 - 0.025 / d && e.canSee(p)) {
      if (p.inv.slots[36] && ITEMS[p.inv.slots[36].id].key === 'carved_pumpkin') continue;
      e.provoke(p);
      Sound.ev('entity.enderman.stare', e.pos, 1, 1);
      if (d > 8) teleportEntity(e, p.pos[0] + (Math.random() - 0.5) * 4, p.pos[1] + 1, p.pos[2] + (Math.random() - 0.5) * 4);
    }
  }
};

// ---- locate helpers -------------------------------------------------------------------------------
Game.prototype.nearestStronghold = function () {
  const p = this.player;
  let best = null, bd = 1e9;
  const w = this.dim === 'overworld' ? this.world : this.dimData.overworld && this.dimData.overworld.world;
  if (!w) return null;
  for (const s of w.strongholds()) { const d = Math.hypot(s.x - p.pos[0], s.z - p.pos[2]); if (d < bd) { bd = d; best = s; } }
  return best;
};

// ---- bed explosions ---------------------------------------------------------------------------------
Game.prototype.bedExplode = function (x, y, z) {
  const w = this.world, meta = w.getMeta(x, y, z);
  const R = [4, 1, 5, 0][meta & 3], D2 = DIRS[(meta & 4) ? OPP[R] : R];
  w.setBlock(x + D2[0], y, z + D2[2], 0, 0, 0);
  w.setBlock(x, y, z, 0, 0);
  this.explode(x + 0.5, y + 0.5, z + 0.5, 5, null, false, true);
};

// ---- credits ---------------------------------------------------------------------------------------
class CreditsScreen extends MenuScreen {
  constructor(game, onDone) {
    super(game, null); this.onDone = onDone; this.pauses = true; this.t = 0; this.last = performance.now(); this.bgDim = 0; this.blurBg = false;
    const lines = [];
    const T = window.MC_TEXTS || {};
    const fmt = (s) => s.replace(/PLAYERNAME/g, '玩家');
    for (let i = 0; i < 6; i++) lines.push({ t: '' });
    lines.push({ logo: true }, { t: '' }, { t: '' });
    if (T['end.txt']) {
      for (const raw of T['end.txt'].split('\n')) {
        let col = '#FFFFFF', s = fmt(raw);
        const m = s.match(/^§(.)/);
        if (m) { col = { '2': '#00AA00', '3': '#00AAAA', 'f': '#FFFFFF', '7': '#AAAAAA' }[m[1]] || '#FFFFFF'; }
        s = s.replace(/§k([^§]*)/g, (a, b) => '\u0001' + b + '\u0002').replace(/§./g, '');
        for (const w of this.wrap(s, 274)) lines.push({ t: w, col });
        lines.push({ t: '' });
      }
    }
    for (let i = 0; i < 4; i++) lines.push({ t: '' });
    try {
      const credits = JSON.parse(T['credits.json'] || '[]');
      for (const sec of credits) {
        lines.push({ t: '' }, { t: '============', col: '#FFFFFF', center: true }, { t: sec.section, col: '#FFFF55', center: true }, { t: '============', col: '#FFFFFF', center: true }, { t: '' });
        for (const d of sec.disciplines || []) {
          if (d.discipline) lines.push({ t: d.discipline, col: '#AAAAAA', center: true }, { t: '' });
          for (const ti of d.titles || []) {
            lines.push({ t: ti.title, col: '#777777', center: true });
            for (const n of ti.names || []) lines.push({ t: n, col: '#FFFFFF', center: true });
            lines.push({ t: '' });
          }
        }
      }
    } catch (e) { }
    if (T['postcredits.txt']) for (const raw of T['postcredits.txt'].split('\n')) for (const w of this.wrap(raw.replace(/§./g, ''), 274)) lines.push({ t: w, col: '#FFFFFF', center: true });
    lines.push({ t: '' }, { t: '本作品为非官方复刻 · 感谢游玩！', col: '#FFFF55', center: true });
    this.lines = lines;
  }
  wrap(s, maxW) {
    const out = []; let cur = '';
    for (const word of s.split(' ')) {
      const test = cur ? cur + ' ' + word : word;
      if (Font.width(test.replace(/[\u0001\u0002]/g, '')) > maxW && cur) { out.push(cur); cur = word; } else cur = test;
    }
    out.push(cur);
    return out;
  }
  layout() { }
  draw(ui) {
    const c = ui.ctx, now = performance.now(), dt = Math.min(100, now - this.last); this.last = now;
    const h = this.held || {}, fast = h.Space || h.ControlLeft || h.ControlRight;
    this.t += dt * (fast ? 0.12 : 0.025);
    c.fillStyle = '#000'; c.fillRect(0, 0, ui.w, ui.h);
    const x0 = Math.floor(ui.w / 2 - 137);
    let y = ui.h - this.t;
    for (const L of this.lines) {
      if (y > -20 && y < ui.h + 10) {
        if (L.logo) { c.imageSmoothingEnabled = true; c.drawImage(ui.img.logo, 0, 0, 1024, 256, ui.w / 2 - 137, y - 10, 274, 68); c.imageSmoothingEnabled = false; }
        else if (L.t) {
          let s = L.t;
          if (s.includes('\u0001')) s = s.replace(/\u0001([^\u0002]*)\u0002/g, (a, b) => b.split('').map(ch => ch === ' ' ? ' ' : String.fromCharCode(33 + ((Math.random() * 90) | 0))).join(''));
          if (L.center) Font.center(c, s, ui.w / 2, y, L.col || '#FFFFFF'); else Font.draw(c, s, x0, y, L.col || '#FFFFFF');
        }
      }
      y += L.logo ? 80 : 12;
    }
    if (y < -20) this.finish();
    Font.draw(c, '按住空格加速 · Esc 跳过', 4, ui.h - 12, '#555555');
  }
  finish() {
    if (this.done) return; this.done = true;
    removeEventListener('keyup', this.unhold); removeEventListener('blur', this.unhold);
    this.game.ui.screen = null; this.onDone();
  }
  // (the touch close button: through onEsc - ui.close() left the player in the End)
  onEsc() { this.finish(); }
  // speeding up while space or ctrl is held (vanilla WinScreen): every key stops here, so game.keys never had them -
  // the keys are kept here, let go of on keyup / leaving the window
  key(ui, ev) {
    if (ev.key === 'Escape') { this.finish(); return true; }
    if (ev.code === 'Space' || ev.code === 'ControlLeft' || ev.code === 'ControlRight') {
      if (!this.unhold) { this.unhold = (e) => { if (e.type === 'blur') this.held = {}; else if (this.held) delete this.held[e.code]; }; addEventListener('keyup', this.unhold); addEventListener('blur', this.unhold); }
      (this.held || (this.held = {}))[ev.code] = true;
    }
    return true;
  }
  mouseDown() { }
}
