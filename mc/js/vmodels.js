'use strict';
// ---------------------------------------------------------------------------
// Vanilla block models (data from tools/build_models.py -> models.js)
// Blockstate variants / multipart select model elements; elements are baked into quads (element
// rotation, variant x/y rotation, uvlock, face UV rotation) and meshed with vanilla-style smooth
// lighting: faces flush with the block boundary take their light and AO from the neighbouring
// layer, inner faces from the block itself, interpolated across the face like vanilla does.
// ---------------------------------------------------------------------------
const VM = {
  ready: false, baked: new Map(),
  DIR: { west: 0, east: 1, down: 2, up: 3, north: 4, south: 5 },
  init() {
    const D = window.VMODELS;
    if (!D) return;
    this.data = D;
    this.ready = true;
  },
  has(key) { return this.ready && !!this.data.blocks[key]; },

  // ---- baking -----------------------------------------------------------------------------
  // returns baked quads for (model, x rot, y rot, uvlock): { p: [4][3] (0..1), uv: [4][2], layer, anim, tint, cull, dir, shade, n }
  bake(mi, rx = 0, ry = 0, uvlock = false) {
    const key = mi + ':' + rx + ':' + ry + ':' + (uvlock ? 1 : 0);
    let out = this.baked.get(key);
    if (out) return out;
    out = [];
    const model = this.data.models[mi];
    const vrot = (p) => rotVariant(p, rx, ry);
    for (const el of model.elements || []) {
      const f = el.from.map(v => v / 16), t = el.to.map(v => v / 16);
      for (const fname in el.faces) {
        const fd = el.faces[fname], fi = this.DIR[fname], F = FACES[fi];
        const layer = T(fd.tex);
        if (layer === undefined || layer < 0) continue;
        const pts = F.c.map(c => [c[0] ? t[0] : f[0], c[1] ? t[1] : f[1], c[2] ? t[2] : f[2]]);
        // vanilla UV: the default orientation for this face, mapped onto the face's uv rectangle
        const span = (a, lo, hi) => hi - lo > 1e-6 ? (a - lo) / (hi - lo) : 0;
        let uvs = pts.map(p => {
          let tu, tv;
          switch (fi) {
            case 0: tu = span(p[2], f[2], t[2]); tv = span(t[1] - p[1] + f[1], f[1], t[1]); break;
            case 1: tu = span(t[2] - p[2] + f[2], f[2], t[2]); tv = span(t[1] - p[1] + f[1], f[1], t[1]); break;
            case 2: tu = span(p[0], f[0], t[0]); tv = span(t[2] - p[2] + f[2], f[2], t[2]); break;
            case 3: tu = span(p[0], f[0], t[0]); tv = span(p[2], f[2], t[2]); break;
            case 4: tu = span(t[0] - p[0] + f[0], f[0], t[0]); tv = span(t[1] - p[1] + f[1], f[1], t[1]); break;
            default: tu = span(p[0], f[0], t[0]); tv = span(t[1] - p[1] + f[1], f[1], t[1]); break;
          }
          // face texture rotation (clockwise)
          const r = ((fd.rot || 0) / 90) & 3;
          if (r === 1) [tu, tv] = [tv, 1 - tu]; else if (r === 2) [tu, tv] = [1 - tu, 1 - tv]; else if (r === 3) [tu, tv] = [1 - tv, tu];
          const uv = fd.uv;
          return [(uv[0] + (uv[2] - uv[0]) * tu) / 16, (uv[1] + (uv[3] - uv[1]) * tv) / 16];
        });
        // element rotation
        let P = pts;
        if (el.rot && el.rot.angle) P = P.map(p => rotElement(p, el.rot));
        // variant rotation
        P = P.map(vrot);
        let n = rotVariant([0.5 + F.n[0], 0.5 + F.n[1], 0.5 + F.n[2]], rx, ry).map(v => v - 0.5);
        if (el.rot && el.rot.angle) { const e = rotElement([0.5 + F.n[0], 0.5 + F.n[1], 0.5 + F.n[2]], { ...el.rot, origin: [8, 8, 8], rescale: false }); n = rotVariant(e, rx, ry).map(v => v - 0.5); }
        const dir = axisDir(n);
        if (uvlock && (rx || ry) && dir >= 0) uvs = P.map(p => FACES[dir].uv(p[0], p[1], p[2]));
        let cull = -1;
        if (fd.cull) { const c = FACES[this.DIR[fd.cull]].n; cull = axisDir(rotVariant([0.5 + c[0], 0.5 + c[1], 0.5 + c[2]], rx, ry).map(v => v - 0.5)); }
        out.push({ p: P, uv: uvs, layer, anim: ANIM_FRAMES[layer], tint: fd.tint, cull, dir, shade: el.shade !== false, n, ao: model.ao });
      }
    }
    this.baked.set(key, out);
    return out;
  },

  // ---- blockstate selection ------------------------------------------------------------------
  select(key, props, h) {
    const bs = this.data.blocks[key];
    const out = [];
    const pick = (list) => {
      if (list.length === 1) return list[0];
      let tot = 0; for (const v of list) tot += v.w;
      let r = h * tot; for (const v of list) { r -= v.w; if (r < 0) return v; }
      return list[0];
    };
    if (bs.variants) {
      for (const [cond, list] of bs.variants) {
        let ok = true;
        for (const k in cond) if (String(props[k]) !== cond[k]) { ok = false; break; }
        if (ok) { const v = pick(list); out.push(this.bake(v.m, v.x, v.y, v.uvlock)); break; }
      }
    } else {
      for (const [when, list] of bs.multipart) if (!when || matchWhen(when, props)) { const v = pick(list); out.push(this.bake(v.m, v.x, v.y, v.uvlock)); }
    }
    return out;
  },
};

