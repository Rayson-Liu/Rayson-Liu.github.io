'use strict';
// ---------------------------------------------------------------------------
// Redstone in single player, by vanilla's rules: signal strength 0-15, strong and weak power (a solid block
// powered by dust powers the components next to it but not other dust), quasi-connectivity for pistons,
// dispensers and droppers, scheduled ticks (repeaters, torches, comparators, observers, buttons).
//   sources:    lever, buttons, pressure plates, redstone block, redstone torch, daylight detector, observer,
//               target, trapped chest, detector rail, tripwire hooks
//   wire:       redstone dust (power in its block id, blocks.js WIRE_ID; connections in its meta, dot / cross)
//   components: repeater (delay, locking), comparator (compare / subtract, containers and other readable blocks)
//   powered:    redstone lamp, doors, trapdoors, fence gates, TNT, note block, bell, copper bulb, powered and
//               activator rails, pistons and sticky pistons (slime and honey blocks), dispenser, dropper, hopper
//               (locked when powered), crafter
// A direction given to a signal function is vanilla's: the way from the block asking to the block that answers.
// ---------------------------------------------------------------------------
const RS_DIRS = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
const RS_DN = ['down', 'up', 'north', 'south', 'west', 'east'], RS_H = ['north', 'south', 'west', 'east'];
const RS_OPP = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };
const RS_CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const FACE_NAME = ['west', 'east', 'down', 'up', 'north', 'south']; // the game's face index -> vanilla direction
const rsKey = (x, y, z) => x + ',' + y + ',' + z;
const prop = (id, m, k) => Features.propOf(id, m, k);
const rsk = (id) => (BLOCKS[id] ? BLOCKS[id].key : '');
const isWire = (id) => !!BLOCKS[id] && BLOCKS[id].wirePower !== undefined;
const wireP = (id) => (BLOCKS[id] && BLOCKS[id].wirePower) || 0;
const RS_PLATE = /pressure_plate$/, RS_BUTTON = /_button$/;

const RS = {
  wires: true,       // false while dust works out its own power (dust doesn't feed dust through blocks)
  mem: new Map(),    // position -> logic state vanilla keeps in the block (comparator output, daylight power, ...)
  queue: [], queued: new Set(), busy: false,
  torchHist: new Map(),
};

// ---- what counts as what ----
const RS_FULL = new Uint8Array(MAX_BLOCKS); // 0 unknown, 1 full solid cube, 2 not
function rsFull(id) {
  if (!id) return false;
  let v = RS_FULL[id];
  if (!v) {
    const b = BLOCKS[id];
    let full = !!SOLIDCUBE[id];
    if (!full && b && b.solid && !b.slab && !b.stairs && !b.fence && b.shape !== SH_CROSS) {
      try { const bx = b.boxes ? b.boxes(0) : null; full = !!bx && bx.length === 1 && bx[0][0] <= 0 && bx[0][1] <= 0 && bx[0][2] <= 0 && bx[0][3] >= 16 && bx[0][4] >= 16 && bx[0][5] >= 16; } catch (e) { full = false; }
    }
    RS_FULL[id] = v = full ? 1 : 2;
  }
  return v === 1;
}
// conducts power: solid full blocks, but not the ones vanilla excludes
const RS_NONCOND = /^(redstone_block|observer|piston|sticky_piston|piston_head|moving_piston|slime_block|honey_block|daylight_detector|target_never|glass|.*_glass|ice|.*_leaves|tnt_never|soul_sand|mud|.*_shulker_box|shulker_box)$/;
function conductor(id) { return rsFull(id) && !RS_NONCOND.test(rsk(id)); }
// a block vanilla calls a signal source (dust turns toward these)
const RS_SOURCE = /^(lever|redstone_torch|redstone_wall_torch|redstone_block|repeater|comparator|observer|daylight_detector|target|trapped_chest|detector_rail|tripwire_hook|lectern|sculk_sensor|calibrated_sculk_sensor|lightning_rod)$|_button$|pressure_plate$/;
const rsSource = (id) => RS_SOURCE.test(rsk(id)) || isWire(id);

// ---- signals ----
function attachedDir(id, m) { // direction from the block a lever / button is on, toward it
  const face = prop(id, m, 'face'), f = prop(id, m, 'facing');
  return face === 'floor' ? 'up' : face === 'ceiling' ? 'down' : f;
}
RS.signal = function (g, x, y, z, dir) {
  const w = g.world, id = w.getBlock(x, y, z); if (!id) return 0;
  const m = w.getMeta(x, y, z), k = rsk(id);
  if (isWire(id)) {
    if (!RS.wires || dir === 'down') return 0;
    const p = wireP(id); if (!p) return 0;
    if (dir === 'up') return p;
    const c = prop(id, m, RS_OPP[dir]);
    return c && c !== 'none' ? p : (isDotMeta(id, m) ? 0 : 0);
  }
  if (k === 'lever' || RS_BUTTON.test(k)) return prop(id, m, 'powered') === 'true' ? 15 : 0;
  if (RS_PLATE.test(k)) return k.includes('weighted') ? +prop(id, m, 'power') || 0 : prop(id, m, 'powered') === 'true' ? 15 : 0;
  if (k === 'redstone_torch') return prop(id, m, 'lit') === 'true' && dir !== 'up' ? 15 : 0;
  if (k === 'redstone_wall_torch') return prop(id, m, 'lit') === 'true' && dir !== prop(id, m, 'facing') ? 15 : 0;
  if (k === 'redstone_block') return 15;
  if (k === 'repeater') return prop(id, m, 'powered') === 'true' && prop(id, m, 'facing') === dir ? 15 : 0;
  if (k === 'comparator') return prop(id, m, 'facing') === dir ? (RS.mem.get(rsKey(x, y, z)) || {}).out || 0 : 0;
  if (k === 'observer') return prop(id, m, 'powered') === 'true' && prop(id, m, 'facing') === dir ? 15 : 0;
  if (k === 'daylight_detector') return (RS.mem.get(rsKey(x, y, z)) || {}).power || 0;
  if (k === 'target') { const t = RS.mem.get(rsKey(x, y, z)); return t && t.until > g.tickCount ? t.power : 0; }
  if (k === 'trapped_chest') return g.openChests && g.openChests.has(rsKey(x, y, z)) ? 1 : 0;
  if (k === 'detector_rail') return prop(id, m, 'powered') === 'true' ? 15 : 0;
  if (k === 'tripwire_hook') return prop(id, m, 'powered') === 'true' ? 15 : 0;
  return 0;
};
RS.direct = function (g, x, y, z, dir) {
  const w = g.world, id = w.getBlock(x, y, z); if (!id) return 0;
  const m = w.getMeta(x, y, z), k = rsk(id);
  if (isWire(id)) return RS.signal(g, x, y, z, dir);
  if (k === 'lever' || RS_BUTTON.test(k)) return attachedDir(id, m) === dir ? RS.signal(g, x, y, z, dir) : 0;
  if (RS_PLATE.test(k) || k === 'trapped_chest' || k === 'detector_rail') return dir === 'up' ? RS.signal(g, x, y, z, dir) : 0;
  if (k === 'redstone_torch' || k === 'redstone_wall_torch') return dir === 'down' ? RS.signal(g, x, y, z, dir) : 0;
  if (k === 'repeater' || k === 'comparator' || k === 'observer') return RS.signal(g, x, y, z, dir);
  if (k === 'tripwire_hook') return prop(id, m, 'facing') === dir ? RS.signal(g, x, y, z, dir) : 0;
  return 0;
};
// the strong power going into a block from its neighbours
RS.directInto = function (g, x, y, z) {
  let best = 0;
  for (const d of RS_DN) { const v = RS_DIRS[d], s = RS.direct(g, x + v[0], y + v[1], z + v[2], d); if (s > best) { best = s; if (best >= 15) break; } }
  return best;
};
// Level.getSignal: what a block gives toward a neighbour (a conductor passes on the strong power it receives)
RS.get = function (g, x, y, z, dir) {
  const s = RS.signal(g, x, y, z, dir), id = g.world.getBlock(x, y, z);
  return conductor(id) ? Math.max(s, RS.directInto(g, x, y, z)) : s;
};
RS.has = (g, x, y, z, dir) => RS.get(g, x, y, z, dir) > 0;
// is anything powering this block (from any side)
RS.neighborSignal = function (g, x, y, z) {
  for (const d of RS_DN) { const v = RS_DIRS[d]; if (RS.get(g, x + v[0], y + v[1], z + v[2], d) > 0) return true; }
  return false;
};
RS.bestNeighbor = function (g, x, y, z) {
  let best = 0;
  for (const d of RS_DN) { const v = RS_DIRS[d], s = RS.get(g, x + v[0], y + v[1], z + v[2], d); if (s > best) { best = s; if (best >= 15) break; } }
  return best;
};
// pistons, dispensers, droppers: also powered from the block above them (quasi-connectivity)
RS.qcPowered = function (g, x, y, z, except) {
  for (const d of RS_DN) { if (d === except) continue; const v = RS_DIRS[d]; if (RS.get(g, x + v[0], y + v[1], z + v[2], d) > 0) return true; }
  if (RS.get(g, x, y, z, 'down') > 0) return true; // vanilla also asks the block itself below
  for (const d of RS_DN) { if (d === 'down') continue; const v = RS_DIRS[d]; if (RS.get(g, x + v[0], y + 1 + v[1], z + v[2], d) > 0) return true; }
  return false;
};

