'use strict';
// ---------------------------------------------------------------------------
// Touch input. Detects the device (phones / tablets get touch controls by default), makes every menu usable
// by touch (tap = click, drag = scroll or move a slider; in inventories a long press = right click and a
// double tap = shift-click) and, while playing, draws Bedrock-style on-screen controls: a D-pad with sneak in
// the middle, jump / fly-down / sprint buttons, drag anywhere to look, tap to use or attack, hold to mine
// (or to eat / draw a bow), tap a hotbar slot to select it and hold it to drop the stack.
// ---------------------------------------------------------------------------
const TouchDevice = (() => {
  const ua = navigator.userAgent || '', mq = (q) => !!(window.matchMedia && matchMedia(q).matches);
  const points = navigator.maxTouchPoints || 0, touch = points > 0 || 'ontouchstart' in window;
  const iPadOS = /Macintosh/.test(ua) && points > 1;
  const mobile = !!(navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OpenHarmony/i.test(ua) || iPadOS;
  const tablet = iPadOS || /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const kind = mobile ? (tablet ? 'tablet' : 'phone') : touch ? 'touchpc' : 'pc';
  return {
    kind, touch,
    // a touchscreen PC only defaults to touch when it has no mouse / trackpad
    defaultOn: mobile || (touch && mq('(pointer: coarse)') && !mq('(any-pointer: fine)')),
    name: { phone: '手机', tablet: '平板', touchpc: '触屏电脑', pc: '电脑' }[kind],
  };
})();
// (touchPick: the first-run device choice - only where the game starts, touching / the mouse still switch; settings.touch
// is the option's own on / off)
// the look speed: a multiple of the old default (0.0045 rad a CSS pixel), 25%-500%; if never set 150% on phones (their
// players 10-31 to 11-02: too slow, even the old most - 1.8x - was not enough), 100% elsewhere (the user, 11-03).
// An old touchSens is carried over once
function touchLook(st) {
  if (st.touchLook === undefined && st.touchSens !== undefined && st.touchSens !== 0.5) st.touchLook = Math.round((st.touchSens * 1.6 + 0.2) * 20) / 20;
  return st.touchLook ?? (TouchDevice.kind === 'phone' ? 1.5 : 1);
}
// the buttons' size: tablets start larger (their buttons were too small to hit: feedback 11-01/02)
const touchSizeOf = (st) => st.touchSize ?? (TouchDevice.kind === 'tablet' ? 1.3 : 1);
const touchOn = (g) => g.settings.touch ?? g.touchAuto ?? (g.settings.touchPick ? g.settings.touchPick === 'phone' : TouchDevice.defaultOn);
// items whose use is held (eating, drinking, drawing a bow ...): a long press uses them instead of mining
function touchHoldUse(st) {
  const d = st && ITEMS[st.id];
  return !!d && (!!d.food || /^(bow|crossbow|trident|shield|spyglass|milk_bucket|potion|honey_bottle|goat_horn)$/.test(d.key));
}

// 9x9 pixel icons
const TOUCH_ICONS = (() => {
  const I = {
    up: ['....#....', '...###...', '..#####..', '.#######.', '#########', '...###...', '...###...', '...###...', '...###...'],
    ul: ['#####....', '####.....', '####.....', '#####....', '#..###...', '....###..', '.....###.', '......###', '.......##'],
    jump: ['....#....', '...###...', '..#####..', '.#######.', '#########', '...###...', '...###...', '.........', '#########'],
    sneak: ['..#####..', '.##...##.', '##.....##', '#.......#', '#.......#', '#.......#', '##.....##', '.##...##.', '..#####..'],
    sneakOn: ['..#####..', '.#######.', '#########', '#########', '#########', '#########', '#########', '.#######.', '..#####..'],
    sprint: ['....#....', '...###...', '..##.##..', '.##...##.', '##..#..##', '...###...', '..##.##..', '.##...##.', '##.....##'],
    pause: ['.........', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.........'],
    chat: ['.........', '#########', '#.......#', '#.#.#.#.#', '#.......#', '#########', '.##......', '.#.......', '.........'],
    view: ['.........', '..#####..', '.##...##.', '##.###.##', '#..###..#', '##.###.##', '.##...##.', '..#####..', '.........'],
    close: ['##.....##', '###...###', '.###.###.', '..#####..', '...###...', '..#####..', '.###.###.', '###...###', '##.....##'],
  };
  const cw = (a) => a[0].split('').map((_, i) => a.map(r => r[i]).reverse().join(''));
  I.right = cw(I.up); I.down = cw(I.right); I.left = cw(I.down);
  I.ur = I.ul.map(r => [...r].reverse().join(''));
  I.descend = [...I.jump].reverse();
  return I;
})();

class TouchControls {
  constructor(g) {
    this.g = g; this.ui = g.ui; this.t = new Map(); this.pend = []; this.lastSlotTap = null;
    g.touchHeld = {};
    const opt = { passive: false };
    window.addEventListener('touchstart', (e) => this.onStart(e), opt);
    window.addEventListener('touchmove', (e) => this.onMove(e), opt);
    window.addEventListener('touchend', (e) => this.onEnd(e, false), opt);
    window.addEventListener('touchcancel', (e) => this.onEnd(e, true), opt);
    document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS pinch zoom
    // the text field (chat, signs, names ...): focused by the tap itself. On iPhones the browser's own handling took
    // the first tap as a "hover" and needed a second one, and the second was a double tap that zoomed the page
    const inp = this.ui.input;
    if (inp) inp.addEventListener('touchend', (e) => {
      if (inp.style.display === 'none' || document.activeElement === inp) return; // (focused: a tap moves the caret)
      e.preventDefault();
      inp.focus();
    }, opt);
  }
  on() { return touchOn(this.g); }
  playing() { return this.g.state === 'play' && !this.ui.screen; }
  gui(cx, cy) { const r = this.ui.canvas.getBoundingClientRect(), k = this.ui.dpr / this.ui.scale; return [(cx - r.left) * k, (cy - r.top) * k]; }
  reset() {
    const g = this.g;
    for (const s of this.t.values()) if (s.holding) g.mouseBtn[s.holdBtn] = false;
    this.t.clear(); this.pend.length = 0;
    if (g.touchHeld && g.touchHeld.forward) releaseAction(g, 'forward');
    g.touchHeld = {};
  }

  // ---- events -------------------------------------------------------------------------------
  onStart(e) {
    const ui = this.ui;
    if (e.target === ui.input) return; // the text field takes the tap itself (opens the on-screen keyboard)
    ui.lastTouch = performance.now();
    const play = this.playing();
    if (play && !this.on()) return; // touch controls off: leave the browser's mouse emulation alone
    e.preventDefault();
    Sound.init();
    for (const ct of e.changedTouches) {
      const [x, y] = this.gui(ct.clientX, ct.clientY);
      const s = { sx: ct.clientX, sy: ct.clientY, cx: ct.clientX, cy: ct.clientY, x0: x, y0: y, x, y, t0: performance.now() };
      this.t.set(ct.identifier, s);
      if (play) this.startPlay(s); else this.startMenu(s);
    }
  }
  onMove(e) {
    let mine = false;
    for (const ct of e.changedTouches) {
      const s = this.t.get(ct.identifier);
      if (!s) continue;
      mine = true;
      const pcx = s.cx, pcy = s.cy;
      s.cx = ct.clientX; s.cy = ct.clientY;
      [s.x, s.y] = this.gui(s.cx, s.cy);
      if ((s.cx - s.sx) ** 2 + (s.cy - s.sy) ** 2 > 100) s.moved = true;
      if (s.kind === 'menu') this.moveMenu(s); else this.movePlay(s, s.cx - pcx, s.cy - pcy);
    }
    if (mine) e.preventDefault();
  }
  onEnd(e, cancel) {
    let mine = false;
    this.ui.lastTouch = performance.now();
    for (const ct of e.changedTouches) {
      const s = this.t.get(ct.identifier);
      if (!s) continue;
      mine = true;
      this.t.delete(ct.identifier);
      if (s.kind === 'menu') this.endMenu(s, cancel); else this.endPlay(s, cancel);
    }
    if (!mine) return;
    e.preventDefault();
    Sound.init();
    // first tap in touch mode in a world: go fullscreen in landscape, like an app. Not on the first-run screens (it
    // was the very first tap, on the agreement - players on tablets and learning phones: 「一点同意就卡死」, feedback
    // 2026-11-02) and not inside the Bilibili app, whose own container is fullscreen already
    if (this.on() && !this.fsTried && !cancel && this.g.state === 'play' && !/BiliApp/i.test(navigator.userAgent)) {
      this.fsTried = true;
      // (screens.js's checks: iPads and older Safari only have the webkit-prefixed call, iPhones none at all, a frame
      // may not - fullscreenEnabled false)
      const de = document.documentElement, req = de.requestFullscreen || de.webkitRequestFullscreen;
      if (!fsElement() && req && fsSupported()) {
        // (counted and sent first: a device that hangs here still tells)
        if (typeof Telemetry !== 'undefined' && Telemetry.count) { Telemetry.count('fs_try'); Telemetry.flush && Telemetry.flush(false); }
        try {
          const r = req.call(de, { navigationUI: 'hide' });
          if (r && r.then) r.then(() => { Telemetry.count && Telemetry.count('fs_ok'); if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape'); }).catch(() => { });
        } catch (e) { }
      }
    }
  }
  synth(type, s, button, atStart) {
    const ev = { clientX: atStart ? s.sx : s.cx, clientY: atStart ? s.sy : s.cy, button, shiftKey: false };
    if (type === 'down') this.ui.mouseDown(ev); else if (type === 'up') this.ui.mouseUp(ev); else this.ui.mouseMove(ev);
  }
  focusInput() {
    const ui = this.ui;
    if (ui.screen && ui.screen.isChat && ui.input.style.display === 'block' && document.activeElement !== ui.input) ui.input.focus();
  }

  // ---- menus --------------------------------------------------------------------------------------
  startMenu(s) {
    const ui = this.ui, sc = ui.screen;
    s.kind = 'menu'; s.mode = 'pending';
    const cr = this.closeRect();
    if (cr && ui.hit(cr, s.x, s.y)) { s.mode = 'close'; return; }
    if (document.activeElement === ui.input && !(ui.inputBox && ui.hit(ui.inputBox, s.x, s.y))) ui.input.blur();
    ui.mouse.x = s.x; ui.mouse.y = s.y;
    if (!sc) return;
    const slider = !(sc instanceof ContainerScreen) && sc.widgets && sc.widgets.some(w => w.slider && w.enabled !== false && ui.hit(w, s.x, s.y));
    const scrollbar = sc instanceof CreativeScreen && s.x >= sc.x + 172 && s.x < sc.x + 190 && s.y >= sc.y + 16 && s.y < sc.y + 132;
    // (sc.touchDrag: a screen that is all dragging - the button layout editor - gets the finger as a held mouse)
    if (slider || scrollbar || sc.touchDrag) { this.synth('down', s, 0); s.mode = 'drag'; }
  }
  moveMenu(s) {
    const ui = this.ui, sc = ui.screen;
    if (s.mode === 'drag' || s.mode === 'down' || s.mode === 'long') { this.synth('move', s); return; }
    if (s.mode === 'scroll') { this.scrollBy(s); return; }
    if (s.mode !== 'pending' || !s.moved) return;
    const cont = sc instanceof ContainerScreen, dx = s.cx - s.sx, dy = s.cy - s.sy;
    if (sc && sc.wheel && (!cont || (!ui.cursor && Math.abs(dy) > Math.abs(dx)))) { s.mode = 'scroll'; s.acc = 0; s.ly = s.y0; this.scrollBy(s); }
    else if (cont) {
      // a stack dragged from its slot with nothing in hand: carried, and put down where the finger lets go (11-03:
      // before, it stayed on the finger and needed another tap - "背包里放东西不舒服")
      const from = sc.slotAt && sc.slotAt(s.x0, s.y0);
      if (!ui.cursor && from && from.get()) s.carry = from;
      this.synth('down', s, 0, true); s.mode = 'down'; this.synth('move', s);
    }
    else s.mode = 'none';
  }
  scrollBy(s) {
    const sc = this.ui.screen;
    const step = sc instanceof WorldListScreen ? 36 : sc instanceof OptionsListScreen ? 25 : sc instanceof ContainerScreen ? 18 : 20;
    s.acc += s.y - s.ly; s.ly = s.y;
    while (Math.abs(s.acc) >= step) { const d = Math.sign(s.acc); s.acc -= d * step; this.ui.wheel(-d); }
  }
  endMenu(s, cancel) {
    const ui = this.ui;
    switch (s.mode) {
      case 'close': { const cr = this.closeRect(); if (!cancel && cr && ui.hit(cr, s.x, s.y)) this.closeScreen(); break; }
      case 'pending': if (!cancel) this.tap(s); break;
      case 'drag': case 'down':
        this.synth('up', s, 0);
        if (s.carry && !cancel) this.dropCarried(s);
        break;
      case 'long': this.synth('up', s, 2); break;
    }
    // no hover highlight left behind on buttons (inventories keep the position for the carried stack)
    if (!(ui.screen instanceof ContainerScreen)) { ui.mouse.x = -1000; ui.mouse.y = -1000; }
  }
  // the carried stack let go: onto the slot under the finger (a click there: put down, stacked on the same, or swapped
  // - the swapped one goes back where the carried came from); let go off the slots or back on its own slot, it goes
  // home (never dropped into the world by a finger slipping off the window)
  dropCarried(s) {
    const ui = this.ui, sc = ui.screen;
    if (!(sc instanceof ContainerScreen) || !ui.cursor) return;
    const to = sc.slotAt(s.x, s.y), home = s.carry;
    const clickAt = (atStart) => { this.synth('down', s, 0, atStart); this.synth('up', s, 0, atStart); };
    if (to && to !== home && !to.output) {
      clickAt(false);
      if (ui.cursor && !home.output && !home.get()) clickAt(true); // (the swapped stack: into the emptied slot)
    } else if (!home.output && !home.get()) clickAt(true);
    sc.lastClick = null; // (no double click made of these)
  }
  tap(s) {
    const sc = this.ui.screen;
    if (sc instanceof ContainerScreen && this.quickMoveTap(s)) return;
    this.synth('down', s, 0, true); this.synth('up', s, 0, true);
    this.focusInput();
  }
  // double tap a slot: the first tap picked the stack up, the second puts it back and shift-clicks it
  quickMoveTap(s) {
    const ui = this.ui, sc = ui.screen, slot = sc.slotAt(s.x0, s.y0), now = performance.now(), last = this.lastSlotTap;
    this.lastSlotTap = slot ? { slot, sc, t: now } : null;
    if (!slot || !last || last.slot !== slot || last.sc !== sc || now - last.t > 350) return false;
    if (slot.output || !ui.cursor || slot.get() || !sc.canPlace(slot, ui.cursor)) return false;
    if (sc.net) { sc.net.click(sc, slot.v, 0, 0); sc.net.click(sc, slot.v, 0, 1); this.lastSlotTap = null; return true; } // a server's window: as clicks
    slot.set(ui.cursor); ui.cursor = null;
    sc.quickMove(slot); sc.changed();
    this.lastSlotTap = null;
    return true;
  }
  closeRect() {
    const g = this.g, sc = this.ui.screen;
    if (!sc || g.state !== 'play' || !this.on()) return null;
    if (!(sc instanceof ContainerScreen || sc.isChat || (typeof CreditsScreen !== 'undefined' && sc instanceof CreditsScreen))) return null;
    const { B } = this.metrics(), ts = Math.round(B * 0.9); // (larger than the top buttons: players could not find how to close the inventory)
    return { x: this.ui.w - 4 - ts, y: 4, w: ts, h: ts };
  }
  closeScreen() {
    const ui = this.ui, sc = ui.screen;
    if (sc.onEsc) sc.onEsc(); else ui.close();
  }

  // ---- playing ------------------------------------------------------------------------------------------
  metrics() {
    const ui = this.ui, W = ui.w, H = ui.h, k = ui.dpr / ui.scale, st = this.g.settings;
    let B = Math.round(50 * touchSizeOf(st) * k);
    B = Math.max(12, Math.min(B, Math.floor((W / 2 - 97) / 3.3), Math.floor((W / 2 - 117) / 2.4), Math.floor((H - 40) / 3.6)));
    return { B, m: Math.max(3, Math.round(B * 0.3)), gp: Math.max(1, Math.round(B * 0.06)), W, H };
  }
  layout() {
    const { B, m, gp, W, H } = this.metrics(), g = this.g, p = g.player, th = g.touchHeld, st = g.settings;
    const L = { B, gp, x0: m, y0: H - m - 3 * B };
    L.dpad = { x: L.x0, y: L.y0, w: 3 * B, h: 3 * B };
    const cell = (r, c) => ({ x: L.x0 + c * B + gp, y: L.y0 + r * B + gp, w: B - 2 * gp, h: B - 2 * gp });
    L.cells = { up: cell(0, 1), left: cell(1, 0), right: cell(1, 2), down: cell(2, 1) };
    if (th.forward) { L.cells.ul = cell(0, 0); L.cells.ur = cell(0, 2); }
    if (!p.flying) L.cells.sneak = cell(1, 1);
    const jx = W - m - B, jy = H - m - 2 * B - gp;
    L.jump = { x: jx, y: jy, w: B, h: B };
    if (p.flying) L.descend = { x: jx, y: H - m - B, w: B, h: B };
    if (st.touchSprintBtn !== false && g.mode !== 'spectator') L.sprint = { x: jx - B - gp, y: H - m - B, w: B, h: B };
    const te = g.targetEntity;
    if (te && g.mode !== 'spectator' && !(te.T && te.T.hostile)) {
      L.interactText = typeof Villager !== 'undefined' && te instanceof Villager ? '交易' : '互动';
      const iw = Math.max(B, Font.width(L.interactText) + 12), ih = Math.round(B * 0.6);
      L.interact = { x: W - m - iw, y: jy - ih - 2 * gp, w: iw, h: ih };
    }
    const ts = Math.round(B * 0.7);
    L.pause = { x: W - 4 - ts, y: 4, w: ts, h: ts };
    L.chat = { x: W - 4 - 2 * ts - gp, y: 4, w: ts, h: ts };
    L.view = { x: W - 4 - 3 * ts - 2 * gp, y: 4, w: ts, h: ts };
    if (g.mode !== 'spectator') {
      const hx = Math.floor(W / 2 - 91), hy = H - 22;
      L.hotbar = { x: hx, y: hy, w: 182, h: 22 };
      L.inv = { x: hx + 184, y: hy, w: 20, h: 22 };
    }
    L.chatLift = Math.max(0, m + 3 * B - 38);
    return (this.L = L);
  }
  hitL(r, x, y, pad = this.L.gp) { return !!r && x >= r.x - pad && y >= r.y - pad && x < r.x + r.w + pad && y < r.y + r.h + pad; }
  dpadCell(x, y, start) {
    const L = this.L, pad = start ? 0 : L.B * 0.75;
    if (x < L.x0 - pad || y < L.y0 - pad || x >= L.x0 + 3 * L.B + pad || y >= L.y0 + 3 * L.B + pad) return null;
    const c = clamp(Math.floor((x - L.x0) / L.B), 0, 2), r = clamp(Math.floor((y - L.y0) / L.B), 0, 2);
    const id = [['ul', 'up', 'ur'], ['left', 'sneak', 'right'], [null, 'down', null]][r][c];
    if (id === 'sneak') return start && L.cells.sneak ? 'sneak' : null;
    if ((id === 'ul' || id === 'ur') && start) return null; // the diagonals only appear while moving forward
    return id;
  }
  setDir(c) {
    const g = this.g, th = g.touchHeld, f = c === 'up' || c === 'ul' || c === 'ur', was = !!th.forward;
    th.forward = f; th.back = c === 'down'; th.left = c === 'left' || c === 'ul'; th.right = c === 'right' || c === 'ur';
    if (f && !was) pressAction(g, 'forward'); // double tap forward sprints, like the keyboard
    if (!f && was) { releaseAction(g, 'forward'); th.sprint = false; }
  }
  hotbarAt(s) {
    const L = this.L, p = this.g.player;
    const i = clamp(Math.floor((s.x - L.hotbar.x - 1) / 20), 0, 8);
    if (i !== s.slot) { s.slot = i; s.t0 = performance.now(); s.dropped = false; p.inv.sel = i; }
  }
  startPlay(s) {
    const g = this.g, th = g.touchHeld, L = this.layout(), x = s.x, y = s.y;
    s.kind = 'look';
    for (const id of ['pause', 'chat', 'view', 'inv', 'interact']) if (this.hitL(L[id], x, y)) { s.kind = 'button'; s.btn = id; return; }
    if (L.hotbar && this.hitL(L.hotbar, x, y, 0)) { s.kind = 'hotbar'; this.hotbarAt(s); return; }
    if (this.hitL(L.jump, x, y)) { s.kind = 'jump'; th.jump = true; pressAction(g, 'jump'); return; }
    if (L.descend && this.hitL(L.descend, x, y)) { s.kind = 'descend'; th.down = true; return; }
    if (L.sprint && this.hitL(L.sprint, x, y)) { s.kind = 'none'; th.sprint = !th.sprint; return; }
    const c = this.dpadCell(x, y, true);
    if (c === 'sneak') { s.kind = 'none'; th.sneak = !th.sneak; return; }
    if (c) { s.kind = 'dpad'; s.cell = c; this.setDir(c); }
  }
  movePlay(s, dx, dy) {
    const g = this.g, p = g.player, st = g.settings;
    if (s.kind === 'look') {
      // radians per CSS pixel (touchLook: 1 = the old default, a swipe across a phone about 180°)
      const k = 0.0045 * touchLook(st);
      p.yaw -= dx * k * (st.invertX ? -1 : 1);
      p.pitch = clamp(p.pitch - dy * k * (st.invertY ? -1 : 1), -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
    } else if (s.kind === 'dpad') {
      const c = this.dpadCell(s.x, s.y, false);
      if (c !== s.cell) { s.cell = c; this.setDir(c); }
    } else if (s.kind === 'hotbar' && this.hitL(this.L.hotbar, s.x, s.y, 4)) this.hotbarAt(s);
  }
  endPlay(s, cancel) {
    const g = this.g, th = g.touchHeld;
    switch (s.kind) {
      case 'look':
        if (s.holding) g.mouseBtn[s.holdBtn] = false;
        else if (!s.moved && !cancel && performance.now() - s.t0 < 350) this.click(g.targetEntity ? 0 : 2);
        break;
      case 'dpad': this.setDir(null); break;
      case 'jump': th.jump = false; break;
      case 'descend': th.down = false; break;
      case 'button': if (!cancel && this.hitL(this.L[s.btn], s.x, s.y)) this.button(s.btn); break;
    }
  }
  // a tap: press the attack (0) or use (2) button for one game tick
  click(b) {
    const g = this.g, p = g.player;
    if (b === 0) { g.mouseBtn[0] = true; g.mouseClicked0 = true; g.attackCd = Math.min(g.attackCd, 0); if (!g.targetEntity && !g.target) p.swing(); }
    else { g.mouseBtn[2] = true; g.useCd = 0; }
    this.pend.push({ b, tick: g.tickCount });
  }
  button(id) {
    const g = this.g;
    switch (id) {
      case 'pause': g.ui.open(new PauseScreen(g)); break;
      case 'chat': pressAction(g, 'chat'); this.focusInput(); break;
      case 'view': pressAction(g, 'togglePerspective'); break;
      case 'inv': pressAction(g, 'inventory'); break;
      case 'interact': this.click(2); break;
    }
  }
  // timers: long presses, one-tick taps
  update(now) {
    const g = this.g, p = g.player, th = g.touchHeld;
    for (let i = this.pend.length - 1; i >= 0; i--) {
      const q = this.pend[i];
      if (g.tickCount > q.tick) { if (![...this.t.values()].some(s => s.holding && s.holdBtn === q.b)) g.mouseBtn[q.b] = false; this.pend.splice(i, 1); }
    }
    if (!p) return;
    if (p.flying && th.sneak) th.sneak = false;
    for (const s of this.t.values()) {
      if (s.kind === 'look' && !s.moved && !s.holding && now - s.t0 >= 300 && this.playing() && g.mode !== 'spectator') {
        // hold: mine (attack) — or keep using a held-use item like food or a bow
        s.holding = true;
        s.holdBtn = touchHoldUse(p.inv.held) && !g.targetEntity ? 2 : 0;
        if (s.holdBtn === 2) { g.mouseBtn[2] = true; g.useCd = 0; }
        else { g.mouseBtn[0] = true; g.mouseClicked0 = true; g.attackCd = Math.min(g.attackCd, 0); if (!g.target && !g.targetEntity) p.swing(); }
        if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { }
      }
      if (s.kind === 'hotbar' && !s.dropped && now - s.t0 >= 600 && this.playing()) {
        s.dropped = true; pressAction(g, 'drop', { ctrlKey: true }); // hold a slot: drop the whole stack
        if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) { }
      }
      if (s.kind === 'menu' && s.mode === 'pending' && now - s.t0 >= 350 && this.ui.screen instanceof ContainerScreen) {
        s.mode = 'long'; this.synth('down', s, 2, true); this.synth('move', s); // long press = right click
        if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { }
      }
    }
  }
  topInset() { return this.on() && this.g.state === 'play' && !this.ui.screen && this.L ? Math.round(this.L.B * 0.7) + 6 : 0; }
  chatLift() { return this.on() && this.g.state === 'play' && !this.ui.screen && this.L ? this.L.chatLift : 0; }

  // ---- drawing ---------------------------------------------------------------------------------------
  icon(c, name, r, color) {
    // (any size, square; '+' is drawn at half strength - a lighter face)
    const a = TOUCH_ICONS[name], n = a.length, px = Math.max(1, Math.floor(Math.min(r.w, r.h) * (n > 9 ? 0.66 : 0.6) / n));
    const ox = Math.round(r.x + (r.w - n * px) / 2), oy = Math.round(r.y + (r.h - n * px) / 2), a0 = c.globalAlpha;
    c.fillStyle = color;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const ch = a[y][x]; if (ch !== '#' && ch !== '+') continue;
      c.globalAlpha = ch === '+' ? a0 * 0.45 : a0; c.fillRect(ox + x * px, oy + y * px, px, px);
    }
    c.globalAlpha = a0;
  }
  // a button in vanilla's pixel style (11-03 - the user: 原版的像素风，方块按钮，不要花哨颜色): a see-through dark square
  // in a black outline, lit along the top and left and shaded along the bottom and right in whole pixels; pressed it
  // goes lighter, the bevel turns over and the icon sinks a pixel. Black, white and greys only.
  // Drawn once into a canvas of its own (device pixels, at the opacity) and copied from then on: rect by rect the
  // controls were 770 fillRect and 688 globalAlpha changes a frame - 0.116 ms recording on a PC (11-03), several times
  // that on phones; copied, 13 drawImage and 0.017 ms. Over a clear canvas the copy is the same to the bit; over the
  // vignette 1/255 apart in a few channels (the order the alphas add up in). Keyed by all the picture depends on (the
  // bevel p follows w and h); let go when the screen, the scale, the opacity or the layout's sizes change
  btn(c, r, icon, on, text) {
    if (!r) return;
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h), s = this.ui.scale, a = c.globalAlpha;
    if (w <= 0 || h <= 0) return;
    const S = this.spr || (this.spr = new Map()), key = (text ? '"' + text : icon) + '|' + (on ? 1 : 0) + '|' + w + '|' + h + '|' + a + '|' + s;
    let cv = S.get(key);
    if (cv) { S.delete(key); S.set(key, cv); }
    else {
      cv = document.createElement('canvas'); cv.width = w * s; cv.height = h * s;
      const k = cv.getContext('2d'); k.setTransform(s, 0, 0, s, 0, 0); k.imageSmoothingEnabled = false; k.globalAlpha = a;
      this.btnRaw(k, 0, 0, w, h, icon, on, text);
      S.set(key, cv); if (S.size > 64) S.delete(S.keys().next().value);
    }
    c.globalAlpha = 1; c.drawImage(cv, x, y, w, h); c.globalAlpha = a;
  }
  btnRaw(c, x, y, w, h, icon, on, text) {
    const p = Math.max(1, Math.round(Math.min(w, h) / 22));
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x, y, w, p); c.fillRect(x, y + h - p, w, p); c.fillRect(x, y + p, p, h - 2 * p); c.fillRect(x + w - p, y + p, p, h - 2 * p);
    c.fillStyle = on ? 'rgba(150,150,150,0.6)' : 'rgba(40,40,40,0.5)'; c.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
    const lit = on ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.28)', dark = on ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.35)';
    c.fillStyle = lit; c.fillRect(x + p, y + p, w - 2 * p, p); c.fillRect(x + p, y + 2 * p, p, h - 3 * p);
    c.fillStyle = dark; c.fillRect(x + 2 * p, y + h - 2 * p, w - 3 * p, p); c.fillRect(x + w - 2 * p, y + 2 * p, p, h - 4 * p);
    const ir = { x, y: y + (on ? p : 0), w, h };
    if (text) Font.center(c, text, x + w / 2, Math.round(y + (h - 8) / 2) + (on ? p : 0), '#FFFFFF');
    else if (TOUCH_ICONS[icon]) { this.icon(c, icon, { ...ir, x: ir.x + p, y: ir.y + p }, 'rgba(0,0,0,0.5)'); this.icon(c, icon, ir, on ? '#FFFFFF' : '#E6E6E6'); }
  }
  draw(ui) {
    const g = this.g, c = ui.ctx, st = g.settings;
    this.update(performance.now());
    if (!this.on()) return;
    // (the buttons' pictures: kept while nothing they depend on changed - the cap of 64 lets go of the rest meanwhile)
    const sig = ui.canvas.width + 'x' + ui.canvas.height + 'x' + ui.scale + 'x' + (st.touchOpacity ?? 0.7) + 'x' + (st.touchSize ?? '');
    if (this.spr && (this.sprSig !== sig || this.sprScale !== st.touchScale)) this.spr.clear();
    this.sprSig = sig; this.sprScale = st.touchScale;
    if (ui.h > ui.w) {
      const t = '横屏游玩体验更佳', w = Font.width(t) + 8;
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(Math.floor(ui.w / 2 - w / 2), 2, w, 12);
      Font.center(c, t, ui.w / 2, 4, '#FFFF55');
    }
    if (g.state !== 'play') return;
    if (ui.screen) { const r = this.closeRect(); if (r) this.btn(c, r, 'close', false); return; }
    const L = this.layout(), th = g.touchHeld, p = g.player;
    const active = new Set([...this.t.values()].map(s => s.kind === 'dpad' ? s.cell : s.kind === 'button' ? s.btn : s.kind));
    c.save();
    c.globalAlpha = g.settings.touchOpacity ?? 0.7;
    for (const id in L.cells) this.btn(c, L.cells[id], id === 'sneak' ? (th.sneak ? 'sneakOn' : 'sneak') : id, id === 'sneak' ? !!th.sneak : active.has(id));
    this.btn(c, L.jump, 'jump', !!th.jump);
    this.btn(c, L.descend, 'descend', !!th.down);
    this.btn(c, L.sprint, 'sprint', !!th.sprint || !!p.sprinting);
    if (L.interact) this.btn(c, L.interact, null, active.has('interact'), L.interactText);
    this.btn(c, L.pause, 'pause', active.has('pause'));
    this.btn(c, L.chat, 'chat', active.has('chat'));
    this.btn(c, L.view, 'view', active.has('view'));
    if (L.inv) {
      const r = L.inv;
      this.btn(c, { x: r.x, y: r.y + 1, w: r.w, h: r.h - 2 }, 'inv', active.has('inv'));
      c.fillStyle = '#FFFFFF'; for (let i = 0; i < 3; i++) c.fillRect(r.x + 4 + i * 5, r.y + 10, 2, 2);
    }
    c.restore();
    // holding a hotbar slot: a bar fills up until the stack is dropped
    for (const s of this.t.values()) if (s.kind === 'hotbar' && !s.dropped && p.inv.held) {
      const f = clamp((performance.now() - s.t0 - 150) / 450, 0, 1);
      if (f > 0) { c.fillStyle = '#FFFFFF'; c.fillRect(L.hotbar.x + 3 + s.slot * 20, L.hotbar.y - 3, Math.round(16 * f), 2); }
    }
  }
}

