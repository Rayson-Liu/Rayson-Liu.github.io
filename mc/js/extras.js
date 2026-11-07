'use strict';
// ---------------------------------------------------------------------------
// Helpers vanilla doesn't have (game/UX_IDEAS.md「体验优化」), each can be switched off:
//   the death point (an arrow and the distance on screen after respawning), a minimap with waypoints (B adds one,
//   N lists them; long press the map on a phone), markers in a room ("look here", G), sorting an inventory, a
//   warning when a tool is about to break, the item encyclopedia (J: every item, how it is made, what it makes),
//   the player list (hold Tab), quick toggles for a room's owner, a photo with a share card (F2), the automatic
//   quality step (down when the frame rate can't keep up, back up later), play time in the world list, and
//   reconnecting by itself when a room's connection drops.
// ---------------------------------------------------------------------------
const Extras = {};

// ---- a direction marker on the HUD: a point in the world, shown where it is on screen (or at the edge) ----
function hudMarker(ui, pos, label, color, small) {
  const g = ui.game, r = g.renderer, vp = r.vp, p = g.player;
  if (!vp || !p) return;
  const x = pos[0] + 0.5, y = pos[1] + 1, z = pos[2] + 0.5;
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  const d = Math.hypot(x - p.pos[0], z - p.pos[2]);
  let sx, sy, edge = false;
  if (cw > 0.1) { sx = (cx / cw * 0.5 + 0.5) * ui.w; sy = (1 - (cy / cw * 0.5 + 0.5)) * ui.h; }
  if (cw <= 0.1 || sx < 8 || sx > ui.w - 8 || sy < 20 || sy > ui.h - 40) {
    // behind or off screen: on the edge, toward it
    const a = Math.atan2(cx / Math.max(Math.abs(cw), 0.1) * Math.sign(cw || 1), cy / Math.max(Math.abs(cw), 0.1) * Math.sign(cw || 1));
    const R = Math.min(ui.w, ui.h) * 0.42;
    sx = ui.w / 2 + Math.sin(a) * R * (cw > 0 ? 1 : -1); sy = ui.h / 2 - Math.cos(a) * R * (cw > 0 ? 1 : -1); edge = true;
  }
  sx = clamp(sx, 10, ui.w - 10); sy = clamp(sy, 22, ui.h - 44);
  const c = ui.ctx, t = `${label} ${Math.round(d)}m`;
  c.fillStyle = color; c.beginPath(); c.moveTo(sx, sy - 5); c.lineTo(sx + 4, sy); c.lineTo(sx, sy + 5); c.lineTo(sx - 4, sy); c.fill();
  if (!small || !edge) { const w = Font.width(t) + 4; c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(Math.round(sx - w / 2), Math.round(sy + 7), w, 10); Font.center(c, t, sx, sy + 8, color); }
}

// ---- the death point ----
(() => {
  const dd = Game.prototype.onPlayerDeath;
  Game.prototype.onPlayerDeath = function (src) { const r = dd.call(this, src); if (this.lastDeath) this.lastDeath.at = Date.now(); return r; };
})();
Extras.drawDeath = function (ui) {
  const g = ui.game, L = g.lastDeath, s = g.settings;
  if (!L || !L.at || L.dim !== g.dim || (s.deathMarker === false) || (s.deathMarker === undefined && s.playerKind !== 'new') || g.player.deathTime > 0) return;
  const d = Math.hypot(L.pos[0] - g.player.pos[0], L.pos[2] - g.player.pos[2]);
  if (Date.now() - L.at > 300e3 || d < 3) { if (d < 3) L.at = 0; return; }
  hudMarker(ui, L.pos, '死亡点', '#FF6060');
};

// ---- the minimap: the top blocks around the player, north up, one pixel a block, made twice a second ----
const Minimap = {
  N: 64, cv: null, img: null, at: 0,
  on(g) { const s = g.settings; return s.minimap === true || (s.minimap === undefined && s.playerKind === 'new'); },
  rect(ui) { const s = this.N, sf = ui.safe ? ui.safe() : { l: 0, t: 0 }; return { x: 4 + sf.l, y: 4 + sf.t, w: s, h: s }; },
  update(g) {
    const N = this.N, w = g.world, p = g.player;
    if (!this.cv) { this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = N; this.ctx = this.cv.getContext('2d'); this.img = this.ctx.createImageData(N, N); }
    const d = this.img.data, px = Math.floor(p.pos[0]), pz = Math.floor(p.pos[2]), slice = g.dim !== 'overworld', py = Math.floor(p.pos[1]);
    let prev = new Int16Array(N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = px - N / 2 + i, wz = pz - N / 2 + j, o = (j * N + i) * 4;
      if (!w.isLoaded(wx, wz)) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 120; prev[i] = 0; continue; }
      let y = slice ? Math.min(py + 1, HEIGHT - 1) : w.surfaceY(wx, wz) + 1, id = 0, n = 0;
      if (slice) { while (y > 0 && n++ < 40 && (id = w.getBlock(wx, y, wz)) !== 0) y--; } // (under a roof: from the player's height down)
      do { y--; id = w.getBlock(wx, y, wz); } while (y > 0 && (id === 0 || mapColorOf(id, 0) === 0));
      const col = mapColorOf(id, w.getMeta(wx, y, wz)), dh = j ? y - prev[i] : 0; prev[i] = y;
      const br = id === WATER ? 1 : dh > 0 ? 2 : dh < 0 ? 0 : 1, c = MAP_PAL[col * 4 + br] || [0, 0, 0, 0];
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  },
  draw(ui) {
    const g = ui.game;
    if (!this.on(g) || ui.hideHud || g.state !== 'play') return;
    const now = performance.now();
    if (now - this.at > 500) { this.at = now; try { this.update(g); } catch (e) { return; } }
    const c = ui.ctx, R = this.rect(ui), N = this.N, p = g.player;
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(R.x - 1, R.y - 1, R.w + 2, R.h + 2);
    c.drawImage(this.cv, R.x, R.y, R.w, R.h);
    const at = (x, z) => [R.x + (x - Math.floor(p.pos[0]) + N / 2), R.y + (z - Math.floor(p.pos[2]) + N / 2)];
    // waypoints, the death point
    for (const wp of Waypoints.list(g)) { const [mx, my] = at(wp.pos[0], wp.pos[2]); if (mx >= R.x && mx < R.x + N && my >= R.y && my < R.y + N) { c.fillStyle = wp.color; c.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3); } }
    if (g.lastDeath && g.lastDeath.at && g.lastDeath.dim === g.dim) { const [mx, my] = at(g.lastDeath.pos[0], g.lastDeath.pos[2]); if (mx >= R.x && mx < R.x + N && my >= R.y && my < R.y + N) { c.fillStyle = '#FF4040'; c.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3); } }
    // the player: an arrow facing where they look
    const a = p.yaw, cx = R.x + N / 2, cy = R.y + N / 2;
    c.fillStyle = '#FFFFFF'; c.beginPath();
    c.moveTo(cx - Math.sin(a) * 4, cy - Math.cos(a) * 4); c.lineTo(cx + Math.cos(a) * 2.5 + Math.sin(a) * 2, cy - Math.sin(a) * 2.5 + Math.cos(a) * 2); c.lineTo(cx - Math.cos(a) * 2.5 + Math.sin(a) * 2, cy + Math.sin(a) * 2.5 + Math.cos(a) * 2); c.fill();
    Font.draw(c, '北', R.x + N / 2 - 4, R.y + 1, '#FFFFFF');
    Font.draw(c, `${Math.floor(p.pos[0])}, ${Math.floor(p.pos[2])}`, R.x, R.y + N + 3, '#E0E0E0');
  },
};

