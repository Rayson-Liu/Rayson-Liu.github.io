'use strict';
// World generation core: the vanilla stage-1 generator (noise, aquifers, surface, carvers) and the
// structures. Runs as a Web Worker; when the page cannot start workers (opened from file://, where
// Chrome / Edge refuse them) the same core runs inside the page (see GenPool in terrain2.js).
// Messages:
//   {type:'init', seed, palette, smap}        -> builds the generator
//   {type:'gen', cx, cz, dim, height, id}     -> {type:'chunk', cx, cz, id, blocks, qb, hm, sb, [meta, sx]}
//   {type:'locate', name, cx, cz, dim, id}    -> {type:'locate', id, r}
//   {type:'spawn', id}                        -> {type:'spawn', id, x, z}
//   {type:'biomes', list: [[cx, cz]...], dim, id} -> {type:'biomes', id, qy, data} (3D biomes, 16 * qy a chunk)
(function () {
  const inWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
  if (inWorker) importScripts('worldgen_data.js', 'blockdata.js', 'worldgen.js', 'structures_data.js', 'structgen.js', 'structtypes.js');

  function makeGenCore() {
    let gen = null, seed = null, palette = null, initErr = null;
    const gens = {};
    // one generator per dimension; chunks are padded to the world's full height. (A generator that could not be built
    // says why in every answer: the jobs used to fail with "G is null", and the page's error log never showed the cause)
    const genFor = (dim) => {
      if (!gen) throw new Error('generator not built' + (initErr ? ': ' + initErr : ''));
      return gens[dim] || (gens[dim] = dim === 'overworld' ? gen : new WG.Generator(BigInt(seed), self.WG_DATA, palette, dim));
    };
    return async function handle(m, post) {
      try {
        if (m.type === 'init') {
          seed = m.seed; palette = m.palette;
          if (m.smap && self.SG) { SG.setStateMap(m.smap, m.swl); SG.setPalette(m.palette); }
          gen = new WG.Generator(BigInt(m.seed), self.WG_DATA, m.palette);
          gens.overworld = gen;
          post({ type: 'ready' });
        } else if (m.type === 'gen') {
          const G = genFor(m.dim || 'overworld'), t0 = performance.now();
          // structures reaching this chunk: their terrain adaptation goes into the noise, their pieces
          // are placed right after the carvers (vanilla places them in the feature steps)
          // (structures that fail - their templates not unpacked, a browser without DecompressionStream - leave the chunk
          // without them and say so in msg.warn, instead of failing the chunk. Firefox before 113 runs the game but has no
          // DecompressionStream: SG.ready was rejected once and for all, every chunk of the session came back as an error,
          // and the page took the errors for chunks - telemetry 11-02/03, all Firefox devices, the world never loaded)
          let sc = null, warn = null;
          const noStructs = (e) => { sc = null; G.beard = null; warn = 'structures: ' + String(e && e.stack || e); };
          if (m.structures !== false && self.SG && G.dim !== 'end') {
            try { await SG.ready; sc = SG.forChunk(G, m.cx, m.cz); G.beard = sc.beard; }
            catch (e) { noStructs(e); }
          }
          const t1 = performance.now();
          let c;
          // (terrain that fails with a structure's adaptation in it is made again without)
          try { c = G.generate(m.cx, m.cz); }
          catch (e) { if (!G.beard) throw e; noStructs(e); c = G.generate(m.cx, m.cz); }
          finally { G.beard = null; }
          const t2 = performance.now();
          let sx = null;
          if (sc && sc.starts.length) {
            // (pieces that fail half placed: the terrain once more, without them)
            try { sx = SG.place(G, m.cx, m.cz, c.blocks, c.meta, c.heightmap, sc.starts); }
            catch (e) { noStructs(e); sx = null; c = G.generate(m.cx, m.cz); }
          }
          // surface biome per column (zoomed at the top block), for tints, weather and spawning; in the Nether
          // there is no "surface", so use the floor below y 64
          const sb = new Uint8Array(256);
          for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
            const wx = m.cx * 16 + x, wz = m.cz * 16 + z;
            const y = G.dim === 'nether' ? 40 : c.heightmap[z * 16 + x] + 1;
            sb[z * 16 + x] = G.biomeIdx.get(G.biomeAt(wx, y, wz));
          }
          if (m.height && m.height > G.height) {
            const b = new Uint16Array(256 * m.height); b.set(c.blocks); c.blocks = b;
            const mt = new Uint8Array(256 * m.height); mt.set(c.meta); c.meta = mt;
            const q = new Uint8Array(16 * (m.height >> 2)); q.set(c.quartBiomes);
            for (let i = c.quartBiomes.length; i < q.length; i++) q[i] = q[i - 16];
            c.quartBiomes = q;
          }
          const msg = { type: 'chunk', cx: m.cx, cz: m.cz, id: m.id, blocks: c.blocks, qb: c.quartBiomes, hm: c.heightmap, sb, ms: [t1 - t0, t2 - t1, performance.now() - t2] };
          if (warn) msg.warn = warn;
          const tr = [c.blocks.buffer, c.quartBiomes.buffer, c.heightmap.buffer, sb.buffer];
          if (sx) { msg.meta = c.meta; msg.sx = sx; tr.push(c.meta.buffer); }
          post(msg, tr);
        } else if (m.type === 'locate') {
          await SG.ready;
          post({ type: 'locate', id: m.id, r: SG.locate(genFor(m.dim || 'overworld'), m.name, m.cx, m.cz) });
        } else if (m.type === 'biomes') {
          // vanilla's 3D biomes (one per 4 x 4 x 4 cell, indices into biome_order) of some chunks, for turning a save
          // into a vanilla world (export.js)
          const G = genFor(m.dim || 'overworld'), QY = G.height >> 2, n = 16 * QY, out = new Uint8Array(m.list.length * n);
          G.rs.endChunk();
          m.list.forEach(([cx, cz], k) => {
            for (let qy = 0; qy < QY; qy++) for (let qz = 0; qz < 4; qz++) for (let qx = 0; qx < 4; qx++)
              out[k * n + (qy * 4 + qz) * 4 + qx] = G.biomeIdx.get(G.biomes.at(cx * 4 + qx, (G.minY >> 2) + qy, cz * 4 + qz));
          });
          post({ type: 'biomes', id: m.id, qy: QY, data: out }, [out.buffer]);
        } else if (m.type === 'spawn') {
          const r = WG.findSpawn(genFor('overworld'));
          post({ type: 'spawn', id: m.id, x: r[0], z: r[1] });
        }
      } catch (err) {
        if (m.type === 'init' && !initErr) initErr = String(err && err.message || err);
        post({ type: 'error', id: m.id, message: String(err && err.stack || err) });
      }
    };
  }

  if (inWorker) {
    const handle = makeGenCore();
    self.onmessage = (e) => handle(e.data, (msg, tr) => self.postMessage(msg, tr || []));
  } else self.makeGenCore = makeGenCore;
})();