// ---- changing state: set a block (lighting, neighbours told) and wake what may care ----
RS.set = function (g, x, y, z, id, m) {
  const w = g.world;
  if (w.getBlock(x, y, z) === id && w.getMeta(x, y, z) === m) return false;
  w.setBlock(x, y, z, id, m);
  RS.wake(x, y, z);
  return true;
};
RS.setProp = function (g, x, y, z, k, v) {
  const w = g.world, id = w.getBlock(x, y, z);
  return RS.set(g, x, y, z, id, Features.withProp(id, w.getMeta(x, y, z), k, v));
};
// a change in power: the neighbours and their neighbours are checked (strong power passes through a block)
RS.wake = function (x, y, z) {
  RS.enqueue(x, y, z);
  for (const d of RS_DN) {
    const v = RS_DIRS[d], nx = x + v[0], ny = y + v[1], nz = z + v[2];
    RS.enqueue(nx, ny, nz);
    for (const e of RS_DN) { const u = RS_DIRS[e]; RS.enqueue(nx + u[0], ny + u[1], nz + u[2]); }
  }
};
RS.enqueue = function (x, y, z) {
  const k = rsKey(x, y, z);
  if (RS.queued.has(k)) return;
  RS.queued.add(k); RS.queue.push([x, y, z]);
};
RS.process = function (g) {
  if (RS.busy || !g.world) return;
  RS.busy = true;
  let n = 0;
  try {
    while (RS.queue.length && n++ < 60000) {
      const [x, y, z] = RS.queue.shift();
      RS.queued.delete(rsKey(x, y, z));
      RS.update(g, x, y, z);
    }
  } finally { RS.busy = false; if (RS.queue.length > 60000) { RS.queue.length = 0; RS.queued.clear(); } }
};

// ---- dust ----
function isDotMeta(id, m) { const s = BLOCKS[id] && BLOCKS[id].states && BLOCKS[id].states[m]; return !!s && s.north === 'none' && s.south === 'none' && s.east === 'none' && s.west === 'none'; }
// what dust turns toward (vanilla shouldConnectTo)
function connectsTo(g, x, y, z, dir) {
  const w = g.world, id = w.getBlock(x, y, z), k = rsk(id), m = w.getMeta(x, y, z);
  if (isWire(id)) return true;
  if (k === 'repeater') { const f = prop(id, m, 'facing'); return f === dir || f === RS_OPP[dir]; }
  if (k === 'observer') return dir === prop(id, m, 'facing');
  return rsSource(id) && dir !== null;
}
// the block under dust holds it (a sturdy top, or a hopper)
function dustSupported(g, x, y, z) { const b = g.world.getBlock(x, y - 1, z); return rsFull(b) || rsk(b) === 'hopper' || (BLOCKS[b] && BLOCKS[b].slab && (g.world.getMeta(x, y - 1, z) & 3) !== 0); }
// vanilla getConnectionState with the dot / cross rules
RS.wireShape = function (g, x, y, z, curMeta) {
  const w = g.world, wid = w.getBlock(x, y, z);
  const aboveCond = conductor(w.getBlock(x, y + 1, z));
  const side = {};
  for (const d of RS_H) {
    const v = RS_DIRS[d], nx = x + v[0], nz = z + v[2], nid = w.getBlock(nx, y, nz);
    let c = 'none';
    if (!aboveCond && (BLOCKS[nid] && (BLOCKS[nid].trapdoor || rsFull(nid))) && isWire(w.getBlock(nx, y + 1, nz))) c = rsFull(nid) ? 'up' : 'side';
    else if (connectsTo(g, nx, y, nz, d) || (!conductor(nid) && isWire(w.getBlock(nx, y - 1, nz)))) c = 'side';
    side[d] = c;
  }
  const any = RS_H.some(d => side[d] !== 'none');
  if (!any && curMeta !== undefined && isDotMeta(wid, curMeta)) return side; // a dot stays a dot
  const ns = side.north !== 'none' || side.south !== 'none', ew = side.east !== 'none' || side.west !== 'none';
  if (!ns) { if (side.east === 'none') side.east = 'side'; if (side.west === 'none') side.west = 'side'; }
  if (!ew) { if (side.north === 'none') side.north = 'side'; if (side.south === 'none') side.south = 'side'; }
  // a single line: both ways along its axis
  return side;
};
function wireMeta(id, side) {
  const st = BLOCKS[id].states;
  const i = st.findIndex(s => s.north === side.north && s.south === side.south && s.east === side.east && s.west === side.west);
  return i < 0 ? 0 : i;
}
RS.wirePower = function (g, x, y, z) {
  const w = g.world;
  RS.wires = false; const i = RS.bestNeighbor(g, x, y, z); RS.wires = true;
  let j = 0;
  if (i < 15) {
    const aboveCond = conductor(w.getBlock(x, y + 1, z));
    for (const d of RS_H) {
      const v = RS_DIRS[d], nx = x + v[0], nz = z + v[2], nid = w.getBlock(nx, y, nz);
      j = Math.max(j, wireP(nid));
      if (conductor(nid) && !aboveCond) j = Math.max(j, wireP(w.getBlock(nx, y + 1, nz)));
      else if (!conductor(nid)) j = Math.max(j, wireP(w.getBlock(nx, y - 1, nz)));
    }
  }
  return Math.max(i, j - 1);
};
RS.updateWire = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  if (!dustSupported(g, x, y, z)) { g.breakRS(x, y, z); return; }
  const p = RS.wirePower(g, x, y, z), nm = wireMeta(id, RS.wireShape(g, x, y, z, m)), nid = WIRE_ID[p];
  if (nid !== id || nm !== m) {
    const powerChanged = nid !== id;
    w.setBlock(x, y, z, nid, nm);
    if (powerChanged) RS.wake(x, y, z); else RS.enqueue(x, y, z);
  }
};

// ---- the update of one position (after a neighbour changed, or when placed) ----
RS.update = function (g, x, y, z) {
  const w = g.world;
  if (!w.isLoaded(x, z)) return;
  const id = w.getBlock(x, y, z); if (!id) return;
  const b = BLOCKS[id], k = b.key, m = w.getMeta(x, y, z);
  if (isWire(id)) return RS.updateWire(g, x, y, z);
  switch (k) {
    case 'redstone_torch': case 'redstone_wall_torch': {
      if (!RS.torchSupported(g, x, y, z, id, m)) { g.breakRS(x, y, z); return; }
      const off = RS.torchPowered(g, x, y, z, id, m), lit = prop(id, m, 'lit') === 'true';
      if (lit === off) w.schedule(x, y, z, 2);
      return;
    }
    case 'repeater': {
      if (!RS.diodeSupported(g, x, y, z)) { g.breakRS(x, y, z); return; }
      const locked = RS.repeaterLocked(g, x, y, z, id, m);
      if (locked !== (prop(id, m, 'locked') === 'true')) RS.set(g, x, y, z, id, Features.withProp(id, m, 'locked', locked));
      if (locked) return;
      const should = RS.diodeInput(g, x, y, z, id, m) > 0;
      if (should !== (prop(id, m, 'powered') === 'true')) w.schedule(x, y, z, 2 * (+prop(id, m, 'delay') || 1));
      return;
    }
    case 'comparator': {
      if (!RS.diodeSupported(g, x, y, z)) { g.breakRS(x, y, z); return; }
      const out = RS.comparatorOut(g, x, y, z, id, m), mem = RS.mem.get(rsKey(x, y, z)) || {};
      if (out !== (mem.out || 0) || (out > 0) !== (prop(id, m, 'powered') === 'true')) w.schedule(x, y, z, 2);
      return;
    }
    case 'redstone_lamp': {
      const p = RS.neighborSignal(g, x, y, z), lit = prop(id, m, 'lit') === 'true';
      if (p && !lit) RS.setProp(g, x, y, z, 'lit', 'true');
      else if (!p && lit) w.schedule(x, y, z, 4);
      return;
    }
    case 'copper_bulb': case 'exposed_copper_bulb': case 'weathered_copper_bulb': case 'oxidized_copper_bulb':
    case 'waxed_copper_bulb': case 'waxed_exposed_copper_bulb': case 'waxed_weathered_copper_bulb': case 'waxed_oxidized_copper_bulb': {
      const p = RS.neighborSignal(g, x, y, z), was = prop(id, m, 'powered') === 'true';
      if (p !== was) {
        let nm = Features.withProp(id, m, 'powered', p);
        if (p) { const lit = prop(id, m, 'lit') !== 'true'; nm = Features.withProp(id, nm, 'lit', lit); Sound.ev(lit ? 'block.copper_bulb.turn_on' : 'block.copper_bulb.turn_off', [x + 0.5, y + 0.5, z + 0.5], 1, 1); }
        RS.set(g, x, y, z, id, nm);
      }
      return;
    }
    case 'tnt': if (RS.neighborSignal(g, x, y, z)) { w.setBlock(x, y, z, 0, 0); g.entities.push(new PrimedTNT(g, x, y, z)); Sound.ev('entity.tnt.primed', [x + 0.5, y, z + 0.5], 1, 1); } return;
    case 'note_block': return RS.edge(g, x, y, z, RS.neighborSignal(g, x, y, z), () => { Sound.note([x, y, z], m); g.particles.spawn('note', x + 0.5, y + 1.2, z + 0.5, 0, 0.02, 0, { col: [255, Math.round(m * 10), Math.round(255 - m * 10)] }); });
    case 'bell': return RS.edge(g, x, y, z, RS.neighborSignal(g, x, y, z), () => Sound.ev('block.bell.use', [x + 0.5, y + 0.5, z + 0.5], 2, 1));
    case 'piston': case 'sticky_piston': return RS.updatePiston(g, x, y, z, id, m);
    case 'dispenser': case 'dropper': return RS.edge(g, x, y, z, RS.qcPowered(g, x, y, z, null), () => w.schedule(x, y, z, 4));
    case 'crafter': {
      const p = RS.neighborSignal(g, x, y, z), was = prop(id, m, 'triggered') === 'true';
      if (p && !was) { w.schedule(x, y, z, 4); RS.set(g, x, y, z, id, Features.withProp(id, m, 'triggered', true)); }
      else if (!p && was) RS.set(g, x, y, z, id, Features.withProp(id, m, 'triggered', false));
      return;
    }
    // a plain rail at a junction (three rails to join) turns the other way while powered (vanilla RailState.place)
    case 'rail': {
      const p = !!RS.neighborSignal(g, x, y, z), mem = RS.memOf(x, y, z);
      if (p === !!mem.powered) return;
      mem.powered = p;
      const sh = typeof railJunctionShape === 'function' ? railJunctionShape(w, x, y, z, p) : null;
      if (sh && sh !== prop(id, m, 'shape')) RS.setProp(g, x, y, z, 'shape', sh);
      return;
    }
    case 'powered_rail': case 'activator_rail': {
      const p = RS.neighborSignal(g, x, y, z) || RS.railChain(g, x, y, z, id, m);
      if (p !== (prop(id, m, 'powered') === 'true')) { RS.setProp(g, x, y, z, 'powered', p); for (const d of RS_H) { const v = RS_DIRS[d]; for (const dy of [-1, 0, 1]) if (w.getBlock(x + v[0], y + dy, z + v[2]) === id) RS.enqueue(x + v[0], y + dy, z + v[2]); } }
      return;
    }
    case 'daylight_detector': return;
    case 'hopper': { const mem = RS.memOf(x, y, z); mem.locked = RS.neighborSignal(g, x, y, z); return; }
    case 'tripwire': case 'tripwire_hook': return;
  }
  if (b.door) {
    const base = (m & 8) ? y - 1 : y, bm = w.getMeta(x, base, z);
    const p = RS.neighborSignal(g, x, base, z) || RS.neighborSignal(g, x, base + 1, z);
    const mem = RS.memOf(x, base, z);
    if (p !== !!mem.powered) {
      mem.powered = p;
      if (!!(bm & 4) !== p && k !== 'iron_door_never') { const nm = p ? bm | 4 : bm & ~4; w.setMeta(x, base, z, nm); w.setMeta(x, base + 1, z, nm | 8); Sound.door([x, y, z], p); g.flushMesh && g.flushMesh(); }
    }
    return;
  }
  if (b.trapdoor) {
    const p = RS.neighborSignal(g, x, y, z), mem = RS.memOf(x, y, z);
    if (p !== !!mem.powered) { mem.powered = p; if (!!(m & 4) !== p) { w.setMeta(x, y, z, p ? m | 4 : m & ~4); Sound.door([x, y, z], p); } }
    return;
  }
  if (b.gate) {
    const p = RS.neighborSignal(g, x, y, z), mem = RS.memOf(x, y, z);
    if (p !== !!mem.powered) { mem.powered = p; if ((prop(id, m, 'open') === 'true') !== p) { w.setMeta(x, y, z, Features.withProp(id, m, 'open', p)); Sound.door([x, y, z], p); } }
  }
};
RS.memOf = (x, y, z) => { const k = rsKey(x, y, z); let v = RS.mem.get(k); if (!v) RS.mem.set(k, v = {}); return v; };
// something that acts once when power comes (note block, bell, dispenser ...)
RS.edge = function (g, x, y, z, powered, fire) {
  const mem = RS.memOf(x, y, z);
  if (powered && !mem.powered) { mem.powered = true; fire(); }
  else if (!powered && mem.powered) mem.powered = false;
};