function matchWhen(w, props) {
  if (w.OR) return w.OR.some(c => matchWhen(c, props));
  if (w.AND) return w.AND.every(c => matchWhen(c, props));
  for (const k in w) if (!String(w[k]).split('|').includes(String(props[k]))) return false;
  return true;
}
function axisDir(n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ax > 0.99) return n[0] < 0 ? 0 : 1;
  if (ay > 0.99) return n[1] < 0 ? 2 : 3;
  if (az > 0.99) return n[2] < 0 ? 4 : 5;
  return -1;
}
// standard right-handed rotation of p (0..1 block space) about an axis through o
function rotAxis(p, o, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
  if (axis === 'x') return [p[0], o[1] + y * c - z * s, o[2] + y * s + z * c];
  if (axis === 'y') return [o[0] + x * c + z * s, p[1], o[2] - x * s + z * c];
  return [o[0] + x * c - y * s, o[1] + x * s + y * c, p[2]];
}
function rotElement(p, r) {
  const o = r.origin.map(v => v / 16), a = r.angle * Math.PI / 180;
  let q = rotAxis(p, o, r.axis, a);
  if (r.rescale) {
    const k = 1 / Math.cos(Math.abs(a) > Math.PI / 8 ? Math.PI / 4 : Math.PI / 8);
    q = q.map((v, i) => ('xyz'[i] === r.axis) ? v : o[i] + (v - o[i]) * k);
  }
  return q;
}
// blockstate rotation: x first, then y, both clockwise in vanilla's sense (= negative right-handed)
function rotVariant(p, rx, ry) {
  let q = p;
  if (rx) q = rotAxis(q, [0.5, 0.5, 0.5], 'x', -rx * Math.PI / 180);
  if (ry) q = rotAxis(q, [0.5, 0.5, 0.5], 'y', -ry * Math.PI / 180);
  return q.map(v => Math.round(v * 1e5) / 1e5);
}

