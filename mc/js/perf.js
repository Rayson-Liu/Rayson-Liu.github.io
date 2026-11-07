'use strict';
// ---------------------------------------------------------------------------
// Performance: frame pacing (最大帧率 / 垂直同步), the time each frame may spend on chunk work, the
// performance overlay on the F3 screen (frame-time graph, where the time goes, memory), the performance
// report (F3 + L, or 视频设置 → 复制性能报告), graphics presets with device detection, dynamic resolution.
// ---------------------------------------------------------------------------

// ---- frame pacing --------------------------------------------------------------------------------------
// Vanilla's options: with VSync frames follow the display (requestAnimationFrame) and a limit below its rate
// skips refreshes; without VSync frames sleep on a timer until they are due, held to the limit by time, or are
// started back to back (无限制: MessageChannel, which browsers do not throttle like timers). The browser still
// shows at most one frame per refresh unless it was started with --disable-gpu-vsync --disable-frame-rate-limit;
// the extra frames then only lower the input latency. Phones and tablets always follow the display.
// Vanilla's InactivityFpsLimiter (1.21.2+, "reduce FPS when: AFK", its default) on top: no input in play for a
// minute -> at most 30, for ten minutes -> 10; and here a pausing screen over a frozen world -> at most 30.
class FramePacer {
  constructor(game, frame) {
    this.g = game; this.frame = frame;
    this.refresh = 1000 / 60;   // the display's refresh interval (ms), measured
    this.rafD = []; this.rafN = 0; this.lastRaf = 0;
    this.last = 0;              // start of the last frame
    this.rest = 2;              // the frame's main-thread time besides chunk work (EMA, ms)
    this.backoff = 1;           // < 1 for a while after frames that came late
    this.chunkMs = 0;           // chunk work done in the current frame
    this.touch = typeof TouchDevice !== 'undefined' && (TouchDevice.kind === 'phone' || TouchDevice.kind === 'tablet');
    this.mc = new MessageChannel();
    this.mc.port1.onmessage = () => { this.mcWait = false; this.run(performance.now()); };
    this.rafCb = (t) => { this.rafWait = false; this.onRaf(t); };
    this.timer = 0; this.timerCb = () => { this.timer = 0; this.schedule(); };
    this.due = 0; this.tdue = 0;  // when the next frame is due (VSync skipping refreshes / the timer without VSync)
    // input, for the inactivity limit (vanilla counts keys, mouse buttons, the wheel and mouse moves; a finger or a key
    // held down - the joystick held forward, flying with W - counts all the time it is down)
    this.lastInput = performance.now(); this.keys = new Set(); this.buttons = 0; this.touches = 0;
    this.capOn = false; this.cappedFrame = false; this.prevCapped = false; this.cappedT = -1e9; this.afkOn = false;
    const opt = { capture: true, passive: true }, mark = () => this.input();
    for (const t of ['mousemove', 'wheel', 'touchmove']) addEventListener(t, mark, opt);
    addEventListener('keydown', (e) => { this.keys.add(e.code); mark(); }, opt);
    addEventListener('keyup', (e) => { this.keys.delete(e.code); mark(); }, opt);
    for (const t of ['mousedown', 'mouseup']) addEventListener(t, (e) => { this.buttons = e.buttons | 0; mark(); }, opt);
    for (const t of ['touchstart', 'touchend', 'touchcancel']) addEventListener(t, (e) => { this.touches = e.touches ? e.touches.length : 0; mark(); }, opt);
    addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; this.touches = 0; });
  }
  // (any input: keys, mouse, touches)
  input() {
    this.lastInput = performance.now();
    // back from the inactivity limit at once: not waiting out the 33 / 100 ms frame interval that was running
    if (this.afkOn) { this.afkOn = false; this.due = this.tdue = 0; if (this.timer) { clearTimeout(this.timer); this.timer = 0; this.schedule(); } }
  }
  // the inactivity stage: 0, 1 (a minute without input in play), 2 (ten minutes)
  get afk() {
    if (this.g.state !== 'play' || this.keys.size || this.buttons || this.touches) return 0;
    const idle = performance.now() - this.lastInput;
    return idle > 600000 ? 2 : idle > 60000 ? 1 : 0;
  }
  // a pausing screen over a world that stands still (single player: a room's world, or a local room's, goes on under
  // it - net.js / p2p.js tick on). Not the end credits (dims.js): a pausing screen, but a scroll that has to stay smooth
  frozen() {
    const g = this.g, sc = g.ui && g.ui.screen;
    return !!(sc && sc.pauses && !g.net && !g.p2pHost && !g.p2pGuest && !(typeof CreditsScreen === 'function' && sc instanceof CreditsScreen));
  }
  get hz() { return Math.round(1000 / this.refresh); }
  // a phone or tablet whose display is faster than ~65 Hz: 60 unless the player chose more (the user, 11-03: 90/120 Hz
  // ran the battery down and heated the phones, for frames the 3D world can rarely keep up with anyway)
  get auto60() { return this.touch && this.refresh < 1000 / 65; }
  // the limit in play (settings.maxFps): above 0 that limit; 0 (the default) the display's rate, 60 where auto60;
  // -1 跟随屏幕 chosen: the display's rate on any device. 0 here = no limit (with VSync: the display's rate; a fixed
  // 120 on a 165 Hz display would alternate 1 and 2 refreshes)
  get playLimit() { const v = this.g.settings.maxFps; return v > 0 ? v : v !== -1 && this.auto60 ? 60 : 0; }
  // the limit now: like vanilla the title, loading and dimension screens run at most at 60; in play the inactivity
  // limit and a pausing screen over a frozen world lower it (capOn: one of them did)
  get limit() {
    const lim = this.playLimit;
    // (the frame-rate test, onboard.js FpsTestScreen: the display's own rate while it is the screen open)
    if (this.g.state !== 'play') { this.capOn = this.afkOn = false; if (this.free && this.g.ui && this.g.ui.screen === this.free) return 0; return lim ? Math.min(lim, 60) : 60; }
    const a = this.afk, cap = a === 2 ? 10 : a === 1 || this.frozen() ? 30 : 0;
    this.afkOn = a > 0; this.capOn = !!cap && (!lim || lim > cap);
    return this.capOn ? cap : lim;
  }
  get vsync() { return this.g.settings.vsync !== false || this.touch; }
  start() { this.schedule(); }
  schedule() {
    if (this.timer) return;
    if (this.vsync || document.hidden) {
      if (this.rafWait) return;
      // a frame three refreshes or more away (the limits above) sleeps on a timer until a refresh and a half before
      // it is due, instead of waking for every refresh it skips
      // (the refresh is not measured across the sleep: those 22 / 89 ms gaps were a third of the samples at 180 Hz,
      // 11-04, and a timer firing a little late leaves one rAF a frame - all gaps: a 120 Hz phone would read as 30 Hz)
      const wait = this.due && !document.hidden ? this.due - performance.now() - this.refresh * 1.5 : 0;
      if (wait > this.refresh * 1.5) { this.timer = setTimeout(this.timerCb, wait); this.lastRaf = 0; return; }
      this.rafWait = true; requestAnimationFrame(this.rafCb); return;
    }
    if (this.mcWait) return;
    // without VSync: a timer until ~0.5 ms before the frame is due, then one message (it ends the timers' nesting,
    // which browsers stretch to 4 ms). Messages used to be posted back to back for the last 2 ms of each frame: a busy
    // main thread, 88 ms a second at a limit of 60 and 158 at 144 (only 126 fps came), measured 11-03
    const wait = this.tdue ? this.tdue - performance.now() - 0.5 : 0;
    if (wait > 0) this.timer = setTimeout(this.timerCb, wait);
    else { this.mcWait = true; this.mc.port2.postMessage(0); }
  }
  onRaf(t) {
    // the refresh interval: a low percentile of recent intervals (a missed frame only makes one longer)
    if (this.lastRaf) {
      const d = t - this.lastRaf;
      if (d > 2 && d < 100) {
        this.rafD.push(d); if (this.rafD.length > 90) this.rafD.shift();
        if (this.rafD.length >= 10 && (++this.rafN & 15) === 0) { const s = [...this.rafD].sort((a, b) => a - b); this.refresh = s[Math.floor(s.length * 0.2)]; }
      }
    }
    this.lastRaf = t;
    // a limit below the display's rate: skip refreshes until the next frame is due. The due time advances by
    // the limit's interval, not from the last frame, so a limit that doesn't divide the refresh rate (120 on
    // a 165 Hz display) still averages out right
    if (this.vsync && this.limit && 1000 / this.limit > this.refresh * 1.05) {
      const iv = 1000 / this.limit;
      if (this.due && t < this.due - this.refresh * 0.5) { this.schedule(); return; }
      this.due = Math.max((this.due || t) + iv, t - iv);
    } else this.due = 0;
    this.run(t);
  }
  run(now) {
    const lim = this.limit;
    if (!this.vsync && lim && this.tdue && now < this.tdue - 0.5) { this.schedule(); return; } // (woke early)
    // the next frame's due time advances by the interval, so a timer firing a little late doesn't lower the rate
    if (!this.vsync) { const iv = lim ? 1000 / lim : 0; this.tdue = !iv ? 0 : this.tdue && now - this.tdue < iv ? this.tdue + iv : now + iv; }
    // a frame under a limit (or just after one: its interval was the limit's): the frame-time statistics, dynamic
    // resolution, the heat fallback and the automatic quality leave it out
    const capped = this.capOn; this.cappedFrame = capped || this.prevCapped; this.prevCapped = capped;
    if (this.cappedFrame) this.cappedT = now;
    const dt = this.last ? now - this.last : 1000 / 60, target = this.target();
    // a frame that came late while chunk work was running: give chunk work less time for a while
    if (this.last && dt > target * 1.5 && this.prevChunk > 0.3 && (this.vsync || lim) && !this.cappedFrame) this.backoff = Math.max(0.25, this.backoff * 0.7);
    else this.backoff = Math.min(1, this.backoff + 0.01);
    this.last = now; this.chunkMs = 0;
    const t0 = performance.now();
    this.frame(now, dt);
    const cpu = performance.now() - t0;
    this.rest += (Math.max(0, cpu - this.chunkMs) - this.rest) * 0.1;
    this.prevChunk = this.chunkMs;
    PerfMon.frame(dt, cpu, this.chunkMs, this.g);
    this.schedule();
  }
  // how long a frame should take (ms)
  target() {
    const lim = this.limit;
    if (this.vsync) return Math.max(this.refresh, lim ? 1000 / lim : 0);
    return lim ? 1000 / lim : 1000 / 240; // unlimited: still leave chunk work a share of each frame
  }
  // chunk work this frame (ms): what the frame interval leaves after the rest of the frame and a margin for
  // the browser's own work (compositing, input, GC)
  budget() {
    const T = this.target();
    return clamp((T - this.rest - Math.max(1, T * 0.15)) * this.backoff, 0.5, 12);
  }
}