// ---- torches ----
RS.torchAttach = function (id, m) { return rsk(id) === 'redstone_wall_torch' ? RS_OPP[prop(id, m, 'facing')] : 'down'; };
RS.torchSupported = function (g, x, y, z, id, m) { const d = RS.torchAttach(id, m), v = RS_DIRS[d]; return rsFull(g.world.getBlock(x + v[0], y + v[1], z + v[2])); };
RS.torchPowered = function (g, x, y, z, id, m) { const d = RS.torchAttach(id, m), v = RS_DIRS[d]; return RS.has(g, x + v[0], y + v[1], z + v[2], d); };

// ---- repeaters and comparators ----
RS.diodeSupported = (g, x, y, z) => rsFull(g.world.getBlock(x, y - 1, z));
RS.diodeInput = function (g, x, y, z, id, m) {
  const f = prop(id, m, 'facing'), v = RS_DIRS[f], bx = x + v[0], bz = z + v[2];
  const i = RS.get(g, bx, y, bz, f);
  if (i >= 15) return i;
  return Math.max(i, wireP(g.world.getBlock(bx, y, bz)));
};
const RS_SIDES = (f) => [RS_CW[f], RS_OPP[RS_CW[f]]];
RS.repeaterLocked = function (g, x, y, z, id, m) {
  const w = g.world;
  for (const d of RS_SIDES(prop(id, m, 'facing'))) {
    const v = RS_DIRS[d], sid = w.getBlock(x + v[0], y, z + v[2]), sk = rsk(sid);
    if ((sk === 'repeater' || sk === 'comparator') && RS.signal(g, x + v[0], y, z + v[2], d) > 0) return true;
  }
  return false;
};
RS.comparatorOut = function (g, x, y, z, id, m) {
  const w = g.world, f = prop(id, m, 'facing'), v = RS_DIRS[f];
  let a = RS.diodeInput(g, x, y, z, id, m);
  // reading a block behind it (or behind a solid block)
  const r1 = RS.analog(g, x + v[0], y, z + v[2]);
  if (r1 !== null) a = r1;
  else if (a < 15 && conductor(w.getBlock(x + v[0], y, z + v[2]))) { const r2 = RS.analog(g, x + 2 * v[0], y, z + 2 * v[2]); if (r2 !== null) a = Math.max(a, r2); }
  let s = 0;
  for (const d of RS_SIDES(f)) {
    const u = RS_DIRS[d], sx = x + u[0], sz = z + u[2], sid = w.getBlock(sx, y, sz);
    if (!rsSource(sid) && !isWire(sid)) continue;
    s = Math.max(s, rsk(sid) === 'redstone_block' ? 15 : isWire(sid) ? wireP(sid) : RS.direct(g, sx, y, sz, d));
  }
  return prop(id, m, 'mode') === 'subtract' ? Math.max(a - s, 0) : a >= s ? a : 0;
};
// what a comparator reads from a block (containers: how full; others by their state); null: nothing to read
RS.analog = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z), k = rsk(id), m = w.getMeta(x, y, z);
  // (minecarts only through a detector rail they are on: DetectorRailBlock.getAnalogOutputSignal)
  const c = RS.container(g, x, y, z, k === 'detector_rail' && prop(id, m, 'powered') === 'true');
  if (c) {
    let f = 0, any = false;
    for (let i = 0; i < c.size; i++) { const s = c.get(i); if (s) { f += s.count / Math.min(c.max || 64, maxStack(s.id)); any = true; } }
    return any ? Math.floor(1 + f / c.size * 14) : 0;
  }
  if (k === 'cake') return (7 - (+prop(id, m, 'bites') || 0)) * 2;
  if (k === 'composter') return +prop(id, m, 'level') || 0;
  if (/cauldron$/.test(k)) return k === 'water_cauldron' || k === 'powder_snow_cauldron' ? +prop(id, m, 'level') || 0 : k === 'lava_cauldron' ? 3 : 0;
  if (k === 'end_portal_frame') return prop(id, m, 'eye') === 'true' ? 15 : 0;
  if (k === 'respawn_anchor') return Math.floor((+prop(id, m, 'charges') || 0) * 15 / 4);
  if (k === 'beehive' || k === 'bee_nest') return +prop(id, m, 'honey_level') || 0;
  if (k === 'jukebox') { const be = g.blockEntities.get(rsKey(x, y, z)); return be && be.disc ? 1 : 0; }
  return null;
};

// ---- containers (hoppers, droppers and comparators use them) ----
// { size, get(i), set(i, stack), canIn(i, stack, side), canOut(i, side) }; side: the face of the container used
RS.container = function (g, x, y, z, vehicles = true) {
  const w = g.world, id = w.getBlock(x, y, z), b = BLOCKS[id]; if (!b) return vehicles ? RS.vehicleContainer(g, x, y, z) : null;
  const k = b.key, key = rsKey(x, y, z);
  if (b.chestLike || k === 'barrel') {
    if (k === 'ender_chest') return null;
    const bes = [g.getBlockEntity(x, y, z, 'chest')];
    if (b.chestLike) { const s = chestSeam(w.getMeta(x, y, z)); if (s && w.getBlock(x + s[0], y, z + s[1]) === id) bes.push(g.getBlockEntity(x + s[0], y, z + s[1], 'chest')); }
    const all = bes.flatMap(be => be.slots.map((_, i) => [be, i]));
    return { size: all.length, get: (i) => all[i][0].slots[all[i][1]], set: (i, s) => { all[i][0].slots[all[i][1]] = s; }, canIn: () => true, canOut: () => true };
  }
  if (b.onUse === 'furnace') {
    const be = g.getBlockEntity(x, y, z, 'furnace'), f = ['input', 'fuel', 'output'];
    return { size: 3, get: (i) => be[f[i]], set: (i, s) => { be[f[i]] = s; },
      canIn: (i, s, side) => side === 'up' ? i === 0 : side === 'down' ? false : i === 1 && fuelValue(s.id) > 0,
      canOut: (i, side) => side === 'down' ? i === 2 || (i === 1 && be.fuel && ITEMS[be.fuel.id].key === 'bucket') : false };
  }
  if (k === 'brewing_stand') {
    const be = g.getBlockEntity(x, y, z, 'brewing');
    if (!be.bottles) Object.assign(be, { bottles: [null, null, null], ingredient: null, fuel: null, fuelLeft: 0, brewTime: 0 });
    const get = (i) => i < 3 ? be.bottles[i] : i === 3 ? be.ingredient : be.fuel, set = (i, s) => { if (i < 3) be.bottles[i] = s; else if (i === 3) be.ingredient = s; else be.fuel = s; };
    return { size: 5, max: 1, get, set,
      canIn: (i, s, side) => side === 'up' ? i === 3 : i === 4 ? s.id === ITEM_KEY.blaze_powder : i < 3 && typeof isPotion === 'function' && (isPotion(s) || s.id === ITEM_KEY.glass_bottle),
      canOut: (i, side) => i < 3 && be.brewTime === 0 };
  }
  if (k === 'hopper' || k === 'dispenser' || k === 'dropper' || k === 'crafter') {
    const be = RS.be(g, x, y, z, k);
    return { size: be.slots.length, get: (i) => be.slots[i], set: (i, s) => { be.slots[i] = s; },
      canIn: (i) => k !== 'crafter' || !(be.disabled || []).includes(i), canOut: () => true };
  }
  return SOLIDCUBE[id] || !vehicles ? null : RS.vehicleContainer(g, x, y, z);
};
// no container block there: a minecart with a chest or a hopper, or a chest boat, in that block (HopperBlockEntity
// getContainerAt: the entities whose box meets the block's, one at random)
RS.vehicleContainer = function (g, x, y, z) {
  const found = [];
  for (const e of g.entities) {
    if (!e.isVehicle || !e.slots || e.dead) continue;
    const b = e.box();
    if (b[0] < x + 1 && b[3] > x && b[1] < y + 1 && b[4] > y && b[2] < z + 1 && b[5] > z) found.push(e);
  }
  if (!found.length) return null;
  const v = found[(Math.random() * found.length) | 0];
  if (v.unpackLoot) v.unpackLoot();
  const s = v.slots;
  return { size: s.length, get: (i) => s[i], set: (i, v) => { s[i] = v; }, canIn: () => true, canOut: () => true };
};
RS.be = function (g, x, y, z, type) {
  const k = rsKey(x, y, z);
  let be = g.blockEntities.get(k);
  if (!be || be.type !== type) { be = { type, pos: [x, y, z], slots: new Array(type === 'hopper' ? 5 : 9).fill(null), cd: 0 }; g.blockEntities.set(k, be); }
  return be;
};
// put a stack into a container (all it takes), from a side; returns what is left (or null)
RS.insert = function (c, stack, side) {
  let s = { ...stack };
  for (let i = 0; i < c.size && s; i++) {
    const t = c.get(i);
    if (!t || !sameKind(t, s) || !c.canIn(i, s, side)) continue;
    const room = Math.min(c.max || 64, maxStack(s.id)) - t.count; if (room <= 0) continue;
    const n = Math.min(room, s.count); t.count += n; s.count -= n; if (!s.count) s = null;
  }
  for (let i = 0; i < c.size && s; i++) {
    if (c.get(i) || !c.canIn(i, s, side)) continue;
    const n = Math.min(c.max || 64, maxStack(s.id), s.count); c.set(i, { ...s, count: n }); s.count -= n; if (!s.count) s = null;
  }
  return s;
};

