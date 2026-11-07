'use strict';
// ---------------------------------------------------------------------------
// Chunk section mesher. Vertex layout (32 bytes):
//  0 pos f32x3 | 12 uv f32x2 | 20 layer u16, overlay u16 | 24 rgb+shade u8x4 | 28 sky u8, block u8, anim u8, pad
// ---------------------------------------------------------------------------
const VSTRIDE = 32;
const FACE_SHADE = [0.6, 0.6, 0.5, 1.0, 0.8, 0.8];
// vanilla: the nether has "constant ambient light", so tops and bottoms are both 0.9
function setFaceShade(dim) { const n = dim === 'nether'; FACE_SHADE[2] = n ? 0.9 : 0.5; FACE_SHADE[3] = n ? 0.9 : 1.0; }
// face corners (BL, BR, TR, TL as seen from outside) and uv
const FACES = [
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: (x, y, z) => [z, 1 - y] },
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: (x, y, z) => [1 - z, 1 - y] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: (x, y, z) => [x, 1 - z] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: (x, y, z) => [x, z] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: (x, y, z) => [1 - x, 1 - y] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: (x, y, z) => [x, 1 - y] },
];
// quadAO's tables, for face f and corner k (index f * 4 + k): the padded-index steps from the cell in front of the face to
// the corner's two edge neighbours, and the corner's uv, plain and turned (a log on its side). Meshing a section built
// four arrays a face and a uv pair a corner; it runs on the main thread while a world loads and after every block edit
const AO_D1 = new Int16Array(24), AO_D2 = new Int16Array(24), FACE_UV = new Float64Array(48), FACE_UVR = new Float64Array(48);
for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
  const F = FACES[f], n = F.n, c = F.c[k], i = f * 4 + k;
  let s1x = 0, s1y = 0, s1z = 0, s2x = 0, s2y = 0, s2z = 0;
  if (n[0]) { s1y = c[1] ? 1 : -1; s2z = c[2] ? 1 : -1; }
  else if (n[1]) { s1x = c[0] ? 1 : -1; s2z = c[2] ? 1 : -1; }
  else { s1x = c[0] ? 1 : -1; s2y = c[1] ? 1 : -1; }
  AO_D1[i] = s1y * 324 + s1z * 18 + s1x; AO_D2[i] = s2y * 324 + s2z * 18 + s2x;
  const uv = F.uv(c[0], c[1], c[2]);
  FACE_UV[i * 2] = uv[0]; FACE_UV[i * 2 + 1] = uv[1]; FACE_UVR[i * 2] = 1 - uv[1]; FACE_UVR[i * 2 + 1] = uv[0];
}
const AO_V = new Float64Array(4), AO_SK = new Float64Array(4), AO_BK = new Float64Array(4);
const VM_HAS = new Uint8Array(MAX_BLOCKS); // 0 not looked up yet, 1 no vanilla model, 2 one (Mesher.block)
// 图形品质 流畅 (vanilla's fast leaves): leaves are drawn solid (the overlay field's top bit tells the shaders
// to skip the alpha test) and the faces between two leaf blocks are left out - inside a canopy most of them
const LEAF_BLOCK = new Uint8Array(MAX_BLOCKS), SOLID_LEAF = 0x8000;
for (let i = 0; i < MAX_BLOCKS; i++) if (BLOCKS[i] && /leaves$/.test(BLOCKS[i].key)) LEAF_BLOCK[i] = 1;
let FAST_LEAVES = false;
function setFastLeaves(on) { FAST_LEAVES = !!on; }
// blocks that fill their whole footprint between two heights (farmland and paths 15/16, slabs, snow layers): a fluid
// leaves out what they cover of its faces, as vanilla's occlusion test does. Water's side was drawn in the plane of the
// farmland's and the two took turns on screen as the camera moved (feedback 2026-11-03: water edges flicker at farmland)
const FLAT_BOX = new Uint8Array(MAX_BLOCKS); // 1: 0..15/16, 2: a slab (meta & 3), 3: snow layers (meta & 7)
// translucent blocks other than fluids: meshed after a layer's water sides, their tops after its surfaces (Mesher.buildGathered)
const TRANS_LATE = new Uint8Array(MAX_BLOCKS);
// blocks a fluid's corner heights leave out (vanilla LiquidBlockRenderer.getHeight: -1 for a solid block - one that
// collides - not only full opaque cubes): next to ice, glass, leaves, farmland, slabs or fences the surface sloped down
// to the block, a step and a jagged edge along a frozen lake or a farm's water
const FLUID_WALL = new Uint8Array(MAX_BLOCKS);
for (let i = 0; i < MAX_BLOCKS; i++) {
  const b = BLOCKS[i]; if (!b) continue;
  if (b.key === 'farmland' || b.key === 'dirt_path') FLAT_BOX[i] = 1; else if (b.slab) FLAT_BOX[i] = 2; else if (b.key === 'snow') FLAT_BOX[i] = 3;
  if (b.render === 'translucent' && b.shape !== SH_LIQUID) TRANS_LATE[i] = 1;
  if (SOLIDCUBE[i] || (b.solid && b.shape !== SH_LIQUID)) FLUID_WALL[i] = 1;
}
// fluid faces sit this far inside their cell (vanilla 0.001; 1/256 lands on the 1/2048 position grid and keeps clear of a
// glass or leaf face in the same plane out to about 50 blocks with a 24-bit depth buffer)
const FLUID_INSET = 1 / 256;
const ANIM_FRAMES = new Uint8Array(4096);
function initAnimTable() {
  for (const k in ASSETS.anims) ANIM_FRAMES[ASSETS.tiles[k]] = ASSETS.anims[k];
}

class MeshBuffer {
  constructor(cap) { this.alloc(cap); this.n = 0; }
  alloc(cap) {
    const buf = new ArrayBuffer(cap * VSTRIDE);
    if (this.buf) new Uint8Array(buf).set(new Uint8Array(this.buf, 0, this.n * VSTRIDE));
    this.buf = buf; this.cap = cap;
    this.f = new Float32Array(buf); this.u16 = new Uint16Array(buf); this.u8 = new Uint8Array(buf);
  }
  reset() { this.n = 0; }
  append(o) { if (this.n + o.n > this.cap) this.alloc(Math.max(this.cap * 2, this.n + o.n)); this.u8.set(o.u8.subarray(0, o.n * VSTRIDE), this.n * VSTRIDE); this.n += o.n; }
  // o's quads that lie at or above height ymin (above), or the others
  appendQuads(o, ymin, above) {
    const f = o.f;
    for (let q = 0; q < o.n; q += 4) {
      const i = q * 8;
      if ((f[i + 1] >= ymin && f[i + 9] >= ymin && f[i + 17] >= ymin && f[i + 25] >= ymin) !== above) continue;
      if (this.n + 4 > this.cap) this.alloc(this.cap * 2);
      this.u8.set(o.u8.subarray(q * VSTRIDE, (q + 4) * VSTRIDE), this.n * VSTRIDE); this.n += 4;
    }
  }
  // push one vertex
  v(x, y, z, u, v, layer, overlay, r, g, b, shade, sky, blk, anim) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const o = this.n * 8, o16 = this.n * 16, o8 = this.n * 32;
    const f = this.f;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = u; f[o + 4] = v;
    this.u16[o16 + 10] = layer; this.u16[o16 + 11] = overlay;
    const u8 = this.u8;
    u8[o8 + 24] = r; u8[o8 + 25] = g; u8[o8 + 26] = b; u8[o8 + 27] = shade;
    u8[o8 + 28] = sky; u8[o8 + 29] = blk; u8[o8 + 30] = anim; u8[o8 + 31] = 0;
    this.n++;
  }
  slice() { return new Uint8Array(this.buf.slice(0, this.n * VSTRIDE)); }
}

