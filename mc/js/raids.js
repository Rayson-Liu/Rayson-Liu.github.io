'use strict';
// ---------------------------------------------------------------------------
// Raids (vanilla Raid / Raids / BadOmenMobEffect / RaidOmenMobEffect). A player with Bad Omen who walks into a
// village gets Raid Omen for 30 seconds instead; when it runs out a raid starts there (or one already there takes
// the omen, up to level 5). A red boss bar counts 15 seconds down, then waves of illagers come from about 64 blocks
// out, each announced by the raid horn: 3 / 5 / 7 waves on easy / normal / hard, and a bonus wave when the omen level
// is over 1. Each wave's first raider is its captain; ravagers of the later waves carry a pillager, evoker or
// vindicator. Raiders head for the village and attack villagers, golems and players. Every wave beaten -> Hero of the
// Village (omen level, 40 minutes) for each player who killed a raider; the village gone (no bed, bell or job site
// left near the raid) -> defeat. Single player only: on a server the server runs its raids.
// ---------------------------------------------------------------------------
const RAID_MAX_OMEN = 5, RAID_COOLDOWN = 300;
// Raid.RaiderType: how many of each come in waves 1-7 (index 0 unused; the bonus wave uses the index of the last)
const RAIDER_WAVES = [
  ['vindicator', [0, 0, 2, 0, 1, 4, 2, 5]],
  ['evoker', [0, 0, 0, 0, 0, 1, 1, 2]],
  ['pillager', [0, 4, 3, 3, 4, 4, 4, 2]],
  ['witch', [0, 0, 0, 0, 3, 0, 0, 1]],
  ['ravager', [0, 0, 0, 1, 0, 1, 0, 2]],
];
const RAIDER_TYPES = new Set(RAIDER_WAVES.map(r => r[0]).concat(['illusioner']));
const raidGroups = (d) => d === 1 ? 3 : d === 3 ? 7 : 5;

