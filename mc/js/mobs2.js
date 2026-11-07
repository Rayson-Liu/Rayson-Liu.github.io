'use strict';
// ---------------------------------------------------------------------------
// Nether / End mobs, projectiles, end crystals and the Ender Dragon
// ---------------------------------------------------------------------------
Object.assign(MOB_TYPES, {
  enderman: { cn: '末影人', hp: 40, w: 0.6, h: 2.9, speed: 0.3, model: 'enderman', hostile: true, neutral: true, attack: 7, drops: [['ender_pearl', 0, 1]], scale: 1 },
  blaze: { cn: '烈焰人', hp: 20, w: 0.6, h: 1.8, speed: 0.23, model: 'blaze', hostile: true, fireproof: true, flying: true, drops: [['blaze_rod', 0, 1]], scale: 1, bright: true },
  ghast: { cn: '恶魂', hp: 10, w: 4, h: 4, speed: 0.1, model: 'ghast', hostile: true, fireproof: true, flying: true, drops: [['ghast_tear', 0, 1], ['gunpowder', 0, 2]], scale: 4.5 },
  zombified_piglin: { cn: '僵尸猪灵', hp: 20, w: 0.6, h: 1.95, speed: 0.23, model: 'zombified_piglin', hostile: true, neutral: true, fireproof: true, attack: 8, armor: 2, drops: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1]], scale: 0.9375 },
  magma_cube: { cn: '岩浆怪', hp: 16, w: 2.04, h: 2.04, speed: 0.2, model: 'magma_cube', hostile: true, fireproof: true, attack: 6, drops: [], scale: 1 },
});

function createMob(game, type, x, y, z) {
  switch (type) {
    case 'enderman': return new Enderman(game, x, y, z);
    case 'blaze': return new Blaze(game, x, y, z);
    case 'ghast': return new Ghast(game, x, y, z);
    case 'zombified_piglin': return new ZombifiedPiglin(game, x, y, z);
    case 'magma_cube': return new MagmaCube(game, x, y, z, 4);
    case 'ender_dragon': return new EnderDragon(game, x, y, z);
    case 'end_crystal': return new EndCrystal(game, x, y, z);
  }
  return new Mob(game, type, x, y, z);
}

// vanilla Mob.checkDespawn's chance: past 32 blocks, one tick in 800 once idle for 30 s (the age stands in for the
// idle time, as for ghasts - nether_mobs.js). Endermen, zombified piglins, blazes and magma cubes went only past 96-100
// blocks, so the ones spawned piled up. Not one that is persistent, named, leashed, a server's or holding a block
// (vanilla Enderman.requiresCustomPersistence - none carry one here)
function randomDespawn(e) {
  return !e.persistent && !e.customName && !e.remote && !e.leashHolder && !e.carriedBlock && e.age > 600 && Math.random() < 1 / 800 && e.distTo(e.game.player) > 32;
}

function particleBurst(g, type, x, y, z, n, spread, col) {
  for (let i = 0; i < n; i++) {
    const p = g.particles.spawn(type, x + (Math.random() - 0.5) * spread, y + Math.random() * spread, z + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.2, (Math.random() - 0.3) * 0.2, (Math.random() - 0.5) * 0.2);
    if (p && col) p.col = col;
  }
}

// find a safe standing spot near (x,y,z) and move entity there
function teleportEntity(e, x, y, z) {
  const w = e.world;
  const fx = Math.floor(x), fz = Math.floor(z);
  if (!w.isLoaded(fx, fz)) return false;
  let fy = Math.floor(y);
  while (fy > 1 && !BLOCKS[w.getBlock(fx, fy - 1, fz)].solid) fy--;
  if (fy <= 1) return false;
  for (let k = 0; k < Math.ceil(e.h); k++) { const id = w.getBlock(fx, fy + k, fz); if (id && (BLOCKS[id].solid || IS_FLUID[id])) return false; }
  if (IS_FLUID[w.getBlock(fx, fy - 1, fz)]) return false;
  const ox = e.pos[0], oy = e.pos[1], oz = e.pos[2];
  e.pos = [fx + 0.5, fy, fz + 0.5]; e.prev = [...e.pos];
  if (e.collides(e.box())) { e.pos = [ox, oy, oz]; e.prev = [...e.pos]; return false; }
  particleBurst(e.game, 'portal', ox, oy, oz, 24, e.h);
  particleBurst(e.game, 'portal', e.pos[0], e.pos[1], e.pos[2], 24, e.h);
  Sound.ev('entity.enderman.teleport', e.pos, 1, 1);
  e.fallDist = 0; e.vel = [0, 0, 0];
  return true;
}

