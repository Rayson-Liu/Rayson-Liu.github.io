'use strict';
// ---------------------------------------------------------------------------
// Boats, rafts and chest boats, and minecarts (with a chest, furnace, TNT or hopper) in single player: placing,
// riding, steering, breaking, saving; vanilla's models (BoatModel / RaftModel / MinecartModel, turned for this
// game's y-up models) and textures. Rails join up with their neighbours when placed.
// ---------------------------------------------------------------------------
const BOAT_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo'];
const BOAT_ITEM = {}; // item key -> [wood, chest]
for (const w of BOAT_WOODS) { const raft = w === 'bamboo'; BOAT_ITEM[w + (raft ? '_raft' : '_boat')] = [w, false]; BOAT_ITEM[w + (raft ? '_chest_raft' : '_chest_boat')] = [w, true]; }
const CART_ITEM = { minecart: '', chest_minecart: 'chest', furnace_minecart: 'furnace', tnt_minecart: 'tnt', hopper_minecart: 'hopper', command_block_minecart: 'command_block' };

// vanilla model parts (y down, x mirrored by the renderer) -> this game's parts: [name, pivot, rot [x, y, z], boxes]
function vanillaPart(name, pivot, rot, boxes) {
  return { name, pivot: [-pivot[0], -pivot[1], pivot[2]], rotX: -(rot[0] || 0), rotY: -(rot[1] || 0), rotZ: rot[2] || 0,
    boxes: boxes.map(([u, v, x, y, z, w, h, d, inf, mir]) => [u, v, -(x + w), -(y + h), z, w, h, d, inf || 0, !!mir]) };
}
Renderer.prototype.initVehicleModels = function () {
  if (this.models.vh_boat) return;
  const M = this.models, P = (tw, th, parts) => { for (const p of parts) p.mesh = this.makeModelPart(p.boxes, tw, th); return { parts }; };
  const PI = Math.PI, paddle = (u, v) => [[u, v, -1, 0, -5, 2, 2, 18], [u, v, -1.001, -3, 8, 1, 6, 7]];
  const hull = [
    vanillaPart('bottom', [0, 3, 1], [PI / 2, 0, 0], [[0, 0, -14, -9, -3, 28, 16, 3]]),
    vanillaPart('back', [-15, 4, 4], [0, PI * 1.5, 0], [[0, 19, -13, -7, -1, 18, 6, 2]]),
    vanillaPart('front', [15, 4, 0], [0, PI / 2, 0], [[0, 27, -8, -7, -1, 16, 6, 2]]),
    vanillaPart('right', [0, 4, -9], [0, PI, 0], [[0, 35, -14, -7, -1, 28, 6, 2]]),
    vanillaPart('left', [0, 4, 9], [0, 0, 0], [[0, 43, -14, -7, -1, 28, 6, 2]]),
    vanillaPart('lp', [3, -5, 9], [0, 0, PI / 16], paddle(62, 0)),
    vanillaPart('rp', [3, -5, -9], [0, PI, -PI / 16], paddle(62, 20)),
  ];
  const chest = (y0) => [
    vanillaPart('chest_bottom', [-2, y0, -6], [0, -PI / 2, 0], [[0, 76, 0, 0, 0, 12, 8, 12]]),
    vanillaPart('chest_lid', [-2, y0 - 4, -6], [0, -PI / 2, 0], [[0, 59, 0, 0, 0, 12, 4, 12]]),
    vanillaPart('chest_lock', [-1, y0 - 1, -1], [0, -PI / 2, 0], [[0, 59, 0, 0, 0, 2, 4, 1]]),
  ];
  M.vh_boat = P(128, 64, hull);
  M.vh_chest_boat = P(128, 128, [...hull.map(p => ({ ...p })), ...chest(-5)]);
  const raft = [
    vanillaPart('bottom', [0, -2.1, 1], [1.5708, 0, 0], [[0, 0, -14, -11, -4, 28, 20, 4], [0, 0, -14, -9, -8, 28, 16, 4]]),
    vanillaPart('lp', [3, -4, 9], [0, 0, PI / 16], paddle(0, 24)),
    vanillaPart('rp', [3, -4, -9], [0, PI, -PI / 16], paddle(40, 24)),
  ];
  M.vh_raft = P(128, 64, raft);
  M.vh_chest_raft = P(128, 128, [...raft.map(p => ({ ...p })), ...chest(-10.1)]);
  const side = (pv, ry) => vanillaPart('s', pv, [0, ry, 0], [[0, 0, -8, -9, -1, 16, 8, 2]]);
  M.vh_minecart = P(64, 32, [vanillaPart('bottom', [0, 4, 0], [PI / 2, 0, 0], [[0, 10, -10, -8, -1, 20, 16, 2]]),
    side([-9, 4, 0], PI * 1.5), side([9, 4, 0], PI / 2), side([0, 4, -7], PI), side([0, 4, 7], 0)]);
};
// the parts' meshes are shared between the plain and chest models
Renderer.prototype.vehicleModel = function (name) { this.initVehicleModels(); return name; };