// ---- waypoints: per world and dimension ----
const WP_COLORS = ['#55FFFF', '#FFFF55', '#FF55FF', '#55FF55', '#FFAA00', '#FFFFFF'];
const Waypoints = {
  all(g) { const m = g.worldMeta; return m ? (m.waypoints || (m.waypoints = [])) : (g.netWaypoints || (g.netWaypoints = [])); },
  list(g) { return this.all(g).filter((w) => (w.dim || 'overworld') === (g.dim || 'overworld') && w.show !== false); },
  add(g) {
    const A = this.all(g), p = g.player;
    const wp = { name: A.length ? '路标 ' + (A.length + 1) : '家', pos: p.pos.map(Math.floor), dim: g.dim || 'overworld', color: WP_COLORS[A.length % WP_COLORS.length] };
    A.push(wp);
    g.ui.message(`已添加路标“${wp.name}”（${wp.pos[0]}, ${wp.pos[1] + (typeof MIN_Y === 'number' ? MIN_Y : 0)}, ${wp.pos[2]}）：N 键管理`, wp.color);
  },
};
class WaypointScreen extends FormScreen {
  constructor(game) { super(game, '路标', null); this.pauses = false; this.edit = -1; this.name = ''; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game, A = Waypoints.all(g);
    this.fields = {}; this.widgets = [];
    A.slice(0, 7).forEach((wp, i) => {
      const y = 36 + i * 22;
      if (this.edit === i) { this.addField('name', cx - 150, y, 150, '', 16); this.widgets.push({ x: cx + 4, y, w: 50, h: 20, label: '确定', onClick: () => { wp.name = this.name.trim() || wp.name; this.edit = -1; g.ui.hideInput(); this.layout(); } }); }
      else this.widgets.push(
        { x: cx + 4, y, w: 46, h: 20, label: '改名', onClick: () => { this.edit = i; this.name = wp.name; this.layout(); } },
        { x: cx + 54, y, w: 46, h: 20, label: wp.show === false ? '显示' : '隐藏', onClick: () => { wp.show = wp.show === false; this.layout(); } },
        { x: cx + 104, y, w: 46, h: 20, label: '删除', onClick: () => { A.splice(i, 1); this.layout(); } },
      );
    });
    this.widgets.push(
      { x: cx - 150, y: u.h - 52, w: 148, h: 20, label: '在这里加一个路标', onClick: () => { Waypoints.add(g); this.layout(); } },
      { x: cx + 2, y: u.h - 52, w: 148, h: 20, label: () => '小地图：' + (Minimap.on(g) ? '开' : '关'), onClick: () => { g.settings.minimap = !Minimap.on(g); g.saveSettings(); } },
      { x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => { g.ui.hideInput(); g.ui.close(); } },
    );
    if (this.edit >= 0) this.focus('name');
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, g = this.game, A = Waypoints.all(g), p = g.player;
    if (!A.length) Font.center(c, '还没有路标：按 B 在脚下添加，或点下面的按钮', cx, 50, '#A0A0A0');
    A.slice(0, 7).forEach((wp, i) => {
      if (this.edit === i) return;
      const y = 36 + i * 22, d = Math.round(Math.hypot(wp.pos[0] - p.pos[0], wp.pos[2] - p.pos[2]));
      c.fillStyle = wp.color; c.fillRect(cx - 150, y + 6, 6, 6);
      Font.draw(c, fitText(wp.name, 80), cx - 140, y + 6, '#FFFFFF');
      Font.draw(c, (wp.dim || 'overworld') === (g.dim || 'overworld') ? d + 'm' : { nether: '下界', end: '末地', overworld: '主世界' }[wp.dim], cx - 52, y + 6, '#A0A0A0');
    });
    this.drawFields(ui);
  }
  onEsc() { this.game.ui.hideInput(); this.game.ui.close(); }
}