// ---- scheduled ticks ----
RS.tick = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z), k = rsk(id), m = w.getMeta(x, y, z);
  if (!id) return false;
  switch (k) {
    case 'redstone_torch': case 'redstone_wall_torch': {
      const off = RS.torchPowered(g, x, y, z, id, m), lit = prop(id, m, 'lit') === 'true', pos = rsKey(x, y, z);
      const hist = (RS.torchHist.get(pos) || []).filter(t => g.tickCount - t < 60);
      if (lit && off) {
        hist.push(g.tickCount); RS.torchHist.set(pos, hist);
        RS.set(g, x, y, z, id, Features.withProp(id, m, 'lit', false));
        // burnt out: too many changes in 3 seconds; it waits before coming back
        if (hist.length >= 8) { Sound.ev('block.redstone_torch.burnout', [x + 0.5, y + 0.5, z + 0.5], 0.5, 2.6); w.schedule(x, y, z, 160); }
      } else if (!lit && !off && hist.length < 8) RS.set(g, x, y, z, id, Features.withProp(id, m, 'lit', true));
      else if (!lit && !off) { RS.torchHist.set(pos, hist); if (hist.length) w.schedule(x, y, z, 20); else RS.set(g, x, y, z, id, Features.withProp(id, m, 'lit', true)); }
      return true;
    }
    case 'repeater': {
      if (prop(id, m, 'locked') === 'true') return true;
      const should = RS.diodeInput(g, x, y, z, id, m) > 0, on = prop(id, m, 'powered') === 'true';
      if (on && !should) RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', false));
      else if (!on) { RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', true)); if (!should) w.schedule(x, y, z, 2 * (+prop(id, m, 'delay') || 1)); }
      return true;
    }
    case 'comparator': {
      const out = RS.comparatorOut(g, x, y, z, id, m), mem = RS.memOf(x, y, z);
      const changed = out !== (mem.out || 0);
      mem.out = out;
      const nm = Features.withProp(id, m, 'powered', out > 0);
      if (nm !== m) RS.set(g, x, y, z, id, nm); else if (changed) RS.wake(x, y, z);
      return true;
    }
    case 'redstone_lamp': if (!RS.neighborSignal(g, x, y, z) && prop(id, m, 'lit') === 'true') RS.setProp(g, x, y, z, 'lit', 'false'); return true;
    case 'observer': {
      if (prop(id, m, 'powered') === 'true') RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', false));
      else { RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', true)); w.schedule(x, y, z, 2); }
      return true;
    }
    case 'dispenser': case 'dropper': RS.dispense(g, x, y, z, id, m); return true;
    case 'crafter': RS.craft(g, x, y, z, id, m); return true;
    case 'detector_rail': RS.detectorCheck(g, x, y, z); return true;
    case 'tripwire_hook': case 'tripwire': RS.tripCheck(g, x, y, z); return true;
  }
  if (RS_BUTTON.test(k)) {
    if (prop(id, m, 'powered') === 'true') { RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', false)); Sound.ev(k.startsWith('stone') || k.includes('blackstone') ? 'block.stone_button.click_off' : 'block.wooden_button.click_off', [x + 0.5, y + 0.5, z + 0.5], 0.3, 0.5); }
    return true;
  }
  if (RS_PLATE.test(k)) { RS.plateCheck(g, x, y, z); return true; }
  return false;
};

// ---- pressure plates, tripwire, detector rails: what stands on them ----
RS.entitiesIn = function (g, box, test) {
  const out = [];
  for (const e of [g.player, ...g.entities]) {
    if (!e || e.dead || (e.deathTime > 0) || (e === g.player && g.mode === 'spectator')) continue;
    if (test && !test(e)) continue;
    const b = e.box();
    if (b[0] < box[3] && b[3] > box[0] && b[1] < box[4] && b[4] > box[1] && b[2] < box[5] && b[5] > box[2]) out.push(e);
  }
  return out;
};
RS.plateCheck = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z), k = rsk(id), m = w.getMeta(x, y, z);
  const box = [x + 0.0625, y, z + 0.0625, x + 0.9375, y + 0.25, z + 0.9375];
  const living = k.startsWith('stone') || k.includes('blackstone');
  const list = RS.entitiesIn(g, box, (e) => living ? e instanceof Living : true);
  if (k.includes('weighted')) {
    const n = list.reduce((a, e) => a + (e.stack ? e.stack.count : 1), 0);
    const p = k.startsWith('light') ? Math.min(n, 15) : n ? Math.ceil(Math.min(n, 150) / 10) : 0;
    const cur = +prop(id, m, 'power') || 0;
    if (p !== cur) { RS.set(g, x, y, z, id, Features.withProp(id, m, 'power', p)); Sound.ev(p > cur ? 'block.metal_pressure_plate.click_on' : 'block.metal_pressure_plate.click_off', [x + 0.5, y, z + 0.5], 0.3, p > cur ? 0.9 : 0.75); }
    if (p > 0) w.schedule(x, y, z, 10);
    return;
  }
  const on = list.length > 0, was = prop(id, m, 'powered') === 'true';
  if (on !== was) { RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', on)); Sound.ev(living ? (on ? 'block.stone_pressure_plate.click_on' : 'block.stone_pressure_plate.click_off') : (on ? 'block.wooden_pressure_plate.click_on' : 'block.wooden_pressure_plate.click_off'), [x + 0.5, y, z + 0.5], 0.3, on ? 0.6 : 0.5); }
  if (on) w.schedule(x, y, z, 20);
};
RS.detectorCheck = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  const on = RS.entitiesIn(g, [x + 0.2, y, z + 0.2, x + 0.8, y + 0.8, z + 0.8], (e) => e instanceof Minecart).length > 0;
  if (on !== (prop(id, m, 'powered') === 'true')) RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', on));
  if (on) w.schedule(x, y, z, 20);
};
// powered rails pass power along up to 8 rails of their kind
RS.railChain = function (g, x, y, z, id, m) {
  const w = g.world, seen = new Set([rsKey(x, y, z)]);
  const walk = (cx, cy, cz, n) => {
    if (n > 8) return false;
    const cm = w.getMeta(cx, cy, cz), sh = prop(id, cm, 'shape');
    for (const [ex, ey, ez] of (RAIL_EXITS[sh] || [])) {
      for (const dy of [ey, 0, 1, -1]) {
        const nx = cx + ex, ny = cy + dy, nz = cz + ez, k = rsKey(nx, ny, nz);
        if (seen.has(k) || w.getBlock(nx, ny, nz) !== id) continue;
        seen.add(k);
        if (RS.neighborSignal(g, nx, ny, nz) || walk(nx, ny, nz, n + 1)) return true;
        break;
      }
    }
    return false;
  };
  return walk(x, y, z, 1);
};
// tripwire: hooks facing each other up to 40 blocks apart with string between; something on the string powers both
RS.tripLine = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z), f = prop(id, m, 'facing'), v = RS_DIRS[f];
  const wire = [];
  for (let i = 1; i <= 41; i++) {
    const nx = x + v[0] * i, nz = z + v[2] * i, nid = w.getBlock(nx, y, nz), nk = rsk(nid);
    if (nk === 'tripwire_hook') return prop(nid, w.getMeta(nx, y, nz), 'facing') === RS_OPP[f] && wire.length ? { other: [nx, y, nz], wire } : null;
    if (nk !== 'tripwire') return null;
    wire.push([nx, y, nz]);
  }
  return null;
};
RS.tripCheck = function (g, x, y, z) {
  const w = g.world, k = rsk(w.getBlock(x, y, z));
  if (k === 'tripwire') { // find a hook along either axis and check from there
    for (const d of RS_H) { const v = RS_DIRS[d]; for (let i = 1; i <= 41; i++) { const nk = rsk(w.getBlock(x + v[0] * i, y, z + v[2] * i)); if (nk === 'tripwire_hook') { RS.tripCheck(g, x + v[0] * i, y, z + v[2] * i); break; } if (nk !== 'tripwire') break; } }
    return;
  }
  if (k !== 'tripwire_hook') return;
  const line = RS.tripLine(g, x, y, z);
  const on = !!line && line.wire.some(([wx, wy, wz]) => RS.entitiesIn(g, [wx, wy, wz, wx + 1, wy + 0.15, wz + 1]).length > 0);
  for (const p of line ? [[x, y, z], line.other] : [[x, y, z]]) {
    const id = w.getBlock(...p), m = w.getMeta(...p);
    let nm = Features.withProp(id, m, 'attached', !!line); nm = Features.withProp(id, nm, 'powered', on);
    if (nm !== m) { if (on !== (prop(id, m, 'powered') === 'true')) Sound.ev(on ? 'block.tripwire.click_on' : 'block.tripwire.click_off', [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5], 0.4, 0.6); RS.set(g, ...p, id, nm); }
  }
  if (line) for (const p of line.wire) { const id = w.getBlock(...p), m = w.getMeta(...p), nm = Features.withProp(id, m, 'attached', true); if (nm !== m) w.setMeta(...p, nm); }
  if (on) w.schedule(x, y, z, 10);
};
// targets: an arrow (or other projectile) gives power by how close to the middle it hit, for a while
RS.targetHit = function (g, x, y, z, point, arrow) {
  const fx = point[0] - x, fy = point[1] - y, fz = point[2] - z;
  const d = Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5), Math.abs(fz - 0.5)) === 0.5 ? Math.min(...[[fx, fy], [fy, fz], [fx, fz]].map(([a, b]) => Math.max(Math.abs(a - 0.5), Math.abs(b - 0.5)))) : 0.5;
  const power = Math.max(1, Math.ceil(15 * clamp((0.5 - d) / 0.5, 0, 1)));
  RS.mem.set(rsKey(x, y, z), { power, until: g.tickCount + (arrow ? 20 : 8) });
  RS.wake(x, y, z);
  g.world.schedule(x, y, z, arrow ? 20 : 8);
};

