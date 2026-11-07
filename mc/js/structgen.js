'use strict';
// ---------------------------------------------------------------------------
// Vanilla structures for gen-2 worlds, run inside the generation worker:
//  - structure-set placement (random_spread with salts, frequency reduction, exclusion zones)
//  - jigsaw assembly (JigsawPlacement: pools, weighted shuffles, rotations, free-space checks,
//    rigid / terrain_matching projection, junctions, pool aliases, the expansion hack)
//  - terrain adaptation (the beardifier added to the final density)
//  - template placement clipped to the chunk being generated, with the processors
//    (jigsaw replacement, ignore air / structure blocks, rule, block_rot, protected_blocks, gravity)
// Data: tools/build_structures.py -> structures_data.js. Block states are global indices into
// STRUCT_DATA.states; the main thread sends their [id, meta] (SG.setStateMap).
// ---------------------------------------------------------------------------
(function () {
  const SG = (self.SG = {});
  const D = self.STRUCT_DATA;
  const strip = (s) => (typeof s === 'string' ? s.replace('minecraft:', '') : s);
  const M64 = (v) => BigInt.asIntN(64, v);
  // the templates are unpacked on first use: the page only places structures itself when it has no workers
  let BLOB = null, readyP = null;
  Object.defineProperty(SG, 'ready', { get: () => readyP || (readyP = (async () => {
    const bin = Uint8Array.from(atob(self.STRUCT_BLOB), (c) => c.charCodeAt(0));
    const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    BLOB = new Uint8Array(await new Response(ds).arrayBuffer());
  })()) });

  // ---- block states ------------------------------------------------------------------------------
  let SMAP = null; // Int32Array: [id, meta] per state; id -1 = skip, -2 = jigsaw
  const NAMES = D.states.map((s) => s.split('[')[0]);
  let SWL = null; // per state: 2 = the block can hold water, 1 = the template has it waterlogged
  SG.setStateMap = (a, wl) => { SMAP = a; SG.smap = a; SWL = wl || null; };
  // StructureTemplate.placeInWorld: a block keeps the template's water, and one that can hold water placed where a
  // water source was takes that in (ocean ruins, shipwrecks); out.wl: the chunk's waterlogged cells
  const putWl = (out, k, g, was, wasM) => {
    const f = SWL ? SWL[g] : 0;
    if ((f & 1) || ((f & 2) && was === SG.PAL.water && wasM === 0)) out.wl.add(k); else out.wl.delete(k);
  };
  let TAGS = null, ID_NAME = null;
  const tag = (t) => {
    t = strip(t).replace(/^#/, '');
    if (!TAGS) TAGS = new Map();
    let s = TAGS.get(t);
    if (!s) { s = new Set((self.BLOCK_TAGS && self.BLOCK_TAGS[t]) || []); TAGS.set(t, s); }
    return s;
  };
  SG.setPalette = (pal) => { SG.PAL = pal; ID_NAME = []; for (const k in pal) ID_NAME[pal[k]] = k; ID_NAME[0] = 'air'; SG.ID_NAME = ID_NAME; };

  // ---- randoms -----------------------------------------------------------------------------------
  const JR = (seed) => new WG.JRand(seed === undefined ? 0n : seed);
  const saltSeed = (r, seed, x, z, salt) => r.setSeed(M64(BigInt(x) * 341873128712n + BigInt(z) * 132897987541n + seed + BigInt(salt)));
  function posSeed(x, y, z) { // Mth.getSeed
    const l = M64(BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y));
    return M64(M64(l * l * 42317861n) + l * 11n) >> 16n;
  }
  const shuffle = (list, r) => { for (let i = list.length; i > 1; i--) { const k = r.nextInt(i), t = list[i - 1]; list[i - 1] = list[k]; list[k] = t; } return list; };
  const weighted = (list, r, w = (e) => e.weight) => {
    let tot = 0; for (const e of list) tot += w(e);
    let i = r.nextInt(tot);
    for (const e of list) { i -= w(e); if (i < 0) return e; }
    return list[list.length - 1];
  };

  // ---- directions / rotations ------------------------------------------------------------------
  const HOR = ['north', 'east', 'south', 'west'];
  const VEC = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  const OPP = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };
  const rotDir = (d, n) => (HOR.includes(d) ? HOR[(HOR.indexOf(d) + n) & 3] : d);
  // StructureTemplate.transform with pivot 0 (rotation: 0 none, 1 cw 90, 2 180, 3 ccw 90)
  const rotPos = (x, y, z, rot) => (rot === 1 ? [-z, y, x] : rot === 2 ? [-x, y, -z] : rot === 3 ? [z, y, -x] : [x, y, z]);
  const rotPosM = (x, y, z, rot, mir, px, pz) => {
    if (mir === 1) z = -z; else if (mir === 2) x = -x;
    switch (rot) {
      case 1: return [px + pz - z, y, pz - px + x];
      case 2: return [px + px - x, y, pz + pz - z];
      case 3: return [px - pz + z, y, px + pz - x];
    }
    return [x, y, z];
  };
  const boxOf = (sx, sy, sz, pos, rot) => {
    const a = rotPos(0, 0, 0, rot), b = rotPos(sx - 1, sy - 1, sz - 1, rot);
    return [Math.min(a[0], b[0]) + pos[0], pos[1], Math.min(a[2], b[2]) + pos[2], Math.max(a[0], b[0]) + pos[0], pos[1] + sy - 1, Math.max(a[2], b[2]) + pos[2]];
  };
  const inside = (b, x, y, z) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5];
  const overlap = (a, b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];

  // ---- templates & pool elements ---------------------------------------------------------------
  const TPL = D.templates;
  const PROC = new Map();
  function processors(p) {
    if (!p) return [];
    if (typeof p === 'string') {
      let r = PROC.get(p);
      if (!r) { const d = D.processor_list[strip(p)]; r = d ? (d.processors || []) : []; PROC.set(p, r); }
      return r;
    }
    return p.processors || (Array.isArray(p) ? p : []);
  }
  const FEATURE_JIG = { x: 0, y: 0, z: 0, front: 'down', top: 'south', name: 'bottom', target: 'empty', pool: 'empty', rollable: true, final: -1, pp: 0, sp: 0 };
  const ELS = new WeakMap();
  function element(j) {
    let e = ELS.get(j);
    if (e) return e;
    const t = strip(j.element_type);
    if (t === 'empty_pool_element') e = { type: 'empty' };
    else if (t === 'feature_pool_element') e = { type: 'feature', feature: strip(j.feature), proj: j.projection };
    else if (t === 'list_pool_element') e = { type: 'list', list: j.elements.map(element), proj: j.projection };
    else {
      const tpl = TPL[strip(j.location)];
      e = tpl ? { type: t === 'legacy_single_pool_element' ? 'legacy' : 'single', name: strip(j.location), tpl, proc: processors(j.processors), proj: j.projection }
        : { type: 'empty' };
    }
    ELS.set(j, e);
    return e;
  }
  function elBox(e, pos, rot) {
    if (e.type === 'feature') return [pos[0], pos[1], pos[2], pos[0], pos[1], pos[2]];
    if (e.type === 'list') {
      const bs = e.list.filter((m) => m.type !== 'empty').map((m) => elBox(m, pos, rot));
      return bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])]);
    }
    const s = e.tpl.size;
    return boxOf(s[0], s[1], s[2], pos, rot);
  }
  function elJigsaws(e, pos, rot, r) {
    let list;
    if (e.type === 'feature') list = [{ ...FEATURE_JIG, x: pos[0], y: pos[1], z: pos[2] }];
    else if (e.type === 'list') return elJigsaws(e.list[0], pos, rot, r);
    else {
      list = e.tpl.jig.map((j) => {
        const p = rotPos(j[0], j[1], j[2], rot), [f, t] = j[3].split('_');
        const front = rotDir(f, rot), top = rotDir(t, rot);
        return { x: p[0] + pos[0], y: p[1] + pos[1], z: p[2] + pos[2], front, top, name: j[4], target: j[5], pool: j[6],
          rollable: j[7] ? j[7] === 'rollable' : !HOR.includes(front), final: j[8], pp: j[9], sp: j[10] };
      });
    }
    shuffle(list, r);
    list.sort((a, b) => b.sp - a.sp);
    return list;
  }
  const canAttach = (a, b) => a.front === OPP[b.front] && (a.rollable || a.top === b.top) && a.target === b.name;

  const POOLS = new Map();
  function pool(name) {
    name = strip(name);
    let p = POOLS.get(name);
    if (p) return p;
    const d = D.template_pool[name];
    if (!d) { POOLS.set(name, null); return null; }
    const els = [];
    for (const ent of d.elements) { const e = element(ent.element); for (let i = 0; i < ent.weight; i++) els.push(e); }
    p = { name, els, fallback: strip(d.fallback || 'empty'), maxSize: -1 };
    POOLS.set(name, p);
    return p;
  }
  const poolMax = (p) => {
    if (!p) return 0;
    if (p.maxSize < 0) { p.maxSize = 0; for (const e of p.els) if (e.type !== 'empty') { const b = elBox(e, [0, 0, 0], 0); p.maxSize = Math.max(p.maxSize, b[4] - b[1] + 1); } }
    return p.maxSize;
  };

  // ---- generator glue ----------------------------------------------------------------------------
  // structures that can appear in a dimension (their biomes occur in its biome source)
  const SETS = {};
  function setsFor(gen) {
    if (SETS[gen.dim]) return SETS[gen.dim];
    const biomes = new Set((gen.dim === 'nether' ? WG.netherParameters() : WG.overworldParameters()).map((p) => p[1]));
    const out = [];
    for (const [name, s] of Object.entries(D.structure_set)) {
      const pl = s.placement;
      if (strip(pl.type) !== 'random_spread') continue; // strongholds keep the game's own placement
      const list = s.structures.map((e) => ({ name: strip(e.structure), weight: e.weight, def: D.structure[strip(e.structure)] }))
        .filter((e) => e.def && SUPPORTED(e.def) && biomeSet(e.def.biomes).some((b) => biomes.has(b)));
      if (!list.length) continue;
      // how far (in chunks) pieces can reach from their start chunk
      const reach = (d) => { const t = strip(d.type); return t === 'jigsaw' ? Math.ceil(((d.max_distance_from_center || 80) + 32) / 16) : t === 'mineshaft' ? 7 : t === 'fortress' ? 5 : t === 'ocean_ruin' ? 3 : 2; };
      out.push({ name, list, pl, salt: BigInt(pl.salt), spacing: pl.spacing, sep: pl.separation, R: Math.max(...list.map((e) => reach(e.def))), pot: new Map() });
    }
    return (SETS[gen.dim] = out);
  }
  const SUPPORTED = (def) => strip(def.type) === 'jigsaw' || strip(def.type) === 'fortress' || !!SG.TYPES[strip(def.type)];
  const BIOMESETS = new Map();
  function biomeSet(b) {
    let s = BIOMESETS.get(b);
    if (!s) { s = [].concat(b).flatMap((x) => (x.startsWith('#') ? D.biome_tags[strip(x.slice(1))] || [] : [strip(x)])); BIOMESETS.set(b, s); }
    return s;
  }

  // RandomSpreadStructurePlacement
  function potential(set, seed, cx, cz) {
    const sp = set.spacing, i = Math.floor(cx / sp), j = Math.floor(cz / sp);
    if (set.pot) { const k = i * 1048576 + j, c = set.pot.get(k); if (c) return c; const v = potential0(set, seed, i, j, sp); if (set.pot.size > 50000) set.pot.clear(); set.pot.set(k, v); return v; }
    return potential0(set, seed, i, j, sp);
  }
  function potential0(set, seed, i, j, sp) {
    const r = JR();
    saltSeed(r, seed, i, j, set.salt);
    const k = sp - set.sep, tri = set.pl.spread_type === 'triangular';
    const ev = () => (tri ? (r.nextInt(k) + r.nextInt(k)) >> 1 : r.nextInt(k));
    const l = ev(), m = ev();
    return [i * sp + l, j * sp + m];
  }
  function frequencyOk(set, seed, cx, cz) {
    const f = set.pl.frequency ?? 1;
    if (f >= 1) return true;
    const method = set.pl.frequency_reduction_method || 'default', r = JR();
    switch (method) {
      case 'legacy_type_1': { const i = cx >> 4, j = cz >> 4; r.setSeed(BigInt(i ^ (j << 4)) ^ seed); r.nextInt(); return r.nextInt(Math.trunc(1 / Math.fround(f))) === 0; }
      case 'legacy_type_2': saltSeed(r, seed, cx, cz, 10387320n); return r.nextFloat() < f;
      case 'legacy_type_3': r.largeFeatureSeed(seed, cx, cz); return r.nextDouble() < f;
      default: saltSeed(r, seed, set.salt, cx, BigInt(cz)); return r.nextFloat() < f; // (seed, salt, x, z) argument order as in vanilla
    }
  }
  function isStructureChunk(gen, set, cx, cz) {
    const seed = gen.rs.seed, p = potential(set, seed, cx, cz);
    if (p[0] !== cx || p[1] !== cz || !frequencyOk(set, seed, cx, cz)) return false;
    const ex = set.pl.exclusion_zone;
    if (ex) {
      const other = setsFor(gen).find((s) => s.name === strip(ex.other_set)) || mkSet(strip(ex.other_set));
      if (other) for (let a = cx - ex.chunk_count; a <= cx + ex.chunk_count; a++) for (let b = cz - ex.chunk_count; b <= cz + ex.chunk_count; b++) {
        const q = potential(other, seed, a, b);
        if (q[0] === a && q[1] === b && frequencyOk(other, seed, a, b)) return false;
      }
    }
    return true;
  }
  const mkSet = (name) => { const s = D.structure_set[name]; return s && strip(s.placement.type) === 'random_spread' ? { name, pl: s.placement, salt: BigInt(s.placement.salt), spacing: s.placement.spacing, sep: s.placement.separation } : null; };

  // ---- starts -----------------------------------------------------------------------------------
  const STARTS = new Map();
  function startsAt(gen, cx, cz) {
    const key = gen.dim + ':' + cx + ',' + cz;
    let out = STARTS.get(key);
    if (out) return out;
    out = [];
    for (const set of setsFor(gen)) {
      if (!isStructureChunk(gen, set, cx, cz)) continue;
      if (set.list.length === 1) { const s = tryStructure(gen, set.list[0], cx, cz); if (s) out.push(s); continue; }
      const list = set.list.slice(), r = JR();
      r.largeFeatureSeed(gen.rs.seed, cx, cz);
      let tot = 0; for (const e of list) tot += e.weight;
      while (list.length) {
        let j = r.nextInt(tot), k = 0;
        for (const e of list) { j -= e.weight; if (j < 0) break; k++; }
        const e = list[k], s = tryStructure(gen, e, cx, cz);
        if (s) { out.push(s); break; }
        list.splice(k, 1); tot -= e.weight;
      }
    }
    if (STARTS.size > 4000) STARTS.clear();
    STARTS.set(key, out);
    return out;
  }
  function tryStructure(gen, e, cx, cz) {
    const r = JR();
    r.largeFeatureSeed(gen.rs.seed, cx, cz);
    const def = e.def;
    const t = strip(def.type);
    if (t === 'jigsaw') return jigsaw(gen, e.name, def, cx, cz, r);
    if (SG.TYPES[t]) return SG.TYPES[t](gen, e.name, def, cx, cz, r, SG.helpers);
    if (t === 'fortress') {
      // NetherFortressStructure: the pieces are still built by the game's own fortress builder (main thread);
      // here only its position (start at chunk + 2, moved to y 48..70) and the biome check
      const x = cx * 16 + 2, z = cz * 16 + 2;
      if (!new Set(biomeSet(def.biomes)).has(gen.biomeAtQuart(x >> 2, 64 >> 2, z >> 2))) return null;
      const y = 48 + r.nextInt(23);
      return { name: e.name, def, pieces: [], box: [x - 64, y - 30, z - 64, x + 64, y + 12, z + 64], adapt: 'none', fortress: [x + 6, y, z + 6] };
    }
    return null;
  }
  // height provider / vertical anchor
  function anchor(gen, a) {
    if ('absolute' in a) return a.absolute;
    if ('above_bottom' in a) return gen.minY + a.above_bottom;
    return gen.minY + gen.height - 1 - a.below_top;
  }
  function sampleHeight(gen, h, r) {
    if (!h.type) return anchor(gen, h);
    const t = strip(h.type);
    if (t === 'constant') return anchor(gen, h.value);
    if (t === 'uniform') { const i = anchor(gen, h.min_inclusive), j = anchor(gen, h.max_inclusive); return r.nextInt(j - i + 1) + i; }
    return anchor(gen, h.min_inclusive || { absolute: 0 });
  }
  // pool aliases (trial chambers): resolved once per start
  function aliases(def, pos, seed) {
    const map = new Map();
    if (!def.pool_aliases) return map;
    const f = JR(seed).forkPositional(), r = f.at(pos[0], pos[1], pos[2]);
    for (const b of def.pool_aliases) {
      const t = strip(b.type);
      if (t === 'direct') map.set(strip(b.alias), strip(b.target));
      else if (t === 'random') map.set(strip(b.alias), strip(weighted(b.targets, r).data));
      else if (t === 'random_group') for (const d of weighted(b.groups, r).data) map.set(strip(d.alias), strip(d.target));
    }
    return map;
  }

  function jigsaw(gen, name, def, cx, cz, r) {
    const startY = sampleHeight(gen, def.start_height, r);
    const pos = [cx * 16, startY, cz * 16];
    const al = aliases(def, pos, gen.rs.seed), A = (p) => al.get(strip(p)) || strip(p);
    const rot = r.nextInt(4);
    const sp = pool(A(def.start_pool));
    if (!sp || !sp.els.length) return null;
    const el = sp.els[r.nextInt(sp.els.length)];
    if (el.type === 'empty') return null;
    let jp = pos;
    if (def.start_jigsaw_name) {
      const j = elJigsaws(el, pos, rot, r).find((q) => q.name === strip(def.start_jigsaw_name));
      if (!j) return null;
      jp = [j.x, j.y, j.z];
    }
    const off = [jp[0] - pos[0], jp[1] - pos[1], jp[2] - pos[2]];
    const p1 = [pos[0] - off[0], pos[1] - off[1], pos[2] - off[2]];
    const start = piece(el, p1, rot, 1);
    const bb = start.box;
    const ci = Math.trunc((bb[3] + bb[0]) / 2), cj = Math.trunc((bb[5] + bb[2]) / 2);
    const k = def.project_start_to_heightmap ? pos[1] + gen.baseHeight(ci, cj) : p1[1];
    movePiece(start, k - (bb[1] + start.gld));
    const cy = k + off[1];
    // Structure.isValidBiome at the start's centre
    if (!new Set(biomeSet(def.biomes)).has(gen.biomeAtQuart(ci >> 2, cy >> 2, cj >> 2))) return null;
    const pad = def.dimension_padding || 0, padB = typeof pad === 'number' ? pad : pad.bottom || 0, padT = typeof pad === 'number' ? pad : pad.top || 0;
    if (pad && (start.box[1] < gen.minY + padB || start.box[4] > gen.minY + gen.height - 1 - padT)) return null;
    const pieces = [start];
    const maxDepth = def.size;
    if (maxDepth > 0) {
      const md = def.max_distance_from_center || 80;
      const lim = [ci - md, Math.max(cy - md, gen.minY + padB), cj - md, ci + md + 1, Math.min(cy + md + 1, gen.minY + gen.height - padT), cj + md + 1];
      const free = { c: lim, holes: [start.box] };
      placeChildren(gen, r, def, A, pieces, maxDepth, start, free);
    }
    const sb = pieces.reduce((a, p) => [Math.min(a[0], p.box[0]), Math.min(a[1], p.box[1]), Math.min(a[2], p.box[2]), Math.max(a[3], p.box[3]), Math.max(a[4], p.box[4]), Math.max(a[5], p.box[5])], start.box.slice());
    return { name, def, pieces, box: sb, adapt: def.terrain_adaptation || 'none', step: def.step, liquid: def.liquid_settings };
  }
  const piece = (el, pos, rot, gld) => ({ el, pos: pos.slice(), rot, box: elBox(el, pos, rot), gld, rigid: el.proj !== 'terrain_matching', junctions: [] });
  const movePiece = (p, dy) => { p.pos[1] += dy; p.box[1] += dy; p.box[4] += dy; };
  // free space = container box minus placed boxes; a candidate fits when its box (deflated by 0.25)
  // lies inside the container and touches none of the holes
  const fits = (free, b) => {
    const c = free.c;
    if (b[0] + 0.25 < c[0] || b[3] + 0.75 > c[3] || b[1] + 0.25 < c[1] || b[4] + 0.75 > c[4] || b[2] + 0.25 < c[2] || b[5] + 0.75 > c[5]) return false;
    for (const h of free.holes) if (overlap(b, h)) return false;
    return true;
  };

  function placeChildren(gen, r, def, A, pieces, maxDepth, start, startFree) {
    const queue = new Map(); // placement priority -> FIFO
    const push = (st, pr) => { let q = queue.get(pr); if (!q) queue.set(pr, (q = [])); q.push(st); };
    const next = () => { let best = null; for (const [pr, q] of queue) if (q.length && (best === null || pr > best)) best = pr; return best === null ? null : queue.get(best).shift(); };
    const hack = !!def.use_expansion_hack;
    let st = { p: start, free: startFree, depth: 0 };
    while (st) {
      tryChildren(st.p, st.free, st.depth);
      st = next();
    }
    function tryChildren(par, freeIn, depth) {
      const el = par.el, rigid = par.rigid, bb = par.box, i = bb[1];
      let internal = null;
      outer:
      for (const jig of elJigsaws(el, par.pos, par.rot, r)) {
        const fv = VEC[jig.front], tx = jig.x + fv[0], ty = jig.y + fv[1], tz = jig.z + fv[2];
        const j = jig.y - i;
        let k = -1;
        const pname = A(jig.pool), p = pool(pname);
        if (!p || (!p.els.length && pname !== 'empty')) continue;
        const fb = pool(p.fallback);
        if (!fb || (!fb.els.length && p.fallback !== 'empty')) continue;
        let free;
        if (inside(bb, tx, ty, tz)) { if (!internal) internal = { c: [bb[0], bb[1], bb[2], bb[3] + 1, bb[4] + 1, bb[5] + 1], holes: [] }; free = internal; }
        else free = freeIn;
        const cands = [];
        if (depth !== maxDepth) cands.push(...shuffle(p.els.slice(), r));
        cands.push(...shuffle(fb.els.slice(), r));
        for (const el2 of cands) {
          if (el2.type === 'empty') break;
          for (const rot of shuffle([0, 1, 2, 3], r)) {
            const js2 = elJigsaws(el2, [0, 0, 0], rot, r), b0 = elBox(el2, [0, 0, 0], rot);
            let l = 0;
            if (hack && b0[4] - b0[1] + 1 <= 16) {
              for (const q of js2) {
                const v = VEC[q.front];
                if (!inside(b0, q.x + v[0], q.y + v[1], q.z + v[2])) continue;
                const qp = pool(A(q.pool));
                l = Math.max(l, poolMax(qp), poolMax(qp && pool(qp.fallback)));
              }
            }
            for (const j2 of js2) {
              if (!canAttach(jig, j2)) continue;
              const off = [tx - j2.x, ty - j2.y, tz - j2.z];
              const b2 = elBox(el2, off, rot), i1 = b2[1], rigid2 = el2.proj !== 'terrain_matching';
              const j1 = j2.y, k1 = j - j1 + fv[1];
              let l1;
              if (rigid && rigid2) l1 = i + k1;
              else { if (k === -1) k = gen.baseHeight(jig.x, jig.z); l1 = k - j1; }
              const i2 = l1 - i1;
              const b3 = [b2[0], b2[1] + i2, b2[2], b2[3], b2[4] + i2, b2[5]];
              const pos5 = [off[0], off[1] + i2, off[2]];
              if (l > 0) { const j3 = Math.max(l + 1, b3[4] - b3[1]); b3[4] = Math.max(b3[4], b3[1] + j3); }
              if (!fits(free, b3)) continue;
              free.holes.push(b3);
              const i3 = par.gld, k2 = rigid2 ? i3 - k1 : (el2.type === 'empty' ? 0 : 1);
              const np = { el: el2, pos: pos5, rot, box: b3, gld: k2, rigid: rigid2, junctions: [] };
              let l2;
              if (rigid) l2 = i + j;
              else if (rigid2) l2 = l1 + j1;
              else { if (k === -1) k = gen.baseHeight(jig.x, jig.z); l2 = k + Math.trunc(k1 / 2); }
              par.junctions.push([tx, l2 - j + i3, tz, k1, rigid2]);
              np.junctions.push([jig.x, l2 - j1 + k2, jig.z, -k1, rigid]);
              pieces.push(np);
              if (depth + 1 <= maxDepth) push({ p: np, free, depth: depth + 1 }, jig.pp);
              continue outer;
            }
          }
        }
      }
    }
  }

  // ---- per chunk ----------------------------------------------------------------------------------
  // starts whose pieces reach this chunk (+12 blocks for the terrain adaptation)
  SG.forChunk = function (gen, cx, cz) {
    if (!SMAP) return { starts: [], beard: null };
    const x0 = cx * 16, z0 = cz * 16, area = [x0 - 12, -1e9, z0 - 12, x0 + 27, 1e9, z0 + 27];
    const starts = [];
    for (const set of setsFor(gen)) {
      const R = set.R, sp = set.spacing;
      for (let ri = Math.floor((cx - R) / sp); ri <= Math.floor((cx + R) / sp); ri++)
        for (let rj = Math.floor((cz - R) / sp); rj <= Math.floor((cz + R) / sp); rj++) {
          const p = potential(set, gen.rs.seed, ri * sp, rj * sp);
          if (Math.abs(p[0] - cx) > R || Math.abs(p[1] - cz) > R) continue;
          for (const s of startsAt(gen, p[0], p[1])) if (overlap(s.box, area) && !starts.includes(s)) starts.push(s);
        }
    }
    return { starts, beard: beardifier(starts, x0, z0, gen.minY, gen.height) };
  };

  // nearest start of a structure (name prefix) around a chunk, searching rings of placement regions
  SG.locate = function (gen, name, cx, cz, maxRing = 12) {
    for (const set of setsFor(gen)) set._has = set.list.some((e) => e.name.startsWith(name));
    let best = null;
    for (let ring = 0; ring <= maxRing && !best; ring++) {
      for (const set of setsFor(gen)) {
        if (!set._has) continue;
        const sp = set.spacing, ri0 = Math.floor(cx / sp), rj0 = Math.floor(cz / sp);
        for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
          const p = potential(set, gen.rs.seed, (ri0 + a) * sp, (rj0 + b) * sp);
          for (const s of startsAt(gen, p[0], p[1])) {
            if (!s.name.startsWith(name)) continue;
            const x = (s.box[0] + s.box[3]) >> 1, z = (s.box[2] + s.box[5]) >> 1, d = Math.hypot(x - cx * 16, z - cz * 16);
            if (!best || d < best.d) best = { name: s.name, x, y: s.pieces[0].box[1], z, d };
          }
        }
      }
    }
    return best;
  };

  // Beardifier
  const KERNEL = new Float32Array(24 * 24 * 24);
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) for (let k = 0; k < 24; k++) {
    const x = j - 12, y = k - 12, z = i - 12, d = x * x + (y + 0.5) * (y + 0.5) + z * z;
    KERNEL[i * 576 + j * 24 + k] = Math.pow(Math.E, -d / 16);
  }
  const beardC = (x, y, z, yv) => {
    const i = x + 12, j = y + 12, k = z + 12;
    if (i < 0 || i >= 24 || j < 0 || j >= 24 || k < 0 || k >= 24) return 0;
    const d0 = yv + 0.5, d1 = x * x + d0 * d0 + z * z;
    return (-d0 / Math.sqrt(d1 / 2) / 2) * KERNEL[k * 576 + i * 24 + j];
  };
  const buryC = (x, y, z) => { const d = Math.sqrt(x * x + y * y + z * z); return d >= 6 ? 0 : 1 - d / 6; };
  function beardifier(starts, x0, z0, minY, H) {
    const rigids = [], juncs = [];
    for (const s of starts) {
      if (s.adapt === 'none') continue;
      const ad = s.adapt;
      for (const p of s.pieces) {
        const b = p.box;
        if (b[3] < x0 - 12 || b[0] > x0 + 15 + 12 || b[5] < z0 - 12 || b[2] > z0 + 15 + 12) continue;
        if (p.rigid) rigids.push([b, ad, p.gld]);
        for (const jn of p.junctions) if (jn[0] > x0 - 12 && jn[2] > z0 - 12 && jn[0] < x0 + 15 + 12 && jn[2] < z0 + 15 + 12) juncs.push(jn);
      }
    }
    if (!rigids.length && !juncs.length) return null;
    // every piece / junction only reaches 12 blocks around it, so a column's values are summed once
    // into an array over the y range they touch
    const col = new Float64Array(H);
    let cx = NaN, cz = NaN, any = false;
    const add = (ylo, yhi, f) => { ylo = Math.max(ylo, minY); yhi = Math.min(yhi, minY + H - 1); for (let y = ylo; y <= yhi; y++) col[y - minY] += f(y); any = true; };
    return (x, y, z) => {
      if (x !== cx || z !== cz) {
        cx = x; cz = z;
        if (any) col.fill(0);
        any = false;
        for (const [b, ad, gld] of rigids) {
          const i1 = Math.max(0, b[0] - x, x - b[3]), j1 = Math.max(0, b[2] - z, z - b[5]);
          if (i1 >= 12 || j1 >= 12) continue;
          const k1 = b[1] + gld;
          if (ad === 'beard_thin') add(k1 - 12, k1 + 11, (y) => beardC(i1, y - k1, j1, y - k1) * 0.8);
          else if (ad === 'beard_box') add(k1 - 12, b[4] + 11, (y) => beardC(i1, Math.max(0, k1 - y, y - b[4]), j1, y - k1) * 0.8);
          else if (ad === 'bury') add(k1 - 12, k1 + 12, (y) => buryC(i1, (y - k1) / 2, j1));
          else if (ad === 'encapsulate') add(b[1] - 12, b[4] + 12, (y) => buryC(i1 / 2, Math.max(0, b[1] - y, y - b[4]) / 2, j1 / 2) * 0.8);
        }
        for (const jn of juncs) {
          const dx = x - jn[0], dz = z - jn[2];
          if (dx <= -12 || dx >= 12 || dz <= -12 || dz >= 12) continue;
          add(jn[1] - 12, jn[1] + 11, (y) => beardC(dx, y - jn[1], dz, y - jn[1]) * 0.4);
        }
      }
      return any ? col[y - minY] : 0;
    };
  }

  // ---- placement -----------------------------------------------------------------------------------
  // places every piece of the given starts that reaches chunk (cx, cz) into its block / meta arrays
  SG.place = function (gen, cx, cz, blocks, meta, hm, starts) {
    const out = { loot: [], ent: [], feat: [], refs: [], wl: new Set() };
    if (!starts.length) { out.wl = []; return out; }
    const x0 = cx * 16, z0 = cz * 16, minY = gen.minY, H = gen.height;
    const chunkBox = [x0, minY, z0, x0 + 15, minY + H - 1, z0 + 15];
    const idx = (x, y, z) => ((y - minY) << 8) | ((z - z0) << 4) | (x - x0);
    const getId = (x, y, z) => (y < minY || y >= minY + H ? 0 : blocks[idx(x, y, z)]);
    // live WORLD_SURFACE_WG heights for terrain-matching pieces
    const height = (x, z) => { const i = ((z - z0) << 4) | (x - x0); let y = hm[i]; return y + 1; };
    for (const s of starts) {
      let touched = false;
      for (const p of s.pieces) {
        if (!overlap(p.box, chunkBox) && !(p.el && p.el.proj === 'terrain_matching')) continue;
        if (p.box[3] < x0 || p.box[0] > x0 + 15 || p.box[5] < z0 || p.box[2] > z0 + 15) continue;
        touched = true;
        placePiece(gen, p, s, x0, z0, minY, H, blocks, meta, getId, height, idx, out);
      }
      if (touched || overlap(s.box, chunkBox)) out.refs.push(s.fortress ? [s.name, s.box, s.fortress] : [s.name, s.box]);
    }
    // keep the heightmap current for the main thread
    for (let i = 0; i < 256; i++) { let iy = H - 1; while (iy >= 0 && !blocks[(iy << 8) | i]) iy--; hm[i] = iy + minY; }
    out.wl = [...out.wl].filter(k => blocks[k]); // (none where a later piece left air)
    return out;
  };

  function placePiece(gen, p, s, x0, z0, minY, H, blocks, meta, getId, height, idx, out) {
    if (p.kind === 'tpl') return placeTpl(gen, p, x0, z0, minY, H, blocks, meta, getId, idx, out);
    if (p.kind === 'code') return p.build(x0, z0, minY, H, blocks, meta, getId, idx, out);
    const el = p.el;
    if (el.type === 'empty') return;
    if (el.type === 'list') { for (const m of el.list) placePiece(gen, { ...p, el: m }, s, x0, z0, minY, H, blocks, meta, getId, height, idx, out); return; }
    if (el.type === 'feature') {
      const [x, y, z] = p.pos;
      if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16) out.feat.push([x, y, z, el.feature]);
      return;
    }
    const tpl = el.tpl, rot = p.rot, legacy = el.type === 'legacy', terrain = el.proj === 'terrain_matching';
    const pal = tpl.pal.length > 1 ? tpl.pal[JR(posSeed(p.pos[0], p.pos[1], p.pos[2])).nextInt(tpl.pal.length)] : tpl.pal[0];
    const procs = el.proc, n = tpl.n, base = tpl.off * 5;
    const jigAt = new Map();
    for (const j of tpl.jig) jigAt.set(j[0] + ',' + j[1] + ',' + j[2], j[8]);
    for (let i = 0; i < n; i++) {
      const o = base + i * 5;
      const lx = BLOB[o], ly = BLOB[o + 1], lz = BLOB[o + 2], pi = BLOB[o + 3] | (BLOB[o + 4] << 8);
      const rp = rotPos(lx, ly, lz, rot);
      const x = rp[0] + p.pos[0], z = rp[2] + p.pos[2];
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
      let y = rp[1] + p.pos[1];
      let g = pal[pi];
      const nm = NAMES[g];
      if (nm === 'structure_block' || nm === 'structure_void') continue;
      if (nm === 'jigsaw') { g = jigAt.get(lx + ',' + ly + ',' + lz); if (g === undefined || NAMES[g] === 'structure_void') continue; }
      g = D.rot[g][rot];
      if (legacy && NAMES[g] === 'air') continue;
      g = process(procs, g, x, y, z, getId);
      if (g < 0) continue;
      if (terrain) y = height(x, z) - 1 + ly;
      if (y < minY || y >= minY + H) continue;
      const id = SMAP[g * 2];
      if (id < 0) continue;
      const k = idx(x, y, z);
      putWl(out, k, g, blocks[k], meta[k]);
      blocks[k] = id; meta[k] = SMAP[g * 2 + 1];
    }
    if (tpl.be) for (const b of tpl.be) {
      const rp = rotPos(b[0], b[1], b[2], rot), x = rp[0] + p.pos[0], z = rp[2] + p.pos[2];
      let y = rp[1] + p.pos[1];
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
      if (terrain) y = height(x, z) - 1 + b[1];
      out.loot.push([x, y, z, b[3], b[4]]);
    }
    if (tpl.ent) for (const e of tpl.ent) {
      const rp = rotPos(e[0], e[1], e[2], rot), x = rp[0] + p.pos[0], z = rp[2] + p.pos[2];
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
      out.ent.push([x, rp[1] + p.pos[1], z, e[3], e[4]]);
    }
  }

  // a template placed by structure code (igloos, shipwrecks, ruins, portals, fossils): rotation + mirror
  // around a pivot, optional block rot / rules, data markers handled by the piece
  function placeTpl(gen, p, x0, z0, minY, H, blocks, meta, getId, idx, out) {
    const tpl = p.tpl, rot = p.rot, mir = p.mirror || 0, px = p.pivot ? p.pivot[0] : 0, pz = p.pivot ? p.pivot[1] : 0;
    const pal = tpl.pal.length > 1 ? tpl.pal[JR(posSeed(p.pos[0], p.pos[1], p.pos[2])).nextInt(tpl.pal.length)] : tpl.pal[0];
    const base = tpl.off * 5;
    const set = (x, y, z, g) => { if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y < minY || y >= minY + H) return; const id = SMAP[g * 2]; if (id < 0) return; const k = idx(x, y, z); putWl(out, k, g, blocks[k], meta[k]); blocks[k] = id; meta[k] = SMAP[g * 2 + 1]; };
    for (let i = 0; i < tpl.n; i++) {
      const o = base + i * 5;
      const lx = BLOB[o], ly = BLOB[o + 1], lz = BLOB[o + 2], pi = BLOB[o + 3] | (BLOB[o + 4] << 8);
      const t = rotPosM(lx, ly, lz, rot, mir, px, pz);
      const x = t[0] + p.pos[0], z = t[2] + p.pos[2];
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
      const y = t[1] + p.pos[1];
      let g = pal[pi];
      const nm = NAMES[g];
      if (nm === 'structure_block' || nm === 'structure_void' || nm === 'jigsaw' || (p.ignoreAir && nm === 'air')) continue;
      if (mir) g = D.mir[g][mir - 1];
      g = D.rot[g][rot];
      if (p.integrity !== undefined && p.integrity < 1 && JR(posSeed(x, y, z)).nextFloat() > p.integrity) continue;
      if (p.proc) { g = process(p.proc, g, x, y, z, getId); if (g < 0) continue; }
      if (p.mapState) { g = p.mapState(g, x, y, z, getId); if (g < 0) continue; }
      set(x, y, z, g);
    }
    if (tpl.be) for (const b of tpl.be) {
      const t = rotPosM(b[0], b[1], b[2], rot, mir, px, pz), x = t[0] + p.pos[0], y = t[1] + p.pos[1], z = t[2] + p.pos[2];
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) continue;
      if (b[3] === 'marker') { if (p.marker) p.marker(b[4], x, y, z, set, out); }
      else out.loot.push([x, y, z, b[3], b[4]]);
    }
    if (p.post) p.post(x0, z0, set, getId, out);
  }
  // template piece bookkeeping (box from the transformed size)
  function tplPiece(name, pos, rot, mirror, pivot, opts) {
    const tpl = TPL[name];
    if (!tpl) return null;
    const s = tpl.size, px = pivot ? pivot[0] : 0, pz = pivot ? pivot[1] : 0;
    const a = rotPosM(0, 0, 0, rot, mirror || 0, px, pz), b = rotPosM(s[0] - 1, s[1] - 1, s[2] - 1, rot, mirror || 0, px, pz);
    const box = [Math.min(a[0], b[0]) + pos[0], pos[1], Math.min(a[2], b[2]) + pos[2], Math.max(a[0], b[0]) + pos[0], pos[1] + s[1] - 1, Math.max(a[2], b[2]) + pos[2]];
    return Object.assign({ kind: 'tpl', name, tpl, pos: pos.slice(), rot, mirror: mirror || 0, pivot, box, rigid: true, gld: 0, junctions: [] }, opts || {});
  }
  const stateIdx = new Map();
  const stateOf = (key) => { if (!stateIdx.size) D.states.forEach((s, i) => stateIdx.set(s, i)); return stateIdx.get(key); };
  SG.TYPES = {};
  SG.helpers = { JR, posSeed, rotPosM, rotPos, tplPiece, stateOf, biomeSet, TPL, D, NAMES, strip, anchor: (gen, a) => anchor(gen, a), sampleHeight: (gen, h, r) => sampleHeight(gen, h, r), shuffle };

  // processors on one block (state index in, state index out or -1 to skip)
  function process(procs, g, x, y, z, getId) {
    let rnd = null;
    const R = () => rnd || (rnd = JR(posSeed(x, y, z)));
    for (const pr of procs) {
      const t = strip(pr.processor_type);
      if (t === 'rule') {
        rnd = null;
        const loc = ID_NAME ? ID_NAME[getId(x, y, z)] || 'air' : 'air';
        for (const rule of pr.rules) {
          if (!pred(rule.input_predicate, g, NAMES[g], R) || !pred(rule.location_predicate, -1, loc, R)) continue;
          if (rule.position_predicate && strip(rule.position_predicate.predicate_type) !== 'always_true') continue;
          g = rule.out;
          break;
        }
      } else if (t === 'block_rot') {
        rnd = null;
        const rt = pr.rottable_blocks;
        if (!(rt && !tag(rt).has(NAMES[g])) && !(R().nextFloat() <= pr.integrity)) return -1;
      } else if (t === 'protected_blocks') {
        const loc = ID_NAME ? ID_NAME[getId(x, y, z)] : null;
        if (loc && tag(pr.value).has(loc)) return -1;
      }
    }
    return g;
  }
  function pred(p, g, name, R) {
    switch (strip(p.predicate_type)) {
      case 'always_true': return true;
      case 'block_match': return name === strip(p.block);
      case 'blockstate_match': return g >= 0 ? g === p.sid : false;
      case 'random_block_match': return name === strip(p.block) && R().nextFloat() < p.probability;
      case 'random_blockstate_match': return g === p.sid && R().nextFloat() < p.probability;
      case 'tag_match': return tag(p.tag).has(name);
    }
    return false;
  }
})();