// ---- markers in a room: "look here" for everyone, 30 seconds (the room service passes them on) ----
const Marks = {
  list: [],
  add(name, pos, color) { this.list = this.list.filter((m) => m.name !== name); this.list.push({ name, pos, color: color || '#FFD24A', at: performance.now() }); },
  place(g) {
    if (!g.net) { Waypoints.add(g); return; }
    const t = g.target, pos = t ? [...t.pos] : g.player.pos.map(Math.floor);
    g.net.send({ t: 'mark', pos });
    this.add(g.net.name || '我', pos, '#55FF55');
    Sound.click && Sound.click();
  },
  draw(ui) {
    const now = performance.now();
    this.list = this.list.filter((m) => now - m.at < 30000);
    for (const m of this.list) hudMarker(ui, m.pos, m.name, m.color, true);
  },
};

// ---- the HUD additions ----
(() => {
  const hud = UI.prototype.drawHUD;
  UI.prototype.drawHUD = function () {
    hud.call(this);
    const g = this.game;
    if (g.state !== 'play' || this.hideHud) return;
    try {
      Minimap.draw(this); Extras.drawDeath(this);
      for (const wp of Waypoints.list(g)) if (Math.hypot(wp.pos[0] - g.player.pos[0], wp.pos[2] - g.player.pos[2]) > 4) hudMarker(this, wp.pos, wp.name, wp.color, true);
      Marks.draw(this); Extras.drawNet(this); Extras.drawPlayerList(this);
    } catch (e) { }
  };
  // keys: B waypoint, N waypoints, G mark, J encyclopedia, Tab players (held), F2 photo
  addEventListener('keydown', (e) => {
    const g = typeof game !== 'undefined' && game;
    if (!g || g.state !== 'play' || g.ui.screen || document.activeElement === g.ui.input) return;
    if (e.code === 'KeyB') Waypoints.add(g);
    else if (e.code === 'KeyN') g.ui.open(new WaypointScreen(g));
    else if (e.code === 'KeyG') Marks.place(g);
    else if (e.code === 'KeyJ') g.ui.open(new ItemDexScreen(g, null));
    else if (e.code === 'Tab') { Extras.tabHeld = true; e.preventDefault(); }
    else if (e.code === 'F2') { e.preventDefault(); Photo.take(g); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Tab') Extras.tabHeld = false; });
  // a phone: long press the minimap for the waypoints
  const sp = TouchControls.prototype.startPlay;
  TouchControls.prototype.startPlay = function (s) {
    const g = this.g, R = Minimap.rect(this.ui);
    if (Minimap.on(g) && s.x >= R.x && s.x < R.x + R.w && s.y >= R.y && s.y < R.y + R.h) { s.kind = 'button'; s.btn = 'minimap'; return; }
    return sp.call(this, s);
  };
  const bt = TouchControls.prototype.button;
  TouchControls.prototype.button = function (id) { if (id === 'minimap') this.g.ui.open(new WaypointScreen(this.g)); else bt.call(this, id); };
  // the room service passes marks on
  const om = NetClient.prototype.onMessage;
  NetClient.prototype.onMessage = function (m) {
    if (m && m.t === 'mark' && Array.isArray(m.pos) && m.pos.length === 3) { Marks.add(String(m.name || '?').slice(0, 16), m.pos.map((v) => v | 0)); Sound.ev && Sound.ev('block.note_block.pling', null, 0.6, 1.5); this.g.ui.message(`${m.name} 标记了一个位置`, '#FFD24A'); return; }
    if (m && m.t === 'pong' && typeof m.i === 'string' && m.i[0] === 'x') { const t = this.myPings && this.myPings.get(m.i); if (t) { this.myPings.delete(m.i); this.ping = Math.round(performance.now() - t); } return; }
    return om.call(this, m);
  };
})();

// ---- the connection: ping every 5 s; a dropped room is joined again by itself (5 tries) ----
setInterval(() => {
  const g = typeof game !== 'undefined' && game, n = g && g.net;
  if (!n || n.closed) return;
  const id = 'x' + ((n.pingN = (n.pingN || 0) + 1));
  (n.myPings || (n.myPings = new Map())).set(id, performance.now());
  if (n.myPings.size > 5) n.myPings.delete(n.myPings.keys().next().value);
  n.send({ t: 'ping', i: id });
}, 5000);
Extras.drawNet = function (ui) {
  const g = ui.game, n = g.net;
  if (!n) return;
  const p = n.ping, bad = p === undefined ? false : p > 300, x = ui.w - 30, y = (ui.touch && ui.touch.on() ? ui.touch.topInset() : 0) + 4;
  if (!bad && !Extras.tabHeld) return;
  const bars = p === undefined ? 0 : p < 150 ? 4 : p < 300 ? 3 : p < 600 ? 2 : 1, c = ui.ctx;
  for (let i = 0; i < 4; i++) { c.fillStyle = i < bars ? (bars <= 2 ? '#FF5555' : '#55FF55') : '#404040'; c.fillRect(x + i * 4, y + 8 - i * 2, 3, 2 + i * 2); }
  Font.draw(c, p === undefined ? '…' : p + 'ms', x - Font.width(String(p) + 'ms') - 3, y + 1, bad ? '#FF8080' : '#E0E0E0');
};
class ReconnectScreen extends MenuScreen {
  constructor(game, n, go) { super(game, '连接断开了'); this.n = n; this.go = go; this.pauses = false; this.t0 = performance.now(); this.wait = Math.min(15, 2 * n); this.timer = setTimeout(() => { if (this.game.ui.screen === this) go(); }, this.wait * 1000); }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h / 2 + 20, w: 200, h: 20, label: '不等了，回标题画面', onClick: () => { clearTimeout(this.timer); this.game.reconnect = null; this.game.ui.open(new TitleScreen(this.game)); } }]; }
  drawExtra(ui) { const s = Math.max(0, Math.ceil(this.wait - (performance.now() - this.t0) / 1000)); Font.center(ui.ctx, `网络断了一下，${s > 0 ? s + ' 秒后' : '正在'}重新连接（第 ${this.n} 次，最多 5 次）…`, ui.w / 2, ui.h / 2 - 10, '#FFFFFF'); }
  onEsc() { }
}
(() => {
  const fail = NetClient.prototype.fail;
  NetClient.prototype.fail = function (reason) {
    const g = this.g, room = this.opts && this.opts.room;
    if (!this.closed && room && reason === '与服务器的连接已断开' && (this.joined || g.reconnect) && ((g.reconnect && g.reconnect.n) || 0) < 5) {
      this.closed = true;
      const n = ((g.reconnect && g.reconnect.n) || 0) + 1, name = this.name;
      g.reconnect = { room, n };
      g.leaveServer();
      Telemetry.count && Telemetry.count('net:reconnect');
      g.ui.open(new ReconnectScreen(g, n, () => g.joinRoom(room, name)));
      return;
    }
    g.reconnect = null;
    return fail.call(this, reason);
  };
  const om = NetClient.prototype.onMessage;
  NetClient.prototype.onMessage = function (m) { if (m && m.t === 'room') { this.joined = true; if (this.g.reconnect) { this.g.ui.message('已重新连接', '#55FF55'); this.g.reconnect = null; } } return om.call(this, m); };
})();

