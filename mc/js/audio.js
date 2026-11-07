'use strict';
// ---------------------------------------------------------------------------
// Procedural sound effects (WebAudio, no sound files). There is no music: the background music and the music
// discs were taken out (user, 2026-10-29) - jukeboxes take discs but play nothing.
// ---------------------------------------------------------------------------
const Sound = {
  ctx: null, master: null, sfx: null, noiseBuf: null,
  volume: 0.8, listener: { x: 0, y: 0, z: 0, yaw: 0 },
  init() {
    if (this.ctx) { if (this.idle) this.wake(); else if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    // iPhones: web audio follows the ring / silent switch unless the page says it plays media (iOS 16.4+), or plays
    // through an <audio> element once (older) - with the switch on silent the game had no sound while videos did
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      else if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) {
        const a = this.unmute = document.createElement('audio');
        a.setAttribute('x-webkit-airplay', 'deny'); a.preload = 'auto'; a.loop = true;
        a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';
        const pr = a.play(); if (pr && pr.catch) pr.catch(() => { });
      }
    } catch (e) { }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 1; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.volume; this.sfx.connect(this.master);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.packReady && this.predecode) this.predecode();
    this.watch();
  },
  setVolume(v) { this.volume = v; if (this.sfx) this.sfx.gain.value = v; },
  // spatial output node
  out(pos, vol = 1) {
    const c = this.ctx;
    const g = c.createGain();
    let v = vol;
    if (pos) {
      const L = this.listener, dx = pos[0] - L.x, dy = pos[1] - L.y, dz = pos[2] - L.z;
      const d = Math.hypot(dx, dy, dz);
      v *= Math.max(0, 1 - d / 20);
      if (v <= 0.001) return null;
      if (c.createStereoPanner) {
        const p = c.createStereoPanner();
        const right = dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw);
        p.pan.value = clamp(right / (d + 0.5), -1, 1) * 0.7;
        g.connect(p); p.connect(this.sfx);
      } else g.connect(this.sfx);
    } else g.connect(this.sfx);
    g.gain.value = v;
    return g;
  },
  noise(pos, { dur = 0.15, vol = 0.5, type = 'bandpass', freq = 1000, q = 1, freqEnd, attack = 0.005, delay = 0 }) {
    if (!this.ctx || this.idle) return;
    const c = this.ctx, o = this.out(pos, vol); if (!o) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(o);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  },
  tone(pos, { freq = 440, freqEnd, dur = 0.2, vol = 0.3, type = 'sine', attack = 0.01, delay = 0, dest }) {
    if (!this.ctx || this.idle) return;
    const c = this.ctx, o = dest || this.out(pos, vol); if (!o) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(dest ? vol : 1, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + dur + 0.05);
  },
  MAT: {
    stone: { freq: 900, q: 0.8, dur: 0.12, type: 'bandpass' },
    wood: { freq: 450, q: 2.5, dur: 0.13, type: 'bandpass' },
    grass: { freq: 2400, q: 0.5, dur: 0.14, type: 'highpass' },
    gravel: { freq: 1300, q: 0.6, dur: 0.16, type: 'bandpass' },
    sand: { freq: 3000, q: 0.4, dur: 0.16, type: 'highpass' },
    snow: { freq: 3500, q: 0.4, dur: 0.18, type: 'highpass' },
    glass: { freq: 3500, q: 3, dur: 0.1, type: 'bandpass' },
    wool: { freq: 600, q: 0.4, dur: 0.15, type: 'lowpass' },
    metal: { freq: 2000, q: 6, dur: 0.15, type: 'bandpass' },
  },
  block(kind, mat, pos) {
    if (!this.ctx) return;
    const m = this.MAT[mat] || this.MAT.stone;
    if (kind === 'step') this.noise(pos, { ...m, vol: 0.18, dur: m.dur * 0.8 });
    else if (kind === 'hit') this.noise(pos, { ...m, vol: 0.22, dur: m.dur * 0.6 });
    else if (kind === 'place') { this.noise(pos, { ...m, vol: 0.55, freq: m.freq * 0.8 }); if (mat === 'wood') this.tone(pos, { freq: 180, freqEnd: 120, dur: 0.08, vol: 0.25, type: 'triangle' }); }
    else if (kind === 'break') {
      this.noise(pos, { ...m, vol: 0.7, dur: m.dur * 1.6 });
      this.noise(pos, { ...m, vol: 0.4, dur: m.dur * 1.2, delay: 0.04, freq: m.freq * 0.7 });
      if (mat === 'glass') for (let i = 0; i < 4; i++) this.tone(pos, { freq: 2000 + Math.random() * 3000, dur: 0.15, vol: 0.12, delay: i * 0.03, type: 'sine' });
    }
  },
  pop(pos) { this.tone(pos, { freq: 600 + Math.random() * 300, freqEnd: 1400 + Math.random() * 300, dur: 0.08, vol: 0.25, type: 'sine' }); },
  click() { this.tone(null, { freq: 800, freqEnd: 500, dur: 0.05, vol: 0.25, type: 'square' }); },
  hurt(pos) { this.tone(pos, { freq: 330, freqEnd: 180, dur: 0.18, vol: 0.4, type: 'sawtooth' }); this.noise(pos, { freq: 600, dur: 0.12, vol: 0.3, type: 'lowpass' }); },
  explode(pos) {
    this.noise(pos, { type: 'lowpass', freq: 1500, freqEnd: 60, dur: 1.8, vol: 1.2, q: 0.5 });
    this.noise(pos, { type: 'lowpass', freq: 300, freqEnd: 40, dur: 2.5, vol: 1.0, q: 0.3 });
  },
  fuse(pos) { this.noise(pos, { type: 'highpass', freq: 4000, dur: 1.2, vol: 0.4, attack: 0.05 }); },
  fizz(pos) { this.noise(pos, { type: 'highpass', freq: 3000, dur: 0.5, vol: 0.4 }); },
  splash(pos) { this.noise(pos, { type: 'lowpass', freq: 2000, freqEnd: 300, dur: 0.5, vol: 0.5 }); },
  eat(pos) { this.noise(pos, { type: 'bandpass', freq: 900 + Math.random() * 400, q: 1.5, dur: 0.1, vol: 0.45 }); },
  burp(pos) { this.tone(pos, { freq: 120, freqEnd: 80, dur: 0.3, vol: 0.4, type: 'sawtooth' }); },
  bow(pos) { this.tone(pos, { freq: 300, freqEnd: 900, dur: 0.15, vol: 0.3, type: 'triangle' }); this.noise(pos, { freq: 2000, dur: 0.15, vol: 0.2 }); },
  arrowHit(pos) { this.noise(pos, { freq: 800, dur: 0.08, vol: 0.4, q: 2 }); },
  door(pos, open) { this.tone(pos, { freq: open ? 200 : 160, freqEnd: open ? 140 : 100, dur: 0.18, vol: 0.4, type: 'triangle' }); this.noise(pos, { freq: 500, q: 3, dur: 0.15, vol: 0.3 }); },
  levelup() { [0, 4, 7, 12].forEach((n, i) => this.tone(null, { freq: 523 * Math.pow(2, n / 12), dur: 0.35, vol: 0.18, type: 'triangle', delay: i * 0.09 })); },
  toast() { [0, 7].forEach((n, i) => this.tone(null, { freq: 880 * Math.pow(2, n / 12), dur: 0.3, vol: 0.15, type: 'sine', delay: i * 0.12 })); },
  note(pos, pitch) { this.tone(pos, { freq: 185 * Math.pow(2, pitch / 12), dur: 0.8, vol: 0.4, type: 'triangle' }); },
  mob(type, kind, pos) {
    if (!this.ctx) return;
    const r = Math.random();
    switch (type) {
      case 'pig': this.tone(pos, { freq: 260 + r * 60, freqEnd: 180, dur: 0.25, vol: 0.35, type: 'sawtooth' }); this.tone(pos, { freq: 240, freqEnd: 160, dur: 0.2, vol: 0.25, type: 'square', delay: 0.15 }); break;
      case 'cow': this.tone(pos, { freq: 140 + r * 20, freqEnd: 110, dur: 0.9, vol: 0.4, type: 'sawtooth', attack: 0.1 }); break;
      case 'sheep': for (let i = 0; i < 4; i++) this.tone(pos, { freq: 420 + r * 50, freqEnd: 400, dur: 0.12, vol: 0.25, type: 'sawtooth', delay: i * 0.1 }); break;
      case 'chicken': for (let i = 0; i < 2; i++) this.tone(pos, { freq: 1100 + r * 300, freqEnd: 700, dur: 0.08, vol: 0.2, type: 'square', delay: i * 0.12 }); break;
      case 'zombie': this.tone(pos, { freq: 110 + r * 30, freqEnd: 80, dur: 0.9, vol: 0.45, type: 'sawtooth', attack: 0.15 }); this.noise(pos, { freq: 300, dur: 0.8, vol: 0.2, type: 'lowpass', attack: 0.1 }); break;
      case 'skeleton': for (let i = 0; i < 4; i++) this.noise(pos, { freq: 2500, q: 5, dur: 0.05, vol: 0.35, delay: i * 0.07 }); break;
      case 'creeper': this.fuse(pos); break;
      case 'spider': this.noise(pos, { freq: 1200, q: 4, dur: 0.3, vol: 0.3 }); this.tone(pos, { freq: 90, dur: 0.3, vol: 0.2, type: 'sawtooth' }); break;
    }
    if (kind === 'hurt') this.tone(pos, { freq: 500, freqEnd: 250, dur: 0.12, vol: 0.2, type: 'square' });
  },
};

