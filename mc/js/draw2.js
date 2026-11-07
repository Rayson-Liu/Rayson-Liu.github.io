'use strict';
// ---------------------------------------------------------------------------
// Drawing for the Ender Dragon and End crystals
// ---------------------------------------------------------------------------
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

// The dragon's neck and tail follow its own recent flight path: each segment takes the yaw/height the
// body had a few ticks earlier (neck: recent, tail: older), so it snakes through turns, banks and dives.
const wrapA = (d) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
EnderDragon.prototype.latency = function (i, a) {
  // [yaw, y] i ticks ago, interpolated with the partial tick
  const h = this.hist, cur = i === 0 ? [this.yaw, this.pos[1]] : h[Math.min(i - 1, h.length - 1)] ? [h[Math.min(i - 1, h.length - 1)][3], h[Math.min(i - 1, h.length - 1)][1]] : [this.yaw, this.pos[1]];
  const o = h[Math.min(i, h.length - 1)], old = o ? [o[3], o[1]] : cur;
  return [old[0] + wrapA(cur[0] - old[0]) * a, lerp(old[1], cur[1], a)];
};
Game.prototype.drawDragon = function (e, ip, a, env) {
  const r = this.renderer, gl = r.gl, D = r.dragon;
  const f = lerp(e.prevFlap, e.flap, a), fr = f * Math.PI * 2;
  const sitting = e.phase === 'perch';
  const landing = e.phase === 'land' || e.phase === 'takeoff';
  const L = e.lightAt(); L[0] = Math.max(L[0], 0.8);
  const dying = e.deathTime > 0;
  const opts = { overlay: e.hurtTime > 0 ? [1, 0, 0, 0.35] : dying ? [1, 1, 1, Math.min(0.85, e.deathTime / 220)] : null };
  const lat = (i) => e.latency(i, a);
  const l5 = lat(5), l6 = lat(6), l10 = lat(10);
  const turn = wrapA(l5[0] - l10[0]);            // recent turn rate -> banking
  const midYaw = l5[0] + turn / 2;
  const climb = l5[1] - l10[1];                   // recent climb -> body pitch
  // body bob with the wingbeat
  let bob = Math.sin(fr - 1) + 1; bob = (bob * bob + bob * 2) * 0.05;
  const base = M4.create();
  M4.translate(base, ip[0], ip[1] + 2.75 + bob * 0.5, ip[2]);
  M4.rotY(base, lat(7)[0]);
  M4.rotX(base, clamp(climb * 10 * Math.PI / 180, -0.7, 0.7) + bob * 2 * Math.PI / 180);
  M4.translate(base, 0, 0, -1.5);
  // the body and everything on it banks around a point one block up
  const body = M4.copy(base);
  M4.translate(body, 0, 1, 0); M4.rotZ(body, clamp(turn * 1.5, -0.8, 0.8)); M4.translate(body, 0, -1, 0);
  const at = (m, x, y, z) => { const c = M4.copy(m); M4.translate(c, x / 16, y / 16, z / 16); return c; };
  const draw = (mesh, m) => r.drawPart(mesh, 'dragon', m, L, env, opts);
  gl.disable(gl.CULL_FACE);
  // pitch of a neck part: height difference along the path, or bowed down while perched
  const partPitch = (i, hp) => {
    let d;
    if (landing) { const dist = Math.hypot(e.pos[0], e.pos[2]); d = i / Math.max(dist / 4, 1); return -d * 7.5 * Math.PI / 180; }
    if (sitting) return -i * 7.5 * Math.PI / 180;
    if (i === 6) return 0;
    return (hp[1] - l6[1]) * 7.5 * Math.PI / 180;
  };
  // neck: 5 segments, each 10px along its own direction
  let px = 0, py = -16, pz = -12;
  for (let i = 0; i < 5; i++) {
    const h = lat(5 - i);
    const yaw = wrapA(h[0] - l6[0]) * 1.5, pitch = Math.cos(i * 0.45 + fr) * 0.15 + clamp(partPitch(i, h), -1.2, 1.2);
    const m = at(base, px, py, pz); M4.rotY(m, yaw); M4.rotX(m, pitch); M4.rotZ(m, -wrapA(h[0] - midYaw) * 1.5);
    draw(D.seg, m);
    py += Math.sin(pitch) * 10; pz -= Math.cos(yaw) * Math.cos(pitch) * 10; px -= Math.sin(yaw) * Math.cos(pitch) * 10;
  }
  // head + jaw
  const h0 = lat(0);
  const head = at(base, px, py, pz);
  M4.rotY(head, wrapA(h0[0] - l6[0])); M4.rotX(head, clamp(partPitch(6, h0), -1.2, 1.2)); M4.rotZ(head, -wrapA(h0[0] - midYaw));
  draw(D.head, head);
  const jaw = at(head, 0, -4, -14);
  M4.rotX(jaw, -(Math.sin(fr) + 1) * 0.2);
  draw(D.jaw, jaw);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthFunc(gl.LEQUAL);
  r.drawPart(D.head, 'dragon_eyes', head, [1, 1], env, { bright: true });
  gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
  // body
  draw(D.body, body);
  // wings: big slow beats, the tip trailing the main wing
  for (const side of [1, -1]) {
    const wm = at(body, 12 * side, -1, 2);
    if (side < 0) M4.scale(wm, -1, 1, 1);
    M4.rotZ(wm, (Math.sin(fr) + 0.125) * 0.8); M4.rotY(wm, -0.25); M4.rotX(wm, -(0.125 - Math.cos(fr) * 0.2));
    draw(D.wing, wm);
    const tm = at(wm, 56, 0, 0);
    M4.rotZ(tm, -(Math.sin(fr + 2) + 0.5) * 0.75);
    draw(D.tip, tm);
  }
  // legs tucked back, swinging slightly with the bob
  for (const side of [1, -1]) {
    const fl = at(body, 12 * side, -16, 2); M4.rotX(fl, -(1.3 + bob * 0.1)); draw(D.fleg, fl);
    const ft = at(fl, 0, -20, -1); M4.rotX(ft, 0.5 + bob * 0.1); draw(D.ftip, ft);
    const ff = at(ft, 0, -23, 0); M4.rotX(ff, -(0.75 + bob * 0.1)); draw(D.ffoot, ff);
    const rl = at(body, 16 * side, -12, 42); M4.rotX(rl, -(1.0 + bob * 0.1)); draw(D.rleg, rl);
    const rt = at(rl, 0, -32, -4); M4.rotX(rt, -(0.5 + bob * 0.1)); draw(D.rtip, rt);
    const rf = at(rt, 0, -31, 4); M4.rotX(rf, -(0.75 + bob * 0.1)); draw(D.rfoot, rf);
  }
  // tail: 12 segments trailing behind, using older parts of the path
  const l11 = lat(11);
  let tx = 0, ty = -6, tz = 60, wave = 0;
  for (let k = 0; k < 12; k++) {
    const h = lat(12 + k);
    wave += Math.sin(k * 0.45 + fr) * 0.05;
    const yaw = Math.PI + wrapA(h[0] - l11[0]) * 1.5, pitch = wave + clamp((h[1] - l11[1]) * 7.5 * Math.PI / 180, -1, 1);
    const m = at(base, tx, ty, tz); M4.rotY(m, yaw); M4.rotX(m, pitch); M4.rotZ(m, wrapA(h[0] - midYaw) * 1.5);
    draw(D.seg, m);
    ty += Math.sin(pitch) * 10; tz -= Math.cos(yaw) * Math.cos(pitch) * 10; tx -= Math.sin(yaw) * Math.cos(pitch) * 10;
  }
  gl.enable(gl.CULL_FACE);
  if (dying) r.drawRays([ip[0], ip[1] + 2.5, ip[2]], e.deathTime + a, 30, 4242);
};