// ---- our block metadata -> vanilla blockstate properties ----------------------------------------
const FACING4 = ['east', 'west', 'south', 'north']; // doors & stairs: meta & 3
const DIR_VEC = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };
const OPPOSITE = { north: 'south', south: 'north', west: 'east', east: 'west' };
// get(dx, dy, dz) -> [id, meta] of a neighbour
// fences, walls, panes and bars: which horizontal neighbours they join (bits: 1 west, 2 east, 4 north, 8 south)
function connects(b, nid) {
  if (SOLIDCUBE[nid]) return true;
  const nb = BLOCKS[nid];
  if (!nb) return false;
  if (nb.fence) {
    if (nb.fence === b.fence) return true;
    if ((b.fence === 'wall' || b.fence === 'pane') && (nb.fence === 'wall' || nb.fence === 'pane')) return true;
  }
  return !!nb.gate && b.fence !== 'pane';
}
function connBits(b, idAt) {
  let m = 0;
  if (connects(b, idAt(-1, 0))) m |= 1; if (connects(b, idAt(1, 0))) m |= 2;
  if (connects(b, idAt(0, -1))) m |= 4; if (connects(b, idAt(0, 1))) m |= 8;
  return m;
}
function vanillaState(b, meta, get) {
  const k = b.key;
  if (b.states) return { key: k, p: b.states[meta] || b.states[0] };
  if (b.stairs) {
    const facing = FACING4[meta & 3], half = meta & 4 ? 'top' : 'bottom';
    const st = (dx, dz) => { if (!get) return null; const [id, m] = get(dx, 0, dz); return BLOCKS[id] && BLOCKS[id].stairs ? { facing: FACING4[m & 3], half: m & 4 ? 'top' : 'bottom' } : null; };
    // vanilla stair shapes: join with a perpendicular stair behind (outer) or in front (inner)
    const canTake = (face) => { const v = DIR_VEC[face], o = st(v[0], v[1]); return !o || o.facing !== facing || o.half !== half; };
    let shape = 'straight';
    const fv = DIR_VEC[facing], back = st(fv[0], fv[1]);
    if (back && back.half === half && DIR_VEC[back.facing][0] !== 0 !== (fv[0] !== 0) && canTake(OPPOSITE[back.facing])) shape = back.facing === CCW[facing] ? 'outer_left' : 'outer_right';
    else {
      const front = st(-fv[0], -fv[1]);
      if (front && front.half === half && DIR_VEC[front.facing][0] !== 0 !== (fv[0] !== 0) && canTake(front.facing)) shape = front.facing === CCW[facing] ? 'inner_left' : 'inner_right';
    }
    return { key: k, p: { facing, half, shape } };
  }
  if (b.slab) return { key: k, p: { type: ['bottom', 'top', 'double', 'double'][meta & 3] } };
  if (b.fence) {
    // connections come from the neighbours (meta holds them when there are none to look at)
    const m = get ? connBits(b, (dx, dz) => get(dx, 0, dz)[0]) : meta;
    if (b.fence === 'wall') {
      const lone = (m === 3 || m === 12), above = get ? get(0, 1, 0)[0] : 0, tall = SOLIDCUBE[above] || (BLOCKS[above] && BLOCKS[above].fence === 'wall');
      const side = (bit) => (m & bit) ? (tall ? 'tall' : 'low') : 'none';
      return { key: k, p: { west: side(1), east: side(2), north: side(4), south: side(8), up: !lone || (BLOCKS[above] && BLOCKS[above].fence === 'wall') ? true : false } };
    }
    return { key: k, p: { west: !!(m & 1), east: !!(m & 2), north: !!(m & 4), south: !!(m & 8) } };
  }
  if (b.bed) return { key: k, p: { facing: ['north', 'east', 'south', 'west'][meta & 3], part: meta & 4 ? 'head' : 'foot', occupied: false } };
  if (b.door) return { key: k, p: { facing: FACING4[meta & 3], half: meta & 8 ? 'upper' : 'lower', open: !!(meta & 4), hinge: meta & 16 ? 'right' : 'left' } };
  if (b.trapdoor) return { key: k, p: { facing: ['north', 'south', 'west', 'east'][meta & 3], half: meta & 8 ? 'top' : 'bottom', open: !!(meta & 4) } };
  if (b.ladder) return { key: k, p: { facing: { 0: 'east', 1: 'west', 4: 'south', 5: 'north' }[meta] || 'north' } };
  switch (k) {
    case 'torch': return meta ? { key: 'wall_torch', p: { facing: { 0: 'east', 1: 'west', 4: 'south', 5: 'north' }[meta] || 'north' } } : { key: 'torch', p: {} };
    case 'farmland': return { key: k, p: { moisture: meta ? 7 : 0 } };
    case 'snow': return { key: k, p: { layers: (meta & 7) + 1 } };
    case 'wheat': return { key: k, p: { age: meta & 7 } };
    case 'nether_wart': return { key: k, p: { age: Math.min(3, meta & 3) } };
    case 'end_portal_frame': return { key: k, p: { eye: !!(meta & 4), facing: 'south' } };
    case 'nether_portal': return { key: k, p: { axis: meta & 1 ? 'z' : 'x' } };
  }
  return { key: k, p: {} };
}

