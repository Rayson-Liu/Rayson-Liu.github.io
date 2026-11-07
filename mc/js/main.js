'use strict';
// ---------------------------------------------------------------------------
// Input binding & bootstrap
// ---------------------------------------------------------------------------
function bindInput(g) {
  const canvas = g.canvas, ui = g.ui;
  const locked = () => document.pointerLockElement === canvas;
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === ui.input) return;
    Sound.init();
    const code = e.code;
    if (code === 'Escape' && !e.repeat) g.escHeld = performance.now();
    if (['Space', 'Tab', 'F1', 'F3', 'F5', 'Slash', 'KeyQ'].includes(code) || (e.ctrlKey && ['KeyS', 'KeyD', 'KeyW', 'KeyA'].includes(code))) e.preventDefault();
    if (ui.screen) {
      if (ui.key(e)) return;
      if (code === 'Escape' || (bindingsFor(g, code).includes('inventory') && ui.screen instanceof ContainerScreen)) {
        if (ui.screen.onEsc) ui.screen.onEsc();
        else if (g.state === 'play' && !(ui.screen instanceof DeathScreen)) ui.close();
      }
      return;
    }
    if (g.state !== 'play') return;
    if (e.repeat && !code.startsWith('Digit')) { g.keys[code] = true; return; }
    g.keys[code] = true;
    const p = g.player, now = performance.now();
    if (code === 'Escape') { ui.open(new PauseScreen(g)); return; }
    // vanilla F3 combos: F3 toggles the debug screen on release unless used as a modifier
    if (g.keys.F3 && code !== 'F3') {
      g.f3Used = true;
      if (code === 'KeyH') { g.settings.advTooltips = !g.settings.advTooltips; g.saveSettings(); ui.message('[调试]：高级提示框：' + (g.settings.advTooltips ? '显示' : '隐藏'), '#FFFF55'); return; }
      if (code === 'KeyN' || code === 'F4') {
        if (!g.cheats && !g.net) { ui.message('[调试]：无法切换游戏模式；没有权限', '#FF5555'); return; }
        g.requestMode(code === 'KeyN' ? (g.mode === 'spectator' ? (g.prevMode && g.prevMode !== 'spectator' ? g.prevMode : 'creative') : 'spectator') : MODE_NEXT[g.mode]); return;
      }
      if (code === 'KeyL') { g.perfReport(); return; }
      if (code === 'KeyQ') { ui.message('F3 + H = 高级提示框，F3 + N = 旁观模式切换，F3 + F4 = 切换游戏模式，F3 + L = 记录 10 秒性能报告', '#FFFF55'); return; }
    }
    if (code === 'F3') g.f3Used = false;
    // everything else goes through the key bindings (选项 → 按键控制 → 按键绑定)
    for (const act of bindingsFor(g, code)) if (pressAction(g, act, e)) { e.preventDefault(); return; }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'F3' && g.keys.F3 && !g.f3Used && !ui.screen && g.state === 'play') { ui.debug = !ui.debug; PerfMon.gpuOn = ui.debug; }
    g.keys[e.code] = false;
    if (e.code === 'Escape') { g.escHeld = 0; if (g.escCapture) { g.escCapture = false; if (g.state === 'play' && !ui.screen) { g.clickToResume = performance.now(); g.capturePointer(); } } }
    for (const act of bindingsFor(g, e.code)) releaseAction(g, act);
  });
  const releaseAll = () => { g.keys = {}; g.rawMouse = [false, false, false]; g.mouseBtn = [false, false, false]; g.sprintToggle = false; };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('pointerlockchange', () => {
    // (not when the lock went because the game is now played by touch - see touch.js)
    if (locked()) g.lockFails = 0;
    if (!locked()) { releaseAll(); if (g.state === 'play' && !ui.screen && !touchOn(g)) ui.open(new PauseScreen(g)); }
  });
  // the browser refuses the mouse lock (some browsers and app web views never give it): played with the mouse free
  // instead of the pause menu coming back each time "back to game" is clicked (players' feedback 2026-10-31, ~10)
  // (a soft refusal - asked with no click behind it, or again right after the player left the lock: game.js
  // capturePointer marks the request with lockSoftAt - is not counted: the browser said nothing about itself. This
  // listener runs before game.js's own, which then finds lockSoftAt cleared)
  document.addEventListener('pointerlockerror', () => {
    if (g.lockSoftAt && performance.now() - g.lockSoftAt < 1500) { g.lockSoftAt = 0; return; }
    g.lockFails = (g.lockFails || 0) + 1;
  });
  const freeMouse = () => g.lockFails > 0 && !locked() && !touchOn(g);
  window.addEventListener('mousemove', (e) => {
    if ((locked() || freeMouse()) && !ui.screen && g.state === 'play') {
      const p = g.player, st = g.settings, s = st.sens * 0.006 + 0.0006;
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return; // browser glitch spikes
      p.yaw -= e.movementX * s * (st.invertX ? -1 : 1);
      p.pitch = clamp(p.pitch - e.movementY * s * (st.invertY ? -1 : 1), -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
    } else ui.mouseMove(e);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // (Edge's mouse gestures start from a right-button drag on the page: the right button and its menu kept from it)
  window.addEventListener('contextmenu', (e) => { if (e.target !== ui.input) e.preventDefault(); }, true);
  window.addEventListener('mousedown', (e) => { if (e.button === 2 && e.target !== ui.input) e.preventDefault(); }, true);
  window.addEventListener('mousedown', (e) => {
    if (e.target === ui.input) return;
    Sound.init();
    if (ui.screen) { ui.mouseDown(e); return; }
    if (g.state !== 'play') return;
    if (!locked()) { g.capturePointer(); if (!freeMouse()) return; }
    if (e.button === 1) e.preventDefault();
    (g.rawMouse || (g.rawMouse = [false, false, false]))[e.button] = true;
    for (const act of bindingsFor(g, 'Mouse' + e.button)) pressAction(g, act, e);
  });
  window.addEventListener('mouseup', (e) => {
    if (ui.screen) { ui.mouseUp(e); }
    if (g.rawMouse) g.rawMouse[e.button] = false;
    for (const act of bindingsFor(g, 'Mouse' + e.button)) releaseAction(g, act);
  });
  window.addEventListener('wheel', (e) => {
    if (ui.screen) { ui.wheelShift = e.shiftKey; ui.wheel(e.deltaY); return; }
    if (g.state !== 'play') return;
    // vanilla scroll: wheel sensitivity scales the steps, discrete scrolling counts one step per notch
    const st = g.settings, k = st.scrollSens ?? 1;
    // a mouse wheel's notch is one step whatever the browser makes of it (100, 300 pixels with Windows' "lines to
    // scroll", 3 lines in Firefox: one notch went 3 slots, players' feedback 2026-10-31); a touchpad's small deltas add up
    const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
    g.scrollAcc = (g.scrollAcc || 0) + (st.discreteScroll || notch ? Math.sign(e.deltaY) * k : e.deltaY / 100 * k);
    const n = Math.trunc(g.scrollAcc);
    if (n) { g.scrollAcc -= n; const p = g.player; p.inv.sel = mod(p.inv.sel + n, 9); }
  }, { passive: true });
  window.addEventListener('beforeunload', (e) => {
    if (g.state === 'play') { g.saveWorld(true); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && g.state === 'play') g.saveWorld(true); });
}

// Player preview for the survival inventory
Renderer.prototype.playerPreview = function (game, ui, x, y, w, h, opts) {
  const gl = this.gl, S = Math.max(2, ui.scale), W = w * S, H = h * S;
  // only re-render when the head would turn (it follows the mouse). The picture comes back from the GPU
  // asynchronously: read into a pixel buffer, fenced, and copied out a frame or two later once the fence has
  // passed - a plain readPixels made the CPU wait for the whole frame (the world behind the inventory
  // included) every time the mouse moved
  // (a dyed piece's colour too: two leather chestplates swapped differ by it alone - the frame below no longer covers it)
  const P = game.player, gear = P ? [P.inv.sel, ...[P.inv.held, ...P.inv.slots.slice(36, 41)].map(s => s ? s.id + ':' + (s.dmg || 0) + ':' + (s.color ?? '') : 0)].join('/') : '';
  // (the skin, the cape and its frame: the wardrobe's turning preview, skins.js / capes.js. The frame (8 a second) only
  // for an animated cape or the wardrobe, whose pet moves - and for 1.5 s after what is worn changed, as an armour or
  // wing texture seen for the first time loads a moment later (emodel.js etex: null until then). Always in the key,
  // the inventory drew the player again 8 times a second with nothing changed)
  const cape = P && typeof Capes !== 'undefined' ? Capes.of(game, P) : null, cp = cape && Capes.get(cape), now = performance.now();
  const look = P && typeof Skins !== 'undefined' ? Skins.texOf(game, P) + Skins.modelOf(game, P) + (cape || '') : '';
  const worn = x + ',' + y + ',' + W + ',' + H + ',' + gear + look;
  if (this.pvWorn !== worn) { this.pvWorn = worn; this.pvWornT = now; }
  // (asked for every frame while its screen is open: a gap means the screen was opened again - drawn again once then,
  // as what the key leaves out may have changed meanwhile: a crossbow loaded, a hat, a trim, where the compass points.
  // Without it a reopened inventory showed the last picture until the mouse moved - on phones until a touch, 11-04)
  if (now - (this.pvAt || -1e9) > 500) this.pvForce = true;
  this.pvAt = now;
  // (a held compass / clock turns in the hand - the frame keeps it going as before)
  const dyn = (s) => /^(compass|recovery_compass|clock)$/.test(keyOfStack(s) || '');
  const moving = (opts && opts.yaw !== undefined) || !!(cp && cp.frames && cp.frames.length > 1) || now - this.pvWornT < 1500 || !!(P && (dyn(P.inv.held) || dyn(P.inv.slots[40])));
  const key = (opts && opts.yaw !== undefined ? 'y' + opts.yaw.toFixed(2) : Math.round(ui.mouse.x) + ',' + Math.round(ui.mouse.y)) + ',' + worn + (moving ? ',' + Math.floor(now / 125) : '');
  if (this.pv && this.pv.sync && this.pv.W === W && this.pv.H === H) {
    const pv = this.pv;
    if (gl.getSyncParameter(pv.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return pv.cv;
    gl.deleteSync(pv.sync); pv.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pv.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pv.px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    for (let r = 0; r < H; r++) pv.img.data.set(pv.px.subarray((H - 1 - r) * W * 4, (H - r) * W * 4), r * W * 4);
    pv.ctx.putImageData(pv.img, 0, 0);
    pv.key = pv.pendingKey;
  }
  if (this.pv && this.pv.key === key && !this.pvForce) return this.pv.cv;
  this.pvForce = false;
  if (!this.pv || this.pv.W !== W || this.pv.H !== H) {
    if (this.pv) {
      gl.deleteFramebuffer(this.pv.fb); gl.deleteTexture(this.pv.tex); gl.deleteRenderbuffer(this.pv.rb);
      if (this.pv.pbo) gl.deleteBuffer(this.pv.pbo);
      if (this.pv.sync) gl.deleteSync(this.pv.sync);
    }
    const fb = gl.createFramebuffer(), tex = gl.createTexture(), rb = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.pv = { fb, tex, rb, pbo, W, H, cv, ctx: cv.getContext('2d'), px: new Uint8Array(W * H * 4), img: cv.getContext('2d').createImageData(W, H), first: true };
  }
  const pv = this.pv;
  gl.bindFramebuffer(gl.FRAMEBUFFER, pv.fb);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
  const vp = M4.create(); M4.ortho(vp, -0.7, 0.7, -0.05, 1.95, -5, 5);
  const mx = (ui.mouse.x - (x + w / 2)) / 40, my = (ui.mouse.y - (y + h * 0.25)) / 40;
  // (turned toward the mouse: past the half turn that faces the camera, a positive angle turns the figure to the
  // screen's right; the head's pitch is negative looking down, like the player's own - both were the wrong way
  // round, players said the figure looked away from the pointer)
  const m = M4.create(); M4.translate(m, 0, 0, 0); M4.rotY(m, opts && opts.yaw !== undefined ? opts.yaw : Math.PI + Math.atan(mx) * 0.7);
  M4.scale(m, 0.9375, 0.9375, 0.9375);
  // lit like vanilla's inventory (full light), not by the world's time of day: the light table and the shaders' sun
  // follow the world, so at dusk or at night the preview went dark. Drawn with the plain entity shader
  const LT = [1, 1], savedFx = this.fxOn; this.fxOn = false;
  const env = { day: 1, fogColor: [0, 0, 0], fogNear: 1e8, fogFar: 2e8, nightTint: [1, 1, 1] };
  const savedCam = this.camPos; this.camPos = [0, 0, 0];
  const poses = opts && opts.yaw !== undefined ? {} : { head: { ry: Math.atan(mx) * 0.5, rx: -Math.atan(my) * 0.6 } };
  // worn armour, the elytra and the held items too (held items draw with the renderer's projection)
  const savedVP = this.vp; this.vp = vp;
  const attach = P && game.heldAttach ? game.heldAttach(P, typeof Skins !== 'undefined' ? Skins.modelOf(game, P) : 'steve', P.inv.held, P.inv.slots[40], LT, env) : null;
  gl.disable(gl.CULL_FACE);
  const pm = P && typeof Skins !== 'undefined' ? Skins.modelOf(game, P) : 'steve';
  this.drawModel(pm, P && typeof Skins !== 'undefined' ? Skins.texOf(game, P) : 'steve', m, poses, LT, env, { vp, attach, inv: true });
  if (P && typeof Capes !== 'undefined') Capes.draw(game, P, m, poses, LT, env, { vp, still: true, inv: true });
  gl.enable(gl.CULL_FACE);
  if (P) { game.drawArmor(P.inv.slots.slice(36, 40), m, poses, LT, env, { vp, inv: true }); if (game.drawWings) game.drawWings(P, m, LT, env, null, vp); }
  this.vp = savedVP; this.fxOn = savedFx;
  this.camPos = savedCam;
  if (pv.first) {
    // the first picture is read at once, so the inventory never opens with an empty space for a frame
    pv.first = false;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pv.px);
    for (let r = 0; r < H; r++) pv.img.data.set(pv.px.subarray((H - 1 - r) * W * 4, (H - r) * W * 4), r * W * 4);
    pv.ctx.putImageData(pv.img, 0, 0);
    pv.key = key;
  } else {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pv.pbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pv.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    pv.pendingKey = key;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  return pv.cv;
};

window.addEventListener('load', async () => {
  const g = window.game = new Game();
  try { await g.init(); }
  catch (e) {
    console.error(e);
    const d = document.getElementById('err');
    d.style.display = 'block';
    d.textContent = '启动失败：' + (e && e.message || e) + '\n\n请使用最新版 Chrome / Edge / Firefox 浏览器打开，并确保已启用 WebGL2 / 硬件加速。';
  }
});
