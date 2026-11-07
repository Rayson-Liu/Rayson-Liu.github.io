'use strict';
// ---------------------------------------------------------------------------
// Vanilla world features for gen-2 worlds, driven by the bundled placed_feature / configured_feature
// JSON. Implements ChunkGenerator.applyBiomeDecoration: per chunk a decoration seed, the global
// per-step feature order (FeatureSorter), and for every feature its placement modifiers followed by
// the configured feature itself. Coordinates are vanilla (y from -64); chunks hold y - MIN_Y.
// Trees live in trees.js (Features.registerTree).
// ---------------------------------------------------------------------------
const Features = (() => {
  const D = self.WG_DATA, TAGS = self.BLOCK_TAGS || {};
  const strip = (s) => typeof s === 'string' ? s.replace('minecraft:', '') : s;

  // ---- WorldgenRandom (java.util.Random API over Xoroshiro bits) --------------------------------------
  class WRand {
    constructor() { this.x = null; this.haveGauss = false; }
    setSeed(seed) { this.x = WG.Xoroshiro.fromSeed(BigInt.asIntN(64, BigInt(seed))); this.haveGauss = false; }
    next(bits) { this.x.nextLong(); const h = WG.getR()[0]; return bits === 32 ? h | 0 : h >>> (32 - bits); }
    nextInt(n) {
      if (n === undefined) return this.next(32);
      if (n <= 0) throw new Error('bound must be positive');
      if ((n & -n) === n) return this.next(31) >>> (31 - Math.log2(n));
      let bits, val;
      do { bits = this.next(31); val = bits % n; } while (bits - val + (n - 1) > 2147483647);
      return val;
    }
    nextIntBetween(a, b) { return this.nextInt(b - a + 1) + a; }
    nextLong() { const a = BigInt(this.next(32)), b = BigInt(this.next(32)); return BigInt.asIntN(64, (a << 32n) + b); }
    nextBoolean() { return this.next(1) !== 0; }
    nextFloat() { return this.next(24) * 5.9604645E-8; }
    nextDouble() { return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565E-16; }
    nextGaussian() {
      if (this.haveGauss) { this.haveGauss = false; return this.gauss; }
      let a, b, s;
      do { a = 2 * this.nextDouble() - 1; b = 2 * this.nextDouble() - 1; s = a * a + b * b; } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      this.gauss = b * m; this.haveGauss = true; return a * m;
    }
    // WorldgenRandom.setDecorationSeed / setFeatureSeed
    decorationSeed(seed, x, z) {
      this.setSeed(seed);
      const l = this.nextLong() | 1n, m = this.nextLong() | 1n;
      const n = BigInt.asIntN(64, BigInt.asIntN(64, BigInt(x) * l + BigInt(z) * m) ^ BigInt(seed));
      this.setSeed(n);
      return n;
    }
  }
  // Mth.sin / cos lookup table (features use these, not Math.sin)
  const SIN = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 65536);
  const msin = (f) => SIN[Math.trunc(Math.fround(f) * 10430.378) & 65535];
  const mcos = (f) => SIN[Math.trunc(Math.fround(f) * 10430.378 + 16384) & 65535];

  // ---- block states ----------------------------------------------------------------------------------
  const stateCache = new Map();
  // vanilla blockstate JSON -> [our block id, meta]; unknown blocks map to null
  function stateOf(st) {
    if (typeof st === 'string') st = { Name: st };
    const key = JSON.stringify(st);
    let r = stateCache.get(key);
    if (r !== undefined) return r;
    const name = strip(st.Name), p = st.Properties || {};
    let id = name === 'air' || name === 'cave_air' || name === 'void_air' ? 0 : BID[name];
    if (name === 'water') id = WATER; if (name === 'lava') id = LAVA;
    if (id === undefined) { stateCache.set(key, null); return null; }
    const b = BLOCKS[id];
    let meta = 0;
    if (b && b.states) {
      let best = 0, bestScore = -1;
      b.states.forEach((s, i) => { let sc = 0; for (const k in p) if (s[k] === String(p[k])) sc++; else if (k in s) sc -= 10; if (sc > bestScore) { bestScore = sc; best = i; } });
      meta = best;
    } else if (b && b.axis && p.axis) meta = { y: 0, x: 1, z: 2 }[p.axis];
    else if (name === 'snow' && p.layers) meta = 0;
    r = [id, meta];
    stateCache.set(key, r);
    return r;
  }
  // property of a placed state (for blocks with state lists)
  const propOf = (id, meta, k) => { const b = BLOCKS[id]; return b && b.states && b.states[meta] ? b.states[meta][k] : undefined; };
  function withProp(id, meta, k, v) {
    const b = BLOCKS[id];
    if (!b || !b.states) return meta;
    const cur = Object.assign({}, b.states[meta] || {}, { [k]: String(v) });
    const i = b.states.findIndex(s => Object.keys(cur).every(q => !(q in s) || s[q] === cur[q]));
    return i < 0 ? meta : i;
  }
  const tagCache = new Map();
  function tagSet(t) {
    t = strip(t).replace(/^#/, '');
    let s = tagCache.get(t);
    if (!s) { s = new Set(); for (const k of TAGS[t] || []) { const id = k === 'air' || k === 'cave_air' || k === 'void_air' ? 0 : k === 'water' ? WATER : k === 'lava' ? LAVA : BID[k]; if (id !== undefined) s.add(id); } tagCache.set(t, s); }
    return s;
  }
  const blockSet = (list) => new Set([].concat(list).map(n => { n = strip(n); if (n.startsWith('#')) return [...tagSet(n)]; return n === 'air' ? 0 : n === 'water' ? WATER : n === 'lava' ? LAVA : BID[n]; }).flat().filter(v => v !== undefined));

  // ---- the region a chunk's features may touch (its 3x3 chunks) --------------------------------------
  class Region {
    constructor(world, cx, cz) {
      this.w = world; this.cx = cx; this.cz = cz; this.minY = world.minY || 0; this.maxY = this.minY + HEIGHT; // [minY, maxY)
      this.ch = new Array(9);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.ch[(b + 1) * 3 + a + 1] = world.proto.get(ckey(cx + a, cz + b)) || world.chunks.get(ckey(cx + a, cz + b)) || null;
      // heightmaps per type over the 3x3 chunks, filled per column on first use and kept exact by set()
      // (like vanilla's chunk heightmaps; scanning down from the top for every ore vein was most of decoration)
      this.hm = {};
    }
    col(x, z) { return ((((z >> 4) - this.cz + 1) * 3 + (x >> 4) - this.cx + 1) << 8) | ((z & 15) << 4) | (x & 15); }
    chunk(x, z) {
      const a = (x >> 4) - this.cx + 1, b = (z >> 4) - this.cz + 1;
      return a < 0 || a > 2 || b < 0 || b > 2 ? null : this.ch[b * 3 + a];
    }
    id(x, y, z) {
      if (y < this.minY || y >= this.maxY) return 0;
      const c = this.chunk(x, z);
      return c ? c.getB(((y - this.minY) << 8) | ((z & 15) << 4) | (x & 15)) : 0;
    }
    meta(x, y, z) { const c = this.chunk(x, z); return c && y >= this.minY && y < this.maxY ? c.getM(((y - this.minY) << 8) | ((z & 15) << 4) | (x & 15)) : 0; }
    // finished chunks are read-only: only a chunk regenerated after unloading can reach them, and vanilla
    // never rewrites a chunk that has left the feature stage (player edits near the border would be undone)
    canWrite(x, y, z) { const c = this.chunk(x, z); return y >= this.minY && y < this.maxY && !!c && !c.final; }
    set(x, y, z, id, meta = 0) {
      if (y < this.minY || y >= this.maxY) return false;
      const c = this.chunk(x, z);
      if (!c || c.final) return false;
      const i = ((y - this.minY) << 8) | ((z & 15) << 4) | (x & 15);
      // a block that can hold water put where a water source was holds it (vanilla's features set waterlogged from
      // the fluid there: leaves, mangrove roots, amethyst buds, dripstone, glow lichen ...); another block, none
      const wl = canWaterlog(id, meta) && ((c.getB(i) === WATER && c.getM(i) === 0) || (c.getB(i) === id && c.wl && c.wl.has(i)));
      if (wl) (c.wl || (c.wl = new Set())).add(i); else if (c.wl) c.wl.delete(i);
      c.setB(i, id); c.setM(i, meta);
      for (const type in this.hm) {
        const H = this.hm[type], k = this.col(x, z), h = H[k];
        if (h === HM_UNSET) continue;
        if (matchesHeightmap(type, id)) { if (y + 1 > h) H[k] = y + 1; }
        else if (y + 1 === h) H[k] = HM_UNSET; // the top block went: rescan this column when asked
      }
      return true;
    }
    setState(x, y, z, s) { return s ? this.set(x, y, z, s[0], s[1]) : false; }
    isAir(x, y, z) { return this.id(x, y, z) === 0; }
    // heightmaps: first free y above the highest block matching the type
    height(type, x, z) {
      const c = this.chunk(x, z);
      if (!c) return this.minY;
      const H = this.hm[type] || (this.hm[type] = new Int32Array(9 * 256).fill(HM_UNSET)), k = this.col(x, z);
      if (H[k] !== HM_UNSET) return H[k];
      const col = ((z & 15) << 4) | (x & 15);
      let h = this.minY;
      // top down, skipping sections of air
      for (let s = SECTIONS - 1; s >= 0 && h === this.minY; s--) {
        const b = c.bs[s];
        if (!b) continue;
        const p = b.p, d = b.d;
        for (let yy = 15; yy >= 0; yy--) {
          const id = p[d[(yy << 8) | col]];
          if (id && matchesHeightmap(type, id)) { h = (s << 4) + yy + this.minY + 1; break; }
        }
      }
      return (H[k] = h);
    }
  }
  const HM_UNSET = -0x7fffffff;
  function matchesHeightmap(type, id) {
    const b = BLOCKS[id];
    switch (type) {
      case 'WORLD_SURFACE_WG': case 'WORLD_SURFACE': return true;
      case 'OCEAN_FLOOR_WG': case 'OCEAN_FLOOR': return !!b && b.solid && !IS_FLUID[id];
      case 'MOTION_BLOCKING': return !!b && (b.solid || IS_FLUID[id]);
      case 'MOTION_BLOCKING_NO_LEAVES': return !!b && (b.solid || IS_FLUID[id]) && !LEAVES.has(id);
    }
    return true;
  }
  let LEAVES = null, LOGS = null, DIRT = null, REPLACE_TREES = null;
  function initTags() {
    LEAVES = tagSet('leaves'); LOGS = tagSet('logs'); DIRT = tagSet('substrate_overworld'); REPLACE_TREES = tagSet('replaceable_by_trees');
    WATERLOGGED = new Set(); for (let i = 0; i < MAX_BLOCKS; i++) if (WLOG[i]) WATERLOGGED.add(i);
  }

  // ---- int / height providers ------------------------------------------------------------------------
  function intProvider(p) {
    if (typeof p === 'number') return () => p;
    const t = strip(p.type);
    switch (t) {
      case 'constant': return () => p.value;
      case 'uniform': return (r) => r.nextIntBetween(p.min_inclusive, p.max_inclusive);
      case 'biased_to_bottom': return (r) => p.min_inclusive + r.nextInt(r.nextInt(p.max_inclusive - p.min_inclusive + 1) + 1);
      case 'clamped': { const s = intProvider(p.source); return (r) => clamp(s(r), p.min_inclusive, p.max_inclusive); }
      case 'clamped_normal': return (r) => Math.trunc(clamp(p.mean + r.nextGaussian() * p.deviation, p.min_inclusive, p.max_inclusive));
      case 'trapezoid': return (r) => { const i = p.max - p.min, pl = p.plateau || 0; if (pl >= i) return r.nextIntBetween(p.min, p.max); const j = (i - pl) >> 1, k = i - j; return p.min + r.nextIntBetween(0, k) + r.nextIntBetween(0, j); };
      case 'weighted_list': {
        const L = p.distribution.map(e => [intProvider(e.data), e.weight]), tot = L.reduce((a, e) => a + e[1], 0);
        return (r) => { let i = r.nextInt(tot); for (const [f, w] of L) { i -= w; if (i < 0) return f(r); } return L[0][0](r); };
      }
    }
    if (p.min_inclusive !== undefined && p.max_inclusive !== undefined) return (r) => r.nextIntBetween(p.min_inclusive, p.max_inclusive);
    throw new Error('int provider ' + t);
  }
  // vertical anchors depend on the dimension being decorated (the Nether is 0..127)
  const DIM = { minY: -64, height: 384 };
  const anchor = (a) => 'absolute' in a ? a.absolute : 'above_bottom' in a ? DIM.minY + a.above_bottom : DIM.minY + DIM.height - 1 - a.below_top;
  function heightProvider(h) {
    const t = strip(h.type || 'constant');
    if (t === 'constant') return () => anchor(h.value || h);
    const inner = h.inner || 1;
    let lo, hi;
    const res = () => { lo = anchor(h.min_inclusive); hi = anchor(h.max_inclusive); };
    switch (t) {
      case 'uniform': return (r) => { res(); return lo > hi ? lo : r.nextIntBetween(lo, hi); };
      case 'trapezoid': return (r) => { res(); if (lo > hi) return lo; const k = hi - lo, pl = h.plateau || 0; if (pl >= k) return r.nextIntBetween(lo, hi); const l = (k - pl) >> 1, m = k - l; return lo + r.nextIntBetween(0, m) + r.nextIntBetween(0, l); };
      case 'biased_to_bottom': return (r) => { res(); if (hi - lo - inner + 1 <= 0) return lo; const k = r.nextInt(hi - lo - inner + 1); return r.nextInt(k + inner) + lo; };
      case 'very_biased_to_bottom': return (r) => {
        res();
        if (hi - lo - inner + 1 <= 0) return lo;
        const ni = (a, b) => a >= b ? a : r.nextInt(b - a + 1) + a;
        const k = ni(lo + inner, hi), l = ni(lo, k - 1); return ni(lo, l - 1 + inner);
      };
    }
    throw new Error('height provider ' + t);
  }

  // ---- legacy-random noises for noise-based state providers -------------------------------------------
  const javaHash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; };
  class LegacyFactory { constructor(seed) { this.seed = seed; } fromHashOf(s) { return new WG.JavaRandom(BigInt(javaHash(s)) ^ this.seed); } }
  function legacyNormalNoise(seed, params) {
    const r = new WG.JavaRandom(BigInt(seed));
    r.forkPositional = function () { return new LegacyFactory(this.nextLong()); };
    return new WG.NormalNoise(r, params);
  }
  const noiseCache = new Map();
  const legacyNoise = (seed, params) => { const k = seed + JSON.stringify(params); let n = noiseCache.get(k); if (!n) { n = legacyNormalNoise(seed, params); noiseCache.set(k, n); } return n; };
  const pickByNoise = (list, d) => list[Math.trunc(clamp((1 + d) / 2, 0, 0.9999) * list.length)];

  // ---- block state providers: f(rand, x, y, z, region) -> [id, meta] | null --------------------------------
  function provider(p) {
    const t = strip(p.type);
    switch (t) {
      case 'simple_state_provider': { const s = stateOf(p.state); return () => s; }
      case 'rotated_block_provider': { const s = stateOf(p.state); return (r) => { const a = ['x', 'y', 'z'][r.nextInt(3)]; return s && BLOCKS[s[0]].axis ? [s[0], { y: 0, x: 1, z: 2 }[a]] : s; }; }
      case 'weighted_state_provider': {
        const L = p.entries.map(e => [stateOf(e.data), e.weight]), tot = L.reduce((a, e) => a + e[1], 0);
        return (r) => { let i = r.nextInt(tot); for (const [s, w] of L) { i -= w; if (i < 0) return s; } return L[0][0]; };
      }
      case 'randomized_int_state_provider': {
        const src = provider(p.source), v = intProvider(p.values);
        return (r, x, y, z, R) => { const s = src(r, x, y, z, R); return s ? [s[0], withProp(s[0], s[1], p.property, v(r))] : s; };
      }
      case 'rule_based_state_provider': {
        const rules = p.rules.map(q => [predicate(q.if_true), provider(q.then)]), fb = p.fallback ? provider(p.fallback) : null;
        return (r, x, y, z, R) => { for (const [c, f] of rules) if (c(R, x, y, z)) return f(r, x, y, z, R); return fb ? fb(r, x, y, z, R) : null; };
      }
      case 'noise_provider': {
        const n = legacyNoise(p.seed, p.noise), sc = p.scale, st = p.states.map(stateOf);
        return (r, x, y, z) => pickByNoise(st, n.get(x * sc, y * sc, z * sc));
      }
      case 'noise_threshold_provider': {
        const n = legacyNoise(p.seed, p.noise), sc = p.scale, lo = p.low_states.map(stateOf), hi = p.high_states.map(stateOf), def = stateOf(p.default_state);
        return (r, x, y, z) => {
          const d = n.get(x * sc, y * sc, z * sc);
          if (d < p.threshold) return lo[r.nextInt(lo.length)];
          if (r.nextFloat() < p.high_chance) return hi[r.nextInt(hi.length)];
          return def;
        };
      }
      case 'dual_noise_provider': {
        const n = legacyNoise(p.seed, p.noise), sn = legacyNoise(p.seed, p.slow_noise), sc = p.scale, ss = p.slow_scale, st = p.states.map(stateOf);
        const v = Array.isArray(p.variety) ? p.variety : [p.variety.min_inclusive ?? p.variety, p.variety.max_inclusive ?? p.variety];
        return (r, x, y, z) => {
          const slow = (a, b, c) => sn.get(a * ss, b * ss, c * ss);
          const i = Math.trunc(WG.clampedMap(slow(x, y, z), -1, 1, v[0], v[1] + 1));
          const L = []; for (let j = 0; j < i; j++) L.push(pickByNoise(st, slow(x + j * 54545, y, z + j * 34234)));
          return pickByNoise(L, n.get(x * sc, y * sc, z * sc));
        };
      }
    }
    throw new Error('state provider ' + t);
  }

  // ---- block predicates: f(region, x, y, z) -> bool ----------------------------------------------------------
  function predicate(p) {
    const t = strip(p.type), off = p.offset || [0, 0, 0], ox = off[0], oy = off[1], oz = off[2];
    switch (t) {
      case 'true': return () => true;
      case 'not': { const f = predicate(p.predicate); return (R, x, y, z) => !f(R, x, y, z); }
      case 'any_of': { const fs = p.predicates.map(predicate); return (R, x, y, z) => fs.some(f => f(R, x, y, z)); }
      case 'all_of': { const fs = p.predicates.map(predicate); return (R, x, y, z) => fs.every(f => f(R, x, y, z)); }
      case 'matching_blocks': { const s = blockSet(p.blocks); return (R, x, y, z) => s.has(R.id(x + ox, y + oy, z + oz)); }
      case 'matching_block_tag': { const s = tagSet(p.tag); return (R, x, y, z) => s.has(R.id(x + ox, y + oy, z + oz)); }
      case 'matching_fluids': {
        const fl = [].concat(p.fluids).map(strip);
        const ok = (id) => (id === WATER && fl.some(f => f.includes('water'))) || (id === LAVA && fl.some(f => f.includes('lava'))) || (WATERLOGGED.has(id) && fl.some(f => f.includes('water')));
        return (R, x, y, z) => ok(R.id(x + ox, y + oy, z + oz));
      }
      case 'solid': return (R, x, y, z) => { const b = BLOCKS[R.id(x + ox, y + oy, z + oz)]; return !!b && b.solid; };
      case 'replaceable': return (R, x, y, z) => { const id = R.id(x + ox, y + oy, z + oz); return id === 0 || IS_FLUID[id] || REPLACEABLE[id]; };
      case 'would_survive': { const s = stateOf(p.state); return (R, x, y, z) => !!s && canSurvive(R, s[0], s[1], x + ox, y + oy, z + oz); };
      case 'has_sturdy_face': return (R, x, y, z) => !!SOLIDCUBE[R.id(x + ox, y + oy, z + oz)];
      case 'inside_world_bounds': return (R, x, y, z) => y + oy >= R.minY && y + oy < R.maxY;
      case 'unobstructed': return () => true;
    }
    throw new Error('block predicate ' + t);
  }
  // RuleTest (ore targets): f(rand, id) -> bool
  function ruleTest(p) {
    const t = strip(p.predicate_type);
    switch (t) {
      case 'always_true': return () => true;
      case 'tag_match': { const s = tagSet(p.tag); return (r, id) => s.has(id); }
      case 'block_match': { const s = blockSet(p.block); return (r, id) => s.has(id); }
      case 'blockstate_match': { const s = stateOf(p.block_state); return (r, id) => !!s && s[0] === id; }
      case 'random_block_match': { const s = blockSet(p.block); return (r, id) => s.has(id) && r.nextFloat() < p.probability; }
    }
    throw new Error('rule test ' + t);
  }

  // ---- survival rules (canSurvive) for would_survive and simple_block ------------------------------------------
  let WATERLOGGED = new Set();
  // survival rules: 26.x keeps the supporting blocks of most plants in supports_* block tags
  const SUPPORT = {};
  const sup = (t) => SUPPORT[t] || (SUPPORT[t] = tagSet(t));
  const DRY = new Set(['dead_bush', 'short_dry_grass', 'tall_dry_grass']);
  function canSurvive(R, id, meta, x, y, z) {
    if (!LEAVES) initTags();
    const b = BLOCKS[id];
    if (!b) return false;
    const k = b.key, below = R.id(x, y - 1, z), bb = BLOCKS[below];
    if (propOf(id, meta, 'half') === 'upper') return below === id;
    switch (k) {
      case 'cactus': {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = R.id(x + dx, y, z + dz), nb = BLOCKS[n]; if ((nb && nb.solid) || IS_FLUID[n]) return false; }
        return below === id || sup('supports_cactus').has(below);
      }
      case 'cactus_flower': return sup('support_override_cactus_flower').has(below) || !!SOLIDCUBE[below];
      case 'sugar_cane': {
        if (below === id) return true;
        if (!sup('supports_sugar_cane').has(below)) return false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = R.id(x + dx, y - 1, z + dz); if (n === WATER || WATERLOGGED.has(n) || sup('supports_sugar_cane_adjacently').has(n)) return true; }
        return false;
      }
      case 'lily_pad': return below === WATER || sup('supports_lily_pad').has(below);
      case 'mangrove_propagule': return sup('supports_mangrove_propagule').has(below);
      case 'azalea': case 'flowering_azalea': return sup('supports_azalea').has(below);
      case 'bamboo': case 'bamboo_sapling': return sup('supports_bamboo').has(below);
      case 'big_dripleaf': return below === BID.big_dripleaf_stem || sup('supports_big_dripleaf').has(below);
      case 'small_dripleaf': return sup('supports_small_dripleaf').has(below);
      case 'red_mushroom': case 'brown_mushroom': return !!SOLIDCUBE[below];
      case 'cocoa': return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => sup('supports_cocoa').has(R.id(x + dx, y, z + dz)));
      case 'snow': return (!!SOLIDCUBE[below] && !sup('cannot_support_snow_layer').has(below)) || sup('support_override_snow_layer').has(below) || LEAVES.has(below);
      case 'crimson_fungus': case 'warped_fungus': return sup(k === 'crimson_fungus' ? 'supports_crimson_fungus' : 'supports_warped_fungus').has(below);
      case 'crimson_roots': case 'warped_roots': return sup(k === 'crimson_roots' ? 'supports_crimson_roots' : 'supports_warped_roots').has(below);
      case 'nether_sprouts': return sup('supports_nether_sprouts').has(below);
      case 'weeping_vines': case 'weeping_vines_plant': case 'twisting_vines': case 'twisting_vines_plant': return true;
      case 'vine': case 'glow_lichen': case 'cave_vines': case 'cave_vines_plant': case 'hanging_roots': case 'spore_blossom': case 'pale_hanging_moss': case 'sculk_vein': return true;
    }
    // torches, levers, buttons, coral fans: a full face to hang on (vanilla canSupportCenter / isFaceSturdy) - by default
    // anything went, a torch on a torch, a lever on a lever: "火把可以插在火把上", feedback 2026-11-01/02
    const full = (n) => { const nb = BLOCKS[n]; return !!SOLIDCUBE[n] || (!!nb && nb.shape === SH_CUBE && !!nb.solid); };
    const center = (n) => { const nb = BLOCKS[n]; return full(n) || (!!nb && /(_fence|_wall)$/.test(nb.key) && !/(^|_)(wall_|fence_gate)/.test(nb.key)); };
    const behind = () => { const D = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }[propOf(id, meta, 'facing')]; return D ? R.id(x + D[0], y, z + D[1]) : 0; };
    if (/(^|_)wall_torch$/.test(k) || /coral_wall_fan$/.test(k)) return full(behind());
    if (/(^|_)torch$/.test(k)) return center(below);
    if (/coral_fan$/.test(k)) return full(below);
    if (k === 'lever' || /_button$/.test(k)) {
      const face = propOf(id, meta, 'face');
      return face === 'floor' ? full(below) : face === 'ceiling' ? full(R.id(x, y + 1, z)) : full(behind());
    }
    if (WATERLOGGED.has(id)) return (!!SOLIDCUBE[below] && below !== BID.magma_block) || below === id || ((k === 'kelp' || k === 'kelp_plant') && below === BID.kelp_plant);
    if (DRY.has(k)) return sup('supports_dry_vegetation').has(below);
    if (b.shape === SH_CROSS || b.needsSupport || k.endsWith('_sapling') || k.endsWith('_tulip') || ['short_grass', 'fern', 'tall_grass', 'large_fern', 'bush', 'sweet_berry_bush', 'firefly_bush', 'open_eyeblossom', 'closed_eyeblossom', 'pink_petals', 'wildflowers', 'leaf_litter', 'sunflower', 'lilac', 'rose_bush', 'peony'].includes(k))
      return sup('supports_vegetation').has(below);
    return true;
  }

  // ---- placed features --------------------------------------------------------------------------------------------
  const resolvePF = (pf) => typeof pf === 'string' ? D.placed_feature[strip(pf)] : pf;
  const resolveCF = (cf) => typeof cf === 'string' ? D.configured_feature[strip(cf)] : cf;
  const compiledPF = new Map();
  function compilePlacement(m) {
    const t = strip(m.type);
    switch (t) {
      case 'count': { const c = intProvider(m.count); return (ctx, r, p, emit) => { const n = c(r); for (let i = 0; i < n; i++) emit(p); }; }
      case 'in_square': return (ctx, r, p, emit) => { const x = r.nextInt(16) + p[0], z = r.nextInt(16) + p[2]; emit([x, p[1], z]); };
      case 'heightmap': return (ctx, r, p, emit) => { const h = ctx.R.height(m.heightmap, p[0], p[2]); if (h > ctx.R.minY) emit([p[0], h, p[2]]); };
      case 'height_range': { const h = heightProvider(m.height); return (ctx, r, p, emit) => emit([p[0], h(r), p[2]]); }
      case 'biome': return (ctx, r, p, emit) => { if (ctx.biomeHas(p, ctx.top)) emit(p); };
      case 'rarity_filter': { const f = Math.fround(1 / m.chance); return (ctx, r, p, emit) => { if (r.nextFloat() < f) emit(p); }; }
      case 'random_offset': {
        const xz = intProvider(m.xz_spread), yy = intProvider(m.y_spread);
        return (ctx, r, p, emit) => { const x = p[0] + xz(r), y = p[1] + yy(r), z = p[2] + xz(r); emit([x, y, z]); };
      }
      case 'block_predicate_filter': { const f = predicate(m.predicate); return (ctx, r, p, emit) => { if (f(ctx.R, p[0], p[1], p[2])) emit(p); }; }
      case 'surface_water_depth_filter': return (ctx, r, p, emit) => { if (ctx.R.height('WORLD_SURFACE', p[0], p[2]) - ctx.R.height('OCEAN_FLOOR', p[0], p[2]) <= m.max_water_depth) emit(p); };
      case 'surface_relative_threshold_filter': return (ctx, r, p, emit) => {
        const h = ctx.R.height(m.heightmap, p[0], p[2]), lo = h + (m.min_inclusive ?? -1e9), hi = h + (m.max_inclusive ?? 1e9);
        if (lo <= p[1] && p[1] <= hi) emit(p);
      };
      case 'noise_threshold_count': return (ctx, r, p, emit) => { const d = WG.infoNoise().get(p[0] / 200, p[2] / 200), n = d < m.noise_level ? m.below_noise : m.above_noise; for (let i = 0; i < n; i++) emit(p); };
      case 'noise_based_count': return (ctx, r, p, emit) => { const d = WG.infoNoise().get(p[0] / m.noise_factor, p[2] / m.noise_factor), n = Math.ceil((d + (m.noise_offset || 0)) * m.noise_to_count_ratio); for (let i = 0; i < n; i++) emit(p); };
      case 'environment_scan': {
        const target = predicate(m.target_condition), allowed = m.allowed_search_condition ? predicate(m.allowed_search_condition) : () => true, dy = m.direction_of_search === 'up' ? 1 : -1;
        return (ctx, r, p, emit) => {
          const R = ctx.R; let y = p[1];
          if (!allowed(R, p[0], y, p[2])) return;
          for (let i = 0; i < m.max_steps; i++) {
            if (target(R, p[0], y, p[2])) { emit([p[0], y, p[2]]); return; }
            y += dy;
            if (y < R.minY || y >= R.maxY) return;
            if (!allowed(R, p[0], y, p[2])) break;
          }
          if (target(R, p[0], y, p[2])) emit([p[0], y, p[2]]);
        };
      }
      case 'count_on_every_layer': {
        const c = intProvider(m.count);
        return (ctx, r, p, emit) => {
          const R = ctx.R; let layer = 0, any;
          do {
            any = false;
            for (let j = 0; j < c(r); j++) {
              const x = r.nextInt(16) + p[0], z = r.nextInt(16) + p[2], top = R.height('MOTION_BLOCKING', x, z);
              const empty = (id) => id === 0 || id === WATER || id === LAVA;
              let n = 0, found = 2147483647, cur = R.id(x, top, z);
              for (let y = top; y >= R.minY + 1; y--) {
                const below = R.id(x, y - 1, z);
                if (!empty(below) && empty(cur) && below !== BID.bedrock) { if (n === layer) { found = y; break; } n++; }
                cur = below;
              }
              if (found === 2147483647) continue;
              emit([x, found, z]); any = true;
            }
            layer++;
          } while (any);
        };
      }
      case 'fixed_placement': return (ctx, r, p, emit) => { for (const q of m.positions) if ((q[0] >> 4) === (p[0] >> 4) && (q[2] >> 4) === (p[2] >> 4)) emit(q); };
    }
    throw new Error('placement ' + t);
  }
  function compilePF(name, pf) {
    let c = name && compiledPF.get(name);
    if (c) return c;
    pf = resolvePF(pf);
    const mods = (pf.placement || []).map(compilePlacement);
    const feat = pf.feature;
    c = { mods, feat };
    if (name) compiledPF.set(name, c);
    return c;
  }
  // depth-first like Java's lazy flatMap streams: each position runs through the remaining modifiers and
  // is placed before the next one is produced (the random calls interleave exactly like vanilla's)
  function placePF(ctx, pf, r, pos, top) {
    const c = typeof pf === 'string' ? compilePF(strip(pf), pf) : compilePF(null, pf);
    let placed = false;
    const prevTop = ctx.top; if (top) ctx.top = top;
    const step = (i, p) => {
      if (i === c.mods.length) { if (placeCF(ctx, c.feat, r, p)) placed = true; return; }
      c.mods[i](ctx, r, p, (q) => step(i + 1, q));
    };
    try { step(0, pos); } finally { ctx.top = prevTop; }
    return placed;
  }

  // ---- configured features -------------------------------------------------------------------------------------------
  const FEATURE = {};
  const cfCache = new Map();
  function placeCF(ctx, cf, r, p) {
    const def = resolveCF(cf);
    if (!def) return false;
    const t = strip(def.type), fn = FEATURE[t];
    if (!fn) return false;
    let cfg = cfCache.get(def);
    if (!cfg) { cfg = { raw: def.config || {} }; cfCache.set(def, cfg); }
    return fn(ctx, cfg, r, p[0], p[1], p[2]);
  }
  const once = (cfg, k, f) => cfg[k] || (cfg[k] = f());

  FEATURE.random_selector = (ctx, cfg, r, x, y, z) => {
    for (const e of cfg.raw.features) if (r.nextFloat() < e.chance) return placePF(ctx, e.feature, r, [x, y, z]);
    return placePF(ctx, cfg.raw.default, r, [x, y, z]);
  };
  FEATURE.simple_random_selector = (ctx, cfg, r, x, y, z) => { const L = cfg.raw.features, i = r.nextInt(L.length); return placePF(ctx, L[i], r, [x, y, z]); };
  FEATURE.random_boolean_selector = (ctx, cfg, r, x, y, z) => placePF(ctx, r.nextBoolean() ? cfg.raw.feature_true : cfg.raw.feature_false, r, [x, y, z]);
  FEATURE.weighted_random_selector = (ctx, cfg, r, x, y, z) => {
    const L = cfg.raw.features || cfg.raw.entries, tot = L.reduce((a, e) => a + e.weight, 0);
    let i = r.nextInt(tot); for (const e of L) { i -= e.weight; if (i < 0) return placePF(ctx, e.data || e.feature, r, [x, y, z]); }
    return false;
  };
  FEATURE.sequence = (ctx, cfg, r, x, y, z) => { let ok = true; for (const f of cfg.raw.features) if (!placePF(ctx, f, r, [x, y, z])) ok = false; return ok; };

  FEATURE.simple_block = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, prov = once(cfg, 'p', () => provider(cfg.raw.to_place)), s = prov(r, x, y, z, R);
    if (!s || !canSurvive(R, s[0], s[1], x, y, z)) return false;
    const b = BLOCKS[s[0]];
    if (b.states && b.states[0] && b.states[0].half !== undefined && b.states.some(q => q.half === 'upper')) {
      if (!R.isAir(x, y + 1, z) && !(WATERLOGGED.has(s[0]) && R.id(x, y + 1, z) === WATER)) return false;
      R.set(x, y, z, s[0], withProp(s[0], s[1], 'half', 'lower'));
      R.set(x, y + 1, z, s[0], withProp(s[0], s[1], 'half', 'upper'));
    } else R.set(x, y, z, s[0], s[1]);
    return true;
  };
  FEATURE.block_column = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw;
    const layers = once(cfg, 'l', () => c.layers.map(l => [intProvider(l.height), provider(l.provider)]));
    const allowed = once(cfg, 'a', () => predicate(c.allowed_placement));
    const d = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] }[c.direction];
    const n = layers.length, hs = new Array(n);
    let tot = 0;
    for (let k = 0; k < n; k++) { hs[k] = layers[k][0](r); tot += hs[k]; }
    if (tot === 0) return false;
    let px = x + d[0], py = y + d[1], pz = z + d[2];
    for (let l = 0; l < tot; l++) {
      if (!allowed(R, px, py, pz)) {
        let k = tot - l; const tip = c.prioritize_tip, step = tip ? 1 : -1;
        for (let o = tip ? 0 : n - 1; o !== (tip ? n : -1) && k > 0; o += step) { const q = Math.min(hs[o], k); k -= q; hs[o] -= q; }
        break;
      }
      px += d[0]; py += d[1]; pz += d[2];
    }
    let cx = x, cy = y, cz = z;
    for (let l = 0; l < n; l++) for (let o = 0; o < hs[l]; o++) { R.setState(cx, cy, cz, layers[l][1](r, cx, cy, cz, R)); cx += d[0]; cy += d[1]; cz += d[2]; }
    return true;
  };

  // OreFeature (also used by scattered ore below)
  FEATURE.ore = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, size = c.size;
    const targets = once(cfg, 't', () => c.targets.map(t => [ruleTest(t.target), stateOf(t.state)]));
    const f = r.nextFloat() * Math.PI, g = Math.fround(size / 8), i = Math.ceil((size / 16 * 2 + 1) / 2);
    const d0 = x + msin(f) * g, e0 = x - msin(f) * g, h0 = z + mcos(f) * g, j0 = z - mcos(f) * g;
    const l0 = y + r.nextInt(3) - 2, m0 = y + r.nextInt(3) - 2;
    const n = x - Math.ceil(g) - i, o = y - 2 - i, p = z - Math.ceil(g) - i, q = 2 * (Math.ceil(g) + i), rr = 2 * (2 + i);
    for (let s = n; s <= n + q; s++) for (let t = p; t <= p + q; t++) {
      if (o > R.height('OCEAN_FLOOR_WG', s, t)) continue;
      return oreDoPlace(R, r, c, targets, d0, e0, h0, j0, l0, m0, n, o, p, q, rr);
    }
    return false;
  };
  function oreDoPlace(R, r, c, targets, d, e, f, g, h, i, j, k, l, m, n) {
    let placed = 0;
    const seen = new Set(), size = c.size, ds = new Float64Array(size * 4);
    for (let q = 0; q < size; q++) {
      const t = Math.fround(q / size);
      const s = d + t * (e - d), tt = h + t * (i - h), u = f + t * (g - f);
      const v = r.nextDouble() * size / 16;
      const w = ((Math.fround(msin(Math.PI * t) + 1)) * v + 1) / 2;
      ds[q * 4] = s; ds[q * 4 + 1] = tt; ds[q * 4 + 2] = u; ds[q * 4 + 3] = w;
    }
    for (let q = 0; q < size - 1; q++) {
      if (ds[q * 4 + 3] <= 0) continue;
      for (let rr = q + 1; rr < size; rr++) {
        if (ds[rr * 4 + 3] <= 0) continue;
        const s = ds[q * 4] - ds[rr * 4], t = ds[q * 4 + 1] - ds[rr * 4 + 1], u = ds[q * 4 + 2] - ds[rr * 4 + 2], v = ds[q * 4 + 3] - ds[rr * 4 + 3];
        if (!(v * v > s * s + t * t + u * u)) continue;
        if (v > 0) ds[rr * 4 + 3] = -1; else ds[q * 4 + 3] = -1;
      }
    }
    const discard = c.discard_chance_on_air_exposure || 0;
    for (let rr = 0; rr < size; rr++) {
      const s = ds[rr * 4 + 3];
      if (s < 0) continue;
      const t = ds[rr * 4], u = ds[rr * 4 + 1], v = ds[rr * 4 + 2];
      const w = Math.max(Math.floor(t - s), j), x = Math.max(Math.floor(u - s), k), y = Math.max(Math.floor(v - s), l);
      const z = Math.max(Math.floor(t + s), w), aa = Math.max(Math.floor(u + s), x), ab = Math.max(Math.floor(v + s), y);
      for (let ac = w; ac <= z; ac++) {
        const ad = (ac + 0.5 - t) / s;
        if (ad * ad >= 1) continue;
        for (let ae = x; ae <= aa; ae++) {
          const af = (ae + 0.5 - u) / s;
          if (ad * ad + af * af >= 1) continue;
          for (let ag = y; ag <= ab; ag++) {
            const ah = (ag + 0.5 - v) / s;
            if (ad * ad + af * af + ah * ah >= 1 || ae < R.minY || ae >= R.maxY) continue;
            const ai = ac - j + (ae - k) * m + (ag - l) * m * n;
            if (seen.has(ai)) continue;
            seen.add(ai);
            if (!R.canWrite(ac, ae, ag)) continue;
            const cur = R.id(ac, ae, ag);
            for (const [test, st] of targets) {
              if (!test(r, cur)) continue;
              if (!(discard <= 0 || (discard < 1 && r.nextFloat() >= discard))) {
                if (adjacentAir(R, ac, ae, ag)) continue;
              }
              R.setState(ac, ae, ag, st); placed++; break;
            }
          }
        }
      }
    }
    return placed > 0;
  }
  const DIR6 = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]; // down up north south west east
  const adjacentAir = (R, x, y, z) => DIR6.some(d => R.isAir(x + d[0], y + d[1], z + d[2]));
  FEATURE.scattered_ore = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, targets = once(cfg, 't', () => c.targets.map(t => [ruleTest(t.target), stateOf(t.state)]));
    const i = r.nextInt(c.size + 1);
    for (let j = 0; j < i; j++) {
      const k = Math.min(j, 7);
      const off = () => Math.round((r.nextFloat() - r.nextFloat()) * k);
      const px = x + off(), py = y + off(), pz = z + off();
      const cur = R.id(px, py, pz);
      for (const [test, st] of targets) {
        if (!test(r, cur)) continue;
        const d = c.discard_chance_on_air_exposure || 0;
        if (!(d <= 0 || (d < 1 && r.nextFloat() >= d)) && adjacentAir(R, px, py, pz)) continue;
        R.setState(px, py, pz, st); break;
      }
    }
    return true;
  };

  FEATURE.disk = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, prov = once(cfg, 'p', () => provider(c.state_provider)), target = once(cfg, 't', () => predicate(c.target));
    const rad = intProvider(c.radius)(r), top = y + c.half_height, bot = y - c.half_height - 1;
    let any = false;
    for (let px = x - rad; px <= x + rad; px++) for (let pz = z - rad; pz <= z + rad; pz++) {
      const dx = px - x, dz = pz - z;
      if (dx * dx + dz * dz > rad * rad) continue;
      let above = false;
      for (let py = top; py > bot; py--) {
        if (target(R, px, py, pz)) {
          const s = prov(r, px, py, pz, R);
          R.setState(px, py, pz, s); above = true; any = true;
        }
      }
    }
    return any;
  };
  // FreezeTopLayer: snow on cold columns, ice on cold water (the whole chunk)
  FEATURE.freeze_top_layer = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, x0 = x & ~15, z0 = z & ~15, SNOW = BID.snow, ICE = BID.ice;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const px = x0 + i, pz = z0 + j, py = R.height('MOTION_BLOCKING', px, pz);
      const b = ctx.biomeAt(px, py - 1, pz), def = D.biome[b];
      if (!def) continue;
      const cold = (yy) => WG.biomeTemperature(def, px, yy, pz, 63) < 0.15000000596046448;
      if (R.id(px, py - 1, pz) === WATER && cold(py - 1) && R.meta(px, py - 1, pz) === 0) R.set(px, py - 1, pz, ICE);
      if (def.has_precipitation && cold(py) && py < R.maxY && R.isAir(px, py, pz) && canSurvive(R, SNOW, 0, px, py, pz)) {
        R.set(px, py, pz, SNOW);
        const g = R.id(px, py - 1, pz);
        if (g === BID.grass_block || g === BID.podzol || g === BID.mycelium) R.set(px, py - 1, pz, g, g === BID.grass_block ? 1 : withProp(g, R.meta(px, py - 1, pz), 'snowy', 'true'));
      }
    }
    return true;
  };
  FEATURE.lake = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw;
    const fluidP = once(cfg, 'f', () => provider(c.fluid)), barrierP = once(cfg, 'b', () => provider(c.barrier));
    const canRepl = once(cfg, 'r', () => predicate(c.can_replace_with_air_or_fluid)), canBarrier = once(cfg, 'q', () => predicate(c.can_replace_with_barrier));
    if (y <= R.minY + 4) return false;
    y -= 4;
    const fluid = fluidP(r, x, y, z, R), lava = fluid && fluid[0] === LAVA;
    const bs = new Uint8Array(2048);
    const n = r.nextInt(4) + 4;
    for (let k = 0; k < n; k++) {
      const d = r.nextDouble() * 6 + 3, e = r.nextDouble() * 4 + 2, f = r.nextDouble() * 6 + 3;
      const g = r.nextDouble() * (16 - d - 2) + 1 + d / 2, h = r.nextDouble() * (8 - e - 4) + 2 + e / 2, l = r.nextDouble() * (16 - f - 2) + 1 + f / 2;
      for (let m = 1; m < 15; m++) for (let o = 1; o < 15; o++) for (let p = 1; p < 7; p++) {
        const q = (m - g) / (d / 2), rr = (p - h) / (e / 2), s = (o - l) / (f / 2);
        if (q * q + rr * rr + s * s < 1) bs[(m * 16 + o) * 8 + p] = 1;
      }
    }
    const B = (m, o, p) => bs[(m * 16 + o) * 8 + p];
    const edge = (m, o, p) => !B(m, o, p) && (m < 15 && B(m + 1, o, p) || m > 0 && B(m - 1, o, p) || o < 15 && B(m, o + 1, p) || o > 0 && B(m, o - 1, p) || p < 7 && B(m, o, p + 1) || p > 0 && B(m, o, p - 1));
    for (let m = 0; m < 16; m++) for (let o = 0; o < 16; o++) for (let p = 0; p < 8; p++) {
      if (!edge(m, o, p)) continue;
      const id = R.id(x + m, y + p, z + o);
      if (p >= 4 && IS_FLUID[id]) return false;
      if (p < 4 && !(BLOCKS[id] && BLOCKS[id].solid) && id !== fluid[0]) return false;
    }
    for (let m = 0; m < 16; m++) for (let o = 0; o < 16; o++) for (let p = 0; p < 8; p++) {
      if (!B(m, o, p)) continue;
      const px = x + m, py = y + p, pz = z + o;
      if (!canRepl(R, px, py, pz)) continue;
      R.set(px, py, pz, p >= 4 ? 0 : fluid[0], 0);
    }
    if (barrierP) for (let m = 0; m < 16; m++) for (let o = 0; o < 16; o++) for (let p = 0; p < 8; p++) {
      if (!edge(m, o, p) || (p >= 4 && r.nextInt(2) === 0)) continue;
      const px = x + m, py = y + p, pz = z + o, id = R.id(px, py, pz);
      if (!(BLOCKS[id] && BLOCKS[id].solid) || !canBarrier(R, px, py, pz)) continue;
      if (lava) R.setState(px, py, pz, barrierP(r, px, py, pz, R));
    }
    return true;
  };
  FEATURE.spring_feature = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, valid = once(cfg, 'v', () => blockSet(c.valid_blocks)), st = stateOf(c.state);
    const reqBelow = c.requires_block_below !== false, rocks = c.rock_count ?? 4, holes = c.hole_count ?? 1;
    if (!valid.has(R.id(x, y + 1, z))) return false;
    if (reqBelow && !valid.has(R.id(x, y - 1, z))) return false;
    const cur = R.id(x, y, z);
    if (cur !== 0 && !valid.has(cur)) return false;
    let k = 0, l = 0;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const id = R.id(x + dx, y, z + dz); if (valid.has(id)) k++; if (id === 0) l++; }
    if (!reqBelow) { const id = R.id(x, y - 1, z); if (valid.has(id)) k++; if (id === 0) l++; }
    if (k === rocks && l === holes) { R.setState(x, y, z, st); return true; }
    return false;
  };
  FEATURE.block_blob = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, st = stateOf(c.state), can = once(cfg, 'c', () => predicate(c.can_place_on));
    for (; y > R.minY + 3; y--) { if (R.isAir(x, y - 1, z)) continue; if (can(R, x, y - 1, z)) break; }
    if (y <= R.minY + 3) return false;
    for (let i = 0; i < 3; i++) {
      const j = r.nextInt(2), k = r.nextInt(2), l = r.nextInt(2), f = (j + k + l) * 0.333 + 0.5;
      for (let px = x - j; px <= x + j; px++) for (let py = y - k; py <= y + k; py++) for (let pz = z - l; pz <= z + l; pz++)
        if ((px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2 <= f * f) R.setState(px, py, pz, st);
      x += -1 + r.nextInt(2); y -= r.nextInt(2); z += -1 + r.nextInt(2);
    }
    return true;
  };
  // ice spikes
  FEATURE.spike = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, st = stateOf(c.state), can = once(cfg, 'c', () => predicate(c.can_place_on)), canRepl = once(cfg, 'r', () => predicate(c.can_replace));
    while (R.isAir(x, y, z) && y > R.minY + 2) y--;
    if (!can(R, x, y, z)) return false;
    y += r.nextInt(4);
    const i = r.nextInt(4) + 7, j = (i / 4 | 0) + r.nextInt(2);
    if (j > 1 && r.nextInt(60) === 0) y += 10 + r.nextInt(30);
    for (let k = 0; k < i; k++) {
      const f = (1 - k / i) * j, l = Math.ceil(f);
      for (let m = -l; m <= l; m++) {
        const g = Math.abs(m) - 0.25;
        for (let n = -l; n <= l; n++) {
          const h = Math.abs(n) - 0.25;
          if ((m === 0 && n === 0 || !(g * g + h * h > f * f)) && (m !== -l && m !== l && n !== -l && n !== l || !(r.nextFloat() > 0.75))) {
            if (canRepl(R, x + m, y + k, z + n)) R.setState(x + m, y + k, z + n, st);
            if (k !== 0 && l > 1 && canRepl(R, x + m, y - k, z + n)) R.setState(x + m, y - k, z + n, st);
          }
        }
      }
    }
    let k = j - 1; if (k < 0) k = 0; else if (k > 1) k = 1;
    for (let l = -k; l <= k; l++) for (let m = -k; m <= k; m++) {
      let py = y - 1, n = 50;
      if (Math.abs(l) === 1 && Math.abs(m) === 1) n = r.nextInt(5);
      while (py > 50) {
        if (!canRepl(R, x + l, py, z + m)) break;
        R.setState(x + l, py, z + m, st); py--;
        if (--n > 0) continue; py -= r.nextInt(5) + 1; n = r.nextInt(5);
      }
    }
    return true;
  };
  FEATURE.vines = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, VINE = BID.vine;
    if (!R.isAir(x, y, z)) return false;
    for (const [dx, dz, face] of [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']]) {
      if (SOLIDCUBE[R.id(x + dx, y, z + dz)]) { R.set(x, y, z, VINE, vineMeta({ [face]: 'true' })); return true; }
    }
    return false;
  };
  const vineMeta = (faces) => { const b = BLOCKS[BID.vine]; const i = b.states.findIndex(s => ['north', 'east', 'south', 'west', 'up'].every(k => s[k] === (faces[k] || 'false'))); return Math.max(0, i); };
  // MultifaceGrowthFeature (glow lichen, sculk veins ...): on a block it may grow on beside the spot, else beside the
  // spot's neighbour in each direction (vanilla's search sets the same neighbour search_range times over); once placed,
  // half the time it spreads one more face (MultifaceSpreader: the same block, the next block on the same plane, or
  // round the edge - onto any full face)
  const MF = [['down', 0, -1, 0], ['up', 0, 1, 0], ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0]]; // Direction.values()
  const MF_OPP = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };
  const MF_AXIS = { down: 1, up: 1, north: 2, south: 2, west: 0, east: 0 };
  const mfDir = Object.fromEntries(MF.map(d => [d[0], d]));
  const shuffled = (list, r) => { const L = list.slice(); for (let i = L.length; i > 1; i--) { const j = r.nextInt(i); const t = L[i - 1]; L[i - 1] = L[j]; L[j] = t; } return L; };
  const mfHas = (R, block, x, y, z, face) => R.id(x, y, z) === block && propOf(block, R.meta(x, y, z), face) === 'true';
  // MultifaceBlock.getStateForPlacement: the face added to what is there (air or water gets a fresh block); null if it can't
  function mfState(R, block, x, y, z, face, attachOk) {
    const id = R.id(x, y, z);
    if (id === block ? propOf(block, R.meta(x, y, z), face) === 'true' : !(id === 0 || id === WATER)) return null;
    if (!attachOk(R.id(x + mfDir[face][1], y + mfDir[face][2], z + mfDir[face][3]))) return null;
    const b = BLOCKS[block], faces = new Set([face]);
    if (id === block) for (const [f] of MF) if (propOf(block, R.meta(x, y, z), f) === 'true') faces.add(f);
    const i = b.states.findIndex(s => MF.every(([f]) => !(f in s) || (s[f] === 'true') === faces.has(f)) && (!('waterlogged' in s) || s.waterlogged === 'false'));
    return Math.max(0, i);
  }
  function mfSpread(R, block, x, y, z, from, r) {
    const full = (id) => !!SOLIDCUBE[id];
    for (const [to, tx, ty, tz] of shuffled(MF, r)) {
      if (MF_AXIS[to] === MF_AXIS[from] || !mfHas(R, block, x, y, z, from) || mfHas(R, block, x, y, z, to)) continue;
      const [, fx, fy, fz] = mfDir[from];
      // SAME_POSITION, SAME_PLANE, WRAP_AROUND: the first one it can spread into, then placed there (or not)
      for (const [px, py, pz, face] of [[x, y, z, to], [x + tx, y + ty, z + tz, from], [x + tx + fx, y + ty + fy, z + tz + fz, MF_OPP[to]]]) {
        const id = R.id(px, py, pz);
        if (!(id === 0 || id === block || (id === WATER && R.meta(px, py, pz) === 0))) continue;
        const m = mfState(R, block, px, py, pz, face, full);
        if (m === null) continue;
        if (R.set(px, py, pz, block, m)) return true;
        break;
      }
    }
    return false;
  }
  FEATURE.multiface_growth = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, block = BID[strip(c.block)], on = once(cfg, 'o', () => blockSet(c.can_be_placed_on));
    const airOrWater = (id) => id === 0 || id === WATER;
    if (block === undefined || !airOrWater(R.id(x, y, z))) return false;
    // validDirections: up (ceiling), down (floor), then the four sides
    const valid = [];
    if (c.can_place_on_ceiling) valid.push(mfDir.up);
    if (c.can_place_on_floor) valid.push(mfDir.down);
    if (c.can_place_on_wall) valid.push(mfDir.north, mfDir.east, mfDir.south, mfDir.west);
    const chance = c.chance_of_spreading ?? 0.5, range = c.search_range ?? 10;
    const grow = (px, py, pz, dirs) => {
      for (const [face, dx, dy, dz] of dirs) {
        if (!on.has(R.id(px + dx, py + dy, pz + dz))) continue;
        const m = mfState(R, block, px, py, pz, face, () => true);
        if (m === null) return false;
        R.set(px, py, pz, block, m);
        if (r.nextFloat() < chance) mfSpread(R, block, px, py, pz, face, r);
        return true;
      }
      return false;
    };
    const dirs = shuffled(valid, r);
    if (grow(x, y, z, dirs)) return true;
    for (const [face, dx, dy, dz] of dirs) {
      const others = shuffled(valid.filter(d => d[0] !== MF_OPP[face]), r);
      for (let i = 0; i < range; i++) {
        const px = x + dx, py = y + dy, pz = z + dz, id = R.id(px, py, pz);
        if (!airOrWater(id) && id !== block) break;
        if (grow(px, py, pz, others)) return true;
      }
    }
    return false;
  };
  FEATURE.vegetation_patch = (ctx, cfg, r, x, y, z) => vegetationPatch(ctx, cfg, r, x, y, z, false);
  FEATURE.waterlogged_vegetation_patch = (ctx, cfg, r, x, y, z) => vegetationPatch(ctx, cfg, r, x, y, z, true);
  function vegetationPatch(ctx, cfg, r, x, y, z, wet) {
    const R = ctx.R, c = cfg.raw;
    const repl = once(cfg, 'rp', () => tagSet(c.replaceable)), ground = once(cfg, 'g', () => provider(c.ground_state));
    const xzr = intProvider(c.xz_radius), depth = intProvider(c.depth);
    const up = c.surface === 'ceiling' ? 1 : -1, sx = xzr(r) + 1, sz = xzr(r) + 1;
    const placed = [];
    for (let i = -sx; i <= sx; i++) {
      const xe = i === -sx || i === sx;
      for (let j = -sz; j <= sz; j++) {
        const ze = j === -sz || j === sz, corner = xe && ze, edge = xe || ze;
        if (corner || edge && (c.extra_edge_column_chance === 0 || r.nextFloat() > c.extra_edge_column_chance)) continue;
        let py = y;
        for (let k = 0; k < c.vertical_range && R.isAir(x + i, py, z + j); k++) py += up;
        for (let k = 0; k < c.vertical_range && !R.isAir(x + i, py, z + j); k++) py -= up;
        const sy = py + up;
        if (!R.isAir(x + i, py, z + j) || !SOLIDCUBE[R.id(x + i, sy, z + j)]) continue;
        const d = depth(r) + (c.extra_bottom_block_chance > 0 && r.nextFloat() < c.extra_bottom_block_chance ? 1 : 0);
        let ok = false, gy = sy;
        for (let k = 0; k < d; k++) {
          if (!repl.has(R.id(x + i, gy, z + j))) break;
          R.setState(x + i, gy, z + j, ground(r, x + i, gy, z + j, R)); ok = true; gy += up === -1 ? -1 : 1;
        }
        if (ok) placed.push([x + i, py, z + j]);
      }
    }
    if (wet) for (const p of placed) {
      // waterlogged patches turn the surface into water pools surrounded by solid ground
      const [px, py, pz] = p;
      if (DIR6.slice(2).every(d => SOLIDCUBE[R.id(px + d[0], py - 1, pz + d[2])] || R.id(px + d[0], py - 1, pz + d[2]) === WATER)) R.set(px, py - 1, pz, WATER);
    }
    for (const p of placed) if (r.nextFloat() < c.vegetation_chance) placePF(ctx, c.vegetation_feature, r, wet ? [p[0], p[1] - 1, p[2]] : p);
    return placed.length > 0;
  }
  FEATURE.root_system = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw;
    if (!R.isAir(x, y, z) && R.id(x, y, z) !== WATER) return false;
    const allowedTree = once(cfg, 'a', () => predicate(c.allowed_tree_position));
    let ty = y, ok = false;
    for (let i = 0; i < c.required_vertical_space_for_tree; i++) {
      ty++;
      if (!allowedTree(R, x, ty, z) || !R.isAir(x, ty, z) && R.id(x, ty, z) !== WATER) break;
      if (i === c.required_vertical_space_for_tree - 1 || true) ok = true;
    }
    // root column down into the ground, then hanging roots below
    const repl = once(cfg, 'r', () => tagSet(c.root_replaceable)), rootP = once(cfg, 'rp', () => provider(c.root_state_provider));
    let py = y - 1, placedRoot = false;
    for (let i = 0; i < c.root_column_max_height && repl.has(R.id(x, py, z)); i++, py--) { R.setState(x, py, z, rootP(r, x, py, z, R)); placedRoot = true; }
    if (!placedRoot) return false;
    if (!placePF(ctx, c.feature, r, [x, y, z])) return true;
    const hp = once(cfg, 'h', () => provider(c.hanging_root_state_provider));
    for (let i = 0; i < c.hanging_root_placement_attempts; i++) {
      const px = x + r.nextInt(c.hanging_root_radius) - r.nextInt(c.hanging_root_radius), pz = z + r.nextInt(c.hanging_root_radius) - r.nextInt(c.hanging_root_radius);
      const pyy = py - r.nextInt(c.hanging_roots_vertical_span) + r.nextInt(c.hanging_roots_vertical_span);
      if (R.isAir(px, pyy, pz) && SOLIDCUBE[R.id(px, pyy + 1, pz)]) R.setState(px, pyy, pz, hp(r, px, pyy, pz, R));
    }
    return true;
  };
  FEATURE.bamboo = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, BAMBOO = BID.bamboo;
    if (!R.isAir(x, y, z) || BAMBOO === undefined) return false;
    const h = r.nextInt(12) + 5;
    if (r.nextFloat() < cfg.raw.probability) {
      const k = r.nextInt(4) + 1;
      for (let px = x - k; px <= x + k; px++) for (let pz = z - k; pz <= z + k; pz++) {
        if ((px - x) ** 2 + (pz - z) ** 2 > k * k) continue;
        const gy = R.height('WORLD_SURFACE_WG', px, pz) - 1;
        if (DIRT.has(R.id(px, gy, pz))) R.set(px, gy, pz, BID.podzol);
      }
    }
    if (!DIRT.has(R.id(x, y - 1, z)) && R.id(x, y - 1, z) !== BID.sand && R.id(x, y - 1, z) !== BID.gravel) return false;
    let i = 0;
    for (; i < h && R.isAir(x, y + i, z); i++) R.set(x, y + i, z, BAMBOO, bambooMeta(1, 'none'));
    if (i >= 3) {
      R.set(x, y + i, z, BAMBOO, bambooMeta(1, 'large'));
      R.set(x, y + i - 1, z, BAMBOO, bambooMeta(1, 'large'));
      R.set(x, y + i - 2, z, BAMBOO, bambooMeta(1, 'small'));
    }
    return i > 0;
  };
  const bambooMeta = (age, leaves) => Math.max(0, BLOCKS[BID.bamboo].states.findIndex(s => s.age === String(age) && s.leaves === leaves));
  FEATURE.huge_red_mushroom = (ctx, cfg, r, x, y, z) => hugeMushroom(ctx, cfg, r, x, y, z, true);
  FEATURE.huge_brown_mushroom = (ctx, cfg, r, x, y, z) => hugeMushroom(ctx, cfg, r, x, y, z, false);
  const mushMeta = (id, faces) => { const b = BLOCKS[id]; const i = b.states.findIndex(s => ['up', 'down', 'north', 'south', 'east', 'west'].every(k => s[k] === (faces[k] ? 'true' : 'false'))); return Math.max(0, i); };
  function hugeMushroom(ctx, cfg, r, x, y, z, red) {
    const R = ctx.R, c = cfg.raw, cap = stateOf(c.cap_provider.state || { Name: red ? 'red_mushroom_block' : 'brown_mushroom_block' }), stem = BID.mushroom_stem;
    let h = r.nextInt(3) + 4;
    if (r.nextInt(12) === 0) h *= 2;
    if (y < R.minY + 1 || y + h + 1 >= R.maxY) return false;
    if (!DIRT.has(R.id(x, y - 1, z)) && R.id(x, y - 1, z) !== BID.mycelium) return false;
    const radius = c.foliage_radius || (red ? 2 : 3);
    for (let i = 0; i <= h; i++) {
      const k = red ? (i < h ? 0 : radius) : (i < h ? 0 : radius);
      for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) { const id = R.id(x + dx, y + i, z + dz); if (id !== 0 && !LEAVES.has(id)) return false; }
    }
    for (let i = 0; i < h; i++) if (R.isAir(x, y + i, z) || REPLACEABLE[R.id(x, y + i, z)]) R.set(x, y + i, z, stem, mushMeta(stem, { north: 1, south: 1, east: 1, west: 1 }));
    if (red) {
      for (let i = h - 3; i <= h; i++) {
        const rr = i < h ? radius : radius - 1, j = radius - 2;
        for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
          const ex = dx === -rr, ex2 = dx === rr, ez = dz === -rr, ez2 = dz === rr, xe = ex || ex2, ze = ez || ez2;
          if (i < h && xe === ze) continue;
          if (!R.isAir(x + dx, y + i, z + dz) && !LEAVES.has(R.id(x + dx, y + i, z + dz))) continue;
          R.set(x + dx, y + i, z + dz, cap[0], mushMeta(cap[0], { up: i >= h - 1, west: dx < -j, east: dx > j, north: dz < -j, south: dz > j }));
        }
      }
    } else {
      const rr = radius;
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        const xe = dx === -rr || dx === rr, ze = dz === -rr || dz === rr;
        if (xe && ze) continue;
        if (!R.isAir(x + dx, y + h, z + dz) && !LEAVES.has(R.id(x + dx, y + h, z + dz))) continue;
        const w = dx === -rr || (ze && dx === 1 - rr), e = dx === rr || (ze && dx === rr - 1), n = dz === -rr || (xe && dz === 1 - rr), s = dz === rr || (xe && dz === rr - 1);
        R.set(x + dx, y + h, z + dz, cap[0], mushMeta(cap[0], { up: 1, west: w, east: e, north: n, south: s }));
      }
    }
    return true;
  }
  // underwater plants (always-waterlogged blocks replace water)
  FEATURE.seagrass = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, i = r.nextInt(8) - r.nextInt(8), j = r.nextInt(8) - r.nextInt(8), px = x + i, pz = z + j, py = R.height('OCEAN_FLOOR', px, pz);
    if (R.id(px, py, pz) !== WATER || !SOLIDCUBE[R.id(px, py - 1, pz)]) return false;
    const tall = r.nextDouble() < cfg.raw.probability && R.id(px, py + 1, pz) === WATER;
    if (tall && BID.tall_seagrass !== undefined) { R.set(px, py, pz, BID.tall_seagrass, 0); R.set(px, py + 1, pz, BID.tall_seagrass, 1); }
    else if (BID.seagrass !== undefined) R.set(px, py, pz, BID.seagrass);
    return true;
  };
  FEATURE.kelp = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, py0 = R.height('OCEAN_FLOOR', x, z);
    if (R.id(x, py0, z) !== WATER || BID.kelp === undefined) return false;
    const h = 1 + r.nextInt(10);
    let n = 0;
    for (let i = 0; i <= h; i++) {
      const py = py0 + i;
      if (R.id(x, py, z) !== WATER || R.id(x, py + 1, z) !== WATER) { if (i > 0) R.set(x, py - 1, z, BID.kelp); break; }
      if (i === h) { R.set(x, py, z, BID.kelp); n++; break; }
      R.set(x, py, z, BID.kelp_plant); n++;
    }
    return n > 0;
  };
  FEATURE.sea_pickle = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, n = intProvider(cfg.raw.count)(r);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const px = x + r.nextInt(8) - r.nextInt(8), pz = z + r.nextInt(8) - r.nextInt(8), py = R.height('OCEAN_FLOOR', px, pz);
      const pickles = r.nextInt(4) + 1;
      if (R.id(px, py, pz) === WATER && SOLIDCUBE[R.id(px, py - 1, pz)] && BID.sea_pickle !== undefined) { R.set(px, py, pz, BID.sea_pickle, Math.max(0, BLOCKS[BID.sea_pickle].states.findIndex(s => s.pickles === String(pickles) && s.waterlogged === 'true'))); k++; }
    }
    return k > 0;
  };
  FEATURE.underwater_magma = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw;
    let fy = y;
    for (let i = 0; i < c.floor_search_range && R.id(x, fy, z) === WATER; i++) fy--;
    if (!SOLIDCUBE[R.id(x, fy, z)]) return false;
    const rad = c.placement_radius_around_floor;
    let k = 0;
    for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) for (let dz = -rad; dz <= rad; dz++) {
      if (r.nextFloat() >= c.placement_probability_per_valid_position) continue;
      const px = x + dx, py = fy + dy, pz = z + dz;
      if (!SOLIDCUBE[R.id(px, py, pz)] || R.id(px, py + 1, pz) !== WATER) continue;
      if (DIR6.slice(2).some(d => !SOLIDCUBE[R.id(px + d[0], py, pz + d[2])])) continue;
      R.set(px, py, pz, BID.magma_block); k++;
    }
    return k > 0;
  };
  FEATURE.coral_tree = FEATURE.coral_claw = FEATURE.coral_mushroom = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, kinds = ['tube', 'brain', 'bubble', 'fire', 'horn'], kind = kinds[r.nextInt(5)], blk = BID[kind + '_coral_block'];
    if (blk === undefined) return false;
    const h = r.nextInt(3) + 2;
    let placed = false;
    for (let i = 0; i < h; i++) {
      const py = y + i;
      if (R.id(x, py, z) !== WATER && i > 0) break;
      R.set(x, py, z, blk); placed = true;
      if (r.nextFloat() < 0.25 && R.id(x, py + 1, z) === WATER) { const deco = [kind + '_coral', kind + '_coral_fan'][r.nextInt(2)]; if (BID[deco] !== undefined) R.set(x, py + 1, z, BID[deco]); }
      for (const [dx, dz, f] of [[1, 0, 'east'], [-1, 0, 'west'], [0, 1, 'south'], [0, -1, 'north']]) {
        if (r.nextFloat() < 0.2 && R.id(x + dx, py, z + dz) === WATER && BID[kind + '_coral_wall_fan'] !== undefined) {
          const w = BID[kind + '_coral_wall_fan'];
          R.set(x + dx, py, z + dz, w, Math.max(0, BLOCKS[w].states.findIndex(s => s.facing === f)));
        }
      }
    }
    return placed;
  };
  FEATURE.blue_ice = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R;
    if (y > 61 || y < R.minY) return false;
    if (R.id(x, y, z) !== WATER && !R.isAir(x, y, z)) return false;
    const PI = BID.packed_ice, BI2 = BID.blue_ice;
    if (![1, -1].some(d => R.id(x, y + d, z) === PI) && !DIR6.some(d => R.id(x + d[0], y + d[1], z + d[2]) === PI)) return false;
    R.set(x, y, z, BI2);
    for (let i = 0; i < 200; i++) {
      const j = r.nextInt(5) - r.nextInt(6);
      let k = 3; if (j < 2) k += j / 2 | 0;
      if (k < 1) continue;
      const px = x + r.nextInt(k) - r.nextInt(k), py = y + j, pz = z + r.nextInt(k) - r.nextInt(k), id = R.id(px, py, pz);
      if (id === 0 || id === WATER || id === PI || id === BID.ice) for (const d of DIR6) if (R.id(px + d[0], py + d[1], pz + d[2]) === BI2) { R.set(px, py, pz, BI2); break; }
    }
    return true;
  };
  // Iceberg (simplified shape: packed ice / blue ice cone that dips into the sea)
  FEATURE.iceberg = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, st = stateOf(cfg.raw.state), sea = 63;
    y = sea;
    const big = r.nextDouble() > 0.7, h = big ? r.nextInt(14) + 12 : r.nextInt(7) + 4, depth = big ? r.nextInt(16) + 4 : r.nextInt(3) + 3, rad = big ? r.nextInt(5) + 6 : r.nextInt(3) + 3;
    for (let dy = -depth; dy <= h; dy++) {
      const t = dy >= 0 ? 1 - dy / (h + 1) : 1 - (-dy) / (depth + 1);
      const rr = rad * Math.sqrt(Math.max(0, t));
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx * dx + dz * dz > rr * rr + r.nextFloat() * 2) continue;
        const id = R.id(x + dx, y + dy, z + dz);
        if (id === 0 || id === WATER || id === BID.ice || id === BID.snow_block) R.setState(x + dx, y + dy, z + dz, dy > h - 3 && r.nextInt(3) === 0 ? [BID.snow_block, 0] : st);
      }
    }
    return true;
  };
  // GeodeFeature (amethyst geodes)
  FEATURE.geode = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, B = c.blocks, L = c.layers || {}, CR = c.crack || {};
    const minOff = c.min_gen_offset ?? -16, maxOff = c.max_gen_offset ?? 16;
    const dist = intProvider(c.outer_wall_distance || { type: 'uniform', min_inclusive: 4, max_inclusive: 5 });
    const distMax = c.outer_wall_distance ? c.outer_wall_distance.max_inclusive : 5;
    const pOff = intProvider(c.point_offset || { type: 'uniform', min_inclusive: 1, max_inclusive: 2 });
    const k = intProvider(c.distribution_points || { type: 'uniform', min_inclusive: 3, max_inclusive: 4 })(r);
    const noise = once(cfg, 'n', () => legacyNormalNoise(BigInt(ctx.seed), { firstOctave: -4, amplitudes: [1] }));
    const d = k / distMax;
    const e = 1 / Math.sqrt(L.filling ?? 1.7), f = 1 / Math.sqrt((L.inner_layer ?? 2.2) + d), g = 1 / Math.sqrt((L.middle_layer ?? 3.2) + d), h = 1 / Math.sqrt((L.outer_layer ?? 4.2) + d);
    const l = 1 / Math.sqrt((CR.base_crack_size ?? 2) + r.nextDouble() / 2 + (k > 3 ? d : 0));
    const crack = r.nextFloat() < (CR.generate_crack_chance ?? 1), cpo = CR.crack_point_offset ?? 2;
    const invalid = once(cfg, 'i', () => tagSet(B.invalid_blocks || 'geode_invalid_blocks')), cannot = once(cfg, 'c', () => tagSet(B.cannot_replace || 'features_cannot_replace'));
    const pts = [];
    let m = 0;
    for (let n = 0; n < k; n++) {
      const o = dist(r), p = dist(r), q = dist(r), id = R.id(x + o, y + p, z + q);
      if ((id === 0 || invalid.has(id)) && ++m > (c.invalid_blocks_threshold ?? 0)) return false;
      pts.push([x + o, y + p, z + q, pOff(r)]);
    }
    const cracks = [];
    if (crack) {
      const n = r.nextInt(4), o = k * 2 + 1;
      const base = [[o, 0], [0, o], [o, o], [0, 0]][n];
      for (const dy of [7, 5, 1]) cracks.push([x + base[0], y + dy, z + base[1]]);
    }
    const prov = (q) => provider(q);
    const P = once(cfg, 'p', () => ({ fill: prov(B.filling_provider), inner: prov(B.inner_layer_provider), alt: prov(B.alternate_inner_layer_provider), mid: prov(B.middle_layer_provider), out: prov(B.outer_layer_provider), buds: B.inner_placements.map(stateOf) }));
    const safeSet = (px, py, pz, st) => { if (!cannot.has(R.id(px, py, pz))) R.setState(px, py, pz, st); };
    const alt0 = c.use_alternate_layer0_chance ?? 0, reqAlt = c.placements_require_layer0_alternate ?? true, usePot = c.use_potential_placements_chance ?? 0.35, nm = c.noise_multiplier ?? 0.05;
    const spots = [];
    for (let pz = z + minOff; pz <= z + maxOff; pz++) for (let py = y + minOff; py <= y + maxOff; py++) for (let px = x + minOff; px <= x + maxOff; px++) {
      const rn = noise.get(px, py, pz) * nm;
      let sv = 0, tv = 0;
      for (const P2 of pts) sv += 1 / Math.sqrt((P2[0] - px) ** 2 + (P2[1] - py) ** 2 + (P2[2] - pz) ** 2 + P2[3]) + rn;
      for (const C2 of cracks) tv += 1 / Math.sqrt((C2[0] - px) ** 2 + (C2[1] - py) ** 2 + (C2[2] - pz) ** 2 + cpo) + rn;
      if (sv < h) continue;
      if (crack && tv >= l && sv < e) { safeSet(px, py, pz, [0, 0]); continue; }
      if (sv >= e) { safeSet(px, py, pz, P.fill(r, px, py, pz, R)); continue; }
      if (sv >= f) {
        const alt = r.nextFloat() < alt0;
        safeSet(px, py, pz, alt ? P.alt(r, px, py, pz, R) : P.inner(r, px, py, pz, R));
        if (reqAlt && !alt || !(r.nextFloat() < usePot)) continue;
        spots.push([px, py, pz]);
        continue;
      }
      if (sv >= g) { safeSet(px, py, pz, P.mid(r, px, py, pz, R)); continue; }
      safeSet(px, py, pz, P.out(r, px, py, pz, R));
    }
    const FAC = [['down', 0, -1, 0], ['up', 0, 1, 0], ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0]];
    for (const [px, py, pz] of spots) {
      const st = P.buds[r.nextInt(P.buds.length)];
      if (!st) continue;
      for (const [face, dx, dy, dz] of FAC) {
        const id = R.id(px + dx, py + dy, pz + dz);
        if (!(id === 0 || (id === WATER && R.meta(px + dx, py + dy, pz + dz) === 0))) continue;
        safeSet(px + dx, py + dy, pz + dz, [st[0], withProp(st[0], st[1], 'facing', face)]);
        break;
      }
    }
    return true;
  };
  // pointed dripstone clusters / large dripstones (simplified)
  FEATURE.pointed_dripstone = FEATURE.speleothem = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, PD = BID.pointed_dripstone;
    if (PD === undefined) return false;
    const up = SOLIDCUBE[R.id(x, y + 1, z)], down = SOLIDCUBE[R.id(x, y - 1, z)];
    if (!up && !down) return false;
    const dir = up ? -1 : 1, len = 1 + r.nextInt(4);
    for (let i = 0; i < len; i++) {
      const py = y + i * dir;
      if (!R.isAir(py === y ? x : x, py, z)) break;
      const th = i === len - 1 ? 'tip' : i === len - 2 ? 'frustum' : i === 0 ? 'base' : 'middle';
      R.set(x, py, z, PD, Math.max(0, BLOCKS[PD].states.findIndex(s => s.thickness === th && s.vertical_direction === (dir < 0 ? 'down' : 'up'))));
    }
    return true;
  };
  FEATURE.dripstone_cluster = FEATURE.speleothem_cluster = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, DB = BID.dripstone_block;
    const rad = intProvider(cfg.raw.radius || 5)(r);
    let any = false;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      if (dx * dx + dz * dz > rad * rad || r.nextFloat() > 0.6) continue;
      for (const dy of [-1, 1]) {
        let py = y;
        for (let k = 0; k < 12 && R.isAir(x + dx, py, z + dz); k++) py += dy;
        if (SOLIDCUBE[R.id(x + dx, py, z + dz)] && DB !== undefined) { R.set(x + dx, py, z + dz, DB); any = true; FEATURE.pointed_dripstone(ctx, cfg, r, x + dx, py - dy, z + dz); }
      }
    }
    return any;
  };
  FEATURE.large_dripstone = (ctx, cfg, r, x, y, z) => FEATURE.dripstone_cluster(ctx, { raw: { radius: 3 } }, r, x, y, z);
  FEATURE.sculk_patch = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, S = BID.sculk, V = BID.sculk_vein;
    if (S === undefined) return false;
    const n = cfg.raw.spread_attempts || 32;
    let any = false;
    for (let i = 0; i < n; i++) {
      const px = x + r.nextInt(9) - 4, pz = z + r.nextInt(9) - 4;
      let py = y; for (let k = 0; k < 6 && R.isAir(px, py, pz); k++) py--;
      const id = R.id(px, py, pz);
      if (SOLIDCUBE[id] && id !== BID.bedrock) { R.set(px, py, pz, S); any = true; if (r.nextFloat() < 0.15 && R.isAir(px, py + 1, pz)) { const k = ['sculk_sensor', 'sculk_shrieker', 'sculk_catalyst'][r.nextInt(3)]; if (BID[k] !== undefined && r.nextFloat() < 0.3) R.set(px, py + 1, pz, BID[k]); } }
    }
    return any;
  };
  // vanilla dungeons are generated by the old generator's monster room (kept for gen-2 too)
  FEATURE.monster_room = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, k = r.nextInt(2) + 2, l = -k - 1, m = k + 1, o = r.nextInt(2) + 2, p = -o - 1, q = o + 1;
    let s = 0;
    for (let t = l; t <= m; t++) for (let u = -1; u <= 4; u++) for (let v = p; v <= q; v++) {
      const id = R.id(x + t, y + u, z + v), solid = BLOCKS[id] && BLOCKS[id].solid;
      if (u === -1 && !solid) return false;
      if (u === 4 && !solid) return false;
      if ((t === l || t === m || v === p || v === q) && u === 0 && R.isAir(x + t, y + u, z + v) && R.isAir(x + t, y + u + 1, z + v)) s++;
    }
    if (s < 1 || s > 5) return false;
    for (let t = l; t <= m; t++) for (let u = 3; u >= -1; u--) for (let v = p; v <= q; v++) {
      const px = x + t, py = y + u, pz = z + v, id = R.id(px, py, pz);
      if (t === l || u === -1 || v === p || t === m || u === 4 || v === q) {
        if (py >= R.minY && !(BLOCKS[R.id(px, py - 1, pz)] && BLOCKS[R.id(px, py - 1, pz)].solid)) { R.set(px, py, pz, 0); continue; }
        if (!(BLOCKS[id] && BLOCKS[id].solid) || id === BID.chest) continue;
        R.set(px, py, pz, u === -1 && r.nextInt(4) !== 0 ? BID.mossy_cobblestone : BID.cobblestone);
      } else if (id !== BID.chest && id !== BID.spawner) R.set(px, py, pz, 0);
    }
    for (let t = 0; t < 2; t++) for (let u = 0; u < 3; u++) {
      const px = x + r.nextInt(k * 2 + 1) - k, pz = z + r.nextInt(o * 2 + 1) - o;
      if (!R.isAir(px, y, pz)) continue;
      let walls = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (BLOCKS[R.id(px + dx, y, pz + dz)] && BLOCKS[R.id(px + dx, y, pz + dz)].solid) walls++;
      if (walls !== 1) continue;
      R.set(px, y, pz, BID.chest, 4 | 8);
      break;
    }
    R.set(x, y, z, BID.spawner, r.nextInt(3));
    return true;
  };

  // ---- Nether features ------------------------------------------------------------------------------
  const mthNext = (r, a, b) => a >= b ? a : r.nextInt(b - a + 1) + a;
  const DIR6B = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  const isEmptyB = (id) => id === 0;
  FEATURE.glowstone_blob = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, G = BID.glowstone;
    if (!R.isAir(x, y, z)) return false;
    const up = R.id(x, y + 1, z);
    if (up !== BID.netherrack && up !== BID.basalt && up !== BID.blackstone) return false;
    R.set(x, y, z, G);
    for (let i = 0; i < 1500; i++) {
      const px = x + r.nextInt(8) - r.nextInt(8), py = y - r.nextInt(12), pz = z + r.nextInt(8) - r.nextInt(8);
      if (!R.isAir(px, py, pz)) continue;
      let j = 0;
      for (const d of DIR6B) { if (R.id(px + d[0], py + d[1], pz + d[2]) === G) j++; if (j > 1) break; }
      if (j !== 1) continue;
      R.set(px, py, pz, G);
    }
    return true;
  };
  FEATURE.netherrack_replace_blobs = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, target = stateOf(c.target)[0], st = stateOf(c.state), rad = intProvider(c.radius);
    y = clamp(y, R.minY + 1, R.maxY - 1);
    while (y > R.minY + 1 && R.id(x, y, z) !== target) y--;
    if (R.id(x, y, z) !== target) return false;
    const i = rad(r), j = rad(r), k = rad(r), l = Math.max(i, j, k);
    let any = false;
    for (let dx = -i; dx <= i; dx++) for (let dy = -j; dy <= j; dy++) for (let dz = -k; dz <= k; dz++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > l) continue;
      if (R.id(x + dx, y + dy, z + dz) !== target) continue;
      R.setState(x + dx, y + dy, z + dz, st); any = true;
    }
    return any;
  };
  function weepingColumn(R, r, x, y, z, n, lo, hi, dy, tip, body) {
    for (let l = dy < 0 ? 0 : 1; l <= n; l++) {
      if (R.isAir(x, y, z)) {
        if (l === n || !R.isAir(x, y + dy, z)) { R.set(x, y, z, tip, Math.max(0, BLOCKS[tip].states ? BLOCKS[tip].states.findIndex(s => s.age === String(mthNext(r, lo, hi))) : 0)); break; }
        R.set(x, y, z, body);
      }
      y += dy;
    }
  }
  FEATURE.weeping_vines = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, NR = BID.netherrack, NW = BID.nether_wart_block;
    if (!R.isAir(x, y, z)) return false;
    const up = R.id(x, y + 1, z);
    if (up !== NR && up !== NW) return false;
    R.set(x, y, z, NW);
    for (let i = 0; i < 200; i++) {
      const px = x + r.nextInt(6) - r.nextInt(6), py = y + r.nextInt(2) - r.nextInt(5), pz = z + r.nextInt(6) - r.nextInt(6);
      if (!R.isAir(px, py, pz)) continue;
      let j = 0;
      for (const d of DIR6B) { const id = R.id(px + d[0], py + d[1], pz + d[2]); if (id === NR || id === NW) j++; if (j > 1) break; }
      if (j !== 1) continue;
      R.set(px, py, pz, NW);
    }
    for (let i = 0; i < 100; i++) {
      const px = x + r.nextInt(8) - r.nextInt(8), py = y + r.nextInt(2) - r.nextInt(7), pz = z + r.nextInt(8) - r.nextInt(8);
      if (!R.isAir(px, py, pz)) continue;
      const a = R.id(px, py + 1, pz);
      if (a !== NR && a !== NW) continue;
      let n = mthNext(r, 1, 8);
      if (r.nextInt(6) === 0) n *= 2;
      if (r.nextInt(5) === 0) n = 1;
      weepingColumn(R, r, px, py, pz, n, 17, 25, -1, BID.weeping_vines, BID.weeping_vines_plant);
    }
    return true;
  };
  FEATURE.twisting_vines = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, i = c.spread_width, j = c.spread_height, k = c.max_height;
    const invalid = (px, py, pz) => { if (!R.isAir(px, py, pz)) return true; const b = R.id(px, py - 1, pz); return b !== BID.netherrack && b !== BID.warped_nylium && b !== BID.warped_wart_block; };
    if (invalid(x, y, z)) return false;
    for (let l = 0; l < i * i; l++) {
      let px = x + mthNext(r, -i, i), py = y + mthNext(r, -j, j), pz = z + mthNext(r, -i, i);
      let ok = true;
      do { py--; if (py < R.minY || py >= R.maxY) { ok = false; break; } } while (R.isAir(px, py, pz));
      if (!ok) continue;
      py++;
      if (invalid(px, py, pz)) continue;
      let n = mthNext(r, 1, k);
      if (r.nextInt(6) === 0) n *= 2;
      if (r.nextInt(5) === 0) n = 1;
      weepingColumn(R, r, px, py, pz, n, 17, 25, 1, BID.twisting_vines, BID.twisting_vines_plant);
    }
    return true;
  };
  FEATURE.nether_forest_vegetation = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, prov = once(cfg, 'p', () => provider(c.state_provider)), w = c.spread_width, h = c.spread_height;
    if (!tagSet('nylium').has(R.id(x, y - 1, z))) return false;
    if (y < R.minY + 1 || y + 1 > R.maxY) return false;
    let n = 0;
    for (let k = 0; k < w * w; k++) {
      const px = x + r.nextInt(w) - r.nextInt(w), py = y + r.nextInt(h) - r.nextInt(h), pz = z + r.nextInt(w) - r.nextInt(w);
      const s = prov(r, px, py, pz, R);
      if (!R.isAir(px, py, pz) || py <= R.minY || !s || !canSurvive(R, s[0], s[1], px, py, pz)) continue;
      R.set(px, py, pz, s[0], s[1]); n++;
    }
    return n > 0;
  };
  FEATURE.huge_fungus = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw;
    const base = stateOf(c.valid_base_block)[0], stem = stateOf(c.stem_state), hat = stateOf(c.hat_state), decor = stateOf(c.decor_state);
    const repl = once(cfg, 'r', () => predicate(c.replaceable_blocks));
    if (R.id(x, y - 1, z) !== base) return false;
    let i = mthNext(r, 4, 13);
    if (r.nextInt(12) === 0) i *= 2;
    if (!c.planted && y + i + 1 >= R.maxY) return false;
    const thick = !c.planted && r.nextFloat() < 0.06;
    R.set(x, y, z, 0);
    const canRepl = (px, py, pz, stemPass) => { const id = R.id(px, py, pz); if (id === 0 || IS_FLUID[id] || REPLACEABLE[id]) return true; return stemPass ? repl(R, px, py, pz) : false; };
    const j = thick ? 1 : 0;
    for (let k = -j; k <= j; k++) for (let l = -j; l <= j; l++) {
      const corner = thick && Math.abs(k) === j && Math.abs(l) === j;
      for (let n = 0; n < i; n++) {
        if (!canRepl(x + k, y + n, z + l, true)) continue;
        if (corner) { if (!(r.nextFloat() < 0.1)) continue; }
        R.setState(x + k, y + n, z + l, stem);
      }
    }
    const wart = hat[0] === BID.nether_wart_block;
    const vines = (px, py, pz) => {
      if (!R.isAir(px, py - 1, pz)) return;
      let n = mthNext(r, 1, 5);
      if (r.nextInt(7) === 0) n *= 2;
      weepingColumn(R, r, px, py - 1, pz, n, 23, 25, -1, BID.weeping_vines, BID.weeping_vines_plant);
    };
    const hatBlock = (px, py, pz, f, g, h) => {
      if (r.nextFloat() < f) R.setState(px, py, pz, decor);
      else if (r.nextFloat() < g) { R.setState(px, py, pz, hat); if (r.nextFloat() < h) vines(px, py, pz); }
    };
    const jj = Math.min(r.nextInt(1 + (i / 3 | 0)) + 5, i), k0 = i - jj;
    for (let l = k0; l <= i; l++) {
      let n = l < i - r.nextInt(3) ? 2 : 1;
      if (jj > 8 && l < k0 + 4) n = 3;
      if (thick) n++;
      for (let o = -n; o <= n; o++) for (let p = -n; p <= n; p++) {
        const ex = o === -n || o === n, ez = p === -n || p === n, inner = !ex && !ez && l !== i, corner = ex && ez, low = l < k0 + 3;
        const px = x + o, py = y + l, pz = z + p;
        if (!canRepl(px, py, pz, false)) continue;
        if (low) {
          if (inner) continue;
          if (R.id(px, py - 1, pz) === hat[0]) R.setState(px, py, pz, hat);
          else if (r.nextFloat() < 0.15) { R.setState(px, py, pz, hat); if (wart && r.nextInt(11) === 0) vines(px, py, pz); }
          continue;
        }
        if (inner) { hatBlock(px, py, pz, 0.1, 0.2, wart ? 0.1 : 0); continue; }
        if (corner) { hatBlock(px, py, pz, 0.01, 0.7, wart ? 0.083 : 0); continue; }
        hatBlock(px, py, pz, 5.0E-4, 0.98, wart ? 0.07 : 0);
      }
    }
    return true;
  };
  const DELTA_NO = () => new Set(['bedrock', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_wart', 'chest', 'spawner'].map(k => BID[k]));
  FEATURE.delta_feature = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, contents = stateOf(c.contents), rim = stateOf(c.rim), size = intProvider(c.size), rimSize = intProvider(c.rim_size);
    const no = once(cfg, 'n', DELTA_NO);
    const clear = (px, py, pz) => {
      const id = R.id(px, py, pz);
      if (id === contents[0] || no.has(id)) return false;
      for (const d of DIR6B) { const air = R.isAir(px + d[0], py + d[1], pz + d[2]), up = d[1] === 1; if ((air && !up) || (!air && up)) return false; }
      return true;
    };
    const hasRim = r.nextDouble() < 0.9;
    const i = hasRim ? rimSize(r) : 0, j = hasRim ? rimSize(r) : 0, both = hasRim && i !== 0 && j !== 0;
    const k = size(r), l = size(r), m = Math.max(k, l);
    const pts = [];
    for (let dx = -k; dx <= k; dx++) for (let dz = -l; dz <= l; dz++) pts.push([dx, dz, Math.abs(dx) + Math.abs(dz)]);
    pts.sort((a, b) => a[2] - b[2]);
    let any = false;
    for (const [dx, dz, d] of pts) {
      if (d > m) break;
      const px = x + dx, pz = z + dz;
      if (!clear(px, y, pz)) continue;
      if (both) { any = true; R.setState(px, y, pz, rim); }
      if (!clear(px + i, y, pz + j)) continue;
      any = true; R.setState(px + i, y, pz + j, contents);
    }
    return any;
  };
  FEATURE.basalt_pillar = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, B = BID.basalt;
    if (!R.isAir(x, y, z) || R.isAir(x, y + 1, z)) return false;
    let py = y, n = true, s = true, w = true, e = true;
    const hang = (px, ppy, pz) => { if (r.nextInt(10) !== 0) { R.set(px, ppy, pz, B); return true; } return false; };
    while (R.isAir(x, py, z)) {
      if (py < R.minY || py >= R.maxY) return true;
      R.set(x, py, z, B);
      n = n && hang(x, py, z - 1); s = s && hang(x, py, z + 1); w = w && hang(x - 1, py, z); e = e && hang(x + 1, py, z);
      py--;
    }
    py++;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (r.nextBoolean()) R.set(x + dx, py, z + dz, B);
    py--;
    for (let i = -3; i < 4; i++) for (let j = -3; j < 4; j++) {
      const k = Math.abs(i) * Math.abs(j);
      if (r.nextInt(10) >= 10 - k) continue;
      let qy = py, l = 3;
      while (R.isAir(x + i, qy - 1, z + j)) { qy--; if (--l > 0) continue; break; }
      if (R.isAir(x + i, qy - 1, z + j)) continue;
      R.set(x + i, qy, z + j, B);
    }
    return true;
  };
  const COLUMN_NO = () => new Set(['lava', 'bedrock', 'magma_block', 'soul_sand', 'nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_wart', 'chest', 'spawner'].map(k => k === 'lava' ? LAVA : BID[k]));
  FEATURE.basalt_columns = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, sea = 32, B = BID.basalt, no = once(cfg, 'n', COLUMN_NO);
    const height = intProvider(c.height), reach = intProvider(c.reach);
    const airOrLava = (px, py, pz) => { const id = R.id(px, py, pz); return id === 0 || (id === LAVA && py <= sea); };
    const canPlaceAt = (px, py, pz) => { if (!airOrLava(px, py, pz)) return false; const b = R.id(px, py - 1, pz); return b !== 0 && !no.has(b); };
    if (!canPlaceAt(x, y, z)) return false;
    const j = height(r), small = r.nextFloat() < 0.9, k = Math.min(j, small ? 5 : 8), l = small ? 50 : 15;
    let any = false;
    for (let t = 0; t < l; t++) {
      const px = x - k + r.nextInt(2 * k + 1), py = y + r.nextInt(1), pz = z - k + r.nextInt(2 * k + 1);
      const m = j - (Math.abs(px - x) + Math.abs(py - y) + Math.abs(pz - z));
      if (m < 0) continue;
      const rr = reach(r);
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        const qx = px + dx, qz = pz + dz, d = Math.abs(dx) + Math.abs(dz);
        let qy = py, found = null;
        if (airOrLava(qx, qy, qz)) { let n = d; while (qy > R.minY + 1 && n > 0) { n--; if (canPlaceAt(qx, qy, qz)) { found = qy; break; } qy--; } }
        else { let n = d; while (qy <= R.maxY && n > 0) { n--; const id = R.id(qx, qy, qz); if (no.has(id)) break; if (id === 0) { found = qy; break; } qy++; } }
        if (found === null) continue;
        let h = m - (d >> 1), cy = found;
        while (h >= 0) {
          if (airOrLava(qx, cy, qz)) { R.set(qx, cy, qz, B); cy++; any = true; }
          else { if (R.id(qx, cy, qz) !== B) break; cy++; }
          h--;
        }
      }
    }
    return any;
  };

  // ---- decoration of one chunk ---------------------------------------------------------------------------------------
  let ORDER = null, BIOME_FEATS = null;
  const ORDERS = {};
  function buildOrder(dim = 'overworld') {
    if (ORDERS[dim]) { ORDER = ORDERS[dim].order; BIOME_FEATS = ORDERS[dim].feats; return; }
    if (!LEAVES) initTags();
    // (WATERLOGGED is filled by initTags from the WLOG table)
    // possible biomes in parameter-list order, as MultiNoiseBiomeSource.possibleBiomes()
    const biomes = [];
    for (const [, b] of (dim === 'nether' ? WG.netherParameters() : WG.overworldParameters())) if (!biomes.includes(b)) biomes.push(b);
    BIOME_FEATS = {};
    // FeatureSorter.buildFeaturesPerStep: a DFS topological order of (step, feature) nodes
    const ids = new Map(); let nextId = 0, steps = 0;
    const nodes = new Map(), edges = new Map();
    const node = (f, step) => { let i = ids.get(f); if (i === undefined) { i = nextId++; ids.set(f, i); } const k = step * 100000 + i; if (!nodes.has(k)) nodes.set(k, { k, f, step, i }); return nodes.get(k); };
    for (const b of biomes) {
      const L = (D.biome[b] && D.biome[b].features) || [], list = [];
      steps = Math.max(steps, L.length);
      BIOME_FEATS[b] = new Set();
      L.forEach((step, j) => { for (const f of [].concat(step)) { const n = strip(f); BIOME_FEATS[b].add(n); list.push(node(n, j)); } });
      for (let j = 0; j < list.length; j++) {
        if (!edges.has(list[j].k)) edges.set(list[j].k, new Set());
        if (j < list.length - 1) edges.get(list[j].k).add(list[j + 1].k);
      }
    }
    const sorted = [...edges.keys()].sort((a, b) => a - b);
    const visited = new Set(), inProg = new Set(), out = [];
    const dfs = (k) => {
      if (visited.has(k)) return false;
      if (inProg.has(k)) return true;
      inProg.add(k);
      for (const t of [...(edges.get(k) || [])].sort((a, b) => a - b)) if (dfs(t)) return true;
      inProg.delete(k); visited.add(k); out.push(nodes.get(k));
      return false;
    };
    for (const k of sorted) { if (visited.has(k)) continue; dfs(k); }
    out.reverse();
    ORDER = [];
    for (let s = 0; s < steps; s++) ORDER.push(out.filter(n => n.step === s).map(n => n.f));
    ORDERS[dim] = { order: ORDER, feats: BIOME_FEATS };
  }
  function decorate(game, world, ch) {
    buildOrder(world.dim === 'nether' ? 'nether' : 'overworld');
    DIM.minY = world.minY || 0; DIM.height = world.dim === 'nether' ? 128 : HEIGHT;
    const R = new Region(world, ch.cx, ch.cz);
    const seedStr = world.seedStr || '0';
    if (!game._zoom || game._zoomSeed !== seedStr) { game._zoom = new WG.BiomeZoom(BigInt(seedStr)); game._zoomSeed = seedStr; }
    const zoom = game._zoom;
    const order = self.WG_DATA.biome_order, zp = [0, 0, 0];
    const quartBiome = (qx, qy, qz) => {
      const c = R.chunk(qx << 2, qz << 2) || ch, QY = HEIGHT >> 2;
      qy = clamp(qy - (R.minY >> 2), 0, QY - 1);
      return order[c.qb[(qy * 4 + (qz & 3)) * 4 + (qx & 3)]];
    };
    const ctx = {
      R, top: null, seed: seedStr,
      biomeAt: (x, y, z) => { zoom.pick(x, y, z, zp); return quartBiome(zp[0], zp[1], zp[2]); },
      biomeHas: (p, top) => { const b = ctx.biomeAt(p[0], p[1], p[2]); return !!top && !!BIOME_FEATS[b] && BIOME_FEATS[b].has(top); },
    };
    // biomes of the 3x3 chunks (all sections), like vanilla
    const present = new Set();
    for (const c of R.ch) if (c && c.qb) for (const v of c.qb) present.add(order[v]);
    const rand = new WRand(), x0 = ch.cx * 16, z0 = ch.cz * 16;
    const decoSeed = rand.decorationSeed(BigInt(seedStr), x0, z0);
    for (let step = 0; step < ORDER.length; step++) {
      const list = ORDER[step];
      // structure pieces that are features (village decorations, ...) go in surface_structures
      if (step === 4 && ch.sx && game.structureFeatures) {
        rand.setSeed(decoSeed + BigInt(10000 * step) + 9999n);
        try { game.structureFeatures(ch, ctx, rand, placePF); } catch (e) { console.warn('structure feature', e); }
      }
      for (let idx = 0; idx < list.length; idx++) {
        const f = list[idx];
        let used = false;
        for (const b of present) if (BIOME_FEATS[b] && BIOME_FEATS[b].has(f)) { used = true; break; }
        if (!used) continue;
        rand.setSeed(decoSeed + BigInt(idx) + BigInt(10000 * step));
        try { placePF(ctx, f, rand, [x0, MIN_Y, z0], f); } catch (e) { if (!decorate.warned) { decorate.warned = true; console.warn('feature', f, e); } }
      }
    }
  }
  const api = { decorate, WRand, Region, stateOf, provider, predicate, intProvider, placePF, placeCF: (ctx, cf, r, p) => { if (!LEAVES) initTags(); return placeCF(ctx, cf, r, p); }, FEATURE, canSurvive, tagSet, withProp, msin, mcos, propOf };
  api.helpers = () => ({ LEAVES, LOGS, DIRT, REPLACE_TREES, DIR6, once });
  return api;
})();