// ---- the player list (hold Tab): who is in the room, the owner, this player's ping ----
Extras.drawPlayerList = function (ui) {
  const g = ui.game, n = g.net;
  if (!Extras.tabHeld || !n) return;
  const R = n.room, names = (R && R.players) || [...new Set(g.entities.filter((e) => e.type === 'player').map((e) => e.name))].concat([n.name]);
  const c = ui.ctx, w = 180, rows = Math.min(names.length, 12), x = Math.floor(ui.w / 2 - w / 2), y = 20;
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x, y, w, rows * 10 + 16);
  Font.center(c, R ? `${R.name}（${names.length}/${R.max}）` : '在线玩家', ui.w / 2, y + 3, '#FFFF55');
  names.slice(0, rows).forEach((nm, i) => {
    Font.draw(c, nm + (R && nm === R.owner ? '（房主）' : '') + (nm === n.name ? '（你）' : ''), x + 4, y + 14 + i * 10, '#FFFFFF');
    if (nm === n.name && n.ping !== undefined) Font.draw(c, n.ping + 'ms', x + w - 4 - Font.width(n.ping + 'ms'), y + 14 + i * 10, n.ping > 300 ? '#FF8080' : '#80FF80');
  });
};

// ---- sorting an inventory (a button on the window; not on a server's windows) ----
const sortKey = (st) => { const d = ITEMS[st.id]; const cat = d.armor ? 2 : d.durability ? 1 : d.food ? 4 : BLOCKS[d.block] ? 5 : 3; return cat * 100000 + st.id; };
function sortSlots(slots) {
  // merge stacks of the same item (same data), then order by kind and item
  const items = slots.map((s) => s.get()).filter(Boolean), merged = [];
  for (const st of items) {
    const same = merged.find((m) => m.id === st.id && m.count < maxStack(m.id) && JSON.stringify({ ...m, count: 0 }) === JSON.stringify({ ...st, count: 0 }));
    if (same) { const t = Math.min(maxStack(same.id) - same.count, st.count); same.count += t; st.count -= t; if (st.count) merged.push(st); }
    else merged.push(st);
  }
  merged.sort((a, b) => sortKey(a) - sortKey(b));
  slots.forEach((s, i) => s.set(merged[i] || null));
}
(() => {
  // (after the slots - every window draws them; subclasses have their own draw)
  const draw = ContainerScreen.prototype.drawSlots;
  ContainerScreen.prototype.drawSlots = function (ui) {
    draw.call(this, ui);
    if (this.net || this.game.net || this instanceof CreativeScreen) return;
    const r = this.sortRect = { x: this.x + this.gw - 22, y: this.y - 14, w: 20, h: 12 };
    const hov = ui.hit(r), c = ui.ctx;
    c.fillStyle = hov ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'; c.fillRect(r.x, r.y, r.w, r.h);
    Font.center(c, '整理', r.x + r.w / 2, r.y + 2, '#FFFFFF');
    const d = this.dexRect = { x: this.x + this.gw - 46, y: this.y - 14, w: 22, h: 12 };
    c.fillStyle = ui.hit(d) ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'; c.fillRect(d.x, d.y, d.w, d.h);
    Font.center(c, '图鉴', d.x + d.w / 2, d.y + 2, '#FFFFFF');
    if (hov) ui.tooltip([{ text: '整理：合并同样的物品，按种类排好' }, { text: '（只整理背包里的格子；箱子里点箱子那半边）', color: '#A0A0A0' }], ui.mouse.x, ui.mouse.y);
  };
  // (clicks taken before the window's own handling: subclasses have their own mouseDown)
  const md = UI.prototype.mouseDown;
  UI.prototype.mouseDown = function (ev) {
    const sc = this.screen;
    if (!(sc instanceof ContainerScreen) || this.game.net || sc instanceof CreativeScreen) return md.call(this, ev);
    const [mx, my] = this.toGui(ev), hit = (r) => r && mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
    if (hit(sc.dexRect)) { this.open(new ItemDexScreen(this.game, sc)); return; }
    if (hit(sc.sortRect)) { sc.sortNow(); return; }
    return md.call(this, ev);
  };
  ContainerScreen.prototype.sortNow = function () {
    {
      // the player's main inventory, or (a chest open) the chest's slots
      const own = this.slots.filter((s) => s.group === 'main'), other = this.slots.filter((s) => !s.group && !s.output && s.get !== undefined && !s.accept);
      sortSlots(other.length >= 9 ? other : own);
      if (this.changed) this.changed();
      Sound.click && Sound.click();
    }
  };
})();