// ---- pistons ----
const RS_IMMOVABLE = /^(obsidian|crying_obsidian|bedrock|barrier|end_portal_frame|end_portal|end_gateway|nether_portal|reinforced_deepslate|respawn_anchor|enchanting_table|ender_chest|beacon|command_block|chain_command_block|repeating_command_block|structure_block|jigsaw|moving_piston|piston_head|light|spawner|trial_spawner|vault|lodestone|conduit)$/;
// how a block takes being pushed: 'move', 'destroy', 'block' (stops the piston), 'push' (pushed, never pulled)
function blockPushReaction(g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z);
  if (!id) return 'air';
  const b = BLOCKS[id], k = b.key;
  if (IS_FLUID[id]) return 'destroy';
  if (RS_IMMOVABLE.test(k) || b.hardness < 0) return 'block';
  if ((k === 'piston' || k === 'sticky_piston') && prop(id, w.getMeta(x, y, z), 'extended') === 'true') return 'block';
  if (g.blockEntities.has(rsKey(x, y, z)) || b.chestLike || b.beRender || b.onUse === 'furnace' || /^(hopper|dispenser|dropper|crafter|brewing_stand|jukebox|lectern|beehive|bee_nest|chiseled_bookshelf|decorated_pot|bell|campfire|soul_campfire)$/.test(k) || b.be) return 'block';
  if (k.endsWith('glazed_terracotta')) return 'push';
  if (REPLACEABLE[id] || b.needsSupport || b.door || b.bed || !b.solid || isWire(id) || /^(repeater|comparator|lever|.*_button|redstone_torch|redstone_wall_torch|.*pressure_plate|cobweb|cactus|.*_carpet_never|flower_pot|.*_flower_pot|ladder|scaffolding|snow|.*_sign|.*_hanging_sign|.*_banner|dragon_egg|.*lantern|.*_bed|.*_head|.*_skull|melon|pumpkin_never|tripwire|tripwire_hook)$/.test(k)) return 'destroy';
  return 'move';
}
const isSticky = (id) => { const k = rsk(id); return k === 'slime_block' || k === 'honey_block'; };
// the blocks a push or pull moves (vanilla PistonStructureResolver, at most 12); null when blocked
RS.resolve = function (g, px, py, pz, dir, extending) {
  const v = RS_DIRS[dir], moveDir = extending ? v : RS_DIRS[RS_OPP[dir]];
  const start = extending ? [px + v[0], py + v[1], pz + v[2]] : [px + 2 * v[0], py + 2 * v[1], pz + 2 * v[2]];
  const toMove = [], toDestroy = [], seen = new Set();
  const w = g.world, headKey = rsKey(px + v[0], py + v[1], pz + v[2]);
  // while retracting the head is already gone: its place is empty
  const pushReaction = (x, y, z) => !extending && rsKey(x, y, z) === headKey ? 'air' : blockPushReaction(g, x, y, z);
  const r0 = pushReaction(...start);
  if (!extending && (r0 !== 'move')) return { toMove, toDestroy };
  if (r0 === 'air') return { toMove, toDestroy };
  if (r0 === 'destroy') return extending ? { toMove, toDestroy: [start] } : { toMove, toDestroy };
  if (r0 === 'block') return null;
  const pistonKey = rsKey(px, py, pz);
  // add a line of blocks starting at p, going against the movement while they stick, then along it
  const addLine = (p) => {
    let [x, y, z] = p;
    if (seen.has(rsKey(x, y, z))) return true;
    const r = pushReaction(x, y, z);
    if (r === 'air' || r === 'destroy') return true;
    if (r === 'block') return false;
    if (rsKey(x, y, z) === pistonKey) return true;
    // blocks stuck behind (against the movement) come along
    const back = [];
    let bx = x, by = y, bz = z;
    while (isSticky(w.getBlock(bx, by, bz))) {
      const nx = bx - moveDir[0], ny = by - moveDir[1], nz = bz - moveDir[2], nid = w.getBlock(nx, ny, nz);
      if (rsKey(nx, ny, nz) === pistonKey) break;
      const nr = pushReaction(nx, ny, nz);
      if (nr !== 'move' || !stickTogether(w.getBlock(bx, by, bz), nid)) break;
      back.push([nx, ny, nz]); bx = nx; by = ny; bz = nz;
      if (toMove.length + back.length > 12) return false;
    }
    for (let i = back.length - 1; i >= 0; i--) { const k = rsKey(...back[i]); if (!seen.has(k)) { seen.add(k); toMove.push(back[i]); } }
    // this block and the ones in front of it
    for (;;) {
      const k = rsKey(x, y, z);
      if (!seen.has(k)) { seen.add(k); toMove.push([x, y, z]); }
      if (toMove.length > 12) return false;
      const nx = x + moveDir[0], ny = y + moveDir[1], nz = z + moveDir[2];
      if (rsKey(nx, ny, nz) === pistonKey) return false;
      const nr = pushReaction(nx, ny, nz);
      if (nr === 'air') break;
      if (nr === 'destroy') { toDestroy.push([nx, ny, nz]); break; }
      if (nr === 'block') return false;
      if (seen.has(rsKey(nx, ny, nz))) break;
      x = nx; y = ny; z = nz;
    }
    return true;
  };
  if (!addLine(start)) return null;
  // sticky blocks drag their neighbours sideways too
  for (let i = 0; i < toMove.length; i++) {
    const p = toMove[i], id = w.getBlock(...p);
    if (!isSticky(id)) continue;
    for (const d of RS_DN) {
      const u = RS_DIRS[d];
      if ((u[0] === moveDir[0] && u[1] === moveDir[1] && u[2] === moveDir[2]) || (u[0] === -moveDir[0] && u[1] === -moveDir[1] && u[2] === -moveDir[2])) continue;
      const q = [p[0] + u[0], p[1] + u[1], p[2] + u[2]], qid = w.getBlock(...q);
      if (seen.has(rsKey(...q)) || pushReaction(...q) !== 'move' || !stickTogether(id, qid)) continue;
      if (!addLine(q)) return null;
    }
  }
  if (toMove.length > 12) return null;
  return { toMove, toDestroy };
};
function stickTogether(a, b) { const ka = rsk(a), kb = rsk(b); return !((ka === 'slime_block' && kb === 'honey_block') || (ka === 'honey_block' && kb === 'slime_block')) && (isSticky(a) || isSticky(b)); }
RS.updatePiston = function (g, x, y, z, id, m) {
  const f = prop(id, m, 'facing'), ext = prop(id, m, 'extended') === 'true';
  const p = RS.qcPowered(g, x, y, z, f);
  if (p && !ext) RS.pistonMove(g, x, y, z, id, m, true);
  else if (!p && ext) RS.pistonMove(g, x, y, z, id, m, false);
};
RS.pistonMove = function (g, x, y, z, id, m, extending) {
  const w = g.world, f = prop(id, m, 'facing'), v = RS_DIRS[f], sticky = rsk(id) === 'sticky_piston';
  const head = [x + v[0], y + v[1], z + v[2]];
  let res = { toMove: [], toDestroy: [] };
  if (extending || sticky) {
    res = RS.resolve(g, x, y, z, f, extending);
    if (!res) return false;
  }
  const d = extending ? v : RS_DIRS[RS_OPP[f]];
  // destroyed blocks drop their items
  for (const p of res.toDestroy) { const did = w.getBlock(...p); if (did && !IS_FLUID[did]) g.dropBlockLoot(...p, did, w.getMeta(...p), null); w.setBlock(...p, 0, 0); }
  // move: take them all out, then put them all back one step on
  // (a waterlogged block takes its water along, leaving none behind)
  const blocks = res.toMove.map(p => [p, w.getBlock(...p), w.getMeta(...p), w.isWaterlogged(...p)]);
  if (!extending) w.setBlock(...head, 0, 0); // the head goes first
  for (const [p, , , wl] of blocks) { if (wl) w.setWaterlogged(...p, false); w.setBlock(...p, 0, 0, 3); }
  // the head is in place before the blocks come back, and they come back from the bottom up, so nothing that
  // falls (sand, gravel, anvils ...) finds air under it on the way
  let hm = 0; const hid = BID.piston_head;
  if (extending) { hm = Features.withProp(hid, 0, 'facing', f); hm = Features.withProp(hid, hm, 'type', sticky ? 'sticky' : 'normal'); hm = Features.withProp(hid, hm, 'short', 'false'); w.setBlock(...head, hid, hm); }
  for (const [p, bid, bm, wl] of blocks.slice().sort((a, b) => a[0][1] - b[0][1])) {
    w.setBlock(p[0] + d[0], p[1] + d[1], p[2] + d[2], bid, bm);
    if (wl) w.setWaterlogged(p[0] + d[0], p[1] + d[1], p[2] + d[2], true);
  }
  // entities in the way are pushed along
  const moved = new Set(blocks.map(([p]) => rsKey(p[0] + d[0], p[1] + d[1], p[2] + d[2])));
  if (extending) moved.add(rsKey(...head));
  for (const e of [g.player, ...g.entities]) {
    if (!e || e.dead) continue;
    const b = e.box(), fx = Math.floor(e.pos[0]), fz = Math.floor(e.pos[2]);
    for (let yy = Math.floor(b[1]); yy <= Math.floor(b[4] - 1e-3); yy++) {
      if (!moved.has(rsKey(fx, yy, fz))) continue;
      e.pos[0] += d[0] * 1.01; e.pos[1] += d[1] * 1.01; e.pos[2] += d[2] * 1.01;
      // a slime block launches what stands on it
      if (blocks.some(([p, bid]) => rsk(bid) === 'slime_block')) { e.vel[0] += d[0] * 0.5; e.vel[1] += d[1] * 0.5; e.vel[2] += d[2] * 0.5; }
      break;
    }
  }
  if (extending) {
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'extended', true));
    Sound.ev('block.piston.extend', [x + 0.5, y + 0.5, z + 0.5], 0.5, 0.7 + Math.random() * 0.25);
  } else {
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'extended', false));
    Sound.ev('block.piston.contract', [x + 0.5, y + 0.5, z + 0.5], 0.5, 0.6 + Math.random() * 0.15);
  }
  // everything that moved, and around it, gets its update (observers see it too)
  for (const [p] of blocks) { RS.wake(...p); RS.wake(p[0] + d[0], p[1] + d[1], p[2] + d[2]); }
  RS.wake(...head);
  g.flushMesh && g.flushMesh();
  return true;
};

