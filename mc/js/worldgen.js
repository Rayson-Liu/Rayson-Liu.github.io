'use strict';
// ---------------------------------------------------------------------------
// Vanilla-style world generation (1.18+ noise router), driven by the worldgen JSON
// shipped in the game jar (tools/build_worldgen.py -> worldgen_data.js).
// Runs in the generation worker (gen_worker.js) and on the main thread (biome queries).
//
// Part 1: 64-bit integer helpers, random sources (Xoroshiro128++, java.util.Random),
//         MD5 / SHA-256 for seeding, and the noise primitives (ImprovedNoise, PerlinNoise,
//         NormalNoise, BlendedNoise, SimplexNoise).
// ---------------------------------------------------------------------------
const WG = {};
(function () {
  // ---- 64-bit integers as (hi, lo) int32 pairs ----------------------------------------------
  // Functions return their result through RH / RL to avoid allocations in hot paths.
  let RH = 0, RL = 0;
  function add64(ah, al, bh, bl) {
    const lo = (al >>> 0) + (bl >>> 0);
    RL = lo | 0; RH = (ah + bh + (lo > 0xFFFFFFFF ? 1 : 0)) | 0;
  }
  function mul64(ah, al, bh, bl) {
    const a48 = ah >>> 16, a32 = ah & 0xFFFF, a16 = al >>> 16, a00 = al & 0xFFFF;
    const b48 = bh >>> 16, b32 = bh & 0xFFFF, b16 = bl >>> 16, b00 = bl & 0xFFFF;
    let c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 * b00; c16 += c00 >>> 16; c00 &= 0xFFFF;
    c16 += a16 * b00; c32 += c16 >>> 16; c16 &= 0xFFFF;
    c16 += a00 * b16; c32 += c16 >>> 16; c16 &= 0xFFFF;
    c32 += a32 * b00; c48 += c32 >>> 16; c32 &= 0xFFFF;
    c32 += a16 * b16; c48 += c32 >>> 16; c32 &= 0xFFFF;
    c32 += a00 * b32; c48 += c32 >>> 16; c32 &= 0xFFFF;
    c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48; c48 &= 0xFFFF;
    RH = (c48 << 16) | c32; RL = (c16 << 16) | c00;
  }
  function rotl64(h, l, n) { // 0 < n < 64
    if (n === 32) { RH = l; RL = h; return; }
    if (n > 32) { const t = h; h = l; l = t; n -= 32; }
    RH = (h << n) | (l >>> (32 - n)); RL = (l << n) | (h >>> (32 - n));
  }
  // BigInt bridges (initialisation only)
  const M64 = (1n << 64n) - 1n;
  function toBig(h, l) { return BigInt.asIntN(64, (BigInt(h >>> 0) << 32n) | BigInt(l >>> 0)); }
  function fromBig(b) { b = BigInt.asUintN(64, b); return [Number(b >> 32n) | 0, Number(b & 0xFFFFFFFFn) | 0]; }
  function bigFromBytesBE(bs, o) { let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bs[o + i]); return BigInt.asIntN(64, v); }

  // ---- MD5 (Guava Hashing.md5) ----------------------------------------------------------------
  function md5(bytes) {
    const K = new Int32Array(64), S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const len = bytes.length, n = ((len + 8) >> 6) + 1, W = new Int32Array(n * 16);
    for (let i = 0; i < len; i++) W[i >> 2] |= bytes[i] << ((i % 4) * 8);
    W[len >> 2] |= 0x80 << ((len % 4) * 8);
    W[n * 16 - 2] = (len * 8) | 0; W[n * 16 - 1] = Math.floor(len / 0x20000000);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let blk = 0; blk < n; blk++) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + W[blk * 16 + g]) | 0;
        A = D; D = C; C = B; B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((v, i) => { for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (k * 8)) & 255; });
    return out;
  }
  // ---- SHA-256 (Guava Hashing.sha256().hashLong(seed).asLong(), for the biome zoom seed) --------
  function sha256(bytes) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length, n = ((len + 8) >> 6) + 1, W = new Int32Array(n * 16);
    for (let i = 0; i < len; i++) W[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    W[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    W[n * 16 - 1] = len * 8;
    const w = new Int32Array(64), ror = (x, r) => (x >>> r) | (x << (32 - r));
    for (let blk = 0; blk < n; blk++) {
      for (let i = 0; i < 16; i++) w[i] = W[blk * 16 + i];
      for (let i = 16; i < 64; i++) {
        const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = new Uint8Array(32);
    H.forEach((v, i) => { for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (24 - k * 8)) & 255; });
    return out;
  }
  function utf8(s) { return new TextEncoder().encode(s); }

  // ---- Xoroshiro128++ (XoroshiroRandomSource) -------------------------------------------------
  class Xoroshiro {
    constructor(loH, loL, hiH, hiL) {
      if ((loH | loL | hiH | hiL) === 0) { loH = 0x9E3779B9 | 0; loL = 0x7F4A7C15; hiH = 0x6A09E667; hiL = 0xF3BCC909 | 0; }
      this.lh = loH; this.ll = loL; this.hh = hiH; this.hl = hiL;
    }
    // RandomSupport.upgradeSeedTo128bit(seed) (seed as BigInt)
    static fromSeed(seed) {
      const mix = (z) => { z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n); z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn); return z ^ (z >> 31n); };
      const s = BigInt.asUintN(64, BigInt(seed));
      const l = s ^ 0x6A09E667F3BCC909n, m = BigInt.asUintN(64, l + 0x9E3779B97F4A7C15n);
      const a = fromBig(mix(l)), b = fromBig(mix(m));
      return new Xoroshiro(a[0], a[1], b[0], b[1]);
    }
    nextLong() { // result in RH/RL
      const lh = this.lh, ll = this.ll, mh0 = this.hh, ml0 = this.hl;
      add64(lh, ll, mh0, ml0); rotl64(RH, RL, 17); add64(RH, RL, lh, ll);
      const nh = RH, nl = RL;
      const mh = mh0 ^ lh, ml = ml0 ^ ll;
      rotl64(lh, ll, 49);
      // seedLo = rotl(l,49) ^ m ^ (m << 21)
      this.lh = RH ^ mh ^ ((mh << 21) | (ml >>> 11)); this.ll = RL ^ ml ^ (ml << 21);
      rotl64(mh, ml, 28); this.hh = RH; this.hl = RL;
      RH = nh; RL = nl;
    }
    nextInt() { this.nextLong(); return RL; }
    nextIntB(bound) {
      // Java: l = unsigned(nextInt()); m = l * bound; n = m & 0xFFFFFFFF; rejection sampling; return m >> 32
      let l = this.nextInt() >>> 0;
      let lo = Math.imul(l, bound) >>> 0;
      if (lo < bound) {
        const j = ((-bound >>> 0) % bound);
        while (lo < j) { l = this.nextInt() >>> 0; lo = Math.imul(l, bound) >>> 0; }
      }
      const A = (l >>> 16) * bound, B = (l & 0xFFFF) * bound;
      return (Math.floor(A / 65536) + Math.floor(((A % 65536) * 65536 + B) / 4294967296)) | 0;
    }
    nextIntBetween(a, b) { return this.nextIntB(b - a + 1) + a; }
    nextDouble() { this.nextLong(); return ((RH >>> 0) * 2097152 + (RL >>> 11)) * 1.1102230246251565E-16; }
    nextFloat() { this.nextLong(); return (RH >>> 8) * 5.9604645E-8; }
    nextBoolean() { this.nextLong(); return (RL & 1) !== 0; }
    consume(n) { for (let i = 0; i < n; i++) this.nextLong(); }
    fork() { this.nextLong(); const a = RH, b = RL; this.nextLong(); return new Xoroshiro(a, b, RH, RL); }
    forkPositional() { this.nextLong(); const a = RH, b = RL; this.nextLong(); return new XoroFactory(a, b, RH, RL); }
  }
  class XoroFactory {
    constructor(loH, loL, hiH, hiL) { this.lh = loH; this.ll = loL; this.hh = hiH; this.hl = hiL; }
    // Mth.getSeed(x, y, z)
    at(x, y, z) {
      const a = Math.imul(x, 3129871);
      mul64(z >> 31, z, 0, 116129781);
      let h = (a >> 31) ^ RH ^ (y >> 31), l = a ^ RL ^ y;
      // l = l*l*42317861 + l*11
      const sh = h, sl = l;
      mul64(sh, sl, sh, sl); mul64(RH, RL, 0, 42317861); const ph = RH, pl = RL;
      mul64(sh, sl, 0, 11); add64(ph, pl, RH, RL);
      // >> 16 (arithmetic)
      const rh = RH >> 16, rl = (RL >>> 16) | (RH << 16);
      return new Xoroshiro(rh ^ this.lh, rl ^ this.ll, this.hh, this.hl);
    }
    fromHashOf(name) {
      const d = md5(utf8(name));
      const a = fromBig(bigFromBytesBE(d, 0)), b = fromBig(bigFromBytesBE(d, 8));
      return new Xoroshiro(a[0] ^ this.lh, a[1] ^ this.ll, b[0] ^ this.hh, b[1] ^ this.hl);
    }
  }

  // ---- java.util.Random (LegacyRandomSource / WorldgenRandom) ---------------------------------
  class JavaRandom {
    constructor(seed) { this.setSeed(seed); }
    setSeed(seed) { this.s = (BigInt.asUintN(64, BigInt(seed)) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
    next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, this.s >> BigInt(48 - bits))); }
    nextInt() { return this.next(32); }
    nextIntB(bound) {
      if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
      let bits, val;
      do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) < 0 || bits - val + (bound - 1) > 2147483647);
      return val;
    }
    nextLong() { return (BigInt(this.next(32)) << 32n) + BigInt(this.next(32)); }
    nextDouble() { return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565E-16; }
    nextFloat() { return this.next(24) / 16777216; }
    nextBoolean() { return this.next(1) !== 0; }
    consume(n) { for (let i = 0; i < n; i++) this.next(32); }
  }

  // ---- noise ---------------------------------------------------------------------------------
  const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]];
  const GX = new Float64Array(16), GY = new Float64Array(16), GZ = new Float64Array(16);
  for (let i = 0; i < 16; i++) { GX[i] = GRAD[i][0]; GY[i] = GRAD[i][1]; GZ[i] = GRAD[i][2]; }
  const ffloor = Math.floor;
  function shuffled(r) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) { const j = r.nextIntB(256 - i); const b = p[i]; p[i] = p[i + j]; p[i + j] = b; }
    return p;
  }
  class ImprovedNoise {
    constructor(r) {
      this.xo = r.nextDouble() * 256; this.yo = r.nextDouble() * 256; this.zo = r.nextDouble() * 256;
      const p = shuffled(r);
      this.p = new Uint8Array(512); for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    }
    noise(x, y, z, yScale, yMax) {
      const d = x + this.xo, e = y + this.yo, f = z + this.zo;
      const i = ffloor(d), j = ffloor(e), k = ffloor(f);
      const g = d - i, h = e - j, l = f - k;
      let n = 0;
      if (yScale !== 0) { const m = yMax >= 0 && yMax < h ? yMax : h; n = ffloor(m / yScale + 1.0000000116860974E-7) * yScale; }
      return this.sampleAndLerp(i, j, k, g, h - n, l, h);
    }
    sampleAndLerp(i, j, k, d, e, f, g) {
      const P = this.p;
      const l = P[i & 255], m = P[(i + 1) & 255];
      const n = P[(l + j) & 255], o = P[(l + j + 1) & 255], q = P[(m + j) & 255], r = P[(m + j + 1) & 255];
      let t;
      t = P[(n + k) & 255] & 15; const h0 = GX[t] * d + GY[t] * e + GZ[t] * f;
      t = P[(q + k) & 255] & 15; const s0 = GX[t] * (d - 1) + GY[t] * e + GZ[t] * f;
      t = P[(o + k) & 255] & 15; const t0 = GX[t] * d + GY[t] * (e - 1) + GZ[t] * f;
      t = P[(r + k) & 255] & 15; const u0 = GX[t] * (d - 1) + GY[t] * (e - 1) + GZ[t] * f;
      t = P[(n + k + 1) & 255] & 15; const v0 = GX[t] * d + GY[t] * e + GZ[t] * (f - 1);
      t = P[(q + k + 1) & 255] & 15; const w0 = GX[t] * (d - 1) + GY[t] * e + GZ[t] * (f - 1);
      t = P[(o + k + 1) & 255] & 15; const x0 = GX[t] * d + GY[t] * (e - 1) + GZ[t] * (f - 1);
      t = P[(r + k + 1) & 255] & 15; const y0 = GX[t] * (d - 1) + GY[t] * (e - 1) + GZ[t] * (f - 1);
      const sx = d * d * d * (d * (d * 6 - 15) + 10), sy = g * g * g * (g * (g * 6 - 15) + 10), sz = f * f * f * (f * (f * 6 - 15) + 10);
      const a0 = h0 + sx * (s0 - h0), a1 = t0 + sx * (u0 - t0), b0 = v0 + sx * (w0 - v0), b1 = x0 + sx * (y0 - x0);
      const c0 = a0 + sy * (a1 - a0), c1 = b0 + sy * (b1 - b0);
      return c0 + sz * (c1 - c0);
    }
  }
  const wrap = (d) => d - ffloor(d / 33554432 + 0.5) * 33554432;
  class PerlinNoise {
    // non-legacy (useNewInitialization): one positional factory, an ImprovedNoise per non-zero octave
    static create(r, firstOctave, amps) {
      const pn = new PerlinNoise();
      const j = amps.length;
      pn.levels = new Array(j).fill(null); pn.amps = amps;
      const fac = r.forkPositional();
      for (let l = 0; l < j; l++) if (amps[l] !== 0) pn.levels[l] = new ImprovedNoise(fac.fromHashOf('octave_' + (firstOctave + l)));
      pn.inF = Math.pow(2, firstOctave); pn.valF = Math.pow(2, j - 1) / (Math.pow(2, j) - 1);
      pn.maxValue = pn.edgeValue(2);
      return pn;
    }
    // legacy initialisation used by BlendedNoise: octaves -n..0, all amplitude 1
    static legacy(r, firstOctave) {
      const pn = new PerlinNoise();
      const j = 1 - firstOctave, k = -firstOctave;
      pn.amps = new Array(j).fill(1); pn.levels = new Array(j).fill(null);
      const first = new ImprovedNoise(r);
      pn.levels[k] = first;
      for (let l = k - 1; l >= 0; l--) pn.levels[l] = new ImprovedNoise(r);
      pn.inF = Math.pow(2, firstOctave); pn.valF = Math.pow(2, j - 1) / (Math.pow(2, j) - 1);
      return pn;
    }
    // legacy initialisation for an arbitrary octave range (PerlinNoise(random, Pair(first, amps), false))
    static legacyAmps(r, firstOctave, amps) {
      const pn = new PerlinNoise(), j = amps.length, k = -firstOctave;
      pn.amps = amps; pn.levels = new Array(j).fill(null);
      const first = new ImprovedNoise(r);
      if (k >= 0 && k < j && amps[k] !== 0) pn.levels[k] = first;
      for (let l = k - 1; l >= 0; l--) {
        if (l < j) { if (amps[l] !== 0) pn.levels[l] = new ImprovedNoise(r); else r.consume(262); }
        else r.consume(262);
      }
      pn.inF = Math.pow(2, firstOctave); pn.valF = Math.pow(2, j - 1) / (Math.pow(2, j) - 1);
      pn.maxValue = pn.edgeValue(2);
      return pn;
    }
    edgeValue(d) { let e = 0, f = this.valF; for (let i = 0; i < this.levels.length; i++) { if (this.levels[i]) e += this.amps[i] * d * f; f /= 2; } return e; }
    octave(i) { return this.levels[this.levels.length - 1 - i]; }
    get(x, y, z) {
      let d = 0, e = this.inF, f = this.valF;
      const L = this.levels, A = this.amps;
      for (let l = 0; l < L.length; l++) {
        const n = L[l];
        if (n) d += A[l] * n.noise(wrap(x * e), wrap(y * e), wrap(z * e), 0, 0) * f;
        e *= 2; f /= 2;
      }
      return d;
    }
  }
  class NormalNoise {
    constructor(r, params, legacy) {
      const amps = params.amplitudes, first = params.firstOctave;
      this.a = legacy ? PerlinNoise.legacyAmps(r, first, amps) : PerlinNoise.create(r, first, amps);
      this.b = legacy ? PerlinNoise.legacyAmps(r, first, amps) : PerlinNoise.create(r, first, amps);
      let lo = 1e9, hi = -1e9;
      amps.forEach((v, i) => { if (v !== 0) { lo = Math.min(lo, i); hi = Math.max(hi, i); } });
      this.valueFactor = 0.16666666666666666 / (0.1 * (1 + 1 / (hi - lo + 1)));
      this.maxValue = (this.a.maxValue + this.b.maxValue) * this.valueFactor;
    }
    get(x, y, z) {
      const F = 1.0181268882175227;
      return (this.a.get(x, y, z) + this.b.get(x * F, y * F, z * F)) * this.valueFactor;
    }
  }
  class BlendedNoise {
    constructor(r, p) {
      this.minL = PerlinNoise.legacy(r, -15); this.maxL = PerlinNoise.legacy(r, -15); this.main = PerlinNoise.legacy(r, -7);
      this.xzMul = 684.412 * p.xz_scale; this.yMul = 684.412 * p.y_scale;
      this.xzF = p.xz_factor; this.yF = p.y_factor; this.smear = p.smear_scale_multiplier;
    }
    compute(x, y, z) {
      const d = x * this.xzMul, e = y * this.yMul, f = z * this.xzMul;
      const g = d / this.xzF, h = e / this.yF, l = f / this.xzF;
      const m = this.yMul * this.smear, n = m / this.yF;
      let o = 0, p = 0, q = 0, r = 1;
      for (let s = 0; s < 8; s++) {
        const nn = this.main.octave(s);
        if (nn) q += nn.noise(wrap(g * r), wrap(h * r), wrap(l * r), n * r, h * r) / r;
        r /= 2;
      }
      const t = (q / 10 + 1) / 2, hiOnly = t >= 1, loOnly = t <= 0;
      r = 1;
      for (let u = 0; u < 16; u++) {
        const v = wrap(d * r), w = wrap(e * r), xx = wrap(f * r), yy = m * r;
        if (!hiOnly) { const a = this.minL.octave(u); if (a) o += a.noise(v, w, xx, yy, e * r) / r; }
        if (!loOnly) { const b = this.maxL.octave(u); if (b) p += b.noise(v, w, xx, yy, e * r) / r; }
        r /= 2;
      }
      const lo = o / 512, hi = p / 512;
      return (t < 0 ? lo : t > 1 ? hi : lo + t * (hi - lo)) / 128;
    }
  }
  // 2D simplex noise (SimplexNoise) and PerlinSimplexNoise (biome temperature variation)
  class SimplexNoise {
    constructor(r) {
      this.xo = r.nextDouble() * 256; this.yo = r.nextDouble() * 256; this.zo = r.nextDouble() * 256;
      const p = shuffled(r); this.p = new Uint8Array(512); for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    }
    corner(i, x, y, z, f) {
      let g = f - x * x - y * y - z * z;
      if (g < 0) return 0;
      g *= g; return g * g * (GX[i] * x + GY[i] * y + GZ[i] * z);
    }
    get2(d, e) {
      const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
      const f = (d + e) * F2, i = ffloor(d + f), j = ffloor(e + f);
      const g = (i + j) * G2, h = i - g, k = j - g, l = d - h, m = e - k;
      let n, o; if (l > m) { n = 1; o = 0; } else { n = 0; o = 1; }
      const p = l - n + G2, q = m - o + G2, r = l - 1 + 2 * G2, s = m - 1 + 2 * G2;
      const t = i & 255, u = j & 255, P = this.p;
      const v = P[t + P[u]] % 12, w = P[t + n + P[u + o]] % 12, x = P[t + 1 + P[u + 1]] % 12;
      return 70 * (this.corner(v, l, m, 0, 0.5) + this.corner(w, p, q, 0, 0.5) + this.corner(x, r, s, 0, 0.5));
    }
  }
  class PerlinSimplexNoise { // octaves [0] only
    constructor(r) { this.n = new SimplexNoise(r); }
    get(x, y) { return this.n.get2(x, y); }
  }

  Object.assign(WG, { Xoroshiro, XoroFactory, JavaRandom, ImprovedNoise, PerlinNoise, NormalNoise, BlendedNoise, SimplexNoise, PerlinSimplexNoise,
    md5, sha256, utf8, toBig, fromBig, mul64, add64, getR: () => [RH, RL] });
})();

