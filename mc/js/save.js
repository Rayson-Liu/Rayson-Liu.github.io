'use strict';
// ---------------------------------------------------------------------------
// Persistence: IndexedDB, falling back to localStorage, then to memory
// ---------------------------------------------------------------------------
const LS = {
  ok: (() => { try { const k = '__mcjs_test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })(),
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  keys(prefix) { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(prefix)) out.push(k); } return out; },
};

const DB = {
  NAME: 'mc-js-clone',
  // the stores and how each is made (a new one only needs adding here: the database is bumped by itself - see connect)
  STORES: { worlds: { keyPath: 'id' }, chunks: undefined },
  db: null, mem: { worlds: new Map(), chunks: new Map() }, ok: false, backend: 'memory', opens: 0, blocked: false,
  // the first open: IndexedDB missing or failing -> localStorage, else memory. A database that is slow to answer
  // (another page holding it while it has to be repaired) doesn't keep the game from starting: after 8 s the title
  // comes up and what reads or saves waits for the connection (wait)
  open() {
    return new Promise((res) => {
      let done = false, t = 0;
      const fin = (ok) => { if (done) return; done = true; clearTimeout(t); if (ok) { this.ok = true; this.backend = 'idb'; } else this.backend = LS.ok ? 'local' : 'memory'; res(ok); };
      t = setTimeout(() => fin(true), 8000);
      // (a late failure: nothing was written to it meanwhile - every read and save was waiting for it)
      this.conn().then(() => fin(true), () => { if (!done) fin(false); else if (!this.db && !this.opens) this.backend = LS.ok ? 'local' : 'memory'; });
    });
  },
  // the browser closes the connection by itself (a phone app sent to the background, storage cleaned up, another
  // tab upgrading): every save after that failed with "The database connection is closing" - 1739 devices on
  // 2026-11-01/02, "保存失败", worlds rolled back. The handle is dropped when that happens and opened again
  took(db) {
    this.db = db;
    db.onclose = () => { db.gone = true; if (this.db === db) this.db = null; };
    db.onversionchange = () => this.drop(db);
  },
  drop(db) { db.gone = true; try { db.close(); } catch (e) { } if (this.db === db) this.db = null; },
  conn() {
    if (this.db) return Promise.resolve(this.db);
    if (!this.reopening) {
      const p = this.reopening = this.connect().then(
        (db) => { if (this.reopening === p) this.reopening = null; this.took(db); this.opens++; return db; },
        (e) => { if (this.reopening === p) this.reopening = null; throw e; });
      p.catch(() => { });
    }
    return this.reopening;
  },
  // ...and that reopen came back with a database without its stores: "One of the specified object stores was not
  // found" on every save and on creating a world (386 devices from 2026-11-02 23:00, iOS Bilibili app / Safari,
  // 101 an hour by 11-03 18:00). The storage had been cleared while the connection was closed, and the reopen (no
  // upgrade handler) made a new, empty database; a reload didn't help either, the empty one was there to stay.
  // Now every open goes through here: the database as it is (whatever its version; a new one gets its stores in its
  // upgrade), and one missing a store is opened again one version up, whose upgrade adds only what is missing.
  // (A healthy database is left at its version: no versionchange for other pages - an older build still open in
  // another tab opens version 1 by number and would fail with a VersionError after a bump)
  async connect() {
    let ver;
    for (let n = 0; ; n++) {
      let db, made = false;
      try { db = await this.req(ver, () => { made = true; }); }
      catch (e) { if (e && e.name === 'VersionError' && n < 4) { ver = undefined; continue; } throw e; } // (another page bumped it first)
      if (made) this.note(ver ? 'save_db_repaired' : this.opens ? 'save_db_recreated' : 'save_db_new');
      const miss = Object.keys(this.STORES).filter((s) => !db.objectStoreNames.contains(s));
      if (!miss.length) { if (!this.opens) try { localStorage.setItem('mcjs-db', '1'); } catch (e) { } return db; }
      ver = db.version + 1; try { db.close(); } catch (e) { }
      if (n >= 4) throw new Error('存档数据库缺少 ' + miss.join('、') + '，修复失败');
    }
  },
  // one open request (ver: that version; none: the version it has, or 1 for a new database). blocked: another
  // page's connection is in the way of the upgrade; the request goes on by itself once that page lets go
  req(ver, upgraded) {
    return new Promise((res, rej) => {
      let r;
      try { r = ver ? indexedDB.open(this.NAME, ver) : indexedDB.open(this.NAME); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [s, o] of Object.entries(this.STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, o);
        upgraded();
      };
      // (closed at once when another page needs to upgrade: this one's own repair open must not be held up either)
      r.onsuccess = () => { this.blocked = false; const db = r.result; db.onversionchange = () => { db.gone = true; db.close(); }; res(db); };
      r.onerror = () => { this.blocked = false; rej(r.error || new Error('打不开存档数据库')); };
      r.onblocked = () => { this.blocked = true; };
    });
  },
  // what happened to the database (telemetry: how often it is new / gone mid-game / repaired; a device that had one
  // and starts with a new one lost its worlds between two visits)
  note(k) {
    if (k === 'save_db_new') { let had = null; try { had = localStorage.getItem('mcjs-db'); } catch (e) { } if (had) k = 'save_db_gone'; }
    if (typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count(k);
  },
  // the connection, or an error instead of waiting for ever (saving and quitting waits on it)
  wait() {
    if (this.db) return Promise.resolve(this.db);
    const p = this.conn();
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(this.blocked ? '存档数据库被另一个打开着的游戏页面占用：关掉其他游戏页面再试' : '存档数据库没有响应，稍后再试')), 15000);
      p.then((db) => { clearTimeout(t); res(db); }, (e) => { clearTimeout(t); rej(e); });
    });
  },
  // errors a fresh connection gets past: closed or closing (InvalidStateError; WebKit "Connection to Indexed
  // Database server lost" and "Database deleted by request of the user" are UnknownErrors), a store missing
  // (NotFoundError - the reopen repairs it), a transaction aborted under it
  stale(e) { return !!e && (/^(InvalidStateError|NotFoundError|UnknownError|AbortError)$/.test(e.name) || /clos(ing|ed)|lost|deleted/i.test(e.message || '')); },
  // what the player reads after "保存失败: " (the browser's words are English; telemetry: QuotaExceededError on 6 devices)
  nice(e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || ''))) {
      const q = new Error('存储空间不够了：删掉不玩的世界，或清理设备的存储空间 (QuotaExceededError)'); q.name = 'QuotaExceededError'; return q;
    }
    return e;
  },
  // (again on a fresh connection when this one turned out closed or broken; puts are the same the second time and a
  // failed transaction wrote nothing)
  async tx(store, mode, fn) {
    for (let i = 0; ; i++) {
      let db = null;
      // (a failed open is not tried again here - connect already did - but its error reads like the others)
      try { db = await this.wait(); return await this.tx1(db, store, mode, fn); }
      catch (e) { if (!db || i >= 2 || !(db.gone || this.stale(e))) throw this.nice(e || new Error('存档数据库出错')); this.drop(db); }
    }
  },
  tx1(db, store, mode, fn) {
    return new Promise((res, rej) => {
      // (writes: relaxed durability - done once the data is with the system, not after forcing it to disk: a save
      // costs phones less I/O and power; only a power cut right after it could lose that one save)
      const t = mode === 'readwrite' ? db.transaction(store, mode, { durability: 'relaxed' }) : db.transaction(store, mode), s = t.objectStore(store);
      let out, r;
      // (a throw half way - a record that can't be stored - must not leave the puts before it to commit)
      try { r = fn(s); } catch (e) { try { t.abort(); } catch (e2) { } throw e; }
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      // (a failed request's error reaches the transaction before the transaction has an error of its own:
      // t.error is still null here, the save was rejected with null - no retry on a lost connection, and
      // saveWorld's "保存失败: " + e.message threw instead of showing anything)
      t.onerror = (ev) => rej((ev && ev.target && ev.target.error) || t.error || new Error('存档数据库出错'));
      // an aborted transaction (the browser closed the database, out of space ...) fires neither of the two
      // above: without this its promise never settled and whatever waited on it (a chunk's saved data, the
      // save on leaving the world) waited for ever
      t.onabort = () => rej(t.error || new Error('数据库事务被中止'));
    });
  },
  async listWorlds() {
    let all;
    if (this.backend === 'idb') all = await this.tx('worlds', 'readonly', s => s.getAll());
    else if (this.backend === 'local') all = LS.keys('mcjs:w:').map(k => LS.get(k)).filter(Boolean);
    else all = [...this.mem.worlds.values()];
    return (all || []).sort((a, b) => b.lastPlayed - a.lastPlayed);
  },
  async getWorld(id) {
    if (this.backend === 'idb') return this.tx('worlds', 'readonly', s => s.get(id));
    if (this.backend === 'local') return LS.get('mcjs:w:' + id);
    return this.mem.worlds.get(id);
  },
  async putWorld(w) {
    if (this.backend === 'idb') return this.tx('worlds', 'readwrite', s => s.put(w));
    if (this.backend === 'local') { try { LS.set('mcjs:w:' + w.id, w); } catch (e) { throw this.nice(e); } return; }
    this.mem.worlds.set(w.id, w);
  },
  async deleteWorld(id) {
    if (this.backend === 'idb') {
      await this.tx('worlds', 'readwrite', s => s.delete(id));
      for (const sid of [id, id + '~nether', id + '~end']) await this.tx('chunks', 'readwrite', s => s.delete(IDBKeyRange.bound(sid + ':', sid + ':￿')));
    } else if (this.backend === 'local') {
      localStorage.removeItem('mcjs:w:' + id);
      for (const sid of [id, id + '~nether', id + '~end']) for (const k of LS.keys('mcjs:c:' + sid + ':')) localStorage.removeItem(k);
    } else {
      this.mem.worlds.delete(id);
      for (const k of [...this.mem.chunks.keys()]) if (k.startsWith(id + ':') || k.startsWith(id + '~')) this.mem.chunks.delete(k);
    }
  },
  async loadChunks(id) {
    const out = new Map();
    if (this.backend === 'idb') {
      // (through tx like every other read: a closed or broken database is opened again / repaired first. A failed
      // read is an error, not "no saved chunks": that made the world come back as fresh terrain, saved over the edits)
      await this.tx('chunks', 'readonly', (s) => {
        out.clear();
        const req = s.openCursor(IDBKeyRange.bound(id + ':', id + ':￿'));
        req.onsuccess = () => {
          const c = req.result;
          if (c) { const [, cx, cz] = c.key.split(':'); out.set(ckey(+cx, +cz), c.value); c.continue(); }
        };
      });
    } else if (this.backend === 'local') {
      for (const k of LS.keys('mcjs:c:' + id + ':')) {
        const [, , , cx, cz] = k.split(':'); const v = LS.get(k);
        if (v) out.set(ckey(+cx, +cz), this.lsChunk(v));
      }
    } else {
      for (const [k, v] of this.mem.chunks) if (k.startsWith(id + ':')) { const [, cx, cz] = k.split(':'); out.set(ckey(+cx, +cz), v); }
    }
    return out;
  },
  // the keys of a world's saved chunks; the records themselves are read one at a time when their chunk loads
  // (Game.savedReady): an imported world can hold tens of thousands of them
  async chunkKeys(id) {
    const out = new Set(), add = (k) => { const [, cx, cz] = k.split(':'); out.add(ckey(+cx, +cz)); };
    if (this.backend === 'idb') { for (const k of (await this.tx('chunks', 'readonly', s => s.getAllKeys(IDBKeyRange.bound(id + ':', id + ':\uffff')))) || []) add(k); }
    else if (this.backend === 'local') { for (const k of LS.keys('mcjs:c:' + id + ':')) add(k.slice(7)); }
    else for (const k of this.mem.chunks.keys()) if (k.startsWith(id + ':')) add(k);
    return out;
  },
  async getChunk(id, cx, cz) {
    const k = id + ':' + cx + ':' + cz;
    if (this.backend === 'idb') return this.tx('chunks', 'readonly', s => s.get(k));
    if (this.backend === 'local') { const v = LS.get('mcjs:c:' + k); return v ? this.lsChunk(v) : undefined; }
    return this.mem.chunks.get(k);
  },
  // a chunk record in localStorage is JSON: its waterlogged cells (w) went missing there, so a world saved without
  // IndexedDB lost the water in its stairs, slabs, fences ... on every reload
  lsChunk(v) { const r = { b: new Uint16Array(v.b), m: new Uint16Array(v.m) }; if (v.w && v.w.length) r.w = new Uint32Array(v.w); return r; },
  async putChunks(id, list) {
    if (!list.length) return;
    if (this.backend === 'idb') return this.tx('chunks', 'readwrite', s => { for (const [cx, cz, v] of list) s.put(v, id + ':' + cx + ':' + cz); });
    if (this.backend === 'local') {
      try { for (const [cx, cz, v] of list) LS.set('mcjs:c:' + id + ':' + cx + ':' + cz, v.w && v.w.length ? { b: Array.from(v.b), m: Array.from(v.m), w: Array.from(v.w) } : { b: Array.from(v.b), m: Array.from(v.m) }); }
      catch (e) { throw this.nice(e); }
      return;
    }
    for (const [cx, cz, v] of list) this.mem.chunks.set(id + ':' + cx + ':' + cz, v);
  },
};

function encodeChunk(ch) {
  const r = { b: new Uint16Array(rleEncode(ch.flatBlocks())), m: new Uint16Array(rleEncode(ch.flatMeta())) };
  if (ch.wl && ch.wl.size) r.w = Uint32Array.from(ch.wl); // the waterlogged cells (block indices)
  return r;
}
// replaces the chunk's blocks and meta (its light is worked out again)
function decodeChunk(rec, ch) {
  const n = 256 * HEIGHT;
  ch.packFrom(rleDecode(rec.b, n), rleDecode(rec.m, n));
  ch.wl = rec.w && rec.w.length ? new Set(rec.w) : null;
  ch.lit = false;
}