// ---- Enderman -----------------------------------------------------------------------------
class Enderman extends Mob {
  constructor(g, x, y, z) { super(g, 'enderman', x, y, z); this.angry = false; this.eyeH = 2.55; this.tpCd = 0; this.persistent = false; }
  hurt(a, src) {
    if (src && (src.type === 'arrow' || src.type === 'snowball')) { this.teleportRandom(); return false; }
    const r = super.hurt(a, src);
    if (r && src && src.attacker) { this.provoke(src.attacker); if (Math.random() < 0.4) this.teleportRandom(); }
    return r;
  }
  provoke(t) {
    if (!this.angry) Sound.ev('entity.enderman.scream', this.pos, 1, 1);
    this.angry = true; this.target = t; this.angerT = 600;
  }
  teleportRandom() {
    for (let i = 0; i < 16; i++) {
      if (teleportEntity(this, this.pos[0] + (Math.random() - 0.5) * 48, this.pos[1] + (Math.random() - 0.5) * 32 + 8, this.pos[2] + (Math.random() - 0.5) * 48)) { this.tpCd = 20; return true; }
    }
    return false;
  }
  tick() {
    this.savePrev(); this.baseTick();
    if (this.deathTick()) return;
    const g = this.game, p = g.player, dP = this.distTo(p);
    if (!this.persistent && dP > 100 || randomDespawn(this)) { this.dead = true; return; }
    if (this.tpCd > 0) this.tpCd--;
    // water and rain hurt endermen
    const wet = this.inWater || (g.dim === 'overworld' && g.weather > 0.5 && this.world.skyAt(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 2), Math.floor(this.pos[2])) >= 15 && !g.isCold(Math.floor(this.pos[0]), Math.floor(this.pos[2])));
    if (wet && this.age % 10 === 0) { this.hurt(1, { type: 'drown' }); this.teleportRandom(); }
    if (--this.idleSound < 0) { this.idleSound = 200 + Math.random() * 400; if (dP < 20) Sound.mob('enderman', 'idle', this.pos); }
    if (this.attackCd > 0) this.attackCd--;
    let fwd = 0, jump = false;
    const t = this.target;
    if (this.angry && t && !t.dead && t.deathTime === 0 && !(t === p && p.creative)) {
      if (--this.angerT <= 0 && dP > 16) { this.angry = false; this.target = null; }
      const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], d = Math.hypot(dx, dz);
      this.turnTo(Math.atan2(-dx, -dz), 0.5);
      fwd = 1;
      if (d > 14 && this.tpCd <= 0 && Math.random() < 0.05) {
        const a = Math.random() * Math.PI * 2;
        if (teleportEntity(this, t.pos[0] + Math.sin(a) * 3, t.pos[1] + 2, t.pos[2] + Math.cos(a) * 3)) this.tpCd = 40;
      }
      if (d < 1.6 && Math.abs(t.pos[1] - this.pos[1]) < 2.5 && this.attackCd <= 0) { this.attackCd = 20; this.swingT = 6; t.hurt(this.T.attack, { type: 'mob', attacker: this, knockFrom: this.pos }); }
      this.headYaw = 0; this.pitch = 0;
    } else {
      this.angry = false;
      if (this.wander) {
        const dx = this.wander[0] - this.pos[0], dz = this.wander[2] - this.pos[2];
        if (Math.hypot(dx, dz) < 1 || --this.wanderT <= 0) this.wander = null; else { this.turnTo(Math.atan2(-dx, -dz), 0.2); fwd = 0.6; }
      } else if (Math.random() < 0.01) this.pickWander(10);
      if (Math.random() < 0.0015 && this.tpCd <= 0) this.teleportRandom();
    }
    if (this.collidedH && this.onGround) jump = true;
    if (jump && this.onGround) this.vel[1] = 0.42;
    this.travel(fwd, 0, this.T.speed * this.T.speed * (this.angry ? 1.6 : 1), jump);
    let d = this.yaw - this.bodyYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.bodyYaw += d * 0.4;
    if (this.swingT > 0) this.swingT--;
    if (Math.random() < 0.1) { const pp = this.game.particles.spawn('portal', this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + Math.random() * 2.9, this.pos[2] + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, -Math.random() * 0.2, (Math.random() - 0.5) * 0.3); }
    this.animate();
  }
  pose(a) {
    const swing = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a) * 0.6662, amt = this.limbAmt;
    const l = Math.cos(swing) * 0.6 * amt, r = -l;
    const P = { head: { ry: this.headYaw, rx: this.pitch, t: this.angry ? [0, 0.3, 0] : null }, rarm: { rx: r + (this.swingT > 0 ? 1 : 0) }, larm: { rx: l }, rleg: { rx: l }, lleg: { rx: r } };
    if (this.angry) P.head.t = [(Math.random() - 0.5) * 0.04, 0.32, (Math.random() - 0.5) * 0.04];
    return P;
  }
}

// ---- Zombified piglin ----------------------------------------------------------------------
class ZombifiedPiglin extends Mob {
  constructor(g, x, y, z) { super(g, 'zombified_piglin', x, y, z); this.angry = 0; this.persistent = false; }
  hurt(a, src) {
    const r = super.hurt(a, src);
    if (r && src && src.attacker) {
      for (const e of this.game.entities) if (e instanceof ZombifiedPiglin && e.distTo(this) < 20) { e.angry = 400 + Math.random() * 400; e.target = src.attacker; }
      Sound.ev('entity.zombified_piglin.angry', this.pos, 1, 1);
    }
    return r;
  }
  tick() {
    this.savePrev(); this.baseTick();
    if (this.deathTick()) return;
    const g = this.game, p = g.player, dP = this.distTo(p);
    if (!this.persistent && dP > 100 || randomDespawn(this)) { this.dead = true; return; }
    if (--this.idleSound < 0) { this.idleSound = 200 + Math.random() * 400; if (dP < 20) Sound.mob('zombified_piglin', this.angry > 0 ? 'angry' : 'idle', this.pos); }
    if (this.attackCd > 0) this.attackCd--;
    let fwd = 0, jump = false;
    if (this.angry > 0 && this.target && this.target.deathTime === 0 && !(this.target === p && p.creative)) {
      this.angry--;
      const t = this.target, dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], d = Math.hypot(dx, dz);
      this.turnTo(Math.atan2(-dx, -dz), 0.4); fwd = 1;
      if (d < 1.4 && Math.abs(t.pos[1] - this.pos[1]) < 1.8 && this.attackCd <= 0) { this.attackCd = 20; this.swingT = 6; t.hurt(this.T.attack, { type: 'mob', attacker: this, knockFrom: this.pos }); }
    } else {
      this.target = null;
      if (this.wander) {
        const dx = this.wander[0] - this.pos[0], dz = this.wander[2] - this.pos[2];
        if (Math.hypot(dx, dz) < 1 || --this.wanderT <= 0) this.wander = null; else { this.turnTo(Math.atan2(-dx, -dz), 0.2); fwd = 0.7; }
      } else if (Math.random() < 0.01) this.pickWander(8);
    }
    if (fwd > 0) {
      const ax = this.pos[0] - Math.sin(this.yaw) * 0.8, az = this.pos[2] - Math.cos(this.yaw) * 0.8;
      let drop = 0; while (drop < 4 && !BLOCKS[this.world.getBlock(Math.floor(ax), Math.floor(this.pos[1]) - 1 - drop, Math.floor(az))].solid) drop++;
      if (drop >= 4 && this.angry <= 0) { fwd = 0; this.wander = null; }
    }
    if (this.collidedH && this.onGround) jump = true;
    if (jump && this.onGround) this.vel[1] = 0.42;
    this.travel(fwd, 0, this.T.speed * this.T.speed * (this.angry > 0 ? 1.4 : 1), jump);
    let d = this.yaw - this.bodyYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.bodyYaw += d * 0.3;
    if (this.swingT > 0) this.swingT--;
    this.animate();
  }
  pose(a) {
    const swing = lerp(this.limbSwing - this.limbAmt, this.limbSwing, a) * 0.6662, amt = this.limbAmt;
    const l = Math.cos(swing) * 1.4 * amt, r = -l;
    const raise = this.angry > 0 ? Math.PI / 2 : 0;
    return { head: { ry: this.headYaw, rx: this.pitch }, rarm: { rx: raise + r * 0.5 + (this.swingT > 0 ? Math.sin(this.swingT / 6 * Math.PI) * 0.6 : 0) }, larm: { rx: raise * 0.6 + l * 0.5 }, rleg: { rx: l }, lleg: { rx: r } };
  }
}

