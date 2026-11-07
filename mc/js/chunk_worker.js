'use strict';
// ---------------------------------------------------------------------------
// Chunk worker: the stages of a gen-2 chunk that used to run on the main thread (terrain2.js genStep is
// still the fallback when the page can't start workers):
//   - decoration: vanilla features write into the 8 neighbouring chunks, so this worker owns the unfinished
//     ("proto") chunks: a proto is decorated once its neighbours exist and finished once they are decorated,
//     nearest the player first; finished chunks are lit (their own light) and go back to the page
//   - meshing of terrain sections from the padded arrays the page gathered (Mesher.snapshot)
// Messages in:  reset {epoch, seed, dim, minY, structures} | proto {epoch, cx, cz, blocks, qb, hm, sb, meta?, sx?}
//               center {epoch, cx, cz, R} | unloaded {epoch, keys, ask} | mesh {id, ...snapshot, cx, sy, cz}
//               have {epoch, keys, biomes} (chunks the page has: neighbours to build against) | skip {keys, stages}
// Messages out: ready | final {epoch, cx, cz, sec (Chunk.wire: sections with light), biome, sx, nb} | dropped {epoch, keys}
//               mesh {id, opaque, trans, nOpaque, nTrans, vis} | held {epoch, ask, keys} | work {k, s} (the chunk being built)
// ---------------------------------------------------------------------------
self.window = self;
importScripts('assets.js', 'util.js', 'worldgen_data.js', 'worldgen.js', 'blockdata.js', 'blocks.js', 'world.js', 'mesher.js',
  'models.js', 'vmodels.js', 'structures_data.js', 'structgen.js', 'structtypes.js', 'features.js', 'trees.js');
setWorldFormat(2);
initAnimTable();

const VB_BASE = 32; // as terrain2.js
const seed32 = (s) => Number(BigInt.asIntN(32, BigInt(s)));
let W = null, epoch = 0, center = null;
const finished = new Map(); // key -> biome of chunks handed to the page (neighbours for decoration and tints)
const meshQ = [];
// chunks a worker before this one hung on (the page's ChunkWorker.poison, key -> stage): one that hung while being
// decorated goes on undecorated, one that hung being finished is handed over broken (the page puts an empty chunk there).
// Built again, it hung the new worker too
const skip = new Map();
// what Features.decorate needs from the game: the biome zoom cache and the structure-feature step
const host = {
  structureFeatures(ch, ctx, rand, place) {
    if (!ch.sx || !ch.sx.feat) return;
    for (const [x, y, z, f] of ch.sx.feat) place(ctx, f, rand, [x, y, z], f);
  },
};