class Vehicle extends Entity {
  constructor(game, x, y, z, w, h) {
    super(game, x, y, z, w, h);
    this.isVehicle = true; this.hittable = true; this.rider = null; this.damage = 0; this.hurtT = 0; this.hurtDir = 1; this.yaw = 0;
  }
  // a hit: survival players knock it about until it breaks (and drops itself), creative ones take it at once
  hurt(a, src) {
    if (this.dead || !src || !(src.player || src.attacker === this.game.player || src.type === 'explosion' || src.type === 'arrow' || src.type === 'lava')) return false;
    const g = this.game, creative = src.player && g.mode === 'creative';
    this.hurtDir = -this.hurtDir; this.hurtT = 10; this.damage += a * 10;
    if (creative || this.damage > 40) {
      if (this.rider) this.rider.dismount();
      if (!creative) this.dropSelf();
      this.dead = true;
    }
    return true;
  }
  dropSelf() {
    const g = this.game;
    g.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], makeStack(this.itemKey));
    for (const s of this.slots || []) if (s) g.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], { ...s });
  }
  interact(p) {
    if (p.vehicle === this) return false;
    if (this.slots && p.sneaking) { this.openChest(); return true; }
    if (this.rider || p.sneaking || !this.canRide) return false;
    p.mount(this);
    return true;
  }
  // a chest minecart that only names its loot table (a mineshaft's, or one imported unopened) is filled when first
  // opened or reached by a hopper, as in vanilla
  unpackLoot() {
    if (!this.loot || !this.slots) return;
    const r = RNG(hashStr('loot' + this.game.world.seed + ':' + Math.floor(this.pos[0]) + ':' + Math.floor(this.pos[2])));
    if (typeof Loot !== 'undefined') Loot.fill(this.slots, this.loot, r);
    this.loot = null;
  }
  openChest() {
    this.unpackLoot();
    const g = this.game, be = { pos: this.pos.map(Math.floor), slots: this.slots, type: 'chest' };
    const sc = new ChestScreen(g, [be], ITEMS[ITEM_KEY[this.itemKey]].cn);
    sc.close = () => { Sound.chest(this.pos, false); };
    g.ui.open(sc); Sound.chest(this.pos, true);
  }
  saveData() { return { yaw: this.yaw, slots: this.slots, fuel: this.fuel, loot: this.loot || undefined }; }
  loadData(d) { this.yaw = d.yaw || 0; if (d.slots && this.slots) this.slots = d.slots; if (d.fuel) this.fuel = d.fuel; if (d.loot) this.loot = d.loot; }
}

// ---- boats ----
class Boat extends Vehicle {
  constructor(game, x, y, z, wood = 'oak', chest = false) {
    super(game, x, y, z, 1.375, 0.5625);
    this.wood = wood; this.chest = chest; this.raft = wood === 'bamboo';
    this.type = (chest ? 'chest_' : '') + 'boat:' + wood;
    this.itemKey = wood + (this.raft ? (chest ? '_chest_raft' : '_raft') : (chest ? '_chest_boat' : '_boat'));
    this.canRide = true; this.deltaRot = 0; this.status = 'air'; this.paddle = [0, 0];
    if (chest) this.slots = new Array(27).fill(null);
  }
  // where the water is: the surface over the boat's bottom (null: none), and whether it is under water
  waterState() {
    const b = this.box(), w = this.world;
    let top = null, under = false;
    for (let x = Math.floor(b[0]); x <= Math.floor(b[3] - 1e-3); x++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5] - 1e-3); z++) {
      for (let y = Math.floor(b[1]); y <= Math.floor(b[4]) + 1; y++) {
        const id = w.getBlock(x, y, z);
        if (id !== WATER && !WLOG[id] && !(id && w.isWaterlogged(x, y, z))) continue;
        const h = y + 1 - (id === WATER ? Math.min(7, w.getMeta(x, y, z) & 7) / 9 : 0) - 0.11;
        if (h >= b[1] - 1e-3 && (top === null || h > top)) top = h;
        if (h > b[4] + 0.001) under = true;
      }
    }
    return { top, under };
  }
  landFriction() {
    const b = this.box(), w = this.world, y = Math.floor(b[1] - 0.001);
    let f = 0, n = 0;
    for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) {
      const id = w.getBlock(x, y, z); if (!id || !BLOCKS[id].solid) continue;
      f += BLOCKS[id].slip || 0.6; n++;
    }
    return n ? f / n : 0;
  }
  // vanilla Boat.floatBoat + controlBoat
  tick() {
    this.savePrev(); this.age++;
    if (this.hurtT > 0) this.hurtT--;
    if (this.damage > 0) this.damage = Math.max(0, this.damage - 1);
    const v = this.vel, ws = this.waterState(), land = this.onGround ? this.landFriction() : 0;
    const old = this.status;
    this.status = ws.under ? 'under' : ws.top !== null ? 'water' : land ? 'land' : 'air';
    let grav = -0.04, buoy = 0, fr = 0.05;
    if (old === 'air' && this.status === 'water') { this.pos[1] = ws.top - this.h + 0.101; v[1] = 0; }
    else {
      if (this.status === 'water') { buoy = (ws.top - this.pos[1]) / this.h; fr = 0.9; }
      else if (this.status === 'under') { buoy = 0.01; fr = 0.45; }
      else if (this.status === 'air') fr = 0.9;
      else fr = land; // (vanilla: the ground's friction - with a rider it was halved and more, slow even on ice: "船在冰上滑不快")
      v[0] *= fr; v[2] *= fr; v[1] += grav; this.deltaRot *= fr;
      if (buoy > 0) v[1] = (v[1] + buoy * 0.06153846) * 0.75;
    }
    // steering by the rider (A / D turn, W / S forward and back)
    const inp = this.rider && this.rider.rideInput;
    if (inp && (this.status === 'water' || this.status === 'land' || this.status === 'under')) {
      let f = 0;
      if (inp.strafe < 0) this.deltaRot--; if (inp.strafe > 0) this.deltaRot++;
      if (inp.strafe && !inp.fwd) f += 0.005;
      if (inp.fwd > 0) f += 0.04; if (inp.fwd < 0) f -= 0.005;
      v[0] += -Math.sin(this.yaw) * f; v[2] += -Math.cos(this.yaw) * f;
      this.paddle[0] += inp.fwd || inp.strafe > 0 ? Math.PI / 8 : 0; this.paddle[1] += inp.fwd || inp.strafe < 0 ? Math.PI / 8 : 0;
    }
    this.yaw -= this.deltaRot * Math.PI / 180;
    this.move(v[0], v[1], v[2]);
    this.bubbleTick();
    if (this.rider) this.rider.followVehicle(this);
  }
  // vanilla AbstractBoat.tickBubbleColumn: on top of a bubble column for 60 ticks, then thrown up (2.7 with a player
  // in it, else 0.6) or pulled under, throwing out whoever is in it; leaving the column starts the count again
  bubbleTick() {
    const w = this.world, x = Math.floor(this.pos[0]), z = Math.floor(this.pos[2]);
    let c = 0;
    for (const y of [Math.floor(this.pos[1]), Math.floor(this.pos[1]) - 1]) {
      const k = w.bubbleColumnAt(x, y, z);
      if (k && w.getBlock(x, y + 1, z) === AIR) { c = k; break; }
    }
    if (!c) { this.bubbleT = 0; return; }
    if (!this.bubbleT) this.bubbleT = 60;
    if (--this.bubbleT > 0) return;
    if (c < 0) {
      this.vel[1] -= 0.7;
      if (this.rider) this.rider.dismount();
      if (this.mob) this.dropMob();
    } else this.vel[1] = this.rider ? 2.7 : 0.6;
  }
  seat() { return [this.pos[0], this.pos[1] - 0.45 + (this.raft ? 0.1 : 0), this.pos[2]]; }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer; r.initVehicleModels();
    const m = M4.create(); M4.translate(m, ip[0], ip[1] + 0.375, ip[2]);
    M4.rotY(m, lerp(this.prevYaw ?? this.yaw, this.yaw, a) - Math.PI / 2);
    if (this.hurtT > 0) M4.rotX(m, Math.sin(this.hurtT - a) * (this.hurtT - a) * (this.damage / 10) * this.hurtDir * Math.PI / 180);
    const tex = r.beTex((this.chest ? 'chest_boat_' : 'boat_') + this.wood);
    const model = this.raft ? (this.chest ? 'vh_chest_raft' : 'vh_raft') : (this.chest ? 'vh_chest_boat' : 'vh_boat');
    r.gl.disable(r.gl.CULL_FACE);
    r.drawModel(model, tex, m, { lp: { rx: -Math.sin(this.paddle[0]) * 0.6 }, rp: { rx: Math.sin(this.paddle[1]) * 0.6 } }, l, env);
    r.gl.enable(r.gl.CULL_FACE);
  }
  savePrev() { super.savePrev(); this.prevYaw = this.yaw; }
}