Game.prototype.drawCrystal = function (e, ip, a, env) {
  const r = this.renderer, gl = r.gl;
  const t = e.age + a + e.spin;
  let bob = Math.sin(t * 0.2) / 2 + 0.5; bob = (bob * bob + bob) * 0.4 - 1.4;
  const L = [1, 1];
  if (e.showBase) { const m = M4.create(); M4.translate(m, ip[0], ip[1], ip[2]); M4.scale(m, 2, 2, 2); r.drawPart(r.models.crystal_base.parts[0].mesh, 'end_crystal', m, L, env, { bright: true }); }
  const c = [ip[0], ip[1] + 1.2 + bob * 0.5 + 0.6, ip[2]];
  const spin = t * 3 * Math.PI / 180;
  gl.disable(gl.CULL_FACE);
  let s = 2;
  const parts = [[r.models.crystal_glass, 'end_crystal'], [r.models.crystal_glass, 'end_crystal'], [r.models.crystal_core, 'end_crystal']];
  parts.forEach(([mdl, tex], i) => {
    const m = M4.create(); M4.translate(m, c[0], c[1], c[2]);
    M4.rotY(m, spin * (i % 2 ? -1 : 1)); M4.rotX(m, 0.785); M4.rotZ(m, 0.615);
    M4.scale(m, s, s, s);
    r.drawPart(mdl.parts[0].mesh, tex, m, L, env, { bright: true });
    s *= 0.875;
  });
  gl.enable(gl.CULL_FACE);
  const dr = this.dragon(), bt = e.beamTarget;
  // a beam to a block (the server's beam_target: respawning the dragon, the exit portal's pillars): to its centre
  if (bt) r.drawBeam([c[0], c[1], c[2]], [bt[0] + 0.5, bt[1] + 0.5, bt[2] + 0.5], 'end_crystal_beam', 0.35, [1, 0.8, 1, 1], -(this.worldTime + a) * 0.05);
  if (dr && dr.healer === e && dr.deathTime === 0) {
    const di = dr.ipos(a);
    r.drawBeam([c[0], c[1], c[2]], [di[0], di[1] + 2.5, di[2]], 'end_crystal_beam', 0.35, [1, 0.8, 1, 1], -(this.worldTime + a) * 0.05);
  }
};