// ---------------------------------------------------------------------------
// Part 2: density functions (compiled from JSON into closures), per-chunk caches and cell
// interpolation, aquifers and ore veins (NoiseChunk / NoiseBasedAquifer / OreVeinifier).
// ---------------------------------------------------------------------------
(function () {
  const fr = Math.fround;
  const clampedMap = (v, a, b, c, d) => { const t = (v - a) / (b - a); return t < 0 ? c : t > 1 ? d : c + t * (d - c); };

  // Per-chunk generation state shared by all compiled nodes of one RandomState
  class GenState {
    constructor(minY, height) { this.x0 = 0; this.z0 = 0; this.active = false; this.minY = minY; this.cellsY = height / 8; }
  }

  class RandomState {
    constructor(seed, data, settingsKey) {
      this.data = data;
      this.settings = data.noise_settings[settingsKey];
      this.seed = BigInt(seed);
      this.legacy = !!this.settings.legacy_random_source;
      this.random = this.legacy ? new WG.JRand(this.seed).forkPositional() : WG.Xoroshiro.fromSeed(this.seed).forkPositional();
      this.noises = new Map();
      this.S = new GenState(this.settings.noise.min_y, this.settings.noise.height);
      this.memo = new Map();
      this.refs = new Map();
      this.flatNodes = []; this.interpNodes = [];
      const R = this.settings.noise_router;
      this.router = {};
      for (const k of Object.keys(R)) this.router[k] = this.compile(R[k]);
      if (!this.legacy) {
        this.aquiferRandom = this.random.fromHashOf('minecraft:aquifer').forkPositional();
        this.oreRandom = this.random.fromHashOf('minecraft:ore').forkPositional();
      }
      this.factories = new Map();
    }
    noise(name) {
      if (!name.includes(':')) name = 'minecraft:' + name;
      let n = this.noises.get(name);
      if (!n) {
        const p = this.data.noise[name.slice(10)];
        if (!p) throw new Error('missing noise ' + name);
        // legacy dimensions build their biome noises like 1.17 did (seed + 0 / seed + 1)
        if (this.legacy && (name === 'minecraft:nether/temperature' || name === 'minecraft:nether/vegetation'))
          n = new WG.NormalNoise(new WG.JRand(this.seed + (name.endsWith('vegetation') ? 1n : 0n)), p, true);
        else n = new WG.NormalNoise(this.random.fromHashOf(name), p);
        this.noises.set(name, n);
      }
      return n;
    }
    factory(name) { // RandomState.getOrCreateRandomFactory
      let f = this.factories.get(name);
      if (!f) { f = this.random.fromHashOf(name).forkPositional(); this.factories.set(name, f); }
      return f;
    }
    // begin generating a chunk: switch the caches to it and fill flat caches + interpolation grids
    beginChunk(cx, cz) {
      const S = this.S;
      S.active = false;
      S.x0 = cx * 16; S.z0 = cz * 16;
      for (const n of this.flatNodes) n.fill();
      S.active = true; // flat caches are used while filling the interpolation grids
      S.interpReady = false;
      for (const n of this.interpNodes) n.fill();
      S.interpReady = true;
    }
    endChunk() { this.S.active = false; this.S.interpReady = false; }
    // ---- compiler: every node is {f(x,y,z), lo, hi} ------------------------------------------
    compile(j) {
      if (typeof j === 'number') { const v = j; return { f: () => v, lo: v, hi: v, k: v }; }
      if (typeof j === 'string') {
        let n = this.refs.get(j);
        if (!n) {
          const def = this.data.density_function[j.replace('minecraft:', '')];
          if (def === undefined) throw new Error('missing density function ' + j);
          n = this.compile(def); this.refs.set(j, n);
        }
        return n;
      }
      const key = JSON.stringify(j);
      let n = this.memo.get(key);
      if (!n) { n = this.build(j); this.memo.set(key, n); }
      return n;
    }
    build(j) {
      const t = j.type.replace('minecraft:', ''), C = (v) => this.compile(v), S = this.S;
      switch (t) {
        case 'add': case 'mul': case 'min': case 'max': {
          const a = C(j.argument1), b = C(j.argument2), fa = a.f, fb = b.f;
          if (t === 'add') {
            if (a.k !== undefined) { const k = a.k; return { f: (x, y, z) => fb(x, y, z) + k, lo: a.lo + b.lo, hi: a.hi + b.hi }; }
            if (b.k !== undefined) { const k = b.k; return { f: (x, y, z) => fa(x, y, z) + k, lo: a.lo + b.lo, hi: a.hi + b.hi }; }
            return { f: (x, y, z) => fa(x, y, z) + fb(x, y, z), lo: a.lo + b.lo, hi: a.hi + b.hi };
          }
          if (t === 'mul') {
            const p = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi].map(v => Number.isNaN(v) ? 0 : v), lo = Math.min(...p), hi = Math.max(...p);
            if (a.k !== undefined) { const k = a.k; return { f: (x, y, z) => fb(x, y, z) * k, lo, hi }; }
            if (b.k !== undefined) { const k = b.k; return { f: (x, y, z) => fa(x, y, z) * k, lo, hi }; }
            return { f: (x, y, z) => { const d = fa(x, y, z); return d === 0 ? 0 : d * fb(x, y, z); }, lo, hi };
          }
          if (t === 'min') { const blo = b.lo; return { f: (x, y, z) => { const d = fa(x, y, z); if (d < blo) return d; const e = fb(x, y, z); return d < e ? d : e; }, lo: Math.min(a.lo, b.lo), hi: Math.min(a.hi, b.hi) }; }
          const bhi = b.hi; return { f: (x, y, z) => { const d = fa(x, y, z); if (d > bhi) return d; const e = fb(x, y, z); return d > e ? d : e; }, lo: Math.max(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
        }
        case 'abs': { const a = C(j.argument), f = a.f; return { f: (x, y, z) => Math.abs(f(x, y, z)), lo: Math.max(0, a.lo, -a.hi), hi: Math.max(Math.abs(a.lo), Math.abs(a.hi)) }; }
        case 'square': { const a = C(j.argument), f = a.f; return { f: (x, y, z) => { const d = f(x, y, z); return d * d; }, lo: 0, hi: Math.max(a.lo * a.lo, a.hi * a.hi) }; }
        case 'cube': { const a = C(j.argument), f = a.f; return { f: (x, y, z) => { const d = f(x, y, z); return d * d * d; }, lo: a.lo ** 3, hi: a.hi ** 3 }; }
        case 'half_negative': { const a = C(j.argument), f = a.f; return { f: (x, y, z) => { const d = f(x, y, z); return d > 0 ? d : d * 0.5; }, lo: a.lo > 0 ? a.lo : a.lo * 0.5, hi: a.hi > 0 ? a.hi : a.hi * 0.5 }; }
        case 'quarter_negative': { const a = C(j.argument), f = a.f; return { f: (x, y, z) => { const d = f(x, y, z); return d > 0 ? d : d * 0.25; }, lo: a.lo > 0 ? a.lo : a.lo * 0.25, hi: a.hi > 0 ? a.hi : a.hi * 0.25 }; }
        case 'squeeze': { const a = C(j.argument), f = a.f; const sq = (d) => { const e = d < -1 ? -1 : d > 1 ? 1 : d; return e / 2 - e * e * e / 24; }; return { f: (x, y, z) => sq(f(x, y, z)), lo: sq(a.lo), hi: sq(a.hi) }; }
        case 'invert': { const a = C(j.argument), f = a.f; return { f: (x, y, z) => 1 / f(x, y, z), lo: -Infinity, hi: Infinity }; }
        case 'clamp': { const a = C(j.input), f = a.f, mn = j.min, mx = j.max; return { f: (x, y, z) => { const d = f(x, y, z); return d < mn ? mn : d > mx ? mx : d; }, lo: mn, hi: mx }; }
        case 'y_clamped_gradient': {
          const fy = j.from_y, ty = j.to_y, fv = j.from_value, tv = j.to_value;
          return { f: (x, y, z) => clampedMap(y, fy, ty, fv, tv), lo: Math.min(fv, tv), hi: Math.max(fv, tv) };
        }
        case 'range_choice': {
          const i = C(j.input).f, a = C(j.when_in_range), b = C(j.when_out_of_range), mn = j.min_inclusive, mx = j.max_exclusive, fa = a.f, fb = b.f;
          return { f: (x, y, z) => { const d = i(x, y, z); return d >= mn && d < mx ? fa(x, y, z) : fb(x, y, z); }, lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
        }
        case 'interval_select': {
          const i = C(j.input).f, fs = j.functions.map(C), th = j.thresholds, ff = fs.map(n => n.f), n = th.length;
          return { f: (x, y, z) => { const d = i(x, y, z); let k = 0; while (k < n && d >= th[k]) k++; return ff[k](x, y, z); }, lo: Math.min(...fs.map(q => q.lo)), hi: Math.max(...fs.map(q => q.hi)) };
        }
        case 'noise': {
          const nz = this.noise(j.noise), xs = j.xz_scale, ys = j.y_scale;
          return { f: (x, y, z) => nz.get(x * xs, y * ys, z * xs), lo: -nz.maxValue, hi: nz.maxValue };
        }
        case 'shifted_noise': {
          const nz = this.noise(j.noise), xs = j.xz_scale, ys = j.y_scale, sx = C(j.shift_x).f, sy = C(j.shift_y).f, sz = C(j.shift_z).f;
          return { f: (x, y, z) => nz.get(x * xs + sx(x, y, z), y * ys + sy(x, y, z), z * xs + sz(x, y, z)), lo: -nz.maxValue, hi: nz.maxValue };
        }
        case 'shift_a': { const nz = this.noise(j.argument); return { f: (x, y, z) => nz.get(x * 0.25, 0, z * 0.25) * 4, lo: -nz.maxValue * 4, hi: nz.maxValue * 4 }; }
        case 'shift_b': { const nz = this.noise(j.argument); return { f: (x, y, z) => nz.get(z * 0.25, x * 0.25, 0) * 4, lo: -nz.maxValue * 4, hi: nz.maxValue * 4 }; }
        case 'shift': { const nz = this.noise(j.argument); return { f: (x, y, z) => nz.get(x * 0.25, y * 0.25, z * 0.25) * 4, lo: -nz.maxValue * 4, hi: nz.maxValue * 4 }; }
        case 'old_blended_noise': {
          const bn = new WG.BlendedNoise(this.legacy ? new WG.JRand(this.seed) : this.random.fromHashOf('minecraft:terrain'), j);
          return { f: (x, y, z) => bn.compute(x, y, z), lo: -200, hi: 200 };
        }
        case 'blend_alpha': return { f: () => 1, lo: 1, hi: 1, k: 1 };
        case 'blend_offset': return { f: () => 0, lo: 0, hi: 0, k: 0 };
        case 'blend_density': return C(j.argument);
        case 'beardifier': return { f: () => 0, lo: 0, hi: 0, k: 0 };
        case 'cache_once': {
          const a = C(j.argument), f = a.f;
          let lx = NaN, ly = NaN, lz = NaN, lv = 0;
          return { f: (x, y, z) => { if (x === lx && y === ly && z === lz) return lv; lx = x; ly = y; lz = z; return (lv = f(x, y, z)); }, lo: a.lo, hi: a.hi };
        }
        case 'cache_2d': {
          const a = C(j.argument), f = a.f;
          let lx = NaN, lz = NaN, lv = 0;
          return { f: (x, y, z) => { if (x === lx && z === lz) return lv; lx = x; lz = z; return (lv = f(x, y, z)); }, lo: a.lo, hi: a.hi };
        }
        case 'flat_cache': {
          // evaluated at the chunk's quart positions (y = 0); outside the chunk it computes directly
          const a = C(j.argument), f = a.f, vals = new Float64Array(25);
          const node = { lo: a.lo, hi: a.hi, fill: () => { for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) vals[i * 5 + k] = f(S.x0 + i * 4, 0, S.z0 + k * 4); } };
          node.f = (x, y, z) => {
            if (S.active) { const i = (x >> 2) - (S.x0 >> 2), k = (z >> 2) - (S.z0 >> 2); if (i >= 0 && k >= 0 && i < 5 && k < 5) return vals[i * 5 + k]; }
            return f(x, y, z);
          };
          this.flatNodes.push(node);
          return node;
        }
        case 'interpolated': {
          // corner values on the 4x8x4 cell grid of the chunk, interpolated y, then x, then z like NoiseInterpolator
          const a = C(j.argument), f = a.f, NY = S.cellsY + 1, grid = new Float64Array(5 * 5 * NY);
          const node = { lo: a.lo, hi: a.hi, fill: () => {
            let i = 0;
            for (let cx = 0; cx < 5; cx++) for (let cz = 0; cz < 5; cz++) for (let cy = 0; cy < NY; cy++) grid[i++] = f(S.x0 + cx * 4, S.minY + cy * 8, S.z0 + cz * 4);
          } };
          // single-column mode (ChunkGenerator.getBaseHeight): corner values of the column's cells on demand
          let colStamp = -1;
          const col = new Float64Array(4 * NY);
          const colF = (x, y, z) => {
            if (colStamp !== S.colStamp) { colStamp = S.colStamp; col.fill(NaN); }
            const lx = x - S.colX0, lz = z - S.colZ0, ly = y - S.minY, cy = ly >> 3;
            if (lx < 0 || lz < 0 || lx > 3 || lz > 3 || cy < 0 || cy >= S.cellsY) return f(x, y, z);
            const c = (i, k, yy) => { const q = (i * 2 + k) * NY + yy; let v = col[q]; if (v !== v) v = col[q] = f(S.colX0 + i * 4, S.minY + yy * 8, S.colZ0 + k * 4); return v; };
            const ty = (ly & 7) / 8, tx = lx / 4, tz = lz / 4;
            const n000 = c(0, 0, cy), n010 = c(0, 0, cy + 1), n100 = c(1, 0, cy), n110 = c(1, 0, cy + 1);
            const n001 = c(0, 1, cy), n011 = c(0, 1, cy + 1), n101 = c(1, 1, cy), n111 = c(1, 1, cy + 1);
            const n00 = n000 + ty * (n010 - n000), n10 = n100 + ty * (n110 - n100), n01 = n001 + ty * (n011 - n001), n11 = n101 + ty * (n111 - n101);
            const n0 = n00 + tx * (n10 - n00), n1 = n01 + tx * (n11 - n01);
            return n0 + tz * (n1 - n0);
          };
          node.f = (x, y, z) => {
            if (!S.interpReady) return S.colMode ? colF(x, y, z) : f(x, y, z);
            const lx = x - S.x0, lz = z - S.z0, ly = y - S.minY;
            const cx = lx >> 2, cz = lz >> 2, cy = ly >> 3;
            if (cx < 0 || cz < 0 || cx > 3 || cz > 3 || cy < 0 || cy >= S.cellsY) return f(x, y, z);
            const b = (cx * 5 + cz) * NY + cy, X = 5 * NY, Z = NY;
            const n000 = grid[b], n010 = grid[b + 1], n100 = grid[b + X], n110 = grid[b + X + 1];
            const n001 = grid[b + Z], n011 = grid[b + Z + 1], n101 = grid[b + X + Z], n111 = grid[b + X + Z + 1];
            const ty = (ly & 7) / 8, tx = (lx & 3) / 4, tz = (lz & 3) / 4;
            const n00 = n000 + ty * (n010 - n000), n10 = n100 + ty * (n110 - n100), n01 = n001 + ty * (n011 - n001), n11 = n101 + ty * (n111 - n101);
            const n0 = n00 + tx * (n10 - n00), n1 = n01 + tx * (n11 - n01);
            return n0 + tz * (n1 - n0);
          };
          this.interpNodes.push(node);
          return node;
        }
        case 'find_top_surface': {
          const d = C(j.density).f, ub = C(j.upper_bound).f, lb = j.lower_bound, ch = j.cell_height;
          return { f: (x, y, z) => {
            const top = Math.floor(ub(x, y, z) / ch) * ch;
            for (let yy = top; yy >= lb; yy -= ch) if (d(x, yy, z) > 0) return yy;
            return lb;
          }, lo: lb, hi: 320 };
        }
        case 'spline': { const sp = this.spline(j.spline); return { f: (x, y, z) => sp(x, y, z), lo: -10, hi: 10 }; }
        case 'end_islands': return { f: () => 0, lo: -1, hi: 1 };
        case 'weird_scaled_sampler': {
          const i = C(j.input).f, nz = this.noise(j.noise), t1 = j.rarity_value_mapper === 'type_1';
          return { f: (x, y, z) => {
            const d = i(x, y, z);
            const e = t1 ? (d < -0.5 ? 0.75 : d < 0 ? 1 : d < 0.5 ? 1.5 : 2) : (d < -0.75 ? 0.5 : d < -0.5 ? 0.75 : d < 0.5 ? 1 : d < 0.75 ? 2 : 3);
            return e * Math.abs(nz.get(x / e, y / e, z / e));
          }, lo: 0, hi: nz.maxValue * 3 };
        }
      }
      throw new Error('unsupported density function ' + t);
    }
    // CubicSpline (float arithmetic, like vanilla)
    spline(s) {
      if (typeof s === 'number') { const v = fr(s); return () => v; }
      const coord = this.compile(s.coordinate).f;
      const locs = s.points.map(p => fr(p.location)), ders = s.points.map(p => fr(p.derivative)), vals = s.points.map(p => this.spline(p.value));
      const n = locs.length - 1;
      return (x, y, z) => {
        const f = fr(coord(x, y, z));
        let i = -1; while (i < n && f >= locs[i + 1]) i++;
        if (i < 0) { const v = vals[0](x, y, z), d = ders[0]; return d === 0 ? v : fr(v + fr(d * fr(f - locs[0]))); }
        if (i === n) { const v = vals[n](x, y, z), d = ders[n]; return d === 0 ? v : fr(v + fr(d * fr(f - locs[n]))); }
        const g = locs[i], h = locs[i + 1], k = fr(fr(f - g) / fr(h - g));
        const l = ders[i], m = ders[i + 1], a = vals[i](x, y, z), b = vals[i + 1](x, y, z);
        const hg = fr(h - g), ba = fr(b - a);
        const p = fr(fr(l * hg) - ba), q = fr(fr(-m * hg) + ba);
        const lab = fr(a + fr(k * ba)), lpq = fr(p + fr(k * fr(q - p)));
        return fr(lab + fr(fr(k * fr(1 - k)) * lpq));
      };
    }
  }

  // ---- aquifer (NoiseBasedAquifer) ----------------------------------------------------------------
  const AIR = 0, WATER = 1, LAVA = 2, NONE = -1; // substance codes
  const WAY_BELOW = -32512;
  const OFFS = [[0, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [-3, 0], [-2, 0], [-1, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1]];
  class Aquifer {
    constructor(rs, cx, cz, prelim) {
      const R = rs.router, minY = rs.S.minY, height = rs.S.cellsY * 8;
      this.barrier = R.barrier.f; this.flood = R.fluid_level_floodedness.f; this.spread = R.fluid_level_spread.f; this.lavaN = R.lava.f;
      this.erosion = R.erosion.f; this.depth = R.depth.f;
      this.rand = rs.aquiferRandom; this.prelim = prelim;
      this.sea = rs.settings.sea_level;
      const fd = (a, b) => Math.floor(a / b);
      this.minGX = fd(cx * 16, 16) - 1; this.sizeX = fd(cx * 16 + 15, 16) + 1 - this.minGX + 1;
      this.minGY = fd(minY, 12) - 1; this.sizeY = fd(minY + height, 12) + 1 - this.minGY + 1;
      this.minGZ = fd(cz * 16, 16) - 1; this.sizeZ = fd(cz * 16 + 15, 16) + 1 - this.minGZ + 1;
      const n = this.sizeX * this.sizeY * this.sizeZ;
      this.locX = new Int32Array(n); this.locY = new Int32Array(n); this.locZ = new Int32Array(n); this.locSet = new Uint8Array(n);
      this.stLevel = new Int32Array(n); this.stType = new Int8Array(n); this.stSet = new Uint8Array(n);
      this.sL = 0; this.sT = 0; this.bar = NaN;
      // Fluid levels never exceed max(sea level, preliminary surface at the aquifer centre), and above
      // level + 5 the barrier pressure can't make solid blocks, so everything higher is plain air.
      let top = this.sea;
      const ax0 = Math.floor((cx * 16 - 5) / 16) * 16, ax1 = (Math.floor((cx * 16 + 10) / 16) + 1) * 16 + 9;
      const az0 = Math.floor((cz * 16 - 5) / 16) * 16, az1 = (Math.floor((cz * 16 + 10) / 16) + 1) * 16 + 9;
      for (let x = ax0 >> 2; x <= ax1 >> 2; x++) for (let z = az0 >> 2; z <= az1 >> 2; z++) top = Math.max(top, prelim(x << 2, z << 2));
      this.airFrom = top + 5;
    }
    idx(gx, gy, gz) { return ((gy - this.minGY) * this.sizeZ + (gz - this.minGZ)) * this.sizeX + (gx - this.minGX); }
    // global fluid picker: lava below -54, the sea above
    globalLevel(y) { return y < Math.min(-54, this.sea) ? -54 : this.sea; }
    globalType(y) { return y < Math.min(-54, this.sea) ? LAVA : WATER; }
    // returns a substance code, or NONE (solid: the default block / ore veins)
    compute(x, y, z, density) {
      if (density > 0) return NONE;
      if (y >= this.airFrom) return AIR;
      if (y < -54) return LAVA; // global fluid at y is lava, and y < -54 so it is not air
      const l = Math.floor((x - 5) / 16), m = Math.floor((y + 1) / 12), n = Math.floor((z - 5) / 16);
      let o = 2147483647, p = o, q = o, s = -1, t = -1, u = -1;
      for (let w = 0; w <= 1; w++) for (let xx = -1; xx <= 1; xx++) for (let yy = 0; yy <= 1; yy++) {
        const gx = l + w, gy = m + xx, gz = n + yy, ac = this.idx(gx, gy, gz);
        if (!this.locSet[ac]) {
          const rr = this.rand.at(gx, gy, gz);
          this.locX[ac] = gx * 16 + rr.nextIntB(10); this.locY[ac] = gy * 12 + rr.nextIntB(9); this.locZ[ac] = gz * 16 + rr.nextIntB(10);
          this.locSet[ac] = 1;
        }
        const af = this.locX[ac] - x, ag = this.locY[ac] - y, ah = this.locZ[ac] - z, ai = af * af + ag * ag + ah * ah;
        if (o >= ai) { u = t; t = s; s = ac; q = p; p = o; o = ai; }
        else if (p >= ai) { u = t; t = ac; q = p; p = ai; }
        else if (q >= ai) { u = ac; q = ai; }
      }
      this.status(s); const lv2 = this.sL, ty2 = this.sT;
      const e = 1 - Math.abs(p - o) / 25;
      const at2 = y < lv2 ? ty2 : AIR;
      if (e <= 0) return at2;
      if (at2 === WATER && y - 1 < -54) return at2;
      this.bar = NaN;
      this.status(t); const lv3 = this.sL, ty3 = this.sT;
      const f = e * this.pressure(x, y, z, lv2, ty2, lv3, ty3);
      if (density + f > 0) return NONE;
      this.status(u); const lv4 = this.sL, ty4 = this.sT;
      const g = 1 - Math.abs(q - o) / 25;
      if (g > 0) { const h = e * g * this.pressure(x, y, z, lv2, ty2, lv4, ty4); if (density + h > 0) return NONE; }
      const h = 1 - Math.abs(q - p) / 25;
      if (h > 0) { const ai = e * h * this.pressure(x, y, z, lv3, ty3, lv4, ty4); if (density + ai > 0) return NONE; }
      return at2;
    }
    pressure(x, y, z, la, ta, lb, tb) {
      const a = y < la ? ta : AIR, b = y < lb ? tb : AIR;
      if ((a === LAVA && b === WATER) || (a === WATER && b === LAVA)) return 2;
      const j = Math.abs(la - lb);
      if (j === 0) return 0;
      const d = 0.5 * (la + lb), e = y + 0.5 - d, f = j / 2, o = f - Math.abs(e);
      let q;
      if (e > 0) { const pp = 0 + o; q = pp > 0 ? pp / 1.5 : pp / 2.5; }
      else { const pp = 3 + o; q = pp > 0 ? pp / 3 : pp / 10; }
      let r;
      if (q < -2 || q > 2) r = 0;
      else { if (Number.isNaN(this.bar)) this.bar = this.barrier(x, y, z); r = this.bar; }
      return 2 * (r + q);
    }
    status(ac) { // fluid status of an aquifer centre (cached per grid cell; a centre always lies in its own cell)
      if (!this.stSet[ac]) { this.computeFluid(this.locX[ac], this.locY[ac], this.locZ[ac]); this.stLevel[ac] = this.sL; this.stType[ac] = this.sT; this.stSet[ac] = 1; }
      this.sL = this.stLevel[ac]; this.sT = this.stType[ac];
    }
    computeFluid(i, j, k) {
      const gl = this.globalLevel(j), gt = this.globalType(j);
      let l = 2147483647;
      const m = j + 12, n = j - 12;
      let bl = false;
      for (const [ox, oz] of OFFS) {
        const o = i + ox * 16, p = k + oz * 16, q = this.prelim(o, p), r = q + 8;
        const center = ox === 0 && oz === 0;
        if (center && n > r) { this.sL = gl; this.sT = gt; return; }
        const above = m > r;
        if (above || center) {
          const lv = this.globalLevel(r), tt = this.globalType(r);
          if (r < lv) { // the global fluid at the surface is not air
            if (center) bl = true;
            if (above) { this.sL = lv; this.sT = tt; return; }
          }
        }
        l = Math.min(l, q);
      }
      // computeSurfaceLevel
      let d, e;
      if (this.erosion(i, j, k) < -0.22499999403953552 && this.depth(i, j, k) > 0.8999999761581421) { d = -1; e = -1; }
      else {
        const mm = l + 8 - j;
        const f = bl ? clampedMap(mm, 0, 64, 1, 0) : 0;
        const g = Math.max(-1, Math.min(1, this.flood(i, j, k)));
        const h = -0.3 + (f - 1) / (0 - 1) * (0.8 - -0.3), nn = -0.8 + (f - 1) / (0 - 1) * (0.4 - -0.8);
        d = g - nn; e = g - h;
      }
      let s;
      if (e > 0) s = gl;
      else if (d > 0) {
        const o = Math.floor(i / 16), p = Math.floor(j / 40), q = Math.floor(k / 16);
        const rr = p * 40 + 20, dd = this.spread(o, p, q) * 10, tq = Math.floor(dd / 3) * 3;
        s = Math.min(l, rr + tq);
      } else s = WAY_BELOW;
      // computeFluidType
      let ty = gt;
      if (s <= -10 && s !== WAY_BELOW && gt !== LAVA) {
        const dd = this.lavaN(Math.floor(i / 64), Math.floor(j / 40), Math.floor(k / 64));
        if (Math.abs(dd) > 0.3) ty = LAVA;
      }
      this.sL = s; this.sT = ty;
    }
  }

  // ---- ore veins (OreVeinifier): returns a block name or null ------------------------------------
  function makeVeinifier(rs) {
    const R = rs.router, tog = R.vein_toggle.f, rid = R.vein_ridged.f, gap = R.vein_gap.f, rnd = rs.oreRandom;
    const COPPER = ['copper_ore', 'raw_copper_block', 'granite', 0, 50], IRON = ['deepslate_iron_ore', 'raw_iron_block', 'tuff', -60, -8];
    return (x, y, z) => {
      const d = tog(x, y, z), V = d > 0 ? COPPER : IRON, e = Math.abs(d);
      const j = V[4] - y, k = y - V[3];
      if (k < 0 || j < 0) return null;
      const l = Math.min(j, k), f = clampedMap(l, 0, 20, -0.2, 0);
      if (e + f < 0.4000000059604645) return null;
      const r = rnd.at(x, y, z);
      if (r.nextFloat() > 0.699999988079071) return null;
      if (rid(x, y, z) >= 0) return null;
      const g = clampedMap(e, 0.4000000059604645, 0.6000000238418579, 0.10000000149011612, 0.30000001192092896);
      if (r.nextFloat() < g && gap(x, y, z) > -0.30000001192092896) return r.nextFloat() < 0.02 ? V[1] : V[0];
      return V[2];
    };
  }

  Object.assign(WG, { RandomState, Aquifer, makeVeinifier, SUB: { AIR, WATER, LAVA, NONE }, clampedMap });
})();

// ---------------------------------------------------------------------------
// Part 3: biomes — the overworld multi-noise parameter list (OverworldBiomeBuilder), the climate
// R-tree nearest-point search (Climate.RTree) and the "fuzzy" biome zoom (BiomeManager).
// ---------------------------------------------------------------------------
(function () {
  const q = (f) => Math.trunc(Math.fround(Math.fround(f) * 10000)); // Climate.quantizeCoord: (long)(f * 10000F)
  const span = (a, b) => [typeof a === 'number' ? q(a) : a[0], typeof b === 'number' ? q(b) : b[1]];
  const point = (f) => [q(f), q(f)];
  const FULL = span(-1, 1);
  const T = [span(-1, -0.45), span(-0.45, -0.15), span(-0.15, 0.2), span(0.2, 0.55), span(0.55, 1)];
  const H = [span(-1, -0.35), span(-0.35, -0.1), span(-0.1, 0.1), span(0.1, 0.3), span(0.3, 1)];
  const E = [span(-1, -0.78), span(-0.78, -0.375), span(-0.375, -0.2225), span(-0.2225, 0.05), span(0.05, 0.45), span(0.45, 0.55), span(0.55, 1)];
  const FROZEN = T[0], UNFROZEN = span(T[1], T[4]);
  const mushroomC = span(-1.2, -1.05), deepOceanC = span(-1.05, -0.455), oceanC = span(-0.455, -0.19), coastC = span(-0.19, -0.11);
  const inlandC = span(-0.11, 0.55), nearC = span(-0.11, 0.03), midC = span(0.03, 0.3), farC = span(0.3, 1);
  const OCEANS = [['deep_frozen_ocean', 'deep_cold_ocean', 'deep_ocean', 'deep_lukewarm_ocean', 'warm_ocean'], ['frozen_ocean', 'cold_ocean', 'ocean', 'lukewarm_ocean', 'warm_ocean']];
  const MIDDLE = [['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'taiga'], ['plains', 'plains', 'forest', 'taiga', 'old_growth_spruce_taiga'], ['flower_forest', 'plains', 'forest', 'birch_forest', 'dark_forest'], ['savanna', 'savanna', 'forest', 'jungle', 'jungle'], ['desert', 'desert', 'desert', 'desert', 'desert']];
  const MIDDLE_V = [['ice_spikes', null, 'snowy_taiga', null, null], [null, null, null, null, 'old_growth_pine_taiga'], ['sunflower_plains', null, null, 'old_growth_birch_forest', null], [null, null, 'plains', 'sparse_jungle', 'bamboo_jungle'], [null, null, null, null, null]];
  const PLATEAU = [['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'snowy_taiga'], ['meadow', 'meadow', 'forest', 'taiga', 'old_growth_spruce_taiga'], ['meadow', 'meadow', 'meadow', 'meadow', 'pale_garden'], ['savanna_plateau', 'savanna_plateau', 'forest', 'forest', 'jungle'], ['badlands', 'badlands', 'badlands', 'wooded_badlands', 'wooded_badlands']];
  const PLATEAU_V = [['ice_spikes', null, null, null, null], ['cherry_grove', null, 'meadow', 'meadow', 'old_growth_pine_taiga'], ['cherry_grove', 'cherry_grove', 'forest', 'birch_forest', null], [null, null, null, null, null], ['eroded_badlands', 'eroded_badlands', null, null, null]];
  const SHATTERED = [['windswept_gravelly_hills', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'], ['windswept_gravelly_hills', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'], ['windswept_hills', 'windswept_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'], [null, null, null, null, null], [null, null, null, null, null]];

  function overworldParameters() {
    const out = [];
    const add = (t, h, c, e, d, w, off, b) => out.push([[t, h, c, e, d, w, point(off)], b]);
    const surf = (t, h, c, e, w, off, b) => { add(t, h, c, e, point(0), w, off, b); add(t, h, c, e, point(1), w, off, b); };
    const under = (t, h, c, e, w, off, b) => add(t, h, c, e, span(0.2, 0.9), w, off, b);
    const bottom = (t, h, c, e, w, off, b) => add(t, h, c, e, point(1.1), w, off, b);
    const neg = (w) => w[1] < 0;
    const middle = (i, j, w) => neg(w) ? MIDDLE[i][j] : (MIDDLE_V[i][j] || MIDDLE[i][j]);
    const badlands = (j, w) => j < 2 ? (neg(w) ? 'badlands' : 'eroded_badlands') : j < 3 ? 'badlands' : 'wooded_badlands';
    const middleOrBadlands = (i, j, w) => i === 4 ? badlands(j, w) : middle(i, j, w);
    const plateau = (i, j, w) => { if (!neg(w) && PLATEAU_V[i][j]) return PLATEAU_V[i][j]; return PLATEAU[i][j]; };
    const slope = (i, j, w) => i >= 3 ? plateau(i, j, w) : j <= 1 ? 'snowy_slopes' : 'grove';
    const middleOrBadlandsOrSlope = (i, j, w) => i === 0 ? slope(i, j, w) : middleOrBadlands(i, j, w);
    const windswept = (i, j, w, k) => i > 1 && j < 4 && !neg(w) ? 'windswept_savanna' : k;
    const beach = (i) => i === 0 ? 'snowy_beach' : i === 4 ? 'desert' : 'beach';
    const shatteredCoast = (i, j, w) => windswept(i, j, w, !neg(w) ? middle(i, j, w) : beach(i));
    const peak = (i, j, w) => i <= 2 ? (neg(w) ? 'jagged_peaks' : 'frozen_peaks') : i === 3 ? 'stony_peaks' : badlands(j, w);
    const shattered = (i, j, w) => SHATTERED[i][j] || middle(i, j, w);
    const S2 = (a, b) => span(a, b);

    // off-coast
    surf(FULL, FULL, mushroomC, FULL, FULL, 0, 'mushroom_fields');
    for (let i = 0; i < 5; i++) { surf(T[i], FULL, deepOceanC, FULL, FULL, 0, OCEANS[0][i]); surf(T[i], FULL, oceanC, FULL, FULL, 0, OCEANS[1][i]); }

    const peaks = (w) => {
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const t = T[i], h = H[j];
        const m = middle(i, j, w), mb = middleOrBadlands(i, j, w), mbs = middleOrBadlandsOrSlope(i, j, w), pl = plateau(i, j, w), sh = shattered(i, j, w);
        const shw = windswept(i, j, w, sh), pk = peak(i, j, w);
        surf(t, h, S2(coastC, farC), E[0], w, 0, pk);
        surf(t, h, S2(coastC, nearC), E[1], w, 0, mbs);
        surf(t, h, S2(midC, farC), E[1], w, 0, pk);
        surf(t, h, S2(coastC, nearC), S2(E[2], E[3]), w, 0, m);
        surf(t, h, S2(midC, farC), E[2], w, 0, pl);
        surf(t, h, midC, E[3], w, 0, mb);
        surf(t, h, farC, E[3], w, 0, pl);
        surf(t, h, S2(coastC, farC), E[4], w, 0, m);
        surf(t, h, S2(coastC, nearC), E[5], w, 0, shw);
        surf(t, h, S2(midC, farC), E[5], w, 0, sh);
        surf(t, h, S2(coastC, farC), E[6], w, 0, m);
      }
    };
    const high = (w) => {
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const t = T[i], h = H[j];
        const m = middle(i, j, w), mb = middleOrBadlands(i, j, w), mbs = middleOrBadlandsOrSlope(i, j, w), pl = plateau(i, j, w), sh = shattered(i, j, w);
        const shw = windswept(i, j, w, m), sl = slope(i, j, w), pk = peak(i, j, w);
        surf(t, h, coastC, S2(E[0], E[1]), w, 0, m);
        surf(t, h, nearC, E[0], w, 0, sl);
        surf(t, h, S2(midC, farC), E[0], w, 0, pk);
        surf(t, h, nearC, E[1], w, 0, mbs);
        surf(t, h, S2(midC, farC), E[1], w, 0, sl);
        surf(t, h, S2(coastC, nearC), S2(E[2], E[3]), w, 0, m);
        surf(t, h, S2(midC, farC), E[2], w, 0, pl);
        surf(t, h, midC, E[3], w, 0, mb);
        surf(t, h, farC, E[3], w, 0, pl);
        surf(t, h, S2(coastC, farC), E[4], w, 0, m);
        surf(t, h, S2(coastC, nearC), E[5], w, 0, shw);
        surf(t, h, S2(midC, farC), E[5], w, 0, sh);
        surf(t, h, S2(coastC, farC), E[6], w, 0, m);
      }
    };
    const mid = (w) => {
      surf(FULL, FULL, coastC, S2(E[0], E[2]), w, 0, 'stony_shore');
      surf(S2(T[1], T[2]), FULL, S2(nearC, farC), E[6], w, 0, 'swamp');
      surf(S2(T[3], T[4]), FULL, S2(nearC, farC), E[6], w, 0, 'mangrove_swamp');
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const t = T[i], h = H[j];
        const m = middle(i, j, w), mb = middleOrBadlands(i, j, w), mbs = middleOrBadlandsOrSlope(i, j, w), sh = shattered(i, j, w), pl = plateau(i, j, w);
        const bc = beach(i), shw = windswept(i, j, w, m), shc = shatteredCoast(i, j, w), sl = slope(i, j, w);
        surf(t, h, S2(nearC, farC), E[0], w, 0, sl);
        surf(t, h, S2(nearC, midC), E[1], w, 0, mbs);
        surf(t, h, farC, E[1], w, 0, i === 0 ? sl : pl);
        surf(t, h, nearC, E[2], w, 0, m);
        surf(t, h, midC, E[2], w, 0, mb);
        surf(t, h, farC, E[2], w, 0, pl);
        surf(t, h, S2(coastC, nearC), E[3], w, 0, m);
        surf(t, h, S2(midC, farC), E[3], w, 0, mb);
        if (neg(w)) { surf(t, h, coastC, E[4], w, 0, bc); surf(t, h, S2(nearC, farC), E[4], w, 0, m); }
        else surf(t, h, S2(coastC, farC), E[4], w, 0, m);
        surf(t, h, coastC, E[5], w, 0, shc);
        surf(t, h, nearC, E[5], w, 0, shw);
        surf(t, h, S2(midC, farC), E[5], w, 0, sh);
        if (neg(w)) surf(t, h, coastC, E[6], w, 0, bc); else surf(t, h, coastC, E[6], w, 0, m);
        if (i === 0) surf(t, h, S2(nearC, farC), E[6], w, 0, m);
      }
    };
    const low = (w) => {
      surf(FULL, FULL, coastC, S2(E[0], E[2]), w, 0, 'stony_shore');
      surf(S2(T[1], T[2]), FULL, S2(nearC, farC), E[6], w, 0, 'swamp');
      surf(S2(T[3], T[4]), FULL, S2(nearC, farC), E[6], w, 0, 'mangrove_swamp');
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const t = T[i], h = H[j];
        const m = middle(i, j, w), mb = middleOrBadlands(i, j, w), mbs = middleOrBadlandsOrSlope(i, j, w);
        const bc = beach(i), shw = windswept(i, j, w, m), shc = shatteredCoast(i, j, w);
        surf(t, h, nearC, S2(E[0], E[1]), w, 0, mb);
        surf(t, h, S2(midC, farC), S2(E[0], E[1]), w, 0, mbs);
        surf(t, h, nearC, S2(E[2], E[3]), w, 0, m);
        surf(t, h, S2(midC, farC), S2(E[2], E[3]), w, 0, mb);
        surf(t, h, coastC, S2(E[3], E[4]), w, 0, bc);
        surf(t, h, S2(nearC, farC), E[4], w, 0, m);
        surf(t, h, coastC, E[5], w, 0, shc);
        surf(t, h, nearC, E[5], w, 0, shw);
        surf(t, h, S2(midC, farC), E[5], w, 0, m);
        surf(t, h, coastC, E[6], w, 0, bc);
        if (i === 0) surf(t, h, S2(nearC, farC), E[6], w, 0, m);
      }
    };
    const valleys = (w) => {
      surf(FROZEN, FULL, coastC, S2(E[0], E[1]), w, 0, neg(w) ? 'stony_shore' : 'frozen_river');
      surf(UNFROZEN, FULL, coastC, S2(E[0], E[1]), w, 0, neg(w) ? 'stony_shore' : 'river');
      surf(FROZEN, FULL, nearC, S2(E[0], E[1]), w, 0, 'frozen_river');
      surf(UNFROZEN, FULL, nearC, S2(E[0], E[1]), w, 0, 'river');
      surf(FROZEN, FULL, S2(coastC, farC), S2(E[2], E[5]), w, 0, 'frozen_river');
      surf(UNFROZEN, FULL, S2(coastC, farC), S2(E[2], E[5]), w, 0, 'river');
      surf(FROZEN, FULL, coastC, E[6], w, 0, 'frozen_river');
      surf(UNFROZEN, FULL, coastC, E[6], w, 0, 'river');
      surf(S2(T[1], T[2]), FULL, S2(inlandC, farC), E[6], w, 0, 'swamp');
      surf(S2(T[3], T[4]), FULL, S2(inlandC, farC), E[6], w, 0, 'mangrove_swamp');
      surf(FROZEN, FULL, S2(inlandC, farC), E[6], w, 0, 'frozen_river');
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) surf(T[i], H[j], S2(midC, farC), S2(E[0], E[1]), w, 0, middleOrBadlands(i, j, w));
    };
    // inland: weirdness slices
    mid(span(-1, -0.93333334)); high(span(-0.93333334, -0.7666667)); peaks(span(-0.7666667, -0.56666666)); high(span(-0.56666666, -0.4));
    mid(span(-0.4, -0.26666668)); low(span(-0.26666668, -0.05)); valleys(span(-0.05, 0.05)); low(span(0.05, 0.26666668));
    mid(span(0.26666668, 0.4)); high(span(0.4, 0.56666666)); peaks(span(0.56666666, 0.7666667)); high(span(0.7666667, 0.93333334)); mid(span(0.93333334, 1));
    // underground
    under(FULL, FULL, span(0.8, 1), FULL, FULL, 0, 'dripstone_caves');
    under(FULL, span(0.7, 1), FULL, FULL, FULL, 0, 'lush_caves');
    bottom(FULL, FULL, FULL, S2(E[0], E[1]), FULL, 0, 'deep_dark');
    return out;
  }

  // ---- Climate.RTree ----------------------------------------------------------------------------
  const DIMS = 7;
  function mkLeaf(space, value) { return { space, value, leaf: true }; }
  function mkSub(children) {
    const space = [];
    for (let d = 0; d < DIMS; d++) { let lo = Infinity, hi = -Infinity; for (const c of children) { lo = Math.min(lo, c.space[d][0]); hi = Math.max(hi, c.space[d][1]); } space.push([lo, hi]); }
    return { space, children, leaf: false };
  }
  const centre = (n, k, abs) => { const p = n.space[k], l = Math.trunc((p[0] + p[1]) / 2); return abs ? Math.abs(l) : l; };
  function sortNodes(list, k, abs) {
    list.sort((a, b) => { for (let j = 0; j < DIMS; j++) { const d = (k + j) % DIMS, x = centre(a, d, abs), y = centre(b, d, abs); if (x !== y) return x - y; } return 0; });
  }
  function bucketize(list) {
    const out = []; let cur = [];
    const n = Math.pow(6, Math.floor(Math.log(list.length - 0.01) / Math.log(6)));
    for (const node of list) { cur.push(node); if (cur.length >= n) { out.push(mkSub(cur)); cur = []; } }
    if (cur.length) out.push(mkSub(cur));
    return out;
  }
  const cost = (space) => { let l = 0; for (const p of space) l += Math.abs(p[1] - p[0]); return l; };
  function build(list) {
    if (list.length === 1) return list[0];
    if (list.length <= 6) {
      list.sort((a, b) => { let la = 0, lb = 0; for (let j = 0; j < DIMS; j++) { la += Math.abs(Math.trunc((a.space[j][0] + a.space[j][1]) / 2)); lb += Math.abs(Math.trunc((b.space[j][0] + b.space[j][1]) / 2)); } return la - lb; });
      return mkSub(list);
    }
    let best = Infinity, bestK = -1, bestB = null;
    for (let k = 0; k < DIMS; k++) {
      sortNodes(list, k, false);
      const b = bucketize(list);
      let m = 0; for (const s of b) m += cost(s.space);
      if (best > m) { best = m; bestK = k; bestB = b; }
    }
    sortNodes(bestB, bestK, true);
    return mkSub(bestB.map(s => build(s.children.slice())));
  }
  function dist(node, t) {
    let s = 0;
    for (let d = 0; d < DIMS; d++) {
      const p = node.space[d], v = t[d];
      const e = v > p[1] ? v - p[1] : v < p[0] ? p[0] - v : 0;
      s += e * e;
    }
    return s;
  }
  function search(node, t, leaf) {
    if (node.leaf) return node;
    let l = leaf ? dist(leaf, t) : Infinity, best = leaf;
    for (const c of node.children) {
      const m = dist(c, t);
      if (l > m) {
        const lf = search(c, t, best);
        const n = c === lf ? m : dist(lf, t);
        if (l > n) { l = n; best = lf; }
      }
    }
    return best;
  }
  class BiomeTree {
    constructor(params) { this.root = build(params.map(([sp, v]) => mkLeaf(sp, v))); this.last = null; }
    find(t) { this.last = search(this.root, t, this.last); return this.last.value; }
  }

  // Climate sampler on top of a RandomState's router (biomes are chosen per quart: 4x4x4 blocks)
  class BiomeSource {
    constructor(rs, params) {
      this.rs = rs;
      const R = rs.router;
      this.fn = [R.temperature.f, R.vegetation.f, R.continents.f, R.erosion.f, R.depth.f, R.ridges.f];
      this.tree = new BiomeTree(params || overworldParameters());
      this.t = [0, 0, 0, 0, 0, 0, 0];
    }
    climate(x, y, z, out) { for (let i = 0; i < 6; i++) out[i] = q(this.fn[i](x, y, z)); out[6] = 0; return out; }
    // biome at quart coordinates
    at(qx, qy, qz) { return this.tree.find(this.climate(qx << 2, qy << 2, qz << 2, this.t)); }
  }

  // ---- BiomeManager zoom ("fuzzy" borders) -------------------------------------------------------
  // seed: Hashing.sha256().hashLong(seed).asLong() ; fiddles are cached per quart corner
  class BiomeZoom {
    constructor(seed) {
      const b = BigInt.asUintN(64, BigInt(seed)), bytes = new Uint8Array(8);
      for (let i = 0; i < 8; i++) bytes[i] = Number((b >> BigInt(8 * i)) & 0xFFn);
      const h = WG.sha256(bytes);
      let z = 0n; for (let i = 7; i >= 0; i--) z = (z << 8n) | BigInt(h[i]);
      this.seed = BigInt.asIntN(64, z);
      const sp = WG.fromBig(this.seed); this.sh = sp[0]; this.sl = sp[1];
      this.cache = new Map();
    }
    // per-chunk box of quart corners kept in typed arrays (surface building looks these up a lot)
    setBox(qx0, qy0, qz0, nx, ny, nz) {
      this.bx = qx0; this.by = qy0; this.bz = qz0; this.nx = nx; this.ny = ny; this.nz = nz;
      const n = nx * ny * nz;
      if (!this.bv || this.bv.length < n * 3) { this.bv = new Float64Array(n * 3); this.bf = new Uint8Array(n); }
      else this.bf.fill(0, 0, n);
    }
    fiddle(i, j, k) { // the three offsets for one quart corner
      const key = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
      let c = this.cache.get(key);
      if (c && c[3] === i && c[4] === j && c[5] === k) return c;
      // LinearCongruentialGenerator.next(l, m) = l * (l * 6364136223846793005 + 1442695040888963407) + m, in 32-bit halves
      let lh = this.sh, ll = this.sl;
      const next = (mh, ml) => {
        WG.mul64(lh, ll, 0x5851F42D, 0x4C957F2D); const r = WG.getR(); WG.add64(r[0], r[1], 0x14057B7E, 0xF767814F | 0);
        const r2 = WG.getR(); WG.mul64(lh, ll, r2[0], r2[1]); const r3 = WG.getR(); WG.add64(r3[0], r3[1], mh, ml); const r4 = WG.getR(); lh = r4[0]; ll = r4[1];
      };
      next(i >> 31, i); next(j >> 31, j); next(k >> 31, k); next(i >> 31, i); next(j >> 31, j); next(k >> 31, k);
      const fid = () => (((ll >>> 24) | ((lh & 3) << 8)) / 1024 - 0.5) * 0.9;
      const g = fid(); next(this.sh, this.sl); const h = fid(); next(this.sh, this.sl); const m = fid();
      c = [g, h, m, i, j, k];
      if (this.cache.size > 200000) this.cache.clear();
      this.cache.set(key, c);
      return c;
    }
    // returns quart coordinates [qx, qy, qz] of the biome used for block (x, y, z)
    pick(x, y, z, out) {
      const i = x - 2, j = y - 2, k = z - 2, l = i >> 2, m = j >> 2, n = k >> 2;
      const d = (i & 3) / 4, e = (j & 3) / 4, f = (k & 3) / 4;
      let o = 0, g = Infinity;
      const inBox = this.bv && l - this.bx >= 0 && l + 1 - this.bx < this.nx && m - this.by >= 0 && m + 1 - this.by < this.ny && n - this.bz >= 0 && n + 1 - this.bz < this.nz;
      for (let p = 0; p < 8; p++) {
        const a = (p & 4) === 0, b = (p & 2) === 0, c = (p & 1) === 0;
        const qi = a ? l : l + 1, qj = b ? m : m + 1, qk = c ? n : n + 1;
        let f0, f1, f2;
        if (inBox) {
          const bi = ((qj - this.by) * this.nz + (qk - this.bz)) * this.nx + (qi - this.bx), bv = this.bv;
          if (!this.bf[bi]) { const fd = this.fiddle(qi, qj, qk); bv[bi * 3] = fd[0]; bv[bi * 3 + 1] = fd[1]; bv[bi * 3 + 2] = fd[2]; this.bf[bi] = 1; }
          f0 = bv[bi * 3]; f1 = bv[bi * 3 + 1]; f2 = bv[bi * 3 + 2];
        } else { const fd = this.fiddle(qi, qj, qk); f0 = fd[0]; f1 = fd[1]; f2 = fd[2]; }
        const h = a ? d : d - 1, t = b ? e : e - 1, u = c ? f : f - 1;
        const v = (u + f2) * (u + f2) + (t + f1) * (t + f1) + (h + f0) * (h + f0);
        if (g > v) { o = p; g = v; }
      }
      out[0] = (o & 4) === 0 ? l : l + 1; out[1] = (o & 2) === 0 ? m : m + 1; out[2] = (o & 1) === 0 ? n : n + 1;
      return out;
    }
  }

  // MultiNoiseBiomeSourceParameterList.Preset.NETHER
  function netherParameters() {
    const P = (t, h, off) => [point(t), point(h), point(0), point(0), point(0), point(0), point(off)];
    return [[P(0, 0, 0), 'nether_wastes'], [P(0, -0.5, 0), 'soul_sand_valley'], [P(0.4, 0, 0), 'crimson_forest'], [P(0, 0.5, 0.375), 'warped_forest'], [P(-0.5, 0, 0.175), 'basalt_deltas']];
  }
  Object.assign(WG, { overworldParameters, netherParameters, BiomeTree, BiomeSource, BiomeZoom, quantize: q });
})();

// ---------------------------------------------------------------------------
// Part 4: biome climate (temperature / snow), surface rules (SurfaceRules + SurfaceSystem) and the
// stage-1 chunk generator: biomes -> noise fill (aquifers, ore veins) -> surface.
// Blocks are produced as ids through a name -> id palette supplied by the game.
// ---------------------------------------------------------------------------
(function () {
  // PerlinSimplexNoise for arbitrary non-positive octave sets (vanilla biome temperature noises)
  class PerlinSimplex {
    constructor(r, octaves) {
      const i = -octaves[0], j = octaves[octaves.length - 1], k = i + j + 1;
      const first = new WG.SimplexNoise(r);
      this.levels = new Array(k).fill(null);
      if (j >= 0 && j < k && octaves.includes(0)) this.levels[j] = first;
      for (let m = j + 1; m < k; m++) { if (m >= 0 && octaves.includes(j - m)) this.levels[m] = new WG.SimplexNoise(r); else r.consume(262); }
      this.inF = Math.pow(2, j); this.valF = 1 / (Math.pow(2, k) - 1);
    }
    get(x, y) { let d = 0, e = this.inF, f = this.valF; for (const n of this.levels) { if (n) d += n.get2(x * e, y * e) * f; e /= 2; f *= 2; } return d; }
  }
  let TEMP_N = null, FROZEN_N = null, INFO_N = null;
  function climateNoises() {
    if (!TEMP_N) {
      TEMP_N = new PerlinSimplex(new WG.JavaRandom(1234), [0]);
      FROZEN_N = new PerlinSimplex(new WG.JavaRandom(3456), [-2, -1, 0]);
      INFO_N = new PerlinSimplex(new WG.JavaRandom(2345), [0]);
    }
  }
  const f32 = Math.fround;
  // Biome.getHeightAdjustedTemperature
  function biomeTemperature(b, x, y, z, sea) {
    climateNoises();
    let f = f32(b.temperature);
    if (b.temperature_modifier === 'frozen') {
      const d = FROZEN_N.get(x * 0.05, z * 0.05) * 7, e = INFO_N.get(x * 0.2, z * 0.2);
      if (d + e < 0.3 && INFO_N.get(x * 0.09, z * 0.09) < 0.8) f = f32(0.2);
    }
    const i = sea + 17;
    if (y > i) {
      const g = f32(TEMP_N.get(f32(x / 8), f32(z / 8)) * 8);
      return f32(f - f32(f32(f32(g + y) - i) * f32(0.05)) / 40);
    }
    return f;
  }
  const coldEnoughToSnow = (b, x, y, z, sea) => biomeTemperature(b, x, y, z, sea) < 0.15000000596046448;

  // ---- surface system ------------------------------------------------------------------------
  function generateBands(r) {
    const n = 192, bs = new Array(n).fill('terracotta');
    for (let i = 0; i < n; i++) { i += r.nextIntB(5) + 1; if (i < n) bs[i] = 'orange_terracotta'; }
    const make = (i, b) => {
      const j = r.nextIntBetween(6, 15);
      for (let k = 0; k < j; k++) { const l = i + r.nextIntB(3), m = r.nextIntB(n); for (let o = 0; m + o < n && o < l; o++) bs[m + o] = b; }
    };
    make(1, 'yellow_terracotta'); make(2, 'brown_terracotta'); make(1, 'red_terracotta');
    const j = r.nextIntBetween(9, 15);
    let k = 0;
    for (let l = 0; k < j && l < n; l += r.nextIntB(16) + 4) {
      bs[l] = 'white_terracotta';
      if (l - 1 > 0 && r.nextBoolean()) bs[l - 1] = 'light_gray_terracotta';
      if (l + 1 < n && r.nextBoolean()) bs[l + 1] = 'light_gray_terracotta';
      k++;
    }
    return bs;
  }

  class Generator {
    // data: bundled worldgen JSON; palette: block name -> id; seed: world seed (number/string/BigInt)
    constructor(seed, data, palette, dim = 'overworld') {
      this.data = data; this.dim = dim;
      this.rs = new WG.RandomState(seed, data, dim);
      this.biomes = new WG.BiomeSource(this.rs, dim === 'nether' ? WG.netherParameters() : null);
      this.zoom = new WG.BiomeZoom(this.rs.seed);
      this.set = this.rs.settings;
      this.minY = this.set.noise.min_y; this.height = this.set.noise.height; this.sea = this.set.sea_level;
      this.biomeList = data.biome_order;            // index -> name
      this.biomeIdx = new Map(this.biomeList.map((n, i) => [n, i]));
      this.biomeDef = this.biomeList.map(n => data.biome[n]);
      this.pal = palette;
      const P = (n) => { const v = palette[n]; return v === undefined ? palette.stone : v; };
      this.P = P;
      this.STONE = P(this.set.default_block.Name.replace('minecraft:', '')); this.WATER = P('water'); this.LAVA = P('lava'); this.AIR = 0;
      this.fluid = this.set.default_fluid.Name.includes('lava') ? this.LAVA : this.WATER;
      const rs = this.rs, rnd = rs.random;
      this.noiseRandom = rnd;
      this.nSurface = rs.noise('surface'); this.nSecondary = rs.noise('surface_secondary'); this.nBandOff = rs.noise('clay_bands_offset');
      this.nBadSurf = rs.noise('badlands_surface'); this.nBadPillar = rs.noise('badlands_pillar'); this.nBadRoof = rs.noise('badlands_pillar_roof');
      this.nIceSurf = rs.noise('iceberg_surface'); this.nIcePillar = rs.noise('iceberg_pillar'); this.nIceRoof = rs.noise('iceberg_pillar_roof');
      this.bands = generateBands(rnd.fromHashOf('minecraft:clay_bands')).map(P);
      this.veins = this.set.ore_veins_enabled ? WG.makeVeinifier(rs) : () => null;
      this.prelimCache = new Map();
      this.rule = this.compileRule(this.set.surface_rule);
    }
    prelim(x, z) { // NoiseChunk.preliminarySurfaceLevel, cached per quart column
      const qx = x >> 2, qz = z >> 2, key = qx * 1048576 + qz;
      let v = this.prelimCache.get(key);
      if (v === undefined) {
        v = Math.floor(this.rs.router.preliminary_surface_level.f(qx << 2, 0, qz << 2));
        if (this.prelimCache.size > 100000) this.prelimCache.clear();
        this.prelimCache.set(key, v);
      }
      return v;
    }
    // ChunkGenerator.getBaseHeight(WORLD_SURFACE_WG): one past the first block from the top of the noise
    // column that is not air (terrain, or the default fluid below sea level)
    // (floor: OCEAN_FLOOR_WG, the first solid block, ignoring the sea)
    baseHeight(x, z, floor = false) {
      const key = (x * 67108864 + z) * 2 + (floor ? 1 : 0);
      if (!this.bhCache) this.bhCache = new Map();
      let h = this.bhCache.get(key);
      if (h !== undefined) return h;
      const rs = this.rs, S = rs.S, fd = rs.router.final_density.f, minY = this.minY;
      S.colMode = true; S.colX0 = (x >> 2) << 2; S.colZ0 = (z >> 2) << 2; S.colStamp = (S.colStamp || 0) + 1;
      h = minY;
      for (let y = minY + this.height - 1; y >= minY; y--) {
        if ((!floor && y < this.sea) || fd(x, y, z) > 0) { h = y + 1; break; }
      }
      S.colMode = false;
      if (this.bhCache.size > 200000) this.bhCache.clear();
      this.bhCache.set(key, h);
      return h;
    }
    // noise density at a block (single-column interpolation), > 0 is solid terrain
    densityAt(x, y, z) {
      const S = this.rs.S;
      if (!S.colMode || S.colX0 !== ((x >> 2) << 2) || S.colZ0 !== ((z >> 2) << 2)) { S.colX0 = (x >> 2) << 2; S.colZ0 = (z >> 2) << 2; S.colStamp = (S.colStamp || 0) + 1; }
      S.colMode = true;
      const d = this.rs.router.final_density.f(x, y, z);
      S.colMode = false;
      return d;
    }
    biomeAtQuart(qx, qy, qz) {
      qy = Math.max(this.minY >> 2, Math.min((this.minY + this.height >> 2) - 1, qy));
      return this.biomes.at(qx, qy, qz);
    }
    // biome name at a block position (with the vanilla zoom)
    biomeAt(x, y, z) { const p = this.zoom.pick(x, y, z, [0, 0, 0]); return this.biomeAtQuart(p[0], p[1], p[2]); }
    temperatureAt(name, x, y, z) { return biomeTemperature(this.data.biome[name], x, y, z, this.sea); }

    // ---- surface rules → closures over a mutable context ---------------------------------------
    anchor(a) { if ('absolute' in a) return a.absolute; if ('above_bottom' in a) return this.minY + a.above_bottom; return this.height - 1 + this.minY - a.below_top; }
    compileCond(c) {
      const t = c.type.replace('minecraft:', ''), X = this.ctx;
      switch (t) {
        case 'biome': { const set = new Set([].concat(c.biome_is).map(b => b.replace('minecraft:', ''))); return () => set.has(X.biome()); }
        case 'noise_threshold': { const n = this.rs.noise(c.noise), lo = c.min_threshold, hi = c.max_threshold; return () => { const d = n.get(X.x, 0, X.z); return d >= lo && d <= hi; }; }
        case 'vertical_gradient': {
          const i = this.anchor(c.true_at_and_below), j = this.anchor(c.false_at_and_above), fac = this.rs.factory(c.random_name);
          return () => { const k = X.y; if (k <= i) return true; if (k >= j) return false; const d = 1 + (k - i) / (j - i) * (0 - 1); return fac.at(X.x, k, X.z).nextFloat() < d; };
        }
        case 'y_above': { const a = this.anchor(c.anchor), m = c.surface_depth_multiplier, s = c.add_stone_depth; return () => X.y + (s ? X.stoneAbove : 0) >= a + X.surfaceDepth * m; }
        case 'water': { const o = c.offset, m = c.surface_depth_multiplier, s = c.add_stone_depth; return () => X.waterHeight === -2147483648 || X.y + (s ? X.stoneAbove : 0) >= X.waterHeight + o + X.surfaceDepth * m; }
        case 'stone_depth': {
          const ceil = c.surface_type === 'ceiling', off = c.offset, add = c.add_surface_depth, rng = c.secondary_depth_range;
          return () => {
            const i = ceil ? X.stoneBelow : X.stoneAbove, j = add ? X.surfaceDepth : 0;
            const k = rng === 0 ? 0 : Math.trunc((X.secondary() + 1) / 2 * rng);
            return i <= 1 + off + j + k;
          };
        }
        case 'above_preliminary_surface': return () => X.y >= X.ms;
        case 'hole': return () => X.surfaceDepth <= 0;
        case 'steep': return () => X.steep();
        case 'temperature': return () => coldEnoughToSnow(this.data.biome[X.biome()], X.x, X.y, X.z, this.sea);
        case 'not': { const f = this.compileCond(c.invert); return () => !f(); }
      }
      throw new Error('surface condition ' + t);
    }
    compileRule(r) {
      if (!this.ctx) this.ctx = {};
      const t = r.type.replace('minecraft:', '');
      switch (t) {
        case 'block': { const id = this.P(r.result_state.Name.replace('minecraft:', '')); return () => id; }
        case 'sequence': { const rs = r.sequence.map(s => this.compileRule(s)); return () => { for (const f of rs) { const v = f(); if (v >= 0) return v; } return -1; }; }
        case 'condition': {
          const c = this.compileCond(r.if_true), f = this.compileRule(r.then_run);
          // conditions are memoised per position like vanilla's LazyCondition
          let stamp = -1, val = false;
          return () => { if (stamp !== this.ctx.stamp) { stamp = this.ctx.stamp; val = c(); } return val ? f() : -1; };
        }
        case 'bandlands': return () => { const X = this.ctx, i = Math.round(this.nBandOff.get(X.x, 0, X.z) * 4); return this.bands[((X.y + i) % 192 + 192 + 192) % 192]; };
      }
      throw new Error('surface rule ' + t);
    }

    // ---- stage 1: noise + surface for one chunk ---------------------------------------------------
    generate(cx, cz) {
      const rs = this.rs, R = rs.router, minY = this.minY, H = this.height, x0 = cx * 16, z0 = cz * 16;
      const blocks = new Uint16Array(16 * 16 * H), meta = new Uint8Array(16 * 16 * H);
      // biomes per quart (4 x H/4 x 4)
      const QY = H >> 2, qb = new Uint8Array(16 * QY);
      rs.beginChunk(cx, cz);
      for (let qx = 0; qx < 4; qx++) for (let qz = 0; qz < 4; qz++) for (let qy = 0; qy < QY; qy++)
        qb[(qy * 4 + qz) * 4 + qx] = this.biomeIdx.get(this.biomes.at((x0 >> 2) + qx, (minY >> 2) + qy, (z0 >> 2) + qz));
      // noise fill
      const fd0 = R.final_density.f, beard = this.beard, fd = beard ? (x, y, z) => fd0(x, y, z) + beard(x, y, z) : fd0;
      const aq = this.set.aquifers_enabled ? new WG.Aquifer(rs, cx, cz, (x, z) => this.prelim(x, z))
        : { compute: (x, y, z, d) => d > 0 ? WG.SUB.NONE : y < this.sea ? (this.fluid === this.LAVA ? WG.SUB.LAVA : WG.SUB.WATER) : WG.SUB.AIR };
      const SUB = WG.SUB, STONE = this.STONE, WATER = this.WATER, LAVA = this.LAVA, veins = this.veins, P = this.P;
      const veinCache = new Map();
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        const x = x0 + lx, z = z0 + lz;
        for (let iy = H - 1; iy >= 0; iy--) {
          const y = iy + minY;
          const d = fd(x, y, z);
          const s = aq.compute(x, y, z, d);
          let id;
          if (s === SUB.NONE) {
            const v = veins(x, y, z);
            if (v) { let vi = veinCache.get(v); if (vi === undefined) { vi = P(v); veinCache.set(v, vi); } id = vi; } else id = STONE;
          } else id = s === SUB.WATER ? WATER : s === SUB.LAVA ? LAVA : 0;
          if (id) blocks[(iy << 8) | (lz << 4) | lx] = id;
        }
      }
      // heightmap WORLD_SURFACE_WG (highest non-air block)
      const hm = new Int16Array(256);
      for (let i = 0; i < 256; i++) { let iy = H - 1; while (iy >= 0 && !blocks[(iy << 8) | i]) iy--; hm[i] = iy + minY; }
      this.buildSurface(cx, cz, blocks, hm, qb);
      if (WG.carveChunk && this.data.configured_carver) WG.carveChunk(this, cx, cz, blocks, aq);
      rs.endChunk();
      for (let i = 0; i < 256; i++) { let iy = H - 1; while (iy >= 0 && !blocks[(iy << 8) | i]) iy--; hm[i] = iy + minY; }
      return { blocks, meta, quartBiomes: qb, heightmap: hm };
    }

    buildSurface(cx, cz, blocks, hm, qb) {
      const X = this.ctx, minY = this.minY, H = this.height, x0 = cx * 16, z0 = cz * 16, STONE = this.STONE, WATER = this.WATER, LAVA = this.LAVA;
      const zp = [0, 0, 0], QY = H >> 2, qy0 = minY >> 2, bx0 = (x0 >> 2) - 1, bz0 = (z0 >> 2) - 1;
      this.zoom.setBox(bx0, qy0 - 1, bz0, 6, QY + 2, 6);
      const qc = new Int16Array(36 * QY).fill(-1);
      const quartBiome = (qx, qy, qz) => {
        qy = qy < qy0 ? qy0 : qy >= qy0 + QY ? qy0 + QY - 1 : qy;
        const lx = qx - (x0 >> 2), lz = qz - (z0 >> 2);
        if (lx >= 0 && lx < 4 && lz >= 0 && lz < 4) return this.biomeList[qb[((qy - qy0) * 4 + lz) * 4 + lx]];
        const ci = ((qy - qy0) * 6 + (qz - bz0)) * 6 + (qx - bx0);
        let b = qc[ci];
        if (b < 0) qc[ci] = b = this.biomeIdx.get(this.biomes.at(qx, qy, qz));
        return this.biomeList[b];
      };
      const biomeAt = (x, y, z) => { this.zoom.pick(x, y, z, zp); return quartBiome(zp[0], zp[1], zp[2]); };
      const pre = [this.prelim(x0, z0), this.prelim(x0 + 16, z0), this.prelim(x0, z0 + 16), this.prelim(x0 + 16, z0 + 16)];
      const get = (lx, iy, lz) => blocks[(iy << 8) | (lz << 4) | lx];
      X.stamp = 0;
      X.biome = () => X.bc || (X.bc = biomeAt(X.x, X.y, X.z));
      X.steep = () => {
        const i = X.x & 15, j = X.z & 15, k = Math.max(j - 1, 0), l = Math.min(j + 1, 15);
        if (hm[l * 16 + i] >= hm[k * 16 + i] + 4) return true;
        const o = Math.max(i - 1, 0), p = Math.min(i + 1, 15);
        return hm[j * 16 + o] >= hm[j * 16 + p] + 4;
      };
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        const x = x0 + lx, z = z0 + lz;
        const top = hm[lz * 16 + lx] + 1;
        X.x = x; X.z = z;
        const colBiome = biomeAt(x, top, z);
        if (colBiome === 'eroded_badlands') this.erodedBadlands(blocks, lx, lz, x, z, top);
        const p = hm[lz * 16 + lx] + 1;
        X.surfaceDepth = Math.trunc(this.nSurface.get(x, 0, z) * 2.75 + 3 + this.noiseRandom.at(x, 0, z).nextDouble() * 0.25);
        let sec = NaN; X.secondary = () => (Number.isNaN(sec) ? (sec = this.nSecondary.get(x, 0, z)) : sec);
        { const a = (x & 15) / 16, b = (z & 15) / 16, top0 = pre[0] + a * (pre[1] - pre[0]), bot0 = pre[2] + a * (pre[3] - pre[2]);
          X.ms = Math.floor(top0 + b * (bot0 - top0)) + X.surfaceDepth - 8; }
        let q = 0, r = -2147483648, s = 2147483647;
        for (let y = Math.min(p, minY + H - 1); y >= minY; y--) {
          const iy = y - minY, i = (iy << 8) | (lz << 4) | lx, bs = blocks[i];
          if (bs === 0) { q = 0; r = -2147483648; continue; }
          if (bs === WATER || bs === LAVA) { if (r === -2147483648) r = y + 1; continue; }
          if (s >= y) {
            s = -32512;
            for (let v = y - 1; v >= minY - 1; v--) {
              const b2 = v >= minY ? get(lx, v - minY, lz) : 0;
              if (b2 === 0 || b2 === WATER || b2 === LAVA) { s = v + 1; break; }
            }
          }
          q++;
          X.stoneAbove = q; X.stoneBelow = y - s + 1; X.waterHeight = r; X.y = y; X.stamp++;
          X.bc = null;
          if (bs !== STONE) continue;
          const v = this.rule();
          if (v >= 0) blocks[i] = v;
        }
        if (colBiome === 'frozen_ocean' || colBiome === 'deep_frozen_ocean') this.frozenOcean(blocks, lx, lz, x, z, top, X.ms, colBiome);
      }
    }
    erodedBadlands(blocks, lx, lz, x, z, height) {
      const e = Math.min(Math.abs(this.nBadSurf.get(x, 0, z) * 8.25), this.nBadPillar.get(x * 0.2, 0, z * 0.2) * 15);
      if (e <= 0) return;
      const h = Math.abs(this.nBadRoof.get(x * 0.75, 0, z * 0.75) * 1.5);
      const l = Math.floor(64 + Math.min(e * e * 2.5, Math.ceil(h * 50) + 24));
      if (height > l) return;
      const minY = this.minY, at = (y) => (y - minY) << 8 | (lz << 4) | lx;
      for (let m = l; m >= minY; m--) { const b = blocks[at(m)]; if (b === this.STONE) break; if (b === this.WATER) return; }
      for (let m = l; m >= minY && blocks[at(m)] === 0; m--) blocks[at(m)] = this.STONE;
    }
    frozenOcean(blocks, lx, lz, x, z, height, minSurface, biome) {
      const e = Math.min(Math.abs(this.nIceSurf.get(x, 0, z) * 8.25), this.nIcePillar.get(x * 1.28, 0, z * 1.28) * 15);
      if (e <= 1.8) return;
      const h = Math.abs(this.nIceRoof.get(x * 1.17, 0, z * 1.17) * 1.5);
      let k = Math.min(e * e * 1.2, Math.ceil(h * 40) + 14);
      if (biomeTemperature(this.data.biome[biome], x, 63, z, this.sea) > 0.10000000149011612) k -= 2;
      let m;
      if (k > 2) { m = this.sea - k - 7; k += this.sea; } else { k = 0; m = 0; }
      const n = k, rr = this.noiseRandom.at(x, 0, z), o = 2 + rr.nextIntB(4), pp = this.sea + 18 + rr.nextIntB(10);
      const minY = this.minY, at = (y) => (y - minY) << 8 | (lz << 4) | lx, SNOW = this.P('snow_block'), PICE = this.P('packed_ice');
      let qq = 0;
      for (let r = Math.max(height, Math.trunc(n) + 1); r >= minSurface; r--) {
        if (r - minY >= this.height || r < minY) continue;
        const b = blocks[at(r)];
        if ((b === 0 && r < Math.trunc(n) && rr.nextDouble() > 0.01) || (b === this.WATER && r > Math.trunc(m) && r < this.sea && m !== 0 && rr.nextDouble() > 0.15)) {
          if (qq <= o && r > pp) { blocks[at(r)] = SNOW; qq++; continue; }
          blocks[at(r)] = PICE;
        }
      }
    }
  }

  Object.assign(WG, { Generator, biomeTemperature, coldEnoughToSnow, PerlinSimplex, infoNoise: () => { climateNoises(); return INFO_N; } });
})();

