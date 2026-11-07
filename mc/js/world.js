'use strict';
// ---------------------------------------------------------------------------
// World: chunk storage, generation, lighting, fluids, block updates
// ---------------------------------------------------------------------------
const OPACITY = new Uint8Array(MAX_BLOCKS), EMIT = new Uint8Array(MAX_BLOCKS), SOLIDCUBE = new Uint8Array(MAX_BLOCKS);
const IS_FLUID = new Uint8Array(MAX_BLOCKS), REPLACEABLE = new Uint8Array(MAX_BLOCKS);
// AO occluders: like vanilla, every full-collision cube darkens corners (opaque ones, but also leaves and glass)
const AOCUBE = new Uint8Array(MAX_BLOCKS), WLOG = new Uint8Array(MAX_BLOCKS);
const TORCHLIKE = new Uint8Array(MAX_BLOCKS); // the torches, standing and on walls (soul, redstone, copper too)
// the four ways a fluid spreads, in vanilla's order (north, east, south, west: k ^ 2 is the way back)
const FLUID_HDIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const FLUID_HDIR_D = [4, 1, 5, 0]; // the same as DIRS indices
for (let i = 0; i < MAX_BLOCKS; i++) {
  const b = BLOCKS[i]; if (!b) { OPACITY[i] = 15; continue; }
  OPACITY[i] = b.opacity; EMIT[i] = b.light; SOLIDCUBE[i] = b.opaque ? 1 : 0;
  AOCUBE[i] = b.opaque || (b.shape === SH_CUBE && b.solid && b.render !== 'translucent') ? 1 : 0;
  IS_FLUID[i] = b.shape === SH_LIQUID ? 1 : 0; REPLACEABLE[i] = b.replaceable ? 1 : 0; WLOG[i] = b.waterlogged ? 1 : 0;
  TORCHLIKE[i] = /(^|_)torch$/.test(b.key || '') && !b.solid ? 1 : 0;
}
// blocks whose light depends on their state (lit campfires, candles, lamps, copper bulbs)
const STATE_EMIT = new Array(MAX_BLOCKS).fill(null);
for (let i = 0; i < MAX_BLOCKS; i++) if (BLOCKS[i] && BLOCKS[i].stateLight) STATE_EMIT[i] = BLOCKS[i].stateLight;
const emitOf = (id, meta) => { const s = STATE_EMIT[id]; return s ? (s[meta] | 0) : EMIT[id]; };
const AIR = 0, WATER = 7, LAVA = 8;

function ckey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

// ---- chunk storage ------------------------------------------------------------------------------------
// Like vanilla's paletted containers, a chunk only stores what it needs. Of a loaded overworld more than half
// the 16^3 sections are all air, meta is all zero in 9 sections of 10 and light is one value in 8 of 10, so
// per section:
//   blocks bs[s]: null (all air) or { p: palette Uint16Array(256), n: entries used, d: Uint8Array(4096) }
//                 (a section with more than 256 different blocks: n = -1, d holds ids, p is the identity)
//   meta   ms[s]: null (all 0) or Uint8Array(4096)
//   light  ls[s]: null (every cell is lu[s]) or Uint8Array(4096), sky << 4 | block
// About a fifth of the flat arrays' size (393 KB a chunk at 384 high). Cells keep the flat index
// i = y << 8 | z << 4 | x: section i >> 12, cell i & 4095. World generators still write flat arrays
// (beginFlat), packed when the chunk is done.
const SEC_IDENT = new Uint16Array(MAX_BLOCKS); for (let i = 0; i < MAX_BLOCKS; i++) SEC_IDENT[i] = i;
const SEC_LUT = new Int16Array(MAX_BLOCKS).fill(-1), PK_P = new Uint16Array(256), PK_D = new Uint8Array(4096);
const newBlockSec = () => ({ p: new Uint16Array(256), n: 1, d: new Uint8Array(4096) }); // all p[0] = air
function secIndex(s, id) {
  const p = s.p, n = s.n;
  for (let k = 0; k < n; k++) if (p[k] === id) return k;
  if (n < 256) { p[n] = id; s.n = n + 1; return n; }
  return -1;
}
// a full palette: drop the entries no cell uses any more, or switch the section to plain ids
function secMakeRoom(s) {
  const used = new Uint8Array(256), d = s.d, p = s.p;
  for (let j = 0; j < 4096; j++) used[d[j]] = 1;
  const remap = new Uint8Array(256), np = new Uint16Array(256);
  let n = 0;
  for (let k = 0; k < 256; k++) if (used[k]) { remap[k] = n; np[n++] = p[k]; }
  if (n < 256) { for (let j = 0; j < 4096; j++) d[j] = remap[d[j]]; s.p = np; s.n = n; return; }
  const ids = new Uint16Array(4096);
  for (let j = 0; j < 4096; j++) ids[j] = p[d[j]];
  s.d = ids; s.p = SEC_IDENT; s.n = -1;
}
let FLAT_B = null, FLAT_M = null, FLAT_L = null; // scratch flat arrays (saving, lighting)
function flatScratch() {
  if (!FLAT_B || FLAT_B.length !== 256 * HEIGHT) { FLAT_B = new Uint16Array(256 * HEIGHT); FLAT_M = new Uint8Array(256 * HEIGHT); FLAT_L = new Uint8Array(256 * HEIGHT); }
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.bs = new Array(SECTIONS).fill(null);
    this.ms = new Array(SECTIONS).fill(null);
    this.ls = new Array(SECTIONS).fill(null);
    this.lu = new Uint8Array(SECTIONS);
    this.blocks = null; this.meta = null; // flat arrays only while a generator fills the chunk
    this.grass = new Uint8Array(256 * 3);   // biome tint per column
    this.foliage = new Uint8Array(256 * 3);
    this.biome = new Uint8Array(256);
    this.dirty = 0;           // bitmask of sections needing remesh
    this.lit = false;
    this.modified = false;
    this.sectionCount = new Uint16Array(SECTIONS); // non-air block count per section
  }
  // a chunk built from flat block / meta arrays (made elsewhere, e.g. a worker)
  static from(cx, cz, blocks, meta) { const ch = new Chunk(cx, cz); ch.packFrom(blocks, meta); return ch; }
  // a chunk sent from a worker as sections (Chunk.prototype.wire)
  static fromWire(cx, cz, s) {
    const ch = new Chunk(cx, cz);
    for (const b of s.bs) if (b && b.n < 0) b.p = SEC_IDENT;
    ch.bs = s.bs; ch.ms = s.ms;
    if (s.ls) { ch.ls = s.ls; ch.lu = s.lu; ch.lit = true; }
    ch.recount();
    return ch;
  }
  // the sections for postMessage, and the buffers to transfer (the chunk can't be used afterwards)
  wire(light) {
    const tr = [], bs = this.bs.map(b => {
      if (!b) return null;
      tr.push(b.d.buffer);
      if (b.n < 0) return { p: null, n: -1, d: b.d };
      tr.push(b.p.buffer); return b;
    });
    for (const m of this.ms) if (m) tr.push(m.buffer);
    const o = { bs, ms: this.ms };
    if (light) { for (const l of this.ls) if (l) tr.push(l.buffer); o.ls = this.ls; o.lu = this.lu; tr.push(this.lu.buffer); }
    return [o, tr];
  }
  idx(x, y, z) { return (y << 8) | (z << 4) | x; }
  // ---- cell access (i = y << 8 | z << 4 | x) ----
  getB(i) { const s = this.bs[i >> 12]; return s === null ? 0 : s.p[s.d[i & 4095]]; }
  setB(i, id) {
    const si = i >> 12;
    let s = this.bs[si];
    if (s === null) { if (!id) return; s = this.bs[si] = newBlockSec(); }
    if (s.n < 0) { s.d[i & 4095] = id; return; }
    let k = secIndex(s, id);
    if (k < 0) { secMakeRoom(s); if (s.n < 0) { s.d[i & 4095] = id; return; } k = secIndex(s, id); }
    s.d[i & 4095] = k;
  }
  getM(i) { const s = this.ms[i >> 12]; return s === null ? 0 : s[i & 4095]; }
  setM(i, v) {
    let s = this.ms[i >> 12];
    if (s === null) { if (!v) return; s = this.ms[i >> 12] = new Uint8Array(4096); }
    s[i & 4095] = v;
  }
  getL(i) { const s = this.ls[i >> 12]; return s === null ? this.lu[i >> 12] : s[i & 4095]; }
  setL(i, v) {
    const si = i >> 12;
    let s = this.ls[si];
    if (s === null) {
      const u = this.lu[si];
      if (u === v) return;
      s = this.ls[si] = new Uint8Array(4096);
      if (u) s.fill(u);
    }
    s[i & 4095] = v;
  }
  // ---- flat arrays <-> sections ----
  beginFlat() { this.blocks = new Uint16Array(256 * HEIGHT); this.meta = new Uint8Array(256 * HEIGHT); return this; }
  pack() { const B = this.blocks, M = this.meta; this.blocks = this.meta = null; this.packFrom(B, M); }
  packFrom(B, M) {
    for (let s = 0; s < SECTIONS; s++) {
      const o = s << 12;
      let n = 0, cnt = 0;
      const p = PK_P, d = PK_D;
      for (let j = 0; j < 4096; j++) {
        const id = B[o + j];
        if (id) cnt++;
        let k = SEC_LUT[id];
        if (k < 0) {
          if (n === 256) { n = -1; break; }
          k = SEC_LUT[id] = n; p[n++] = id;
        }
        d[j] = k;
      }
      for (let k = 0; k < (n < 0 ? 256 : n); k++) SEC_LUT[p[k]] = -1;
      if (n < 0) { // more than 256 kinds: plain ids
        cnt = 0; for (let j = 0; j < 4096; j++) if (B[o + j]) cnt++;
        this.bs[s] = { p: SEC_IDENT, n: -1, d: B.slice(o, o + 4096) };
      } else this.bs[s] = cnt ? { p: p.slice(), n, d: d.slice() } : null;
      this.sectionCount[s] = cnt;
      let mz = true;
      if (M) for (let j = o; j < o + 4096; j++) if (M[j]) { mz = false; break; }
      this.ms[s] = mz ? null : new Uint8Array(M.subarray(o, o + 4096));
    }
  }
  // sections -> flat arrays (into the given ones, or scratch arrays that the next call reuses)
  flatBlocks(out) {
    out = out || (flatScratch(), FLAT_B);
    for (let s = 0; s < SECTIONS; s++) {
      const b = this.bs[s], o = s << 12;
      if (!b) { out.fill(0, o, o + 4096); continue; }
      const p = b.p, d = b.d;
      for (let j = 0; j < 4096; j++) out[o + j] = p[d[j]];
    }
    return out;
  }
  flatMeta(out) {
    out = out || (flatScratch(), FLAT_M);
    for (let s = 0; s < SECTIONS; s++) { const m = this.ms[s], o = s << 12; if (m) out.set(m, o); else out.fill(0, o, o + 4096); }
    return out;
  }
  // light computed into a flat array: sections that are one value keep no array
  packLight(L) {
    for (let s = 0; s < SECTIONS; s++) {
      const o = s << 12, v = L[o];
      let uni = true;
      for (let j = o + 1; j < o + 4096; j++) if (L[j] !== v) { uni = false; break; }
      if (uni) { this.ls[s] = null; this.lu[s] = v; } else this.ls[s] = L.slice(o, o + 4096);
    }
  }
  // drop light arrays that became one value again
  compactLight() {
    for (let s = 0; s < SECTIONS; s++) {
      const l = this.ls[s];
      if (!l) continue;
      const v = l[0];
      let uni = true;
      for (let j = 1; j < 4096; j++) if (l[j] !== v) { uni = false; break; }
      if (uni) { this.ls[s] = null; this.lu[s] = v; }
    }
  }
  // every cell holding one of the ids (palette check first: most sections hold none)
  findAll(ids, fn) {
    for (let s = 0; s < SECTIONS; s++) {
      const b = this.bs[s];
      if (!b) continue;
      if (b.n >= 0) { let any = false; for (let k = 0; k < b.n; k++) if (ids.includes(b.p[k])) { any = true; break; } if (!any) continue; }
      for (let j = 0; j < 4096; j++) { const id = b.p[b.d[j]]; if (ids.includes(id)) fn((s << 12) | j, id); }
    }
  }
  recount() {
    if (this.blocks) { // still flat (a generator's)
      this.sectionCount.fill(0);
      const b = this.blocks;
      for (let i = 0; i < b.length; i++) if (b[i]) this.sectionCount[i >> 12]++;
      return;
    }
    for (let s = 0; s < SECTIONS; s++) {
      const b = this.bs[s];
      let c = 0;
      if (b) { const p = b.p, d = b.d; for (let j = 0; j < 4096; j++) if (p[d[j]]) c++; }
      if (!c) this.bs[s] = null;
      this.sectionCount[s] = c;
    }
  }
}