// ---- minecarts ----
const RAIL_EXITS = {
  north_south: [[0, 0, -1], [0, 0, 1]], east_west: [[-1, 0, 0], [1, 0, 0]],
  ascending_east: [[-1, -1, 0], [1, 0, 0]], ascending_west: [[-1, 0, 0], [1, -1, 0]],
  ascending_north: [[0, 0, -1], [0, -1, 1]], ascending_south: [[0, -1, -1], [0, 0, 1]],
  south_east: [[0, 0, 1], [1, 0, 0]], south_west: [[0, 0, 1], [-1, 0, 0]], north_west: [[0, 0, -1], [-1, 0, 0]], north_east: [[0, 0, -1], [1, 0, 0]],
};
const isRail = (id) => !!id && !!BLOCKS[id] && /(^|_)rail$/.test(BLOCKS[id].key);
const railShape = (w, x, y, z) => { const id = w.getBlock(x, y, z); return isRail(id) ? Features.propOf(id, w.getMeta(x, y, z), 'shape') : null; };
class Minecart extends Vehicle {
  constructor(game, x, y, z, kind = '') {
    super(game, x, y, z, 0.98, 0.7);
    this.kind = kind; this.type = 'minecart:' + kind; this.itemKey = kind ? kind + '_minecart' : 'minecart';
    this.canRide = !kind; this.fuel = 0; this.push = [0, 0];
    if (kind === 'chest') this.slots = new Array(27).fill(null);
    if (kind === 'hopper') { this.slots = new Array(5).fill(null); this.enabled = true; }
  }
  interact(p, held) {
    if (this.kind === 'furnace') {
      // coal or charcoal keeps it going (3600 ticks each), pushed away from the player
      if (held && (ITEMS[held.id].key === 'coal' || ITEMS[held.id].key === 'charcoal') && this.fuel + 3600 <= 32000) {
        this.fuel += 3600; if (this.game.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      }
      if (this.fuel > 0) { this.push = [this.pos[0] - p.pos[0], this.pos[2] - p.pos[2]]; }
      return true;
    }
    if (this.slots && !p.sneaking) { this.openChest(); return true; }
    return super.interact(p);
  }
  tick() {
    this.savePrev(); this.age++;
    if (this.hurtT > 0) this.hurtT--;
    if (this.damage > 0) this.damage = Math.max(0, this.damage - 1);
    const w = this.world, v = this.vel;
    this.updateFluids();
    if (this.inLava) { this.hurt(4, { type: 'lava' }); if (this.dead) return; } // (AbstractMinecart: lavaHurt)
    let bx = Math.floor(this.pos[0]), by = Math.floor(this.pos[1]), bz = Math.floor(this.pos[2]);
    if (isRail(w.getBlock(bx, by - 1, bz))) by--;
    const id = w.getBlock(bx, by, bz);
    if (!isRail(id)) {
      // off the rails: falls, slides to a stop
      v[1] -= 0.04;
      if (this.onGround) { v[0] *= 0.5; v[2] *= 0.5; }
      this.move(clamp(v[0], -0.4, 0.4), v[1], clamp(v[2], -0.4, 0.4));
      v[0] *= 0.95; v[1] *= 0.95; v[2] *= 0.95;
    } else {
      if (this.fallDist > 0) this.onLand(this.fallDist); // (landed on a rail)
      this.moveOnRail(bx, by, bz, id);
    }
    if (this.dead) return;
    if (this.kind === 'furnace') {
      if (this.fuel > 0) { this.fuel--; if (Math.random() < 0.25) this.game.particles.spawn('smoke', this.pos[0], this.pos[1] + 0.8, this.pos[2], 0, 0.05, 0); }
      else this.push = [0, 0];
    }
    if (this.kind === 'tnt' && this.primed !== undefined) {
      if (--this.primed <= 0) { this.explodeTnt(v[0] * v[0] + v[2] * v[2]); return; }
      this.game.particles.spawn('smoke', this.pos[0], this.pos[1] + 0.5, this.pos[2], 0, 0, 0);
    }
    if (this.kind === 'hopper' && this.enabled && typeof RS !== 'undefined') this.suck();
    if (this.rider) this.rider.followVehicle(this);
    this.rollSound();
  }
  // TNT minecart (MinecartTNT): lit by a powered activator rail, or by fire or an explosion, or when broken while
  // moving; it blows up when the fuse runs out, when it falls 3 blocks or more, and at once when a burning arrow hits
  // it - the faster it goes, the bigger the blast
  primeTnt(fuse) {
    if (this.primed !== undefined) return;
    this.primed = fuse; Sound.ev('entity.tnt.primed', this.pos, 1, 1);
  }
  explodeTnt(r) {
    if (this.dead) return;
    this.dead = true; if (this.rider) this.rider.dismount();
    this.game.explode(this.pos[0], this.pos[1], this.pos[2], 4 + Math.random() * 1.5 * Math.min(Math.sqrt(r), 5), null);
  }
  hurt(a, src) {
    if (this.kind === 'tnt' && src && !this.dead) {
      if (src.type === 'arrow' && src.fire) { this.explodeTnt(src.speed2 || 0); return true; }
      const lit = src.type === 'explosion' || src.type === 'lava';
      const breaks = (src.player && this.game.mode === 'creative') || this.damage + a * 10 > 40;
      if (lit || (breaks && this.vel[0] * this.vel[0] + this.vel[2] * this.vel[2] >= 0.01)) {
        this.hurtDir = -this.hurtDir; this.hurtT = 10;
        this.primeTnt((Math.random() * 20 | 0) + (Math.random() * 20 | 0));
        return true;
      }
    }
    return super.hurt(a, src);
  }
  onLand(d) { if (this.kind === 'tnt' && d >= 3) this.explodeTnt((d / 10) * (d / 10)); }
  // a hopper minecart takes in an item a tick: from the container above it, else one lying around it
  // (MinecartHopper.tick -> HopperBlockEntity.suckInItems)
  suck() {
    const g = this.game, self = { size: 5, get: (i) => this.slots[i], set: (i, s) => { this.slots[i] = s; }, canIn: () => true, canOut: () => true };
    const src = RS.container(g, Math.floor(this.pos[0]), Math.floor(this.pos[1] + 1.5), Math.floor(this.pos[2]));
    if (src) {
      for (let i = 0; i < src.size; i++) {
        const s = src.get(i); if (!s || !src.canOut(i, 'down')) continue;
        if (!RS.insert(self, { ...s, count: 1 }, 'up')) { s.count--; if (!s.count) src.set(i, null); return; }
      }
      return;
    }
    const b = this.box();
    for (const e of g.entities) {
      if (!(e instanceof ItemEntity) || e.dead) continue;
      if (e.pos[0] < b[0] - 0.25 || e.pos[0] > b[3] + 0.25 || e.pos[2] < b[2] - 0.25 || e.pos[2] > b[5] + 0.25 || e.pos[1] + 0.25 < b[1] || e.pos[1] > b[4]) continue; // (boxes meeting)
      const left = RS.insert(self, e.stack, 'up');
      if (!left) e.dead = true; else if (left.count !== e.stack.count) e.stack = left; else continue;
      return;
    }
  }
  // rolling (MinecartSoundInstance): louder the faster it goes, the pitch rising while it keeps going; its rider
  // also hears the inside (RidingMinecartSoundInstance, under water the underwater one)
  rollSound() {
    const f = Math.hypot(this.pos[0] - this.prev[0], this.pos[2] - this.prev[2]);
    let vol = 0;
    if (f >= 0.01) { this.sndPitch = Math.min(1, (this.sndPitch || 0) + 0.0025); vol = lerp(0, 0.7, clamp(f, 0, 0.5)); } else this.sndPitch = 0;
    if (vol > 0 && !(this.sndRoll && this.sndRoll.live)) this.sndRoll = Sound.loop('entity.minecart.riding');
    if (this.sndRoll) this.sndRoll.update(this.pos, vol, this.sndPitch);
    const g = this.game, inside = g.player && g.player.vehicle === this;
    if (!inside && !this.sndIn) return;
    const ev = g.headInWater ? 'entity.minecart.inside.underwater' : 'entity.minecart.inside';
    if (this.sndIn && this.sndInEv !== ev) { this.sndIn.stop(); this.sndIn = null; }
    const iv = inside && f >= 0.01 ? clamp(f, 0, 1) * 0.75 : 0;
    if (iv > 0 && !(this.sndIn && this.sndIn.live)) { this.sndIn = Sound.loop(ev); this.sndInEv = ev; }
    if (this.sndIn) this.sndIn.update(null, iv, 1);
  }
  saveData() { return { ...super.saveData(), primed: this.primed, enabled: this.enabled, push: this.push }; }
  loadData(d) {
    super.loadData(d);
    if (d.primed !== undefined && d.primed !== null) this.primed = d.primed;
    if (d.enabled !== undefined) this.enabled = d.enabled;
    if (d.push) this.push = d.push;
  }
  moveOnRail(bx, by, bz, id) {
    const w = this.world, v = this.vel, meta = w.getMeta(bx, by, bz), shape = Features.propOf(id, meta, 'shape'), key = BLOCKS[id].key;
    const powered = Features.propOf(id, meta, 'powered') === 'true';
    this.fallDist = 0;
    const slope = 0.0078125;
    if (shape === 'ascending_east') v[0] -= slope; else if (shape === 'ascending_west') v[0] += slope;
    else if (shape === 'ascending_north') v[2] += slope; else if (shape === 'ascending_south') v[2] -= slope;
    const [a, b] = RAIL_EXITS[shape] || RAIL_EXITS.north_south;
    let dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (v[0] * dx + v[2] * dz < 0) { dx = -dx; dz = -dz; }
    let sp = Math.min(2, Math.hypot(v[0], v[2]));
    v[0] = sp * dx / len; v[2] = sp * dz / len;
    // the rider pushes it off from standing
    const inp = this.rider && this.rider.rideInput;
    if (inp && inp.fwd > 0 && v[0] * v[0] + v[2] * v[2] < 0.01) {
      const yaw = this.rider.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), d = (fx * dx + fz * dz) / len;
      v[0] += dx / len * d * 0.1; v[2] += dz / len * d * 0.1;
    }
    // a powered rail without power brakes
    if (key === 'powered_rail' && !powered) { if (Math.hypot(v[0], v[2]) < 0.03) { v[0] = 0; v[2] = 0; } else { v[0] *= 0.5; v[2] *= 0.5; } }
    // the furnace minecart's push
    if (this.kind === 'furnace' && this.fuel > 0) {
      let px = this.push[0], pz = this.push[1]; const pl = Math.hypot(px, pz);
      if (pl > 1e-4) { px /= pl; pz /= pl; if (px * dx + pz * dz < 0) { px = -dx / len; pz = -dz / len; } else { px = dx / len; pz = dz / len; } this.push = [px, pz]; v[0] = v[0] * 0.8 + px * 0.05; v[2] = v[2] * 0.8 + pz * 0.05; }
    }
    // keep it on the line through the rail
    const x0 = bx + 0.5 + a[0] * 0.5, z0 = bz + 0.5 + a[2] * 0.5, x1 = bx + 0.5 + b[0] * 0.5, z1 = bz + 0.5 + b[2] * 0.5;
    const lx = x1 - x0, lz = z1 - z0;
    let t;
    if (lx === 0) t = this.pos[2] - bz; else if (lz === 0) t = this.pos[0] - bx; else t = ((this.pos[0] - x0) * lx + (this.pos[2] - z0) * lz) * 2;
    this.pos[0] = x0 + lx * t; this.pos[2] = z0 + lz * t;
    // (a furnace minecart is slower: FurnaceMinecart.getMaxSpeed)
    const max = this.kind === 'furnace' ? (this.inWater ? 0.15 : 0.2) : this.inWater ? 0.2 : 0.4;
    const mx = clamp(v[0], -max, max), mz = clamp(v[2], -max, max);
    this.pos[0] += mx; this.pos[2] += mz;
    // height on the rail (slopes climb with the distance across the block)
    const fx = this.pos[0] - bx, fz = this.pos[2] - bz;
    let h = 0.0625;
    if (shape === 'ascending_east') h += fx; else if (shape === 'ascending_west') h += 1 - fx;
    else if (shape === 'ascending_north') h += 1 - fz; else if (shape === 'ascending_south') h += fz;
    let ny = by + h;
    // moved onto the next block: it may be one up or down
    const nbx = Math.floor(this.pos[0]), nbz = Math.floor(this.pos[2]);
    if (nbx !== bx || nbz !== bz) {
      // (onto a rail at the same level: its own height - the slope's sum went on and put the cart under the floor at the
      // bottom of a slope: "下坡直接卡进方块", feedback 2026-11-01/02)
      const here = w.getBlock(nbx, by, nbz);
      if (isRail(w.getBlock(nbx, by + 1, nbz))) ny = by + 1 + 0.0625;
      else if (isRail(here)) { const s2 = Features.propOf(here, w.getMeta(nbx, by, nbz), 'shape'), gx = this.pos[0] - nbx, gz = this.pos[2] - nbz; ny = by + 0.0625 + (s2 === 'ascending_east' ? gx : s2 === 'ascending_west' ? 1 - gx : s2 === 'ascending_north' ? 1 - gz : s2 === 'ascending_south' ? gz : 0); }
      else if (isRail(w.getBlock(nbx, by - 1, nbz))) ny = by - 1 + 0.0625 + 0.99;
    }
    // blocked by a wall: stop
    // (on a slope the box sits higher and narrower: its corner caught the block under the upper rail and the cart
    // stopped half way up - "矿车上不了坡、卡进方块", feedback 2026-11-01/02)
    const sl = shape && shape.startsWith('ascending'), m = sl ? 0.35 : 0.49;
    const bb = [this.pos[0] - m, ny + (sl ? 0.45 : 0.1), this.pos[2] - m, this.pos[0] + m, ny + 0.7, this.pos[2] + m];
    if (this.collides(bb)) { this.pos[0] -= mx; this.pos[2] -= mz; v[0] = 0; v[2] = 0; }
    else this.pos[1] = ny;
    v[1] = 0;
    // friction (less with someone in it); powered rails speed it up
    const fr = this.rider ? 0.997 : 0.96;
    v[0] *= fr; v[2] *= fr;
    if (key === 'powered_rail' && powered) {
      const s = Math.hypot(v[0], v[2]);
      if (s > 0.01) { v[0] += v[0] / s * 0.06; v[2] += v[2] / s * 0.06; }
      else if (dx === 0) { if (this.collides([this.pos[0] - 0.5, ny + 0.2, this.pos[2] - 1.3, this.pos[0] + 0.5, ny + 0.6, this.pos[2] - 0.6])) v[2] = 0.02; else if (this.collides([this.pos[0] - 0.5, ny + 0.2, this.pos[2] + 0.6, this.pos[0] + 0.5, ny + 0.6, this.pos[2] + 1.3])) v[2] = -0.02; }
      else { if (this.collides([this.pos[0] - 1.3, ny + 0.2, this.pos[2] - 0.5, this.pos[0] - 0.6, ny + 0.6, this.pos[2] + 0.5])) v[0] = 0.02; else if (this.collides([this.pos[0] + 0.6, ny + 0.2, this.pos[2] - 0.5, this.pos[0] + 1.3, ny + 0.6, this.pos[2] + 0.5])) v[0] = -0.02; }
    }
    // an activator rail with power: a TNT minecart is lit, a rider is thrown out
    // an activator rail: with power a TNT minecart is lit and a rider thrown out; a hopper minecart works only without
    if (key === 'activator_rail') {
      if (this.kind === 'hopper') this.enabled = !powered;
      if (powered) { if (this.kind === 'tnt') this.primeTnt(80); if (this.rider) this.rider.dismount(); }
    }
    // facing along the rail
    if (Math.abs(v[0]) + Math.abs(v[2]) > 1e-3) { const want = Math.atan2(-v[0], -v[2]); let d = want - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; if (Math.abs(d) > Math.PI / 2) d += d > 0 ? -Math.PI : Math.PI; this.yaw += d; }
    this.pitch = shape && shape.startsWith('ascending') ? ((shape === 'ascending_east' || shape === 'ascending_north') ? 1 : -1) * Math.PI / 4 : 0;
  }
  seat() { return [this.pos[0], this.pos[1] - 0.25, this.pos[2]]; }
  drawSelf(g, ip, a, env, l) {
    const r = g.renderer; r.initVehicleModels();
    const m = M4.create(); M4.translate(m, ip[0], ip[1] + 0.375, ip[2]);
    M4.rotY(m, lerp(this.prevYaw ?? this.yaw, this.yaw, a) + Math.PI / 2);
    if (this.pitch) M4.rotZ(m, -this.pitch * (Math.abs(Math.cos(this.yaw)) > 0.5 ? 1 : 1));
    if (this.hurtT > 0) M4.rotX(m, Math.sin(this.hurtT - a) * (this.hurtT - a) * (this.damage / 10) * this.hurtDir * Math.PI / 180);
    // the block it carries, three quarters size, sitting in it
    const block = { chest: 'chest', furnace: 'furnace', tnt: 'tnt', hopper: 'hopper', command_block: 'command_block' }[this.kind];
    if (block && BID[block] !== undefined) {
      const bm = M4.copy(m); M4.scale(bm, 0.75, 0.75, 0.75); M4.translate(bm, -0.5, (6 - 8) / 16, -0.5);
      if (this.kind === 'tnt' && this.primed !== undefined && (this.primed / 5 | 0) % 2 === 0) { M4.translate(bm, 0.5, 0.5, 0.5); M4.scale(bm, 1.1, 1.1, 1.1); M4.translate(bm, -0.5, -0.5, -0.5); }
      if (block === 'chest') {
        // the chest model as the item icon draws it (its model is y-down from the block's corner)
        const cm = M4.copy(m); M4.scale(cm, 0.75, 0.75, 0.75); M4.translate(cm, 0, -2 / 16, 0); M4.translate(cm, -0.5, 0, -0.5); M4.scale(cm, -1, -1, 1);
        r.initBEModels(); r.drawModel('chest', r.beTex('chest_normal') || 'chest_normal', cm, null, l, env);
      }
      else {
        // (a furnace minecart with fuel shows a lit furnace)
        const bid = block === 'furnace' && this.fuel > 0 && BID.lit_furnace !== undefined ? BID.lit_furnace : BID[block];
        r.drawMesh(g.blockMesh(bid, block === 'furnace' ? Features.withProp(bid, 0, 'facing', 'east') : 0), bm, env, l);
      }
    }
    r.gl.disable(r.gl.CULL_FACE);
    r.drawModel('vh_minecart', r.beTex('minecart'), m, null, l, env);
    r.gl.enable(r.gl.CULL_FACE);
  }
  savePrev() { super.savePrev(); this.prevYaw = this.yaw; }
}