// ---- observers: see a change of the block in front of them ----
RS.observe = function (g, x, y, z) {
  const w = g.world;
  for (const d of RS_DN) {
    const v = RS_DIRS[d], ox = x - v[0], oy = y - v[1], oz = z - v[2], oid = w.getBlock(ox, oy, oz);
    if (rsk(oid) !== 'observer') continue;
    const om = w.getMeta(ox, oy, oz);
    // the observer at ox.. looks toward its facing: is that this block?
    if (prop(oid, om, 'facing') !== d) continue;
    if (prop(oid, om, 'powered') !== 'true') w.schedule(ox, oy, oz, 2);
  }
};

// ---- dispensers and droppers ----
RS.dispense = function (g, x, y, z, id, m) {
  const w = g.world, be = RS.be(g, x, y, z, rsk(id)), f = prop(id, m, 'facing'), v = RS_DIRS[f];
  const full = be.slots.map((s, i) => s ? i : -1).filter(i => i >= 0);
  const c = [x + 0.5 + v[0] * 0.7, y + 0.5 + v[1] * 0.7 - (v[1] === 0 ? 0.15 : 0), z + 0.5 + v[2] * 0.7];
  if (!full.length) { Sound.ev('block.dispenser.fail', c, 1, 1.2); return; }
  const i = full[Math.floor(Math.random() * full.length)], st = be.slots[i], key = ITEMS[st.id].key;
  const take = (n = 1) => { st.count -= n; if (st.count <= 0) be.slots[i] = null; };
  const front = [x + v[0], y + v[1], z + v[2]];
  const shoot = (vel) => [v[0] * vel, v[1] * vel + 0.1, v[2] * vel];
  let done = true;
  if (rsk(id) === 'dropper') {
    const tc = RS.container(g, ...front);
    if (tc) { const left = RS.insert(tc, { ...st, count: 1 }, RS_OPP[f]); if (left) done = false; else take(); }
    else { g.dropItem(...c, { ...st, count: 1 }, shoot(0.2)); take(); }
  } else if (AMMO.has(key)) {
    const a = new Arrow(g, ...c, shoot(1.1), null); a.stack = { ...st, count: 1 }; if (key !== 'arrow') a.tip = a.stack; g.entities.push(a); take();
    Sound.ev('entity.arrow.shoot', c, 1, 1.2);
  } else if (key === 'snowball' || key === 'egg') { const a = new Arrow(g, ...c, shoot(1.1), null); a.snowball = st.id; g.entities.push(a); take(); }
  else if (key === 'splash_potion' || key === 'lingering_potion') { g.entities.push(new ThrownPotion(g, ...c, shoot(0.5), null, { ...st, count: 1 })); take(); }
  else if (key === 'fire_charge') { g.entities.push(new Fireball(g, ...c, [v[0] * 0.1, v[1] * 0.1, v[2] * 0.1], null, true)); take(); }
  else if (key === 'tnt') { g.entities.push(new PrimedTNT(g, ...front)); take(); }
  else if (key === 'water_bucket' || key === 'lava_bucket') {
    const cur = w.getBlock(...front);
    if (key === 'water_bucket' && canWaterlog(cur, w.getMeta(...front)) && !w.isWaterlogged(...front)) { w.setWaterlogged(...front, true); be.slots[i] = makeStack('bucket'); }
    else if (!cur || REPLACEABLE[cur]) { w.setBlock(...front, key === 'water_bucket' ? WATER : LAVA, 0); be.slots[i] = makeStack('bucket'); } else done = false;
  } else if (key === 'bucket') {
    const cur = w.getBlock(...front);
    if (!IS_FLUID[cur] && w.isWaterlogged(...front)) { w.setWaterlogged(...front, false); take(); const fill = makeStack('water_bucket'); if (RS.insert(RS.container(g, x, y, z), fill, null)) g.dropItem(...c, fill, shoot(0.2)); }
    else if (IS_FLUID[cur] && w.getMeta(...front) === 0) { w.setBlock(...front, 0, 0); take(); const fill = makeStack(cur === WATER ? 'water_bucket' : 'lava_bucket'); if (RS.insert(RS.container(g, x, y, z), fill, null)) g.dropItem(...c, fill, shoot(0.2)); } else done = false;
  } else if (key === 'flint_and_steel') {
    const cur = w.getBlock(...front);
    if (rsk(cur) === 'tnt') { w.setBlock(...front, 0, 0); g.entities.push(new PrimedTNT(g, ...front)); }
    else if (!cur && g.fireSupported(...front)) w.setBlock(...front, 171, 0); else done = false;
    if (done) { st.dmg = (st.dmg || 0) + 1; if (st.dmg >= ITEMS[st.id].durability) be.slots[i] = null; }
  } else if (key === 'bone_meal') {
    const cur = w.getBlock(...front);
    if (cur === 64 && w.getMeta(...front) < 7) { w.setMeta(...front, Math.min(7, w.getMeta(...front) + 2 + ((Math.random() * 3) | 0))); take(); g.flushMesh(); } else done = false;
  } else if (ITEMS[st.id].spawnEgg) { const mob = createMob(g, ITEMS[st.id].spawnEgg, front[0] + 0.5, front[1], front[2] + 0.5); mob.persistent = true; g.entities.push(mob); take(); }
  else if (typeof BOAT_ITEM !== 'undefined' && BOAT_ITEM[key]) {
    const [wood, chest] = BOAT_ITEM[key], bt = new Boat(g, front[0] + 0.5, front[1] + (IS_FLUID[w.getBlock(...front)] ? 0.5 : 0), front[2] + 0.5, wood, chest);
    bt.yaw = Math.atan2(-v[0], -v[2]); g.entities.push(bt); take();
  } else if (typeof CART_ITEM !== 'undefined' && CART_ITEM[key] !== undefined && isRail(w.getBlock(...front))) { g.entities.push(new Minecart(g, front[0] + 0.5, front[1] + 0.0625, front[2] + 0.5, CART_ITEM[key])); take(); }
  else if (key === 'shears') {
    const sheep = RS.entitiesIn(g, [front[0], front[1], front[2], front[0] + 1, front[1] + 1, front[2] + 1], (e) => e.type === 'sheep' && !e.sheared && !e.baby)[0];
    if (sheep) { sheep.sheared = true; for (let k = 0, n = 1 + ((Math.random() * 3) | 0); k < n; k++) g.dropItem(sheep.pos[0], sheep.pos[1] + 1, sheep.pos[2], makeStack(128 + sheep.woolColor, 1)); st.dmg = (st.dmg || 0) + 1; } else done = false;
  } else if (key === 'glass_bottle') {
    const cur = w.getBlock(...front);
    if (cur === WATER) { take(); const pot = { id: ITEM_KEY.potion, count: 1, dmg: 0, pot: 'water' }; if (RS.insert(RS.container(g, x, y, z), pot, null)) g.dropItem(...c, pot, shoot(0.2)); } else done = false;
  } else { g.dropItem(...c, { ...st, count: 1 }, shoot(0.2)); take(); }
  if (done) { Sound.ev('block.dispenser.dispense', c, 1, 1); for (let k = 0; k < 5; k++) g.particles.spawn('smoke', c[0], c[1], c[2], v[0] * 0.05 + (Math.random() - 0.5) * 0.02, 0.01, v[2] * 0.05 + (Math.random() - 0.5) * 0.02); }
  else Sound.ev('block.dispenser.fail', c, 1, 1.2);
};

// ---- the crafter: crafts once per pulse, the result comes out of its front ----
RS.craftResult = function (be) {
  const grid = be.slots.map(s => s ? { id: s.id, count: s.count } : null);
  const r = matchRecipe(grid, 3);
  return r ? { id: r.result, count: r.count, dmg: 0 } : null;
};
RS.craft = function (g, x, y, z, id, m) {
  const be = RS.be(g, x, y, z, 'crafter'), res = RS.craftResult(be);
  const facing = String(prop(id, m, 'orientation') || 'north_up').split('_')[0], v = RS_DIRS[facing] || RS_DIRS.north;
  const c = [x + 0.5 + v[0] * 0.7, y + 0.5 + v[1] * 0.7, z + 0.5 + v[2] * 0.7];
  if (!res) { Sound.ev('block.crafter.fail', c, 1, 1); return; }
  for (let i = 0; i < 9; i++) {
    const s = be.slots[i]; if (!s) continue;
    const k = ITEMS[s.id].key;
    if (k === 'water_bucket' || k === 'lava_bucket' || k === 'milk_bucket') { be.slots[i] = makeStack('bucket'); continue; }
    s.count--; if (!s.count) be.slots[i] = null;
  }
  const tc = RS.container(g, x + v[0], y + v[1], z + v[2]);
  const left = tc ? RS.insert(tc, res, RS_OPP[facing]) : res;
  if (left) g.dropItem(...c, left, [v[0] * 0.2, v[1] * 0.2 + 0.05, v[2] * 0.2]);
  Sound.ev('block.crafter.craft', c, 1, 1);
  be.flash = g.tickCount + 6;
};