// ---------------------------------------------------------------------------
// Vanilla sound events (built from the local game assets by tools/build_sounds.py).
// Served over http the page only loads the event list (js/sound_events.js) and fetches each file
// (sounds/sfx/<name>.ogg) the first time it plays; opened from file://, where fetch is not allowed, it loads
// js/sounds.js with every file embedded (20 MB of text that stayed in memory).
// Falls back to the synthesized sounds above when the pack is missing.
// ---------------------------------------------------------------------------
// Sounds decode on first use into a size-capped cache (least recently used goes first): decoding all 1316
// files up front held ~230 MB of PCM.
const SOUND_CACHE_BYTES = 32 << 20;
Object.assign(Sound, {
  buffers: new Map(), pending: new Map(), packReady: false, cacheBytes: 0,
  // WebKit (every browser on an iPhone, the Bilibili app there, Safari on a Mac) did not decode Ogg until lately -
  // iPhones had no sound at all (players' feedback 2026-10-31): the effects are AAC (sounds/sfx/<name>.m4a), which
  // every browser decodes; the Toy package carries only those (both doubled its files and Bilibili's upload timed
  // out). A browser that can't decode AAC switches to the Ogg files where they are (decode)
  ext: '.m4a',
  loadPack() {
    // 离线单机版默认不含原版音效文件（sounds/sfx/*.m4a）。
    // 若只加载事件表却拿不到文件，Sound.ev() 会在 decode 失败时仍返回 true，
    // 包装器便不回退到下面的程序化合成音 —— 结果是全程静音。
    // 因此默认保持 packReady=false，让所有声音走 WebAudio 合成路径
    // （无需任何音频文件、零网络请求）。用户在 index.html 把
    // OPUSMC_SOUND_PACK 设为 true 并放入 sounds/sfx/*.m4a 后才会启用原版音效。
    this.packReady = false;
    if (window.OPUSMC_SOUND_PACK) this.enablePack();
  },
  enablePack() {
    if (this.packReady || window.SOUNDS) return;
    const s = document.createElement('script');
    s.src = 'js/sound_events.js';
    s.onload = () => {
      if (!window.SOUND_EVENTS) return;
      window.SOUNDS = { events: SOUND_EVENTS, files: null };
      this.packReady = true;
      this.predecode();
    };
    document.head.appendChild(s);
  },
  cached(name) {
    const b = this.buffers.get(name);
    if (b) { this.buffers.delete(name); this.buffers.set(name, b); } // most recently used last
    return b;
  },
  remember(name, buf) {
    this.buffers.set(name, buf);
    this.cacheBytes += buf.length * buf.numberOfChannels * 4;
    for (const [k, b] of this.buffers) {
      if (this.cacheBytes <= SOUND_CACHE_BYTES) break;
      this.buffers.delete(k); this.cacheBytes -= b.length * b.numberOfChannels * 4;
    }
  },
  decode(name) {
    const have = this.cached(name);
    if (have) return Promise.resolve(have);
    if (this.pending.has(name)) return this.pending.get(name);
    if (!window.SOUNDS || !this.ctx) return Promise.resolve(null);
    let data;
    if (SOUNDS.files) {
      const b64 = SOUNDS.files[name];
      if (!b64) return Promise.resolve(null);
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      data = Promise.resolve(arr.buffer);
    } else data = fetch('sounds/sfx/' + name + this.ext).then(r => r.ok ? r.arrayBuffer() : null);
    const dec = (ab) => ab && new Promise((res) => this.ctx.decodeAudioData(ab, res, () => res(null)));
    let came = false;
    const p = data.then(ab => { came = !!ab; return dec(ab); })
      .catch(() => null)
      // a file that came but would not decode: this browser can't read that kind, the other kind from now on
      .then(buf => { if (buf || !came || SOUNDS.files || this.switched) return buf; this.switched = true; this.ext = this.ext === '.m4a' ? '.ogg' : '.m4a';
        return fetch('sounds/sfx/' + name + this.ext).then(r => r.ok ? r.arrayBuffer() : null).then(dec).catch(() => null); })
      .then(buf => { this.pending.delete(name); if (buf) this.remember(name, buf); return buf; });
    this.pending.set(name, p);
    return p;
  },
  // warm the cache with the sounds heard all the time (footsteps, digging, hits, clicks), so they aren't late
  async predecode() {
    if (!this.ctx || !this.packReady || this._predecoding) return;
    this._predecoding = true;
    const names = new Set();
    for (const ev in SOUNDS.events) {
      if (!/^(block\.(stone|grass|wood|gravel|sand|dirt|deepslate)\.(step|break|place|hit)|entity\.player\.(hurt|attack\.\w+)|entity\.generic\.eat|ui\.button\.click|entity\.item\.pickup)$/.test(ev)) continue;
      for (const s of SOUNDS.events[ev]) names.add(s.name);
    }
    const list = [...names];
    for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map(n => this.decode(n)));
  },
  // play a vanilla sound event; returns false when unavailable so callers can fall back
  ev(event, pos, vol = 1, pitch = 1) {
    if (!this.ctx) return false;
    // 无原版音效包时回退到合成音；仍触发 onPlay，保证「显示字幕」功能可用
    if (!this.packReady) { if (this.onPlay) this.onPlay(event, pos, vol); return false; }
    const list = SOUNDS.events[event];
    if (!list || !list.length) return false;
    if (this.idle) return true; // (asleep: dropped, not queued - Sound.sleep)
    if (this.onPlay) this.onPlay(event, pos, vol); // (subtitles)
    let total = 0; for (const s of list) total += s.weight || 1;
    let r = Math.random() * total, pick = list[0];
    for (const s of list) { r -= s.weight || 1; if (r <= 0) { pick = s; break; } }
    const play = (buf) => {
      if (!buf) return;
      const o = this.out(pos, Math.min(1, vol * (pick.volume ?? 1)), Math.max(16, 16 * vol));
      if (!o) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.playbackRate.value = clamp(pitch * (pick.pitch ?? 1), 0.5, 2);
      src.connect(o); src.start();
    };
    const buf = this.cached(pick.name);
    if (buf) play(buf);
    else { const t = performance.now(); this.decode(pick.name).then(b => { if (performance.now() - t < 250) play(b); }); }
    return true;
  },
  rr() { return Math.random() - Math.random(); },
});