// ---- a tool about to break: once, while it is held ----
(() => {
  const tick = Game.prototype.tick;
  Game.prototype.tick = function (...a) {
    const r = tick.apply(this, a);
    if (this.state === 'play' && this.tickCount % 10 === 0 && this.settings.durabilityWarn !== false) {
      const st = this.player && this.player.inv.held, d = st && ITEMS[st.id];
      if (d && d.durability && d.durability >= 32) {
        const left = d.durability - (st.dmg || 0);
        if (left <= Math.max(5, d.durability * 0.05) && st.warned !== left) { st.warned = left; this.ui.pinMessage(`${d.cn || d.key}快坏了：只剩 ${left} 点耐久`, 3000, '#FF8040'); }
      }
    }
    return r;
  };
})();

// ---- 物品图鉴: every item, searchable; how it is made (crafting, smelting) and what it is used in ----
class ItemDexScreen extends FormScreen {
  constructor(game, parent) {
    super(game, '物品图鉴', parent); this.titleY = 6; this.q = ''; this.page = 0; this.sel = null; this.rpage = 0;
    this.all = ITEMS.map((d, i) => d && i).filter((i) => i !== null && i !== undefined && ITEMS[i].key && !/^(air|.*_wall_.*|potted_.*)$/.test(ITEMS[i].key) && (ITEMS[i].creative !== false));
  }
  get pauses() { return this.game.state === 'play' && !this.game.net; }
  shown() {
    const q = this.q.trim().toLowerCase();
    return q ? this.all.filter((i) => { const d = ITEMS[i]; return d.key.includes(q) || (d.cn || '').includes(q); }) : this.all;
  }
  grid() { const u = this.game.ui, cols = Math.max(4, Math.floor((u.w / 2 - 20) / 18)), rows = Math.max(3, Math.floor((u.h - 70) / 18)); return { cols, rows, x: 10, y: 44 }; }
  layout() {
    const u = this.game.ui, G = this.grid(), n = G.cols * G.rows, pages = Math.max(1, Math.ceil(this.shown().length / n));
    this.page = clamp(this.page, 0, pages - 1);
    this.fields = {};
    this.addField('q', 10, 20, G.cols * 18, '', 24, (v) => { this.page = 0; return v; });
    this.widgets = [
      { x: 10, y: u.h - 24, w: 30, h: 18, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } },
      { x: 44, y: u.h - 24, w: 30, h: 18, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } },
      { x: u.w - 70, y: u.h - 24, w: 60, h: 18, label: '完成', onClick: () => this.back() },
    ];
    const R = this.recipes();
    if (R.length > 1) this.widgets.push(
      { x: u.w / 2 + 10, y: u.h - 24, w: 30, h: 18, label: '<', enabled: this.rpage > 0, onClick: () => { this.rpage--; } },
      { x: u.w / 2 + 44, y: u.h - 24, w: 30, h: 18, label: '>', enabled: this.rpage < R.length - 1, onClick: () => { this.rpage++; } },
    );
    this.focus('q');
  }
  back() { this.game.ui.hideInput(); if (this.parent) this.game.ui.open(this.parent); else this.game.ui.close(); }
  onEsc() { this.back(); }
  // the ways the selected item is made, then the recipes it goes into
  recipes() {
    const id = this.sel; if (id === null) return [];
    const out = [];
    for (const r of RECIPES) if (r.result === id) out.push({ kind: 'craft', r });
    for (const k in SMELTING) if (SMELTING[k].result === id) out.push({ kind: 'smelt', from: +k });
    if (SMELTING[id]) out.push({ kind: 'smeltInto', to: SMELTING[id].result });
    for (const r of RECIPES) if (r.result !== id && (r.type === 'shaped' ? Object.values(r.keys).some((a) => a.includes(id)) : r.ing.some((a) => a.includes(id)))) { out.push({ kind: 'use', r }); if (out.length > 60) break; }
    return out;
  }
  mouseDown(ui, mx, my, b) {
    const G = this.grid(), list = this.shown(), n = G.cols * G.rows;
    const i = Math.floor((mx - G.x) / 18), j = Math.floor((my - G.y) / 18);
    if (i >= 0 && i < G.cols && j >= 0 && j < G.rows && mx >= G.x) { const id = list[this.page * n + j * G.cols + i]; if (id !== undefined) { this.sel = id; this.rpage = 0; this.layout(); Sound.click && Sound.click(); return; } }
    // a slot of the recipe shown: that item
    if (this.slotHits) for (const h of this.slotHits) if (mx >= h.x && mx < h.x + 16 && my >= h.y && my < h.y + 16 && h.id !== undefined) { this.sel = h.id; this.rpage = 0; this.layout(); return; }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(d) { const G = this.grid(), n = G.cols * G.rows, pages = Math.ceil(this.shown().length / n); this.page = clamp(this.page - d, 0, pages - 1); this.layout(); }
  drawExtra(ui) {
    const c = ui.ctx, G = this.grid(), list = this.shown(), n = G.cols * G.rows;
    this.drawFields(ui);
    if (!this.q && this.field !== 'q') Font.draw(c, '搜索物品（中文名或英文 id）', 14, 26, '#707070');
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(G.x - 1, G.y - 1, G.cols * 18 + 2, G.rows * 18 + 2);
    list.slice(this.page * n, this.page * n + n).forEach((id, k) => {
      const x = G.x + (k % G.cols) * 18, y = G.y + Math.floor(k / G.cols) * 18;
      if (id === this.sel) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x, y, 18, 18); }
      ui.drawItem({ id, count: 1 }, x + 1, y + 1);
    });
    Font.draw(c, `${list.length} 个物品`, 80, ui.h - 19, '#A0A0A0');
    // the right half: the selected item
    const X = Math.floor(ui.w / 2) + 10, W = ui.w - X - 10;
    this.slotHits = [];
    if (this.sel === null) { Font.draw(c, '点左边的物品，看它怎么合成、能做什么', X, 50, '#A0A0A0'); return; }
    const d = ITEMS[this.sel];
    ui.drawItem({ id: this.sel, count: 1 }, X, 24);
    Font.draw(c, fitText(d.cn || d.key, W - 22), X + 20, 24, '#FFFFFF'); Font.draw(c, 'minecraft:' + d.key, X + 20, 34, '#707070');
    const R = this.recipes();
    if (!R.length) { Font.draw(c, '不能合成：在世界里找到或者从生物身上获得', X, 56, '#A0A0A0'); return; }
    this.rpage = clamp(this.rpage, 0, R.length - 1);
    const r = R[this.rpage], y0 = 62, slot = (id, x, y) => { c.fillStyle = '#8B8B8B'; c.fillRect(x - 1, y - 1, 18, 18); if (id !== undefined && id !== null) { ui.drawItem({ id, count: 1 }, x, y); this.slotHits.push({ x, y, id }); } };
    const cyc = (arr) => arr && arr.length ? arr[Math.floor(performance.now() / 1000) % arr.length] : undefined; // (a tag: its items in turn)
    Font.draw(c, { craft: '合成（工作台）', smelt: '烧炼（熔炉）', smeltInto: '烧炼成', use: '可以用来做' }[r.kind] + `　${this.rpage + 1}/${R.length}`, X, 50, '#FFD24A');
    if (r.kind === 'craft' || r.kind === 'use') {
      const rc = r.r;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        let id;
        if (rc.type === 'shaped') { const ch = rc.pattern[j] && rc.pattern[j][i]; id = ch && ch !== ' ' ? cyc(rc.keys[ch]) : undefined; }
        else { const k = j * 3 + i; id = rc.ing[k] ? cyc(rc.ing[k]) : undefined; }
        slot(id, X + i * 18, y0 + j * 18);
      }
      Font.draw(c, '→', X + 58, y0 + 22, '#FFFFFF');
      slot(rc.result, X + 72, y0 + 18); if (rc.count > 1) Font.draw(c, '×' + rc.count, X + 92, y0 + 22, '#FFFFFF');
    } else {
      slot(r.kind === 'smelt' ? r.from : this.sel, X, y0 + 18); Font.draw(c, '→ 熔炉 →', X + 22, y0 + 22, '#FFFFFF'); slot(r.kind === 'smelt' ? this.sel : r.to, X + 70, y0 + 18);
    }
    Font.draw(c, fitText('点格子里的物品可以查看它；带标签的格子会轮流显示能用的物品', W), X, y0 + 62, '#707070');
  }
}