// ---------------------------------------------------------------------------
// Part 5: spawn search (Climate.SpawnFinder against the noise settings' spawn_target points)
// ---------------------------------------------------------------------------
(function () {
  function findSpawn(gen) {
    const q = WG.quantize, f32 = Math.fround;
    const span = (v) => Array.isArray(v) ? [q(v[0]), q(v[1])] : [q(v), q(v)];
    const targets = gen.data.noise_settings.overworld.spawn_target || [];
    const pts = targets.map(t => [span(t.temperature), span(t.humidity), span(t.continentalness), span(t.erosion), span(t.depth), span(t.weirdness), span(t.offset)]);
    const R = gen.rs.router, fn = [R.temperature.f, R.vegetation.f, R.continents.f, R.erosion.f, R.depth.f, R.ridges.f];
    const fit = (x, z) => {
      const bx = (x >> 2) << 2, bz = (z >> 2) << 2;
      const t = fn.map((f, i) => i === 4 ? 0 : q(f(bx, 0, bz)));
      t.push(0);
      let best = Infinity;
      for (const p of pts) {
        let s = 0;
        for (let d = 0; d < 7; d++) { const v = t[d], lo = p[d][0], hi = p[d][1], e = v > hi ? v - hi : v < lo ? lo - v : 0; s += e * e; }
        if (s < best) best = s;
      }
      return best * 2048 * 2048 + x * x + z * z;
    };
    let rx = 0, rz = 0, rf = fit(0, 0);
    const radial = (max, step) => {
      let h = 0, i = f32(step);
      const bx = rx, bz = rz;
      while (i <= max) {
        const x = bx + Math.trunc(Math.sin(h) * i), z = bz + Math.trunc(Math.cos(h) * i);
        const v = fit(x, z);
        if (v < rf) { rf = v; rx = x; rz = z; }
        h = f32(h + f32(step / i));
        if (!(h > f32(Math.PI * 2))) continue;
        h = 0; i = f32(i + step);
      }
    };
    radial(2048, 512); radial(512, 32);
    return [rx, rz];
  }
  if (!WG.data && typeof self !== 'undefined' && self.WG_DATA) WG.data = self.WG_DATA;
  Object.assign(WG, { findSpawn });
})();