// ---- meshing ----------------------------------------------------------------------------------
Mesher.vmodel = function (b, meta, x, y, z, ox, oy, oz, single) {
  const ids = this.ids, metas = this.metas, lights = this.lights;
  const get = (dx, dy, dz) => { const i = this.P(x + dx, y + dy, z + dz); return [ids[i], metas[i]]; };
  const st = vanillaState(b, meta, get);
  if (!VM.data.blocks[st.key]) return false;
  const h = hash3(ox + x, oy + y, oz + z, 1234);
  const parts = VM.select(st.key, st.p, h);
  const buf = b.render === 'translucent' ? this.transBuf : this.opaqueBuf;
  const tintC = b.tint ? this.tintOf(b, x, z) : null;
  const own = lights[this.P(x, y, z)];
  const fast = FAST_LEAVES && !single && LEAF_BLOCK[ids[this.P(x, y, z)]], ovl = fast ? SOLID_LEAF : 0;
  for (const quads of parts) for (const q of quads) {
    if (!single && q.cull >= 0) {
      const n = FACES[q.cull].n, nid = ids[this.P(x + n[0], y + n[1], z + n[2])];
      if (SOLIDCUBE[nid] || (fast && LEAF_BLOCK[nid])) continue;
      // half-transparent blocks hide the faces they share with their own kind (vanilla skipRendering): without it
      // the inner faces of a heap of powder snow, drawn later in the translucent pass, covered its top
      if (b.cullSame && nid === b.id) continue;
    }
    let r = 255, g = 255, bl = 255;
    if (q.tint >= 0) { const tc = tintC || this.tintOf({ tint: 'grass' }, x, z); r = tc[0]; g = tc[1]; bl = tc[2]; }
    const shadeF = q.shade && q.dir >= 0 ? FACE_SHADE[q.dir] : (q.shade ? 0.8 + 0.2 * Math.max(0, q.n[1]) : 1);
    if (single) {
      for (let k = 0; k < 4; k++) buf.v(ox + x + q.p[k][0], oy + y + q.p[k][1], oz + z + q.p[k][2], q.uv[k][0], q.uv[k][1], q.layer, 0, r, g, bl, Math.round(shadeF * 255), 255, 255, q.anim);
      continue;
    }
    if (q.dir < 0) {
      // free-standing planes (crosses, rotated torch parts): the block's own light, no AO
      const s = Math.round((own >> 4) * 17), k2 = Math.round((own & 15) * 17), sh = Math.round(shadeF * 255);
      for (let k = 0; k < 4; k++) buf.v(ox + x + q.p[k][0], oy + y + q.p[k][1], oz + z + q.p[k][2], q.uv[k][0], q.uv[k][1], q.layer, ovl, r, g, bl, sh, s, k2, q.anim);
      continue;
    }
    // axis-aligned: smooth light from the layer in front of the face (flush) or the block's own layer
    const F = FACES[q.dir], n = F.n;
    const axis = n[0] ? 0 : n[1] ? 1 : 2, plane = n[axis] > 0 ? 1 : 0;
    const flush = q.p.every(p => Math.abs(p[axis] - plane) < 1e-4);
    const C = this.faceCorners(x, y, z, q.dir, flush, q.ao);
    // tangent axes of this face (where the corner pattern varies)
    const ta = [0, 1, 2].filter(i => i !== axis);
    for (let k = 0; k < 4; k++) {
      const p = q.p[k], u = clamp(p[ta[0]], 0, 1), v = clamp(p[ta[1]], 0, 1);
      let a = 0, sk = 0, bk = 0;
      for (let c = 0; c < 4; c++) {
        const cc = F.c[c], w = (cc[ta[0]] ? u : 1 - u) * (cc[ta[1]] ? v : 1 - v);
        a += C.ao[c] * w; sk += C.sk[c] * w; bk += C.bk[c] * w;
      }
      buf.v(ox + x + p[0], oy + y + p[1], oz + z + p[2], q.uv[k][0], q.uv[k][1], q.layer, ovl, r, g, bl,
        Math.round(shadeF * a * 255), Math.round(sk * 17), Math.round(bk * 17), q.anim);
    }
  }
  return true;
};
// AO / light at the 4 corners (FACES order) of the block face in direction f
Mesher.faceCorners = function (x, y, z, f, flush, useAO) {
  const ids = this.ids, lights = this.lights, F = FACES[f], n = F.n;
  const fx = x + (flush ? n[0] : 0), fy = y + (flush ? n[1] : 0), fz = z + (flush ? n[2] : 0);
  const ao = [1, 1, 1, 1], sk = [0, 0, 0, 0], bk = [0, 0, 0, 0];
  const p0 = this.P(fx, fy, fz);
  const front = flush && useAO ? AOCUBE[ids[p0]] : 0;
  let base = lights[p0];
  if (!flush) { const pn = this.P(x + n[0], y + n[1], z + n[2]); base = Math.max(base >> 4, lights[pn] >> 4) << 4 | Math.max(base & 15, lights[pn] & 15); }
  for (let k = 0; k < 4; k++) {
    const c = F.c[k];
    let s1x = 0, s1y = 0, s1z = 0, s2x = 0, s2y = 0, s2z = 0;
    if (n[0]) { s1y = c[1] ? 1 : -1; s2z = c[2] ? 1 : -1; }
    else if (n[1]) { s1x = c[0] ? 1 : -1; s2z = c[2] ? 1 : -1; }
    else { s1x = c[0] ? 1 : -1; s2y = c[1] ? 1 : -1; }
    const p1 = this.P(fx + s1x, fy + s1y, fz + s1z), p2 = this.P(fx + s2x, fy + s2y, fz + s2z), p3 = this.P(fx + s1x + s2x, fy + s1y + s2y, fz + s1z + s2z);
    const o1 = SOLIDCUBE[ids[p1]], o2 = SOLIDCUBE[ids[p2]], o3 = SOLIDCUBE[ids[p3]];
    if (useAO) {
      const a1 = AOCUBE[ids[p1]], a2 = AOCUBE[ids[p2]], a3 = (a1 && a2) ? 1 : AOCUBE[ids[p3]];
      ao[k] = (4 - (front + a1 + a2 + a3) * 0.8) / 4;
    }
    let ls = base >> 4, lb = base & 15, cnt = 1;
    if (flush) {
      if (!o1) { ls += lights[p1] >> 4; lb += lights[p1] & 15; cnt++; }
      if (!o2) { ls += lights[p2] >> 4; lb += lights[p2] & 15; cnt++; }
      if (!o3 && !(o1 && o2)) { ls += lights[p3] >> 4; lb += lights[p3] & 15; cnt++; }
    }
    sk[k] = ls / cnt; bk[k] = lb / cnt;
  }
  return { ao, sk, bk };
};

VM.init();