// ---- the owner's quick switches in the room screen: keep inventory, day, clear weather, difficulty, PvP ----
(() => {
  // (one row of the player list gives way to the switches)
  RoomScreen.prototype.rows = function () { return Math.max(2, Math.floor((this.game.ui.h - 108 - 56 - (this.R && this.R.isOwner ? 22 : 0)) / 22)); };
  const lay = RoomScreen.prototype.layout;
  RoomScreen.prototype.layout = function () {
    lay.call(this);
    const R = this.R, g = this.game;
    if (!R || !R.isOwner) return;
    const u = g.ui, cx = u.w / 2, y = u.h - 76, cmd = (c, msg) => { g.net.chat(c); this.say(msg); };
    // (a game rule in all three dimensions: each has its own on the server - keep inventory was off in the Nether)
    const rule = (r, msg) => { for (const d of ['overworld', 'the_nether', 'the_end']) g.net.chat('/execute in minecraft:' + d + ' run gamerule ' + r); this.say(msg); };
    const S = this.quick || (this.quick = { keep: true, pvp: true, diff: 2 });
    const DF = ['peaceful', 'easy', 'normal', 'hard'], DN = ['和平', '简单', '普通', '困难'];
    this.widgets.push(
      { x: cx - 160, y, w: 62, h: 18, label: () => '死亡不掉落：' + (S.keep ? '开' : '关'), onClick: () => { S.keep = !S.keep; rule('keep_inventory ' + S.keep, S.keep ? '死亡不掉落：开' : '死亡不掉落：关'); } },
      { x: cx - 96, y, w: 40, h: 18, label: '白天', onClick: () => cmd('/time set day', '已经设成白天') },
      { x: cx - 54, y, w: 40, h: 18, label: '晴天', onClick: () => cmd('/weather clear', '已经放晴') },
      { x: cx - 12, y, w: 70, h: 18, label: () => '难度：' + DN[S.diff], onClick: () => { S.diff = (S.diff + 1) % 4; cmd('/difficulty ' + DF[S.diff], '难度：' + DN[S.diff]); } },
      { x: cx + 60, y, w: 50, h: 18, label: () => 'PVP：' + (S.pvp ? '开' : '关'), onClick: () => { S.pvp = !S.pvp; rule('pvp ' + S.pvp, S.pvp ? '玩家可以互相伤害' : '玩家不能互相伤害'); } },
    );
  };
})();