// ---- Flying base -------------------------------------------------------------------------------
class FlyingMob extends Mob {
  fly(tx, ty, tz, speed, drag = 0.9) {
    const dx = tx - this.pos[0], dy = ty - this.pos[1], dz = tz - this.pos[2], d = Math.hypot(dx, dy, dz) || 1;
    if (d > 0.5) { this.vel[0] += dx / d * speed; this.vel[1] += dy / d * speed; this.vel[2] += dz / d * speed; }
    this.move(this.vel[0], this.vel[1], this.vel[2]);
    this.vel[0] *= drag; this.vel[1] *= drag; this.vel[2] *= drag;
    this.fallDist = 0;
  }
}

class Blaze extends FlyingMob {
  constructor(g, x, y, z) { super(g, 'blaze', x, y, z); this.attackStep = 0; this.attackT = 0; this.persistent = false; this.hover = y; }
  tick() {
    this.savePrev(); this.baseTick();
    if (this.deathTick()) return;
    const g = this.game, p = g.player, dP = this.distTo(p);
    if (!this.persistent && dP > 96 || randomDespawn(this)) { this.dead = true; return; }
    if (this.inWater && this.age % 10 === 0) this.hurt(1, { type: 'drown' });
    if (--this.idleSound < 0) { this.idleSound = 160 + Math.random() * 200; if (dP < 20) Sound.mob('blaze', 'idle', this.pos); }
    if (Math.random() < 0.3) g.particles.spawn('smoke', this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + Math.random() * 1.8, this.pos[2] + (Math.random() - 0.5) * 0.6, 0, 0.02, 0);
    const playerOk = p.deathTime === 0 && !p.creative;
    if (playerOk && dP < seenWithin(p, 48) && this.canSee(p)) this.target = p; else if (dP > 64 || !playerOk) this.target = null;
    let tx = this.pos[0], ty = this.pos[1], tz = this.pos[2];
    if (this.target) {
      const t = this.target, dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], d = Math.hypot(dx, dz);
      this.yaw = Math.atan2(-dx, -dz); this.bodyYaw = this.yaw;
      ty = t.pos[1] + 2.5;
      if (d > 10) { tx = t.pos[0]; tz = t.pos[2]; }
      else if (d < 4) { tx = this.pos[0] - dx; tz = this.pos[2] - dz; }
      if (d < 2 && this.attackCd-- <= 0) { this.attackCd = 20; t.hurt(6, { type: 'mob', attacker: this, knockFrom: this.pos }); }
      // fireball volley: charge then three shots
      this.attackT++;
      if (this.attackStep === 0 && this.attackT > 60) { this.attackStep = 1; this.attackT = 0; Sound.ev('entity.blaze.burn', this.pos, 1, 1); }
      if (this.attackStep >= 1) {
        for (let i = 0; i < 3; i++) g.particles.spawn('flame', this.pos[0] + (Math.random() - 0.5), this.pos[1] + Math.random() * 1.8, this.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
        if (this.attackT >= 30 && (this.attackT - 30) % 6 === 0) {
          const sx = this.pos[0], sy = this.pos[1] + 1.2, sz = this.pos[2];
          const ex = t.pos[0] - sx + (Math.random() - 0.5) * 1.2, ey = t.pos[1] + 1 - sy, ez = t.pos[2] - sz + (Math.random() - 0.5) * 1.2, l = Math.hypot(ex, ey, ez);
          g.addEntity(new Fireball(g, sx, sy, sz, [ex / l * 0.8, ey / l * 0.8, ez / l * 0.8], this, true));
          Sound.ev('entity.blaze.shoot', this.pos, 1, 1);
          if (++this.attackStep > 3) { this.attackStep = 0; this.attackT = -40; }
        }
      }
    } else {
      this.attackStep = 0; this.attackT = 0;
      ty = this.hover + Math.sin(this.age / 30) * 1.5;
      if (!this.wander || --this.wanderT <= 0) this.pickWander(6);
      tx = this.wander[0]; tz = this.wander[2];
    }
    const below = this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.5), Math.floor(this.pos[2]));
    this.fly(tx, ty, tz, 0.012);
    if (!this.target && !BLOCKS[below].solid) this.vel[1] -= 0.004;
    this.animate();
  }
  pose(a) {
    const t = (this.age + a) * 0.1, P = { head: { ry: this.headYaw } };
    for (let i = 0; i < 12; i++) {
      const ring = i < 4 ? 0 : i < 8 ? 1 : 2, k = i % 4, sp = [1, -0.6, 0.35][ring], R = [9, 7, 5][ring], ang = t * sp + k * Math.PI / 2 + ring * 0.4;
      P['rod' + i] = { t: [Math.cos(ang) * R / 16, ([16, 9, 2][ring] + Math.cos((i * 2 + t) * 0.25)) / 16, Math.sin(ang) * R / 16] };
    }
    return P;
  }
}