function bindTouch(g) {
  // first start on a phone / tablet: lighter defaults and auto-jump, like Bedrock on touch
  const saved = g.loadSettings();
  // 「用电脑玩」on the first-run screen used to set touch off for good: on a phone no buttons, touching did nothing and
  // the pause screen kept coming back (feedback 2026-11-01, 262 devices picked it on a phone) - that off becomes the
  // choice it was, once
  if (g.settings.touch === false && !g.settings.touchMig && g.settings.onboarded) { delete g.settings.touch; g.settings.touchPick = 'pc'; }
  if (!g.settings.touchMig) { g.settings.touchMig = 1; g.saveSettings(); }
  if (TouchDevice.defaultOn) {
    if (saved.renderDist === undefined) g.settings.renderDist = 6;
    if (saved.autoJump === undefined) g.settings.autoJump = true;
    g.applySettings();
  }
  const tc = g.ui.touch = new TouchControls(g);
  window.addEventListener('blur', () => tc.reset());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    tc.reset();
    if (touchOn(g) && g.state === 'play' && !g.ui.screen) g.ui.open(new PauseScreen(g));
  });
  // a touchscreen PC, or a tablet / phone asking for the desktop site, without the touch controls by default: touching
  // the game turns them on for this session, the mouse turns them off again (unless chosen in the settings). Before,
  // 「回到游戏」took the pointer lock, the next touch let it go and the pause screen came back - players stuck in the
  // menu (feedback 2026-10-31). (pointerdown comes before touchstart / mousedown, which then see the new mode)
  // The same the other way on a phone / tablet, touch by default: a Bluetooth mouse clicked in the world plays by mouse
  // (before, only a touch PC switched back - on a tablet the pointer stayed out and could not be locked). Only where
  // the system says a fine pointer is there: a web view that called a finger a mouse would lose its buttons
  const fine = () => !!(window.matchMedia && matchMedia('(any-pointer: fine)').matches);
  window.addEventListener('pointerdown', (e) => {
    if (g.settings.touch !== undefined || g.state !== 'play') return;
    if ((e.pointerType === 'touch' || e.pointerType === 'pen') && !touchOn(g)) { g.touchAuto = true; g.releasePointer(); }
    else if (e.pointerType === 'mouse' && touchOn(g) && !g.ui.screen && (g.touchAuto || fine())) { tc.reset(); g.touchAuto = false; }
  }, true);
  // touch mode plays without pointer lock
  const capture = Game.prototype.capturePointer;
  Game.prototype.capturePointer = function () { if (!touchOn(this)) capture.call(this); };
}
{
  const bind = bindInput;
  bindInput = function (g) { bind(g); bindTouch(g); };
}