// ---- a photo: the picture without the HUD, with the game's name and a QR code, to share or keep ----
const Photo = {
  async take(g) {
    const ui = g.ui, hide = ui.hideHud;
    ui.hideHud = true; ui.screen = null;
    g.render(1, performance.now());
    const src = g.canvas, W = 960, H = Math.round(W * src.height / src.width);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H + 64;
    const x = cv.getContext('2d');
    x.drawImage(src, 0, 0, W, H);
    ui.hideHud = hide;
    // the card's strip: the game's name, who took it, the QR code to play
    x.fillStyle = '#1B1B1B'; x.fillRect(0, H, W, 64);
    x.fillStyle = '#FFFFFF'; x.font = 'bold 22px sans-serif'; x.fillText('OpusMC · 网页里的 Minecraft', 16, H + 30);
    x.fillStyle = '#A0A0A0'; x.font = '15px sans-serif'; x.fillText(((typeof Account !== 'undefined' && Account.name) || '') + ' 拍摄 · 在 B站 搜索 OpusMC 就能玩', 16, H + 52);
    try { const q = await Toy.qrCode('index.html', 120); if (q && q.base64) { const im = new Image(); await new Promise((r) => { im.onload = r; im.onerror = r; im.src = q.base64.startsWith('data:') ? q.base64 : 'data:image/png;base64,' + q.base64; }); x.fillStyle = '#FFFFFF'; x.fillRect(W - 62, H + 4, 56, 56); x.drawImage(im, W - 60, H + 6, 52, 52); } } catch (e) { }
    g.ui.open(new PhotoScreen(g, cv));
    Sound.ev && Sound.ev('ui.button.click', null, 1, 2);
  },
};
class PhotoScreen extends MenuScreen {
  constructor(game, cv) { super(game, null); this.cv = cv; this.pauses = !game.net; this.blurBg = false; this.bgDim = 0.6; this.note = ''; this.inToy = null; Toy.ready().then((v) => { this.inToy = v; if (this.game.ui.screen === this) this.layout(); }); }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 152, y: u.h - 26, w: 98, h: 20, gold: true, label: '分享', enabled: this.inToy === true, tip: this.inToy ? ['分享到 B站'] : ['在 B站 App 或网页里才能分享'], onClick: () => this.share() },
      { x: cx - 50, y: u.h - 26, w: 98, h: 20, label: '保存图片', onClick: () => this.save() },
      { x: cx + 52, y: u.h - 26, w: 100, h: 20, label: '关闭', onClick: () => this.game.ui.close() },
    ];
  }
  data() { return this.cv.toDataURL('image/jpeg', 0.88); }
  async share() { try { await Toy.sharePicture({ base64Data: this.data(), title: 'OpusMC 截图' }); this.note = '已打开分享'; Telemetry.count && Telemetry.count('photo_share'); } catch (e) { this.note = Toy.explain(e); } }
  async save() {
    if (this.inToy) { try { await Toy.saveImage({ base64Data: this.data() }); this.note = '已保存到相册'; return; } catch (e) { } }
    const a = document.createElement('a'); a.href = this.data(); a.download = 'OpusMC-' + Date.now() + '.jpg'; a.click(); this.note = '已下载';
  }
  drawExtra(ui) {
    const c = ui.ctx, W = ui.w - 40, H = Math.min(ui.h - 50, W * this.cv.height / this.cv.width), w = H * this.cv.width / this.cv.height;
    c.imageSmoothingEnabled = true; c.drawImage(this.cv, Math.round(ui.w / 2 - w / 2), 10, Math.round(w), Math.round(H)); c.imageSmoothingEnabled = false;
    if (this.note) Font.center(c, this.note, ui.w / 2, ui.h - 38, '#80FF80');
  }
  onEsc() { this.game.ui.close(); }
}

// ---- automatic quality: when even the lowest resolution can't keep up, see less far; back up when it can again ----
// (fewer pixels can't help a device held up by its CPU - DynRes.cpuBound: a phone like that never got to the lowest
// resolution and kept its render distance. The limit in effect - FramePacer.playLimit, 0 = the screen's rate. Not
// while AFK or under a pausing screen - those frames are held to 30 / 10 - nor for 2.5 s after: g.fps counts whole
// seconds)
(() => {
  let low = 0, good = 0, last = performance.now();
  setInterval(() => {
    const g = typeof game !== 'undefined' && game, s = g && g.settings, P = g && g.pacer;
    if (!g || !P || g.state !== 'play' || !s || s.autoQuality === false || !g.fps) { last = performance.now(); return; }
    const now = performance.now(), dt = now - last; last = now;
    if (P.afk || now - P.cappedT < 2500 || document.hidden) return;
    const target = Math.min(P.playLimit || 1000, P.hz, 60);
    const atMinRes = !s.dynRes || (typeof DynRes !== 'undefined' && (DynRes.scale <= 0.55 || DynRes.cpuBound));
    if (g.fps < target * 0.6 && atMinRes) { low += dt; good = 0; } else if (g.fps > target * 0.95) { good += dt; low = Math.max(0, low - dt); } else { low = Math.max(0, low - dt / 2); good = 0; }
    const base = s.autoDistBase || s.renderDist;
    if (low > 20000 && s.renderDist > 4) {
      s.autoDistBase = base; s.renderDist = Math.max(4, s.renderDist - 2); g.applySettings(); low = 0;
      g.ui.message(`画面有点卡：渲染距离自动降到 ${s.renderDist} 个区块（视频设置里可以关掉自动画质）`, '#FFAA00');
    } else if (good > 60000 && s.autoDistBase && s.renderDist < s.autoDistBase) {
      s.renderDist = Math.min(s.autoDistBase, s.renderDist + 2); g.applySettings(); good = 0;
      if (s.renderDist >= s.autoDistBase) delete s.autoDistBase;
      g.ui.message(`又流畅了：渲染距离回到 ${s.renderDist} 个区块`, '#AAAAAA');
    }
  }, 2000);
  // the switch, in the video settings
  const opts = OptionsListScreen.prototype.options;
  OptionsListScreen.prototype.options = function () {
    const list = opts.call(this);
    if (this.page !== 'video') return list;
    const s = this.game.settings, g = this.game;
    list.splice(1, 0, { label: () => '自动画质：' + (s.autoQuality === false ? '关' : '开'), tip: ['帧率长时间太低时自动降低渲染距离，流畅后再调回来'], onClick: () => { s.autoQuality = s.autoQuality === false; if (s.autoQuality === false && s.autoDistBase) { s.renderDist = s.autoDistBase; delete s.autoDistBase; g.applySettings(); } g.saveSettings(); } });
    return list;
  };
})();

