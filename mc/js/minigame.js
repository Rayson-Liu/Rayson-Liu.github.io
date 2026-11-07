'use strict';
// ---------------------------------------------------------------------------
// The minigame server's displays (multiplayer/MINIGAME_PLAN.md), drawn as vanilla draws them: the sidebar (a
// scoreboard objective; the one for the player's team colour first), teams (prefix, suffix, colour of the names in
// the sidebar), titles and subtitles, boss bars; the tab list's header and footer are kept for the player list.
// The proxy (multiplayer/proxy/src/session.js) sends the texts as legacy strings: § and a colour code (§0-§f), §r
// back to the default, §#RRGGBB any other colour; formatting codes (bold, italic ...) are dropped.
// ---------------------------------------------------------------------------
const LEGACY_COL = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
const Legacy = {
  // the string in runs of one colour: [{ t, c }]
  runs(s, def = '#FFFFFF') {
    const out = []; let col = def, cur = '';
    s = String(s == null ? '' : s);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch !== '§' || i + 1 >= s.length) { cur += ch; continue; }
      let nc;
      const k = s[i + 1].toLowerCase();
      if (k === '#' && /^[0-9a-fA-F]{6}$/.test(s.substr(i + 2, 6))) { nc = '#' + s.substr(i + 2, 6).toUpperCase(); i += 7; }
      else { i++; if (LEGACY_COL[k]) nc = LEGACY_COL[k]; else if (k === 'r') nc = def; else continue; }
      if (cur) out.push({ t: cur, c: col });
      cur = ''; col = nc;
    }
    if (cur) out.push({ t: cur, c: col });
    return out;
  },
  strip(s) { return String(s == null ? '' : s).replace(/§(#[0-9a-fA-F]{6}|.)/g, ''); },
  width(s) { return Font.width(this.strip(s)); },
  first(s, def = '#FFFFFF') { const r = this.runs(s, def); return r.length ? r[0].c : def; },
  draw(ctx, s, x, y, def = '#FFFFFF', shadow = true) { for (const r of this.runs(s, def)) x = Font.draw(ctx, r.t, x, y, r.c, shadow); return x; },
  center(ctx, s, cx, y, def, shadow) { this.draw(ctx, s, Math.round(cx - this.width(s) / 2), y, def, shadow); },
};

// ---- what the server set up, per connection ----
const MG = {
  types: new Set(['sbo', 'sbd', 'sbs', 'sbr', 'team', 'title', 'boss', 'tabhf']),
  BOSS_COL: ['#EC00B8', '#00B7EC', '#EC3500', '#1DEC00', '#E8EC00', '#7B00EC', '#ECECEC'],
  reset(g) {
    g.mg = { obj: new Map(), scores: new Map(), slots: [], teams: new Map(), who: new Map(), title: null, times: [10, 70, 20], sub: '', boss: new Map(), tab: null };
    return g.mg;
  },
  st(g) { return g.mg || this.reset(g); },
  on(g, m) {
    const S = this.st(g);
    switch (m.t) {
      // objectives: 0 made, 1 removed, 2 changed
      case 'sbo':
        if (m.a === 1) { S.obj.delete(m.name); S.scores.delete(m.name); for (let i = 0; i < S.slots.length; i++) if (S.slots[i] === m.name) S.slots[i] = null; }
        else S.obj.set(m.name, { title: m.title || '', blank: !!m.blank });
        break;
      // display slots: 0 the player list, 1 the sidebar, 2 below names, 3-18 the sidebar for a team colour
      case 'sbd': S.slots[m.pos] = m.name || null; break;
      case 'sbs': {
        let t = S.scores.get(m.obj); if (!t) S.scores.set(m.obj, (t = new Map()));
        t.set(m.k, { v: m.v, d: m.d, blank: !!m.blank });
        break;
      }
      case 'sbr':
        if (m.obj) { const t = S.scores.get(m.obj); if (t) t.delete(m.k); }
        else for (const t of S.scores.values()) t.delete(m.k);
        break;
      // teams: add, remove, change (colour, prefix, suffix), join, leave
      case 'team': {
        if (m.mode === 'remove') { const tm = S.teams.get(m.team); if (tm) for (const p of tm.players) S.who.delete(p); S.teams.delete(m.team); break; }
        let tm = S.teams.get(m.team);
        if (!tm) S.teams.set(m.team, (tm = { color: 15, pre: '', suf: '', tags: 'always', players: new Set() }));
        if (m.mode === 'add' || m.mode === 'change') { if (m.color !== undefined) tm.color = m.color; if (m.pre !== undefined) tm.pre = m.pre; if (m.suf !== undefined) tm.suf = m.suf; if (m.tags) tm.tags = m.tags; }
        if (m.mode === 'add' || m.mode === 'join') for (const p of m.players || []) { const old = S.teams.get(S.who.get(p)); if (old && old !== tm) old.players.delete(p); tm.players.add(p); S.who.set(p, m.team); }
        if (m.mode === 'leave') for (const p of m.players || []) { tm.players.delete(p); if (S.who.get(p) === m.team) S.who.delete(p); }
        break;
      }
      // titles: a title starts showing (with the subtitle set before it); the times are in ticks
      case 'title':
        if (m.clear) { S.title = null; if (m.reset) { S.sub = ''; S.times = [10, 70, 20]; } break; }
        if (m.time) { S.times = m.time.map((x) => Math.max(0, x | 0)); if (S.title) S.title.t0 = performance.now(); }
        if (m.sub !== undefined) { S.sub = m.sub; if (S.title) S.title.sub = m.sub; }
        if (m.title !== undefined) S.title = { text: m.title, sub: S.sub, t0: performance.now(), times: S.times.slice() };
        break;
      // boss bars: 0 add, 1 remove, 2 health, 3 title, 4 style, 5 flags
      case 'boss': {
        if (m.a === 1) { S.boss.delete(m.id); break; }
        let b = S.boss.get(m.id);
        if (!b) { if (m.a !== 0) break; S.boss.set(m.id, (b = { title: '', hp: 1, color: 0 })); }
        if (m.title !== undefined) b.title = m.title;
        if (m.hp !== undefined) b.hp = Math.max(0, Math.min(1, m.hp));
        if (m.color !== undefined) b.color = m.color;
        break;
      }
      case 'tabhf': S.tab = { h: m.h || '', f: m.f || '' }; break;
    }
  },
  // the team colour as a legacy code (formatting 0-15)
  teamCode(tm) { return tm && tm.color >= 0 && tm.color < 16 ? '§' + tm.color.toString(16) : ''; },
  // the name a score holder shows as: the display name the server gave, or the name in its team's colour with the
  // team's prefix and suffix (plugins write long sidebar lines this way)
  holder(S, k, sc) {
    if (sc && sc.d) return sc.d;
    const tm = S.teams.get(S.who.get(k));
    return tm ? tm.pre + this.teamCode(tm) + k + '§r' + tm.suf : k;
  },
  // the sidebar's objective: the one for the player's team colour, else slot 1
  sidebar(g, S) {
    const me = g.net && g.net.name, tm = me && S.teams.get(S.who.get(me));
    if (tm && tm.color >= 0 && tm.color < 16 && S.slots[3 + tm.color] && S.obj.has(S.slots[3 + tm.color])) return S.slots[3 + tm.color];
    return S.slots[1] && S.obj.has(S.slots[1]) ? S.slots[1] : null;
  },

  draw(ui) {
    const g = ui.game; if (!g.net || !g.mg || g.state !== 'play') return;
    const S = g.mg, c = ui.ctx, W = ui.w, H = ui.h, sf = ui.safe ? ui.safe() : { t: 0, r: 0, b: 0, l: 0 };
    // ---- boss bars: top centre, 19 px each ----
    let by = 2 + sf.t;
    for (const b of S.boss.values()) {
      if (by > H / 3) break;
      Legacy.center(c, b.title, W / 2, by, '#FFFFFF');
      const bw = 182, bx = Math.round(W / 2 - bw / 2), col = this.BOSS_COL[b.color] || this.BOSS_COL[6];
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(bx, by + 10, bw, 5);
      c.fillStyle = col; c.globalAlpha = 0.35; c.fillRect(bx, by + 10, bw, 5); c.globalAlpha = 1;
      c.fillStyle = col; c.fillRect(bx, by + 10, Math.round(bw * b.hp), 5);
      by += 19;
    }
    // ---- the sidebar: the right edge, the middle ----
    const name = this.sidebar(g, S);
    if (name) {
      const o = S.obj.get(name), t = S.scores.get(name);
      const rows = t ? [...t.entries()].filter(([k]) => !k.startsWith('#')).sort((a, b) => b[1].v - a[1].v || (a[0] < b[0] ? -1 : 1)).slice(0, 15) : [];
      const lines = rows.map(([k, sc]) => ({ text: this.holder(S, k, sc), num: o.blank || sc.blank ? '' : String(sc.v) }));
      let w = Legacy.width(o.title);
      for (const l of lines) w = Math.max(w, Legacy.width(l.text) + (l.num ? Font.width(l.num) + 8 : 0));
      const n = lines.length, x1 = W - 1 - sf.r, x0 = x1 - w - 4, bottom = Math.round(H / 2 + (n * 9) / 3);
      const top = bottom - n * 9;
      c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(x0, top - 10, x1 - x0, 10);
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x0, top, x1 - x0, n * 9);
      Legacy.center(c, o.title, (x0 + x1) / 2, top - 9, '#FFFFFF', false);
      lines.forEach((l, i) => {
        const y = top + i * 9;
        Legacy.draw(c, l.text, x0 + 2, y, '#FFFFFF', false);
        if (l.num) Font.draw(c, l.num, x1 - 1 - Font.width(l.num), y, '#FF5555', false);
      });
    }
    // ---- the title and subtitle: in the middle, 4x and 2x (smaller where they would not fit) ----
    const T = S.title;
    if (T) {
      const [fi, st, fo] = T.times.map((x) => x * 50), age = performance.now() - T.t0, end = fi + st + fo;
      if (age > end) S.title = null;
      else {
        const a = age < fi ? age / Math.max(1, fi) : age > fi + st ? 1 - (age - fi - st) / Math.max(1, fo) : 1;
        c.save(); c.globalAlpha = Math.max(0.05, Math.min(1, a));
        const tw = Legacy.width(T.text), k = Math.max(1, Math.min(4, (W - 16) / Math.max(1, tw)));
        c.translate(W / 2, H / 2); c.scale(k, k); Legacy.center(c, T.text, 0, -10, '#FFFFFF'); c.restore();
        if (T.sub) {
          c.save(); c.globalAlpha = Math.max(0.05, Math.min(1, a));
          const sw = Legacy.width(T.sub), k2 = Math.max(1, Math.min(2, (W - 16) / Math.max(1, sw)));
          c.translate(W / 2, H / 2); c.scale(k2, k2); Legacy.center(c, T.sub, 0, 5, '#FFFFFF'); c.restore();
        }
      }
    }
  },
};

(() => {
  // the messages: these here, the rest as before; a new connection starts empty
  const om = NetClient.prototype.onMessage;
  NetClient.prototype.onMessage = function (m) {
    if (m && MG.types.has(m.t)) { try { MG.on(this.g, m); } catch (e) { console.error('minigame', e); } return; }
    if (m && m.t === 'login') MG.reset(this.g);
    return om.call(this, m);
  };
  // drawn over the HUD (after the safe area's shift: these keep clear of it themselves)
  const dh = UI.prototype.drawHUD;
  UI.prototype.drawHUD = function (...a) {
    const r = dh.apply(this, a);
    try { MG.draw(this); } catch (e) { console.error('minigame draw', e); }
    return r;
  };
})();