class Ghast extends FlyingMob {
  constructor(g, x, y, z) { super(g, 'ghast', x, y, z); this.charge = 0; this.persistent = false; this.goal = null; }
  tick() {
    this.savePrev(); this.baseTick();
    if (this.deathTick()) return;
    const g = this.game, p = g.player, dP = this.distTo(p);
    if (!this.persistent && dP > 128) { this.dead = true; return; }
    if (--this.idleSound < 0) { this.idleSound = 200 + Math.random() * 300; if (dP < 48) Sound.mob('ghast', 'idle', this.pos); }
    if (!this.goal || Math.hypot(this.goal[0] - this.pos[0], this.goal[1] - this.pos[1], this.goal[2] - this.pos[2]) < 2 || Math.random() < 0.01) {
      this.goal = [this.pos[0] + (Math.random() - 0.5) * 32, clamp(this.pos[1] + (Math.random() - 0.5) * 16, 40, 110), this.pos[2] + (Math.random() - 0.5) * 32];
    }
    const playerOk = p.deathTime === 0 && !p.creative;
    const sees = playerOk && dP < seenWithin(p, 64) && this.canSee(p);
    if (sees) {
      const dx = p.pos[0] - this.pos[0], dz = p.pos[2] - this.pos[2];
      this.yaw = Math.atan2(-dx, -dz); this.bodyYaw = this.yaw;
      this.charge++;
      if (this.charge === 10) Sound.ev('entity.ghast.warn', this.pos, 5, 1);
      if (this.charge >= 20) {
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const sx = this.pos[0] + fx * 2.2, sy = this.pos[1] + 2, sz = this.pos[2] + fz * 2.2;
        const ex = p.pos[0] - sx, ey = p.pos[1] + 1 - sy, ez = p.pos[2] - sz, l = Math.hypot(ex, ey, ez);
        g.addEntity(new Fireball(g, sx, sy, sz, [ex / l * 0.7, ey / l * 0.7, ez / l * 0.7], this, false));
        Sound.ev('entity.ghast.shoot', this.pos, 5, 1);
        this.charge = -40;
      }
    } else if (this.charge > 0) this.charge--;
    else if (this.charge < 0) this.charge++;
    this.fly(this.goal[0], this.goal[1], this.goal[2], 0.006, 0.92);
    if (this.collidedH) this.goal = null;
    this.animate();
  }
  pose(a) {
    const P = {};
    for (let i = 0; i < 9; i++) P['t' + i] = { rx: 0.2 * Math.sin((this.age + a) * 0.067 + i) + 0.4 };
    return P;
  }
}

class MagmaCube extends Mob {
  constructor(g, x, y, z, size = 4) {
    super(g, 'magma_cube', x, y, z);
    this.setSize(size); this.jumpDelay = 20; this.squish = 0; this.prevSquish = 0; this.persistent = false;
  }
  setSize(s) { this.size = s; this.w = this.h = 0.52 * s; this.health = this.maxHealth = s * s; }
  die(src) {
    super.die(src);
    if (this.size > 1) {
      for (let i = 0, n = 2 + ((Math.random() * 3) | 0); i < n; i++) {
        const c = new MagmaCube(this.game, this.pos[0] + (Math.random() - 0.5) * this.w, this.pos[1] + 0.5, this.pos[2] + (Math.random() - 0.5) * this.w, this.size / 2);
        this.game.addEntity(c);
      }
      if (Math.random() < 0.25) this.game.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], makeStack('magma_cream', 1));
    }
  }
  tick() {
    this.savePrev(); this.baseTick();
    if (this.deathTick()) return;
    const g = this.game, p = g.player, dP = this.distTo(p);
    if (!this.persistent && dP > 100 || randomDespawn(this)) { this.dead = true; return; }
    this.prevSquish = this.squish; this.squish *= 0.6;
    const playerOk = p.deathTime === 0 && !p.creative;
    this.target = playerOk && dP < seenWithin(p, 16) ? p : null;
    if (this.target) { const dx = p.pos[0] - this.pos[0], dz = p.pos[2] - this.pos[2]; this.yaw = Math.atan2(-dx, -dz); }
    else if (Math.random() < 0.02) this.yaw += (Math.random() - 0.5) * 2;
    if (this.onGround) {
      this.vel[0] *= 0.5; this.vel[2] *= 0.5;
      if (this.wasAir) { this.squish = -0.5; Sound.ev('entity.magma_cube.squish', this.pos, 1, 1); this.wasAir = false; }
      if (--this.jumpDelay <= 0) {
        this.jumpDelay = this.target ? 10 + ((Math.random() * 10) | 0) : 20 + ((Math.random() * 40) | 0);
        const sp = 0.1 + this.size * 0.04;
        this.vel[1] = 0.42 + this.size * 0.1;
        this.vel[0] = -Math.sin(this.yaw) * sp; this.vel[2] = -Math.cos(this.yaw) * sp;
        this.squish = 1; Sound.ev('entity.magma_cube.jump', this.pos, 1, 1);
      }
    } else this.wasAir = true;
    this.move(this.vel[0], this.vel[1], this.vel[2]);
    this.vel[1] = (this.vel[1] - 0.08) * 0.98;
    if (this.attackCd > 0) this.attackCd--;
    if (this.target && this.attackCd <= 0) {
      const a = this.box(), b = p.box();
      if (a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2]) { this.attackCd = 20; p.hurt([3, 3, 4, 4, 6][this.size] || 3, { type: 'mob', attacker: this, knockFrom: this.pos }); }
    }
    this.bodyYaw = this.yaw;
  }
}