// spatial output with configurable range (replaces the original 20-block falloff)
Sound.out = function (pos, vol = 1, range = 20) {
  const c = this.ctx;
  const g = c.createGain();
  let v = vol;
  if (pos) {
    const L = this.listener, dx = pos[0] - L.x, dy = pos[1] - L.y, dz = pos[2] - L.z;
    const d = Math.hypot(dx, dy, dz);
    v *= Math.max(0, 1 - d / range);
    if (v <= 0.001) return null;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      const right = dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw);
      p.pan.value = clamp(right / (d + 0.5), -1, 1) * 0.7;
      g.connect(p); p.connect(this.sfx);
    } else g.connect(this.sfx);
  } else g.connect(this.sfx);
  g.gain.value = v;
  return g;
};

// the sound of putting on a piece of armor (its equippable component's equip_sound)
const ARMOR_EQUIP = { leather: 'leather', chainmail: 'chain', iron: 'iron', golden: 'gold', diamond: 'diamond', netherite: 'netherite', copper: 'copper' };
function armorEquipSound(k) {
  if (k === 'elytra') return 'item.armor.equip_elytra';
  if (k === 'turtle_helmet') return 'item.armor.equip_turtle';
  const m = /^([a-z]+)_(helmet|chestplate|leggings|boots)$/.exec(k);
  return 'item.armor.equip_' + ((m && ARMOR_EQUIP[m[1]]) || 'generic');
}
// a looping sound whose place, volume and pitch the caller sets every tick (vanilla's tickable sound instances: a
// minecart rolling). pos null: not placed (heard as is). One left without updates for half a second stops itself
Sound.loops = new Set();
Sound.loop = function (event) {
  const S = this, h = { update() {}, stop() {} };
  const list = window.SOUNDS && SOUNDS.events[event];
  if (!S.ctx || !S.packReady || !list || !list.length || S.idle) return h;
  const pick = list[0], c = S.ctx, g = c.createGain(), pan = c.createStereoPanner ? c.createStereoPanner() : null;
  g.gain.value = 0;
  if (pan) { g.connect(pan); pan.connect(S.sfx); } else g.connect(S.sfx);
  let src = null, dead = false, last = performance.now(), rate = 1;
  S.decode(pick.name).then(buf => {
    if (!buf || dead) return;
    src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate; src.connect(g); src.start();
  });
  h.update = (pos, vol, pitch) => {
    last = performance.now();
    let v = vol * (pick.volume ?? 1), p = 0;
    if (pos) {
      const L = S.listener, dx = pos[0] - L.x, dy = pos[1] - L.y, dz = pos[2] - L.z, d = Math.hypot(dx, dy, dz);
      v *= Math.max(0, 1 - d / 16);
      p = clamp((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / (d + 0.5), -1, 1) * 0.7;
    }
    g.gain.setTargetAtTime(v, c.currentTime, 0.05);
    if (pan) pan.pan.value = p;
    rate = clamp(pitch * (pick.pitch ?? 1), 0.5, 2);
    if (src) src.playbackRate.value = rate;
  };
  h.live = true;
  h.stop = () => { if (dead) return; dead = true; h.live = false; S.loops.delete(h); if (src) try { src.stop(); } catch (e) { } g.disconnect(); };
  h.stale = () => performance.now() - last > 500;
  S.loops.add(h);
  // (the sweep runs only while there are loops: it went on 4 times a second for good after the first minecart ride)
  if (!S.loopSweep) S.loopSweep = setInterval(() => { for (const l of S.loops) if (l.stale()) l.stop(); if (!S.loops.size) { clearInterval(S.loopSweep); S.loopSweep = 0; } }, 250);
  return h;
};

// ---- the audio device asleep while nothing can be heard: the page hidden, or a pausing screen over a frozen world
// (single player) for 5 s with no loop playing. A running AudioContext keeps the audio output and its thread going,
// silent or not - battery on a phone. One-shot sounds meanwhile are dropped (they would all come at once on waking);
// a tap or key (Sound.init: a menu button's click plays), the world going on or the page shown again wake it ----
Object.assign(Sound, {
  idle: null, pauseT: 0,
  sleep(why) { if (this.idle || !this.ctx) return; this.idle = why; try { this.ctx.suspend().catch(() => { }); } catch (e) { } },
  wake() { if (!this.idle) return; this.idle = null; this.pauseT = performance.now(); try { this.ctx.resume().catch(() => { }); } catch (e) { } },
  watch() {
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.sleep('hidden'); else if (this.idle === 'hidden') this.wake(); });
    setInterval(() => {
      const g = typeof game !== 'undefined' && game, sc = g && g.ui && g.ui.screen, now = performance.now();
      if (!(g && g.state === 'play' && sc && sc.pauses && !g.net && !g.p2pHost && !g.p2pGuest)) { this.pauseT = now; if (this.idle === 'pause') this.wake(); return; }
      if (!this.idle && !this.loops.size && now - this.pauseT > 5000) this.sleep('pause');
    }, 1000);
  },
});