// ---- villages: the point-of-interest blocks (beds, bells, job sites) -------------------------------------------
let VILLAGE_POI = null;
function villagePoi() {
  if (VILLAGE_POI) return VILLAGE_POI;
  const ids = [];
  for (const b of BLOCKS) if (b && (/_bed$/.test(b.key) || b.key === 'bell' || (typeof JOB_SITES !== 'undefined' && JOB_SITES[b.key]))) ids.push(b.id);
  return (VILLAGE_POI = ids);
}
// does this 16-block section hold a village point of interest
function sectionHasPoi(w, cx, sy, cz) {
  const ch = w.getChunk(cx, cz), b = ch && ch.bs && ch.bs[sy], ids = villagePoi();
  if (!b) return false;
  if (b.n >= 0) { let any = false; for (let k = 0; k < b.n; k++) if (ids.includes(b.p[k])) { any = true; break; } if (!any) return false; }
  for (let j = 0; j < 4096; j++) if (ids.includes(b.p[b.d[j]])) return true;
  return false;
}
// vanilla ServerLevel.isVillage: a point of interest in this section or one next to it
function isVillage(g, x, y, z) {
  const w = g.world, cx = x >> 4, sy = y >> 4, cz = z >> 4;
  for (let dy = -1; dy <= 1; dy++) {
    if (sy + dy < 0 || sy + dy >= SECTIONS) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (sectionHasPoi(w, cx + dx, sy + dy, cz + dz)) return true;
  }
  return false;
}
// the village points of interest within r blocks
function poiNear(g, x, y, z, r) {
  const w = g.world, ids = villagePoi(), out = [];
  for (let cx = (x - r) >> 4; cx <= (x + r) >> 4; cx++) for (let cz = (z - r) >> 4; cz <= (z + r) >> 4; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    ch.findAll(ids, (i) => { const px = cx * 16 + (i & 15), py = i >> 8, pz = cz * 16 + ((i >> 4) & 15); if ((px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2 <= r * r) out.push([px, py, pz]); });
  }
  return out;
}

class Raid {
  constructor(g, center) {
    this.g = g; this.center = center; this.omen = 0; this.groups = 0; this.numGroups = raidGroups(g.difficulty);
    this.cooldown = RAID_COOLDOWN; this.status = 'ongoing'; this.ticksActive = 0; this.started = false; this.stopped = false;
    this.postTicks = 0; this.celebT = 0; this.raiders = new Set(); this.heroes = new Set(); this.totalHealth = 0;
    this.spawnPos = null; this.name = '袭击'; this.progress = 0; this.visible = true;
  }
  save() { return { c: this.center, o: this.omen, gs: this.groups, n: this.numGroups, cd: this.cooldown, s: this.status, ta: this.ticksActive, st: this.started, pt: this.postTicks, ct: this.celebT, th: this.totalHealth }; }
  static load(g, d) {
    const r = new Raid(g, d.c);
    Object.assign(r, { omen: d.o, groups: d.gs, numGroups: d.n, cooldown: d.cd, status: d.s, ticksActive: d.ta, started: d.st, postTicks: d.pt, celebT: d.ct, totalHealth: d.th });
    r.adopt = true;
    return r;
  }
  get over() { return this.status === 'victory' || this.status === 'loss'; }
  alive() { let n = 0; for (const e of this.raiders) if (!e.dead && !e.deathTime) n++; return n; }
  health() { let h = 0; for (const e of this.raiders) if (!e.dead && !e.deathTime) h += e.health; return h; }
  hasBonus() { return this.omen > 1; }
  hasMoreWaves() { return this.hasBonus() ? this.groups <= this.numGroups : this.groups !== this.numGroups; }
  shouldSpawnBonus() { return this.groups === this.numGroups && this.alive() === 0 && this.hasBonus(); }
  shouldSpawnGroup() { return this.cooldown === 0 && (this.groups < this.numGroups || this.shouldSpawnBonus()) && this.alive() === 0; }
  stop() { this.stopped = true; for (const e of this.raiders) e.raid = null; this.raiders.clear(); }
  absorbOmen(p) {
    const amp = p.effectAmp('raid_omen'); if (amp < 0) return false;
    this.omen = clamp(this.omen + amp + 1, 0, RAID_MAX_OMEN);
    return true;
  }
  tick() {
    const g = this.g;
    if (this.stopped) return;
    // (a saved raid: its raiders, saved as plain mobs, found again around it)
    if (this.adopt) { this.adopt = false; for (const e of g.entities) if (RAIDER_TYPES.has(e.type) && !e.dead && e.distTo && Math.hypot(e.pos[0] - this.center[0], e.pos[2] - this.center[2]) < 112) this.join(e, this.groups); }
    if (this.status === 'ongoing') {
      if (g.difficulty === 0) { this.stop(); return; }
      this.visible = g.world.isLoaded(this.center[0], this.center[2]);
      if (!this.visible) return;
      if (!isVillage(g, ...this.center)) {
        // vanilla moveRaidCenterToNearbyVillageSection: the nearest village section within two
        const [x, y, z] = this.center; let best = null, bd = Infinity;
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
          const sx = x + dx * 16, sy = y + dy * 16, sz = z + dz * 16;
          if (sy < 0 || sy >= HEIGHT || !sectionHasPoi(g.world, sx >> 4, sy >> 4, sz >> 4)) continue;
          const d = (dx * dx + dy * dy + dz * dz); if (d < bd) { bd = d; best = [sx, sy, sz]; }
        }
        if (best) this.center = best;
        else if (this.groups > 0) this.status = 'loss'; else { this.stop(); return; }
      }
      if (++this.ticksActive >= 48000) { this.stop(); return; }
      const alive = this.alive();
      if (alive === 0 && this.hasMoreWaves()) {
        if (this.cooldown > 0) {
          if (!this.spawnPos && this.cooldown % 5 === 0) this.spawnPos = this.findSpawn();
          this.cooldown--;
          this.progress = clamp((RAID_COOLDOWN - this.cooldown) / RAID_COOLDOWN, 0, 1);
        } else if (this.groups > 0) { this.cooldown = RAID_COOLDOWN; this.name = '袭击'; return; }
      }
      if (this.ticksActive % 20 === 0) {
        for (const e of [...this.raiders]) if (e.dead) this.raiders.delete(e);
        this.name = alive > 0 && alive <= 2 ? `袭击 - 剩余${alive}名袭击者` : '袭击';
      }
      if (alive > 0 && this.totalHealth > 0) this.progress = clamp(this.health() / this.totalHealth, 0, 1);
      let horn = false;
      for (let i = 0; this.shouldSpawnGroup(); i++) {
        const pos = this.spawnPos || this.findSpawn();
        if (pos) { this.started = true; this.spawnGroup(pos); if (!horn) { this.horn(pos); horn = true; } }
        else i++;
        if (i > 5) { this.stop(); return; }
      }
      if (this.started && !this.hasMoreWaves() && this.alive() === 0) {
        if (this.postTicks < 40) this.postTicks++;
        else {
          this.status = 'victory';
          for (const h of this.heroes) if (!h.dead && h.deathTime === 0 && !h.spectator) h.addEffect('hero_of_the_village', this.omen - 1, 48000);
        }
      }
      this.raidersTick();
    } else if (this.over) {
      if (++this.celebT >= 600) { this.stop(); return; }
      if (this.celebT % 20 === 0) {
        if (this.status === 'victory') { this.progress = 0; this.name = '袭击 - 胜利'; } else this.name = '袭击 - 失败';
      }
      this.raidersTick();
    }
  }
  // vanilla findRandomSpawnPos: around the village 64 blocks out (32 and then right at the village if that fails),
  // on top of the ground in a loaded spot outside the village (except the last try)
  findSpawn() {
    const g = this.g, w = g.world, [cx, cy, cz] = this.center;
    for (let m = 0; m < 3; m++) {
      const f = m === 0 ? 2 : 2 - m;
      for (let t = 0; t < 20; t++) {
        const a = Math.random() * Math.PI * 2;
        const x = cx + Math.floor(Math.cos(a) * 32 * f) + randInt(0, 4), z = cz + Math.floor(Math.sin(a) * 32 * f) + randInt(0, 4);
        if (!w.isLoaded(x, z) || !w.isLoaded(x + 10, z + 10) || !w.isLoaded(x - 10, z - 10)) continue;
        let y = HEIGHT - 1; while (y > 0 && !w.getBlock(x, y, z)) y--;
        const top = BLOCKS[w.getBlock(x, y, z)];
        if (!top || !top.solid || Math.abs(y + 1 - cy) > 96) continue;
        if (BLOCKS[w.getBlock(x, y + 1, z)].solid || BLOCKS[w.getBlock(x, y + 2, z)].solid) continue;
        if (!isVillage(g, x, y + 1, z) || m >= 2) return [x, y + 1, z];
      }
    }
    return null;
  }
  // vanilla getPotentialBonusSpawns
  bonusSpawns(type, wave, bonus) {
    const d = this.g.difficulty, easy = d === 1, normal = d === 2;
    let i;
    if (type === 'witch') { if (easy || wave <= 2 || wave === 4) return 0; i = 1; }
    else if (type === 'vindicator' || type === 'pillager') i = easy ? randInt(0, 1) : normal ? 1 : 2;
    else if (type === 'ravager') i = !easy && bonus ? 1 : 0;
    else return 0;
    return i > 0 ? randInt(0, i) : 0;
  }
  spawnGroup(pos) {
    const g = this.g, wave = this.groups + 1, bonus = this.shouldSpawnBonus();
    let leader = false; this.totalHealth = 0;
    const make = (type) => {
      const e = createMob(g, type, pos[0] + 0.5, pos[1], pos[2] + 0.5); if (!e) return null;
      g.entities.push(e); this.join(e, wave); return e;
    };
    for (const [type, counts] of RAIDER_WAVES) {
      const n = counts[bonus ? this.numGroups : wave] + this.bonusSpawns(type, wave, bonus);
      let k = 0;
      for (let l = 0; l < n; l++) {
        const e = make(type); if (!e) continue;
        if (!leader && type !== 'witch' && type !== 'ravager') { e.raidLeader = true; leader = true; }
        if (type === 'ravager') {
          // (the waves when ravagers carry a raider)
          const rider = wave === raidGroups(2) ? 'pillager' : wave >= raidGroups(3) ? (k === 0 ? 'evoker' : 'vindicator') : null;
          k++;
          if (rider) { const r = make(rider); if (r) { r.raidMount = e; e.raidRider = r; } }
        }
      }
    }
    this.spawnPos = null; this.groups++;
  }
  join(e, wave) {
    e.raid = this; e.raidWave = wave; e.persistent = true; this.raiders.add(e);
    this.totalHealth += e.maxHealth || e.health || 0;
  }
  // the raid horn, heard by every player near the raid from the direction of the wave (vanilla playSound)
  horn(pos) {
    const p = this.g.player, dx = pos[0] - p.pos[0], dz = pos[2] - p.pos[2], d = Math.hypot(dx, dz);
    if (Math.hypot(p.pos[0] - this.center[0], p.pos[2] - this.center[2]) > 96 && d > 64) return;
    const k = d > 13 ? 13 / d : 1;
    Sound.ev('event.raid.horn', [p.pos[0] + dx * k, p.pos[1] + 1.6, p.pos[2] + dz * k], 64, 1);
  }
  // ravagers' passengers ride along
  raidersTick() {
    for (const e of this.raiders) {
      const m = e.raidMount; if (!m) continue;
      if (m.dead || m.deathTime || e.dead) { e.raidMount = null; e.riding = false; continue; }
      e.riding = true; e.pos = [m.pos[0], m.pos[1] + m.h - 0.6 + 0.0625, m.pos[2]]; e.prev = [...e.pos]; e.vel = [0, 0, 0]; e.fallDist = 0;
      if (!e.target) { e.yaw = m.yaw; e.bodyYaw = m.bodyYaw; }
    }
  }
}