// ---- riding ----
Player.prototype.mount = function (v) {
  if (this.vehicle) this.dismount();
  this.vehicle = v; v.rider = this; this.flying = false; this.gliding = false; this.sneaking = false;
  this.followVehicle(v); this.savePrev();
};
Player.prototype.dismount = function () {
  const v = this.vehicle; if (!v) return;
  this.vehicle = null; v.rider = null; this.rideInput = null;
  // stand beside it (or on top when there is no room)
  const w = this.world;
  for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
    const x = v.pos[0] + dx, z = v.pos[2] + dz, y = Math.floor(v.pos[1]) + 0.01;
    const b = [x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3];
    if (!this.collides(b) && BLOCKS[w.getBlock(Math.floor(x), Math.floor(y) - 1, Math.floor(z))].solid) { this.pos = [x, y, z]; this.vel = [0, 0, 0]; this.savePrev(); return; }
  }
  this.pos = [v.pos[0], v.pos[1] + v.h + 0.01, v.pos[2]]; this.vel = [0, 0, 0]; this.savePrev();
};
Player.prototype.followVehicle = function (v) { const s = v.seat(); this.pos[0] = s[0]; this.pos[1] = s[1]; this.pos[2] = s[2]; this.vel = [0, 0, 0]; this.fallDist = 0; };
const _vPlayerTick = Player.prototype.tick;
Player.prototype.tick = function (input) {
  const v = this.vehicle;
  if (!v) return _vPlayerTick.call(this, input);
  if (v.dead || (input.sneak && !this.rideSneak)) { this.dismount(); this.rideSneak = !!input.sneak; return _vPlayerTick.call(this, { ...input, sneak: false }); }
  this.rideSneak = !!input.sneak;
  this.savePrev(); this.baseTick();
  if (this.deathTime > 0) { this.dismount(); this.deathTime++; return; }
  this.rideInput = input; this.onGround = true; this.sprinting = false; this.swimming = false; this.pose = 'stand'; this.h = 1.8;
  // no view bobbing while riding: it settles to nothing. The last tick's values follow along - left as they were on
  // getting in, the hand swung between them every frame (shaking the whole ride)
  this.prevBob = this.bob; this.prevBobAmt = this.bobAmt; this.bobAmt *= 0.6;
  this.limbAmt = 0;
  // the hand, its swing, hunger and regeneration go on as on foot (skipped, a swing froze half-way and the hand
  // jumped between two heights every frame)
  this.handsTick(); this.hungerTick();
  // a boat turns its rider with it
  if (v instanceof Boat && v.prevYaw !== undefined) this.yaw += v.yaw - v.prevYaw;
};
// sitting: legs forward, like vanilla's riding pose
const _vPose = Game.prototype.playerPose;
Game.prototype.playerPose = function (a) {
  const P = _vPose.call(this, a), p = this.player;
  if (p.vehicle) {
    P.rleg = { rx: 1.4137167, ry: -0.31415927 }; P.lleg = { rx: 1.4137167, ry: 0.31415927 };
    if (!p.usingItem) { P.rarm.rx = (P.rarm.rx || 0) + 0.62831855; P.larm.rx = (P.larm.rx || 0) + 0.62831855; }
  }
  return P;
};
// not targeting the vehicle being ridden
const _rayEntity = Game.prototype.rayEntity;
Game.prototype.rayEntity = function (o, d, max) {
  const v = this.player && this.player.vehicle;
  if (!v) return _rayEntity.call(this, o, d, max);
  const was = v.hittable; v.hittable = false; v.dead = true;
  try { return _rayEntity.call(this, o, d, max); } finally { v.dead = false; v.hittable = was; }
};

