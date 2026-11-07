'use strict';
// ---------------------------------------------------------------------------
// Turning a save (vanilla terrain, gen 2) into a vanilla 26.2 world for a room (CreateRoomScreen in net.js):
//   - the saved chunks of the three dimensions -> region files: block states with their palettes, vanilla's 3D
//     biomes from the generator, chests / furnaces / hoppers / signs / banners / pots as block entities. Light and
//     heightmaps are left to the server (isLightOn 0); the chunks the save never kept it generates itself from the
//     same seed, as this game did
//   - the kept mobs, boats, minecarts, item frames, paintings, armor stands -> entity region files
//   - the player (where it is, inventory, armour, health, food, experience, effects) -> the owner's player file
//   - world.json: seed, time, spawn, game rules (the room service applies them with commands once the room runs)
// all in one file (pack) that the room service unpacks into the room's world folder before its first start.
// ---------------------------------------------------------------------------
const RoomExport = (() => {
  const DATA_VERSION = 4903; // 26.2
  const MAX_BYTES = 100 << 20; // the same as everyone's cloud space
  const DIMS = [
    { dim: 'overworld', vdim: 'minecraft:overworld', dir: 'dimensions/minecraft/overworld/', minY: -64, height: 384 },
    { dim: 'nether', vdim: 'minecraft:the_nether', dir: 'dimensions/minecraft/the_nether/', minY: 0, height: 256 },
    { dim: 'end', vdim: 'minecraft:the_end', dir: 'dimensions/minecraft/the_end/', minY: 0, height: 256 },
  ];
  const ns = (s) => (String(s).includes(':') ? String(s) : 'minecraft:' + s);
  const ceilLog2 = (n) => 32 - Math.clz32(n - 1);
  const pause = () => new Promise((r) => setTimeout(r, 0));

  // the vanilla block states (vstates_data.js, 110 KB): loaded the first time a save is turned into a room's world
  function loadStates() {
    if (self.VSTATES) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/vstates_data.js'; s.onload = res; s.onerror = () => rej(new Error('方块数据加载失败，请检查网络'));
      document.head.appendChild(s);
    });
  }

  // ---- this game's [id, meta] -> a vanilla block state ----
  // Every state of the vanilla blocks an id can come from goes through the importer's mapping (mapVanillaState); of
  // the states that land on [id, meta] the one named as the models draw it (vanillaState), then closest to what they
  // draw, then closest to the block's default state wins.
  const enumCache = new Map(); // vanilla name -> [[id, meta, props]...]
  const mapOf = (str) => { try { return mapVanillaState(str); } catch (e) { return null; } };
  function statesOf(name) {
    let L = enumCache.get(name);
    if (L) return L;
    L = []; enumCache.set(name, L);
    const v = VSTATES[name];
    if (v === undefined) return L;
    if (v === 0) { const r = mapOf(name); if (r) L.push([r[0], r[1], null]); return L; }
    const props = v[0], idx = props.map(() => 0);
    for (;;) {
      const p = {};
      props.forEach(([k, vs], i) => { p[k] = vs[idx[i]]; });
      const r = mapOf(name + '[' + props.map(([k]) => k + '=' + p[k]).join(',') + ']');
      if (r) L.push([r[0], r[1], p]);
      let i = props.length - 1;
      while (i >= 0 && ++idx[i] >= props[i][1].length) { idx[i] = 0; i--; }
      if (i < 0) break;
    }
    return L;
  }
  let aliasTo = null; // this game's key -> the vanilla names shown as it
  function candidates(b) {
    if (!aliasTo) { aliasTo = {}; for (const [v, k] of Object.entries(STATE_ALIAS)) (aliasTo[k] || (aliasTo[k] = [])).push(v); }
    const out = new Set([b.key]);
    for (let m = 0; m < 2; m++) try { out.add(vanillaState(b, m, null).key); } catch (e) { }
    for (const n of aliasTo[b.key] || []) out.add(n);
    return [...out].filter((n) => VSTATES[n] !== undefined);
  }
  const revCache = new Map(); // id -> Map(meta -> {name, props})
  function stateFor(id, meta) {
    let T = revCache.get(id);
    if (!T) {
      T = new Map(); revCache.set(id, T);
      const b = BLOCKS[id];
      if (b) for (const name of candidates(b)) {
        const v = VSTATES[name], def = v ? Object.fromEntries(v[0].map(([k, vs], i) => [k, vs[v[1][i]]])) : {};
        for (const [rid, m, p] of statesOf(name)) {
          if (rid !== id) continue;
          let vs = null; try { vs = vanillaState(b, m, null); } catch (e) { }
          let sc = vs && vs.key === name ? 1000 : 0;
          if (p) for (const k in p) { if (vs && vs.p[k] !== undefined && String(vs.p[k]) === p[k]) sc += 10; if (def[k] === p[k]) sc += 1; }
          const cur = T.get(m);
          if (!cur || sc > cur.sc) T.set(m, { sc, name, props: p });
        }
      }
    }
    return T.get(meta) || T.get(0) || T.values().next().value || null;
  }
  // a palette entry: {Name, Properties} with its key; ctx when the cell's neighbours decide some of its properties
  // (stairs' shapes, fence / wall / pane connections, grass under snow), wl when it can hold water
  const entryCache = new Map();
  let secSerial = 0; // every section written gets a new number (an entry remembers the last one it went into)
  const keyOf = (name, p) => name + (p ? '[' + Object.keys(p).map((k) => k + '=' + p[k]).join(',') + ']' : '');
  function makeEntry(name, p) { return { key: keyOf(name, p), name, props: p, nbt: p ? { Name: ns(name), Properties: p } : { Name: ns(name) }, sec: -1, pi: 0 }; }
  function entryOf(id, meta, stats) {
    const k = id * 256 + meta;
    let e = entryCache.get(k);
    if (e) return e;
    const s = id ? stateFor(id, meta) : null, b = BLOCKS[id];
    if (!s) {
      if (id && b) stats.missing.set(b.key, (stats.missing.get(b.key) || 0) + 1);
      e = makeEntry('air', null);
    } else {
      const p = s.props && { ...s.props };
      // leaves: this game keeps no distance; the default (7, not persistent) would decay them all on the server. At 1
      // they stay, and the server works out the real distance the moment a log or leaf next to them changes
      if (p && p.distance === '7' && p.persistent === 'false') p.distance = '1';
      e = makeEntry(s.name, p);
      e.ctx = !!(b && (b.stairs || b.fence) || (s.props && 'snowy' in s.props));
      e.wl = !!(s.props && 'waterlogged' in s.props);
      e.b = b;
    }
    entryCache.set(k, e);
    return e;
  }
  const SNOW = () => [BID.snow, BID.snow_block];
  // the entry of a cell whose neighbours or water change its properties
  function cellEntry(e, meta, wl, get) {
    const p = { ...e.props };
    if (e.b.stairs || e.b.fence) {
      let vs = null; try { vs = vanillaState(e.b, meta, get); } catch (err) { }
      if (vs) for (const k in vs.p) if (k in p) p[k] = String(vs.p[k]);
    }
    if ('snowy' in p) p.snowy = SNOW().includes(get(0, 1, 0)[0]) ? 'true' : 'false';
    if (wl && e.wl) p.waterlogged = 'true';
    return makeEntry(e.name, p);
  }

  // packed palette indices: `bits` each, as many as fit in a long, never split across two
  function pack(idx, n, bits) {
    const per = Math.floor(64 / bits), u32 = new Uint32Array(Math.ceil(n / per) * 2);
    for (let i = 0; i < n; i++) {
      const li = (i / per) | 0, o = (i - li * per) * bits, v = idx[i];
      if (o >= 32) u32[li * 2] |= v << (o - 32);
      else { u32[li * 2 + 1] |= v << o; if (o + bits > 32) u32[li * 2] |= v >>> (32 - o); }
    }
    return new NBT.Longs(u32);
  }

  // ---- items ----
  function itemNbt(s, slot) {
    if (!s || !(s.count > 0)) return null;
    const key = s.unk || (ITEMS[s.id] && ITEMS[s.id].key);
    if (!key) return null;
    const o = {};
    if (slot !== undefined) o.Slot = NBT.byte(slot);
    o.id = ns(key); o.count = s.count;
    const c = {};
    if (s.dmg) c['minecraft:damage'] = s.dmg | 0;
    if (s.name) c['minecraft:custom_name'] = String(s.name);
    if (s.e && s.e.length) c[key === 'enchanted_book' ? 'minecraft:stored_enchantments' : 'minecraft:enchantments'] = Object.fromEntries(s.e.map(([k, l]) => [ns(k), l | 0]));
    if (s.pot) c['minecraft:potion_contents'] = { potion: ns(s.pot) };
    if (s.color != null) c['minecraft:dyed_color'] = s.color | 0;
    if (s.pv) c['minecraft:painting/variant'] = ns(s.pv);
    if (s.instrument) c['minecraft:instrument'] = ns(s.instrument);
    if (s.base) c['minecraft:base_color'] = String(s.base);
    if (s.patterns && s.patterns.length) c['minecraft:banner_patterns'] = s.patterns.map(([p, col]) => ({ color: String(col), pattern: ns(p) }));
    if (Object.keys(c).length) o.components = c;
    return o;
  }
  const itemList = (slots, from = 0) => (slots || []).map((s, i) => itemNbt(s, i + from)).filter(Boolean);

  // ---- block entities (the ones that hold something) ----
  function blockEntityNbt(be, name, x, y, z) {
    const o = { id: '', x, y, z, keepPacked: NBT.byte(0) };
    switch (be.type) {
      case 'chest':
        o.id = ns(name === 'barrel' || name === 'trapped_chest' ? name : /shulker_box$/.test(name) ? 'shulker_box' : 'chest');
        o.Items = itemList(be.slots);
        if (be.loot && !o.Items.length) o.LootTable = ns(be.loot);
        return o;
      case 'furnace':
        o.id = ns(['furnace', 'smoker', 'blast_furnace'].includes(name) ? name : 'furnace');
        o.Items = [itemNbt(be.input, 0), itemNbt(be.fuel, 1), itemNbt(be.output, 2)].filter(Boolean);
        o.lit_time_remaining = NBT.short(Math.min(32767, be.burn | 0)); o.lit_total_time = NBT.short(Math.min(32767, be.burnMax | 0));
        o.cooking_time_spent = NBT.short(be.cook | 0); o.cooking_total_time = NBT.short(name === 'furnace' ? 200 : 100);
        return o;
      case 'hopper': case 'dispenser': case 'dropper':
        o.id = ns(be.type); o.Items = itemList(be.slots);
        if (be.type === 'hopper') o.TransferCooldown = 0;
        return o;
      case 'brewing':
        if (!be.bottles) return null;
        o.id = ns('brewing_stand');
        o.Items = [...be.bottles.map((s, i) => itemNbt(s, i)), itemNbt(be.ingredient, 3), itemNbt(be.fuel, 4)].filter(Boolean);
        o.BrewTime = NBT.short(be.brewTime | 0); o.Fuel = NBT.byte(Math.min(127, be.fuelLeft | 0));
        return o;
      case 'sign': {
        if (!be.text) return null;
        const side = (t) => ({ messages: [0, 1, 2, 3].map((i) => String((t && t.l && t.l[i]) || '')), color: (t && t.c) || 'black', has_glowing_text: NBT.byte(t && t.g ? 1 : 0) });
        o.id = ns(/hanging_sign$/.test(name) ? 'hanging_sign' : 'sign');
        o.front_text = side(be.text.f); o.back_text = side(be.text.b); o.is_waxed = NBT.byte(be.waxed ? 1 : 0);
        return o;
      }
      case 'banner':
        o.id = ns('banner');
        o.patterns = (be.patterns || []).map(([p, col]) => ({ color: String(col), pattern: ns(p) }));
        if (be.name) o.CustomName = String(be.name);
        return o;
      case 'pot':
        o.id = ns('decorated_pot');
        if (be.sherds) o.sherds = be.sherds.map((k) => ns(typeof k === 'number' ? ITEMS[k].key : k));
        return o;
    }
    return null; // (the rest the server makes as it needs them)
  }

  // ---- entities ----
  const FACING3 = [2, 3, 4, 5, 0, 1]; // vanilla Direction -> DIRS (anvil.js)
  const FACING2 = [5, 0, 4, 1];
  const uuid = () => { const a = new Int32Array(4); crypto.getRandomValues(a); return a; };
  const degOf = (yaw) => { let d = (Math.PI - (yaw || 0)) * 180 / Math.PI; d = ((d % 360) + 540) % 360 - 180; return d; };
  function entityNbt(r, minY) {
    const t = String(r.type || ''), P = r.pos;
    if (!P) return null;
    const x = r.x || {}, base = (id) => ({
      id: ns(id), Pos: [P[0], P[1] + minY, P[2]].map(NBT.double), Motion: [0, 0, 0].map(NBT.double),
      Rotation: [NBT.float(degOf(r.yaw)), NBT.float(0)], UUID: uuid(), OnGround: NBT.byte(1), Fire: NBT.short(-1), Air: NBT.short(300),
    });
    let m = /^(chest_boat|boat):(.+)$/.exec(t);
    if (m) {
      const kind = m[2], raft = kind === 'bamboo', o = base(kind + (m[1] === 'chest_boat' ? '_chest' : '') + (raft ? '_raft' : '_boat'));
      if (m[1] === 'chest_boat') { o.Items = itemList(x.slots); if (x.loot && !o.Items.length) o.LootTable = ns(x.loot); }
      return o;
    }
    m = /^minecart:(.*)$/.exec(t);
    if (m) {
      const o = base((m[1] ? m[1] + '_' : '') + 'minecart');
      if (m[1] === 'chest' || m[1] === 'hopper') { o.Items = itemList(x.slots); if (x.loot && !o.Items.length) o.LootTable = ns(x.loot); }
      if (m[1] === 'furnace') o.Fuel = NBT.short(x.fuel | 0);
      if (m[1] === 'hopper' && x.enabled !== undefined) o.Enabled = NBT.byte(x.enabled ? 1 : 0);
      return o;
    }
    if (t === 'item_frame' || t === 'glow_item_frame') {
      if (!x.b) return null;
      const o = base(t);
      o.block_pos = Int32Array.of(x.b[0], x.b[1] + minY, x.b[2]); o.Facing = NBT.byte(Math.max(0, FACING3.indexOf(x.f)));
      const it = itemNbt(x.it); if (it) { o.Item = it; o.ItemRotation = NBT.byte(x.r | 0); }
      return o;
    }
    if (t === 'painting') {
      if (!x.b || !x.v) return null;
      const o = base(t);
      o.block_pos = Int32Array.of(x.b[0], x.b[1] + minY, x.b[2]); o.facing = NBT.byte(Math.max(0, FACING2.indexOf(x.f))); o.variant = ns(x.v);
      return o;
    }
    if (t === 'armor_stand') {
      const o = base(t), g = x.g || [], eq = {};
      ['feet', 'legs', 'chest', 'head', 'mainhand', 'offhand'].forEach((k, i) => { const it = itemNbt(g[i]); if (it) eq[k] = it; });
      o.equipment = eq; o.Small = NBT.byte(x.s ? 1 : 0); o.ShowArms = NBT.byte(x.a ? 1 : 0);
      return o;
    }
    if (!self.VENTITIES.includes(t) || /^(ender_dragon|end_crystal|player)$/.test(t)) return null;
    const o = base(t);
    o.PersistenceRequired = NBT.byte(1);
    if (r.health !== undefined) o.Health = NBT.float(r.health);
    if (r.baby) { if (/zombie|piglin|zoglin/.test(t)) o.IsBaby = NBT.byte(1); else o.Age = -Math.max(1, r.baby * 4); }
    if (t === 'sheep') { o.Color = NBT.byte(r.wool | 0); o.Sheared = NBT.byte(r.sheared ? 1 : 0); }
    if ((t === 'slime' || t === 'magma_cube') && r.size) o.Size = Math.max(0, r.size - 1);
    return o;
  }

  // ---- the player ----
  const xpNeeded = (l) => (l >= 30 ? 112 + (l - 30) * 9 : l >= 15 ? 37 + (l - 15) * 5 : 7 + l * 2);
  function playerNbt(meta) {
    const d = meta.player;
    if (!d || !d.pos) return null;
    const D = DIMS.find((x) => x.dim === (meta.dim || 'overworld')) || DIMS[0];
    const inv = d.inv || [], eq = {}, xp = Math.max(0, d.xp | 0);
    let level = 0, t = 0; while (t + xpNeeded(level) <= xp) { t += xpNeeded(level); level++; }
    [['head', 36], ['chest', 37], ['legs', 38], ['feet', 39], ['offhand', 40]].forEach(([k, i]) => { const it = itemNbt(inv[i]); if (it) eq[k] = it; });
    return {
      DataVersion: DATA_VERSION, Dimension: D.vdim,
      Pos: [d.pos[0], d.pos[1] + D.minY, d.pos[2]].map(NBT.double), Motion: [0, 0, 0].map(NBT.double),
      Rotation: [NBT.float(degOf(d.yaw)), NBT.float(-(d.pitch || 0) * 180 / Math.PI)], OnGround: NBT.byte(1), FallFlying: NBT.byte(0),
      Health: NBT.float(Math.max(1, d.health ?? 20)), foodLevel: d.food ?? 20, foodSaturationLevel: NBT.float(d.sat ?? 5),
      XpLevel: level, XpP: NBT.float((xp - t) / xpNeeded(level)), XpTotal: xp, AbsorptionAmount: NBT.float(d.absorption || 0),
      SelectedItemSlot: d.sel | 0, Inventory: itemList(inv.slice(0, 36)), equipment: eq,
      active_effects: (d.effects || []).map(([k, amp, dur, amb]) => ({ id: ns(k), amplifier: NBT.byte(amp | 0), duration: dur | 0, ambient: NBT.byte(amb ? 1 : 0), show_particles: NBT.byte(1), show_icon: NBT.byte(1) })),
    };
  }

  // ---- region files: 1024 chunk slots, each at a 4 KiB sector offset; zlib (type 2) ----
  function regionFile(chunks) {
    let sectors = 2;
    const placed = chunks.map(([lx, lz, data]) => { const n = Math.ceil((data.length + 5) / 4096), at = sectors; sectors += n; return [lx, lz, data, at, n]; });
    const out = new Uint8Array(sectors * 4096), dv = new DataView(out.buffer), now = (Date.now() / 1000) | 0;
    for (const [lx, lz, data, at, n] of placed) {
      const i = (lx & 31) + (lz & 31) * 32;
      dv.setUint32(i * 4, (at << 8) | n); dv.setUint32(4096 + i * 4, now);
      dv.setUint32(at * 4096, data.length + 1); out[at * 4096 + 4] = 2; out.set(data, at * 4096 + 5);
    }
    return out;
  }

  // ---- the whole save ----
  // returns { files: Map(path -> bytes), info, stats }; progress(fraction, text)
  async function build(meta, progress) {
    if (!meta || meta.gen !== 2) throw new Error('只有新版地形的存档能用来开房间');
    if (meta.flat) throw new Error('超平坦世界暂时不能用来开房间');
    await loadStates();
    setWorldFormat(2);
    const stats = { chunks: 0, entities: 0, blockEntities: 0, missing: new Map(), skipped: 0 };
    const files = new Map();
    let bytes = 0;
    const add = (path, data) => { files.set(path, data); bytes += data.length + path.length + 6; if (bytes > MAX_BYTES) throw new Error('存档太大了（超过 100 MB），不能用来开房间'); };
    const pool = new GenPool(meta.seed);
    try {
      await pool.ready;
      // what each dimension holds
      const jobs = [];
      for (const D of DIMS) {
        const sid = D.dim === 'overworld' ? meta.id : meta.id + '~' + D.dim;
        const keys = [...(await DB.chunkKeys(sid))].map((k) => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768]);
        jobs.push({ D, sid, keys });
      }
      const total = jobs.reduce((n, j) => n + j.keys.length, 0) || 1;
      let done = 0, lastYield = performance.now();
      for (const { D, sid, keys } of jobs) {
        const d = (meta.dims && meta.dims[D.dim]) || { blockEntities: {}, mobs: [] };
        if (!keys.length && !(d.mobs || []).length) continue;
        // vanilla's biomes of these chunks, from the generator (several workers at once)
        const biomes = new Map();
        await Promise.all(Array.from({ length: Math.ceil(keys.length / 16) }, (_, i) => new Promise((res) => {
          const list = keys.slice(i * 16, i * 16 + 16);
          pool.request({ type: 'biomes', list, dim: D.dim }, (m) => {
            const n = 16 * m.qy;
            if (m.data) list.forEach(([cx, cz], k) => biomes.set(cx + ',' + cz, m.data.subarray(k * n, k * n + n)));
            res();
          });
        })));
        // decoded chunks: the one being written and its neighbours (fence / stair shapes across a chunk's edge)
        const N = 256 * HEIGHT, cache = new Map(), saved = new Set(keys.map(([cx, cz]) => cx + ',' + cz));
        const chunk = async (cx, cz) => {
          const k = cx + ',' + cz;
          if (cache.has(k)) return cache.get(k);
          let c = null;
          if (saved.has(k)) { const rec = await DB.getChunk(sid, cx, cz); if (rec) c = { B: rleDecode(rec.b, N), M: rleDecode(rec.m, N), W: rec.w && rec.w.length ? new Set(rec.w) : null }; }
          cache.set(k, c);
          if (cache.size > 40) cache.delete(cache.keys().next().value);
          return c;
        };
        // by region, then row by row (neighbours stay in the cache)
        const regions = new Map();
        for (const [cx, cz] of keys) { const rk = (cx >> 5) + ',' + (cz >> 5); (regions.get(rk) || regions.set(rk, []).get(rk)).push([cx, cz]); }
        const beByChunk = new Map();
        for (const [k, be] of Object.entries(d.blockEntities || {})) {
          const [x, , z] = k.split(',').map(Number), ck = (x >> 4) + ',' + (z >> 4);
          (beByChunk.get(ck) || beByChunk.set(ck, []).get(ck)).push(be);
        }
        const secs = D.height >> 4, biomeNames = self.WG_DATA.biome_order;
        for (const [rk, list] of regions) {
          list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
          const out = [];
          for (const [cx, cz] of list) {
            const c = await chunk(cx, cz);
            if (!c) { stats.skipped++; continue; }
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) await chunk(cx + dx, cz + dz);
            const near = (x, z) => cache.get((cx + Math.floor(x / 16)) + ',' + (cz + Math.floor(z / 16)));
            const sections = [], qb = biomes.get(cx + ',' + cz);
            for (let sy = 0; sy < secs; sy++) {
              const base = sy * 4096, stamp = ++secSerial, pal = [], idx = new Uint16Array(4096), own = new Map();
              for (let i = 0; i < 4096; i++) {
                const ci = base + i, id = c.B[ci], m = c.M[ci];
                let e = entryOf(id, m, stats);
                const wl = !!(c.W && c.W.has(ci));
                if (e.ctx || (wl && e.wl)) {
                  const lx = i & 15, lz = (i >> 4) & 15, ly = (ci >> 8);
                  const get = (dx, dy, dz) => {
                    const y = ly + dy, x = lx + dx, z = lz + dz;
                    if (y < 0 || y >= HEIGHT) return [0, 0];
                    const h = x >= 0 && x < 16 && z >= 0 && z < 16 ? c : near(x, z);
                    if (!h) return [0, 0];
                    const j = (y << 8) | ((z & 15) << 4) | (x & 15);
                    return [h.B[j], h.M[j]];
                  };
                  const ce = cellEntry(e, m, wl, get);
                  e = own.get(ce.key) || (own.set(ce.key, ce), ce);
                }
                if (e.sec !== stamp) { e.sec = stamp; e.pi = pal.length; pal.push(e.nbt); }
                idx[i] = e.pi;
              }
              const block_states = pal.length === 1 ? { palette: pal } : { palette: pal, data: pack(idx, 4096, Math.max(4, ceilLog2(pal.length))) };
              // 4 x 4 x 4 biomes: the same order as the generator's (y, z, x)
              let biomesNbt = { palette: [ns('plains')] };
              if (qb) {
                const bp = [], bm = new Map(), bi = new Uint8Array(64);
                for (let j = 0; j < 64; j++) { const v = qb[sy * 64 + j]; let k = bm.get(v); if (k === undefined) { k = bp.length; bm.set(v, k); bp.push(ns(biomeNames[v])); } bi[j] = k; }
                biomesNbt = bp.length === 1 ? { palette: bp } : { palette: bp, data: pack(bi, 64, ceilLog2(bp.length)) };
              }
              sections.push({ Y: NBT.byte((D.minY >> 4) + sy), block_states, biomes: biomesNbt });
            }
            const bes = [];
            for (const be of beByChunk.get(cx + ',' + cz) || []) {
              const [x, y, z] = be.pos || [];
              if (y === undefined || y < 0 || y >= D.height) continue;
              const st = stateFor(c.B[(y << 8) | ((z & 15) << 4) | (x & 15)], c.M[(y << 8) | ((z & 15) << 4) | (x & 15)]);
              let o = null; try { o = blockEntityNbt(be, st ? st.name : '', x, y + D.minY, z); } catch (e) { o = null; }
              if (o) { bes.push(o); stats.blockEntities++; }
            }
            const nbt = {
              DataVersion: DATA_VERSION, xPos: cx, yPos: D.minY >> 4, zPos: cz, Status: 'minecraft:full', LastUpdate: 0n, InhabitedTime: 0n,
              isLightOn: NBT.byte(0), sections, block_entities: bes, block_ticks: [], fluid_ticks: [], PostProcessing: [],
              structures: { References: {}, starts: {} },
            };
            out.push([cx & 31, cz & 31, await NBT.deflate(NBT.write(nbt), 'deflate')]);
            stats.chunks++; done++;
            if (performance.now() - lastYield > 40) { lastYield = performance.now(); progress && progress(done / total, `正在转换区块 ${done} / ${total}`); await pause(); }
          }
          if (out.length) { const [rx, rz] = rk.split(','); add(`${D.dir}region/r.${rx}.${rz}.mca`, regionFile(out)); }
        }
        // entities, by chunk
        const ents = new Map();
        for (const r of d.mobs || []) {
          let o = null; try { o = entityNbt(r, D.minY); } catch (e) { o = null; }
          if (!o) continue;
          const cx = Math.floor(r.pos[0]) >> 4, cz = Math.floor(r.pos[2]) >> 4, k = cx + ',' + cz;
          (ents.get(k) || ents.set(k, { cx, cz, list: [] }).get(k)).list.push(o);
          stats.entities++;
        }
        const eRegions = new Map();
        for (const { cx, cz, list } of ents.values()) {
          const data = await NBT.deflate(NBT.write({ DataVersion: DATA_VERSION, Position: Int32Array.of(cx, cz), Entities: list }), 'deflate');
          const rk = (cx >> 5) + ',' + (cz >> 5);
          (eRegions.get(rk) || eRegions.set(rk, []).get(rk)).push([cx & 31, cz & 31, data]);
        }
        for (const [rk, list] of eRegions) { const [rx, rz] = rk.split(','); add(`${D.dir}entities/r.${rx}.${rz}.mca`, regionFile(list)); }
      }
    } finally { pool.terminate(); }
    const pl = playerNbt(meta);
    if (pl) add('player.dat', await NBT.deflate(NBT.write(pl), 'gzip'));
    const rules = {};
    for (const [k, v] of Object.entries(meta.gameRules || {})) if (/^[a-z_]{1,48}$/.test(k) && (typeof v === 'boolean' || Number.isInteger(v))) rules[k] = v;
    const info = {
      name: meta.name, seed: String(meta.seed), time: Math.max(0, Math.floor(meta.time || 0)) % 24000,
      spawn: meta.spawn ? [Math.floor(meta.spawn[0]), Math.floor(meta.spawn[1]) + DIMS[0].minY, Math.floor(meta.spawn[2])] : null, rules,
    };
    add('world.json', new TextEncoder().encode(JSON.stringify(info)));
    progress && progress(1, '转换完成');
    return { files, info, stats, bytes };
  }

  // one file: "OMCW", the number of files, then each one's path (u16 length + UTF-8) and data (u32 length + bytes)
  function packFiles(files) {
    const te = new TextEncoder(), parts = [];
    let n = 8;
    for (const [p, d] of files) { const pb = te.encode(p); parts.push([pb, d]); n += 6 + pb.length + d.length; }
    const out = new Uint8Array(n), dv = new DataView(out.buffer);
    out.set(te.encode('OMCW')); dv.setUint32(4, parts.length);
    let o = 8;
    for (const [pb, d] of parts) { dv.setUint16(o, pb.length); out.set(pb, o + 2); o += 2 + pb.length; dv.setUint32(o, d.length); out.set(d, o + 4); o += 4 + d.length; }
    return out;
  }
  return { build, packFiles, MAX_BYTES, stateFor };
})();