// ---- the game's raids -----------------------------------------------------------------------------------------------
// the raid around a point (vanilla getRaidAt: the nearest within 96 blocks)
Game.prototype.raidAt = function (x, y, z) {
  let best = null, bd = 96 * 96;
  for (const r of this.raids || []) {
    if (r.stopped) continue;
    const d = (r.center[0] - x) ** 2 + (r.center[1] - y) ** 2 + (r.center[2] - z) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
};
// vanilla Raids.createOrExtendRaid: centred on the village's points of interest within 64 blocks
Game.prototype.createOrExtendRaid = function (p, pos) {
  if (p.spectator || this.dim !== 'overworld' || this.net || !this.rule('raids')) return null;
  const poi = poiNear(this, pos[0], pos[1], pos[2], 64);
  const center = poi.length ? [0, 1, 2].map(i => Math.floor(poi.reduce((s, q) => s + q[i], 0) / poi.length)) : [...pos];
  let raid = this.raidAt(...center);
  if (!raid) { raid = new Raid(this, center); (this.raids || (this.raids = [])).push(raid); }
  if (!raid.started || raid.omen < RAID_MAX_OMEN) raid.absorbOmen(p);
  return raid;
};
// the boss bars of the raids the player is in (vanilla: within 96 blocks of the centre)
Game.prototype.raidBars = function () {
  const p = this.player, out = [];
  if (!p || this.dim !== 'overworld') return out;
  for (const r of this.raids || []) if (!r.stopped && r.visible && Math.hypot(p.pos[0] - r.center[0], p.pos[1] - r.center[1], p.pos[2] - r.center[2]) < 96) out.push({ name: r.name, progress: r.progress, color: 'red', notch: 10 });
  return out;
};
(() => {
  // Bad Omen in a village becomes Raid Omen; Raid Omen running out starts the raid where it was taken
  const _te = Living.prototype.tickEffects;
  Living.prototype.tickEffects = function () {
    const g = this.game;
    if (this === g.player && this.effects && this.effects.size && !g.net && g.dim === 'overworld' && !this.spectator) {
      const ro = this.effects.get('raid_omen');
      if (ro && ro.dur === 1) {
        g.createOrExtendRaid(this, this.raidOmenPos || this.pos.map(Math.floor));
        this.raidOmenPos = null; this.removeEffect('raid_omen');
      }
      const bo = this.effects.get('bad_omen');
      if (bo && g.difficulty > 0 && (g.tickCount + 7) % 10 === 0) {
        const bp = this.pos.map(Math.floor);
        if (isVillage(g, ...bp)) {
          const raid = g.raidAt(...bp);
          if (!raid || raid.omen < RAID_MAX_OMEN) {
            this.removeEffect('bad_omen'); this.addEffect('raid_omen', bo.amp, 600); this.raidOmenPos = bp;
            Sound.ev('event.mob_effect.raid_omen', this.pos, 1, 1);
          }
        }
      }
    }
    return _te.call(this);
  };
  // the raids go on with the world (single player, the overworld, not while paused)
  const _tick = Game.prototype.tick;
  Game.prototype.tick = function () {
    const r = _tick.call(this);
    if (this.raids && this.raids.length && !this.net && this.state === 'play' && !(this.ui.screen && this.ui.screen.pauses) && this.dim === 'overworld') {
      for (const raid of this.raids) this.guard('raid', () => raid.tick());
      this.raids = this.raids.filter(r => !r.stopped);
    }
    return r;
  };
  // whoever kills a raider is a hero of the village if the raid is won
  // (Living.die: both kinds of mob come through it)
  const _die = Living.prototype.die;
  Living.prototype.die = function (src) {
    const g = this.game;
    if (this.raid && src && (src.attacker === g.player || src.player)) this.raid.heroes.add(g.player);
    return _die.call(this, src);
  };
  // raiders not fighting head for the village (vanilla PathfindToRaidGoal: 15 blocks at a time)
  VMob.prototype.raidGoal = function (c) {
    const r = this.raid; if (!r || r.stopped || r.over || this.raidMount) return false;
    const dx = r.center[0] + 0.5 - this.pos[0], dz = r.center[2] + 0.5 - this.pos[2], d = Math.hypot(dx, dz);
    if (d < 12) return false;
    const k = Math.min(1, 15 / d);
    c.goal = [this.pos[0] + dx * k, r.center[1], this.pos[2] + dz * k]; c.mod = 1;
    return true;
  };
  // saved with the world
  const _save = Game.prototype.saveWorld;
  Game.prototype.saveWorld = function (quiet) {
    if (this.worldMeta && this.state === 'play') this.worldMeta.raids = (this.raids || []).filter(r => !r.stopped).map(r => r.save());
    return _save.call(this, quiet);
  };
  const _load = Game.prototype.loadWorld;
  Game.prototype.loadWorld = async function (id) {
    this.raids = [];
    const r = await _load.call(this, id);
    const m = this.worldMeta;
    this.raids = m && Array.isArray(m.raids) ? m.raids.map(d => Raid.load(this, d)) : [];
    return r;
  };
})();

// ---- patrols (vanilla PatrolSpawner): from the fifth day on, by day, about every 10-11 minutes a one-in-five chance
// of a pillager patrol 24-48 blocks from the player (not in a village): a captain and as many again as the
// difficulty (easy 1, normal 2, hard 3 more). A captain (patrol or raid wave leader) drops an ominous bottle, Bad
// Omen I-V (its loot table, vmobs.js) - how a player comes to start a raid
Game.prototype.patrolTick = function () {
  if (this.net || this.dim !== 'overworld' || this.difficulty === 0 || !this.rule('spawn_patrols')) return;
  if (this.patrolNext === undefined) this.patrolNext = 12000;
  if (--this.patrolNext > 0) return;
  this.patrolNext += 12000 + randInt(0, 1199);
  const day = Math.floor(this.worldTime / 24000), tod = ((this.worldTime % 24000) + 24000) % 24000;
  if (day < 5 || tod >= 12000 || randInt(0, 4) !== 0) return;
  const p = this.player, w = this.world;
  if (p.spectator || p.deathTime > 0) return;
  const pp = p.pos.map(Math.floor);
  // (vanilla isCloseToVillage(pos, 2): no patrols starting inside a village)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (isVillage(this, pp[0] + dx * 16, pp[1], pp[2] + dz * 16)) return;
  let x = pp[0] + (24 + randInt(0, 23)) * (Math.random() < 0.5 ? -1 : 1), z = pp[2] + (24 + randInt(0, 23)) * (Math.random() < 0.5 ? -1 : 1);
  if (!w.isLoaded(x - 10, z - 10) || !w.isLoaded(x + 10, z + 10)) return;
  const n = Math.ceil([0, 0.75, 1.5, 2.25][this.difficulty]) + 1;
  for (let i = 0; i < n; i++) {
    let y = HEIGHT - 1; while (y > 0 && (!w.getBlock(x, y, z) || /leaves$/.test(BLOCKS[w.getBlock(x, y, z)].key))) y--;
    const below = BLOCKS[w.getBlock(x, y, z)];
    if (below && below.solid && !BLOCKS[w.getBlock(x, y + 1, z)].solid && !BLOCKS[w.getBlock(x, y + 2, z)].solid && (w.getLight(x, y + 1, z) & 15) <= 8) {
      const e = createMob(this, 'pillager', x + 0.5, y + 1, z + 0.5);
      if (e) { if (i === 0) e.patrolLeader = true; this.entities.push(e); }
    } else if (i === 0) return;
    x += randInt(0, 4) - randInt(0, 4); z += randInt(0, 4) - randInt(0, 4);
  }
};
(() => {
  const _tick = Game.prototype.tick;
  Game.prototype.tick = function () {
    const r = _tick.call(this);
    if (!this.net && this.state === 'play' && !(this.ui.screen && this.ui.screen.pauses)) this.guard('patrols', () => this.patrolTick());
    return r;
  };
  // the captain stays a captain in a saved world
  const _sv = VMob.prototype.saveData, _ld = VMob.prototype.loadData;
  if (_sv && _ld) {
    VMob.prototype.saveData = function () { const d = _sv.call(this); if (this.patrolLeader && d) d.pl = 1; return d; };
    VMob.prototype.loadData = function (d) { _ld.call(this, d); if (d && d.pl) this.patrolLeader = true; };
  }
})();