// ---- placing: boats on water (or the ground), minecarts on rails ----
const _vUseEquipment = Game.prototype.useEquipment;
Game.prototype.useEquipment = function (held, def) {
  const k = def && def.key, p = this.player;
  if (BOAT_ITEM[k]) {
    const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]], t = this.raycast(eye, this.lookDir(), this.reach(), true);
    if (!t) return true;
    let [x, y, z] = t.point;
    if (IS_FLUID[t.id]) y = Math.floor(y) + 1 - 0.11 - 0.4; else if (t.face !== 3) return true;
    const [wood, chest] = BOAT_ITEM[k], b = new Boat(this, x, y, z, wood, chest);
    b.yaw = p.yaw; b.savePrev();
    if (b.collides(b.box()) && !IS_FLUID[t.id]) return true;
    this.entities.push(b);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing(); Sound.ev('entity.boat.paddle_water', [x, y, z], 0.5, 1);
    return true;
  }
  if (CART_ITEM[k] !== undefined) {
    const t = this.target;
    if (!t || !isRail(t.id)) return true;
    const [x, y, z] = t.pos, c = new Minecart(this, x + 0.5, y + 0.0625, z + 0.5, CART_ITEM[k]);
    const sh = railShape(this.world, x, y, z) || 'north_south';
    c.yaw = sh.includes('east') || sh.includes('west') ? Math.PI / 2 : 0; c.savePrev();
    this.entities.push(c);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing();
    return true;
  }
  return _vUseEquipment.call(this, held, def);
};

