'use strict';
// ---------------------------------------------------------------------------
// NBT (Minecraft's binary tag format, big-endian) reader and writer, for importing vanilla worlds and turning a
// save into one for a room. Works in the page, in
// workers and in Node (multiplayer/tools). Values: byte / short / int / float / double -> number, long -> BigInt,
// string -> string, list -> array, compound -> plain object, byte / int arrays -> Int8Array / Int32Array,
// long arrays -> NBT.Longs (pairs of 32-bit halves: block state data is unpacked from them without BigInt).
// ---------------------------------------------------------------------------
(function (root) {
  const utf8 = new TextDecoder('utf-8');
  class Longs { // a long array as [hi0, lo0, hi1, lo1, ...] (unsigned 32-bit halves)
    constructor(u32) { this.u32 = u32; this.length = u32.length >> 1; }
    hi(i) { return this.u32[i * 2]; }
    lo(i) { return this.u32[i * 2 + 1]; }
  }
  function parse(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    const str = () => { const n = dv.getUint16(p); p += 2; const s = utf8.decode(bytes.subarray(p, p + n)); p += n; return s; };
    const read = (t) => {
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p); p += 2; return v; }
        case 3: { const v = dv.getInt32(p); p += 4; return v; }
        case 4: { const v = dv.getBigInt64(p); p += 8; return v; }
        case 5: { const v = dv.getFloat32(p); p += 4; return v; }
        case 6: { const v = dv.getFloat64(p); p += 8; return v; }
        case 7: { const n = dv.getInt32(p); p += 4; const v = new Int8Array(bytes.buffer.slice(bytes.byteOffset + p, bytes.byteOffset + p + n)); p += n; return v; }
        case 8: return str();
        case 9: { const et = dv.getUint8(p++), n = dv.getInt32(p); p += 4; const a = new Array(Math.max(0, n)); for (let i = 0; i < n; i++) a[i] = read(et); return a; }
        case 10: {
          const o = {};
          for (;;) { const ct = dv.getUint8(p++); if (ct === 0) break; const k = str(); o[k] = read(ct); }
          return o;
        }
        case 11: { const n = dv.getInt32(p); p += 4; const a = new Int32Array(n); for (let i = 0; i < n; i++, p += 4) a[i] = dv.getInt32(p); return a; }
        case 12: { const n = dv.getInt32(p); p += 4; const a = new Uint32Array(n * 2); for (let i = 0; i < n * 2; i++, p += 4) a[i] = dv.getUint32(p); return new Longs(a); }
      }
      throw new Error('NBT: unknown tag ' + t + ' at ' + p);
    };
    const t = dv.getUint8(p++);
    if (t !== 10) throw new Error('NBT: root is not a compound');
    str(); // root name (empty)
    return read(10);
  }
  // decompress with the platform's streams: 'gzip' (level.dat, region type 1) or 'deflate' (zlib, region type 2)
  async function inflate(bytes, format) {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  // ---- writing (exporting a save for a room): plain values pick their tag (an integer number -> int, other numbers
  // -> double, boolean -> byte, BigInt -> long, array -> list of its first element's tag, Int8Array / Uint8Array -> byte
  // array, Int32Array -> int array, Longs -> long array, object -> compound; null / undefined fields are left out);
  // NBT.byte(v), NBT.short(v), NBT.float(v), NBT.long(v) ... give the other tags
  class Tag { constructor(t, v) { this.t = t; this.v = v; } }
  const tag = (t) => (v) => new Tag(t, v);
  const tagOf = (v) => v instanceof Tag ? v.t : typeof v === 'number' ? (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? 3 : 6)
    : typeof v === 'boolean' ? 1 : typeof v === 'bigint' ? 4 : typeof v === 'string' ? 8 : Array.isArray(v) ? 9
      : v instanceof Int8Array || v instanceof Uint8Array ? 7 : v instanceof Int32Array ? 11 : v instanceof Longs ? 12 : 10;
  const utf8e = new TextEncoder();
  function write(value) {
    let buf = new Uint8Array(1 << 16), dv = new DataView(buf.buffer), p = 0;
    const room = (n) => { if (p + n <= buf.length) return; let m = buf.length * 2; while (m < p + n) m *= 2; const b = new Uint8Array(m); b.set(buf); buf = b; dv = new DataView(buf.buffer); };
    const str = (s) => { const b = utf8e.encode(s); room(2 + b.length); dv.setUint16(p, b.length); p += 2; buf.set(b, p); p += b.length; };
    const put = (t, v) => {
      if (v instanceof Tag) v = v.v;
      switch (t) {
        case 1: room(1); dv.setInt8(p++, typeof v === 'boolean' ? +v : v); return;
        case 2: room(2); dv.setInt16(p, v); p += 2; return;
        case 3: room(4); dv.setInt32(p, v); p += 4; return;
        case 4: room(8); dv.setBigInt64(p, BigInt.asIntN(64, BigInt(v))); p += 8; return;
        case 5: room(4); dv.setFloat32(p, v); p += 4; return;
        case 6: room(8); dv.setFloat64(p, v); p += 8; return;
        case 7: room(4 + v.length); dv.setInt32(p, v.length); p += 4; buf.set(new Uint8Array(v.buffer, v.byteOffset, v.length), p); p += v.length; return;
        case 8: str(v); return;
        case 9: {
          const et = v.length ? tagOf(v[0]) : 0;
          room(5); dv.setUint8(p++, et); dv.setInt32(p, v.length); p += 4;
          for (const x of v) put(et, x);
          return;
        }
        case 10:
          for (const k in v) { const x = v[k]; if (x === undefined || x === null) continue; const ct = tagOf(x); room(1); dv.setUint8(p++, ct); str(k); put(ct, x); }
          room(1); dv.setUint8(p++, 0); return;
        case 11: room(4 + v.length * 4); dv.setInt32(p, v.length); p += 4; for (let i = 0; i < v.length; i++, p += 4) dv.setInt32(p, v[i]); return;
        case 12: room(4 + v.u32.length * 4); dv.setInt32(p, v.length); p += 4; for (let i = 0; i < v.u32.length; i++, p += 4) dv.setUint32(p, v.u32[i]); return;
      }
      throw new Error('NBT: cannot write tag ' + t);
    };
    room(3); dv.setUint8(p++, 10); str(''); put(10, value);
    return buf.slice(0, p);
  }
  // compressing the same ways: 'gzip' (player files) or 'deflate' (zlib, region chunks)
  async function deflate(bytes, format) {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
    return new Uint8Array(await new Response(cs).arrayBuffer());
  }
  const NBT = { parse, inflate, Longs, write, deflate, Tag, byte: tag(1), short: tag(2), int: tag(3), long: tag(4), float: tag(5), double: tag(6) };
  if (typeof module !== 'undefined' && module.exports) module.exports = NBT;
  else root.NBT = NBT;
})(typeof self !== 'undefined' ? self : globalThis);