function reset(m) {
  epoch = m.epoch;
  W = new World(seed32(m.seed), m.dim);
  W.gen2 = true; W.minY = m.minY; W.seedStr = String(m.seed); W.structures = m.structures;
  W.proto = new Map();
  finished.clear(); center = null;
  skip.clear(); // (the page sends the new world's own right after this: another world's chunks at those places are fine)
}
function addProto(m) {
  const k = ckey(m.cx, m.cz);
  if (!W || W.proto.has(k) || !m.blocks || !m.sb) return;
  // the page only sends a chunk it doesn't have: one it lost (an error while adding it) comes again
  finished.delete(k);
  const ch = Chunk.from(m.cx, m.cz, m.blocks, m.meta || null); // packed into sections like the page's chunks
  Object.assign(ch, { qb: m.qb, hm: m.hm, sx: m.sx || null, stage: 1 });
  if (m.sx && m.sx.wl && m.sx.wl.length) ch.wl = new Set(m.sx.wl); // structure blocks holding water
  for (let i = 0; i < 256; i++) ch.biome[i] = VB_BASE + m.sb[i];
  // the structures this chunk lies in, as the page records them (terrain2.js): decorate() builds nether fortresses
  // from these (World.fortressesNear reads structRefs in a gen-2 world). Only the page kept them, so fortresses
  // were never built while this worker decorated the chunks
  if (m.sx && m.sx.refs) { const refs = W.structRefs || (W.structRefs = new Map()); for (const [name, box, f] of m.sx.refs) refs.set(name + ':' + box[0] + ',' + box[2], { name, box, f }); }
  W.proto.set(k, ch);
}
// every neighbour present (a proto passing `ok`, or already finished, which is read-only)
function around(ch, ok) {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    if (!a && !b) continue;
    const k = ckey(ch.cx + a, ch.cz + b), n = W.proto.get(k);
    if (n) { if (!ok(n)) return false; } else if (!finished.has(k)) return false;
  }
  return true;
}
function decorate(ch) {
  if (W.structures !== false) for (const sb of W.structuresFor(ch.cx, ch.cz)) sb.apply(ch);
  Features.decorate(host, W, ch);
  ch.stage = 2;
}
function finish(ch) {
  const k = ckey(ch.cx, ch.cz);
  W.proto.delete(k);
  finished.set(k, ch.biome);
  // biomes of the 3x3 chunks, for the 5x5 tint blend on the page
  const nb = new Uint8Array(9 * 256);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const kk = ckey(ch.cx + a, ch.cz + b), n = W.proto.get(kk), bio = n ? n.biome : finished.get(kk);
    nb.set(bio || ch.biome, ((b + 1) * 3 + (a + 1)) * 256);
  }
  const sx = ch.sx || ch.wl ? { loot: ch.sx ? ch.sx.loot : [], ent: ch.sx ? ch.sx.ent : [] } : null;
  if (ch.wl && ch.wl.size) sx.wl = [...ch.wl];
  // the chunk's own light is worked out here too: the page only adds what crosses from its neighbours
  lightChunk(ch, W.hasSky);
  const [sec, tr] = ch.wire(true);
  tr.push(nb.buffer);
  postMessage({ type: 'final', epoch, cx: ch.cx, cz: ch.cz, sec, biome: ch.biome, sx, nb }, tr);
}
// forget protos far from the player (the page re-requests them if it comes back)
function prune() {
  if (!center) return;
  const R = center.R, dropped = [];
  for (const [k, ch] of W.proto) {
    const dx = ch.cx - center.cx, dz = ch.cz - center.cz;
    if (dx * dx + dz * dz > (R + 5.5) * (R + 5.5)) { W.proto.delete(k); dropped.push(k); }
  }
  for (const k of finished.keys()) {
    const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768, dx = cx - center.cx, dz = cz - center.cz;
    if (dx * dx + dz * dz > (R + 8) * (R + 8)) finished.delete(k);
  }
  if (dropped.length) postMessage({ type: 'dropped', epoch, keys: dropped });
}
// time spent per kind of job (ms) and jobs done, sent to the page about once a second (performance overlay)
const stats = { mesh: 0, decorate: 0, finish: 0, nMesh: 0, nDecorate: 0, nFinish: 0, busy: 0 };
let statsT = performance.now();
function timed(kind, fn) { const t = performance.now(); fn(); stats[kind] += performance.now() - t; stats['n' + kind[0].toUpperCase() + kind.slice(1)]++; }
// one unit of work: a mesh job first (it is on screen), else the nearest chunk to decorate or finish
// an error stepped over: in this worker's console and in the page's error log (the performance report)
function report(where, e) {
  console.error('chunk worker: ' + where, e);
  postMessage({ type: 'error', where, msg: String(e && e.message || e), stack: String(e && e.stack || '') });
}
function step() {
  if (meshQ.length) {
    timed('mesh', () => {
      const m = meshQ.shift();
      let r;
      try { Mesher.load(m); r = Mesher.buildGathered(m.cx, m.sy, m.cz); }
      catch (e) { report('mesh ' + m.cx + ',' + m.sy + ',' + m.cz, e); postMessage({ type: 'mesh', id: m.id, error: String(e && e.message || e) }); return; } // the page meshes it itself
      const tr = [];
      if (r.opaque) tr.push(r.opaque.buffer);
      if (r.trans) tr.push(r.trans.buffer);
      postMessage({ type: 'mesh', id: m.id, opaque: r.opaque, trans: r.trans, nOpaque: r.nOpaque, nTrans: r.nTrans, vis: r.vis }, tr);
    });
    return true;
  }
  if (!W || !center) return false;
  const R = center.R, F2 = (R + 1.5) * (R + 1.5), D2 = (R + 3) * (R + 3);
  let best = null, bestD = Infinity;
  for (const ch of W.proto.values()) {
    const dx = ch.cx - center.cx, dz = ch.cz - center.cz, d2 = dx * dx + dz * dz;
    if (d2 > D2 || d2 >= bestD) continue;
    if (ch.stage === 2 ? d2 <= F2 && around(ch, (n) => n.stage === 2) : around(ch, () => true)) { best = ch; bestD = d2; }
  }
  if (!best) return false;
  const bk = ckey(best.cx, best.cz), sk = skip.get(bk);
  if (sk === best.stage) {
    if (sk === 1) { best.stage = 2; return true; }
    W.proto.delete(bk); finished.set(bk, best.biome);
    postMessage({ type: 'final', epoch, cx: best.cx, cz: best.cz, broken: 'skipped: a chunk worker hung finishing it' });
    return true;
  }
  // (the page's check knows from this which chunk a worker that stops answering hung on; 'work' without k: done)
  postMessage({ type: 'work', k: bk, s: best.stage });
  // a chunk whose decoration fails is finished without it; one that can't be finished goes to the page as
  // broken (it fills the place with an empty chunk). Before, the failing chunk stayed nearest and was picked
  // again every time, and nothing behind it was ever generated
  if (best.stage === 1) { try { timed('decorate', () => decorate(best)); } catch (e) { report('decorate ' + best.cx + ',' + best.cz, e); best.stage = 2; } postMessage({ type: 'work' }); }
  else {
    try { timed('finish', () => finish(best)); }
    catch (e) {
      report('finish ' + best.cx + ',' + best.cz, e);
      const k = ckey(best.cx, best.cz);
      W.proto.delete(k); finished.set(k, best.biome);
      postMessage({ type: 'final', epoch, cx: best.cx, cz: best.cz, broken: String(e && e.message || e) });
    }
  }
  return true;
}
// run work in short slices, yielding so new messages (meshes, the player's position) are handled promptly
const mc = new MessageChannel();
let scheduled = false;
mc.port1.onmessage = () => {
  scheduled = false;
  const t0 = performance.now();
  let did = false;
  try { while (performance.now() - t0 < 8 && step()) did = true; } catch (e) { report('step', e); }
  const t1 = performance.now();
  stats.busy += t1 - t0;
  if (t1 - statsT > 1000) {
    let bytes = 0; // what the proto chunks hold
    if (W) for (const ch of W.proto.values()) { for (const s of ch.bs) if (s) bytes += s.d.byteLength + 512; for (const m of ch.ms) if (m) bytes += 4096; }
    postMessage(Object.assign({ type: 'stats', span: t1 - statsT, protos: W ? W.proto.size : 0, protoMB: bytes / 1048576, meshQ: meshQ.length }, stats));
    for (const k in stats) stats[k] = 0;
    statsT = t1;
  }
  if (did) kick();
};
function kick() { if (!scheduled) { scheduled = true; mc.port2.postMessage(0); } }