// ---- hoppers: every 8 ticks one item out (into what they point at) and one in (from above, or lying on them) ----
RS.hopperTick = function (g, be) {
  const w = g.world, [x, y, z] = be.pos;
  if (rsk(w.getBlock(x, y, z)) !== 'hopper') return;
  if (be.cd > 0) { be.cd--; return; }
  const mem = RS.memOf(x, y, z);
  if (mem.locked === undefined) mem.locked = RS.neighborSignal(g, x, y, z);
  if (mem.locked) return;
  const id = w.getBlock(x, y, z), f = prop(id, w.getMeta(x, y, z), 'facing') || 'down', v = RS_DIRS[f];
  let moved = false;
  // out
  const out = RS.container(g, x + v[0], y + v[1], z + v[2]);
  if (out) {
    for (let i = 0; i < 5 && !moved; i++) {
      const s = be.slots[i]; if (!s) continue;
      const left = RS.insert(out, { ...s, count: 1 }, RS_OPP[f]);
      if (!left) { s.count--; if (!s.count) be.slots[i] = null; moved = true; }
    }
  }
  // in: from the container above, else items lying on it
  const self = RS.container(g, x, y, z);
  const src = RS.container(g, x, y + 1, z);
  if (src) {
    for (let i = 0; i < src.size; i++) {
      const s = src.get(i); if (!s || !src.canOut(i, 'down')) continue;
      const left = RS.insert(self, { ...s, count: 1 }, 'up');
      if (!left) { s.count--; if (!s.count) src.set(i, null); moved = true; break; }
    }
  } else if (!conductor(w.getBlock(x, y + 1, z)) || rsk(w.getBlock(x, y + 1, z)) === 'hopper') {
    for (const e of g.entities) {
      if (!(e instanceof ItemEntity) || e.dead) continue;
      if (e.pos[0] < x || e.pos[0] > x + 1 || e.pos[2] < z || e.pos[2] > z + 1 || e.pos[1] < y + 0.6 || e.pos[1] > y + 2) continue;
      const left = RS.insert(self, e.stack, 'up');
      if (!left) e.dead = true; else if (left.count !== e.stack.count) e.stack = left; else continue;
      moved = true; break;
    }
  }
  if (moved) { be.cd = 8; RS.wake(x, y, z); }
};

// ---- daylight detectors: once a second, power from the sky light and the sun's height ----
RS.daylight = function (g) {
  const w = g.world, id = BID.daylight_detector; if (id === undefined) return;
  const p = g.player, pcx = Math.floor(p.pos[0]) >> 4, pcz = Math.floor(p.pos[2]) >> 4, R = Math.min(8, g.renderer ? g.renderer.renderDist : 8);
  const t = ((w.time % 24000) / 24000 - 0.25 + 1) % 1, f0 = t, d0 = 0.5 - Math.cos(f0 * Math.PI) / 2, cel = (f0 * 2 + d0) / 3, sun = cel * Math.PI * 2;
  let dark = 1 - (Math.cos(sun) * 2 + 0.5); dark = clamp(dark, 0, 1);
  dark = 1 - dark; dark *= 1 - (g.weather || 0) * 5 / 16; dark = 1 - dark;
  const skyDarken = Math.floor(dark * 11);
  for (let cx = pcx - R; cx <= pcx + R; cx++) for (let cz = pcz - R; cz <= pcz + R; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    ch.findAll([id], (i) => {
      const x = cx * 16 + (i & 15), y = i >> 8, z = cz * 16 + ((i >> 4) & 15), m = w.getMeta(x, y, z);
      let pw = w.skyAt(x, y, z) - skyDarken;
      if (prop(id, m, 'inverted') === 'true') pw = 15 - pw;
      else if (pw > 0) { let a = sun; const target = a < Math.PI ? 0 : Math.PI * 2; a += (target - a) * 0.2; pw = Math.round(pw * Math.cos(a)); }
      pw = clamp(pw, 0, 15);
      const mem = RS.memOf(x, y, z);
      if (mem.power !== pw) { mem.power = pw; RS.wake(x, y, z); }
    });
  }
};

// comparators near the player check what they read again (a container filled by hand, a furnace cooking ...)
RS.refreshComparators = function (g) {
  const w = g.world, id = BID.comparator; if (id === undefined) return;
  const p = g.player, pcx = Math.floor(p.pos[0]) >> 4, pcz = Math.floor(p.pos[2]) >> 4, R = Math.min(6, g.renderer ? g.renderer.renderDist : 6);
  for (let cx = pcx - R; cx <= pcx + R; cx++) for (let cz = pcz - R; cz <= pcz + R; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    ch.findAll([id], (i) => RS.enqueue(cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)));
  }
};
// ---- breaking a component that lost its support ----
Game.prototype.breakRS = function (x, y, z) {
  const w = this.world, id = w.getBlock(x, y, z); if (!id) return;
  this.dropBlockLoot(x, y, z, id, w.getMeta(x, y, z), null);
  w.setBlock(x, y, z, 0, 0);
  RS.wake(x, y, z);
};

// ---- using the components ----
const RS_USE = {
  lever(g, x, y, z) {
    const id = g.world.getBlock(x, y, z), m = g.world.getMeta(x, y, z), on = prop(id, m, 'powered') !== 'true';
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', on));
    Sound.ev('block.lever.click', [x + 0.5, y + 0.5, z + 0.5], 0.3, on ? 0.6 : 0.5);
    RS.process(g);
    return true;
  },
  button(g, x, y, z) {
    const id = g.world.getBlock(x, y, z), m = g.world.getMeta(x, y, z), k = rsk(id);
    if (prop(id, m, 'powered') === 'true') return true;
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'powered', true));
    const stone = k.startsWith('stone') || k.includes('blackstone');
    g.world.schedule(x, y, z, stone ? 20 : 30);
    Sound.ev(stone ? 'block.stone_button.click_on' : 'block.wooden_button.click_on', [x + 0.5, y + 0.5, z + 0.5], 0.3, 0.6);
    RS.process(g);
    return true;
  },
  repeater(g, x, y, z) {
    const id = g.world.getBlock(x, y, z), m = g.world.getMeta(x, y, z), d = (+prop(id, m, 'delay') || 1) % 4 + 1;
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'delay', d)); RS.process(g);
    return true;
  },
  comparator(g, x, y, z) {
    const id = g.world.getBlock(x, y, z), m = g.world.getMeta(x, y, z), sub = prop(id, m, 'mode') !== 'subtract';
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'mode', sub ? 'subtract' : 'compare'));
    Sound.ev('block.comparator.click', [x + 0.5, y + 0.5, z + 0.5], 0.3, sub ? 0.55 : 0.5);
    g.world.schedule(x, y, z, 2); RS.process(g);
    return true;
  },
  daylight(g, x, y, z) {
    const id = g.world.getBlock(x, y, z), m = g.world.getMeta(x, y, z);
    RS.set(g, x, y, z, id, Features.withProp(id, m, 'inverted', prop(id, m, 'inverted') !== 'true')); RS.daylight(g); RS.process(g);
    return true;
  },
  // dust: a cross becomes a dot and back (only while nothing joins it)
  wire(g, x, y, z) {
    // (game.js picks the use by the target's remembered block, t.id: dust gone from there since - washed away, broken
    // by the same tick's update - left air, and air's missing states threw 'reading 0', telemetry 11-02/03)
    const w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z), st = isWire(id) && BLOCKS[id].states && BLOCKS[id].states[m];
    if (!st) return false;
    const cross = RS_H.every(d => st[d] === 'side'), dot = isDotMeta(id, m);
    if (!cross && !dot) return false;
    const side = {}; for (const d of RS_H) side[d] = cross ? 'none' : 'side';
    w.setBlock(x, y, z, id, wireMeta(id, side)); RS.wake(x, y, z); RS.process(g);
    return true;
  },
  container(g, x, y, z) {
    const k = rsk(g.world.getBlock(x, y, z)), be = RS.be(g, x, y, z, k);
    g.ui.open(k === 'hopper' ? new HopperScreen(g, be) : k === 'crafter' ? new CrafterScreen(g, be) : new DispenserScreen(g, be, BLOCKS[g.world.getBlock(x, y, z)].cn));
    return true;
  },
};
for (const b of BLOCKS) {
  if (!b) continue;
  const k = b.key;
  if (k === 'lever') b.onUse = RS_USE.lever;
  else if (RS_BUTTON.test(k)) b.onUse = RS_USE.button;
  else if (k === 'repeater') b.onUse = RS_USE.repeater;
  else if (k === 'comparator') b.onUse = RS_USE.comparator;
  else if (k === 'daylight_detector') b.onUse = RS_USE.daylight;
  else if (b.wirePower !== undefined) b.onUse = RS_USE.wire;
  else if (/^(hopper|dispenser|dropper|crafter)$/.test(k)) b.onUse = RS_USE.container;
}