// ---- measurements ------------------------------------------------------------------------------------
const PerfMon = {
  N: 240, i: 0, n: 0,
  dt: new Float32Array(240), cpu: new Float32Array(240), chunk: new Float32Array(240), render: new Float32Array(240), gpu: new Float32Array(240).fill(NaN),
  renderMs: 0, gpuOn: false, queries: [],
  frame(dt, cpu, chunk, g) {
    const i = this.i;
    this.dt[i] = dt; this.cpu[i] = cpu; this.chunk[i] = chunk; this.render[i] = this.renderMs; this.gpu[i] = NaN;
    this.i = (i + 1) % this.N; this.n = Math.min(this.N, this.n + 1);
    this.pollGpu();
    if (this.rec) this.rec.push([dt, cpu, chunk, this.renderMs]);
    DynRes.frame(g, dt, cpu);
  },
  // GPU time of whole frames (EXT_disjoint_timer_query_webgl2) while the overlay is open or a report runs
  // (a lost context makes no queries - createQuery gives null and beginQuery threw on it, every frame - and the ones
  // asked before never answer: dropped)
  gpuBegin(gl) {
    if (!this.gpuOn) return;
    if (gl.isContextLost()) { this.queries.length = 0; this.cur = null; return; }
    const ext = this.ext !== undefined ? this.ext : (this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'));
    if (!ext || this.queries.length > 4) return;
    const q = gl.createQuery(); if (!q) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.cur = { q, i: this.i, gl };
  },
  gpuEnd() {
    if (!this.cur) return;
    const gl = this.cur.gl;
    if (gl.isContextLost()) { this.cur = null; return; }
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.cur); this.cur = null;
  },
  pollGpu() {
    if (this.queries.length && this.queries[0].gl.isContextLost()) { this.queries.length = 0; return; }
    while (this.queries.length) {
      const c = this.queries[0], gl = c.gl;
      if (!gl.getQueryParameter(c.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ok = !gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(c.q, gl.QUERY_RESULT);
      if (ok) { this.gpu[c.i] = ns / 1e6; this.lastGpu = ns / 1e6; if (this.rec) this.rec.gpu.push(ns / 1e6); }
      gl.deleteQuery(c.q); this.queries.shift();
    }
  },
  // statistics of the last n frames (or of an array of recorded frames)
  summary(rows) {
    if (!rows) { rows = []; for (let k = 0; k < this.n; k++) { const j = (this.i - 1 - k + this.N) % this.N; rows.push([this.dt[j], this.cpu[j], this.chunk[j], this.render[j]]); } }
    if (!rows.length) return null;
    const dts = rows.map(r => r[0]).sort((a, b) => a - b), avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
    const total = rows.reduce((s, r) => s + r[0], 0);
    return { frames: rows.length, fps: rows.length * 1000 / total, avg: total / rows.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: dts[dts.length - 1], cpu: avg(1), chunk: avg(2), render: avg(3) };
  },
  gpuAvg(list) {
    const v = list || [...this.gpu].filter(x => !isNaN(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  },
  // memory figures (MB) - the page's JS heap (Chromium only), chunk data, terrain meshes on the GPU
  memory(g) {
    const o = {};
    if (performance.memory) { o.heap = performance.memory.usedJSHeapSize / 1048576; o.heapLimit = performance.memory.jsHeapSizeLimit / 1048576; }
    const now = performance.now();
    if (!this.memT || now - this.memT > 1000) {
      this.memT = now;
      let b = 0;
      if (g.world) for (const ch of g.world.chunks.values()) {
        for (const s of ch.bs) if (s) b += s.d.byteLength + (s.n >= 0 ? 512 : 0);
        for (const m of ch.ms) if (m) b += 4096;
        for (const l of ch.ls) if (l) b += 4096;
        b += 2600;
      }
      this.chunkMB = b / 1048576;
    }
    o.chunks = this.chunkMB;
    const a = g.renderer.arena;
    o.mesh = a ? a.used / 1048576 : 0; o.meshAlloc = a ? a.total / 1048576 : 0;
    return o;
  },
  gpuName(gl) {
    if (this.gpuNameS !== undefined) return this.gpuNameS;
    let s = '';
    try { const e = gl.getExtension('WEBGL_debug_renderer_info'); s = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (err) { }
    return (this.gpuNameS = String(s || '未知'));
  },
  // the GPU's name without ANGLE's wrapping ("ANGLE (NVIDIA, NVIDIA GeForce ... (0x2D59) Direct3D11 ...)")
  gpuShort(gl) {
    const s = this.gpuName(gl), m = /^ANGLE \((?:[^,]*), (.*?)(?: \(0x[0-9A-Fa-f]+\))?(?: Direct3D.*| OpenGL.*| Metal.*| Vulkan.*)?, [^,]*\)$/.exec(s);
    return (m ? m[1] : s).replace(/^(NVIDIA|AMD|Intel\(R\)) /, '').slice(0, 40);
  },
  // the right-hand column of the F3 screen
  lines(g) {
    const P = g.pacer, s = this.summary(), m = this.memory(g), r = g.renderer, cw = g.chunkWorker;
    const f1 = (v) => v == null || isNaN(v) ? '-' : v.toFixed(1), r0 = (v) => v == null || isNaN(v) ? '-' : Math.round(v);
    const L = [];
    const mode = P.vsync ? '垂直同步' + (P.limit ? ' ' + P.limit : '') : P.limit ? '上限 ' + P.limit : '无限制';
    L.push(`${mode} · 刷新 ${r0(1000 / P.refresh)} Hz`);
    if (s) {
      L.push(`帧 ${f1(s.avg)} ms  P95 ${f1(s.p95)}  最慢 ${f1(s.max)}`);
      L.push(`主线程 区块 ${f1(s.chunk)} 渲染 ${f1(s.render)} 其他 ${f1(s.cpu - s.chunk - s.render)}`);
    }
    const ga = this.gpuAvg();
    L.push(`区块预算 ${f1(P.budget())} ms` + (P.backoff < 0.99 ? `（回退 ${r0(P.backoff * 100)}%）` : '') + `  显卡 ${ga == null ? (this.ext === null ? '-' : '…') : f1(ga) + ' ms'}`);
    if (cw && cw.stats) { const st = cw.stats; L.push(`区块线程 ${r0(st.busy / st.span * 100)}%  装饰 ${st.nDecorate}/s  网格 ${st.nMesh}/s`); }
    // memory in use, in yellow
    MemMon.update();
    const Y = (text) => ({ text, color: '#FFFF55' });
    // (only what web pages can measure: the task manager's figure for the tab also holds the browser's own
    // buffers, canvases, freed memory it keeps for reuse, and the GPU process)
    L.push(Y(`运存 主线程 JS 堆：${MemMon.heap != null ? r0(MemMon.heap) + ' / ' + r0(MemMon.heapAlloc) + ' MB' : '浏览器不提供'}`));
    if (MemMon.all != null) L.push(Y(`运存 全部 JS（含后台线程）：${r0(MemMon.all)} MB`));
    L.push(`区块数据 ${r0(m.chunks)} MB`);
    L.push(`地形显存 ${r0(m.mesh)} / ${r0(m.meshAlloc)} MB`);
    L.push(`${r.canvas.width}x${r.canvas.height} (${r0(r.resScale * 100)}%)  ${PRESET_NAMES[g.settings.preset] || '自定义'}·${g.settings.graphics === 'fast' ? '流畅' : '高品质'}`);
    if (g.net) { const n = g.net; L.push(`联机：区块 ${n.stats.chunks}  实体 ${n.ents.size}  未显示的实体 ${[...n.unknown.values()].reduce((s, v) => s + v, 0)}  缺少方块 ${n.missing.size} 种`); }
    L.push(this.gpuShort(r.gl));
    L.push(`${navigator.hardwareConcurrency || '?'} 线程 · ${TouchDevice.name}`);
    return L;
  },
  // the frame-time graph (vanilla's F3 chart): one bar per frame, lines at the target and twice it
  drawGraph(c, x, y, w, h, g) {
    const target = g.pacer.target(), scale = h / (target * 3);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(x, y - h, w, h);
    const n = Math.min(this.n, w), bw = w / this.N;
    for (let k = 0; k < n; k++) {
      const j = (this.i - 1 - k + this.N) % this.N, d = this.dt[j];
      const bh = Math.min(h, d * scale);
      c.fillStyle = d > target * 2 ? '#FF5555' : d > target * 1.25 ? '#FFFF55' : '#55FF55';
      c.fillRect(x + w - (k + 1) * bw, y - bh, Math.max(1, bw), bh);
      const ch = Math.min(bh, this.chunk[j] * scale);
      if (ch > 0.5) { c.fillStyle = 'rgba(85,170,255,0.9)'; c.fillRect(x + w - (k + 1) * bw, y - ch, Math.max(1, bw), ch); }
    }
    c.fillStyle = '#FFFFFF'; c.fillRect(x, y - target * scale, w, 0.5);
    c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(x, y - target * 2 * scale, w, 0.5);
    Font.draw(c, (1000 / target).toFixed(0) + ' fps', x + 2, y - target * scale - 9, '#FFFFFF', false);
    Font.draw(c, '绿：帧时间  蓝：区块加载', x + 2, y - h + 2, '#C0C0C0', false);
  },
  // record for `ms` and hand the report to cb
  record(g, ms, cb) {
    if (this.rec) return false;
    this.rec = []; this.rec.gpu = [];
    const was = this.gpuOn; this.gpuOn = true;
    setTimeout(() => { const rows = this.rec; this.rec = null; this.gpuOn = was; cb(this.report(g, rows, ms)); }, ms);
    return true;
  },
  report(g, rows, ms) {
    const s = this.summary(rows), m = this.memory(g), P = g.pacer, st = g.settings, r = g.renderer;
    const f1 = (v) => v == null || isNaN(v) ? '-' : v.toFixed(2);
    const gpu = this.gpuAvg(rows && rows.gpu);
    const target = P.target(), late = rows ? rows.filter(x => x[0] > target * 1.5).length : 0;
    const L = [
      `OpusMC 性能报告  ${new Date().toLocaleString()}`,
      `设备：${TouchDevice.name}，${navigator.hardwareConcurrency || '?'} 线程，内存 ${navigator.deviceMemory ? navigator.deviceMemory + ' GB+' : '未知'}，${this.gpuName(r.gl)}`,
      `浏览器：${navigator.userAgent}`,
      `运行方式：${location.protocol === 'file:' ? '直接打开文件（file://，没有后台线程）' : '本地服务器 ' + location.host}；区块线程 ${g.chunkWorker && g.chunkWorker.ready && !g.chunkWorker.failed ? '可用' : '不可用'}，地形生成 ${typeof GenPool !== 'undefined' && GenPool.inline ? '在页面内' : (g.genPool ? g.genPool.workers.length : 0) + ' 个线程'}`,
      `画面：${r.canvas.width}x${r.canvas.height}，缩放 ${Math.round(r.resScale * 100)}%，设备像素比 ${devicePixelRatio}`,
      `设置：画质 ${PRESET_NAMES[st.preset] || '自定义'}，渲染距离 ${st.renderDist}，光影 ${FX_NAMES[st.shaders || 0]}，图形 ${st.graphics === 'fast' ? '流畅' : '高品质'}，${P.vsync ? '垂直同步' : '无垂直同步'}，最大帧率 ${P.playLimit || '无限制'}${st.maxFps > 0 ? '' : st.maxFps === -1 ? '（跟随屏幕）' : P.auto60 ? '（自动）' : ''}${P.afk ? '，无操作限制中' : ''}`,
      `状态：${g.state}，维度 ${g.dim}，已加载区块 ${g.world ? g.world.chunks.size : 0}，区段 ${r.sections.size}，可见 ${(r.visSections || []).length}`,
      ``,
      `统计 ${ms ? (ms / 1000).toFixed(0) + ' 秒' : '最近 ' + (s ? s.frames : 0) + ' 帧'}：${s ? s.frames : 0} 帧，平均 ${s ? s.fps.toFixed(1) : '-'} fps`,
      s ? `帧时间 ms：平均 ${f1(s.avg)}，中位 ${f1(s.p50)}，P95 ${f1(s.p95)}，P99 ${f1(s.p99)}，最慢 ${f1(s.max)}；超过 1.5 倍目标 ${late} 帧` : '',
      s ? `主线程 ms/帧：总 ${f1(s.cpu)}，区块 ${f1(s.chunk)}，渲染 ${f1(s.render)}；显卡 ${gpu == null ? '无法测量' : f1(gpu)}` : '',
      `刷新间隔 ${f1(P.refresh)} ms，目标 ${f1(target)} ms，区块预算 ${f1(P.budget())} ms，回退 ${Math.round(P.backoff * 100)}%`,
      `区块任务耗时（主线程，ms/项）：${Object.entries(g.workCost || {}).map(([k, v]) => k + ' ' + v.toFixed(2)).join('，')}`,
    ];
    const cw = g.chunkWorker && g.chunkWorker.stats;
    if (cw) L.push(`区块线程：忙 ${Math.round(cw.busy / cw.span * 100)}%，每秒 装饰 ${cw.nDecorate} / 完成 ${cw.nFinish} / 网格 ${cw.nMesh}，装饰 ${f1(cw.decorate / Math.max(1, cw.nDecorate))} ms/个，待装饰 ${cw.protos} 个（${f1(cw.protoMB)} MB）`);
    L.push(`地形生成线程 ${g.genPool ? g.genPool.workers.length : 0} 个`);
    L.push(`内存：JS 堆 ${m.heap ? m.heap.toFixed(0) + ' / ' + m.heapLimit.toFixed(0) + ' MB' : '不可用'}${MemMon.all != null ? '，含后台线程 ' + MemMon.all.toFixed(0) + ' MB' : ''}，区块数据 ${f1(m.chunks)} MB，地形显存 ${f1(m.mesh)} MB（已分配 ${f1(m.meshAlloc)} MB）`);
    // the errors the game stepped over since the page loaded (Game.reportError), newest last
    const errs = g.errLog ? [...g.errLog.values()] : [];
    L.push(errs.length ? `错误记录（${errs.length} 种）：` : '错误记录：无');
    for (const e of errs) L.push(`  [${e.where || '-'}] ${e.msg} ×${e.n}（${new Date(e.first).toLocaleTimeString()} 起）${e.stack ? '\n    ' + e.stack : ''}`);
    return L.filter(x => x !== '').join('\n');
  },
};

// ---- memory in use (运存) ----------------------------------------------------------------------------
// The page's JS heap (performance.memory, Chromium) is read 4 times a second. The whole tab with its
// background threads needs performance.measureUserAgentSpecificMemory, which browsers only offer to
// cross-origin isolated pages (the local servers send the COOP / COEP headers for that); it answers after
// the next garbage collection, so that figure updates every few seconds.
const MemMon = {
  heap: null, heapAlloc: null, heapT: 0, all: null, allT: 0, busy: false,
  update() {
    const now = performance.now();
    if (performance.memory && now - this.heapT > 250) {
      this.heapT = now;
      this.heap = performance.memory.usedJSHeapSize / 1048576; this.heapAlloc = performance.memory.totalJSHeapSize / 1048576;
    }
    if (self.crossOriginIsolated && performance.measureUserAgentSpecificMemory && !this.busy && !this.allFailed && now - this.allT > 1000) {
      this.busy = true;
      performance.measureUserAgentSpecificMemory()
        .then(r => { this.all = r.bytes / 1048576; this.allAt = performance.now(); })
        .catch(() => { this.allFailed = true; })
        .finally(() => { this.busy = false; this.allT = performance.now(); });
    }
  },
};

// ---- dynamic resolution ------------------------------------------------------------------------------
// When frames come late but the main thread is not what holds them up, the GPU is: render fewer pixels
// (down to 50 %), and give them back once frames are on time again. Judged a 1.5 s window at a time:
// - slow: the window's mean frame over 1.12x the target, or over 15 % of its frames missed (over 1.5x). The median
//   it used to go by hid a phone alternating one and two refreshes (half its frames late, the median on time);
// - late (fewer pixels can help): slow while the mean main-thread time is under 0.8x of the target (with GPU
//   timing, the overlay open: the GPU's own time over 0.9x). Two late windows in a row: 10 % fewer pixels. Slow but
//   not late: cpuBound - the automatic quality (extras.js) then sees less far instead;
// - a drop on trial: if the next two windows are not 7 % quicker the pixels were not it - the scale goes back, no
//   drops for 60 s, cpuBound (a phone held up by its CPU went down to 50 % and stayed blurry for nothing);
// - on time: the mean within 1.05x and under 5 % missed. Two on-time windows in a row: 10 % more. A raise that is
//   followed straight away by a drop is not tried again for 30 s (no see-sawing between two steps);
// - the target is the display's refresh (or the frame limit): with VSync off and no limit there's no frame
//   rate to keep, so the display's rate stands in - 144 fps with no limit is not "slow". Phones and tablets on the
//   default limit never trade pixels for more than 60;
// - a stall (a frame over 4x the target: a huge explosion, loading, the window hidden) drops the window it is in
//   and the one after; frames under a pausing screen or the inactivity limit (FramePacer.cappedFrame) don't count.
//   It used to need 97 % of frames on time to come back up, which jitter alone kept from happening: after a stall
//   (7000 TNT going off) the picture stayed blurry, and got blurrier while walking.
const DynRes = {
  scale: 1, t: 0, n: 0, sum: 0, cpuSum: 0, miss: 0, slow: 0, good: 0, skip: 0, lastRaise: 0, noRaiseUntil: 0, noDropUntil: 0, cpuBound: false, trial: null,
  target(g) {
    const P = g.pacer, lim = P.limit, v = g.settings.maxFps;
    const T = P.vsync ? P.target() : lim ? 1000 / lim : P.refresh;
    return P.touch && !(v > 0) && v !== -1 ? Math.max(T, 1000 / 60) : T;
  },
  clear() { this.n = this.sum = this.cpuSum = this.miss = 0; this.t = performance.now(); },
  reset(g) { this.clear(); this.slow = this.good = 0; this.skip = 1; this.trial = null; this.cpuBound = false; this.noDropUntil = 0; if (this.scale !== 1) this.set(g, 1); },
  frame(g, dt, cpu) {
    if (!g.settings.dynRes || g.state !== 'play' || (g.ui.screen && g.ui.screen.pauses) || (g.pacer && g.pacer.cappedFrame)) { if (this.scale !== 1 && !g.settings.dynRes) this.set(g, 1); this.clear(); return; }
    const T = this.target(g);
    if (dt > T * 4) { this.skip = 2; this.clear(); return; }
    this.n++; this.sum += dt; this.cpuSum += cpu; if (dt > T * 1.5) this.miss++;
    const now = performance.now();
    if (now - this.t < 1500 || this.n < 30) return;
    const mean = this.sum / this.n, mcpu = this.cpuSum / this.n, miss = this.miss / this.n, gpu = PerfMon.gpuOn ? PerfMon.lastGpu : null;
    this.clear();
    if (this.skip > 0) { this.skip--; return; }
    const slow = mean > T * 1.12 || miss > 0.15;
    const late = gpu != null ? gpu > T * 0.9 : slow && mcpu < T * 0.8;
    const onTime = mean <= T * 1.05 && miss < 0.05 && (gpu == null || gpu < T * 0.75);
    const tr = this.trial;
    if (tr) {
      tr.sum += mean;
      if (++tr.n < 2) return;
      this.trial = null;
      if (tr.sum / tr.n > tr.before * 0.93) { this.noDropUntil = now + 60000; this.cpuBound = true; this.slow = this.good = 0; this.set(g, tr.from); return; }
    }
    this.cpuBound = (slow && !late) || now < this.noDropUntil;
    this.slow = late ? this.slow + 1 : 0;
    this.good = onTime && !late ? this.good + 1 : 0;
    if (this.slow >= 2 && this.scale > 0.5 && now >= this.noDropUntil) {
      // (a raise that didn't hold: leave the resolution alone for a while)
      if (now - this.lastRaise < 4000) this.noRaiseUntil = now + 30000;
      this.trial = { from: this.scale, before: mean, n: 0, sum: 0 };
      this.slow = 0; this.good = 0; this.set(g, Math.max(0.5, Math.round((this.scale - 0.1) * 100) / 100));
    } else if (this.good >= 2 && this.scale < 1 && now >= this.noRaiseUntil) {
      this.good = 0; this.lastRaise = now; this.set(g, Math.min(1, Math.round((this.scale + 0.1) * 100) / 100));
    }
  },
  set(g, s) { this.scale = s; g.applySettings(); },
};

// ---- graphics presets -----------------------------------------------------------------------------------
const PRESET_NAMES = { auto: '自动', low: '低', medium: '中', high: '高', ultra: '极高', custom: '自定义' };
const PRESETS = {
  low: { renderDist: 6, resScale: 0.75, clouds: false, graphics: 'fast', shaders: 0, dynRes: true },
  medium: { renderDist: 8, resScale: 1, clouds: true, graphics: 'fast', dynRes: true },
  high: { renderDist: 12, resScale: 1, clouds: true, graphics: 'fancy', dynRes: true },
  ultra: { renderDist: 16, resScale: 1, clouds: true, graphics: 'fancy', dynRes: false },
};
// the preset this device gets: phones and tablets, integrated / software GPUs and few cores go lower
function detectPreset(gl) {
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  const gpu = PerfMon.gpuName(gl).toLowerCase();
  const software = /swiftshader|llvmpipe|software|basic render|microsoft basic/.test(gpu);
  const discrete = /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|rx \d{3,4}|arc\(tm\)|intel\(r\) arc/.test(gpu);
  const apple = /apple m\d|apple gpu/.test(gpu);
  if (software) return 'low';
  if (TouchDevice.kind === 'phone') return mem >= 8 && cores >= 8 ? 'medium' : 'low';
  if (TouchDevice.kind === 'tablet') return mem >= 6 && cores >= 8 ? 'medium' : 'low';
  if ((discrete || apple) && cores >= 8 && mem >= 8) return 'high';
  if (cores >= 8 && mem >= 8) return 'medium';
  return cores >= 4 ? 'medium' : 'low';
}
// apply a preset ('auto' = the detected one) to the settings; the caller saves and applies them
function applyPreset(g, name) {
  const s = g.settings;
  s.preset = name;
  const p = PRESETS[name === 'auto' ? (s.autoPreset = detectPreset(g.renderer.gl)) : name];
  if (!p) return;
  const graphics = s.graphics;
  Object.assign(s, p);
  if (p.shaders === undefined && s.shaders && name === 'low') s.shaders = 0;
  if (graphics !== s.graphics) g.graphicsChanged();
}
// first start: settings saved by an older version keep their values (preset "custom"), new players get
// the detected preset
function initPresets(g, hadSettings) {
  const s = g.settings;
  if (s.preset) return;
  if (hadSettings) { s.preset = 'custom'; return; }
  applyPreset(g, 'auto');
  g.saveSettings();
}

// ---- background thread count ------------------------------------------------------------------------------
// Each terrain worker makes ~27 chunks a second and holds its own copy of the generator data; the chunk
// worker decorates and meshes ~100. Three on big machines, one on phones and small CPUs.
function genWorkerCount() {
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
  if (TouchDevice.kind === 'phone' || cores <= 4 || mem < 4) return 1;
  return cores >= 12 && mem >= 8 ? 3 : 2;
}

// 图形品质 changed: mesh again (the chunk worker meshes too)
Game.prototype.graphicsChanged = function () {
  setFastLeaves(this.settings.graphics === 'fast');
  if (this.chunkWorker && this.chunkWorker.ready) this.chunkWorker.opts();
  if (this.world) for (const ch of this.world.chunks.values()) ch.dirty = ALL_SECTIONS;
};

// ---- report ------------------------------------------------------------------------------------------------
// (the clipboard API refused - inside the Toy page's frame on Edge, feedback 2026-11-01 「识别码复制不了」 - falls back
// to the old copy command, which works there)
function copyText(text) {
  const old = () => {
    try {
      const t = document.createElement('textarea'); t.value = text; t.readOnly = true;
      t.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;';
      document.body.appendChild(t); t.focus(); t.select(); t.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e) { return false; }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => old());
  return Promise.resolve(old());
}
// F3 + L (vanilla starts a 10 s profile with it too): record 10 s, then copy the report
Game.prototype.perfReport = function (ms = 10000) {
  const ui = this.ui;
  if (!PerfMon.record(this, ms, (text) => {
    console.log(text);
    copyText(text).then(ok => ui.message(ok ? '[调试]：性能报告已复制到剪贴板' : '[调试]：性能报告已输出到浏览器控制台（无法写入剪贴板）', '#FFFF55'));
  })) return;
  ui.message(`[调试]：正在记录性能数据（${ms / 1000} 秒）…`, '#FFFF55');
};

// ---- long-run test (PERF_PLAN.md) ----------------------------------------------------------------------------
// The game playing itself for `min` minutes in a creative world: the player flies on a few blocks a second (new
// chunks keep loading, old ones unloading), and on a cycle the inventory and the pause menu open and close and
// the render distance swaps - the moments players saw the game slow down for good. Every second a row: frame
// rate, slow frames, entities, chunks, memory, resolution scale. At the end the rows download as CSV (and stay in
// game.longRunRows). From the console, in a world: game.longRun(60); game.longRunStop() ends it early.
Game.prototype.longRun = function (min = 60) {
  if (this.longRunTimer) return '已经在运行';
  if (this.state !== 'play' || this.mode !== 'creative') return '先进入一个创造模式的世界';
  const g = this, ui = g.ui, p = g.player, rows = [], N = PerfMon.N, rd0 = g.settings.renderDist, y0 = p.pos[1];
  let sec = 0, lastI = PerfMon.i;
  const setRD = (d) => { if (g.settings.renderDist !== d) { g.settings.renderDist = d; g.applySettings(); } };
  const lockPause0 = g.noLockPause; g.noLockPause = true; // run from the console: no mouse lock, no pause menu popping up
  const finish = () => {
    clearInterval(g.longRunTimer); g.longRunTimer = null; g.longRunStop = null; g.noLockPause = lockPause0;
    if (ui.screen) ui.open(null);
    setRD(rd0);
    g.longRunRows = rows;
    const head = Object.keys(rows[0] || {});
    const csv = [head.join(','), ...rows.map(r => head.map(k => r[k]).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `longrun-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    ui.message(`[调试]：长时间测试结束（${rows.length} 秒），数据已下载`, '#FFFF55');
  };
  g.longRunTimer = setInterval(() => {
    sec++;
    // the frames since the last row, from the frame-time ring
    const k = (PerfMon.i - lastI + N) % N, dts = [];
    for (let j = 0; j < k; j++) dts.push(PerfMon.dt[(lastI + j) % N]);
    lastI = PerfMon.i;
    dts.sort((a, b) => a - b);
    const tot = dts.reduce((a, b) => a + b, 0);
    let mobs = 0, items = 0;
    for (const e of g.entities) { if (e instanceof Mob) mobs++; else if (e instanceof ItemEntity) items++; }
    const m = PerfMon.memory(g);
    rows.push({
      sec, fps: tot ? +(dts.length * 1000 / tot).toFixed(1) : 0, p99ms: dts.length ? +dts[Math.floor(dts.length * 0.99)].toFixed(1) : 0,
      maxms: dts.length ? +dts[dts.length - 1].toFixed(1) : 0, entities: g.entities.length, mobs, items,
      pending: g.pendingMobs ? g.pendingMobs.length : 0, chunks: g.world.chunks.size, sections: g.renderer.sections.size,
      heapMB: m.heap ? Math.round(m.heap) : '', meshMB: m.mesh != null ? +m.mesh.toFixed(1) : '', meshAllocMB: m.meshAlloc != null ? +m.meshAlloc.toFixed(1) : '',
      meshPages: g.renderer.arena ? g.renderer.arena.pages.length : '', resScale: DynRes.scale.toFixed(2),
      backoff: g.pacer.backoff.toFixed(2), renderDist: g.settings.renderDist, screen: ui.screen ? ui.screen.constructor.name : '',
    });
    // flying on, high above the ground
    if (!ui.screen) { p.flying = true; p.pos[0] += 4; p.pos[1] = Math.max(y0, (g.world.isLoaded(Math.floor(p.pos[0]), Math.floor(p.pos[2])) ? g.world.surfaceY(Math.floor(p.pos[0]), Math.floor(p.pos[2])) : 0) + 12); p.prev = [...p.pos]; p.vel = [0, 0, 0]; }
    // the cycle: inventory 3 s every 20 s, pause menu 2 s every 45 s, a larger render distance for 10 s every 90 s
    const t = sec % 180;
    if (t % 20 === 5) ui.open(new CraftingScreen(g, 2)); else if (t % 20 === 8 && ui.screen instanceof CraftingScreen) ui.open(null);
    if (t % 45 === 30) ui.open(new PauseScreen(g)); else if (t % 45 === 32 && ui.screen instanceof PauseScreen) ui.open(null);
    if (t % 90 === 60) setRD(Math.min(16, rd0 + 4)); else if (t % 90 === 70) setRD(rd0);
    if (sec >= min * 60) finish();
  }, 1000);
  g.longRunStop = finish;
  ui.message(`[调试]：长时间测试开始（${min} 分钟）`, '#FFFF55');
  return '开始';
};