// ---- a chunk's own light, worked out on flat scratch arrays (the borders come later: World.exchangeLight) ----
// Runs in the chunk worker for streamed chunks; the page only does it for chunks made there.
const LIGHT_H = new Int16Array(256);
function lightChunk(ch, hasSky) {
  flatScratch();
  const B = ch.blocks || ch.flatBlocks(), M = ch.meta, L = FLAT_L, heights = LIGHT_H, q = [];
  L.fill(0);
  if (hasSky) {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let l = 15, top = 0;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const i = (y << 8) | (z << 4) | x, op = OPACITY[B[i]];
        if (op >= 15) l = 0; else if (op > 0 || l < 15) l = Math.max(0, l - Math.max(1, op));
        if (l === 15) top = y;
        L[i] = l << 4;
        if (l === 0) break;
      }
      heights[z * 16 + x] = top;
    }
    // horizontal sky seeds: the open sides of columns next to lower ones
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = heights[z * 16 + x];
      let mx = h;
      if (x > 0) mx = Math.max(mx, heights[z * 16 + x - 1]); if (x < 15) mx = Math.max(mx, heights[z * 16 + x + 1]);
      if (z > 0) mx = Math.max(mx, heights[z * 16 + x - 16]); if (z < 15) mx = Math.max(mx, heights[z * 16 + x + 16]);
      for (let y = h; y <= mx && y < HEIGHT; y++) { const i = (y << 8) | (z << 4) | x; if ((L[i] >> 4) > 1) q.push(i); }
    }
    propagateFlat(B, L, q, 4);
    q.length = 0;
  }
  // block light: only sections whose palette holds a light source
  for (let s = 0; s < SECTIONS; s++) {
    if (!ch.blocks) {
      const b = ch.bs[s];
      if (!b) continue;
      if (b.n >= 0) { let any = false; for (let k = 0; k < b.n; k++) if (EMIT[b.p[k]]) { any = true; break; } if (!any) continue; }
    }
    for (let i = s << 12, e0 = i + 4096; i < e0; i++) {
      const id = B[i];
      if (!EMIT[id]) continue;
      const e = emitOf(id, M ? M[i] : ch.getM(i));
      if (e) { L[i] = (L[i] & 0xF0) | e; q.push(i); }
    }
  }
  propagateFlat(B, L, q, 0);
  ch.packLight(L);
  ch.lit = true;
}
// BFS inside one chunk, q holds flat indices (World.propagate is the world-wide one)
function propagateFlat(B, L, q, shift) {
  const sky = shift === 4, top = HEIGHT - 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], l = (L[i] >> shift) & 15;
    if (l <= 1) continue;
    const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
    for (let d = 0; d < 6; d++) {
      let n;
      switch (d) {
        case 0: if (x === 0) continue; n = i - 1; break;
        case 1: if (x === 15) continue; n = i + 1; break;
        case 2: if (y === 0) continue; n = i - 256; break;
        case 3: if (y === top) continue; n = i + 256; break;
        case 4: if (z === 0) continue; n = i - 16; break;
        default: if (z === 15) continue; n = i + 16;
      }
      const op = OPACITY[B[n]];
      if (op >= 15) continue;
      const nl = (sky && d === 2 && l === 15 && op === 0) ? 15 : l - (op > 1 ? op : 1);
      const c = L[n];
      if (nl > ((c >> shift) & 15)) { L[n] = sky ? ((c & 0x0F) | (nl << 4)) : ((c & 0xF0) | nl); q.push(n); }
    }
  }
}

const BIOMES = ['海洋', '沙滩', '平原', '森林', '桦木森林', '针叶林', '雪原', '沙漠', '山地', '河流', '雪山', '冻洋', '下界荒地', '末地'];
// vanilla temperatures of the matching biomes (sky colour, etc.)
// vanilla water colours by biome (default #3F76E4; frozen ocean #3938C9)
const BIOME_WATER_DEFAULT = [63, 118, 228];
const BIOME_WATER = [];
BIOME_WATER[11] = [57, 56, 201];
const BIOME_TEMP = [0.5, 0.8, 0.8, 0.7, 0.6, 0.25, 0.0, 2.0, 0.2, 0.5, -0.7, 0.0, 2.0, 0.5];
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}
const BI = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, TAIGA: 5, SNOWY: 6, DESERT: 7, MOUNTAIN: 8, RIVER: 9, SNOWPEAK: 10, FROZEN_OCEAN: 11, NETHER: 12, END: 13 };

// Collects structure blocks into per-chunk buckets so each chunk can apply its own part
class StructBuilder {
  constructor() { this.buckets = new Map(); }
  set(x, y, z, id, meta = 0) {
    if (y < 0 || y >= HEIGHT) return;
    const k = ckey(x >> 4, z >> 4);
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, b = []);
    b.push((y << 8) | ((z & 15) << 4) | (x & 15), id, meta);
  }
  fill(x0, y0, z0, x1, y1, z1, id, meta = 0) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, typeof id === 'function' ? id(x, y, z) : id, meta);
  }
  box(x0, y0, z0, x1, y1, z1, wall, inner = AIR) { // hollow box: walls/floor/ceiling + carved interior
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
      if (edge) { const w = typeof wall === 'function' ? wall(x, y, z) : wall; if (w !== null) this.set(x, y, z, w); } else this.set(x, y, z, inner);
    }
  }
  apply(ch) {
    const b = this.buckets.get(ckey(ch.cx, ch.cz));
    if (!b) return false;
    if (ch.blocks) for (let i = 0; i < b.length; i += 3) { ch.blocks[b[i]] = b[i + 1]; ch.meta[b[i]] = b[i + 2]; }
    else for (let i = 0; i < b.length; i += 3) { ch.setB(b[i], b[i + 1]); ch.setM(b[i], b[i + 2]); }
    return true;
  }
}

class World {
  constructor(seed, dim = 'overworld') {
    this.seed = seed | 0;
    this.dim = dim; this.hasSky = dim === 'overworld';
    this.structCache = new Map();
    this.nNether = new Noise(seed + 101); this.nNether2 = new Noise(seed + 102); this.nEnd = new Noise(seed + 201);
    if (dim === 'end') this.initEnd();
    this.chunks = new Map();
    this.nCont = new Noise(seed);
    this.nErosion = new Noise(seed + 1);
    this.nPeaks = new Noise(seed + 2);
    this.nHills = new Noise(seed + 3);
    this.nTemp = new Noise(seed + 4);
    this.nHumid = new Noise(seed + 5);
    this.nCave1 = new Noise(seed + 6);
    this.nCave2 = new Noise(seed + 7);
    this.nCave3 = new Noise(seed + 8);
    this.nRiver = new Noise(seed + 9);
    this.nSurf = new Noise(seed + 10);
    this.listener = null;     // game hooks
    this.ticks = new Map();   // scheduled block ticks: key -> {x,y,z,t}
    this.time = 0;            // game tick counter
    this.savedChunks = null;  // map key -> saved data, filled by save system
    this.lightQ = [];
    this.grassMap = null; this.foliageMap = null;
  }