// Terrain sections are stored compact on the GPU: 24 bytes a vertex instead of 32, in formats Direct3D 11 reads
// natively (ANGLE converts anything else into a hidden float copy): position as 4 x 16-bit normalised - fixed
// point 1/2048 block from the section origin - 8, placed by the section's model matrix, the 4th holding the
// animation frame count - uv as half floats, texture layers u16 x 2, colour + shade u8 x 4, light u8 x 2;
// every attribute 4-byte aligned. Dynamic meshes keep the float layout.
const SVSTRIDE = 24, SV_SCALE = 2048;
const _hf = new Float32Array(1), _hu = new Uint32Array(_hf.buffer);
function toHalf(v) {
  _hf[0] = v; const x = _hu[0];
  let bits = (x >> 16) & 0x8000, m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) return bits | 0x7c00;
  if (e < 113) { m |= 0x0800; return bits | ((m >> (114 - e)) + ((m >> (113 - e)) & 1)); }
  bits |= ((e - 112) << 10) | (m >> 1);
  return bits + (m & 1);
}
function compactVerts(mb, ox, oy, oz) {
  const n = mb.n, f = mb.f, s16 = mb.u16, s8 = mb.u8, s32 = new Uint32Array(mb.buf);
  const out = new ArrayBuffer(n * SVSTRIDE), o16 = new Uint16Array(out), o32 = new Uint32Array(out);
  for (let i = 0; i < n; i++) {
    const fi = i * 8, d16 = i * 12;
    let a = Math.round((f[fi] - ox + 8) * SV_SCALE); o16[d16] = a < 0 ? 0 : a > 65535 ? 65535 : a;
    a = Math.round((f[fi + 1] - oy + 8) * SV_SCALE); o16[d16 + 1] = a < 0 ? 0 : a > 65535 ? 65535 : a;
    a = Math.round((f[fi + 2] - oz + 8) * SV_SCALE); o16[d16 + 2] = a < 0 ? 0 : a > 65535 ? 65535 : a;
    o16[d16 + 3] = s8[i * 32 + 30];
    const u = f[fi + 3], v = f[fi + 4];
    o16[d16 + 4] = u === 1 ? 0x3c00 : toHalf(u); o16[d16 + 5] = v === 1 ? 0x3c00 : toHalf(v);
    // layer + overlay (bytes 20-23), colour + shade and the two light bytes (24-29): copied a word at a time
    o32[i * 6 + 3] = s32[i * 8 + 5]; o32[i * 6 + 4] = s32[i * 8 + 6]; o16[d16 + 10] = s16[i * 16 + 14];
  }
  return new Uint8Array(out);
}
// Vanilla's VisGraph: which faces of a section can see each other through cells that aren't full opaque
// cubes (the renderer walks this graph from the camera, so caves under the surface aren't drawn).
// Faces: 0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z (opposite = face ^ 1); one bit for each of the 15 face pairs.
const VIS_ALL = 0x7fff, VIS_PAIR = new Int8Array(36);
{ let k = 0; for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { VIS_PAIR[a * 6 + b] = VIS_PAIR[b * 6 + a] = k++; } }