(() => {
  const S = Sound, wrap = (name, fn) => { const orig = S[name]; S[name] = function (...a) { if (fn.apply(this, a) !== false) return; return orig.apply(this, a); }; };
  // (the sound types without events of their own name use others': vanilla SoundType HARD_CROP, GLOW_LICHEN, LILY_PAD,
  // fire as wool, bee nests as wood)
  const MAT_MAP = { stone: 'stone', wood: 'wood', grass: 'grass', gravel: 'gravel', sand: 'sand', snow: 'snow', glass: 'glass', wool: 'wool', metal: 'metal', netherrack: 'netherrack', nether_bricks: 'nether_bricks', soul_sand: 'soul_sand',
    hard_crop: 'wood', glow_lichen: 'vine', lily_pad: 'big_dripleaf', fire: 'wool', beehive: 'wood' };
  wrap('block', function (kind, mat, pos) {
    if (mat === 'lily_pad' && kind === 'place') return this.ev('block.lily_pad.place', pos, 1, 0.8);
    // vanilla sound groups (data-driven blocks) play their own events when the pack has them
    const m = MAT_MAP[mat] || (window.SOUNDS && SOUNDS.events['block.' + mat + '.' + kind] ? mat : /grass|moss|leaves|sapling|vine|lichen|berry|dripleaf|roots|azalea|blossom|petals|litter|flower|lily|crop|fungus|sprouts/.test(mat) ? 'grass' : /wood|stem|bamboo|beehive/.test(mat) ? 'wood' : 'stone');
    const P = { break: [1, 0.8], step: [0.15, 1], place: [1, 0.8], hit: [0.25, 0.5], fall: [0.5, 0.75] }[kind] || [1, 1];
    return this.ev('block.' + m + '.' + kind, pos, P[0], P[1]);
  });
  wrap('pop', function (pos) { return this.ev('entity.item.pickup', pos, 0.2, (this.rr() * 0.7 + 1) * 2); });
  wrap('click', function () { return this.ev('ui.button.click', null, 0.25, 1); });
  wrap('hurt', function (pos) { return this.ev('entity.player.hurt', pos, 1, 1 + this.rr() * 0.2); });
  wrap('explode', function (pos) { return this.ev('entity.generic.explode', pos, 4, (1 + this.rr() * 0.2) * 0.7); });
  wrap('fuse', function (pos) { return this.ev('entity.tnt.primed', pos, 1, 1); });
  wrap('fizz', function (pos) { return this.ev('block.lava.extinguish', pos, 0.5, 2.6 + this.rr() * 0.8); });
  wrap('splash', function (pos) { return this.ev('entity.player.splash', pos, 0.6, 1 + this.rr() * 0.4); });
  wrap('eat', function (pos) { return this.ev('entity.generic.eat', pos, 0.5, 1 + this.rr() * 0.4); });
  wrap('burp', function (pos) { return this.ev('entity.player.burp', pos, 0.5, Math.random() * 0.1 + 0.9); });
  wrap('bow', function (pos) { return this.ev('entity.arrow.shoot', pos, 1, 1 / (Math.random() * 0.4 + 1.2) + 0.5); });
  wrap('arrowHit', function (pos) { return this.ev('entity.arrow.hit', pos, 1, 1.2 / (Math.random() * 0.2 + 0.9)); });
  wrap('door', function (pos, open) { return this.ev(open ? 'block.wooden_door.open' : 'block.wooden_door.close', pos, 1, Math.random() * 0.1 + 0.9); });
  wrap('levelup', function () { return this.ev('entity.player.levelup', null, 0.75, 1); });
  // a toast sliding in (and ui.toast.out when it leaves: ui.js); vanilla's challenge advancements add challenge_complete
  wrap('toast', function () { return this.ev('ui.toast.in', null, 1, 1); });
  wrap('note', function (pos, n) { return this.ev('block.note_block.harp', pos, 3, Math.pow(2, (n - 12) / 12)); });
  // mobs that use another one's sounds, and ambient sounds under another name (vanilla getAmbientSound / getHurtSound)
  const MOB_SOUND_AS = { trader_llama: 'llama', mooshroom: 'cow', cave_spider: 'spider', giant: 'zombie', pufferfish: 'puffer_fish' };
  const MOB_IDLE = { sniffer: 'idle', turtle: 'ambient_land', axolotl: 'idle_air', allay: 'ambient_without_item', breeze: 'idle_ground' };
  wrap('mob', function (type, kind, pos) {
    if (type === 'creeper' && kind === 'idle') return true;
    const k = kind === 'idle' ? MOB_IDLE[type] || 'ambient' : kind;
    type = MOB_SOUND_AS[type] || type;
    const vol = type === 'ghast' || type === 'ender_dragon' ? 5 : 1;
    return this.ev('entity.' + type + '.' + k, pos, vol, 1 + this.rr() * 0.2);
  });
  // a mob's calls, hurt and death sounds decoded as soon as one comes near: a sound not ready within 250 ms is
  // dropped, and a mob's few, rare calls each came out silent the first time - "生物不会发出声音" (feedback 10-31)
  S.warmMob = function (type) {
    if (!this.ctx || !this.packReady || (this._warmed || (this._warmed = new Set())).has(type)) return;
    this._warmed.add(type);
    const t = MOB_SOUND_AS[type] || type, re = new RegExp('^entity\\.' + t + '\\.(ambient\\w*|idle\\w*|hurt|death)$'), names = [];
    for (const ev in SOUNDS.events) if (re.test(ev)) for (const s of SOUNDS.events[ev]) names.push(s.name);
    (async () => { for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i, i + 4).map((n) => this.decode(n))); })();
  };
  S.xp = function () { if (!this.ev('entity.experience_orb.pickup', null, 0.1, 0.5 + Math.random() * 0.9)) this.tone(null, { freq: 1200 + Math.random() * 400, dur: 0.12, vol: 0.12, type: 'sine' }); };
  S.chest = function (pos, open) { if (!this.ev(open ? 'block.chest.open' : 'block.chest.close', pos, 0.5, Math.random() * 0.1 + 0.9)) this.door(pos, open); };
})();