// ---- the screens of dispensers / droppers, hoppers and the crafter ----
class DispenserScreen extends ContainerScreen {
  constructor(game, be, title) {
    super(game, 'gui_dispenser', 176, 166, title || '发射器');
    this.be = be; this.titleX = 88 - Math.floor(Font.width(this.title) / 2);
    for (let i = 0; i < 9; i++) this.slots.push({ x: 62 + (i % 3) * 18, y: 17 + Math.floor(i / 3) * 18, group: 'container', get: () => be.slots[i], set: (s) => { be.slots[i] = s; } });
    this.addPlayerSlots(84, 142);
  }
  drawExtra(ui) { Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 72, '#404040', false); }
}
class HopperScreen extends ContainerScreen {
  constructor(game, be) {
    super(game, 'gui_hopper', 176, 133, '漏斗');
    this.be = be;
    for (let i = 0; i < 5; i++) this.slots.push({ x: 44 + i * 18, y: 20, group: 'container', get: () => be.slots[i], set: (s) => { be.slots[i] = s; } });
    this.addPlayerSlots(51, 109);
  }
  drawExtra(ui) { Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 39, '#404040', false); }
}
class CrafterScreen extends ContainerScreen {
  constructor(game, be) {
    super(game, 'gui_crafter', 176, 166, '合成器');
    this.be = be; be.disabled = be.disabled || [];
    for (let i = 0; i < 9; i++) this.slots.push({ x: 26 + (i % 3) * 18, y: 17 + Math.floor(i / 3) * 18, group: 'container', idx: i, accept: () => !be.disabled.includes(i), get: () => be.slots[i], set: (s) => { be.slots[i] = s; } });
    this.addPlayerSlots(84, 142);
  }
  // clicking an empty slot with nothing held turns it off (or on again)
  mouseDown(ui, mx, my, button, shift) {
    const s = this.slotAt(mx, my);
    if (s && s.idx !== undefined && !s.get() && !ui.cursor && button === 0) {
      const d = this.be.disabled, k = d.indexOf(s.idx);
      if (k >= 0) d.splice(k, 1); else d.push(s.idx);
      Sound.click(); return;
    }
    super.mouseDown(ui, mx, my, button, shift);
  }
  drawExtra(ui) {
    for (const s of this.slots) if (s.idx !== undefined && this.be.disabled.includes(s.idx)) ui.sprite('crafter_disabled_slot', this.x + s.x - 1, this.y + s.y - 1);
    const res = RS.craftResult(this.be);
    if (res) ui.drawItem(res, this.x + 134, this.y + 35);
    const [x, y, z] = this.be.pos, id = this.game.world.getBlock(x, y, z);
    ui.sprite(prop(id, this.game.world.getMeta(x, y, z), 'triggered') === 'true' ? 'crafter_powered_redstone' : 'crafter_unpowered_redstone', this.x + 97, this.y + 34);
    Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 72, '#404040', false);
  }
}

// ---- hooks into the game ----
const RS_IDS = new Set();
for (const b of BLOCKS) if (b && (rsSource(b.id) || /^(redstone_lamp|piston|sticky_piston|piston_head|tnt|note_block|bell|dispenser|dropper|hopper|crafter|powered_rail|activator_rail|daylight_detector|tripwire|tripwire_hook|target)$|copper_bulb$/.test(b.key) || b.door || b.trapdoor || b.gate)) RS_IDS.add(b.id);
// a neighbour changed: the component checks itself (the queue keeps it from going deep)
const _rsNeighbor = Game.prototype.onNeighborUpdate;
Game.prototype.onNeighborUpdate = function (x, y, z, id) {
  _rsNeighbor.call(this, x, y, z, id);
  if (this.net || !RS_IDS.has(this.world.getBlock(x, y, z))) return;
  RS.enqueue(x, y, z); RS.process(this);
};
// placed, broken or changed: observers watching it, the piston's head and the piston, and new components
const _rsChanged = Game.prototype.onBlockChanged;
Game.prototype.onBlockChanged = function (x, y, z, old, id, oldMeta) {
  _rsChanged.call(this, x, y, z, old, id, oldMeta);
  if (this.net || !this.world) return;
  RS.observe(this, x, y, z);
  if (old === id) return;
  const ok = rsk(old), nk = rsk(id), w = this.world;
  // an extended piston's head goes with it, and a piston loses its head's piston
  if ((ok === 'piston' || ok === 'sticky_piston') && Features.propOf(old, oldMeta, 'extended') === 'true' && nk !== ok) {
    const v = RS_DIRS[Features.propOf(old, oldMeta, 'facing')]; if (v && rsk(w.getBlock(x + v[0], y + v[1], z + v[2])) === 'piston_head') w.setBlock(x + v[0], y + v[1], z + v[2], 0, 0);
  }
  if (ok === 'piston_head' && nk !== ok && !RS.busy) {
    const v = RS_DIRS[Features.propOf(old, oldMeta, 'facing')];
    if (v) { const px = x - v[0], py = y - v[1], pz = z - v[2], pid = w.getBlock(px, py, pz); if (/^(sticky_)?piston$/.test(rsk(pid)) && prop(pid, w.getMeta(px, py, pz), 'extended') === 'true') this.breakBlock ? this.breakBlock(px, py, pz, true) : w.setBlock(px, py, pz, 0, 0); }
  }
  if (nk === 'hopper' || nk === 'dispenser' || nk === 'dropper' || nk === 'crafter') RS.be(this, x, y, z, nk);
  if (RS_IDS.has(id) || RS_IDS.has(old) || (BLOCKS[old] && BLOCKS[old].wirePower !== undefined) || isWire(id)) { RS.wake(x, y, z); RS.process(this); }
};
// a block's state changed without a new block (setMeta): observers see that too
const _rsSetMeta = World.prototype.setMeta;
World.prototype.setMeta = function (x, y, z, meta) {
  const before = this.getMeta(x, y, z);
  _rsSetMeta.call(this, x, y, z, meta);
  if (before !== meta && this.listener && this.listener.onMetaChanged) this.listener.onMetaChanged(x, y, z);
};
Game.prototype.onMetaChanged = function (x, y, z) { if (!this.net) RS.observe(this, x, y, z); };
// scheduled ticks of components
const _rsFire = Game.prototype.fireTick;
Game.prototype.blockTick = function (x, y, z) { if (this.net) return false; const r = RS.tick(this, x, y, z); RS.process(this); return r; };
const _rsTickScheduled = World.prototype.tickScheduled;
World.prototype.tickScheduled = function () {
  if (!this.ticks.size) return;
  const L = this.listener;
  if (!L || !L.blockTick) return _rsTickScheduled.call(this);
  // components' ticks are taken out first; fire and fluids go on as before
  const due = [];
  for (const [k, v] of this.ticks) if (v.t <= this.time && RS_IDS.has(this.getBlock(v.x, v.y, v.z))) { due.push(v); this.ticks.delete(k); }
  for (const t of due) L.blockTick(t.x, t.y, t.z);
  return _rsTickScheduled.call(this);
};
// each tick: plates, tripwires and detector rails under entities; hoppers; daylight detectors
const _rsGameTick = Game.prototype.tick;
Game.prototype.tick = function () {
  _rsGameTick.call(this);
  if (this.net || this.state !== 'play' || !this.world || (this.ui.screen && this.ui.screen.pauses)) return;
  const w = this.world;
  for (const e of [this.player, ...this.entities]) {
    if (!e || e.dead) continue;
    const x = Math.floor(e.pos[0]), y = Math.floor(e.pos[1] + 0.01), z = Math.floor(e.pos[2]), id = w.getBlock(x, y, z), k = rsk(id);
    if (RS_PLATE.test(k)) { const m = w.getMeta(x, y, z); if (!(prop(id, m, 'powered') === 'true' || +prop(id, m, 'power') > 0)) RS.plateCheck(this, x, y, z); }
    else if (k === 'tripwire') { const hookOn = false; if (!hookOn) RS.tripCheck(this, x, y, z); }
    else if (k === 'detector_rail' && e instanceof Minecart && prop(id, w.getMeta(x, y, z), 'powered') !== 'true') RS.detectorCheck(this, x, y, z);
  }
  for (const be of this.blockEntities.values()) if (be.type === 'hopper' && w.isLoaded(be.pos[0], be.pos[2])) RS.hopperTick(this, be);
  if (this.tickCount % 20 === 0) RS.daylight(this);
  if (this.tickCount % 10 === 5) RS.refreshComparators(this);
  RS.process(this);
};
// placing: an observer looks the way the player looks, tripwire hooks face out of their wall, torches start lit
const _rsPlaceState = Game.prototype.placeState;
Game.prototype.placeState = function (b, t, hdir) {
  let m = _rsPlaceState.call(this, b, t, hdir);
  const k = b.key;
  if (k === 'observer') { const look = this.lookDir(), ax = Math.abs(look[0]), ay = Math.abs(look[1]), az = Math.abs(look[2]); m = Features.withProp(b.id, m, 'facing', ay > ax && ay > az ? (look[1] > 0 ? 'up' : 'down') : ax > az ? (look[0] > 0 ? 'east' : 'west') : (look[2] > 0 ? 'south' : 'north')); }
  if (k === 'tripwire_hook' && t.face !== 2 && t.face !== 3) m = Features.withProp(b.id, m, 'facing', FACE_NAME[t.face]);
  if (k === 'redstone_torch' || k === 'redstone_wall_torch') m = Features.withProp(b.id, m, 'lit', true);
  if (k === 'hopper') m = Features.withProp(b.id, m, 'facing', t.face === 3 || t.face === 2 ? 'down' : FACE_NAME[[1, 0, 2, 3, 5, 4][t.face]]);
  return m;
};
// chunks coming in: their components settle (dust power is saved; the rest checks itself)
RS.settleChunk = function (g, ch) {
  const ids = [...RS_IDS].filter(id => { const k = rsk(id); return /^(redstone_torch|redstone_wall_torch|repeater|comparator|observer|redstone_lamp|piston|sticky_piston|hopper)$/.test(k); });
  ch.findAll(ids, (i) => RS.enqueue(ch.cx * 16 + (i & 15), i >> 8, ch.cz * 16 + ((i >> 4) & 15)));
};
// arrows that stick in a target block power it
const _rsArrowTick = Arrow.prototype.tick;
Arrow.prototype.tick = function () {
  const was = this.stuck;
  _rsArrowTick.call(this);
  if (!was && this.stuck && this.stuckAt && !this.game.net && rsk(this.game.world.getBlock(...this.stuckAt)) === 'target') RS.targetHit(this.game, ...this.stuckAt, this.pos, true);
};
// trapped chests: opening and closing them changes their power
const _rsChestOpen = ChestScreen.prototype.close;
ChestScreen.prototype.close = function () { _rsChestOpen.call(this); for (const be of this.bes || []) { const [x, y, z] = be.pos; if (rsk(this.game.world.getBlock(x, y, z)) === 'trapped_chest') { RS.wake(x, y, z); RS.process(this.game); } } };
const _rsOpenUI = UI.prototype.open;
UI.prototype.open = function (sc) {
  const r = _rsOpenUI.call(this, sc);
  const g = this.game;
  if (sc instanceof ChestScreen && !g.net) for (const be of sc.bes || []) { const [x, y, z] = be.pos; if (rsk(g.world.getBlock(x, y, z)) === 'trapped_chest') { RS.wake(x, y, z); RS.process(g); } }
  return r;
};