const Mesher = {
  ids: new Uint16Array(18 * 18 * 18),
  metas: new Uint8Array(18 * 18 * 18),
  lights: new Uint8Array(18 * 18 * 18),
  tints: new Uint8Array(18 * 18 * 6), // grass rgb + foliage rgb per padded column
  opaqueBuf: new MeshBuffer(65536),
  transBuf: new MeshBuffer(16384),
  P(x, y, z) { return ((y + 1) * 18 + (z + 1)) * 18 + (x + 1); },

  // Fill padded arrays for section (cx, sy, cz)
  gather(world, cx, sy, cz) {
    setFaceShade(world.dim);
    const ids = this.ids, metas = this.metas, lights = this.lights, tints = this.tints;
    const skyDef = world.hasSky ? 0xF0 : 0;
    const y0 = sy * 16;
    let wls = null; // waterlogged cells (World.isWaterlogged), only when there are any
    for (let dcz = -1; dcz <= 1; dcz++) for (let dcx = -1; dcx <= 1; dcx++) {
      const ch = world.getChunk(cx + dcx, cz + dcz);
      const xa = dcx < 0 ? 15 : 0, xb = dcx > 0 ? 0 : 15, za = dcz < 0 ? 15 : 0, zb = dcz > 0 ? 0 : 15;
      if (ch && ch.wl && ch.wl.size) for (const i of ch.wl) {
        const py = (i >> 8) - y0, lz = (i >> 4) & 15, lx = i & 15;
        if (py < -1 || py > 16 || lx < xa || lx > xb || lz < za || lz > zb) continue;
        if (!wls) { wls = this.wlsBuf || (this.wlsBuf = new Uint8Array(18 * 18 * 18)); wls.fill(0); }
        wls[((py + 1) * 18 + (lz + dcz * 16 + 1)) * 18 + dcx * 16 + 1 + lx] = 1;
      }
      for (let lz = za; lz <= zb; lz++) for (let lx = xa; lx <= xb; lx++) {
        const px = lx + dcx * 16, pz = lz + dcz * 16;
        const ti = ((pz + 1) * 18 + (px + 1)) * 6;
        if (ch) {
          const ci = (lz * 16 + lx) * 3;
          tints[ti] = ch.grass[ci]; tints[ti + 1] = ch.grass[ci + 1]; tints[ti + 2] = ch.grass[ci + 2];
          tints[ti + 3] = ch.foliage[ci]; tints[ti + 4] = ch.foliage[ci + 1]; tints[ti + 5] = ch.foliage[ci + 2];
          (this.biomes || (this.biomes = new Uint8Array(18 * 18)))[(pz + 1) * 18 + (px + 1)] = ch.biome[lz * 16 + lx];
        }
      }
      // cells, a layer at a time with the layer's section arrays looked up once
      for (let py = -1; py <= 16; py++) {
        const y = y0 + py, s = y >> 4, row = (y & 15) << 8;
        const out = !ch || y < 0 || y >= HEIGHT;
        const B = out ? null : ch.bs[s], M = out ? null : ch.ms[s], L = out ? null : ch.ls[s];
        const P = B && B.p, D = B && B.d;
        const fid = y < 0 && world.dim !== 'end' ? 6 : 0; // below the world: bedrock (the End: void)
        const fl = out ? (y < 0 ? 0 : skyDef) : ch.lu[s];
        for (let lz = za; lz <= zb; lz++) {
          const pb = ((py + 1) * 18 + (lz + dcz * 16 + 1)) * 18 + dcx * 16 + 1, cb = row | (lz << 4);
          for (let lx = xa; lx <= xb; lx++) {
            const pi = pb + lx, i = cb | lx;
            ids[pi] = B ? P[D[i]] : fid; metas[pi] = M ? M[i] : 0; lights[pi] = L ? L[i] : fl;
          }
        }
      }
    }
    this.wls = wls;
  },

  tintOf(b, x, z) {
    const t = this.tints, ti = ((z + 1) * 18 + (x + 1)) * 6;
    if (b.tintRGB) return b.tintRGB;
    switch (b.tint) {
      case 'grass': return [t[ti], t[ti + 1], t[ti + 2]];
      case 'foliage': return [t[ti + 3], t[ti + 4], t[ti + 5]];
      case 'birch': return [128, 167, 85];
      case 'spruce': return [97, 153, 97];
      case 'water': return BIOME_WATER[this.biomes ? this.biomes[(z + 1) * 18 + (x + 1)] : 0] || BIOME_WATER_DEFAULT;
    }
    return [255, 255, 255];
  },

  build(world, cx, sy, cz) {
    this.gather(world, cx, sy, cz);
    return this.buildGathered(cx, sy, cz);
  },
  // the gathered arrays of a section, to mesh it in the chunk worker (load() puts them back there)
  snapshot(dim) {
    return { dim, ids: this.ids.slice(), metas: this.metas.slice(), lights: this.lights.slice(), tints: this.tints.slice(),
      biomes: this.biomes ? this.biomes.slice() : new Uint8Array(18 * 18), wls: this.wls ? this.wls.slice() : null };
  },
  load(s) {
    setFaceShade(s.dim);
    this.ids.set(s.ids); this.metas.set(s.metas); this.lights.set(s.lights); this.tints.set(s.tints);
    this.wls = s.wls || null;
    (this.biomes || (this.biomes = new Uint8Array(18 * 18))).set(s.biomes);
  },
  buildGathered(cx, sy, cz) {
    const ob = this.opaqueBuf, tb = this.transBuf, lb = this.lateBuf || (this.lateBuf = new MeshBuffer(4096)), sb = this.surfBuf || (this.surfBuf = new MeshBuffer(4096));
    ob.reset(); tb.reset(); lb.reset(); sb.reset();
    const ids = this.ids, wls = this.wls;
    const ox = cx * 16, oy = sy * 16, oz = cz * 16;
    this.surf = sb; // (liquid() puts the water surfaces there)
    try {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          const pi = ((y + 1) * 18 + (z + 1)) * 18 + (x + 1), id = ids[pi];
          if (!id) continue;
          // the translucent pass doesn't sort within a section: a layer's ice, stained glass and honey go after its water's
          // sides, so the water seen through them is under them, not drawn over them where it came later in the scan
          // (feedback 2026-11-03); the water surfaces after those, so what is under the surface stays under it seen across a
          // pond or into a hole in the ice (with the blocks after all the water the hole's walls showed dry, in front of
          // the water); last what lies above the surface (the tops). Right from above, as are the layers, bottom first
          if (TRANS_LATE[id]) { this.transBuf = lb; try { this.block(id, x, y, z, ox, oy, oz); } finally { this.transBuf = tb; } }
          else this.block(id, x, y, z, ox, oy, oz);
          if (wls && wls[pi]) this.liquid(BLOCKS[WATER], WATER, 0, x, y, z, ox, oy, oz); // (its water too)
        }
        if (lb.n || sb.n) { const top = oy + y + 8 / 9 - 1e-4; tb.appendQuads(lb, top, false); tb.append(sb); tb.appendQuads(lb, top, true); lb.reset(); sb.reset(); }
      }
    } finally { this.surf = null; }
    return { opaque: ob.n ? compactVerts(ob, ox, oy, oz) : null, trans: tb.n ? compactVerts(tb, ox, oy, oz) : null, nOpaque: ob.n, nTrans: tb.n, vis: this.visibility() };
  },
  // face-to-face visibility of the gathered section (flood fill of the non-opaque cells)
  visibility() {
    const ids = this.ids, seen = this.visSeen || (this.visSeen = new Uint8Array(4096)), q = this.visQ || (this.visQ = new Int16Array(4096));
    let open = 0;
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) {
      const p = ((y + 1) * 18 + (z + 1)) * 18 + 1, i = (y << 8) | (z << 4);
      for (let x = 0; x < 16; x++) { const s = SOLIDCUBE[ids[p + x]]; seen[i | x] = s; if (!s) open++; }
    }
    if (open === 0) return 0;
    if (4096 - open < 256) return VIS_ALL; // like vanilla: too few opaque blocks to bother
    let mask = 0;
    for (let start = 0; start < 4096; start++) {
      if (seen[start]) continue;
      let head = 0, tail = 0, faces = 0;
      q[tail++] = start; seen[start] = 1;
      while (head < tail) {
        const c = q[head++], x = c & 15, z = (c >> 4) & 15, y = c >> 8;
        if (x === 0) faces |= 1; else if (!seen[c - 1]) { seen[c - 1] = 1; q[tail++] = c - 1; }
        if (x === 15) faces |= 2; else if (!seen[c + 1]) { seen[c + 1] = 1; q[tail++] = c + 1; }
        if (y === 0) faces |= 4; else if (!seen[c - 256]) { seen[c - 256] = 1; q[tail++] = c - 256; }
        if (y === 15) faces |= 8; else if (!seen[c + 256]) { seen[c + 256] = 1; q[tail++] = c + 256; }
        if (z === 0) faces |= 16; else if (!seen[c - 16]) { seen[c - 16] = 1; q[tail++] = c - 16; }
        if (z === 15) faces |= 32; else if (!seen[c + 16]) { seen[c + 16] = 1; q[tail++] = c + 16; }
      }
      for (let a = 0; a < 6; a++) if (faces & (1 << a)) for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) mask |= 1 << VIS_PAIR[a * 6 + b];
      if (mask === VIS_ALL) break;
    }
    return mask;
  },

  // Mesh a single block at local (0,0,0) with full light (icons, dropped items, held blocks)
  single(id, meta, fullBright = true) {
    setFaceShade('overworld');
    this.ids.fill(0); this.metas.fill(0); this.lights.fill(fullBright ? 0xF0 : 0xF0);
    for (let i = 0; i < this.tints.length; i += 6) { this.tints.set([124, 189, 107, 89, 174, 48], i); }
    const p = this.P(0, 0, 0);
    this.ids[p] = id; this.metas[p] = meta;
    if (BLOCKS[id].door) { this.ids[this.P(0, 1, 0)] = 0; }
    const ob = this.opaqueBuf, tb = this.transBuf;
    ob.reset(); tb.reset();
    this.block(id, 0, 0, 0, 0, 0, 0, true);
    const out = new MeshBuffer(ob.n + tb.n + 4);
    out.u8.set(ob.u8.subarray(0, ob.n * VSTRIDE), 0);
    out.u8.set(tb.u8.subarray(0, tb.n * VSTRIDE), ob.n * VSTRIDE);
    out.n = ob.n + tb.n;
    return out;
  },

  block(id, x, y, z, ox, oy, oz, single) {
    const b = BLOCKS[id];
    if (b.beRender && !single) return;
    // barriers (and light blocks): nothing to see in the world, only their boxes to bump into - the barrier showed as a
    // white block (players' feedback 2026-10-31)
    if (b.be === 'invisible' && !single) return;
    const meta = this.metas[this.P(x, y, z)];
    if (WLOG[id] && !single) this.liquid(BLOCKS[WATER], WATER, 0, x, y, z, ox, oy, oz, false);
    // (whether vanilla models draw it, looked up by name once a block: 9 % of meshing time went to the lookup)
    let vm = VM_HAS[id];
    if (!vm) { vm = !VM.ready ? 0 : VM.has(b.key) ? 2 : 1; VM_HAS[id] = vm; }
    if (vm === 2 && this.vmodel(b, meta, x, y, z, ox, oy, oz, single)) return;
    switch (b.shape) {
      case SH_CUBE: this.cube(b, id, meta, x, y, z, ox, oy, oz, single); break;
      case SH_CROSS: this.cross(b, meta, x, y, z, ox, oy, oz, single); break;
      case SH_CROP: this.crop(b, meta, x, y, z, ox, oy, oz); break;
      case SH_LIQUID: this.liquid(b, id, meta, x, y, z, ox, oy, oz, single); break;
      case SH_BOXES: this.boxes(b, id, meta, x, y, z, ox, oy, oz, single); break;
      case SH_TORCH: this.torch(b, meta, x, y, z, ox, oy, oz); break;
      case SH_CACTUS: this.cactus(b, meta, x, y, z, ox, oy, oz); break;
      case SH_MODEL: this.modelShape(b, meta, x, y, z, ox, oy, oz, single); break;
      case SH_FIRE: this.fire(b, meta, x, y, z, ox, oy, oz); break;
    }
  },

  texOf(b, face, meta) { return b.texFn ? b.texFn.call(b, face, meta) : b.tex[face]; },

  cube(b, id, meta, x, y, z, ox, oy, oz, single) {
    const ids = this.ids, lights = this.lights;
    const buf = b.render === 'translucent' ? this.transBuf : this.opaqueBuf;
    let tint = b.tint ? this.tintOf(b, x, z) : null;
    const fast = FAST_LEAVES && !single && LEAF_BLOCK[id];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], n = F.n;
      const nid = ids[this.P(x + n[0], y + n[1], z + n[2])];
      if (SOLIDCUBE[nid]) continue;
      if (b.cullSame && nid === id) continue;
      if (fast && LEAF_BLOCK[nid]) continue;
      // a translucent cube's faces against a fluid are drawn, as in vanilla: leaving them all out showed the water's side in
      // place of the ice's (feedback 2026-11-03「冰紧挨水的那一面缺失 / 被画成水的贴图」, 6 reports; packed and blue ice are
      // opaque, so only ice had it). Not the bottom over a fluid with air above: from below the top face shows through (the
      // translucent pass draws both sides), and over a frozen ocean it would be one more see-through layer across the screen
      if (f === 2 && b.render === 'translucent' && IS_FLUID[nid] && !ids[this.P(x, y + 1, z)]) continue;
      if (b.render === 'translucent' && BLOCKS[nid].render === 'translucent' && SOLIDCUBE[nid] === 0 && nid !== 0 && BLOCKS[nid].shape === SH_CUBE && id !== 35) continue;
      let layer = this.texOf(b, f, meta);
      let overlay = fast ? SOLID_LEAF : b.overlay[f];
      let r = 255, g = 255, bl = 255;
      if (id === 2) {
        if ((meta & 1) && f !== 2 && f !== 3) overlay = 0;
        else if (f === 3) { r = tint[0]; g = tint[1]; bl = tint[2]; }
        // side: base untinted, overlay tinted (shader uses rgb for overlay when overlay present)
        if (overlay) { r = tint[0]; g = tint[1]; bl = tint[2]; }
      } else if (tint) { r = tint[0]; g = tint[1]; bl = tint[2]; }
      const rot = b.axis && (meta & 3) ? this.axisRot(meta & 3, f) : 0;
      this.quadAO(buf, F, x, y, z, ox, oy, oz, layer, overlay, r, g, bl, f, rot, single);
    }
  },

  axisRot(a, f) {
    if (a === 1) return (f === 0 || f === 1) ? 0 : 1; // x-axis log: rotate side textures on y/z faces
    if (a === 2) return (f === 4 || f === 5) ? 0 : (f === 2 || f === 3 ? 0 : 1);
    return 0;
  },

  // Quad with smooth lighting + ambient occlusion
  quadAO(buf, F, x, y, z, ox, oy, oz, layer, overlay, r, g, bl, f, rot, single) {
    const ids = this.ids, lights = this.lights, n = F.n, ao = AO_V, sk = AO_SK, bk = AO_BK;
    const p0 = this.P(x + n[0], y + n[1], z + n[2]), l0 = lights[p0];
    const anim = ANIM_FRAMES[layer];
    // vanilla AO: each corner averages four "shade brightness" samples (1.0 open, 0.2 for a
    // full-collision cube): the block in front of the face, the two edge blocks and the corner block.
    // A face buried inside leaves therefore gets as dark as 0.2, which gives canopies their depth.
    const front = single ? 0 : AOCUBE[ids[p0]];
    for (let k = 0; k < 4; k++) {
      // the corner's two edge neighbours and the one diagonal to it, in the layer in front of the face
      const d2 = AO_D2[f * 4 + k], p1 = p0 + AO_D1[f * 4 + k], p2 = p0 + d2, p3 = p1 + d2;
      const i1 = ids[p1], i2 = ids[p2], o1 = SOLIDCUBE[i1], o2 = SOLIDCUBE[i2], o3 = SOLIDCUBE[ids[p3]];
      const a1 = AOCUBE[i1], a2 = AOCUBE[i2], a3 = (a1 && a2) ? 1 : AOCUBE[ids[p3]];
      ao[k] = single ? 1 : (4 - (front + a1 + a2 + a3) * 0.8) / 4;
      let ls = l0 >> 4, lb = l0 & 15, cnt = 1;
      if (!o1) { ls += lights[p1] >> 4; lb += lights[p1] & 15; cnt++; }
      if (!o2) { ls += lights[p2] >> 4; lb += lights[p2] & 15; cnt++; }
      if (!o3 && !(o1 && o2)) { ls += lights[p3] >> 4; lb += lights[p3] & 15; cnt++; }
      sk[k] = ls / cnt; bk[k] = lb / cnt;
    }
    const shade = FACE_SHADE[f], uvs = rot ? FACE_UVR : FACE_UV;
    // start at corner 1 (the other diagonal) when that one is the brighter pair
    const k0 = (ao[0] + ao[2] + (sk[0] + sk[2]) * 0.003 < ao[1] + ao[3] + (sk[1] + sk[3]) * 0.003) ? 1 : 0;
    for (let j = 0; j < 4; j++) {
      const k = (j + k0) & 3, c = F.c[k], u = (f * 4 + k) * 2;
      buf.v(ox + x + c[0], oy + y + c[1], oz + z + c[2], uvs[u], uvs[u + 1], layer, overlay, r, g, bl,
        Math.round(shade * ao[k] * 255), Math.round(sk[k] * 17), Math.round(bk[k] * 17), anim);
    }
  },

  // Flat-lit quad from explicit corners (array of 4 [x,y,z,u,v])
  quadFlat(buf, pts, layer, overlay, r, g, bl, shade, light, anim = 0) {
    const s = Math.round((light >> 4) * 17), k = Math.round((light & 15) * 17), sh = Math.round(shade * 255);
    for (const p of pts) buf.v(p[0], p[1], p[2], p[3], p[4], layer, overlay, r, g, bl, sh, s, k, anim);
  },

  cross(b, meta, x, y, z, ox, oy, oz, single) {
    const buf = this.opaqueBuf, light = this.lights[this.P(x, y, z)];
    const layer = this.texOf(b, 0, meta);
    const t = b.tint ? this.tintOf(b, x, z) : [255, 255, 255];
    let jx = 0, jz = 0;
    if (!single && (b.key === 'short_grass' || b.key === 'fern' || FLOWER_IDS.includes(b.id))) {
      const h = hash3(ox + x, oy + y, oz + z, 99);
      jx = (h - 0.5) * 0.4; jz = (hash3(oz + z, ox + x, oy + y, 7) - 0.5) * 0.4;
    }
    const X = ox + x + jx, Y = oy + y, Z = oz + z + jz, d = 0.15, e = 0.85;
    const quads = [
      [[X + d, Y, Z + d, 0, 1], [X + e, Y, Z + e, 1, 1], [X + e, Y + 1, Z + e, 1, 0], [X + d, Y + 1, Z + d, 0, 0]],
      [[X + e, Y, Z + e, 0, 1], [X + d, Y, Z + d, 1, 1], [X + d, Y + 1, Z + d, 1, 0], [X + e, Y + 1, Z + e, 0, 0]],
      [[X + d, Y, Z + e, 0, 1], [X + e, Y, Z + d, 1, 1], [X + e, Y + 1, Z + d, 1, 0], [X + d, Y + 1, Z + e, 0, 0]],
      [[X + e, Y, Z + d, 0, 1], [X + d, Y, Z + e, 1, 1], [X + d, Y + 1, Z + e, 1, 0], [X + e, Y + 1, Z + d, 0, 0]],
    ];
    for (const q of quads) this.quadFlat(buf, q, layer, 0, t[0], t[1], t[2], 0.9, light);
  },

  crop(b, meta, x, y, z, ox, oy, oz) {
    const buf = this.opaqueBuf, light = this.lights[this.P(x, y, z)];
    const layer = this.texOf(b, 0, meta);
    const X = ox + x, Y = oy + y - 1 / 16, Z = oz + z;
    for (const o of [0.25, 0.75]) {
      for (const flip of [0, 1]) {
        const a = flip ? 1 : 0, c = flip ? 0 : 1;
        this.quadFlat(buf, [[X + o, Y, Z + a, 0, 1], [X + o, Y, Z + c, 1, 1], [X + o, Y + 1, Z + c, 1, 0], [X + o, Y + 1, Z + a, 0, 0]], layer, 0, 255, 255, 255, 0.85, light);
        this.quadFlat(buf, [[X + c, Y, Z + o, 0, 1], [X + a, Y, Z + o, 1, 1], [X + a, Y + 1, Z + o, 1, 0], [X + c, Y + 1, Z + o, 0, 0]], layer, 0, 255, 255, 255, 0.85, light);
      }
    }
  },

  // vanilla LiquidBlockRenderer.getHeight: this fluid -> 1 under the same fluid, else its own height (amount / 9: a source
  // or falling column 8/9, a flow of level L (8 - L) / 9); not this fluid -> 0 if the block isn't solid, -1 if it is
  fluidHeight(id, x, y, z) {
    const wls = this.wls, p = this.P(x, y, z), same = (q) => this.ids[q] === id || (id === WATER && (WLOG[this.ids[q]] || (wls && wls[q])));
    if (!same(p)) return FLUID_WALL[this.ids[p]] ? -1 : 0;
    if (same(this.P(x, y + 1, z))) return 1;
    if (WLOG[this.ids[p]] || (wls && wls[p])) return 8 / 9;
    const m = this.metas[p];
    return m === 0 || (m & 8) ? 8 / 9 : (8 - m) / 9;
  },
  // calculateAverageHeight for the corner (x + dx, z + dz), dx, dz in {0, 1}: this column, the two beside the corner
  // and (when either of those holds some) the diagonal one, heights from 0.8 up weighing ten times as much - so a
  // lake's shore stays nearly full instead of sloping to a quarter
  cornerHeight(id, x, y, z, dx, dz) {
    const sx = dx ? 1 : -1, sz = dz ? 1 : -1;
    const f = this.fluidHeight(id, x, y, z), h1 = this.fluidHeight(id, x, y, z + sz), h2 = this.fluidHeight(id, x + sx, y, z);
    if (h1 >= 1 || h2 >= 1) return 1;
    let sum = 0, w = 0;
    const add = (h) => { if (h >= 0.8) { sum += h * 10; w += 10; } else if (h >= 0) { sum += h; w++; } };
    if (h1 > 0 || h2 > 0) { const d = this.fluidHeight(id, x + sx, y, z + sz); if (d >= 1) return 1; add(d); }
    add(f); add(h2); add(h1);
    return w ? sum / w : f;
  },

  liquid(b, id, meta, x, y, z, ox, oy, oz, single) {
    const buf = b.render === 'translucent' ? this.transBuf : this.opaqueBuf;
    const ids = this.ids, layer = b.tex[0], anim = ANIM_FRAMES[layer];
    const t = b.tint ? this.tintOf(b, x, z) : [255, 255, 255];
    // the same fluid there (a waterlogged block counts as water: pass its padded index)
    const wls = this.wls, same = (n, p) => n === id || (id === WATER && (WLOG[n] || (p !== undefined && wls && wls[p])));
    const pAbove = this.P(x, y + 1, z), above = ids[pAbove];
    let h00, h10, h01, h11;
    if (same(above, pAbove) || single) h00 = h10 = h01 = h11 = single ? 0.889 : 1;
    else {
      h00 = this.cornerHeight(id, x, y, z, 0, 0); h10 = this.cornerHeight(id, x, y, z, 1, 0);
      h01 = this.cornerHeight(id, x, y, z, 0, 1); h11 = this.cornerHeight(id, x, y, z, 1, 1);
    }
    const X = ox + x, Y = oy + y, Z = oz + z;
    const L = (dx, dy, dz) => this.lights[this.P(x + dx, y + dy, z + dz)];
    const own = this.lights[this.P(x, y, z)];
    const lmax = (a, c) => (Math.max(a >> 4, c >> 4) << 4) | Math.max(a & 15, c & 15);
    const E = FLUID_INSET, selfBox = single ? -1 : this.flatBox(ids[this.P(x, y, z)], this.metas[this.P(x, y, z)]); // (a waterlogged slab)
    // top: not when it would lie flush under a cube or a flat box's bottom (vanilla: occluded by the neighbour)
    const capped = !single && h00 >= 1 && h10 >= 1 && h01 >= 1 && h11 >= 1 && (SOLIDCUBE[above] || (this.flatBox(above, this.metas[pAbove]) & 31) === 0);
    if (!same(above, pAbove) && !capped) {
      const l = lmax(L(0, 1, 0), own), sbuf = !single && this.surf && b.render === 'translucent' ? this.surf : buf; // (buildGathered)
      const e = 0.001;
      this.quadFlat(sbuf, [[X, Y + h00 - e, Z, 0, 0], [X, Y + h01 - e, Z + 1, 0, 1], [X + 1, Y + h11 - e, Z + 1, 1, 1], [X + 1, Y + h10 - e, Z, 1, 0]], layer, 0, t[0], t[1], t[2], 1, l, anim);
      if (b.render === 'translucent') // underside visible from below the surface
        this.quadFlat(sbuf, [[X + 1, Y + h10 - e, Z, 1, 0], [X + 1, Y + h11 - e, Z + 1, 1, 1], [X, Y + h01 - e, Z + 1, 0, 1], [X, Y + h00 - e, Z, 0, 0]], layer, 0, t[0], t[1], t[2], 0.8, l, anim);
    }
    // bottom (a little above the floor, out of the plane of a glass or leaf top below; not over a flat box's top)
    const pBelow = this.P(x, y - 1, z), below = ids[pBelow];
    if (!same(below, pBelow) && !SOLIDCUBE[below] && (this.flatBox(below, this.metas[pBelow]) >> 5) !== 16 && (selfBox < 0 || (selfBox & 31) !== 0)) {
      const yb = Y + (single ? 0 : E);
      this.quadFlat(buf, [[X, yb, Z, 0, 0], [X + 1, yb, Z, 1, 0], [X + 1, yb, Z + 1, 1, 1], [X, yb, Z + 1, 0, 1]], layer, 0, t[0], t[1], t[2], 0.5, lmax(L(0, -1, 0), own), anim);
    }
    // sides, inset (vanilla: 0.001) so they don't share a plane with the face of a glass, leaf, slab or stair beside them
    // [face, dx, dz, BL(x,z), BR(x,z), height at BR, height at BL]
    const e = single ? 0 : E;
    const sides = [
      [0, -1, 0, X + e, Z, X + e, Z + 1, h01, h00],
      [1, 1, 0, X + 1 - e, Z + 1, X + 1 - e, Z, h10, h11],
      [4, 0, -1, X + 1, Z + e, X, Z + e, h00, h10],
      [5, 0, 1, X, Z + 1 - e, X + 1, Z + 1 - e, h11, h01],
    ];
    for (const [f, dx, dz, ax, az, bx, bz, hb, ha] of sides) {
      const pn = this.P(x + dx, y, z + dz), nid = ids[pn];
      if (same(nid, pn) || SOLIDCUBE[nid]) continue;
      // what a flat box beside it (or the waterlogged block itself) leaves showing: above lo, below cap
      let lo = 0, cap = 1;
      for (let k = 0; k < 2; k++) {
        const c = k ? selfBox : this.flatBox(nid, this.metas[pn]);
        if (c < 0) continue;
        if ((c & 31) === 0) lo = Math.max(lo, (c >> 5) / 16); else if ((c >> 5) === 16) cap = Math.min(cap, (c & 31) / 16);
      }
      const hmin = Math.min(ha, hb);
      if (lo >= Math.max(ha, hb) || cap <= lo) continue; // farmland beside a source, a double slab
      // the bottom raised to the box's top (no higher than the lower end, so nothing that shows is cut), the top
      // lowered to a top slab's underside when both ends reach it
      const y0 = Math.min(lo, hmin), ta = cap <= hmin ? cap : ha, tb2 = cap <= hmin ? cap : hb;
      const q = [[ax, Y + y0, az, 0, 1 - y0], [bx, Y + y0, bz, 1, 1 - y0], [bx, Y + tb2, bz, 1, 1 - tb2], [ax, Y + ta, az, 0, 1 - ta]];
      this.quadFlat(buf, q, layer, 0, t[0], t[1], t[2], FACE_SHADE[f], lmax(L(dx, 0, dz), own), anim);
    }
  },
  // the vertical extent of a block that fills its whole footprint between two heights (FLAT_BOX), in 16ths: bottom
  // + top * 32, or -1
  flatBox(id, m) {
    switch (FLAT_BOX[id]) {
      case 1: return 15 << 5;
      case 2: return (m & 3) === 0 ? 8 << 5 : (m & 3) === 1 ? 8 | (16 << 5) : 16 << 5;
      case 3: return (2 * ((m & 7) + 1)) << 5;
    }
    return -1;
  },

  boxes(b, id, meta, x, y, z, ox, oy, oz, single) {
    const buf = b.render === 'translucent' ? this.transBuf : this.opaqueBuf;
    const ids = this.ids, lights = this.lights;
    const own = lights[this.P(x, y, z)];
    const tint = b.tint ? this.tintOf(b, x, z) : [255, 255, 255];
    let list;
    if (b.fence) {
      const con = (nid) => SOLIDCUBE[nid] || (BLOCKS[nid] && BLOCKS[nid].fence === b.fence);
      let m = 0;
      if (con(ids[this.P(x - 1, y, z)])) m |= 1; if (con(ids[this.P(x + 1, y, z)])) m |= 2;
      if (con(ids[this.P(x, y, z - 1)])) m |= 4; if (con(ids[this.P(x, y, z + 1)])) m |= 8;
      list = b.boxes(single ? 3 : m);
    } else list = b.boxes(meta);
    for (const bx of list) {
      const x0 = bx[0] / 16, y0 = bx[1] / 16, z0 = bx[2] / 16, x1 = bx[3] / 16, y1 = bx[4] / 16, z1 = bx[5] / 16;
      for (let f = 0; f < 6; f++) {
        const n = FACES[f].n;
        const onEdge = (f === 0 && x0 === 0) || (f === 1 && x1 === 1) || (f === 2 && y0 === 0) || (f === 3 && y1 === 1) || (f === 4 && z0 === 0) || (f === 5 && z1 === 1);
        let light = own;
        if (onEdge) {
          const nid = ids[this.P(x + n[0], y + n[1], z + n[2])];
          if (SOLIDCUBE[nid] && !single) continue;
          if (nid === id && b.cullSame) continue;
          light = lights[this.P(x + n[0], y + n[1], z + n[2])];
          if (SOLIDCUBE[nid]) light = own;
        }
        if (b.slab && (meta & 3) === 2 && !onEdge) continue;
        if (single) light = 0xF0;
        const layer = bx[6] !== undefined ? bx[6] : this.texOf(b, f, meta);
        const anim = ANIM_FRAMES[layer];
        const pts = FACES[f].c.map(c => {
          const px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
          const uv = FACES[f].uv(px, py, pz);
          return [ox + x + px, oy + y + py, oz + z + pz, uv[0], uv[1]];
        });
        this.quadFlat(buf, pts, layer, 0, tint[0], tint[1], tint[2], FACE_SHADE[f], light, anim);
      }
    }
  },

  modelShape(b, meta, x, y, z, ox, oy, oz, single) {
    const buf = this.opaqueBuf, ids = this.ids, lights = this.lights;
    const own = lights[this.P(x, y, z)];
    const { els, rot } = b.model(meta);
    const FN = { west: 0, east: 1, down: 2, up: 3, north: 4, south: 5 };
    const rotDir = [[0, 1, 2, 3, 4, 5], [4, 5, 2, 3, 1, 0], [1, 0, 2, 3, 5, 4], [5, 4, 2, 3, 0, 1]][rot]; // model face -> world face
    const rp = (px, pz) => { // rotate point around block centre, clockwise seen from above
      for (let k = 0; k < rot; k++) { const t = px; px = 1 - pz; pz = t; }
      return [px, pz];
    };
    for (const e of els) {
      const x0 = e.from[0] / 16, y0 = e.from[1] / 16, z0 = e.from[2] / 16, x1 = e.to[0] / 16, y1 = e.to[1] / 16, z1 = e.to[2] / 16;
      for (const fname in e.faces) {
        const f = FN[fname], [u0, v0, u1, v1, layer] = e.faces[fname];
        const wf = rotDir[f];
        const n = FACES[wf].n;
        const onEdge = (f === 0 && x0 === 0) || (f === 1 && x1 === 1) || (f === 2 && y0 === 0) || (f === 3 && y1 === 1) || (f === 4 && z0 === 0) || (f === 5 && z1 === 1);
        let light = own;
        if (onEdge && !single) {
          const nid = ids[this.P(x + n[0], y + n[1], z + n[2])];
          if (SOLIDCUBE[nid]) continue;
          light = lights[this.P(x + n[0], y + n[1], z + n[2])];
        }
        if (single) light = 0xF0;
        const pts = FACES[f].c.map((c) => {
          const px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
          const U = FACES[f].uv(c[0], c[1], c[2]);
          const [rx, rz] = rp(px, pz);
          return [ox + x + rx, oy + y + py, oz + z + rz, (u0 + U[0] * (u1 - u0)) / 16, (v0 + U[1] * (v1 - v0)) / 16];
        });
        this.quadFlat(buf, pts, layer, 0, 255, 255, 255, FACE_SHADE[wf], light);
      }
    }
  },

  // several blocks at given local offsets (icons for multi-block items)
  multi(list) {
    this.ids.fill(0); this.metas.fill(0); this.lights.fill(0xF0);
    for (const [id, meta, x, y, z] of list) { const p = this.P(x, y, z); this.ids[p] = id; this.metas[p] = meta; }
    const ob = this.opaqueBuf; ob.reset(); this.transBuf.reset();
    for (const [id, meta, x, y, z] of list) this.block(id, x, y, z, 0, 0, 0, true);
    const out = new MeshBuffer(ob.n + 4);
    out.u8.set(ob.u8.subarray(0, ob.n * VSTRIDE), 0); out.n = ob.n;
    return out;
  },

  fire(b, meta, x, y, z, ox, oy, oz) {
    const buf = this.opaqueBuf, light = 0xFF;
    const L0 = T('fire_0'), L1 = T('fire_1'), a0 = ANIM_FRAMES[L0], a1 = ANIM_FRAMES[L1];
    const X = ox + x, Y = oy + y, Z = oz + z, h = 1.4, k = 0.3, e = 0.01;
    const q = (pts, layer, anim) => { this.quadFlat(buf, pts, layer, 0, 255, 255, 255, 1, light, anim); this.quadFlat(buf, [pts[1], pts[0], pts[3], pts[2]].map(p => [p[0], p[1], p[2], p[3], p[4]]), layer, 0, 255, 255, 255, 1, light, anim); };
    // four leaning planes near the block edges + two crossing planes
    q([[X + e, Y, Z, 0, 1], [X + e, Y, Z + 1, 1, 1], [X + e + k, Y + h, Z + 1, 1, 0], [X + e + k, Y + h, Z, 0, 0]], L0, a0);
    q([[X + 1 - e, Y, Z + 1, 0, 1], [X + 1 - e, Y, Z, 1, 1], [X + 1 - e - k, Y + h, Z, 1, 0], [X + 1 - e - k, Y + h, Z + 1, 0, 0]], L1, a1);
    q([[X + 1, Y, Z + e, 0, 1], [X, Y, Z + e, 1, 1], [X, Y + h, Z + e + k, 1, 0], [X + 1, Y + h, Z + e + k, 0, 0]], L1, a1);
    q([[X, Y, Z + 1 - e, 0, 1], [X + 1, Y, Z + 1 - e, 1, 1], [X + 1, Y + h, Z + 1 - e - k, 1, 0], [X, Y + h, Z + 1 - e - k, 0, 0]], L0, a0);
    q([[X, Y, Z + 0.5, 0, 1], [X + 1, Y, Z + 0.5, 1, 1], [X + 1, Y + h, Z + 0.5, 1, 0], [X, Y + h, Z + 0.5, 0, 0]], L0, a0);
    q([[X + 0.5, Y, Z + 1, 0, 1], [X + 0.5, Y, Z, 1, 1], [X + 0.5, Y + h, Z, 1, 0], [X + 0.5, Y + h, Z + 1, 0, 0]], L1, a1);
  },

  cactus(b, meta, x, y, z, ox, oy, oz) {
    const buf = this.opaqueBuf, light = this.lights[this.P(x, y, z)];
    const X = ox + x, Y = oy + y, Z = oz + z, i = 1 / 16;
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], n = F.n;
      if ((f === 2 || f === 3) && SOLIDCUBE[this.ids[this.P(x + n[0], y + n[1], z + n[2])]]) continue;
      if ((f === 3 || f === 2) && this.ids[this.P(x + n[0], y + n[1], z + n[2])] === b.id) continue;
      const pts = F.c.map(c => {
        let px = c[0], py = c[1], pz = c[2];
        if (f === 0) px = i; if (f === 1) px = 1 - i; if (f === 4) pz = i; if (f === 5) pz = 1 - i;
        const uv = F.uv(c[0], c[1], c[2]);
        return [X + px, Y + py, Z + pz, uv[0], uv[1]];
      });
      this.quadFlat(buf, pts, b.tex[f], 0, 255, 255, 255, FACE_SHADE[f], light);
    }
  },

  torch(b, meta, x, y, z, ox, oy, oz) {
    const buf = this.opaqueBuf, light = 0xF0 | 14 | (this.lights[this.P(x, y, z)] & 0xF0);
    const layer = b.tex[0];
    const X = ox + x + 0.5, Z = oz + z + 0.5;
    let bx = 0, bz = 0, by = 0, lean = 0, lx = 0, lz = 0;
    if (meta) {
      const D = DIRS[meta];
      bx = D[0] * 0.38; bz = D[2] * 0.38; by = 0.2; lean = 0.32; lx = -D[0]; lz = -D[2];
    }
    const Y = oy + y + by;
    const w = 1 / 16, h = 10 / 16;
    const P = (px, py, pz) => [X + bx + px + lx * lean * py / h * 0.6, Y + py, Z + bz + pz + lz * lean * py / h * 0.6];
    const u0 = 7 / 16, u1 = 9 / 16, v0 = 6 / 16, v1 = 1;
    const sides = [
      [[-w, 0, -w], [-w, 0, w], [-w, h, w], [-w, h, -w], 0],
      [[w, 0, w], [w, 0, -w], [w, h, -w], [w, h, w], 1],
      [[w, 0, -w], [-w, 0, -w], [-w, h, -w], [w, h, -w], 4],
      [[-w, 0, w], [w, 0, w], [w, h, w], [-w, h, w], 5],
    ];
    for (const s of sides) {
      const pts = [[...P(...s[0]), u0, v1], [...P(...s[1]), u1, v1], [...P(...s[2]), u1, v0], [...P(...s[3]), u0, v0]];
      this.quadFlat(buf, pts, layer, 0, 255, 255, 255, FACE_SHADE[s[4]], light);
    }
    const top = [[...P(-w, h, -w), u0, 8 / 16], [...P(-w, h, w), u0, 6 / 16], [...P(w, h, w), u1, 6 / 16], [...P(w, h, -w), u1, 8 / 16]];
    this.quadFlat(buf, top, layer, 0, 255, 255, 255, 1, light);
    const bot = [[...P(-w, 0, -w), u0, 1], [...P(w, 0, -w), u1, 1], [...P(w, 0, w), u1, 14 / 16], [...P(-w, 0, w), u0, 14 / 16]];
    this.quadFlat(buf, bot, layer, 0, 255, 255, 255, 0.5, light);
  },
};