// ---------------------------------------------------------------------------
// Part 6: carvers (CaveWorldCarver / CanyonWorldCarver) — the classic worm caves and ravines that
// still run after the noise caves, seeded per source chunk with java.util.Random.
// ---------------------------------------------------------------------------
(function () {
  const fr = Math.fround, T24 = 16777216, T48 = 281474976710656;
  // java.util.Random with the 48-bit state in two exact 24-bit limbs
  class JRand {
    constructor(seed) { this.setSeed(seed || 0n); }
    setSeed(seed) {
      const s = (BigInt.asUintN(64, BigInt(seed)) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
      this.h = Number(s >> 24n); this.l = Number(s & 0xFFFFFFn);
    }
  }
  // LCG step: seed * 0x5DEECE66D + 0xB mod 2^48 on 24-bit limbs (0x5DEECE66D = 0x5DE * 2^24 + 0xECE66D)
  JRand.prototype.next = function (bits) {
    const sH = this.h, sL = this.l;
    const lo = sL * 0xECE66D + 0xB;
    const carry = Math.floor(lo / T24);
    const nL = lo - carry * T24;
    const nH = (sH * 0xECE66D + sL * 0x5DE + carry) % T24;
    this.h = nH; this.l = nL;
    if (bits >= 24) return (nH * Math.pow(2, bits - 24) + Math.floor(nL / Math.pow(2, 48 - bits))) | 0;
    return Math.floor(nH / Math.pow(2, 24 - bits));
  };
  JRand.prototype.nextInt = function (n) {
    if (n === undefined) return this.next(32);
    if ((n & -n) === n) return this.next(31) >>> (31 - Math.log2(n));
    let bits, val;
    do { bits = this.next(31); val = bits % n; } while (bits - val + (n - 1) > 2147483647);
    return val;
  };
  JRand.prototype.nextIntBetween = function (a, b) { return this.nextInt(b - a + 1) + a; };
  JRand.prototype.nextIntB = function (n) { return this.nextInt(n); };
  JRand.prototype.consume = function (n) { for (let i = 0; i < n; i++) this.next(32); };
  JRand.prototype.forkPositional = function () { return new LegacyFactory(this.nextLong()); };
  // LegacyPositionalRandomFactory
  class LegacyFactory {
    constructor(seed) { this.seed = BigInt.asIntN(64, seed); }
    fromHashOf(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0; return new JRand(BigInt(h) ^ this.seed); }
    at(x, y, z) {
      let l = BigInt.asIntN(64, BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y));
      l = BigInt.asIntN(64, BigInt.asIntN(64, l * l * 42317861n) + l * 11n) >> 16n;
      return new JRand(l ^ this.seed);
    }
  }
  JRand.prototype.nextFloat = function () { return this.next(24) / 16777216; };
  JRand.prototype.nextDouble = function () { return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565E-16; };
  JRand.prototype.nextBoolean = function () { return this.next(1) !== 0; };
  JRand.prototype.nextLong = function () { const a = BigInt(this.next(32)), b = BigInt(this.next(32)); return BigInt.asIntN(64, (a << 32n) + b); };
  // WorldgenRandom.setLargeFeatureSeed
  JRand.prototype.largeFeatureSeed = function (seed, x, z) {
    this.setSeed(seed);
    const m = this.nextLong(), n = this.nextLong();
    this.setSeed(BigInt.asIntN(64, BigInt(x) * m) ^ BigInt.asIntN(64, BigInt(z) * n) ^ BigInt(seed));
  };

  const SIN = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 65536);
  const msin = (f) => SIN[Math.trunc(fr(f) * 10430.378) & 65535];
  const mcos = (f) => SIN[Math.trunc(fr(f) * 10430.378 + 16384) & 65535];
  const floatProvider = (p) => {
    if (typeof p === 'number') return () => p;
    const t = p.type.replace('minecraft:', '');
    if (t === 'uniform') return (r) => fr(fr(r.nextFloat() * fr(p.max_exclusive - p.min_inclusive)) + p.min_inclusive);
    if (t === 'trapezoid') return (r) => { const f = fr(p.max - p.min), g = fr((f - p.plateau) / 2), h = fr(f - g); return fr(fr(p.min + fr(r.nextFloat() * h)) + fr(r.nextFloat() * g)); };
    if (t === 'constant') return () => p.value;
    if (t === 'clamped_normal') return (r) => Math.min(p.max, Math.max(p.min, p.mean + 0)); // not used by overworld carvers
    throw new Error('float provider ' + t);
  };

  function carveChunk(gen, cx, cz, blocks, aq) {
    const D = gen.data, minY = gen.minY, H = gen.height, x0 = cx * 16, z0 = cz * 16, WATER = gen.WATER, LAVA = gen.LAVA;
    if (!gen.carverCfg) {
      gen.carverCfg = {};
      const tags = (self.BLOCK_TAGS || {})[gen.dim === 'nether' ? 'nether_carver_replaceables' : 'overworld_carver_replaceables'] || [];
      gen.carveRepl = new Set(tags.map(n => gen.pal[n]).filter(v => v !== undefined));
    }
    const anchor = (a) => 'absolute' in a ? a.absolute : 'above_bottom' in a ? minY + a.above_bottom : minY + H - 1 - a.below_top;
    const cfgOf = (name) => {
      let c = gen.carverCfg[name];
      if (!c) {
        const j = D.configured_carver[name], k = j.config;
        c = gen.carverCfg[name] = { type: j.type.replace('minecraft:', ''), p: k.probability, lava: anchor(k.lava_level),
          yLo: anchor(k.y.min_inclusive), yHi: anchor(k.y.max_inclusive), yScale: floatProvider(k.yScale || k.y_scale || 1),
          hm: k.horizontal_radius_multiplier ? floatProvider(k.horizontal_radius_multiplier) : null, vm: k.vertical_radius_multiplier ? floatProvider(k.vertical_radius_multiplier) : null,
          floor: k.floor_level ? floatProvider(k.floor_level) : null, rot: k.vertical_rotation ? floatProvider(k.vertical_rotation) : null, shape: k.shape || null };
        if (c.shape) { c.dist = floatProvider(c.shape.distance_factor); c.thick = floatProvider(c.shape.thickness); c.hrf = floatProvider(c.shape.horizontal_radius_factor); }
      }
      return c;
    };
    const mask = new Uint8Array(16 * 16 * H);
    const GRASS = gen.pal.grass_block, MYC = gen.pal.mycelium, DIRT = gen.pal.dirt;
    const midX = x0 + 8, midZ = z0 + 8;
    const canReach = (d, e, i, j, f) => { const k = d - midX, l = e - midZ, m = j - i, n = f + 2 + 16; return k * k + l * l - m * m <= n * n; };
    const ellipsoid = (c, d, e, f, g, h, skip) => {
      const k = 16 + g * 2;
      if (Math.abs(d - midX) > k || Math.abs(f - midZ) > k) return;
      const n = Math.max(Math.floor(d - g) - x0 - 1, 0), o = Math.min(Math.floor(d + g) - x0, 15);
      const p = Math.max(Math.floor(e - h) - 1, minY + 1), r = Math.min(Math.floor(e + h) + 1, minY + H - 1 - 7);
      const s = Math.max(Math.floor(f - g) - z0 - 1, 0), t = Math.min(Math.floor(f + g) - z0, 15);
      for (let u = n; u <= o; u++) {
        const w = (x0 + u + 0.5 - d) / g;
        for (let x = s; x <= t; x++) {
          const z = (z0 + x + 0.5 - f) / g;
          if (w * w + z * z >= 1) continue;
          let surface = false;
          for (let aa = r; aa > p; aa--) {
            const ab = (aa - 0.5 - e) / h;
            if (skip(w, ab, z, aa)) continue;
            const iy = aa - minY, mi = (iy << 8) | (x << 4) | u;
            if (mask[mi]) continue;
            mask[mi] = 1;
            const bs = blocks[mi];
            if (bs === GRASS || bs === MYC) surface = true;
            if (!gen.carveRepl.has(bs)) continue;
            let st;
            if (c.type === 'nether_cave') st = aa <= minY + 31 ? LAVA : 0;
            else if (aa <= c.lava) st = LAVA;
            else {
              const sub = aq.compute(x0 + u, aa, z0 + x, 0);
              if (sub === WG.SUB.NONE) continue;
              st = sub === WG.SUB.WATER ? WATER : sub === WG.SUB.LAVA ? LAVA : 0;
            }
            blocks[mi] = st;
            if (surface && iy > 0) { const bi = ((iy - 1) << 8) | (x << 4) | u; if (blocks[bi] === DIRT && st === 0) blocks[bi] = GRASS; }
          }
        }
      }
    };
    // the tunnels of a source chunk don't depend on the chunk being carved: simulate each source once
    // and keep its ellipsoids (vanilla's canReach() only stops tunnels that can't touch the target)
    const cache = gen.carveCache || (gen.carveCache = new Map());
    for (let j = -8; j <= 8; j++) for (let k = -8; k <= 8; k++) {
      const scx = cx + j, scz = cz + k, key = scx * 65536 + scz;
      let list = cache.get(key);
      if (!list) {
        list = sourceEllipsoids(scx, scz);
        if (cache.size > 30000) cache.clear();
        cache.set(key, list);
      }
      for (const el of list) {
        const lim = 16 + el.g * 2;
        if (Math.abs(el.d - midX) > lim || Math.abs(el.f - midZ) > lim) continue;
        ellipsoid(el.c, el.d, el.e, el.f, el.g, el.h, el.skip);
      }
    }
    function sourceEllipsoids(scx, scz) {
      const out = [], rnd = new JRand(0n), seed = gen.rs.seed;
      const biome = gen.biomes.at(scx * 4, 0, scz * 4), names = (D.biome[biome] && D.biome[biome].carvers) || [];
      let l = 0;
      for (const name0 of [].concat(names)) {
        const c = cfgOf(name0.replace('minecraft:', ''));
        rnd.largeFeatureSeed(seed + BigInt(l), scx, scz);
        l++;
        if (!(rnd.nextFloat() <= fr(c.p))) continue;
        const add = (d, e, f, g, h, skip) => out.push({ c, d, e, f, g, h, skip });
        if (c.type === 'cave' || c.type === 'nether_cave') carveCave(c, rnd, scx, scz, add);
        else if (c.type === 'canyon') carveCanyon(c, rnd, scx, scz, add);
      }
      return out;
    }
    function carveCave(c, r, scx, scz, add) {
      const i = (4 * 2 - 1) * 16;
      const nether = c.type === 'nether_cave', j = r.nextInt(r.nextInt(r.nextInt(nether ? 10 : 15) + 1) + 1);
      for (let k = 0; k < j; k++) {
        const d = scx * 16 + r.nextInt(16), e = r.nextIntBetween(c.yLo, c.yHi), f = scz * 16 + r.nextInt(16);
        const g = c.hm(r), h = c.vm(r), l = c.floor(r);
        const skip = (dx, dy, dz) => dy <= l ? true : dx * dx + dy * dy + dz * dz >= 1;
        let m = 1;
        if (r.nextInt(4) === 0) {
          const n = c.yScale(r), o = fr(1 + fr(r.nextFloat() * 6));
          const ii = 1.5 + fr(msin(1.5707964) * o);
          add(d + 1, e, f, ii, ii * n, skip);
          m += r.nextInt(4);
        }
        for (let p = 0; p < m; p++) {
          const q = fr(r.nextFloat() * fr(Math.PI * 2)), o = fr(fr(r.nextFloat() - 0.5) / 4);
          let thick = fr(fr(r.nextFloat() * 2) + r.nextFloat());
          if (nether) thick = fr(thick * 2);
          else if (r.nextInt(10) === 0) thick = fr(thick * fr(fr(fr(r.nextFloat() * r.nextFloat()) * 3) + 1));
          const s = i - r.nextInt(i / 4 | 0);
          tunnel(r.nextLong(), d, e, f, g, h, thick, q, o, 0, s, nether ? 5 : 1, skip, add);
        }
      }
    }
    function tunnel(seedL, d, e, f, g, h, i, j, k, m, n, o, skip, add) {
      const r = new JRand(seedL);
      const p = r.nextInt(n / 2 | 0) + (n / 4 | 0), steep = r.nextInt(6) === 0;
      let q = 0, rr = 0;
      for (let s = m; s < n; s++) {
        const t = 1.5 + fr(msin(fr(fr(fr(Math.PI) * s) / n)) * i), u = t * o;
        const v = mcos(k);
        d += fr(mcos(j) * v); e += msin(k); f += fr(msin(j) * v);
        k = fr(k * (steep ? 0.92 : 0.7));
        k = fr(k + fr(rr * 0.1)); j = fr(j + fr(q * 0.1));
        rr = fr(rr * 0.9); q = fr(q * 0.75);
        rr = fr(rr + fr(fr(fr(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 2));
        q = fr(q + fr(fr(fr(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 4));
        if (s === p && i > 1) {
          tunnel(r.nextLong(), d, e, f, g, h, fr(fr(r.nextFloat() * 0.5) + 0.5), fr(j - 1.5707964), fr(k / 3), s, n, 1, skip, add);
          tunnel(r.nextLong(), d, e, f, g, h, fr(fr(r.nextFloat() * 0.5) + 0.5), fr(j + 1.5707964), fr(k / 3), s, n, 1, skip, add);
          return;
        }
        if (r.nextInt(4) === 0) continue;
        add(d, e, f, t * g, u * h, skip);
      }
    }
    function carveCanyon(c, r, scx, scz, add) {
      const i = (4 * 2 - 1) * 16;
      const d = scx * 16 + r.nextInt(16), j = r.nextIntBetween(c.yLo, c.yHi), e = scz * 16 + r.nextInt(16);
      const f = fr(r.nextFloat() * fr(Math.PI * 2)), g = c.rot(r), h = c.yScale(r), k = c.thick(r);
      const l = Math.trunc(fr(i * c.dist(r)));
      const rr = new JRand(r.nextLong()), S = c.shape;
      const ws = new Float32Array(H);
      let wf = 1;
      for (let a = 0; a < H; a++) { if (a === 0 || rr.nextInt(S.width_smoothness) === 0) wf = fr(1 + fr(rr.nextFloat() * rr.nextFloat())); ws[a] = fr(wf * wf); }
      const skip = (dx, dy, dz, yy) => (dx * dx + dz * dz) * ws[yy - minY - 1] + dy * dy / 6 >= 1;
      let x = d, y = j, z = e, yaw = f, pitch = g, n = 0, o = 0;
      for (let p = 0; p < l; p++) {
        let q = 1.5 + fr(msin(fr(fr(p * fr(Math.PI)) / l)) * k), rad = q * h;
        q *= c.hrf(rr);
        const hh = fr(1 - fr(Math.abs(fr(0.5 - fr(p / l))) * 2)), ii = fr(S.vertical_radius_default_factor + fr(S.vertical_radius_center_factor * hh));
        rad = ii * rad * fr(fr(rr.nextFloat() * 0.25) + 0.75);
        const s = mcos(pitch), t = msin(pitch);
        x += fr(mcos(yaw) * s); y += t; z += fr(msin(yaw) * s);
        pitch = fr(pitch * 0.7); pitch = fr(pitch + fr(o * 0.05)); yaw = fr(yaw + fr(n * 0.05));
        o = fr(o * 0.8); n = fr(n * 0.5);
        o = fr(o + fr(fr(fr(rr.nextFloat() - rr.nextFloat()) * rr.nextFloat()) * 2));
        n = fr(n + fr(fr(fr(rr.nextFloat() - rr.nextFloat()) * rr.nextFloat()) * 4));
        if (rr.nextInt(4) === 0) continue;
        add(x, y, z, q, rad, skip);
      }
    }
  }
  Object.assign(WG, { JRand, carveChunk });
})();