// ---- rails join their neighbours (a simple RailState): straight, sloped up to a rail one higher, curved (plain rails) ----
const RAIL_DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
function railConnects(w, x, y, z, toX, toZ) {
  // the rail at x,y,z (or one below / above) has an exit toward toX,toZ
  for (const dy of [0, -1, 1]) {
    const sh = railShape(w, x, y + dy, z);
    if (sh && RAIL_EXITS[sh].some(([ex, , ez]) => x + ex === toX && z + ez === toZ)) return true;
  }
  return false;
}
function railNeighbors(w, x, y, z) {
  const out = [];
  for (const [d, [dx, dz]] of Object.entries(RAIL_DIRS)) {
    for (const dy of [0, 1, -1]) if (railShape(w, x + dx, y + dy, z + dz)) { out.push({ d, dx, dz, dy }); break; }
  }
  return out;
}
// a T junction's curve (vanilla RailState.place with three neighbours): unpowered the last of north-west, north-east,
// south-west, south-east that it can make; powered the last of south-east, south-west, north-east, north-west.
// null when it isn't a junction
function railJunctionShape(w, x, y, z, powered) {
  const ds = new Set(railNeighbors(w, x, y, z).map(n => n.d));
  if (ds.size !== 3) return null;
  const n = ds.has('north'), s = ds.has('south'), e = ds.has('east'), wt = ds.has('west');
  const order = powered ? [['south_east', s && e], ['south_west', s && wt], ['north_east', n && e], ['north_west', n && wt]]
    : [['north_west', n && wt], ['north_east', n && e], ['south_west', s && wt], ['south_east', s && e]];
  let shape = null;
  for (const [k, ok] of order) if (ok) shape = k;
  return shape;
}
function railShapeFor(w, x, y, z, curves, fallbackNS) {
  const ns = railNeighbors(w, x, y, z);
  // the neighbours that are free to join (fewer than two links, or already pointing here)
  const free = ns.filter(n => { const sh = railShape(w, x + n.dx, y + n.dy, z + n.dz); const links = railNeighbors(w, x + n.dx, y + n.dy, z + n.dz).filter(m => railConnects(w, x + n.dx + m.dx, y + n.dy + m.dy, z + n.dz + m.dz, x + n.dx, z + n.dz)).length; return links < 2 || RAIL_EXITS[sh].some(([ex, , ez]) => ex === -n.dx && ez === -n.dz); });
  const has = (d) => free.find(n => n.d === d);
  const up = (d) => { const n = has(d); return n && n.dy === 1; };
  let shape;
  if (has('north') && has('south')) shape = up('north') ? 'ascending_north' : up('south') ? 'ascending_south' : 'north_south';
  else if (has('east') && has('west')) shape = up('east') ? 'ascending_east' : up('west') ? 'ascending_west' : 'east_west';
  else if (curves && (has('north') || has('south')) && (has('east') || has('west'))) shape = (has('north') ? 'north' : 'south') + '_' + (has('east') ? 'east' : 'west');
  else if (has('north') || has('south')) shape = up('north') ? 'ascending_north' : up('south') ? 'ascending_south' : 'north_south';
  else if (has('east') || has('west')) shape = up('east') ? 'ascending_east' : up('west') ? 'ascending_west' : 'east_west';
  else shape = fallbackNS ? 'north_south' : 'east_west';
  return shape;
}
const _vPlaceState = Game.prototype.placeState;
Game.prototype.placeState = function (b, t, hdir) {
  let m = _vPlaceState.call(this, b, t, hdir);
  if (!/(^|_)rail$/.test(b.key) || !b.states || !('shape' in b.states[0])) return m;
  const D = DIRS[t.face], x = t.pos[0] + D[0], y = t.pos[1] + D[1], z = t.pos[2] + D[2];
  const shape = railShapeFor(this.world, x, y, z, b.key === 'rail', hdir === 4 || hdir === 5);
  if (b.states.some(s => s.shape === shape)) m = Features.withProp(b.id, m, 'shape', shape);
  this.pendingRail = [x, y, z];
  return m;
};
const _vPlaceAt = Game.prototype.placeAt;
Game.prototype.placeAt = function (...args) {
  const r = _vPlaceAt.apply(this, args);
  const pr = this.pendingRail; this.pendingRail = null;
  if (pr) {
    // neighbours that had a free end turn toward the new rail
    const w = this.world, [x, y, z] = pr;
    for (const n of railNeighbors(w, x, y, z)) {
      const nx = x + n.dx, ny = y + n.dy, nz = z + n.dz, id = w.getBlock(nx, ny, nz);
      if (railConnects(w, nx, ny, nz, x, z)) continue;
      const links = railNeighbors(w, nx, ny, nz).filter(m => railConnects(w, nx + m.dx, ny + m.dy, nz + m.dz, nx, nz) && !(nx + m.dx === x && nz + m.dz === z)).length;
      if (links >= 2) continue;
      const sh = railShapeFor(w, nx, ny, nz, BLOCKS[id].key === 'rail', true);
      if (BLOCKS[id].states.some(s => s.shape === sh)) w.setMeta(nx, ny, nz, Features.withProp(id, w.getMeta(nx, ny, nz), 'shape', sh));
    }
    this.flushMesh();
  }
  return r;
};