// ---- Projectiles ---------------------------------------------------------------------------------
class Fireball extends Entity {
  constructor(g, x, y, z, vel, owner, small) {
    super(g, x, y, z, small ? 0.3125 : 1, small ? 0.3125 : 1);
    this.vel = vel; this.owner = owner; this.small = small; this.hittable = !small;
  }
  hurt(a, src) {
    if (this.small || !src || !src.attacker) return false;
    const att = src.attacker;
    const d = att === this.game.player ? this.game.lookDir() : [this.pos[0] - att.pos[0], 0, this.pos[2] - att.pos[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    this.vel = [d[0] / l * 0.9, d[1] / l * 0.9, d[2] / l * 0.9]; this.owner = att; this.deflected = true;
    return true;
  }
  tick() {
    this.savePrev(); this.age++;
    if (this.age > 300) { this.dead = true; return; }
    const g = this.game, v = this.vel, steps = 4;
    const ents = g.entities.concat([g.player]); // (once a tick: it copied the whole list at each of its 4 steps)
    for (let s = 0; s < steps; s++) {
      const nx = this.pos[0] + v[0] / steps, ny = this.pos[1] + v[1] / steps, nz = this.pos[2] + v[2] / steps;
      for (const e of ents) {
        if (e === this || e === this.owner || e.dead || !(e instanceof Living) || e.deathTime > 0) continue;
        if (this.owner instanceof Ghast && e instanceof Ghast) continue;
        const b = e.box(), r = this.w / 2;
        if (nx > b[0] - r && nx < b[3] + r && ny > b[1] - r && ny < b[4] + r && nz > b[2] - r && nz < b[5] + r) { this.impact(e); return; }
      }
      const id = this.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (id && BLOCKS[id].solid) { this.impact(null, [Math.floor(nx), Math.floor(ny), Math.floor(nz)]); return; }
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    if (this.age % 2 === 0) g.particles.spawn('smoke', this.pos[0], this.pos[1] + this.h / 2, this.pos[2], 0, 0.01, 0);
  }
  impact(e, block) {
    const g = this.game;
    this.dead = true;
    if (this.small) {
      if (e) { if (!e.fireproof) { e.hurt(5, { type: 'fireball', attacker: this.owner, knockFrom: this.pos }); e.fire = Math.max(e.fire || 0, 100); } }
      else if (block) {
        const px = Math.floor(this.pos[0]), py = Math.floor(this.pos[1]), pz = Math.floor(this.pos[2]);
        if (this.world.getBlock(px, py, pz) === 0 && SOLIDCUBE[this.world.getBlock(px, py - 1, pz)]) this.world.setBlock(px, py, pz, 171, 0);
      }
      Sound.ev('block.fire.extinguish', this.pos, 0.3, 1.5);
      return;
    }
    if (e && this.owner && e !== this.owner) e.hurt(6, { type: 'fireball', attacker: this.owner, knockFrom: this.pos });
    if (e instanceof Ghast && this.deflected && this.owner === g.player) { e.hurt(1000, { type: 'fireball', attacker: g.player, player: true }); g.grant('return_sender'); }
    g.explode(this.pos[0], this.pos[1] + 0.5, this.pos[2], 1, this.owner && this.owner.T ? this.owner : null, false, true);
  }
}

class DragonFireball extends Entity {
  constructor(g, x, y, z, vel, owner) { super(g, x, y, z, 1, 1); this.vel = vel; this.owner = owner; }
  tick() {
    this.savePrev(); this.age++;
    if (this.age > 300) { this.dead = true; return; }
    const g = this.game, v = this.vel;
    for (let s = 0; s < 4; s++) {
      const nx = this.pos[0] + v[0] / 4, ny = this.pos[1] + v[1] / 4, nz = this.pos[2] + v[2] / 4;
      const p = g.player, b = p.box();
      const hitP = nx > b[0] - 0.5 && nx < b[3] + 0.5 && ny > b[1] - 0.5 && ny < b[4] + 0.5 && nz > b[2] - 0.5 && nz < b[5] + 0.5;
      const id = this.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (hitP || (id && BLOCKS[id].solid) || ny < 0) { this.burst(); return; }
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    const pp = g.particles.spawn('breath', this.pos[0], this.pos[1], this.pos[2], (Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05);
  }
  burst() {
    this.dead = true;
    const g = this.game;
    let y = this.pos[1];
    const fx = Math.floor(this.pos[0]), fz = Math.floor(this.pos[2]);
    for (let k = 0; k < 8 && y > 1 && !BLOCKS[this.world.getBlock(fx, Math.floor(y - 0.5), fz)].solid; k++) y -= 1;
    g.addEntity(new AreaCloud(g, this.pos[0], Math.floor(y), this.pos[2], 3, 200, this.owner));
    Sound.ev('entity.dragon_fireball.explode', this.pos, 1, 1);
  }
}

class AreaCloud extends Entity {
  constructor(g, x, y, z, r, life, owner) { super(g, x, y, z, r * 2, 0.5); this.radius = r; this.life = life; this.owner = owner; }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, k = 1 - this.age / this.life, r = this.radius * (0.5 + 0.5 * k);
    if (this.age >= this.life) { this.dead = true; return; }
    for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; g.particles.spawn('breath', this.pos[0] + Math.cos(a) * d, this.pos[1] + 0.1, this.pos[2] + Math.sin(a) * d, 0, 0.02, 0); }
    if (this.age % 20 === 0) {
      const p = g.player;
      if (Math.hypot(p.pos[0] - this.pos[0], p.pos[2] - this.pos[2]) < r && Math.abs(p.pos[1] - this.pos[1]) < 2) p.hurt(4, { type: 'magic', attacker: this.owner });
    }
  }
}

class ThrownPearl extends Entity {
  constructor(g, x, y, z, vel, owner) { super(g, x, y, z, 0.25, 0.25); this.vel = vel; this.owner = owner; }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, v = this.vel, steps = Math.max(1, Math.ceil(Math.hypot(v[0], v[1], v[2]) / 0.3));
    for (let s = 0; s < steps; s++) {
      const nx = this.pos[0] + v[0] / steps, ny = this.pos[1] + v[1] / steps, nz = this.pos[2] + v[2] / steps;
      let hit = null;
      for (const e of g.entities) {
        if (e === this || !(e instanceof Living) || e.deathTime > 0) continue;
        const b = e.box();
        if (nx > b[0] && nx < b[3] && ny > b[1] && ny < b[4] && nz > b[2] && nz < b[5]) { hit = e; break; }
      }
      const id = this.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (hit || (id && BLOCKS[id].solid) || ny < -60) {
        if (hit) hit.hurt(0.01, { type: 'pearl', attacker: this.owner });
        this.land(); return;
      }
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    v[0] *= 0.99; v[1] = v[1] * 0.99 - 0.03; v[2] *= 0.99;
    if (this.age % 2 === 0) g.particles.spawn('portal', this.pos[0], this.pos[1], this.pos[2], 0, 0, 0);
  }
  land() {
    this.dead = true;
    const g = this.game, p = this.owner;
    particleBurst(g, 'portal', this.pos[0], this.pos[1], this.pos[2], 32, 1);
    if (p !== g.player || p.deathTime > 0 || this.pos[1] < -60) return;
    // back off from the surface a little so the player doesn't end up inside a block
    p.pos = [this.pos[0] - this.vel[0] * 0.3, this.pos[1] - Math.max(0, this.vel[1]) * 0.3, this.pos[2] - this.vel[2] * 0.3];
    let guard = 0;
    while (p.collides(p.box()) && guard++ < 4) p.pos[1] += 0.5;
    p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
    if (!p.creative) p.hurt(5, { type: 'fall' });
    Sound.ev('entity.enderman.teleport', p.pos, 1, 1);
  }
}

class EyeOfEnder extends Entity {
  constructor(g, x, y, z, tx, tz) {
    super(g, x, y, z, 0.25, 0.25);
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
    if (d > 12) { this.tx = x + dx / d * 12; this.tz = z + dz / d * 12; this.ty = y + 8; }
    else { this.tx = tx; this.tz = tz; this.ty = y; }
    this.survive = Math.random() > 0.2;
    Sound.ev('entity.ender_eye.launch', this.pos, 1, 1);
  }
  tick() {
    this.savePrev(); this.age++;
    const g = this.game, v = this.vel;
    const dx = this.tx - this.pos[0], dz = this.tz - this.pos[2], hd = Math.hypot(dx, dz);
    let sp = Math.hypot(v[0], v[2]);
    const tsp = lerp(sp, hd, 0.0025);
    let vy = v[1];
    if (hd < 1) { sp *= 0.8; vy *= 0.8; }
    const a = Math.atan2(dz, dx);
    v[0] = Math.cos(a) * Math.max(tsp, 0.05); v[2] = Math.sin(a) * Math.max(tsp, 0.05);
    v[1] = vy + ((this.pos[1] < this.ty ? 1 : -1) - vy) * 0.015;
    this.pos[0] += v[0]; this.pos[1] += v[1]; this.pos[2] += v[2];
    for (let i = 0; i < 2; i++) g.particles.spawn('portal', this.pos[0] - v[0] * 0.25 + (Math.random() - 0.5) * 0.2, this.pos[1] - v[1] * 0.25 - 0.2, this.pos[2] - v[2] * 0.25 + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1);
    if (this.age > 80) {
      this.dead = true;
      Sound.ev('entity.ender_eye.death', this.pos, 1, 1);
      if (this.survive) g.dropItem(this.pos[0], this.pos[1], this.pos[2], makeStack('ender_eye', 1), [0, 0.1, 0]);
      else { particleBurst(g, 'portal', this.pos[0], this.pos[1], this.pos[2], 20, 0.5); Sound.block('break', 'glass', this.pos); }
    }
  }
}

// ---- End crystal ---------------------------------------------------------------------------------
class EndCrystal extends Entity {
  constructor(g, x, y, z) { super(g, x, y, z, 2, 2); this.hittable = true; this.spin = Math.random() * 100; this.showBase = true; this.type = 'end_crystal'; this.persistent = true; }
  tick() { this.savePrev(); this.age++; }
  hurt(a, src) {
    if (this.dead) return false;
    this.dead = true;
    const g = this.game;
    const dragon = g.entities.find(e => e instanceof EnderDragon && e.healer === this);
    g.explode(this.pos[0], this.pos[1] + 0.5, this.pos[2], 6, this, false, false, true);
    if (dragon) { dragon.healer = null; dragon.hurtRaw(10, { type: 'explosion', attacker: src && src.attacker }); }
    return true;
  }
}

// ---- Ender Dragon --------------------------------------------------------------------------------
class EnderDragon extends Living {
  constructor(g, x, y, z) {
    super(g, x, y, z, 8, 4, 200);
    this.type = 'ender_dragon'; this.T = { cn: '末影龙', hostile: true, drops: [], model: 'dragon' };
    this.noClip = true; this.persistent = true; this.fireproof = true; this.alwaysTick = true;
    this.phase = 'circle'; this.phaseT = 0; this.circleA = Math.random() * Math.PI * 2; this.circleDir = 1;
    this.hist = []; this.flap = 0; this.prevFlap = 0; this.healer = null; this.perchDamage = 0;
    this.yaw = 0; this.pitchD = 0; this.speed = 0.6; this.stepHeight = 0;
  }
  box() { return [this.pos[0] - 4, this.pos[1], this.pos[2] - 4, this.pos[0] + 4, this.pos[1] + 4, this.pos[2] + 4]; }
  // hit boxes: head (full damage), body, wings, tail (quarter damage)
  parts() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), x = this.pos[0], y = this.pos[1], z = this.pos[2];
    const at = (fwd, side, up, hw, hh) => [x - s * fwd + c * side - hw, y + up, z - c * fwd - s * side - hw, x - s * fwd + c * side + hw, y + up + hh, z - c * fwd - s * side + hw];
    const hp = this.headPos || [x - s * 6.5, y + 2, z - c * 6.5];
    return [
      { box: [hp[0] - 1, hp[1] - 0.5, hp[2] - 1, hp[0] + 1, hp[1] + 1.5, hp[2] + 1], mult: 1, head: true },
      { box: at(0, 0, 0.5, 2.5, 3), mult: 0.25 },
      { box: at(0, 4.5, 2, 2, 2), mult: 0.25 }, { box: at(0, -4.5, 2, 2, 2), mult: 0.25 },
      { box: at(-7, 0, 1.5, 1.5, 2), mult: 0.25 }, { box: at(-11, 0, 1.5, 1.2, 2), mult: 0.25 },
    ];
  }
  hurtPart(part, amount, src) {
    if (this.deathTime > 0) return false;
    let a = part.head ? amount : amount * 0.25 + 1;
    if (src && src.type !== 'explosion' && !(src.attacker === this.game.player || src.player)) return false;
    if (this.phase === 'perch') this.perchDamage += a;
    return this.hurtRaw(a, src);
  }
  hurt(a, src) { return this.hurtPart({ mult: 0.25 }, a, src); }
  hurtRaw(a, src) {
    if (this.deathTime > 0) return false;
    if (this.invuln > 10) return false;
    this.invuln = 20; this.hurtTime = 10;
    this.health -= a;
    Sound.ev('entity.ender_dragon.hurt', this.pos, 5, 1);
    if (this.phase === 'perch' && this.perchDamage > 50) this.setPhase('takeoff');
    if (this.health <= 0) { this.health = 0; this.deathTime = 1; Sound.ev('entity.ender_dragon.death', this.pos, 10, 1); }
    return true;
  }
  setPhase(ph) { this.phase = ph; this.phaseT = 0; if (ph === 'perch') this.perchDamage = 0; }
  perchPoint() { const w = this.world; return [0.5, (w.endTop0 || 60) + 5.5, 0.5]; }
  tick() {
    this.savePrev();
    this.age++;
    if (this.invuln > 0) this.invuln--;
    if (this.hurtTime > 0) this.hurtTime--;
    this.prevFlap = this.flap;
    const g = this.game, p = g.player;
    this.hist.unshift([this.pos[0], this.pos[1], this.pos[2], this.yaw]);
    if (this.hist.length > 64) this.hist.length = 64;
    if (this.deathTime > 0) {
      this.deathTime++;
      this.pos[1] += 0.1; this.flap += 0.02;
      if (this.deathTime > 150 && this.deathTime % 5 === 0) particleBurst(g, 'explosion', this.pos[0], this.pos[1], this.pos[2], 2, 8);
      if (this.deathTime >= 200) { this.dead = true; g.onDragonKilled(this); }
      return;
    }
    // crystal healing
    if (this.age % 10 === 0) {
      if (!this.healer || this.healer.dead) {
        this.healer = null; let bd = 32;
        for (const e of g.entities) if (e instanceof EndCrystal && !e.dead) { const d = e.distTo(this); if (d < bd) { bd = d; this.healer = e; } }
      }
      if (this.healer && this.healer.distTo(this) > 40) this.healer = null;
      if (this.healer && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
    }
    const sp = this.flapSpeed();
    this.flap += sp;
    if (Math.floor(this.flap) !== Math.floor(this.prevFlap)) Sound.ev('entity.ender_dragon.flap', this.pos, 5, 0.8 + Math.random() * 0.3);
    if (this.age % 200 === 0 && Math.random() < 0.5) Sound.ev('entity.ender_dragon.growl', this.pos, 5, 0.8 + Math.random() * 0.3);
    const playerOk = p.deathTime === 0 && !p.creative && g.dim === 'end';
    this.phaseT++;
    let target, speed = 0.6;
    let crystals = 0; for (const e of g.entities) if (e instanceof EndCrystal && !e.dead) crystals++; // (counted, not a new list each tick)
    switch (this.phase) {
      case 'circle': {
        this.circleA += 0.008 * this.circleDir;
        const R = 70;
        target = [Math.cos(this.circleA) * R, 95 + Math.sin(this.circleA * 3) * 10, Math.sin(this.circleA) * R];
        // (landing does not wait for a player to attack - vanilla's holding pattern lands for anyone, creative
        // too; here it never came down for a creative player, "末影龙一直在天上飞都不下来", feedback 2026-11-01/02)
        if (this.phaseT > 60 && this.age % 20 === 0) {
          const r = Math.random();
          if (r < 1 / (crystals + 3)) this.setPhase('land');
          else if (!playerOk) { }
          else if (r < 0.25) this.setPhase('strafe');
          else if (r < 0.32) this.setPhase('charge');
          else if (r < 0.34) this.circleDir *= -1;
        }
        break;
      }
      case 'strafe': {
        if (!playerOk) { this.setPhase('circle'); break; }
        target = [p.pos[0], Math.max(p.pos[1] + 18, 75), p.pos[2]];
        const d = Math.hypot(p.pos[0] - this.pos[0], p.pos[2] - this.pos[2]);
        const look = [-Math.sin(this.yaw), -Math.cos(this.yaw)], to = [(p.pos[0] - this.pos[0]) / d, (p.pos[2] - this.pos[2]) / d];
        if (d < 64 && look[0] * to[0] + look[1] * to[1] > 0.85 && this.phaseT > 20) {
          const hp = this.headPos || this.pos;
          const ex = p.pos[0] - hp[0], ey = p.pos[1] + 1 - hp[1], ez = p.pos[2] - hp[2], l = Math.hypot(ex, ey, ez);
          g.addEntity(new DragonFireball(g, hp[0], hp[1], hp[2], [ex / l * 1.2, ey / l * 1.2, ez / l * 1.2], this));
          Sound.ev('entity.ender_dragon.shoot', this.pos, 5, 1);
          this.setPhase('circle');
        }
        if (this.phaseT > 300) this.setPhase('circle');
        break;
      }
      case 'charge':
        if (!playerOk) { this.setPhase('circle'); break; }
        target = [p.pos[0], p.pos[1] + 1, p.pos[2]]; speed = 1.0;
        if (this.distTo(p) < 6 || this.phaseT > 120) this.setPhase('circle');
        break;
      case 'land': {
        target = this.perchPoint(); speed = 0.5;
        const d = Math.hypot(target[0] - this.pos[0], target[1] - this.pos[1], target[2] - this.pos[2]);
        if (d < 3) this.setPhase('perch');
        if (this.phaseT > 500) this.setPhase('circle');
        break;
      }
      case 'perch': {
        target = this.perchPoint(); speed = 0.1;
        if (playerOk) { const dx = p.pos[0] - this.pos[0], dz = p.pos[2] - this.pos[2]; this.wantYaw = Math.atan2(-dx, -dz); }
        if (this.phaseT % 50 === 25 && playerOk && this.distTo(p) < 24) {
          const hp = this.headPos || this.pos, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
          let gy = Math.floor(hp[1]);
          while (gy > 1 && !BLOCKS[this.world.getBlock(Math.floor(hp[0] + fx * 2), gy - 1, Math.floor(hp[2] + fz * 2))].solid) gy--;
          g.addEntity(new AreaCloud(g, hp[0] + fx * 3, gy, hp[2] + fz * 3, 3.5, 60, this));
          Sound.ev('entity.ender_dragon.growl', this.pos, 5, 1);
        }
        if (this.phaseT > 320) this.setPhase('takeoff');
        break;
      }
      case 'takeoff':
        target = [this.pos[0] - Math.sin(this.yaw) * 20, 105, this.pos[2] - Math.cos(this.yaw) * 20];
        if (this.pos[1] > 95 || this.phaseT > 100) this.setPhase('circle');
        break;
    }
    // (strafe and charge give up on a player who died, went creative or left: back to circling - with no target for
    // that tick, the steering below threw 'reading 0', telemetry 11-02/03: ~58 devices. The circle's point instead)
    if (!target) target = [Math.cos(this.circleA) * 70, 95 + Math.sin(this.circleA * 3) * 10, Math.sin(this.circleA) * 70];
    // steering
    const dx = target[0] - this.pos[0], dy = target[1] - this.pos[1], dz = target[2] - this.pos[2], d = Math.hypot(dx, dy, dz) || 1;
    if (this.phase === 'perch') {
      this.vel = [dx * 0.1, dy * 0.1, dz * 0.1];
      if (this.wantYaw !== undefined) { let dyaw = this.wantYaw - this.yaw; while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2; this.yaw += clamp(dyaw, -0.05, 0.05); }
    } else {
      const want = Math.atan2(-dx, -dz);
      let dyaw = want - this.yaw; while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      // damped turning: angular velocity eases in and out, so turns become smooth arcs
      const hs = Math.hypot(this.vel[0], this.vel[2]) + 1, turnSpeed = 0.7 / Math.min(hs, 40) / hs;
      this.yawVel = (this.yawVel || 0) * 0.8 + clamp(dyaw * 180 / Math.PI, -50, 50) * turnSpeed;
      this.yaw += this.yawVel * 0.1 * Math.PI / 180;
      const fwd = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
      const turn = Math.abs(dyaw) > 1 ? 0.5 : 1;
      this.vel[0] += (fwd[0] * speed * turn - this.vel[0]) * 0.08;
      this.vel[2] += (fwd[1] * speed * turn - this.vel[2]) * 0.08;
      this.vel[1] += (clamp(dy / d, -0.6, 0.6) * speed - this.vel[1]) * 0.08;
    }
    this.pos[0] += this.vel[0]; this.pos[1] += this.vel[1]; this.pos[2] += this.vel[2];
    this.pitchD = lerp(this.pitchD, clamp(this.vel[1] * 0.8, -0.6, 0.6), 0.1);
    // head position (used for hit boxes and breath)
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const headDrop = this.phase === 'perch' ? -2.5 : 0;
    this.headPos = [this.pos[0] - s * 7, this.pos[1] + 2 + headDrop + this.pitchD * 3, this.pos[2] - c * 7];
    // contact damage & knockback
    if (playerOk && p.invuln <= 0) {
      for (const part of this.parts()) {
        const b = part.box, pb = p.box();
        if (pb[0] < b[3] && pb[3] > b[0] && pb[1] < b[4] && pb[4] > b[1] && pb[2] < b[5] && pb[5] > b[2]) {
          if (part.head) p.hurt(10, { type: 'mob', attacker: this, knockFrom: this.pos, knock: 1 });
          else if (this.phase !== 'perch') { const kx = p.pos[0] - this.pos[0], kz = p.pos[2] - this.pos[2], kl = Math.hypot(kx, kz) || 1; p.vel[0] += kx / kl * 2; p.vel[2] += kz / kl * 2; p.vel[1] = 0.6; p.hurt(5, { type: 'mob', attacker: this }); }
          break;
        }
      }
    }
    // destroy soft blocks the body flies through
    if (this.phase !== 'perch' && this.age % 2 === 0) {
      let n = 0;
      const b = this.parts()[1].box;
      for (let x = Math.floor(b[0]); x <= Math.floor(b[3]) && n < 12; x++) for (let y = Math.floor(b[1]); y <= Math.floor(b[4]) && n < 12; y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]) && n < 12; z++) {
        const id = this.world.getBlock(x, y, z);
        if (id && ![172, 28, 6, 174, 175, 176, 180, 21].includes(id) && !IS_FLUID[id]) { this.world.setBlock(x, y, z, 0, 0); n++; g.particles.blockBreak(x, y, z, id, 0); }
      }
      if (n) Sound.explode(this.pos);
    }
  }
  // slow, heavy wingbeats when flying fast; quicker while hovering or perched; faster when climbing
  flapSpeed() {
    if (this.phase === 'perch') return 0.1;
    return 0.2 / (Math.hypot(this.vel[0], this.vel[2]) * 10 + 1) * Math.pow(2, this.vel[1]);
  }
}
