'use strict';
// ---------------------------------------------------------------------------
// Vanilla TreeFeature: trunk placers, foliage placers, root placer, feature sizes and decorators,
// following the algorithms (and random call order) of the 1.18+ tree code.
// ---------------------------------------------------------------------------
(() => {
  const F = Features, { stateOf, provider, predicate, intProvider, msin, mcos, withProp, tagSet } = F;
  const strip = (s) => typeof s === 'string' ? s.replace('minecraft:', '') : s;
  const HDIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // Direction.Plane.HORIZONTAL: north east south west
  const AXIS_META = { y: 0, x: 1, z: 2 };

  function compileTree(c) {
    const H = F.helpers();
    const T = {
      c, H,
      trunkP: provider(c.trunk_provider), foliageP: provider(c.foliage_provider),
      belowP: c.below_trunk_provider ? provider(c.below_trunk_provider) : (c.dirt_provider ? provider(c.dirt_provider) : null),
      tp: c.trunk_placer, fp: c.foliage_placer, size: c.minimum_size,
      ignoreVines: !!c.ignore_vines, forceDirt: !!c.force_dirt,
      decorators: (c.decorators || []).map(d => ({ t: strip(d.type), d })),
      root: c.root_placer || null,
    };
    const tp = T.tp, tt = strip(tp.type);
    T.tpType = tt;
    T.canGrowThrough = tp.can_grow_through ? tagSet(tp.can_grow_through) : null;
    if (tt === 'cherry_trunk_placer') {
      T.branchCount = intProvider(tp.branch_count); T.branchLen = intProvider(tp.branch_horizontal_length);
      const s = tp.branch_start_offset_from_top; T.branchStart = intProvider({ type: 'uniform', min_inclusive: s.min_inclusive, max_inclusive: s.max_inclusive });
      T.branchStart2 = intProvider({ type: 'uniform', min_inclusive: s.min_inclusive, max_inclusive: s.max_inclusive - 1 });
      T.branchEnd = intProvider(tp.branch_end_offset_from_top);
    }
    if (tt === 'bending_trunk_placer') T.bendLength = intProvider(tp.bend_length);
    if (tt === 'upwards_branching_trunk_placer') { T.exLen = intProvider(tp.extra_branch_length); T.exSteps = intProvider(tp.extra_branch_steps); }
    const fp = T.fp;
    T.fpType = strip(fp.type);
    T.radius = intProvider(fp.radius); T.offset = intProvider(fp.offset);
    if (fp.height !== undefined && typeof fp.height !== 'number') T.heightP = intProvider(fp.height);
    if (fp.trunk_height !== undefined) T.trunkHeightP = intProvider(fp.trunk_height);
    if (fp.crown_height !== undefined) T.crownP = intProvider(fp.crown_height);
    if (fp.foliage_height !== undefined) T.foliageHeightP = intProvider(fp.foliage_height);
    return T;
  }

  F.FEATURE.tree = (ctx, cfg, r, x, y, z) => {
    const T = cfg.tree || (cfg.tree = compileTree(cfg.raw));
    const R = ctx.R, H = T.H;
    const roots = new Map(), logs = new Map(), leaves = new Map(), deco = new Map();
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const S = {
      R, r, T,
      setLog: (x, y, z, s) => { if (!s) return; R.set(x, y, z, s[0], s[1]); logs.set(key(x, y, z), [x, y, z]); },
      setLeaf: (x, y, z, s) => { if (!s) return; R.set(x, y, z, s[0], s[1]); leaves.set(key(x, y, z), [x, y, z]); },
      setRoot: (x, y, z, s) => { if (!s) return; R.set(x, y, z, s[0], s[1]); roots.set(key(x, y, z), [x, y, z]); },
      leafSet: (x, y, z) => leaves.has(key(x, y, z)),
    };
    if (!doPlace(S, x, y, z)) return false;
    if (!logs.size && !leaves.size) return false;
    if (T.decorators.length) {
      const byY = (m) => [...m.values()].sort((a, b) => a[1] - b[1]);
      const D = { R, r, logs: byY(logs), leaves: byY(leaves), roots: byY(roots), set: (x, y, z, s) => { if (s) { R.set(x, y, z, s[0], s[1]); deco.set(key(x, y, z), 1); } }, isAir: (x, y, z) => R.isAir(x, y, z) };
      for (const d of T.decorators) decorate(D, d, T);
    }
    return true;
  };

  // ---- TreeFeature.doPlace ---------------------------------------------------------------------------
  const isFreeTree = (S, x, y, z) => validTreePos(S, x, y, z) || S.T.H.LOGS.has(S.R.id(x, y, z));
  // TreeFeature.validTreePos: air or a block trees replace - what leaves and roots may take
  function baseTreePos(S, x, y, z) {
    const id = S.R.id(x, y, z);
    return id === 0 || S.T.H.REPLACE_TREES.has(id);
  }
  // TrunkPlacer.validTreePos: the upwards-branching placer (mangroves) also grows through its can_grow_through
  // blocks. Only logs use this one: leaves going by it overwrote the mangrove logs (mangrove_log is in that tag),
  // and the trunkless leaves then decayed by the thousand into dropped items
  function validTreePos(S, x, y, z) {
    if (baseTreePos(S, x, y, z)) return true;
    return !!S.T.canGrowThrough && S.T.canGrowThrough.has(S.R.id(x, y, z));
  }
  function placeLog(S, x, y, z, axis) {
    if (!validTreePos(S, x, y, z)) return false;
    let s = S.T.trunkP(S.r, x, y, z, S.R);
    if (s && axis && BLOCKS[s[0]] && BLOCKS[s[0]].axis) s = [s[0], AXIS_META[axis]];
    S.setLog(x, y, z, s);
    return true;
  }
  const placeLogIfFree = (S, x, y, z) => { if (isFreeTree(S, x, y, z)) placeLog(S, x, y, z); };
  function setDirtAt(S, x, y, z) {
    const R = S.R, T = S.T;
    if (!T.belowP) return;
    if (!T.forceDirt && T.H.DIRT.has(R.id(x, y, z)) && R.id(x, y, z) !== BID.grass_block && R.id(x, y, z) !== BID.mycelium) return;
    const s = T.belowP(S.r, x, y, z, R);
    if (s) R.set(x, y, z, s[0], s[1]);
  }
  function sizeAt(T, h, j) {
    const s = T.size, t = strip(s.type);
    if (t === 'three_layers_feature_size') {
      const limit = s.limit ?? 1, upperLimit = s.upper_limit ?? 1;
      if (j < limit) return s.lower_size ?? 0;
      if (j >= h - upperLimit) return s.upper_size ?? 1;
      return s.middle_size ?? 1;
    }
    return j < (s.limit ?? 1) ? (s.lower_size ?? 0) : (s.upper_size ?? 1);
  }
  function doPlace(S, x, y, z) {
    const T = S.T, R = S.R, r = S.r, tp = T.tp;
    const h = tp.base_height + r.nextInt(tp.height_rand_a + 1) + r.nextInt(tp.height_rand_b + 1);
    const fh = foliageHeight(S, h);
    const k = h - fh;
    const rad = foliageRadius(S, k);
    let tx = x, ty = y, tz = z;
    if (T.root) { const o = rootTrunkOrigin(S, x, y, z); tx = o[0]; ty = o[1]; tz = o[2]; }
    const lo = Math.min(y, ty), hi = Math.max(y, ty) + h + 1;
    if (lo < R.minY + 1 || hi > R.maxY) return false;
    const minClip = T.size.min_clipped_height;
    let free = h;
    outer: for (let j = 0; j <= h + 1; j++) {
      const s = sizeAt(T, h, j);
      for (let l = -s; l <= s; l++) for (let m = -s; m <= s; m++) {
        if (isFreeTree(S, tx + l, ty + j, tz + m) && (T.ignoreVines || R.id(tx + l, ty + j, tz + m) !== BID.vine)) continue;
        free = j - 2; break outer;
      }
    }
    if (free < h && (minClip === undefined || free < minClip)) return false;
    if (T.root && !placeRoots(S, x, y, z, tx, ty, tz)) return false;
    const att = placeTrunk(S, free, tx, ty, tz);
    const off = T.offset(r);
    for (const a of att) createFoliage(S, free, a, fh, rad, off);
    return true;
  }

  // ---- trunk placers (return foliage attachments {x,y,z,ro,dbl}) ------------------------------------------------
  const A = (x, y, z, ro = 0, dbl = false) => ({ x, y, z, ro, dbl });
  function placeTrunk(S, h, x, y, z) {
    const T = S.T, r = S.r;
    switch (T.tpType) {
      case 'straight_trunk_placer': {
        setDirtAt(S, x, y - 1, z);
        for (let j = 0; j < h; j++) placeLog(S, x, y + j, z);
        return [A(x, y + h, z)];
      }
      case 'forking_trunk_placer': {
        setDirtAt(S, x, y - 1, z);
        const out = [], d = HDIRS[r.nextInt(4)];
        const j = h - r.nextInt(4) - 1;
        let k = 3 - r.nextInt(3), lx = x, lz = z, top = null;
        for (let n = 0; n < h; n++) {
          const o = y + n;
          if (n >= j && k > 0) { lx += d[0]; lz += d[1]; k--; }
          if (placeLog(S, lx, o, lz)) top = o + 1;
        }
        if (top !== null) out.push(A(lx, top, lz, 1));
        lx = x; lz = z;
        const d2 = HDIRS[r.nextInt(4)];
        if (d2 !== d) {
          const o = j - r.nextInt(2) - 1;
          let p = 1 + r.nextInt(3);
          top = null;
          for (let q = o; q < h && p > 0; q++, p--) {
            if (q < 1) continue;
            const ry = y + q;
            lx += d2[0]; lz += d2[1];
            if (placeLog(S, lx, ry, lz)) top = ry + 1;
          }
          if (top !== null) out.push(A(lx, top, lz, 0));
        }
        return out;
      }
      case 'giant_trunk_placer': case 'mega_jungle_trunk_placer': {
        setDirtAt(S, x, y - 1, z); setDirtAt(S, x + 1, y - 1, z); setDirtAt(S, x, y - 1, z + 1); setDirtAt(S, x + 1, y - 1, z + 1);
        for (let j = 0; j < h; j++) {
          placeLogIfFree(S, x, y + j, z);
          if (j >= h - 1) continue;
          placeLogIfFree(S, x + 1, y + j, z); placeLogIfFree(S, x + 1, y + j, z + 1); placeLogIfFree(S, x, y + j, z + 1);
        }
        const out = [A(x, y + h, z, 0, true)];
        if (T.tpType === 'mega_jungle_trunk_placer') {
          for (let j = h - 2 - r.nextInt(4); j > (h / 2 | 0); j -= 2 + r.nextInt(4)) {
            const f = r.nextFloat() * (Math.PI * 2);
            let k = 0, l = 0;
            for (let m = 0; m < 5; m++) {
              k = Math.trunc(1.5 + mcos(f) * m); l = Math.trunc(1.5 + msin(f) * m);
              placeLog(S, x + k, y + j - 3 + (m >> 1), z + l);
            }
            out.push(A(x + k, y + j, z + l, -2));
          }
        }
        return out;
      }
      case 'dark_oak_trunk_placer': {
        setDirtAt(S, x, y - 1, z); setDirtAt(S, x + 1, y - 1, z); setDirtAt(S, x, y - 1, z + 1); setDirtAt(S, x + 1, y - 1, z + 1);
        const out = [], d = HDIRS[r.nextInt(4)];
        const j = h - r.nextInt(4);
        let k = 2 - r.nextInt(3), o = x, p = z;
        const q = y + h - 1;
        for (let rr = 0; rr < h; rr++) {
          if (rr >= j && k > 0) { o += d[0]; p += d[1]; k--; }
          const s = y + rr, id = S.R.id(o, s, p);
          if (!(id === 0 || T.H.LEAVES.has(id))) continue;
          placeLog(S, o, s, p); placeLog(S, o + 1, s, p); placeLog(S, o, s, p + 1); placeLog(S, o + 1, s, p + 1);
        }
        out.push(A(o, q, p, 0, true));
        for (let rr = -1; rr <= 2; rr++) for (let s = -1; s <= 2; s++) {
          if ((rr >= 0 && rr <= 1 && s >= 0 && s <= 1) || r.nextInt(3) > 0) continue;
          const t = r.nextInt(3) + 2;
          for (let u = 0; u < t; u++) placeLog(S, x + rr, q - u - 1, z + s);
          out.push(A(x + rr, q, z + s));
        }
        return out;
      }
      case 'fancy_trunk_placer': return fancyTrunk(S, h, x, y, z);
      case 'bending_trunk_placer': {
        const d = HDIRS[r.nextInt(4)], j = h - 1, out = [];
        let px = x, py = y, pz = z;
        setDirtAt(S, x, y - 1, z);
        for (let k = 0; k <= j; k++) {
          if (k + 1 >= j + r.nextInt(2)) { px += d[0]; pz += d[1]; }
          if (validTreePos(S, px, py, pz)) placeLog(S, px, py, pz);
          if (k >= T.tp.min_height_for_leaves) out.push(A(px, py, pz));
          py++;
        }
        const k = T.bendLength(r);
        for (let l = 0; l <= k; l++) {
          if (validTreePos(S, px, py, pz)) placeLog(S, px, py, pz);
          out.push(A(px, py, pz));
          px += d[0]; pz += d[1];
        }
        return out;
      }
      case 'upwards_branching_trunk_placer': {
        const out = [], tp = T.tp;
        for (let j = 0; j < h; j++) {
          const k = y + j;
          if (placeLog(S, x, k, z) && j < h - 1 && r.nextFloat() < tp.place_branch_per_log_probability) {
            const d = HDIRS[r.nextInt(4)], l = T.exLen(r), m = Math.max(0, l - T.exLen(r) - 1), n = T.exSteps(r);
            let nn = k + m, o = x, p = z, q = m, steps = n;
            while (q < h && steps > 0) {
              if (q >= 1) {
                const rr = k + q;
                nn = rr;
                o += d[0]; p += d[1];
                if (placeLog(S, o, rr, p)) nn++;
                out.push(A(o, rr, p));
              }
              q++; steps--;
            }
            if (nn - k > 1) { out.push(A(o, nn, p)); out.push(A(o, nn - 2, p)); }
          }
          if (j === h - 1) out.push(A(x, k + 1, z));
        }
        return out;
      }
      case 'cherry_trunk_placer': {
        setDirtAt(S, x, y - 1, z);
        const j = Math.max(0, h - 1 + T.branchStart(r));
        let k = Math.max(0, h - 1 + T.branchStart2(r));
        if (k >= j) k++;
        const l = T.branchCount(r), three = l === 3, two = l >= 2;
        const m = three ? h : two ? Math.max(j, k) + 1 : j + 1;
        for (let n = 0; n < m; n++) placeLog(S, x, y + n, z);
        const out = [];
        if (three) out.push(A(x, y + m, z));
        const di = r.nextInt(4), d = HDIRS[di];
        out.push(cherryBranch(S, h, x, y, z, d, j, j < m - 1));
        if (two) out.push(cherryBranch(S, h, x, y, z, [-d[0], -d[1]], k, k < m - 1));
        return out;
      }
    }
    return [];
  }
  function cherryBranch(S, h, x, y, z, d, j, bl) {
    const T = S.T, r = S.r, axis = d[0] ? 'x' : 'z';
    let px = x, py = y + j, pz = z;
    const kk = h - 1 + T.branchEnd(r), bl2 = bl || kk < j, ll = T.branchLen(r) + (bl2 ? 1 : 0);
    const ex = x + d[0] * ll, ey = y + kk, ez = z + d[1] * ll;
    const mm = bl2 ? 2 : 1;
    for (let n = 0; n < mm; n++) { px += d[0]; pz += d[1]; placeLog(S, px, py, pz, axis); }
    const dy = ey > py ? 1 : -1;
    let o;
    while ((o = Math.abs(px - ex) + Math.abs(py - ey) + Math.abs(pz - ez)) !== 0) {
      const f = Math.fround(Math.abs(ey - py) / o), vert = S.r.nextFloat() < f;
      if (vert) py += dy; else { px += d[0]; pz += d[1]; }
      placeLog(S, px, py, pz, vert ? null : axis);
    }
    return A(ex, ey + 1, ez);
  }
  function fancyTrunk(S, h, x, y, z) {
    const r = S.r, l = h + 2, m = Math.floor(l * 0.618);
    setDirtAt(S, x, y - 1, z);
    const n = Math.min(1, Math.floor(1.382 + Math.pow(1 * l / 13, 2)));
    const o = y + m;
    const list = [{ p: [x, y + m, z], base: o }];
    for (let k = l - 5; k >= 0; k--) {
      const f = treeShape(l, k);
      if (f < 0) continue;
      for (let p = 0; p < n; p++) {
        const e = 1 * f * (r.nextFloat() + 0.328), hh = (r.nextFloat() * 2) * Math.PI;
        const q = e * Math.sin(hh) + 0.5, g = e * Math.cos(hh) + 0.5;
        const p2 = [x + Math.floor(q), y + k - 1, z + Math.floor(g)], p3 = [p2[0], p2[1] + 5, p2[2]];
        if (!makeLimb(S, p2, p3, false)) continue;
        const rx = x - p2[0], rz = z - p2[2];
        const t = p2[1] - Math.sqrt(rx * rx + rz * rz) * 0.381;
        const u = t > o ? o : Math.trunc(t);
        const p4 = [x, u, z];
        if (!makeLimb(S, p4, p2, false)) continue;
        list.push({ p: p2, base: p4[1] });
      }
    }
    makeLimb(S, [x, y, z], [x, y + m, z], true);
    for (const fc of list) {
      const j = fc.base, p2 = [x, j, z];
      if ((p2[0] === fc.p[0] && p2[1] === fc.p[1] && p2[2] === fc.p[2]) || !(j - y >= l * 0.2)) continue;
      makeLimb(S, p2, fc.p, true);
    }
    return list.filter(fc => fc.base - y >= l * 0.2).map(fc => A(fc.p[0], fc.p[1], fc.p[2]));
  }
  function treeShape(i, j) {
    const fr = Math.fround;
    if (fr(j) < fr(i * 0.3)) return -1;
    const f = fr(i / 2), g = fr(f - j);
    let h = fr(Math.sqrt(fr(fr(f * f) - fr(g * g))));
    if (g === 0) h = f; else if (Math.abs(g) >= f) return 0;
    return fr(h * 0.5);
  }
  function makeLimb(S, a, b, place) {
    if (!place && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return true;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const i = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const f = Math.fround(dx / i), g = Math.fround(dy / i), h = Math.fround(dz / i);
    for (let j = 0; j <= i; j++) {
      const p = [a[0] + Math.floor(Math.fround(0.5 + Math.fround(j * f))), a[1] + Math.floor(Math.fround(0.5 + Math.fround(j * g))), a[2] + Math.floor(Math.fround(0.5 + Math.fround(j * h)))];
      if (place) {
        const ax = Math.abs(p[0] - a[0]), az = Math.abs(p[2] - a[2]), k = Math.max(ax, az);
        placeLog(S, p[0], p[1], p[2], k > 0 ? (ax === k ? 'x' : 'z') : 'y');
        continue;
      }
      if (!isFreeTree(S, p[0], p[1], p[2])) return false;
    }
    return true;
  }

  // ---- foliage placers -------------------------------------------------------------------------------------------------
  function foliageHeight(S, h) {
    const T = S.T, fp = T.fp, r = S.r;
    switch (T.fpType) {
      case 'spruce_foliage_placer': return Math.max(4, h - T.trunkHeightP(r));
      case 'pine_foliage_placer': return T.heightP(r);
      case 'acacia_foliage_placer': return 0;
      case 'dark_oak_foliage_placer': return 4;
      case 'mega_pine_foliage_placer': return T.crownP(r);
      case 'random_spread_foliage_placer': return T.foliageHeightP(r);
      case 'cherry_foliage_placer': return T.heightP ? T.heightP(r) : fp.height;
    }
    return T.heightP ? T.heightP(r) : fp.height;
  }
  function foliageRadius(S, k) {
    const T = S.T, r = S.r, base = T.radius(r);
    if (T.fpType === 'pine_foliage_placer') return base + r.nextInt(Math.max(k + 1, 1));
    return base;
  }
  function tryPlaceLeaf(S, x, y, z) {
    if (!baseTreePos(S, x, y, z)) return false;
    S.setLeaf(x, y, z, S.T.foliageP(S.r, x, y, z, S.R));
    return true;
  }
  function skipLocation(S, i, j, k, l, dbl) {
    const T = S.T, r = S.r, fp = T.fp;
    switch (T.fpType) {
      case 'blob_foliage_placer': return i === l && k === l && (r.nextInt(2) === 0 || j === 0);
      case 'bush_foliage_placer': return i === l && k === l && r.nextInt(2) === 0;
      case 'fancy_foliage_placer': { const fr = Math.fround; return fr(fr(fr(i + 0.5) * fr(i + 0.5)) + fr(fr(k + 0.5) * fr(k + 0.5))) > fr(l * l); }
      case 'spruce_foliage_placer': case 'pine_foliage_placer': return i === l && k === l && l > 0;
      case 'acacia_foliage_placer': if (j === 0) return (i > 1 || k > 1) && i !== 0 && k !== 0; return i === l && k === l && l > 0;
      case 'jungle_foliage_placer': case 'mega_pine_foliage_placer': if (i + k >= 7) return true; return i * i + k * k > l * l;
      case 'dark_oak_foliage_placer': if (j === -1 && !dbl) return i === l && k === l; if (j === 1) return i + k > l * 2 - 2; return false;
      case 'cherry_foliage_placer': {
        if (j === -1 && (i === l || k === l) && r.nextFloat() < fp.wide_bottom_layer_hole_chance) return true;
        const corner = i === l && k === l;
        if (l > 2) return corner || (i + k > l * 2 - 2 && r.nextFloat() < fp.corner_hole_chance);
        return corner && r.nextFloat() < fp.corner_hole_chance;
      }
    }
    return false;
  }
  function skipSigned(S, i, j, k, l, dbl) {
    if (S.T.fpType === 'dark_oak_foliage_placer' && j === 0 && dbl && (i === -l || i >= l) && (k === -l || k >= l)) return true;
    let m, n;
    if (dbl) { m = Math.min(Math.abs(i), Math.abs(i - 1)); n = Math.min(Math.abs(k), Math.abs(k - 1)); } else { m = Math.abs(i); n = Math.abs(k); }
    return skipLocation(S, m, j, n, l, dbl);
  }
  function leavesRow(S, x, y, z, rad, j, dbl) {
    const kk = dbl ? 1 : 0;
    for (let l = -rad; l <= rad + kk; l++) for (let m = -rad; m <= rad + kk; m++) {
      if (skipSigned(S, l, j, m, rad, dbl)) continue;
      tryPlaceLeaf(S, x + l, y + j, z + m);
    }
  }
  function createFoliage(S, maxH, a, fh, rad, off) {
    const T = S.T, r = S.r, fp = T.fp, d = a.dbl;
    switch (T.fpType) {
      case 'blob_foliage_placer':
        for (let m = off; m >= off - fh; m--) leavesRow(S, a.x, a.y, a.z, Math.max(rad + a.ro - 1 - Math.trunc(m / 2), 0), m, d);
        return;
      case 'bush_foliage_placer':
        for (let m = off; m >= off - fh; m--) leavesRow(S, a.x, a.y, a.z, rad + a.ro - 1 - m, m, d);
        return;
      case 'fancy_foliage_placer':
        for (let m = off; m >= off - fh; m--) leavesRow(S, a.x, a.y, a.z, rad + (m === off || m === off - fh ? 0 : 1), m, d);
        return;
      case 'spruce_foliage_placer': {
        let m = r.nextInt(2), n = 1, o = 0;
        for (let p = off; p >= -fh; p--) {
          leavesRow(S, a.x, a.y, a.z, m, p, d);
          if (m >= n) { m = o; o = 1; n = Math.min(n + 1, rad + a.ro); } else m++;
        }
        return;
      }
      case 'pine_foliage_placer': {
        let m = 0;
        for (let n = off; n >= off - fh; n--) {
          leavesRow(S, a.x, a.y, a.z, m, n, d);
          if (m >= 1 && n === off - fh + 1) { m--; continue; }
          if (m < rad + a.ro) m++;
        }
        return;
      }
      case 'acacia_foliage_placer': {
        const y = a.y + off;
        leavesRow(S, a.x, y, a.z, rad + a.ro, -1 - fh, d);
        leavesRow(S, a.x, y, a.z, rad - 1, -fh, d);
        leavesRow(S, a.x, y, a.z, rad + a.ro - 1, 0, d);
        return;
      }
      case 'jungle_foliage_placer': {
        const m = d ? fh : 1 + r.nextInt(2);
        for (let n = off; n >= off - m; n--) leavesRow(S, a.x, a.y, a.z, rad + a.ro + 1 - n, n, d);
        return;
      }
      case 'mega_pine_foliage_placer': {
        let m = 0;
        for (let n = a.y - fh + off; n <= a.y + off; n++) {
          const o = a.y - n, p = rad + a.ro + Math.floor(Math.fround(Math.fround(o / fh) * 3.5));
          const q = o > 0 && p === m && (n & 1) === 0 ? p + 1 : p;
          leavesRow(S, a.x, n, a.z, q, 0, d);
          m = p;
        }
        return;
      }
      case 'dark_oak_foliage_placer': {
        const y = a.y + off;
        if (d) {
          leavesRow(S, a.x, y, a.z, rad + 2, -1, d);
          leavesRow(S, a.x, y, a.z, rad + 3, 0, d);
          leavesRow(S, a.x, y, a.z, rad + 2, 1, d);
          if (r.nextBoolean()) leavesRow(S, a.x, y, a.z, rad, 2, d);
        } else {
          leavesRow(S, a.x, y, a.z, rad + 2, -1, d);
          leavesRow(S, a.x, y, a.z, rad + 1, 0, d);
        }
        return;
      }
      case 'random_spread_foliage_placer': {
        for (let m = 0; m < fp.leaf_placement_attempts; m++) {
          const dx = r.nextInt(rad) - r.nextInt(rad), dy = r.nextInt(fh) - r.nextInt(fh), dz = r.nextInt(rad) - r.nextInt(rad);
          tryPlaceLeaf(S, a.x + dx, a.y + dy, a.z + dz);
        }
        return;
      }
      case 'cherry_foliage_placer': {
        const y = a.y + off, m = rad + a.ro - 1;
        leavesRow(S, a.x, y, a.z, m - 2, fh - 3, d);
        leavesRow(S, a.x, y, a.z, m - 1, fh - 4, d);
        for (let n = fh - 5; n >= 0; n--) leavesRow(S, a.x, y, a.z, m, n, d);
        cherryHanging(S, a.x, y, a.z, m, -1, d);
        cherryHanging(S, a.x, y, a.z, m - 1, -2, d);
        return;
      }
    }
  }
  function cherryHanging(S, x, y, z, i, j, dbl) {
    const fp = S.T.fp, r = S.r;
    leavesRow(S, x, y, z, i, j, dbl);
    const k = dbl ? 1 : 0, by = y - 1;
    for (let di = 0; di < 4; di++) {
      const d = HDIRS[di], d2 = HDIRS[(di + 1) & 3]; // clockwise
      const l = d2[0] + d2[1] > 0 ? i + k : i;
      let px = x + d2[0] * l - d[0] * i, py = y + j - 1, pz = z + d2[1] * l - d[1] * i;
      for (let m = -i; m < i + k; m++) {
        const above = S.leafSet(px, py + 1, pz);
        if (above && ext(px, py, pz, fp.hanging_leaves_chance)) ext(px, py - 1, pz, fp.hanging_leaves_extension_chance);
        px += d[0]; pz += d[1];
      }
    }
    function ext(px, py, pz, f) {
      if (Math.abs(px - x) + Math.abs(py - by) + Math.abs(pz - z) >= 7) return false;
      if (r.nextFloat() > f) return false;
      return tryPlaceLeaf(S, px, py, pz);
    }
  }

  // ---- mangrove roots ------------------------------------------------------------------------------------------------
  function rootTrunkOrigin(S, x, y, z) {
    const rp = S.T.root, off = rp.trunk_offset_y ? intProvider(rp.trunk_offset_y)(S.r) : 0;
    return [x, y + off, z];
  }
  // MangroveRootPlacer
  function placeRoots(S, x, y, z, tx, ty, tz) {
    const rp = S.T.root, R = S.R, r = S.r, mp = rp.mangrove_root_placement;
    const canGrow = tagSet(mp.can_grow_through), muddy = new Set([].concat(mp.muddy_roots_in).map(n => BID[strip(n)]));
    const rootP = provider(rp.root_provider), muddyP = provider(mp.muddy_roots_provider);
    const above = rp.above_root_placement ? { p: provider(rp.above_root_placement.above_root_provider), c: rp.above_root_placement.above_root_placement_chance } : null;
    const ok = (px, py, pz) => baseTreePos(S, px, py, pz) || canGrow.has(R.id(px, py, pz)); // RootPlacer.canPlaceRoot
    for (let py = y; py < ty; py++) if (!ok(x, py, z)) return false;
    const list = [[tx, ty - 1, tz]];
    const maxLen = mp.max_root_length, maxW = mp.max_root_width, skew = mp.random_skew_chance;
    const potential = (p, d) => {
      const below = [p[0], p[1] - 1, p[2]], side = [p[0] + d[0], p[1], p[2] + d[1]];
      const i = Math.abs(p[0] - tx) + Math.abs(p[1] - ty) + Math.abs(p[2] - tz);
      if (i > maxW - 3 && i <= maxW) return r.nextFloat() < skew ? [below, [side[0], side[1] - 1, side[2]]] : [below];
      if (i > maxW) return [below];
      if (r.nextFloat() < skew) return [below];
      return r.nextBoolean() ? [side] : [below];
    };
    const simulate = (p, d, out, i) => {
      if (i === maxLen || out.length > maxLen) return false;
      for (const q of potential(p, d)) {
        if (!ok(q[0], q[1], q[2])) continue;
        out.push(q);
        if (!simulate(q, d, out, i + 1)) return false;
      }
      return true;
    };
    for (const d of HDIRS) {
      const p = [tx + d[0], ty, tz + d[1]], out = [];
      if (!simulate(p, d, out, 0)) return false;
      list.push(...out, p);
    }
    for (const p of list) {
      if (!ok(p[0], p[1], p[2])) continue;
      const id = R.id(p[0], p[1], p[2]);
      S.setRoot(p[0], p[1], p[2], muddy.has(id) ? muddyP(r, p[0], p[1], p[2], R) : rootP(r, p[0], p[1], p[2], R));
      if (above && r.nextFloat() < above.c && R.isAir(p[0], p[1] + 1, p[2])) R.setState(p[0], p[1] + 1, p[2], above.p(r, p[0], p[1] + 1, p[2], R));
    }
    return true;
  }

  // ---- tree decorators -------------------------------------------------------------------------------------------------
  const VINE_FACE = { west: 'east', east: 'west', north: 'south', south: 'north' };
  function placeVine(D, x, y, z, face) {
    const id = BID.vine;
    if (id === undefined) return;
    const b = BLOCKS[id], i = b.states.findIndex(s => ['north', 'east', 'south', 'west', 'up'].every(k => s[k] === (k === face ? 'true' : 'false')));
    D.set(x, y, z, [id, Math.max(0, i)]);
  }
  function decorate(D, dec, T) {
    const r = D.r, d = dec.d;
    switch (dec.t) {
      case 'trunk_vine':
        for (const [x, y, z] of D.logs) {
          if (r.nextInt(3) > 0 && D.isAir(x - 1, y, z)) placeVine(D, x - 1, y, z, 'east');
          if (r.nextInt(3) > 0 && D.isAir(x + 1, y, z)) placeVine(D, x + 1, y, z, 'west');
          if (r.nextInt(3) > 0 && D.isAir(x, y, z - 1)) placeVine(D, x, y, z - 1, 'south');
          if (r.nextInt(3) > 0 && D.isAir(x, y, z + 1)) placeVine(D, x, y, z + 1, 'north');
        }
        return;
      case 'leave_vine': {
        const hang = (x, y, z, face) => { placeVine(D, x, y, z, face); let i = 4; y--; while (D.isAir(x, y, z) && i > 0) { placeVine(D, x, y, z, face); y--; i--; } };
        for (const [x, y, z] of D.leaves) {
          if (r.nextFloat() < d.probability && D.isAir(x - 1, y, z)) hang(x - 1, y, z, 'east');
          if (r.nextFloat() < d.probability && D.isAir(x + 1, y, z)) hang(x + 1, y, z, 'west');
          if (r.nextFloat() < d.probability && D.isAir(x, y, z - 1)) hang(x, y, z - 1, 'south');
          if (r.nextFloat() < d.probability && D.isAir(x, y, z + 1)) hang(x, y, z + 1, 'north');
        }
        return;
      }
      case 'cocoa': {
        if (r.nextFloat() >= d.probability || !D.logs.length || BID.cocoa === undefined) return;
        const y0 = D.logs[0][1];
        for (const [x, y, z] of D.logs.filter(p => p[1] - y0 <= 2)) {
          for (let di = 0; di < 4; di++) {
            if (r.nextFloat() > 0.25) continue;
            const dd = HDIRS[di], px = x - dd[0], pz = z - dd[1];
            if (!D.isAir(px, y, pz)) continue;
            const face = ['north', 'east', 'south', 'west'][di], age = r.nextInt(3);
            const b = BLOCKS[BID.cocoa], i = b.states.findIndex(s => s.facing === face && s.age === String(age));
            D.set(px, y, pz, [BID.cocoa, Math.max(0, i)]);
          }
        }
        return;
      }
      case 'beehive': {
        const L = D.leaves, G = D.logs;
        if (!G.length || BID.bee_nest === undefined) return;
        if (r.nextFloat() >= d.probability) return;
        const i = L.length ? Math.max(L[0][1] - 1, G[0][1] + 1) : Math.min(G[0][1] + 1 + r.nextInt(3), G[G.length - 1][1]);
        const cand = [];
        for (const p of G) if (p[1] === i) for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0]]) cand.push([p[0] + dx, p[1], p[2] + dz]);
        if (!cand.length) return;
        for (let k = cand.length - 1; k > 0; k--) { const j = r.nextInt(k + 1); [cand[k], cand[j]] = [cand[j], cand[k]]; }
        const spot = cand.find(p => D.isAir(p[0], p[1], p[2]) && D.isAir(p[0], p[1], p[2] + 1));
        if (!spot) return;
        const b = BLOCKS[BID.bee_nest], idx = b.states.findIndex(s => s.facing === 'south' && s.honey_level === '0');
        D.set(spot[0], spot[1], spot[2], [BID.bee_nest, Math.max(0, idx)]);
        return;
      }
      case 'alter_ground': {
        const prov = provider(d.provider);
        const base = D.roots.length && (!D.logs.length || D.roots[0][1] !== D.logs[0][1]) ? D.roots : D.logs.concat(D.roots.length && D.logs.length && D.roots[0][1] === D.logs[0][1] ? D.roots : []);
        if (!base.length) return;
        const y0 = base[0][1];
        const H = T.H;
        const at = (x, y, z) => {
          for (let i = 2; i >= -3; i--) {
            const id = D.R.id(x, y + i, z);
            if (H.DIRT.has(id)) { D.set(x, y + i, z, prov(r, x, y, z, D.R)); break; }
            if (id !== 0 && i < 0) break;
          }
        };
        const circle = (x, y, z) => { for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { if (Math.abs(i) === 2 && Math.abs(j) === 2) continue; at(x + i, y, z + j); } };
        for (const [x, y, z] of base) {
          if (y !== y0) continue;
          circle(x - 1, y, z - 1); circle(x + 2, y, z - 1); circle(x - 1, y, z + 2); circle(x + 2, y, z + 2);
          for (let j = 0; j < 5; j++) { const k = r.nextInt(64), l = k % 8, m = k >> 3; if (l !== 0 && l !== 7 && m !== 0 && m !== 7) continue; circle(x - 3 + l, y, z - 3 + m); }
        }
        return;
      }
      case 'attached_to_leaves': case 'attached_to_logs': {
        const src = dec.t === 'attached_to_leaves' ? D.leaves.slice() : D.logs.slice();
        for (let k = src.length - 1; k > 0; k--) { const j = r.nextInt(k + 1); [src[k], src[j]] = [src[j], src[k]]; }
        const used = new Set(), prov = provider(d.block_provider);
        const dirs = d.directions.map(n => ({ up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] })[n]);
        for (const [x, y, z] of src) {
          const dd = dirs[r.nextInt(dirs.length)], px = x + dd[0], py = y + dd[1], pz = z + dd[2], key = px + ',' + py + ',' + pz;
          if (used.has(key) || !(r.nextFloat() < d.probability)) continue;
          let ok = true;
          for (let i = 1; i <= (d.required_empty_blocks || 1); i++) if (!D.isAir(x + dd[0] * i, y + dd[1] * i, z + dd[2] * i)) { ok = false; break; }
          if (!ok) continue;
          for (let a = -d.exclusion_radius_xz; a <= d.exclusion_radius_xz; a++) for (let b = -d.exclusion_radius_y; b <= d.exclusion_radius_y; b++) for (let c = -d.exclusion_radius_xz; c <= d.exclusion_radius_xz; c++) used.add((px + a) + ',' + (py + b) + ',' + (pz + c));
          D.set(px, py, pz, prov(r, px, py, pz, D.R));
        }
        return;
      }
      case 'place_on_ground': {
        const base = D.roots.length ? D.roots : D.logs;
        if (!base.length) return;
        const y0 = base[0][1], low = base.filter(p => p[1] === y0);
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const p of low) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
        const rad = d.radius ?? 2, hh = d.height ?? 1, prov = provider(d.block_state_provider);
        x0 -= rad; x1 += rad; z0 -= rad; z1 += rad;
        for (let q = 0; q < (d.tries ?? 128); q++) {
          const px = r.nextIntBetween(x0, x1), py = r.nextIntBetween(y0 - hh, y0 + hh), pz = r.nextIntBetween(z0, z1);
          const up = D.R.id(px, py + 1, pz);
          if ((up === 0 || up === BID.vine) && SOLIDCUBE[D.R.id(px, py, pz)] && D.R.height('MOTION_BLOCKING_NO_LEAVES', px, pz) <= py + 1) D.set(px, py + 1, pz, prov(r, px, py + 1, pz, D.R));
        }
        return;
      }
      case 'pale_moss': {
        const MOSS = BID.pale_hanging_moss, CARPET = BID.pale_moss_carpet;
        for (const [x, y, z] of D.leaves) {
          if (r.nextFloat() >= (d.leaves_probability ?? 0.4)) continue;
          if (MOSS !== undefined && D.isAir(x, y - 1, z)) { let k = 1 + r.nextInt(3), py = y - 1; while (k-- > 0 && D.isAir(x, py, z)) { D.set(x, py, z, [MOSS, k === 0 ? 1 : 0]); py--; } }
        }
        if (CARPET !== undefined && D.logs.length && r.nextFloat() < (d.ground_probability ?? 0.8)) {
          const [x, y, z] = D.logs[0];
          for (let i = 0; i < 24; i++) { const px = x + r.nextInt(7) - 3, pz = z + r.nextInt(7) - 3; if (D.isAir(px, y, pz) && SOLIDCUBE[D.R.id(px, y - 1, pz)]) D.set(px, y, pz, [CARPET, 0]); }
        }
        return;
      }
      case 'creaking_heart': {
        if (r.nextFloat() >= (d.probability ?? 1) || BID.creaking_heart === undefined || D.logs.length < 3) return;
        const p = D.logs[1 + r.nextInt(D.logs.length - 2)];
        D.set(p[0], p[1], p[2], [BID.creaking_heart, 1]);
        return;
      }
    }
  }
  // FallenTreeFeature (1.21.5): a stump and a log lying next to it
  F.FEATURE.fallen_tree = (ctx, cfg, r, x, y, z) => {
    const R = ctx.R, c = cfg.raw, trunk = provider(c.trunk_provider), len = intProvider(c.log_length)(r);
    const s = trunk(r, x, y, z, R);
    if (!s || !SOLIDCUBE[R.id(x, y - 1, z)] || !R.isAir(x, y, z)) return false;
    R.set(x, y, z, s[0], 0);
    const di = r.nextInt(4), d = HDIRS[di], gap = 2 + r.nextInt(2), axis = d[0] ? 1 : 2;
    let ok = true;
    for (let i = 0; i < len; i++) { const px = x + d[0] * (gap + i), pz = z + d[1] * (gap + i); if (!R.isAir(px, y, pz) || !SOLIDCUBE[R.id(px, y - 1, pz)]) { ok = false; break; } }
    if (ok) for (let i = 0; i < len; i++) R.set(x + d[0] * (gap + i), y, z + d[1] * (gap + i), s[0], axis);
    return true;
  };
})();