// ---- saving: vehicles go with the mobs ----
const _vCreateMob = createMob;
createMob = function (game, type, x, y, z) {
  if (typeof type === 'string' && type.includes('boat:')) { const [k, wood] = type.split(':'); return new Boat(game, x, y, z, wood, k === 'chest_boat'); }
  if (typeof type === 'string' && type.startsWith('minecart:')) return new Minecart(game, x, y, z, type.slice(9));
  return _vCreateMob(game, type, x, y, z);
};

// ---- mobs riding boats and minecarts (vanilla AbstractBoat / AbstractMinecart pushing entities) ----------------
// A mob that bumps into a boat nobody is steering gets in (not fish, squid, dolphins ... - the
// cannot_be_pushed_onto_boats tag - nor anything as wide as the boat); one bumping into a moving minecart gets in (not
// iron golems). It stays seated until the vehicle breaks or an activator rail throws it out, and doesn't despawn
// meanwhile (Mob.requiresCustomPersistence). With a player too, a boat seats the player in front and the mob behind.
const NO_BOAT_MOBS = new Set(['elder_guardian', 'cod', 'pufferfish', 'salmon', 'tropical_fish', 'dolphin', 'squid', 'glow_squid', 'tadpole',
  'creaking', 'nautilus', 'zombie_nautilus', 'sulfur_cube']);