let pruneT = 0;
function handle(m) {
  switch (m.type) {
    case 'reset': reset(m); break;
    case 'opts': setFastLeaves(m.fastLeaves); break;
    case 'proto': if (m.epoch === epoch) addProto(m); break;
    case 'center':
      if (m.epoch !== epoch) break;
      center = m;
      if (performance.now() - pruneT > 500) { pruneT = performance.now(); prune(); }
      break;
    // the page no longer has these (unloaded far chunks), or lost track of them (game.js chunkWatchdog): a finished one
    // is forgotten, one still being built here is kept, and the answer says which - the page keeps those on its list
    // instead of generating them all over again (it did, every 8 s on a slow phone, and the area never filled in)
    case 'unloaded': {
      const held = [];
      if (m.epoch === epoch && W) for (const k of m.keys) { if (W.proto.has(k)) held.push(k); else finished.delete(k); }
      if (m.ask) postMessage({ type: 'held', epoch: m.epoch, ask: m.ask, keys: held });
      break;
    }
    // finished chunks the page has (after this worker replaced a stuck one, or a final that crossed an 'unloaded')
    case 'have': if (m.epoch === epoch && W) m.keys.forEach((k, i) => { W.proto.delete(k); finished.set(k, m.biomes.slice(i * 256, i * 256 + 256)); }); break;
    case 'skip': m.keys.forEach((k, i) => skip.set(k, m.stages[i])); break;
    case 'mesh': meshQ.push(m); break;
    case 'ping': postMessage({ type: 'pong' }); return; // (the page's check that this worker is not stuck)
  }
  kick();
}
// (an error in a message is reported and stepped over: uncaught, it reached the page as the worker's error event, and
// the page gave up on this worker for good)
onmessage = (e) => { const m = e.data; try { handle(m); } catch (err) { report('message ' + (m && m.type), err); kick(); } };
postMessage({ type: 'ready' });