// the small mob spinning inside each nearby spawner (vanilla SpawnerRenderer)
Game.prototype.drawSpawners = function (a, env) {
  const p = this.player, w = this.world, px = Math.floor(p.pos[0]), pz = Math.floor(p.pos[2]);
  const r = this.renderer, dist = Math.min(64, r.renderDist * 16);
  this.spawnerDummies = this.spawnerDummies || {};
  this.spawnerSpin = this.spawnerSpin || new Map();
  for (let cx = (px - dist) >> 4; cx <= (px + dist) >> 4; cx++) for (let cz = (pz - dist) >> 4; cz <= (pz + dist) >> 4; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    if (!ch.spawners) { ch.spawners = []; ch.findAll([127], (i) => ch.spawners.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)])); }
    for (const s of ch.spawners) {
      const [x, y, z] = s;
      if (w.getBlock(x, y, z) !== 127) continue;
      if (!aabbInFrustum(r.planes, x, y, z, x + 1, y + 1, z + 1)) continue;
      const type = SPAWNER_MOBS[w.getMeta(x, y, z) & 3];
      let d = this.spawnerDummies[type];
      if (!d) { d = this.spawnerDummies[type] = createMob(this, type, 0, 0, 0); d.displayMatrix = null; }
      // spin speeds up as the next spawn approaches, and only while a player is in range
      const k = s.join(','), sp = this.spawnerSpin.get(k) || { spin: 0, prev: 0, t: -1 };
      const near = Math.hypot(x + 0.5 - p.pos[0], y + 0.5 - p.pos[1], z + 0.5 - p.pos[2]) <= 16;
      if (sp.t !== this.tickCount) {
        const ticks = sp.t < 0 ? 0 : Math.min(20, this.tickCount - sp.t);
        sp.t = this.tickCount; sp.prev = sp.spin;
        if (near) { const left = (this.spawnerT && this.spawnerT.get(k)) || 200; sp.spin += ticks * 1000 / (Math.max(0, left) + 200) * Math.PI / 180; }
        this.spawnerSpin.set(k, sp);
      }
      const spin = lerp(sp.prev, sp.spin, a);
      let sc = 0.53125; const big = Math.max(d.w, d.h); if (big > 1) sc /= big;
      const m = M4.create();
      M4.translate(m, x + 0.5, y + 0.4, z + 0.5); M4.rotY(m, spin);
      M4.translate(m, 0, -0.2, 0); M4.rotX(m, -30 * Math.PI / 180); M4.scale(m, sc, sc, sc);
      // light from the air above: the spawner block itself may block light
      d.pos = [x + 0.5, y + 1.1, z + 0.5]; const L = d.lightAt();
      d.displayMatrix = m; d.age = this.tickCount; d.hurtTime = 0; d.fire = 0;
      this.drawMob(d, d.pos, a, env, L);
      d.displayMatrix = null;
    }
  }
};

// chests are block entities: drawn as models so the lid can open
const CHEST_ROT = { 5: 0, 1: Math.PI / 2, 4: Math.PI, 0: -Math.PI / 2 }; // front face -> rotation of the south-facing model
Game.prototype.tickChestLids = function () {
  for (const k of this.openChests) if (!this.chestLids.has(k)) this.chestLids.set(k, { o: 0, prev: 0 });
  for (const [k, l] of this.chestLids) {
    l.prev = l.o;
    const [x, y, z] = k.split(',').map(Number), m = this.world.getMeta(x, y, z), s = chestSeam(m);
    const open = this.openChests.has(k) || (s && this.openChests.has(`${x + s[0]},${y},${z + s[1]}`));
    l.o = clamp(l.o + (open ? 0.1 : -0.1), 0, 1);
    if (!open && l.o === 0 && l.prev === 0) this.chestLids.delete(k);
  }
};
// drawing them: blockents.js (with the other block entities)