// Extruded item sprite mesh (for held items and dropped items). Returns MeshBuffer in 0..1 xy, z in [-1/32,1/32]
const ItemMeshCache = new Map();
let _spriteAlpha = null;
// main tile layer -> the first of its four full-size quarters (a 32 x 32 sprite: tools/build_assets.py)
let HI_SPRITES = null;
function itemSpriteMesh(layer) {
  if (ItemMeshCache.has(layer)) return ItemMeshCache.get(layer);
  if (!HI_SPRITES) { HI_SPRITES = new Map(); const h = (typeof ASSETS !== 'undefined' && ASSETS.hi) || {}; for (const k in h) HI_SPRITES.set(ASSETS.tiles[k], h[k]); }
  const a = _spriteAlpha, hi = HI_SPRITES.get(layer);
  // N pixels a side, each pixel in a 16 x 16 tile (a 32 x 32 sprite: its quarter, top left, top right, bottom left, bottom right)
  const N = hi !== undefined ? 32 : 16, tileOf = (x, y) => (hi !== undefined ? hi + ((y >> 4) << 1) + (x >> 4) : layer);
  const buf = new MeshBuffer(N === 32 ? 2048 : 512);
  const t = 1 / 32, px = 1 / N;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < N && y < N && a[tileOf(x, y) * 256 + (y & 15) * 16 + (x & 15)] > 0;
  const V = (x, y, z, u, v, sh, l = layer) => buf.v(x, y, z, u, v, l, 0, 255, 255, 255, Math.round(sh * 255), 255, 0, 0);
  // front (+z) and back: one square, or one per quarter
  const faces = (x0, y0, s, l) => {
    V(x0, y0, t, 0, 1, 1, l); V(x0 + s, y0, t, 1, 1, 1, l); V(x0 + s, y0 + s, t, 1, 0, 1, l); V(x0, y0 + s, t, 0, 0, 1, l);
    V(x0 + s, y0, -t, 1, 1, 0.8, l); V(x0, y0, -t, 0, 1, 0.8, l); V(x0, y0 + s, -t, 0, 0, 0.8, l); V(x0 + s, y0 + s, -t, 1, 0, 0.8, l);
  };
  if (hi === undefined) faces(0, 0, 1, layer);
  else for (let q = 0; q < 4; q++) faces((q & 1) * 0.5, (q >> 1) ? 0 : 0.5, 0.5, hi + q);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!opaque(x, y)) continue;
    const X0 = x * px, X1 = (x + 1) * px, Y1 = 1 - y * px, Y0 = 1 - (y + 1) * px, l = tileOf(x, y);
    const uc = ((x & 15) + 0.5) / 16, vc = ((y & 15) + 0.5) / 16;
    if (!opaque(x - 1, y)) { V(X0, Y0, -t, uc, vc, 0.6, l); V(X0, Y0, t, uc, vc, 0.6, l); V(X0, Y1, t, uc, vc, 0.6, l); V(X0, Y1, -t, uc, vc, 0.6, l); }
    if (!opaque(x + 1, y)) { V(X1, Y0, t, uc, vc, 0.6, l); V(X1, Y0, -t, uc, vc, 0.6, l); V(X1, Y1, -t, uc, vc, 0.6, l); V(X1, Y1, t, uc, vc, 0.6, l); }
    if (!opaque(x, y - 1)) { V(X0, Y1, t, uc, vc, 1, l); V(X1, Y1, t, uc, vc, 1, l); V(X1, Y1, -t, uc, vc, 1, l); V(X0, Y1, -t, uc, vc, 1, l); }
    if (!opaque(x, y + 1)) { V(X0, Y0, -t, uc, vc, 0.5, l); V(X1, Y0, -t, uc, vc, 0.5, l); V(X1, Y0, t, uc, vc, 0.5, l); V(X0, Y0, t, uc, vc, 0.5, l); }
  }
  ItemMeshCache.set(layer, buf);
  return buf;
}