  // ---- access -------------------------------------------------------------
  getChunk(cx, cz) { return this.chunks.get(ckey(cx, cz)); }
  getBlock(x, y, z) {
    if (y < 0) return this.dim === 'end' ? 0 : 6; if (y >= HEIGHT) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c ? c.getB((y << 8) | ((z & 15) << 4) | (x & 15)) : 0;
  }
  getMeta(x, y, z) {
    if (y < 0 || y >= HEIGHT) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c ? c.getM((y << 8) | ((z & 15) << 4) | (x & 15)) : 0;
  }
  // waterlogged blocks (vanilla's waterlogged=true: a stair, slab, fence ... with water in its cell): a set of block
  // indices per chunk (chunk.wl), saved with it; the block keeps its own id and meta
  isWaterlogged(x, y, z) {
    if (y < 0 || y >= HEIGHT) return false;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return !!(c && c.wl && c.wl.has((y << 8) | ((z & 15) << 4) | (x & 15)));
  }
  setWaterlogged(x, y, z, v) {
    if (y < 0 || y >= HEIGHT) return;
    const c = this.chunks.get(ckey(x >> 4, z >> 4)); if (!c) return;
    const i = (y << 8) | ((z & 15) << 4) | (x & 15);
    if (!!(c.wl && c.wl.has(i)) === !!v) return;
    if (v) (c.wl || (c.wl = new Set())).add(i); else c.wl.delete(i);
    c.modified = true;
    this.markBlock(c, x & 15, y, z & 15);
    this.notify(x, y, z, -1);
    for (let d = 0; d < 6; d++) this.notify(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2], -1);
  }
  // water in this cell: a water block, one that always holds water (seagrass, kelp ...) or a waterlogged one
  waterAt(x, y, z) {
    const id = this.getBlock(x, y, z);
    return id === WATER || !!WLOG[id] || (id !== 0 && this.isWaterlogged(x, y, z));
  }
  // how much of a fluid a cell holds (vanilla FluidState.getAmount: 8 for a source or a falling one, else 8 less its
  // level; waterlogged and always-wet blocks hold a water source); 0 none, -1 the other fluid
  fluidAmount(id, x, y, z) {
    const b = this.getBlock(x, y, z);
    if (b === id) { const m = this.getMeta(x, y, z); return m === 0 || (m & 8) ? 8 : 8 - (m & 7); }
    const wet = b !== 0 && (WLOG[b] || this.isWaterlogged(x, y, z));
    if (wet) return id === WATER ? 8 : -1;
    return IS_FLUID[b] ? -1 : 0;
  }
  // the way a fluid flows in a cell, normalised (FlowingFluid.getFlow): toward the lower sides - an empty side
  // counts by the fluid below it - and, for a falling one against a wall, mostly down
  fluidFlow(id, x, y, z) {
    const own = this.fluidAmount(id, x, y, z) / 9;
    let dx = 0, dz = 0;
    for (const [ox, oz] of FLUID_HDIRS) {
      const a = this.fluidAmount(id, x + ox, y, z + oz);
      if (a < 0) continue;
      let f1 = 0;
      if (a === 0) {
        if (!BLOCKS[this.getBlock(x + ox, y, z + oz)].solid) { const ab = this.fluidAmount(id, x + ox, y - 1, z + oz); if (ab > 0) f1 = own - (ab / 9 - 0.8888889); }
      } else f1 = own - a / 9;
      dx += ox * f1; dz += oz * f1;
    }
    let v = [dx, 0, dz];
    if (this.getBlock(x, y, z) === id && (this.getMeta(x, y, z) & 8)) {
      for (const [ox, oz] of FLUID_HDIRS) {
        if (!SOLIDCUBE[this.getBlock(x + ox, y, z + oz)] && !SOLIDCUBE[this.getBlock(x + ox, y + 1, z + oz)]) continue;
        const l = Math.hypot(dx, dz); v = l > 0 ? [dx / l, -6, dz / l] : [0, -6, 0]; break;
      }
    }
    const L = Math.hypot(v[0], v[1], v[2]);
    return L > 0 ? [v[0] / L, v[1] / L, v[2] / L] : v;
  }
  // which of the 4 x 4 samples of a cell's face toward DIRS[d] its block's collision shape covers (0xffff: all)
  faceMask(x, y, z, d) {
    const id = this.getBlock(x, y, z), b = BLOCKS[id];
    if (!b || !b.solid || IS_FLUID[id]) return 0;
    if (b.shape === SH_CUBE) return 0xffff;
    if (b.shape !== SH_BOXES && b.shape !== SH_MODEL) return 0;
    const a = d >> 1, u = (a + 1) % 3, v = (a + 2) % 3;
    let m = 0;
    for (const bx of b.boxes(this.getMeta(x, y, z)) || []) {
      if ((d & 1) ? bx[a + 3] < 16 : bx[a] > 0) continue;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const su = i * 4 + 2, sv = j * 4 + 2;
        if (bx[u] <= su && su < bx[u + 3] && bx[v] <= sv && sv < bx[v + 3]) m |= 1 << (i * 4 + j);
      }
    }
    return m;
  }
  // FlowingFluid.canPassThroughWall: fluid gets from a cell to its neighbour toward DIRS[d] unless the two blocks'
  // shapes together close the face between them (a waterlogged bottom slab keeps its water from going down)
  fluidPass(x, y, z, d) { return (this.faceMask(x, y, z, d) | this.faceMask(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2], d ^ 1)) !== 0xffff; }
  fenceMeta(x, y, z, b) {
    return connBits(b, (dx, dz) => this.getBlock(x + dx, y, z + dz));
  }
  isLoaded(x, z) { return this.chunks.has(ckey(x >> 4, z >> 4)); }
  getLight(x, y, z) {
    if (y >= HEIGHT) return 0xF0; if (y < 0) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c ? c.getL((y << 8) | ((z & 15) << 4) | (x & 15)) : (this.hasSky ? 0xF0 : 0);
  }
  skyAt(x, y, z) { return this.getLight(x, y, z) >> 4; }
  blockLightAt(x, y, z) { return this.getLight(x, y, z) & 15; }
  surfaceY(x, z) {
    // from the top section down, skipping the empty ones: while it rains this runs for 441 columns a frame (rain
    // or snow, isCold), and going block by block from the build limit cost several ms a frame
    const c = this.chunks.get(ckey(x >> 4, z >> 4)); if (!c) return 0;
    const col = ((z & 15) << 4) | (x & 15);
    for (let s = SECTIONS - 1; s >= 0; s--) {
      if (c.bs[s] === null) continue;
      for (let y = Math.min(HEIGHT - 1, s * 16 + 15); y >= s * 16 && y > 0; y--) { const b = c.getB((y << 8) | col); if (b && BLOCKS[b].solid) return y; }
    }
    return 0;
  }

  // ---- terrain functions -----------------------------------------------------
  column(x, z) {
    const cont = this.nCont.fbm2(x / 900, z / 900, 4) * 1.4;
    const ero = this.nErosion.fbm2(x / 500, z / 500, 3);
    const pk = 1 - Math.abs(this.nPeaks.fbm2(x / 280, z / 280, 4));
    const hills = this.nHills.fbm2(x / 140, z / 140, 4);
    const det = this.nHills.n2(x / 32 + 100, z / 32);
    // continentalness spline
    let h;
    if (cont < -0.45) h = lerp(30, 40, (cont + 1) / 0.55);
    else if (cont < -0.18) h = lerp(40, 55, (cont + 0.45) / 0.27);
    else if (cont < -0.06) h = lerp(55, 62, (cont + 0.18) / 0.12);
    else if (cont < 0.05) h = lerp(62, 66, (cont + 0.06) / 0.11);
    else h = lerp(66, 78, clamp((cont - 0.05) / 0.6, 0, 1));
    const land = smoothstep(-0.1, 0.1, cont);
    const mount = smoothstep(0.02, 0.45, cont) * smoothstep(0.05, -0.35, ero);
    h += mount * pk * pk * 95;
    h += hills * (5 + 10 * land) * (0.6 + mount) + det * 2;
    // rivers
    const rv = Math.abs(this.nRiver.fbm2(x / 420, z / 420, 3));
    let river = 0;
    if (cont > -0.12) {
      river = 1 - smoothstep(0.0, 0.045, rv);
      const target = 57;
      if (river > 0 && h > target) h = lerp(h, target, river * (h > 100 ? 0.5 : 1));
    }
    const temp = this.nTemp.fbm2(x / 1100, z / 1100, 3) * 1.6 + this.nSurf.n2(x / 40, z / 40) * 0.03;
    const humid = this.nHumid.fbm2(x / 900, z / 900, 3) * 1.6;
    return { h: Math.floor(h), temp, humid, river, cont, mount };
  }
  biomeOf(col) {
    const h = col.h, t = col.temp, hu = col.humid;
    if (h < SEA - 3) return (col.river > 0.5 && col.cont > -0.12) ? BI.RIVER : (t < -0.5 ? BI.FROZEN_OCEAN : BI.OCEAN);
    if (h <= SEA + 1 && col.river > 0.3) return BI.RIVER;
    if (h <= SEA + 2 && col.cont < 0.02) return t > 0.35 && hu < 0.1 ? BI.DESERT : BI.BEACH;
    if (h > 118) return BI.SNOWPEAK;
    if (h > 98 && col.mount > 0.3) return BI.MOUNTAIN;
    if (t > 0.35 && hu < 0.1) return BI.DESERT;
    if (t < -0.42) return BI.SNOWY;
    if (t < -0.15) return BI.TAIGA;
    if (hu > 0.38 && t > -0.05) return BI.BIRCH;
    if (hu > 0.08) return BI.FOREST;
    return BI.PLAINS;
  }
  tintFor(map, temp, humid, out, o) {
    const T = clamp(0.62 + temp * 0.45, 0, 1), H = clamp(0.5 + humid * 0.5, 0, 1) * T;
    const px = Math.floor((1 - T) * 255), py = Math.floor((1 - H) * 255);
    const i = (py * 256 + px) * 4;
    out[o] = map[i]; out[o + 1] = map[i + 1]; out[o + 2] = map[i + 2];
  }

  // ---- generation ------------------------------------------------------------
  generateFlat(cx, cz) {
    const ch = new Chunk(cx, cz).beginFlat();
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      for (let y = 0; y <= 60; y++) ch.blocks[(y << 8) | (z << 4) | x] = y === 0 ? 6 : y < 57 ? 1 : y < 60 ? 3 : 2;
      ch.biome[z * 16 + x] = BI.PLAINS;
      this.tintFor(this.grassMap, 0.3, 0.2, ch.grass, (z * 16 + x) * 3);
      this.tintFor(this.foliageMap, 0.3, 0.2, ch.foliage, (z * 16 + x) * 3);
    }
    ch.recount();
    return ch;
  }
  generate(cx, cz) {
    let ch;
    if (this.dim === 'nether') ch = this.generateNether(cx, cz);
    else if (this.dim === 'end') ch = this.generateEnd(cx, cz);
    else if (this.flat) ch = this.generateFlat(cx, cz);
    else ch = this.generateOverworld(cx, cz);
    for (const sb of this.structuresFor(cx, cz)) sb.apply(ch);
    ch.pack();
    return ch;
  }
  generateOverworld(cx, cz) {
    const ch = new Chunk(cx, cz).beginFlat();
    const B = ch.blocks, M = ch.meta;
    const x0 = cx * 16, z0 = cz * 16;
    const seed = this.seed;
    // columns incl. 1-block border for slope
    const cols = new Array(18 * 18);
    for (let z = -1; z < 17; z++) for (let x = -1; x < 17; x++) cols[(z + 1) * 18 + x + 1] = this.column(x0 + x, z0 + z);
    let maxH = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const c = cols[(z + 1) * 18 + x + 1];
      maxH = Math.max(maxH, c.h);
      const bi = this.biomeOf(c);
      ch.biome[z * 16 + x] = bi;
      this.tintFor(this.grassMap, c.temp, c.humid, ch.grass, (z * 16 + x) * 3);
      this.tintFor(this.foliageMap, c.temp, c.humid, ch.foliage, (z * 16 + x) * 3);
    }
    // cave noise on a coarse grid (4x8x4) then trilinear interpolation
    const gy = Math.min(HEIGHT, maxH + 9) >> 3;
    const GX = 5, GY = gy + 1, GZ = 5;
    const g1 = new Float32Array(GX * GY * GZ), g2 = new Float32Array(GX * GY * GZ), g3 = new Float32Array(GX * GY * GZ);
    for (let ix = 0; ix < GX; ix++) for (let iz = 0; iz < GZ; iz++) for (let iy = 0; iy < GY; iy++) {
      const wx = x0 + ix * 4, wy = iy * 8, wz = z0 + iz * 4;
      const i = (ix * GZ + iz) * GY + iy;
      g1[i] = this.nCave1.n3(wx / 48, wy / 32, wz / 48);
      g2[i] = this.nCave2.n3(wx / 48, wy / 32, wz / 48);
      g3[i] = this.nCave3.n3(wx / 90, wy / 40, wz / 90);
    }
    const sample = (g, x, y, z) => {
      const fx = x / 4, fy = y / 8, fz = z / 4;
      const ix = Math.min(fx | 0, GX - 2), iy = Math.min(fy | 0, GY - 2), iz = Math.min(fz | 0, GZ - 2);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i000 = (ix * GZ + iz) * GY + iy, i100 = ((ix + 1) * GZ + iz) * GY + iy;
      const i010 = i000 + 1, i110 = i100 + 1, i001 = i000 + GY, i101 = i100 + GY, i011 = i001 + 1, i111 = i101 + 1;
      const a = lerp(lerp(g[i000], g[i100], tx), lerp(g[i001], g[i101], tx), tz);
      const b = lerp(lerp(g[i010], g[i110], tx), lerp(g[i011], g[i111], tx), tz);
      return lerp(a, b, ty);
    };
    const rng = RNG(hashStr(seed + ':' + cx + ':' + cz));
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const ci = (z + 1) * 18 + x + 1, c = cols[ci];
      const h = c.h, bi = ch.biome[z * 16 + x];
      const slope = Math.max(Math.abs(cols[ci - 1].h - cols[ci + 1].h), Math.abs(cols[ci - 18].h - cols[ci + 18].h));
      const wx = x0 + x, wz = z0 + z;
      let top, filler, fillDepth = 3 + ((hash3(wx, 0, wz, seed) * 2) | 0);
      if (bi === BI.DESERT) { top = 9; filler = 9; fillDepth = 4; }
      else if (bi === BI.BEACH) { top = 9; filler = 9; }
      else if (bi === BI.OCEAN || bi === BI.FROZEN_OCEAN || bi === BI.RIVER) {
        const n = this.nSurf.n2(wx / 12, wz / 12);
        top = h < SEA - 1 ? (n > 0.35 ? 10 : (n < -0.5 ? 36 : 9)) : 9; filler = top === 36 ? 36 : 9;
        if (bi === BI.RIVER && h >= SEA - 1) { top = 9; }
      }
      else if (bi === BI.MOUNTAIN || bi === BI.SNOWPEAK) { top = slope > 3 ? 1 : 2; filler = slope > 3 ? 1 : 3; if (h > 135 + hash3(wx, 1, wz, seed) * 6) { top = 33; } }
      else { top = 2; filler = 3; }
      if (slope > 5 && top === 2) { top = 1; filler = 1; }
      for (let y = 0; y <= h && y < HEIGHT; y++) {
        let id;
        if (y === 0) id = 6;
        else if (y < 4 && hash3(wx, y, wz, seed) < (4 - y) / 4) id = 6;
        else if (y === h) id = top;
        else if (y > h - fillDepth) id = filler;
        else if (bi === BI.DESERT && y > h - fillDepth - 3) id = 17;
        else id = (y < 8 || (y < 16 && hash3(wx, y, wz, seed + 77) < (16 - y) / 8)) ? 75 : 1;
        // caves
        if (y > 4 && id !== 6) {
          const nearSurf = y > h - 5;
          const wet = h < SEA + 2;
          if (!(wet && y > h - 9)) {
            const a = sample(g1, x, y, z), b = sample(g2, x, y, z);
            const tun = a * a + b * b;
            let carve = tun < (nearSurf ? 0.006 : 0.011);
            if (!carve && y < 52 && !nearSurf) carve = sample(g3, x, y, z) > 0.62 - (52 - y) * 0.004;
            if (carve) id = y <= 10 ? LAVA : AIR;
          }
        }
        B[(y << 8) | (z << 4) | x] = id;
      }
      // water
      for (let y = h + 1; y <= SEA; y++) {
        const i = (y << 8) | (z << 4) | x;
        if (B[i] === AIR) B[i] = (y === SEA && (bi === BI.FROZEN_OCEAN || (bi === BI.SNOWY && c.temp < -0.5))) ? 35 : WATER;
      }
      // snow cover
      if ((bi === BI.SNOWY || bi === BI.SNOWPEAK || (bi === BI.MOUNTAIN && h > 125)) && h >= SEA && h + 1 < HEIGHT) {
        const ti = (h << 8) | (z << 4) | x;
        if (B[ti] === 2) M[ti] = 1;
        if (B[ti] !== AIR && B[ti] !== WATER && B[ti] !== 35 && B[ti] !== 33 && B[(h + 1 << 8) | (z << 4) | x] === AIR) B[((h + 1) << 8) | (z << 4) | x] = 34;
      }
    }
    this.genOres(ch, rng);
    if (rng() < 0.11 && this.structures !== false) this.genDungeon(ch, cols, rng);
    this.decorate(ch, cols);
    ch.recount();
    return ch;
  }

  // ---- Nether -----------------------------------------------------------------
  generateNether(cx, cz) {
    const ch = new Chunk(cx, cz).beginFlat(), B = ch.blocks, M = ch.meta;
    const x0 = cx * 16, z0 = cz * 16, seed = this.seed;
    // density on a 4x4x4 grid: big horizontally-stretched caverns, shelf-forming middle octave and a
    // rough small octave (vanilla's nether noise is squashed vertically, which gives ledges and overhangs)
    const GX = 5, GY = 33, GZ = 5, g = new Float32Array(GX * GY * GZ);
    for (let ix = 0; ix < GX; ix++) for (let iz = 0; iz < GZ; iz++) for (let iy = 0; iy < GY; iy++) {
      const wx = x0 + ix * 4, wy = iy * 4, wz = z0 + iz * 4;
      let d = this.nNether.n3(wx / 90, wy / 42, wz / 90) * 0.95
        + this.nNether2.n3(wx / 34, wy / 13, wz / 34) * 0.42
        + this.nNether.n3(wx / 11 + 300, wy / 8, wz / 11 - 300) * 0.16;
      d += Math.max(0, (18 - wy) / 9) + Math.max(0, (wy - 104) / 10);
      d -= Math.max(0, (52 - Math.abs(wy - 64)) / 52) * 0.22;
      g[(ix * GZ + iz) * GY + iy] = d;
    }
    const sample = (x, y, z) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(fx | 0, GX - 2), iy = Math.min(fy | 0, GY - 2), iz = Math.min(fz | 0, GZ - 2);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i000 = (ix * GZ + iz) * GY + iy, i100 = ((ix + 1) * GZ + iz) * GY + iy;
      const a = lerp(lerp(g[i000], g[i100], tx), lerp(g[i000 + GY], g[i100 + GY], tx), tz);
      const b = lerp(lerp(g[i000 + 1], g[i100 + 1], tx), lerp(g[i000 + GY + 1], g[i100 + GY + 1], tx), tz);
      return lerp(a, b, ty);
    };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z;
      ch.biome[z * 16 + x] = BI.NETHER;
      const soul = this.nNether2.n2(wx / 50, wz / 50) > 0.35, grav = this.nNether.n2(wx / 30 + 99, wz / 30) > 0.45;
      for (let y = 0; y < 128; y++) {
        const i = (y << 8) | (z << 4) | x;
        let id;
        if (y === 0 || y === 127 || (y < 5 && hash3(wx, y, wz, seed) < (5 - y) / 5) || (y > 122 && hash3(wx, y, wz, seed + 1) < (y - 122) / 5)) id = 6;
        else id = sample(x, y, z) > 0.0 ? 119 : (y <= 31 ? LAVA : AIR);
        B[i] = id;
      }
      // surface dressing: soul sand / gravel floors, magma near the lava sea
      for (let y = 120; y > 5; y--) {
        const i = (y << 8) | (z << 4) | x, above = B[((y + 1) << 8) | (z << 4) | x];
        if (B[i] !== 119 || above !== AIR) continue;
        if (soul && y > 31) { B[i] = 120; if (B[i - 256] === 119) B[i - 256] = 120; }
        else if (grav && y >= 30 && y <= 35) B[i] = 10;
        if (y > 32 && hash3(wx, y, wz, seed + 5) < 0.004) B[((y + 1) << 8) | (z << 4) | x] = 171;
      }
      for (let y = 26; y <= 34; y++) { const i = (y << 8) | (z << 4) | x; if (B[i] === 119 && this.nNether.n3(wx / 8, y / 8, wz / 8) > 0.45) B[i] = 103; }
    }
    // glowstone clusters hanging from ceilings (vanilla rule: start under netherrack, then only grow
    // into air that touches exactly one glowstone block -> compact dangling clumps, never loose strands)
    const rng = RNG(hashStr('nether' + seed + ':' + cx + ':' + cz));
    const at = (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y > 126) ? -1 : B[(y << 8) | (z << 4) | x];
    for (let n = 0; n < 12; n++) {
      const ox = 3 + rng.int(10), oz = 3 + rng.int(10), oy = 32 + rng.int(92);
      if (at(ox, oy, oz) !== AIR || at(ox, oy + 1, oz) !== 119) continue;
      B[(oy << 8) | (oz << 4) | ox] = 27;
      for (let k = 0; k < 900; k++) {
        const x = ox + rng.int(4) - rng.int(4), y = oy - rng.int(10), z = oz + rng.int(4) - rng.int(4);
        if (at(x, y, z) !== AIR) continue;
        let nb = 0;
        for (const D of DIRS) if (at(x + D[0], y + D[1], z + D[2]) === 27 && ++nb > 1) break;
        if (nb === 1) B[(y << 8) | (z << 4) | x] = 27;
      }
    }
    const vein = (ore, count, ymin, ymax, size) => {
      for (let k = 0; k < count; k++) {
        let x = rng() * 16, y = ymin + rng() * (ymax - ymin), z = rng() * 16;
        for (let i = 0; i < size; i++) {
          const ix = x | 0, iy = y | 0, iz = z | 0;
          if (ix >= 0 && ix < 16 && iz >= 0 && iz < 16 && iy > 0 && iy < 127) { const q = (iy << 8) | (iz << 4) | ix; if (B[q] === 119) B[q] = ore; }
          x += rng() * 2 - 1; y += rng() * 2 - 1; z += rng() * 2 - 1;
        }
      }
    };
    vein(121, 14, 10, 117, 12); vein(122, 8, 10, 117, 8);
    ch.recount();
    return ch;
  }

  fortressAt(rx, rz) {
    const r = RNG(hashStr('fortress' + this.seed + ':' + rx + ':' + rz));
    if (r() > 0.9) return null;
    const S = 18;
    return { x: (rx * S + 3 + r.int(S - 6)) * 16 + 8, y: 58 + r.int(12), z: (rz * S + 3 + r.int(S - 6)) * 16 + 8, key: 'f' + rx + ',' + rz };
  }
  // fortresses around a position: gen-2 worlds get them from the vanilla structure placement (worker refs)
  fortressesNear(x, z, R = 2) {
    if (this.gen2) {
      const out = [];
      for (const r of (this.structRefs || new Map()).values()) if (r.f) out.push({ x: r.f[0], y: r.f[1] - (this.minY || 0), z: r.f[2], key: 'v' + r.f[0] + ',' + r.f[2] });
      return out;
    }
    const S = 18 * 16, rx = Math.floor(x / S), rz = Math.floor(z / S), out = [];
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) { const f = this.fortressAt(rx + a, rz + b); if (f) out.push(f); }
    return out;
  }
  nearestFortress(x, z) {
    let best = null, bd = 1e9;
    for (const f of this.fortressesNear(x, z)) { const d = Math.hypot(f.x - x, f.z - z); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  buildFortress(f) {
    const S = new StructBuilder(), NB = 123, FE = 124, X = f.x, Y = f.y, Z = f.z, L = 44;
    const r = RNG(hashStr(f.key + this.seed));
    // bridges in a cross
    for (const ax of [0, 1]) {
      for (let t = -L; t <= L; t++) {
        for (let w = -2; w <= 2; w++) {
          const x = ax ? X + w : X + t, z = ax ? Z + t : Z + w;
          S.set(x, Y, z, NB);
          for (let y = Y + 1; y <= Y + 5; y++) S.set(x, y, z, AIR);
          if (Math.abs(w) === 2) S.set(x, Y + 1, z, FE, ax ? 12 : 3);
        }
        if (Math.abs(t) % 10 === 5) {
          for (let y = Y - 1; y >= Math.max(12, Y - 50); y--) for (let w = -2; w <= 2; w++) for (let k = -1; k <= 1; k++) {
            const x = ax ? X + w : X + t + k, z = ax ? Z + t + k : Z + w;
            if (Math.abs(w) <= 1 || y < Y - 3) S.set(x, y, z, NB);
          }
        }
      }
    }
    const room = (cx, cz, half, h) => {
      S.box(cx - half, Y, cz - half, cx + half, Y + h, cz + half, NB);
      for (let k = -half + 2; k <= half - 2; k += 3) for (const [dx, dz] of [[k, -half], [k, half], [-half, k], [half, k]]) { S.set(cx + dx, Y + 2, cz + dz, FE, 15); S.set(cx + dx, Y + 3, cz + dz, FE, 15); }
      for (const [dx, dz] of [[0, -half], [0, half], [-half, 0], [half, 0]]) for (let w = -1; w <= 1; w++) for (let y = Y + 1; y <= Y + 4; y++) S.set(cx + dx + (dz ? w : 0), y, cz + dz + (dx ? w : 0), AIR);
    };
    // central blaze room
    room(X, Z, 7, 7);
    S.fill(X - 1, Y + 1, Z - 1, X + 1, Y + 1, Z + 1, NB);
    S.set(X, Y + 2, Z, 127, 3);
    // arm ends: wart garden (east), treasure (west), open blaze balcony (south), stairs room (north)
    room(X + L, Z, 5, 6);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -1; dz <= 1; dz++) { S.set(X + L + dx, Y, Z + dz * 2, 120); S.set(X + L + dx, Y + 1, Z + dz * 2, 126, 3); }
    room(X - L, Z, 5, 6);
    S.set(X - L, Y + 1, Z - 3, 52, 5 | 8); S.set(X - L + 2, Y + 1, Z + 3, 52, 4 | 8);
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      S.set(X + dx, Y, Z + L + dz, NB);
      for (let y = Y + 1; y <= Y + 5; y++) S.set(X + dx, y, Z + L + dz, AIR);
      if (Math.abs(dx) === 4 || Math.abs(dz) === 4) S.set(X + dx, Y + 1, Z + L + dz, FE, 15);
    }
    S.fill(X - 1, Y + 1, Z + L - 1, X + 1, Y + 1, Z + L + 1, NB); S.set(X, Y + 2, Z + L, 127, 3);
    room(X, Z - L, 5, 6);
    for (let k = 0; k < 4; k++) S.set(X - 2 + k, Y + 1 + k, Z - L + 3, 125, 3);
    // a few torches-free glowstone lights inside rooms
    for (const [x, z] of [[X - 5, Z - 5], [X + 5, Z + 5], [X + L, Z], [X - L, Z]]) S.set(x, Y + 6, z, 27);
    return S;
  }

  // ---- Overworld strongholds -------------------------------------------------------
  strongholds() {
    if (this._sh) return this._sh;
    const r = RNG(hashStr('strongholds' + this.seed)), a0 = r() * Math.PI * 2, out = [];
    for (let i = 0; i < 3; i++) {
      const a = a0 + i * Math.PI * 2 / 3 + (r() - 0.5) * 0.5, d = 640 + r() * 420;
      out.push({ x: Math.floor(Math.cos(a) * d / 16) * 16 + 8, y: 26 + r.int(10), z: Math.floor(Math.sin(a) * d / 16) * 16 + 8, key: 'sh' + i });
    }
    return (this._sh = out);
  }
  buildStronghold(h) {
    const S = new StructBuilder(), X = h.x, Y = h.y, Z = h.z;
    const r = RNG(hashStr(h.key + this.seed));
    const brick = () => { const v = r(); return v < 0.7 ? 23 : v < 0.85 ? 94 : 93; };
    // portal room
    S.box(X - 6, Y - 1, Z - 8, X + 6, Y + 7, Z + 8, brick);
    S.fill(X - 4, Y, Z - 4, X + 4, Y, Z + 4, () => brick());
    S.fill(X - 1, Y - 1, Z - 1, X + 1, Y - 1, Z + 1, LAVA);
    S.fill(X - 1, Y, Z - 1, X + 1, Y, Z + 1, AIR);
    for (let k = -1; k <= 1; k++) {
      S.set(X + k, Y, Z - 2, 174, r() < 0.1 ? 4 : 0); S.set(X + k, Y, Z + 2, 174, r() < 0.1 ? 4 : 0);
      S.set(X - 2, Y, Z + k, 174, r() < 0.1 ? 4 : 0); S.set(X + 2, Y, Z + k, 174, r() < 0.1 ? 4 : 0);
    }
    for (let k = -1; k <= 1; k++) S.set(X + k, Y, Z + 5, 62, 3);
    for (const [x, z, m] of [[X - 5, Z - 6, 0], [X + 5, Z - 6, 1], [X - 5, Z + 6, 0], [X + 5, Z + 6, 1]]) S.set(x, Y + 3, z, 21, m);
    // corridors
    const corridor = (x0, z0, dx, dz, len) => {
      for (let t = 0; t < len; t++) {
        const x = x0 + dx * t, z = z0 + dz * t;
        for (let w = -2; w <= 2; w++) for (let y = Y - 1; y <= Y + 3; y++) {
          const px = x + (dz ? w : 0), pz = z + (dx ? w : 0);
          const edge = Math.abs(w) === 2 || y === Y - 1 || y === Y + 3;
          S.set(px, y, pz, edge ? brick() : AIR);
        }
        if (t % 8 === 4) S.set(x + (dz ? 1 : 0), Y + 2, z + (dx ? 1 : 0), 21, dz ? 0 : 4);
      }
    };
    corridor(X, Z - 9, 0, -1, 22); corridor(X, Z + 9, 0, 1, 22); corridor(X - 7, Z, -1, 0, 22); corridor(X + 7, Z, 1, 0, 22);
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let w = -1; w <= 1; w++) for (let y = Y; y <= Y + 2; y++) S.set(X + dx * (dz ? 0 : 6) + (dz ? w : 0), y, Z + dz * 8 + (dx ? w : 0), AIR);
    // library at the east end
    const LX = X + 7 + 22 + 5;
    S.box(LX - 5, Y - 1, Z - 6, LX + 5, Y + 6, Z + 6, brick);
    for (let x = LX - 4; x <= LX + 4; x++) for (let y = Y; y <= Y + 4; y++) { S.set(x, y, Z - 5, 25); S.set(x, y, Z + 5, 25); }
    S.set(LX + 3, Y, Z, 52, 0 | 8); S.set(LX, Y + 5, Z, 27);
    for (let w = -1; w <= 1; w++) for (let y = Y; y <= Y + 2; y++) S.set(LX - 5, y, Z + w, AIR);
    // storeroom at the west end
    const WX = X - 7 - 22 - 4;
    S.box(WX - 4, Y - 1, Z - 4, WX + 4, Y + 4, Z + 4, brick);
    S.set(WX - 3, Y, Z - 3, 52, 1 | 8); S.set(WX - 3, Y, Z + 3, 52, 1 | 8); S.set(WX, Y + 3, Z, 27);
    for (let w = -1; w <= 1; w++) for (let y = Y; y <= Y + 2; y++) S.set(WX + 4, y, Z + w, AIR);
    // spiral-ish stairway at the north end heading upward
    const NZ = Z - 9 - 22;
    for (let k = 0; k < 18; k++) {
      const z = NZ - k;
      for (let w = -2; w <= 2; w++) for (let y = Y - 1 + k; y <= Y + 4 + k; y++) {
        const edge = Math.abs(w) === 2 || y === Y - 1 + k || y === Y + 4 + k;
        S.set(X + w, y, z, edge ? brick() : AIR);
      }
      for (let w = -1; w <= 1; w++) S.set(X + w, Y + k, z, 62, 3);
    }
    return S;
  }

  // ---- The End ----------------------------------------------------------------------
  initEnd() {
    const r = RNG(hashStr('pillars' + this.seed)), heights = [];
    for (let i = 0; i < 10; i++) heights.push(76 + 3 * i);
    for (let i = 9; i > 0; i--) { const j = r.int(i + 1); const t = heights[i]; heights[i] = heights[j]; heights[j] = t; }
    this.endPillars = [];
    for (let i = 0; i < 10; i++) {
      const a = 2 * Math.PI * i / 10;
      this.endPillars.push({ x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), r: 2 + (heights[i] - 76) / 9 | 0, h: heights[i] });
    }
    this.endTop0 = this.endTop(0, 0);
  }
  endTop(x, z) { const d = Math.hypot(x, z), R = 88 + this.nEnd.fbm2(x / 40, z / 40, 3) * 12; return Math.round(60 + this.nEnd.n2(x / 60 + 50, z / 60) * 3 - Math.pow(Math.min(1, d / R), 4) * 6); }
  generateEnd(cx, cz) {
    const ch = new Chunk(cx, cz).beginFlat(), B = ch.blocks;
    const x0 = cx * 16, z0 = cz * 16;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z, d = Math.hypot(wx, wz);
      ch.biome[z * 16 + x] = BI.END;
      const R = 88 + this.nEnd.fbm2(wx / 40, wz / 40, 3) * 12;
      if (d >= R) continue;
      const top = this.endTop(wx, wz), thick = Math.sqrt(R * R - d * d) * 0.45 + 3;
      for (let y = Math.max(1, Math.round(top - thick)); y <= top; y++) B[(y << 8) | (z << 4) | x] = 172;
    }
    for (const p of this.endPillars) {
      if (p.x + p.r < x0 || p.x - p.r > x0 + 15 || p.z + p.r < z0 || p.z - p.r > z0 + 15) continue;
      for (let x = p.x - p.r; x <= p.x + p.r; x++) for (let z = p.z - p.r; z <= p.z + p.r; z++) {
        if ((x - p.x) ** 2 + (z - p.z) ** 2 > p.r * p.r + 1 || x < x0 || x > x0 + 15 || z < z0 || z > z0 + 15) continue;
        for (let y = 40; y <= p.h; y++) B[(y << 8) | ((z - z0) << 4) | (x - x0)] = 28;
      }
      if (p.x >= x0 && p.x <= x0 + 15 && p.z >= z0 && p.z <= z0 + 15) B[((p.h + 1) << 8) | ((p.z - z0) << 4) | (p.x - x0)] = 6;
    }
    // exit portal fountain (inactive)
    const yb = this.endTop0 + 1;
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      const wx = x, wz = z;
      if (wx < x0 || wx > x0 + 15 || wz < z0 || wz > z0 + 15) continue;
      const d = Math.hypot(x, z), lx = wx - x0, lz = wz - z0;
      if (d <= 3.5) B[(yb << 8) | (lz << 4) | lx] = 6;
      if (d > 2.5 && d <= 3.5) B[((yb + 1) << 8) | (lz << 4) | lx] = 6;
      else if (d <= 2.5) B[((yb + 1) << 8) | (lz << 4) | lx] = AIR;
      for (let y = yb + 2; y <= yb + 6; y++) if (d <= 3.5) B[(y << 8) | (lz << 4) | lx] = AIR;
      if (x === 0 && z === 0) for (let y = yb + 1; y <= yb + 4; y++) B[(y << 8) | (lz << 4) | lx] = 6;
    }
    for (const [dx, dz, m] of [[1, 0, 0], [-1, 0, 1], [0, 1, 4], [0, -1, 5]]) {
      if (dx >= x0 && dx <= x0 + 15 && dz >= z0 && dz <= z0 + 15) { const i = ((yb + 3) << 8) | ((dz - z0) << 4) | (dx - x0); B[i] = 21; ch.meta[i] = m; }
    }
    ch.recount();
    return ch;
  }

  structuresFor(cx, cz) {
    const out = [], bx = cx * 16 + 8, bz = cz * 16 + 8;
    if (this.structures === false) return out;
    const get = (f, build) => { let sb = this.structCache.get(f.key); if (!sb) { sb = build(f); this.structCache.set(f.key, sb); } return sb; };
    if (this.dim === 'overworld' && !this.flat) {
      for (const h of this.strongholds()) if (Math.abs(h.x - bx) < 80 && Math.abs(h.z - bz) < 80) out.push(get(h, (f) => this.buildStronghold(f)));
    } else if (this.dim === 'nether') {
      for (const f of this.fortressesNear(bx, bz, 1)) if (Math.abs(f.x - bx) < 70 && Math.abs(f.z - bz) < 70) out.push(get(f, (q) => this.buildFortress(q)));
    }
    return out;
  }
  inFortress(x, y, z) {
    const f = this.nearestFortress(x, z);
    return f && Math.abs(f.x - x) <= 50 && Math.abs(f.z - z) <= 50 && y >= f.y - 2 && y <= f.y + 10;
  }

  genOres(ch, rng) {
    const B = ch.blocks;
    const vein = (ore, deepOre, count, ymin, ymax, size) => {
      for (let n = 0; n < count; n++) {
        let x = rng() * 16, y = ymin + rng() * (ymax - ymin), z = rng() * 16;
        const s = size * (0.6 + rng() * 0.6);
        for (let i = 0; i < s; i++) {
          const ix = x | 0, iy = y | 0, iz = z | 0;
          if (ix >= 0 && ix < 16 && iz >= 0 && iz < 16 && iy > 0 && iy < HEIGHT) {
            const k = (iy << 8) | (iz << 4) | ix;
            if (B[k] === 1) B[k] = ore; else if (B[k] === 75 && deepOre) B[k] = deepOre;
          }
          x += rng() * 2 - 1; y += rng() * 2 - 1; z += rng() * 2 - 1;
        }
      }
    };
    vein(74, 74, 6, 0, 90, 30); vein(73, 73, 5, 0, 90, 30); vein(72, 72, 6, 0, 90, 30);
    vein(3, 0, 6, 10, 100, 24); vein(10, 0, 5, 5, 100, 24);
    vein(13, 76, 22, 5, 130, 12);
    vein(12, 77, 16, 1, 72, 9);
    vein(11, 78, 3, 1, 32, 8);
    vein(80, 0, 6, 1, 16, 7);
    vein(81, 0, 2, 1, 32, 6);
    vein(18, 79, 2, 1, 16, 6);
  }

  genDungeon(ch, cols, rng) {
    const B = ch.blocks, M = ch.meta;
    const lx0 = rng.int(7), lz0 = rng.int(7), W = 8 + rng.int(2), D = 8 + rng.int(2);
    if (lx0 + W > 15 || lz0 + D > 15) return;
    let minH = 999;
    for (let z = lz0; z <= lz0 + D; z++) for (let x = lx0; x <= lx0 + W; x++) minH = Math.min(minH, cols[(z + 1) * 18 + x + 1].h);
    const y0 = 8 + rng.int(Math.max(1, Math.min(40, minH - 20)));
    if (y0 + 12 > minH) return;
    for (let y = 0; y <= 5; y++) for (let z = 0; z <= D; z++) for (let x = 0; x <= W; x++) {
      const i = ((y0 + y) << 8) | ((lz0 + z) << 4) | (lx0 + x);
      const edge = x === 0 || z === 0 || x === W || z === D || y === 0 || y === 5;
      if (edge) { if (y === 5 && B[i] === AIR) continue; B[i] = (y === 0 && rng() < 0.6) || rng() < 0.25 ? 24 : 4; }
      else B[i] = AIR;
      M[i] = 0;
    }
    // openings so caves can connect
    const chests = 1 + (rng() < 0.5 ? 1 : 0);
    const spots = [[1, Math.floor(D / 2), 1], [W - 1, Math.floor(D / 2), 0], [Math.floor(W / 2), 1, 5], [Math.floor(W / 2), D - 1, 4]];
    for (let k = 0; k < chests; k++) {
      const [x, z, face] = spots[rng.int(4)];
      const i = ((y0 + 1) << 8) | ((lz0 + z) << 4) | (lx0 + x);
      B[i] = 52; M[i] = face | 8;
    }
    { const i = ((y0 + 1) << 8) | ((lz0 + (D >> 1)) << 4) | (lx0 + (W >> 1)); B[i] = 127; M[i] = rng.int(3); }
    // a few cobwebs-like decorations: mossy pillars
    for (let k = 0; k < 3; k++) { const i = ((y0 + 1) << 8) | ((lz0 + 2 + rng.int(D - 3)) << 4) | (lx0 + 2 + rng.int(W - 3)); if (B[i] === AIR && rng() < 0.5) B[i] = 70 + rng.int(2); }
    ch.dungeon = [ch.cx * 16 + lx0 + W / 2, y0 + 1, ch.cz * 16 + lz0 + D / 2];
  }

  // Trees are deterministic per chunk so neighbours can place their overhanging parts.
  treesFor(ncx, ncz) {
    const k = ckey(ncx, ncz);
    if (!this._treeCache) this._treeCache = new Map();
    let t = this._treeCache.get(k);
    if (t) return t;
    t = [];
    const r = RNG(hashStr('trees' + this.seed + ':' + ncx + ':' + ncz));
    const cc = this.column(ncx * 16 + 8, ncz * 16 + 8);
    const bi = this.biomeOf(cc);
    const dens = { [BI.FOREST]: 9, [BI.BIRCH]: 9, [BI.TAIGA]: 7, [BI.SNOWY]: 1.5, [BI.PLAINS]: 0.25, [BI.MOUNTAIN]: 0.6, [BI.RIVER]: 0.3 }[bi] || 0;
    let n = Math.floor(dens + r());
    for (let i = 0; i < n; i++) {
      const lx = r.int(16), lz = r.int(16);
      const X = ncx * 16 + lx, Z = ncz * 16 + lz;
      const c = this.column(X, Z);
      const b = this.biomeOf(c);
      if (c.h <= SEA || c.h > 125) continue;
      if (b === BI.DESERT || b === BI.BEACH || b === BI.OCEAN || b === BI.SNOWPEAK) continue;
      // slope check
      const c2 = this.column(X + 1, Z), c3 = this.column(X, Z + 1);
      if (Math.abs(c2.h - c.h) > 2 || Math.abs(c3.h - c.h) > 2) continue;
      let type = 'oak';
      if (b === BI.TAIGA || b === BI.SNOWY || (b === BI.MOUNTAIN)) type = 'spruce';
      else if (b === BI.BIRCH) type = r() < 0.85 ? 'birch' : 'oak';
      else if (b === BI.FOREST) type = r() < 0.25 ? 'birch' : (r() < 0.1 ? 'big' : 'oak');
      t.push({ x: X, y: c.h + 1, z: Z, type, h: 4 + r.int(3), seed: r.int(1 << 30) });
    }
    if (this._treeCache.size > 4000) this._treeCache.clear();
    this._treeCache.set(k, t);
    return t;
  }

  placeTree(set, tr) {
    const { x, y, z, type } = tr;
    const r = RNG(tr.seed);
    if (type === 'oak' || type === 'birch' || type === 'big') {
      const log = type === 'birch' ? 46 : 14, leaf = type === 'birch' ? 47 : 15;
      const h = type === 'birch' ? tr.h + 1 : tr.h + (type === 'big' ? 2 : 0);
      for (let dy = h - 3; dy <= h; dy++) {
        const rad = dy >= h - 1 ? 1 : 2;
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === h || r() < 0.5)) continue;
          set(x + dx, y + dy, z + dz, leaf, 0, false);
        }
      }
      if (type === 'big') for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!dx || !dz) set(x + dx, y + h + 1, z + dz, leaf, 0, false);
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, log, 0, true);
      set(x, y - 1, z, 3, 0, true);
    } else if (type === 'spruce') {
      const h = tr.h + 3;
      let rad = 0;
      for (let dy = h; dy >= 2; dy--) {
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
          set(x + dx, y + dy, z + dz, 50, 0, false);
        }
        rad = rad >= 2 ? 1 : rad + 1;
        if (dy === h) rad = 1;
      }
      set(x, y + h + 1, z, 50, 0, false);
      for (let dy = 0; dy < h; dy++) set(x, y + dy, z, 49, 0, true);
      set(x, y - 1, z, 3, 0, true);
    }
  }

  decorate(ch, cols) {
    const B = ch.blocks, M = ch.meta, x0 = ch.cx * 16, z0 = ch.cz * 16;
    const set = (wx, wy, wz, id, meta, force) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy >= HEIGHT) return;
      const i = (wy << 8) | (lz << 4) | lx, cur = B[i];
      if (force ? (cur !== 6) : (cur === AIR || cur === 34 || cur === 39 || cur === 40)) { B[i] = id; M[i] = meta; }
    };
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const tr of this.treesFor(ch.cx + dx, ch.cz + dz)) {
        if (tr.x < x0 - 3 || tr.x > x0 + 18 || tr.z < z0 - 3 || tr.z > z0 + 18) continue;
        // only grow if the trunk base is on ground in its own chunk (checked loosely via column height)
        if (dx === 0 && dz === 0) {
          const g = B[((tr.y - 1) << 8) | ((tr.z - z0) << 4) | (tr.x - x0)];
          if (g !== 2 && g !== 3) continue;
        }
        this.placeTree(set, tr);
      }
    }
    // ground plants
    const r = RNG(hashStr('plants' + this.seed + ':' + ch.cx + ':' + ch.cz));
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const c = cols[(z + 1) * 18 + x + 1];
      const h = c.h; if (h + 1 >= HEIGHT || h < SEA) continue;
      const bi = ch.biome[z * 16 + x];
      const gi = (h << 8) | (z << 4) | x, ai = ((h + 1) << 8) | (z << 4) | x;
      if (B[ai] !== AIR) continue;
      const g = B[gi], v = r();
      if (g === 2) {
        if (bi === BI.PLAINS) {
          if (v < 0.25) B[ai] = 39;
          else if (v < 0.28) B[ai] = [41, 42, 98, 44, 101, 43][(this.nSurf.n2((x0 + x) / 30, (z0 + z) / 30) * 3 + 3) | 0] || 41;
          else if (v < 0.2805) B[ai] = 53;
        } else if (bi === BI.FOREST || bi === BI.BIRCH) {
          if (v < 0.12) B[ai] = 39; else if (v < 0.135) B[ai] = [41, 42, 99, 102, 100][r.int(5)];
          else if (v < 0.138) B[ai] = r() < 0.5 ? 70 : 71;
        } else if (bi === BI.TAIGA) {
          if (v < 0.08) B[ai] = 40; else if (v < 0.1) B[ai] = 39; else if (v < 0.103) B[ai] = 71;
        } else if (bi === BI.MOUNTAIN) {
          if (v < 0.05) B[ai] = 39;
        } else if (bi === BI.RIVER || bi === BI.BEACH) {
          if (v < 0.1) B[ai] = 39;
        }
      } else if (g === 9 && bi === BI.DESERT) {
        if (v < 0.006) { const hh = 1 + r.int(3); for (let k = 1; k <= hh && h + k < HEIGHT; k++) B[((h + k) << 8) | (z << 4) | x] = 37; }
        else if (v < 0.014) B[ai] = 45;
      }
      // sugar cane next to water
      if ((g === 2 || g === 9 || g === 3) && h <= SEA + 1 && r() < 0.12) {
        let wet = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && B[(h << 8) | (nz << 4) | nx] === WATER) wet = true;
        }
        if (wet) { const hh = 1 + r.int(3); for (let k = 1; k <= hh; k++) B[((h + k) << 8) | (z << 4) | x] = 38; }
      }
    }
  }

  // ---- lighting -------------------------------------------------------------
  // a new chunk's light: its own (lightChunk; the chunk worker already did that for the chunks it sends),
  // then what crosses to and from the loaded neighbours
  initLight(ch) {
    if (!ch.lit) lightChunk(ch, this.hasSky);
    this.exchangeLight(ch);
    ch.lit = true;
  }
  // light crossing the borders with the 4 neighbours. Only cells where one side is brighter than the other by
  // more than 1 can pass anything on (a cell lights its neighbour to at most its own level - 1); whole
  // sections of one light value on both sides are compared at once
  exchangeLight(ch) {
    const x0 = ch.cx * 16, z0 = ch.cz * 16;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.getChunk(ch.cx + dx, ch.cz + dz);
      if (!n || !n.lit) continue;
      const qs = [], qb = [], nx0 = n.cx * 16, nz0 = n.cz * 16;
      for (let s = 0; s < SECTIONS; s++) {
        if (!ch.ls[s] && !n.ls[s]) {
          const a = ch.lu[s], b = n.lu[s];
          if (Math.abs((a >> 4) - (b >> 4)) <= 1 && Math.abs((a & 15) - (b & 15)) <= 1) continue;
        }
        for (let y = s << 4; y < (s + 1) << 4; y++) for (let k = 0; k < 16; k++) {
          let ax, az, bx, bz; // a in ch, b in n (local)
          if (dx === 1) { ax = 15; az = k; bx = 0; bz = k; } else if (dx === -1) { ax = 0; az = k; bx = 15; bz = k; }
          else if (dz === 1) { ax = k; az = 15; bx = k; bz = 0; } else { ax = k; az = 0; bx = k; bz = 15; }
          const la = ch.getL((y << 8) | (az << 4) | ax), lb = n.getL((y << 8) | (bz << 4) | bx);
          const sa = la >> 4, sb = lb >> 4, ba = la & 15, bb = lb & 15;
          if (sa > sb + 1) qs.push(x0 + ax, y, z0 + az); else if (sb > sa + 1) qs.push(nx0 + bx, y, nz0 + bz);
          if (ba > bb + 1) qb.push(x0 + ax, y, z0 + az); else if (bb > ba + 1) qb.push(nx0 + bx, y, nz0 + bz);
        }
      }
      if (qs.length) this.propagate(qs, 4);
      if (qb.length) this.propagate(qb, 0);
    }
  }

  markLight(ch, lx, y, lz) {
    const s = 1 << (y >> 4);
    let m = s; const yy = y & 15;
    if (yy === 0 && y > 0) m |= s >> 1; else if (yy === 15) m |= s << 1;
    ch.dirty |= m;
    if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
      const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0, dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (dx) { const n = this.chunks.get(ckey(ch.cx + dx, ch.cz)); if (n) n.dirty |= m; }
      if (dz) { const n = this.chunks.get(ckey(ch.cx, ch.cz + dz)); if (n) n.dirty |= m; }
      if (dx && dz) { const n = this.chunks.get(ckey(ch.cx + dx, ch.cz + dz)); if (n) n.dirty |= m; }
    }
  }

  // BFS light propagation; q holds flat x,y,z triples. shift 4 = sky, 0 = block
  propagate(q, shift) {
    const sky = shift === 4;
    let head = 0;
    let cache = null, ccx = 0, ccz = 0;
    while (head < q.length) {
      const x = q[head++], y = q[head++], z = q[head++];
      const cx = x >> 4, cz = z >> 4;
      if (!cache || cx !== ccx || cz !== ccz) { cache = this.chunks.get(ckey(cx, cz)); ccx = cx; ccz = cz; }
      if (!cache) continue;
      const l = (cache.getL((y << 8) | ((z & 15) << 4) | (x & 15)) >> shift) & 15;
      if (l <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (ny < 0 || ny >= HEIGHT) continue;
        const nc = (nx >> 4 === cx && nz >> 4 === cz) ? cache : this.chunks.get(ckey(nx >> 4, nz >> 4));
        if (!nc) continue;
        const i = (ny << 8) | ((nz & 15) << 4) | (nx & 15);
        const op = OPACITY[nc.getB(i)];
        if (op >= 15) continue;
        const nl = (sky && d === 2 && l === 15 && op === 0) ? 15 : l - Math.max(1, op);
        const cl = nc.getL(i), cur = (cl >> shift) & 15;
        if (nl > cur) {
          nc.setL(i, sky ? ((cl & 0x0F) | (nl << 4)) : ((cl & 0xF0) | nl));
          this.markLight(nc, nx & 15, ny, nz & 15);
          q.push(nx, ny, nz);
        }
      }
    }
    q.length = 0;
  }

  // light update after block change at x,y,z
  relight(x, y, z) {
    for (const shift of (this.hasSky ? [4, 0] : [0])) {
      const sky = shift === 4;
      const rem = [], add = [];
      const ch = this.getChunk(x >> 4, z >> 4);
      const i0 = (y << 8) | ((z & 15) << 4) | (x & 15);
      const v0 = (ch.getL(i0) >> shift) & 15;
      if (v0 > 0) {
        ch.setL(i0, ch.getL(i0) & (sky ? 0x0F : 0xF0));
        this.markLight(ch, x & 15, y, z & 15);
        rem.push(x, y, z, v0);
      }
      let h = 0;
      while (h < rem.length) {
        const rx = rem[h++], ry = rem[h++], rz = rem[h++], rv = rem[h++];
        for (let d = 0; d < 6; d++) {
          const D = DIRS[d];
          const nx = rx + D[0], ny = ry + D[1], nz = rz + D[2];
          if (ny < 0 || ny >= HEIGHT) continue;
          const nc = this.chunks.get(ckey(nx >> 4, nz >> 4));
          if (!nc) continue;
          const i = (ny << 8) | ((nz & 15) << 4) | (nx & 15);
          const cl = nc.getL(i), nl = (cl >> shift) & 15;
          if (nl === 0) continue;
          if (nl < rv || (sky && d === 2 && rv === 15 && nl === 15)) {
            nc.setL(i, cl & (sky ? 0x0F : 0xF0));
            this.markLight(nc, nx & 15, ny, nz & 15);
            rem.push(nx, ny, nz, nl);
          } else add.push(nx, ny, nz);
        }
      }
      // emission
      if (!sky) {
        const b0 = ch.getB(i0), e = EMIT[b0] && emitOf(b0, ch.getM(i0));
        if (e) { ch.setL(i0, (ch.getL(i0) & 0xF0) | e); add.push(x, y, z); }
      } else if (y === HEIGHT - 1 && OPACITY[ch.getB(i0)] === 0) { ch.setL(i0, ch.getL(i0) | 0xF0); add.push(x, y, z); }
      for (let d = 0; d < 6; d++) add.push(x + DIRS[d][0], Math.max(0, Math.min(HEIGHT - 1, y + DIRS[d][1])), z + DIRS[d][2]);
      this.propagate(add, shift);
    }
  }

  // ---- block modification -----------------------------------------------------
  markBlock(ch, lx, y, lz) {
    const s = 1 << (y >> 4); let m = s;
    const yy = y & 15;
    if (yy === 0 && y > 0) m |= s >> 1; else if (yy === 15) m |= s << 1;
    ch.dirty |= m;
    if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
      const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0, dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (dx) { const n = this.chunks.get(ckey(ch.cx + dx, ch.cz)); if (n) n.dirty |= m; }
      if (dz) { const n = this.chunks.get(ckey(ch.cx, ch.cz + dz)); if (n) n.dirty |= m; }
      if (dx && dz) { const n = this.chunks.get(ckey(ch.cx + dx, ch.cz + dz)); if (n) n.dirty |= m; }
    }
  }

  // flags: 1 = notify neighbours, 2 = skip light
  setBlock(x, y, z, id, meta = 0, flags = 1) {
    if (y < 0 || y >= HEIGHT) return false;
    const ch = this.getChunk(x >> 4, z >> 4);
    if (!ch) return false;
    const i = (y << 8) | ((z & 15) << 4) | (x & 15);
    const old = ch.getB(i), oldMeta = ch.getM(i);
    if (old === id && oldMeta === meta) return false;
    // a waterlogged block taken away leaves its water (vanilla removeBlock: the fluid state stays); another block, or
    // a slab made double, takes it away
    if (ch.wl && ch.wl.has(i) && (old !== id || !canWaterlog(id, meta))) {
      ch.wl.delete(i);
      if (!id) { id = WATER; meta = 0; }
    }
    ch.setB(i, id); ch.setM(i, meta);
    if (!old && id) ch.sectionCount[y >> 4]++; else if (old && !id) ch.sectionCount[y >> 4]--;
    ch.modified = true;
    this.markBlock(ch, x & 15, y, z & 15);
    if (!(flags & 2) && (OPACITY[old] !== OPACITY[id] || emitOf(old, oldMeta) !== emitOf(id, meta))) this.relight(x, y, z);
    if (flags & 1) {
      this.notify(x, y, z, old);
      for (let d = 0; d < 6; d++) this.notify(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2], -1);
    }
    if (this.listener) this.listener.onBlockChanged(x, y, z, old, id, oldMeta);
    return true;
  }
  setMeta(x, y, z, meta) {
    const ch = this.getChunk(x >> 4, z >> 4);
    if (!ch || y < 0 || y >= HEIGHT) return;
    const i = (y << 8) | ((z & 15) << 4) | (x & 15);
    if (ch.getM(i) === meta) return;
    ch.setM(i, meta); ch.modified = true;
    this.markBlock(ch, x & 15, y, z & 15);
    // (the fluids beside it look again: a trapdoor, door or gate opened let no water through - "活板门开了水也不流",
    // feedback 2026-11-01/02)
    for (const D of DIRS) { const nx = x + D[0], ny = y + D[1], nz = z + D[2], n = this.getBlock(nx, ny, nz); if (IS_FLUID[n]) this.schedule(nx, ny, nz, n === WATER ? 5 : (this.dim === 'nether' ? 10 : 30)); }
    if (this.isWaterlogged(x, y, z)) this.schedule(x, y, z, 5);
  }

  notify(x, y, z, changedOld) {
    if (y < 0 || y >= HEIGHT) return;
    const id = this.getBlock(x, y, z);
    if (IS_FLUID[id]) this.schedule(x, y, z, id === WATER ? 5 : (this.dim === 'nether' ? 10 : 30));
    else if (id === 171) this.schedule(x, y, z, 30 + ((Math.random() * 10) | 0));
    else if (this.isWaterlogged(x, y, z)) this.schedule(x, y, z, 5);
    if (this.listener && id) this.listener.onNeighborUpdate(x, y, z, id);
  }

  schedule(x, y, z, delay) {
    const k = `${x},${y},${z}`;
    if (!this.ticks.has(k)) this.ticks.set(k, { x, y, z, t: this.time + delay });
  }

  tickScheduled() {
    if (!this.ticks.size) return;
    const due = [];
    for (const [k, v] of this.ticks) if (v.t <= this.time) { due.push(v); this.ticks.delete(k); if (due.length > 400) break; }
    for (const t of due) {
      if (this.getBlock(t.x, t.y, t.z) === 171) {
        if (!this.isLoaded(t.x, t.z) || !this.listener || !this.listener.fireTick) continue;
        this.listener.fireTick(t.x, t.y, t.z);
        if (this.getBlock(t.x, t.y, t.z) === 171) this.schedule(t.x, t.y, t.z, 30 + ((Math.random() * 10) | 0));
      } else this.fluidTick(t.x, t.y, t.z);
    }
  }

  // (every kind of torch is washed away - the wall ones, soul, redstone, copper - as vanilla; they held the water back
  // and lava too: "水冲不掉插在方块侧面的火把", "火把能挡岩浆", feedback 2026-11-01/02)
  // (kelp, seagrass, coral ... already hold water: never washed away - an ocean's kelp popped into items, feedback 11-03)
  canFlowInto(id) { if (WLOG[id]) return false; return id === AIR || (REPLACEABLE[id] && !IS_FLUID[id]) || id === 21 || TORCHLIKE[id] === 1 || (BLOCKS[id] && BLOCKS[id].needsSupport && !BLOCKS[id].solid); }

  fluidTick(x, y, z) {
    if (!this.isLoaded(x, z)) return;
    // a waterlogged block holds a water source: it spreads like one, through the faces its shape leaves open
    const wl = !IS_FLUID[this.getBlock(x, y, z)] && this.isWaterlogged(x, y, z);
    const id = wl ? WATER : this.getBlock(x, y, z);
    if (!IS_FLUID[id]) return;
    let meta = wl ? 0 : this.getMeta(x, y, z);
    const water = id === WATER, drop = water || this.dim === 'nether' ? 1 : 2, other = water ? LAVA : WATER;
    // fluid contact
    if (!water) {
      for (let d = 0; d < 6; d++) {
        if (d === 2) continue;
        const ax = x + DIRS[d][0], ay = y + DIRS[d][1], az = z + DIRS[d][2];
        if (this.getBlock(ax, ay, az) === WATER || this.isWaterlogged(ax, ay, az)) {
          this.setBlock(x, y, z, meta === 0 ? 28 : 4, 0);
          if (this.listener) this.listener.onFizz(x, y, z);
          return;
        }
      }
    }
    // vanilla LiquidBlock.shouldSpreadLiquid: lava on soul soil next to blue ice turns to basalt
    if (!water && BID.basalt !== undefined && this.getBlock(x, y - 1, z) === BID.soul_soil && [0, 1, 3, 4, 5].some(d => this.getBlock(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2]) === BID.blue_ice)) {
      this.setBlock(x, y, z, BID.basalt, 0); if (this.listener) this.listener.onFizz(x, y, z); return;
    }
    // a flow takes its level from its neighbours (vanilla FlowingFluid.tick / getNewLiquid); a source keeps its own
    if (meta !== 0) {
      const nm = this.newLiquid(id, x, y, z, water, drop);
      if (nm !== meta) {
        if (nm < 0) { this.setBlock(x, y, z, AIR, 0); return; }
        // LavaFluid.getSpreadDelay: lava rising (not falling) waits four times as long, three times out of four
        if (!water && meta !== 8 && nm !== 8 && nm < meta && Math.random() < 0.75) this.schedule(x, y, z, (this.dim === 'nether' ? 10 : 30) * 4);
        this.setBlock(x, y, z, id, nm);
        meta = nm;
      }
    }
    // FlowingFluid.spread: down where it can (and then to the sides only with three sources beside it) ...
    const bid = this.getBlock(x, y - 1, z);
    if (y > 0 && (this.canFlowInto(bid) || bid === other) && (!wl || this.fluidPass(x, y, z, 2))) {
      if (bid === other) { this.setBlock(x, y - 1, z, water ? (this.getMeta(x, y - 1, z) === 0 ? 28 : 1) : 1, 0); if (this.listener) this.listener.onFizz(x, y - 1, z); }
      else { if (bid && this.listener) this.listener.onFluidDestroy(x, y - 1, z, bid, water); this.setBlock(x, y - 1, z, id, 8); }
      if (meta !== 0 || this.sourceNeighbors(id, x, y, z) < 3) return;
    } else if (bid === id && meta !== 0) return; // (a flow over the same fluid: that's a waterfall, not a puddle)
    // ... else to the sides, toward the nearest drop (getSpread)
    const lvl = (meta & 8) ? 0 : meta;
    if (lvl + drop >= 8) return;
    const slope = water || this.dim === 'nether' ? 4 : 2;
    let best = 1000; const pick = [], memo = new Map();
    for (let k = 0; k < 4; k++) {
      const d = FLUID_HDIRS[k], nx = x + d[0], nz = z + d[1], nid = this.getBlock(nx, y, nz);
      if (wl && !this.fluidPass(x, y, z, FLUID_HDIR_D[k])) continue;
      // canMaybePassThrough: not a source of this fluid, and a place a fluid can be (a flow of it counts but isn't overwritten)
      const same = nid === id;
      if (same ? this.getMeta(nx, y, nz) === 0 : !(this.canFlowInto(nid) || nid === other)) continue;
      const j = this.fluidHole(id, nx, y, nz) ? 0 : this.slopeDistance(id, nx, y, nz, 1, k ^ 2, slope, memo);
      if (j < best) { best = j; pick.length = 0; }
      if (j <= best && !same) pick.push(k);
    }
    for (const k of pick) {
      const d = FLUID_HDIRS[k], nx = x + d[0], nz = z + d[1], nid = this.getBlock(nx, y, nz);
      if (nid === other) { this.setBlock(nx, y, nz, water ? (this.getMeta(nx, y, nz) === 0 ? 28 : 4) : 1, 0); if (this.listener) this.listener.onFizz(nx, y, nz); continue; }
      const nm = this.newLiquid(id, nx, y, nz, water, drop);
      if (nm < 0) continue;
      if (nid && this.listener) this.listener.onFluidDestroy(nx, y, nz, nid, water);
      this.setBlock(nx, y, nz, id, nm);
    }
  }
  // a bubble column (vanilla BubbleColumnBlock, kept here as plain water): a water source with only water sources
  // between it and soul sand (1: up) or a magma block (-1: down) below; 0 otherwise. Worked out once a tick per place
  bubbleColumnAt(x, y, z) {
    if (this.getBlock(x, y, z) !== WATER || this.getMeta(x, y, z) !== 0 || BID.soul_sand === undefined) return 0;
    if (this._bcT !== this.time) { this._bcT = this.time; this._bc = new Map(); }
    const key = `${x},${y},${z}`;
    let r = this._bc.get(key);
    if (r !== undefined) return r;
    r = 0;
    for (let yy = y - 1; yy >= Math.max(0, y - 64); yy--) {
      const b = this.getBlock(x, yy, z);
      if (b === WATER && this.getMeta(x, yy, z) === 0) continue;
      r = b === BID.soul_sand ? 1 : b === BID.magma_block ? -1 : 0;
      break;
    }
    this._bc.set(key, r);
    return r;
  }
  // getNewLiquid: a source where water has two source neighbours over something solid or another source, a falling
  // column under the same fluid, else the strongest neighbour's amount less the drop (-1: none); levels as metas
  // (0 source, 1-7 flow, 8 falling)
  newLiquid(id, x, y, z, water, drop) {
    let amount = 0, sources = 0;
    for (let k = 0; k < 4; k++) {
      const d = FLUID_HDIRS[k];
      let m;
      if (this.getBlock(x + d[0], y, z + d[1]) === id) m = this.getMeta(x + d[0], y, z + d[1]);
      else if (water && this.isWaterlogged(x + d[0], y, z + d[1]) && this.fluidPass(x, y, z, FLUID_HDIR_D[k])) m = 0;
      else continue;
      if (m === 0) sources++;
      amount = Math.max(amount, m === 0 || (m & 8) ? 8 : 8 - (m & 7));
    }
    if (water && sources >= 2) {
      const below = this.getBlock(x, y - 1, z);
      if (BLOCKS[below].solid || (below === id && this.getMeta(x, y - 1, z) === 0)) return 0;
    }
    if (this.getBlock(x, y + 1, z) === id || (water && this.isWaterlogged(x, y + 1, z) && this.fluidPass(x, y, z, 3))) return 8;
    const k = amount - drop;
    return k <= 0 ? -1 : 8 - k;
  }
  sourceNeighbors(id, x, y, z) {
    let n = 0;
    for (const d of FLUID_HDIRS) {
      const nx = x + d[0], nz = z + d[1];
      if (this.getBlock(nx, y, nz) === id ? this.getMeta(nx, y, nz) === 0 : id === WATER && this.isWaterlogged(nx, y, nz)) n++;
    }
    return n;
  }
  // isWaterHole: the fluid could go down from there (the same fluid - a waterlogged block's too - or room for it, below)
  fluidHole(id, x, y, z) {
    const b = this.getBlock(x, y - 1, z);
    return y > 0 && (b === id || this.canFlowInto(b) || (id === WATER && this.isWaterlogged(x, y - 1, z) && this.fluidPass(x, y, z, 2)));
  }
  // getSlopeDistance: how many steps away the nearest hole is, up to `max`, never back through where the fluid comes
  // from; 1000 when none. Vanilla walks every path recursively; the shortest one is the same found breadth first,
  // each place once. Each place's "can the fluid go there / down from there" is worked out once per tick (vanilla's
  // SpreadContext)
  slopeDistance(id, x, y, z, depth, from, max, memo = new Map()) {
    const K = (a, b) => (a + 32768) * 65536 + b + 32768;
    const state = (nx, nz) => {
      const key = K(nx, nz);
      let s = memo.get(key);
      if (s === undefined) {
        const nid = this.getBlock(nx, y, nz);
        s = !(this.canFlowInto(nid) || (nid === id && this.getMeta(nx, y, nz) !== 0)) ? 0 : this.fluidHole(id, nx, y, nz) ? 2 : 1;
        memo.set(key, s);
      }
      return s;
    };
    const back = FLUID_HDIRS[from], seen = new Set([K(x, z), K(x + back[0], z + back[1])]);
    let front = [[x, z]];
    for (let dist = depth; dist <= max && front.length; dist++) {
      const next = [];
      for (const [cx, cz] of front) for (const d of FLUID_HDIRS) {
        const nx = cx + d[0], nz = cz + d[1], key = K(nx, nz);
        if (seen.has(key)) continue;
        seen.add(key);
        const s = state(nx, nz);
        if (s === 2) return dist;
        if (s === 1) next.push([nx, nz]);
      }
      front = next;
    }
    return 1000;
  }

  // ---- random ticks ----------------------------------------------------------
  // vanilla: 3 cells a section, each tick, in the chunks around the player (cmdrun.js random_tick_speed calls this more
  // or less often). Only blocks with a random tick reach the listener (its randomTickTable, 1 by id), and a section whose
  // palette holds none is passed over whole: its flag is kept on the section and made again when the palette changed
  // (grew, or was compacted into a new array). One xorshift a cell gives its 12 bits (three rng.int calls before).
  // The rates are the same: every section still gets its 3 uniform picks a tick, the ones skipped could do nothing
  // (measured: the picks per block kind as before, chi2 8.4 for 7; wheat, leaf decay, grass, ice the same over 8 x 3000)
  randomTick(px, pz, rng) {
    const L = this.listener;
    if (!L) return;
    const pcx = px >> 4, pcz = pz >> 4, RT = L.randomTickTable ? L.randomTickTable() : null;
    let r = this.rtSeed | 0;
    if (!r) r = ((rng() * 4294967296) | 0) || 1; // (seeded once from the game's generator)
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const ch = this.getChunk(pcx + dx, pcz + dz);
      if (!ch || !ch.lit) continue;
      for (let s = 0; s < SECTIONS; s++) {
        if (!ch.sectionCount[s]) continue;
        const b = ch.bs[s];
        if (RT && b && b.n >= 0) {
          if (b.rtP !== b.p || b.rtN !== b.n) {
            let any = 0;
            for (let k = 0, p = b.p; k < b.n; k++) if (RT[p[k]]) { any = 1; break; }
            b.rt = any; b.rtP = b.p; b.rtN = b.n;
          }
          if (!b.rt) continue;
        }
        for (let k = 0; k < 3; k++) {
          r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
          this.rtSeed = r; // (kept as it goes: a handler that throws must not make the next tick repeat these picks)
          const v = r >>> 20, lx = v & 15, lz = (v >> 4) & 15, ly = (s << 4) | (v >> 8);
          const id = ch.getB((ly << 8) | (lz << 4) | lx);
          if (id && (!RT || RT[id])) L.onRandomTick(ch.cx * 16 + lx, ly, ch.cz * 16 + lz, id, ch);
        }
      }
    }
  }
}