// ---- play time, kept with the world and shown in the world list ----
(() => {
  const sw = Game.prototype.saveWorld;
  Game.prototype.saveWorld = async function (quiet) {
    if (this.worldMeta && this.state === 'play') { const now = performance.now(); this.worldMeta.playMs = (this.worldMeta.playMs || 0) + (now - (this.playFrom || now)); this.playFrom = now; }
    return sw.call(this, quiet);
  };
  const lw = Game.prototype.loadWorld;
  Game.prototype.loadWorld = function (...a) { this.playFrom = performance.now(); return lw.apply(this, a); };
  const de = WorldListScreen.prototype.drawExtra;
  WorldListScreen.prototype.drawExtra = function (ui) {
    de.call(this, ui);
    if (!this.worlds) return;
    const c = ui.ctx, cx = ui.w / 2, rowH = 36, x0 = Math.floor(cx - this.rowW / 2) + 2, top = this.listTop, bottom = this.listBottom, vis = Math.floor((bottom - top - 4) / rowH);
    c.save(); c.beginPath(); c.rect(0, top, ui.w, bottom - top); c.clip();
    this.shown().slice(this.scroll, this.scroll + vis + 1).forEach((w, i) => {
      if (!w.playMs) return;
      const m = Math.round(w.playMs / 60000), t = m < 60 ? `玩了 ${m} 分钟` : `玩了 ${Math.floor(m / 60)} 小时 ${m % 60} 分`;
      Font.draw(c, t, x0 + this.rowW - 8 - Font.width(t), top + 4 + i * rowH + 23, '#707070');
    });
    c.restore();
  };
})();

// ---- the title screen's scenes (UX_IDEAS.md 标题界面背景): chosen places, each with a time and weather; a small
// blurred picture of each, taken the first time it is shown, covers the moment before the world is built ----
const TITLE_SCENES = [
  { id: 'cherry', seed: '23', x: -312, z: -56, time: 1500 }, { id: 'birch', seed: '42', x: -312, z: -312, time: 3000 },
  { id: 'desert', seed: '11', x: -184, z: 136, time: 6000 }, { id: 'badlands', seed: '11', x: -312, z: -184, time: 11800 },
  { id: 'jungle', seed: '11', x: -120, z: 328, time: 4000, rain: true }, { id: 'flowers', seed: '100', x: 200, z: -184, time: 2500 },
  { id: 'meadow', seed: '77', x: 8, z: -312, time: 12300 }, { id: 'savanna', seed: '11', x: -312, z: 264, time: 11900 },
  { id: 'darkforest', seed: '42', x: -248, z: -248, time: 13200 }, { id: 'ocean', seed: '11', x: -184, z: -120, time: 5000 },
  { id: 'peaks', seed: '23', x: -120, z: 328, time: 23300 }, { id: 'slopes', seed: '23', x: -376, z: -120, time: 4500, rain: true },
  { id: 'stony', seed: '100', x: -120, z: -248, time: 18500 },
];
(() => {
  const thumbs = new Map();
  const thumbOf = (id) => { if (!thumbs.has(id)) { let im = null; try { const d = localStorage.getItem('mcjs-scene-' + id); if (d) { im = new Image(); im.src = d; } } catch (e) { } thumbs.set(id, im); } return thumbs.get(id); };
  const de = TitleScreen.prototype.drawExtra;
  TitleScreen.prototype.drawExtra = function (ui) {
    const g = this.game, S = g.titleScene;
    if (S) {
      if (!this.sceneT) this.sceneT = performance.now();
      const ready = !g.titleGround && g.world && g.world.chunks.size > 60, t = performance.now();
      if (ready && !this.readyT) this.readyT = t;
      const im = thumbOf(S.id), a = this.readyT ? Math.max(0, 1 - (t - this.readyT) / 1200) : 1;
      if (a > 0) {
        const c = ui.ctx; c.save(); c.globalAlpha = a;
        if (im && im.complete && im.naturalWidth) { c.imageSmoothingEnabled = true; c.drawImage(im, 0, 0, ui.w, ui.h); }
        else { c.fillStyle = '#0B0B12'; c.fillRect(0, 0, ui.w, ui.h); }
        c.restore();
      }
      // the picture for next time, a few seconds after the scene is up
      if (this.readyT && t - this.readyT > 5000 && !this.shot && !thumbOf(S.id)) {
        this.shot = true;
        try {
          g.ui.screen = null; g.render(1, t); g.ui.screen = this;
          const cv = document.createElement('canvas'); cv.width = 192; cv.height = Math.round(192 * g.canvas.height / g.canvas.width);
          const x = cv.getContext('2d'); x.filter = 'blur(2px)'; x.drawImage(g.canvas, 0, 0, cv.width, cv.height);
          localStorage.setItem('mcjs-scene-' + S.id, cv.toDataURL('image/jpeg', 0.7));
        } catch (e) { }
      }
    }
    return de.call(this, ui);
  };
})();

// ---- phones have no B / G / J / F2: the quick chat panel carries them ----
(() => {
  const lay = QuickChatScreen.prototype.layout;
  QuickChatScreen.prototype.layout = function () {
    lay.call(this);
    const u = this.game.ui, cx = u.w / 2, g = this.game, y = u.h - 52, w = 70;
    const tools = [
      [g.net ? '标记这里' : '加路标', () => { g.ui.close(); Marks.place(g); }],
      ['路标…', () => g.ui.open(new WaypointScreen(g))],
      ['物品图鉴', () => g.ui.open(new ItemDexScreen(g, null))],
      ['拍照', () => { g.ui.close(); setTimeout(() => Photo.take(g), 50); }],
    ];
    tools.forEach(([label, fn], i) => this.widgets.push({ x: cx - (tools.length * (w + 4)) / 2 + i * (w + 4), y, w, h: 20, label, onClick: fn }));
  };
})();