// (a mob's feet: the vehicle's passenger point 0.1875 up, less its riding offset - about 0.6 for the humanoid ones,
// which sit with their legs out like the player; animals stand on it)
const SEATED_MOBS = /zombie|skeleton|stray|bogged|husk|drowned|villager|wandering_trader|piglin|pillager|vindicator|evoker|illusioner|witch/;
Vehicle.prototype.seatFor = function (e) {
  const s = this.seat();
  if (e === this.mob) s[1] = this.pos[1] + 0.1875 - (SEATED_MOBS.test(e.type || '') ? 0.6 : 0);
  if (this instanceof Boat && this.rider && this.mob) {
    const f = e === this.mob ? -0.6 : 0.2;
    s[0] += -Math.sin(this.yaw) * f; s[2] += -Math.cos(this.yaw) * f;
  }
  return s;
};
Vehicle.prototype.pickUpMob = function () {
  const boat = this instanceof Boat, g = this.game;
  if (boat ? !!this.rider : !(this.canRide && !this.rider && this.vel[0] ** 2 + this.vel[2] ** 2 > 0.01)) return;
  const b = this.box();
  for (const e of g.entities) {
    if (!(e instanceof Mob) || e.dead || e.deathTime || e.vehicleRef || e.remote || (e.boardAt || 0) > g.tickCount || e.rider) continue;
    if (boat ? NO_BOAT_MOBS.has(e.type) || e.w >= this.w : e.type === 'iron_golem') continue;
    const eb = e.box();
    if (eb[3] < b[0] - 0.2 || eb[0] > b[3] + 0.2 || eb[5] < b[2] - 0.2 || eb[2] > b[5] + 0.2 || eb[4] < b[1] || eb[1] > b[4]) continue;
    this.board(e);
    return;
  }
};
Vehicle.prototype.board = function (e) { this.mob = e; e.vehicleRef = this; e.riding = true; e.persistent = true; e.goal = null; };
Vehicle.prototype.dropMob = function () {
  const m = this.mob; this.mob = null;
  if (!m || m.vehicleRef !== this) return;
  m.vehicleRef = null; m.riding = false; m.boardAt = this.game.tickCount + 60; // (vanilla's boarding cooldown)
  m.pos[1] = this.pos[1] + this.h; m.prev = [...m.pos];
};
const _vInteract = Vehicle.prototype.interact;
Vehicle.prototype.interact = function (p, held) { if (this instanceof Minecart && this.mob && !(this.slots && p.sneaking)) return false; return _vInteract.call(this, p, held); }; // (one seat)
const _vHurt = Vehicle.prototype.hurt;
Vehicle.prototype.hurt = function (a, src) { const r = _vHurt.call(this, a, src); if (this.dead && this.mob) this.dropMob(); return r; };
// (rideable mobs - horses, pigs, striders ... - have only their seat(); boats and minecarts seat a mob passenger too)
Player.prototype.followVehicle = function (v) { const s = v.seatFor ? v.seatFor(this) : v.seat(); this.pos[0] = s[0]; this.pos[1] = s[1]; this.pos[2] = s[2]; this.vel = [0, 0, 0]; this.fallDist = 0; };
// after every entity has ticked (the vehicles have moved, the mobs' own steps are undone): passengers on their seats
Game.prototype.seatPassengers = function () {
  if (this.net) return;
  for (const v of this.entities) {
    if (!(v instanceof Vehicle) || v.dead) continue;
    // a saved world: the mob that was in it, found again near it
    if (v.wantsMob && !v.mob) {
      const m = this.entities.find((e) => e instanceof Mob && e.wantsRide && !e.vehicleRef && Math.abs(e.pos[0] - v.pos[0]) < 2 && Math.abs(e.pos[1] - v.pos[1]) < 2 && Math.abs(e.pos[2] - v.pos[2]) < 2);
      if (m) { m.wantsRide = false; v.board(m); }
      v.wantsMob = false;
    }
    if (!v.mob) { v.pickUpMob(); if (!v.mob) continue; }
    const m = v.mob;
    if (m.dead || m.deathTime || m.vehicleRef !== v) { v.dropMob(); continue; }
    // an activator rail with power empties a minecart
    if (v instanceof Minecart) {
      const bx = Math.floor(v.pos[0]), bz = Math.floor(v.pos[2]); let by = Math.floor(v.pos[1]); if (!isRail(this.world.getBlock(bx, by, bz))) by--;
      const id = this.world.getBlock(bx, by, bz);
      if (BLOCKS[id] && BLOCKS[id].key === 'activator_rail' && Features.propOf(id, this.world.getMeta(bx, by, bz), 'powered') === 'true') { v.dropMob(); continue; }
    }
    m.pos = v.seatFor(m); m.vel = [0, 0, 0]; m.fallDist = 0; m.goal = null; m.limbAmt = 0; // (sitting, not walking)
    if (v instanceof Boat) { m.bodyYaw = m.yaw = v.yaw; }
  }
};
const _vSaveV = Vehicle.prototype.saveData, _vLoadV = Vehicle.prototype.loadData;
Vehicle.prototype.saveData = function () { return { ..._vSaveV.call(this), mob: this.mob ? 1 : 0 }; };
Vehicle.prototype.loadData = function (d) { _vLoadV.call(this, d); if (d && d.mob) this.wantsMob = true; };
