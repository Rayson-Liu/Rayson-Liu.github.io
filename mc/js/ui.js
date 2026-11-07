'use strict';
// ---------------------------------------------------------------------------
// 2D UI (HUD, inventories, menus) drawn on an overlay canvas in GUI pixels
// ---------------------------------------------------------------------------
// Text uses the vanilla font (ascii.png + Unifont, tools/build_font.py -> font.js): a 16 px glyph atlas drawn
// at half size, so Latin letters land on whole GUI pixels and CJK on half pixels, like vanilla's
// Unifont. Each (string, colour) pair is rendered once into a small cached canvas.
const Font = {
  img: null, atlas: null, index: new Map(), adv: null, cache: new Map(),
  // colour emoji (emoji.js: the AI companion's set, 2026-11-01): drawn as pictures over the tinted text; ZWJ and
  // variation selectors take no room
  emo: null, emoImg: null, noEmo: false,
  init(img) {
    this.img = img;
    const F = window.FONT_MC;
    if (!F) return;
    for (let i = 0; i < F.chars.length; ) { const cp = F.chars.codePointAt(i), ch = String.fromCodePoint(cp); this.index.set(ch, this.index.size); i += ch.length; }
    this.adv = F.adv.slice();
    if (this.index.has(' ')) this.adv[this.index.get(' ')] = 8; // vanilla space is 4 GUI px
    const im = new Image(); im.onload = () => { this.atlas = im; this.cache.clear(); }; im.src = F.img;
    const E = window.EMOJI;
    if (E) { this.emo = new Map([...E.chars].map((c, i) => [c, i])); const ei = new Image(); ei.onload = () => { this.emoImg = ei; this.cache.clear(); }; ei.src = E.src; }
  },
  charW(c) {
    if (c === '\uFE0F' || c === '\u200D' || c === '\uFE0E') return 0;
    if (this.emo && this.emo.has(c)) return 9;
    const i = this.index.get(c);
    return i !== undefined ? this.adv[i] / 2 : (c.charCodeAt(0) < 128 ? 6 : 9);
  },
  width(str) { let w = 0; for (const c of String(str)) w += this.charW(c); return w; },
  // the string rendered at atlas scale (16 px tall), tinted
  render(str, color) {
    const key = color + (this.noEmo ? '\u0001' : '\u0000') + str;
    let cv = this.cache.get(key);
    if (cv) { this.cache.delete(key); this.cache.set(key, cv); return cv; }
    const F = window.FONT_MC, cell = F.cell, cols = F.cols;
    const w = Math.max(1, Math.ceil(this.width(str) * 2) + 2);
    cv = document.createElement('canvas'); cv.width = w; cv.height = cell;
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = false;
    let px = 0; const emo = [];
    for (const c of String(str)) {
      if (this.charW(c) === 0) continue;
      if (this.emo && this.emo.has(c)) { emo.push([this.emo.get(c), px]); px += this.charW(c) * 2; continue; }
      const i = this.index.get(c);
      if (i !== undefined) x.drawImage(this.atlas, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell, px, 0, cell, cell);
      else { x.fillStyle = '#fff'; x.font = '16px sans-serif'; x.textBaseline = 'alphabetic'; x.fillText(c, px, F.ascent); }
      px += this.charW(c) * 2;
    }
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, w, cell);
    // (the emoji in colour, over the tint; not in the shadow)
    if (emo.length && !this.noEmo && this.emoImg) {
      const E = window.EMOJI, es = E.size; x.globalCompositeOperation = 'source-over'; x.imageSmoothingEnabled = true;
      for (const [k, ex] of emo) x.drawImage(this.emoImg, (k % E.cols) * es, Math.floor(k / E.cols) * es, es, es, ex + 1, 0, cell - 1, cell - 1);
    }
    this.cache.set(key, cv);
    if (this.cache.size > 800) this.cache.delete(this.cache.keys().next().value);
    return cv;
  },
  drawRaw(ctx, str, x, y, color) {
    str = String(str);
    if (!str) return x;
    if (!this.atlas) return x + this.width(str);
    const cv = this.render(str, color);
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, x, y, cv.width / 2, cv.height / 2);
    return x + this.width(str);
  },
  draw(ctx, str, x, y, color = '#FFFFFF', shadow = true) {
    if (shadow) { this.noEmo = true; this.drawRaw(ctx, str, x + 1, y + 1, shade(color)); this.noEmo = false; }
    return this.drawRaw(ctx, str, x, y, color);
  },
  center(ctx, str, cx, y, color, shadow = true) { this.draw(ctx, str, Math.round(cx - this.width(str) / 2), y, color, shadow); },
};
function shade(c) {
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return '#' + [r >> 2, g >> 2, b >> 2].map(v => v.toString(16).padStart(2, '0')).join('');
}
// an item icon scaled smoothly (a block drawn in 3D) or in whole pixels (flat items, crosses)
const iconSmooth = (id) => { const def = ITEMS[id]; return !!(def && def.block && !def.flat && BLOCKS[id] && BLOCKS[id].shape !== SH_CROSS); };
// the shining buttons' colours (UI.goldShine): [normal, hover] pairs; glint is an rgba() prefix
const SHINE_GOLD = { top: ['rgba(246,205,80,0.9)', 'rgba(255,226,120,0.92)'], bottom: ['rgba(190,132,24,0.9)', 'rgba(214,160,40,0.92)'],
  light: 'rgba(255,248,210,0.55)', dark: 'rgba(110,70,0,0.55)', glint: 'rgba(255,255,220,', edge: ['#E8B830', '#FFF2B0'] };
const SHINE_BLUE = { top: ['rgba(96,176,255,0.92)', 'rgba(130,200,255,0.94)'], bottom: ['rgba(30,96,226,0.92)', 'rgba(50,120,240,0.94)'],
  light: 'rgba(214,236,255,0.6)', dark: 'rgba(0,36,110,0.55)', glint: 'rgba(230,246,255,', edge: ['#4AA8FF', '#D2EAFF'] };

// ---------------------------------------------------------------------------
class UI {
  constructor(game, canvas) {
    this.game = game; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.scale = 2; this.w = 320; this.h = 240;
    this.mouse = { x: 0, y: 0, down: false, button: -1 };
    this.screen = null; this.cursor = null;
    this.chat = []; this.toasts = []; this.subs = [];
    Sound.onPlay = (ev, pos, vol) => this.hearSound(ev, pos, vol);
    this.itemNameT = 0; this.lastSel = -1;
    this.debug = false; this.hideHud = false;
    this.input = document.getElementById('textinput');
    this.drag = null;
  }
  get img() { return this.game.renderer.images; }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr); this.canvas.height = Math.floor(window.innerHeight * dpr);
    const auto = Math.max(1, Math.min(Math.floor(this.canvas.width / 320), Math.floor(this.canvas.height / 240)));
    const pref = this.game.settings.guiScale;
    this.scale = pref ? Math.min(pref * dpr, auto) : Math.min(auto, Math.round(3 * dpr));
    this.scale = Math.max(1, Math.floor(this.scale));
    this.w = Math.ceil(this.canvas.width / this.scale); this.h = Math.ceil(this.canvas.height / this.scale);
    this.dpr = dpr;
    if (this.screen && this.screen.layout) this.screen.layout();
  }
  toGui(ev) { const r = this.canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * this.dpr / this.scale, (ev.clientY - r.top) * this.dpr / this.scale]; }

  open(screen) {
    if (this.screen && this.screen.close) this.screen.close();
    this.screen = screen;
    this.hideInput();
    if (screen) { if (screen.layout) screen.layout(); if (!screen.keepPointer) this.game.releasePointer(); }
  }
  close() {
    if (this.screen && this.screen.close) this.screen.close();
    this.screen = null;
    if (this.cursor) { this.returnStack(this.cursor); this.cursor = null; }
    this.hideInput();
    this.game.capturePointer();
  }
  returnStack(s) {
    const left = this.game.player.inv.add(s);
    if (left) this.game.dropFromPlayer({ ...s, count: left });
  }
  // the items an open screen holds for now (the stack on the pointer, a crafting grid, a station's own slots): they
  // go back to the inventory when it closes - a save meanwhile counts them in, so leaving the game with items in the
  // crafting table no longer loses them (feedback 2026-11-02 「往工作台里放东西后退出重进，物品会消失」)
  pendingStacks() {
    const s = this.screen, out = [];
    if (this.cursor) out.push(this.cursor);
    if (s && Array.isArray(s.grid)) for (const x of s.grid) if (x) out.push(x);
    if (s && Array.isArray(s.held)) for (const x of s.held) if (x) out.push(x);
    return out;
  }

  message(text, color = '#FFFFFF') { this.chat.push({ text, color, t: performance.now() }); if (this.chat.length > 100) this.chat.shift(); }
  // a line held on the chat's bottom row for ms (shown even with the chat closed; what comes meanwhile goes above
  // it), then an ordinary message that scrolls up and fades like the rest (the room service's sponsor line)
  pinMessage(text, ms, color = '#FFAA00') { this.pinned = { text, color, until: performance.now() + ms }; }
  toast(title, sub, iconId) { this.toasts.push({ title, sub, icon: iconId, t: performance.now() }); Sound.toast(); }

  // ---- primitives ---------------------------------------------------------------
  sprite(name, x, y, w, h, sx = 0, sy = 0, sw, sh) {
    const im = this.img[name];
    this.ctx.drawImage(im, sx, sy, sw ?? (w ?? im.width), sh ?? (h ?? im.height), x, y, w ?? im.width, h ?? im.height);
  }
  nine(name, x, y, w, h, border) {
    const im = this.img[name], c = this.ctx, iw = im.width, ih = im.height, b = border;
    c.drawImage(im, 0, 0, b, b, x, y, b, b); c.drawImage(im, iw - b, 0, b, b, x + w - b, y, b, b);
    c.drawImage(im, 0, ih - b, b, b, x, y + h - b, b, b); c.drawImage(im, iw - b, ih - b, b, b, x + w - b, y + h - b, b, b);
    c.drawImage(im, b, 0, iw - 2 * b, b, x + b, y, w - 2 * b, b); c.drawImage(im, b, ih - b, iw - 2 * b, b, x + b, y + h - b, w - 2 * b, b);
    c.drawImage(im, 0, b, b, ih - 2 * b, x, y + b, b, h - 2 * b); c.drawImage(im, iw - b, b, b, ih - 2 * b, x + w - b, y + b, b, h - 2 * b);
    c.drawImage(im, b, b, iw - 2 * b, ih - 2 * b, x + b, y + b, w - 2 * b, h - 2 * b);
  }
  drawItem(stack, x, y, opts = {}) {
    if (!stack) return;
    const r = this.game.renderer, c = this.ctx;
    const id = stack.id, def = ITEMS[id];
    c.imageSmoothingEnabled = iconSmooth(id);
    c.imageSmoothingQuality = 'high';
    // an item this game doesn't have (on a server; or an id not in ITEMS at all - telemetry 11-02/03, tooltips and the
    // held item's name threw on one, every frame): the missing texture
    if (stack.unk || !def) {
      c.fillStyle = '#000'; c.fillRect(x, y, 16, 16); c.fillStyle = '#F800F8'; c.fillRect(x, y, 8, 8); c.fillRect(x + 8, y + 8, 8, 8);
    } else if (stackTinted(stack) && r.stackIcon(id, stack)) c.drawImage(r.stackIcon(id, stack), x, y, 16, 16);
    else if (typeof itemStateTex === 'function' && itemStateTex(stack, this.game.player)) c.drawImage(r.tileIcon(itemStateTex(stack, this.game.player)), x, y, 16, 16);
    else c.drawImage(this.itemIcon(id), x, y, 16, 16);
    c.imageSmoothingEnabled = false; c.imageSmoothingQuality = 'low';
    if (def && (stack.g || (stack.g !== false && ((stack.e && stack.e.length) || def.glint)))) this.drawGlint(stack, x, y);
    if (def && def.durability && stack.dmg > 0) {
      const f = 1 - stack.dmg / def.durability;
      c.fillStyle = '#000'; c.fillRect(x + 2, y + 13, 13, 2);
      c.fillStyle = `hsl(${Math.round(f * 120)},100%,50%)`; c.fillRect(x + 2, y + 13, Math.round(13 * f), 1);
    }
    if (stack.count > 1 || opts.showCount) {
      const t = String(stack.count);
      Font.draw(c, t, x + 17 - Font.width(t), y + 9, '#FFFFFF');
    }
  }
  // an item's icon as a small canvas of its own (copied once from the icon atlas, most recently used kept).
  // Drawn straight from the atlas (2048x3200, filled with putImageData) every slot of every frame, the browser
  // had to upload the whole atlas to the GPU again each time its GPU copy was dropped from the canvas cache -
  // which, once it happened (after a while, often on opening a menu), held the game at 7-8 fps until a reload.
  // Made at the size it is shown (16 GUI px: 48 device px on most phones, never over the atlas's 64), scaled once the
  // way drawItem scaled it each frame, and enough of them kept for every item: 600 of 64x64 churned through the
  // creative tabs - going through them all a second time still made 2838 canvases (4.1 ms a frame), now none
  // (0.20 ms a frame); all 1578 kept at 48 px are 13.9 MB, the 600 at 64 px were 9.4 (11-03)
  itemIcon(id) {
    const r = this.game.renderer, S = r.iconSize, D = Math.min(S, 16 * this.scale);
    if (this.iconsOf !== r.iconAtlas || this.iconD !== D) { this.iconsOf = r.iconAtlas; this.iconD = D; this.icons = new Map(); }
    const cache = this.icons;
    let cv = cache.get(id);
    if (cv) { cache.delete(id); cache.set(id, cv); return cv; }
    cv = document.createElement('canvas'); cv.width = cv.height = D;
    const k = cv.getContext('2d');
    if (D === S) k.drawImage(r.iconAtlas, ...r.iconXY(id), S, S, 0, 0, S, S);
    else { k.imageSmoothingEnabled = iconSmooth(id); k.imageSmoothingQuality = 'high'; k.drawImage(this.iconCopy(id), 0, 0, S, S, 0, 0, D, D); }
    cache.set(id, cv);
    if (cache.size > 2048) cache.delete(cache.keys().next().value);
    return cv;
  }
  // the item's 64 px picture copied out of the atlas into one canvas kept for it, to be scaled from there: the same
  // picture to the bit as before (scaled straight out of the 2048x3200 atlas, 75 flat icons came out a pixel off at
  // their edges and 1032 block icons up to 29/255 apart - the texel picked on the half-pixel steps of 64 -> 48 px, 11-04)
  iconCopy(id) {
    const r = this.game.renderer, S = r.iconSize, cv = this.iconTmp || (this.iconTmp = document.createElement('canvas'));
    if (cv.width !== S || cv.height !== S) cv.width = cv.height = S;
    const k = cv.getContext('2d'); k.clearRect(0, 0, S, S); k.drawImage(r.iconAtlas, ...r.iconXY(id), S, S, 0, 0, S, S);
    return cv;
  }
  // the enchantment glint: the icon's shape tinted purple, pulsing (its shape from the 64 px picture, once per item)
  drawGlint(stack, x, y) {
    const r = this.game.renderer, S = r.iconSize, id = stack.id, cache = this.glints || (this.glints = new Map());
    let cv = cache.get(id);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = cv.height = 16;
      const k = cv.getContext('2d');
      k.drawImage(this.iconCopy(id), 0, 0, S, S, 0, 0, 16, 16);
      k.globalCompositeOperation = 'source-atop'; k.fillStyle = '#A050FF'; k.fillRect(0, 0, 16, 16);
      cache.set(id, cv);
    }
    const c = this.ctx;
    c.globalAlpha = 0.25 + 0.2 * Math.sin(performance.now() / 400 + x * 0.05);
    c.drawImage(cv, x, y); c.globalAlpha = 1;
  }
  tooltip(lines, x, y) {
    const c = this.ctx;
    let w = 0; for (const l of lines) w = Math.max(w, Font.width(l.text));
    const h = lines.length * 10 + (lines.length > 1 ? 2 : 0) - 2;
    let tx = x + 12, ty = y - 12;
    if (tx + w + 4 > this.w) tx = x - w - 16;
    if (ty + h + 6 > this.h) ty = this.h - h - 6;
    c.fillStyle = 'rgba(16,0,16,0.94)';
    c.fillRect(tx - 3, ty - 4, w + 6, h + 8); c.fillRect(tx - 4, ty - 3, w + 8, h + 6);
    c.fillStyle = 'rgba(80,0,255,0.32)'; c.fillRect(tx - 3, ty - 3, w + 6, 1); c.fillRect(tx - 3, ty + h + 2, w + 6, 1);
    c.fillRect(tx - 3, ty - 3, 1, h + 6); c.fillRect(tx + w + 2, ty - 3, 1, h + 6);
    let yy = ty;
    lines.forEach((l, i) => { Font.draw(c, l.text, tx, yy, l.color || '#FFFFFF'); yy += i === 0 ? 12 : 10; });
  }
  // a slot's tooltip: an id not in ITEMS (telemetry 11-02/03: 'rarity' of undefined) only gets these - the itemLines
  // wrappers of other files read ITEMS[id] too
  tipLines(stack) { return ITEMS[stack.id] || stack.unk ? this.itemLines(stack) : this.unknownLines(stack); }
  unknownLines(stack) { return [{ text: '未知物品', color: '#FFFFFF' }, { text: '#' + stack.id, color: '#555555' }]; }
  itemLines(stack) {
    if (stack.unk) return netItemLines(stack, [{ text: '未知物品', color: '#FFFFFF' }, { text: 'minecraft:' + stack.unk, color: '#555555' }]);
    const d = ITEMS[stack.id];
    if (!d) return this.unknownLines(stack);
    const R = ['common', 'uncommon', 'rare', 'epic'], ri = Math.max(0, R.indexOf(d.rarity || 'common')), rr = stack.e && stack.e.length ? (ri < 2 ? 2 : 3) : ri;
    const lines = [{ text: d.cn, color: ['#FFFFFF', '#FFFF55', '#55FFFF', '#FF55FF'][rr] }];
    if (stack.trim && typeof TRIM_CN !== 'undefined') {
      // vanilla: the armour trim under the name, in the material's colour
      const col = TRIM_COLOR[stack.trim.material] || '#AAAAAA';
      lines.push({ text: '已有升级：', color: '#AAAAAA' }, { text: ' ' + (TRIM_PATTERN_CN[stack.trim.pattern] || stack.trim.pattern) + '盔甲纹饰', color: col }, { text: ' ' + (TRIM_CN[stack.trim.material] || stack.trim.material), color: col });
    }
    if (d.food) lines.push({ text: `食物: +${d.food[0]} 饥饿值`, color: '#AAAAAA' });
    if (d.tool) lines.push({ text: `攻击伤害: ${d.attack}`, color: '#00AA00' });
    else if (d.attack) lines.push({ text: `攻击伤害: ${d.attack}`, color: '#00AA00' });
    if (d.armor && d.armor.points) lines.push({ text: `护甲值: +${d.armor.points}`, color: '#5555FF' });
    if (d.armor && d.armor.tough) lines.push({ text: `盔甲韧性: +${d.armor.tough}`, color: '#5555FF' });
    if (d.durability) lines.push({ text: `耐久度: ${d.durability - (stack.dmg || 0)} / ${d.durability}`, color: '#AAAAAA' });
    if (fuelValue(stack.id)) lines.push({ text: `燃料: ${(fuelValue(stack.id) / 200).toFixed(1)} 个物品`, color: '#777777' });
    if (this.game.settings.advTooltips) lines.push({ text: 'minecraft:' + d.key, color: '#555555' });
    if (stack.name || stack.e || stack.pot || stack.lore) netItemLines(stack, lines); // a server's stack (net.js)
    if (stack.pot && !this.game.net) { const i = lines.findIndex((l, k) => k > 0 && (l.color === '#5555FF' || l.color === '#AAAAAA')); if (i > 0) lines.splice(i, 1); potionLines(stack, lines); }
    return lines;
  }
  button(b) {
    const hover = this.hit(b) && b.enabled !== false;
    this.nine(b.enabled === false ? 'button_dis' : hover ? 'button_hl' : 'button', b.x, b.y, b.w, b.h, 3);
    // (goldFrom: a button turning gold - fades in over 0.7 s, the old label fading out before the new one comes)
    const c = this.ctx, k = b.goldFrom ? Math.min(1, (performance.now() - b.goldFrom) / 700) : 1;
    if ((b.gold || b.glowBlue) && b.enabled !== false) { c.save(); c.globalAlpha = k; this.goldShine(b, hover); c.restore(); }
    // (blue: the way into your own room)
    if (b.blue && b.enabled !== false) { c.fillStyle = hover ? 'rgba(80,140,255,0.6)' : 'rgba(40,90,220,0.55)'; c.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); }
    if (b.icon) { const im = this.img[b.icon]; if (im) c.drawImage(im, Math.floor(b.x + (b.w - im.width) / 2), Math.floor(b.y + (b.h - im.height) / 2)); return; }
    const col = b.enabled === false ? '#A0A0A0' : b.color || '#FFFFFF', ty = b.y + (b.h - 8) / 2;
    if (k < 1 && b.fromLabel) {
      c.save(); c.globalAlpha = k < 0.5 ? 1 - 2 * k : 2 * k - 1;
      Font.center(c, k < 0.5 ? b.fromLabel : typeof b.label === 'function' ? b.label() : b.label, b.x + b.w / 2, ty, col);
      c.restore(); return;
    }
    Font.center(c, typeof b.label === 'function' ? b.label() : b.label, b.x + b.w / 2, ty, col);
  }
  // the few buttons that matter most (log in, unlock, skins, invite): gold, with a glint sweeping across every few
  // seconds like an enchantment's (UX_IDEAS.md 界面风格). glowBlue: the same in bright blue (触控设置, the user 2026-11-03)
  goldShine(b, hover) {
    const c = this.ctx, t = performance.now() / 1000, P = b.glowBlue ? SHINE_BLUE : SHINE_GOLD, h = hover ? 1 : 0;
    c.save();
    c.beginPath(); c.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); c.clip();
    const gr = c.createLinearGradient(0, b.y, 0, b.y + b.h);
    gr.addColorStop(0, P.top[h]); gr.addColorStop(1, P.bottom[h]);
    c.fillStyle = gr; c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = P.light; c.fillRect(b.x + 1, b.y + 1, b.w - 2, 1);
    c.fillStyle = P.dark; c.fillRect(b.x + 1, b.y + b.h - 2, b.w - 2, 1);
    // the glint: a slanted band crossing in 0.7 s, every 3 s (buttons a little apart in time)
    const ph = ((t + (b.x + b.y) * 0.003) % 3) / 0.7;
    if (ph < 1) {
      const x = b.x - 20 + (b.w + 40) * ph, g = c.createLinearGradient(x - 14, 0, x + 14, 0);
      g.addColorStop(0, P.glint + '0)'); g.addColorStop(0.5, P.glint + '0.55)'); g.addColorStop(1, P.glint + '0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(x - 10, b.y + b.h); c.lineTo(x + 2, b.y); c.lineTo(x + 18, b.y); c.lineTo(x + 6, b.y + b.h); c.fill();
    }
    c.restore();
    c.strokeStyle = P.edge[h]; c.lineWidth = 1; c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  }
  slider(s) {
    this.nine('slider', s.x, s.y, s.w, s.h, 2);
    const hx = s.x + Math.round(s.value * (s.w - 8));
    this.nine(this.hit(s) ? 'slider_handle_hl' : 'slider_handle', hx, s.y, 8, s.h, 2);
    Font.center(this.ctx, s.label(), s.x + s.w / 2, s.y + (s.h - 8) / 2, '#FFFFFF');
  }
  // vanilla 1.20.5+ menu backgrounds: the world blurred behind a translucent tile; inworld_* variants while playing
  tile(name, x, y, w, h) { this.tiled(this.img[name], name, x, y, w, h); }
  // a texture repeated over a rectangle (from its top left), filled with a pattern once into a canvas of that size
  // and copied from then on. Pattern fills straight on the screen, frame after frame each time a menu opened, left
  // the browser's GPU side slower for good after some 40 openings (the whole game at 70 fps instead of 180 until
  // a reload, measured 2026-10-29); copying a finished canvas does not
  tiled(img, key, x, y, w, h) {
    if (w <= 0 || h <= 0 || !img) return;
    const s = this.scale, W = Math.ceil(w * s), H = Math.ceil(h * s), k = key + '|' + W + 'x' + H + '|' + s;
    const cache = this.tileCache || (this.tileCache = new Map());
    let cv = cache.get(k);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x2 = cv.getContext('2d'); x2.imageSmoothingEnabled = false; x2.scale(s, s);
      x2.fillStyle = x2.createPattern(img, 'repeat'); x2.fillRect(0, 0, w, h);
      cache.set(k, cv);
      if (cache.size > 32) cache.delete(cache.keys().next().value);
    }
    const c = this.ctx, sm = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false; c.drawImage(cv, 0, 0, W, H, x, y, W / s, H / s); c.imageSmoothingEnabled = sm;
  }
  sepName(kind) { return (this.game.state === 'play' ? 'inworld_' : '') + kind + '_sep'; }
  menuBackground() { this.wantBlur = true; this.tile(this.game.state === 'play' ? 'options_bg' : 'menu_bg', 0, 0, this.w, this.h); }
  listBackground(top, bottom) {
    this.tile(this.game.state === 'play' ? 'inworld_list_bg' : 'menu_list_bg', 0, top, this.w, bottom - top);
    this.tile(this.sepName('header'), 0, top - 2, this.w, 2);
    this.tile(this.sepName('footer'), 0, bottom, this.w, 2);
  }
  hit(r, mx = this.mouse.x, my = this.mouse.y) { return mx >= r.x && my >= r.y && mx < r.x + r.w && my < r.y + r.h; }
  dim(a = 0.55) { this.ctx.fillStyle = `rgba(16,16,16,${a})`; this.ctx.fillRect(0, 0, this.w, this.h); }
  showInput(x, y, w, h, value, onEnter, opts = {}) {
    const el = this.input, s = this.scale / this.dpr;
    this.inputBox = { x, y, w, h, t0: performance.now() };
    el.style.display = 'block';
    el.style.left = (x * s) + 'px'; el.style.top = (y * s) + 'px'; el.style.width = (w * s) + 'px'; el.style.height = (h * s) + 'px';
    // (the field's own text is invisible - drawInputText draws it. On a touch screen at least 16px: iPhones zoom the
    // whole page in on a field with smaller text when it is focused)
    el.style.fontSize = Math.max(navigator.maxTouchPoints > 0 ? 16 : 12, (h - 6) * s) + 'px';
    el.value = value || ''; el.maxLength = opts.max || 100; el.enterKeyHint = opts.enter || 'done';
    // (Esc in a field: marked as held, as main.js does for the window's keys - the field keeps its keys to itself - so a
    // screen it closes takes the mouse lock back only when the key comes up. Taken while it was down, the browser read
    // the same Esc as leaving the lock and opened the pause menu: chat open + Esc did that, feedback 2026-11-01 14:13)
    el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') onEnter(el.value); if (e.key === 'Escape') { if (!e.repeat) this.game.escHeld = performance.now(); if (opts.onEsc) opts.onEsc(); } };
    el.oninput = () => { if (opts.onInput) opts.onInput(el.value); };
    // after a touch the field waits for its own tap, so the on-screen keyboard doesn't pop up uninvited
    // (not again when it already has the focus: a layout on every resize - the keyboard's own - focused it once more)
    if (!(this.lastTouch && performance.now() - this.lastTouch < 2000) && document.activeElement !== el) setTimeout(() => el.focus(), 0);
  }
  hideInput() { this.input.style.display = 'none'; this.input.onkeydown = null; this.input.blur(); this.inputBox = null; }
  // vanilla-style text field contents: pixel font, scrolled to keep the caret visible, blinking caret
  drawInputText() {
    const b = this.inputBox, el = this.input;
    if (!b || el.style.display === 'none') return;
    const c = this.ctx, v = el.value, caret = el.selectionStart ?? v.length;
    const ty = b.y + Math.floor((b.h - 8) / 2), maxW = b.w - 6;
    let start = 0;
    while (start < caret && Font.width(v.slice(start, caret)) > maxW) start++;
    let end = start;
    while (end < v.length && Font.width(v.slice(start, end + 1)) <= maxW) end++;
    Font.draw(c, v.slice(start, end), b.x + 2, ty, '#E0E0E0');
    if (Math.floor((performance.now() - b.t0) / 300) % 2 === 0) {
      const cx = b.x + 2 + Font.width(v.slice(start, caret));
      if (caret >= v.length) Font.draw(c, '_', cx, ty, '#E0E0E0');
      else { c.fillStyle = '#D0D0D0'; c.fillRect(cx, ty - 1, 1, 10); }
    }
  }

  // ---- HUD ---------------------------------------------------------------------------
  drawHUD() {
    const g = this.game, p = g.player, c = this.ctx, W = this.w, H = this.h;
    if (this.hideHud) return;
    drawEffectIcons(this, p);
    // crosshair (inverted)
    if (!this.screen && g.perspective === 0 && !g.hideCrosshair) { // (hideCrosshair: a caller hiding it for a frame)
      c.globalCompositeOperation = 'difference';
      this.sprite('crosshair', Math.floor(W / 2 - 7.5), Math.floor(H / 2 - 7.5));
      // vanilla attack indicator: cool-down bar, or the full icon when aiming at a mob with a slow weapon
      const str = g.attackStrength(0), x = Math.floor(W / 2 - 8), y = Math.floor(H / 2 - 7 + 16);
      if (str < 1 && this.img.attack_bg) {
        this.sprite('attack_bg', x, y);
        const w = Math.floor(str * 17);
        if (w > 0) c.drawImage(this.img.attack_progress, 0, 0, w, 4, x, y, w, 4);
      } else if (g.targetEntity && 20 / g.attackSpeed() > 5 && this.img.attack_full) this.sprite('attack_full', x, y);
      c.globalCompositeOperation = 'source-over';
    }
    const hx = Math.floor(W / 2 - 91), hy = H - 22;
    if (g.mode === 'spectator') return;
    this.sprite('hotbar', hx, hy);
    this.sprite('hotbar_sel', hx - 1 + p.inv.sel * 20, hy - 1);
    for (let i = 0; i < 9; i++) this.drawItem(p.inv.slots[i], hx + 3 + i * 20, hy + 3);
    if (p.inv.slots[40]) { this.sprite('hotbar_offhand_left', hx - 29, hy - 1); this.drawItem(p.inv.slots[40], hx - 26, hy + 3); }
    if (!p.creative) {
      // xp bar
      const xb = H - 29, jm = p.vehicle && (p.vehicle.jumpStr || p.vehicle.dashCd !== undefined) ? p.vehicle : null;
      const lvl = g.xpLevel(), need = g.xpNeeded(lvl), prog = (p.xp - g.xpTotalFor(lvl)) / need;
      if (jm && this.img.jump_bar_bg) {
        // riding a horse: the jump bar (a camel's dash cooldown greys it out)
        this.sprite('jump_bar_bg', hx, xb);
        if (jm.dashCd > 0) this.sprite('jump_bar_cooldown', hx, xb);
        else { const jw = Math.floor(182 * clamp(jm.jumpCharge || 0, 0, 1)); if (jw > 0) c.drawImage(this.img.jump_bar_progress, 0, 0, jw, 5, hx, xb, jw, 5); }
      } else {
        this.sprite('xp_bg', hx, xb);
        const pw = Math.floor(182 * clamp(prog, 0, 1));
        if (pw > 0) c.drawImage(this.img.xp_fg, 0, 0, pw, 5, hx, xb, pw, 5);
      }
      if (lvl > 0) { const t = String(lvl), tx = Math.floor(W / 2 - Font.width(t) / 2); for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) Font.drawRaw(c, t, tx + ox, xb - 6 + oy, '#000000'); Font.drawRaw(c, t, tx, xb - 6, '#80FF20'); }
      // hearts
      const hy2 = H - 39;
      // vanilla: on damage the containers blink for 20 ticks and the lost health shows as white hearts
      const hp = Math.ceil(p.health), now = performance.now();
      if (this.lastHealth === undefined) { this.lastHealth = hp; this.displayHealth = hp; }
      if (hp < this.lastHealth && p.invuln > 0) { this.lastHealthT = now; this.blinkUntil = g.tickCount + 20; }
      else if (hp > this.lastHealth && p.invuln > 0) { this.lastHealthT = now; this.blinkUntil = g.tickCount + 10; }
      if (now - (this.lastHealthT || 0) > 1000) this.displayHealth = hp;
      this.lastHealth = hp;
      const blink = this.blinkUntil > g.tickCount && ((this.blinkUntil - g.tickCount) / 3 | 0) % 2 === 1;
      // vanilla: health boost and absorption add hearts in rows of 10 (rows squeeze together when there are many),
      // poison / wither / freezing change the hearts, absorption ones are golden, regeneration ripples along them
      const maxHp = Math.max(p.maxHealth || 20, hp), abs = Math.ceil(p.absorption || 0);
      const nMax = Math.ceil(maxHp / 2), nAbs = Math.ceil(abs / 2), rows = Math.ceil((maxHp + abs) / 20), rowH = Math.max(10 - (rows - 2), 3);
      const hc = g.hardcore, H_ = hc ? 'hardcore_' : '';
      const kind = p.hasEffect && p.hasEffect('poison') ? 'poisoned_' : p.hasEffect && p.hasEffect('wither') ? 'withered_' : (p.frozenT || 0) >= 140 ? 'frozen_' : '';
      const low = p.health + abs <= 4;
      const regen = p.hasEffect && p.hasEffect('regeneration') ? g.tickCount % Math.ceil(maxHp + 5) : -1;
      let absLeft = abs;
      for (let i = nMax + nAbs - 1; i >= 0; i--) {
        const x = hx + (i % 10) * 8;
        let y = hy2 - Math.floor(i / 10) * rowH;
        if (low) y += Math.round(Math.sin(g.tickCount * 1.7 + i * 3.1) * 1);
        if (i === regen) y -= 2;
        this.sprite(hc ? (blink ? 'heart_container_hc_blink' : 'heart_container_hc') : (blink ? 'heart_container_blink' : 'heart_container'), x, y);
        if (i >= nMax) {
          // absorption hearts (withered when withering), filled from the last one down
          const half = absLeft === abs && abs % 2 === 1;
          absLeft -= half ? 1 : 2;
          this.sprite('heart_' + (kind === 'withered_' ? 'withered_' : 'absorbing_') + H_ + (half ? 'half' : 'full'), x, y);
          continue;
        }
        if (blink && i * 2 < this.displayHealth) {
          const f = this.displayHealth - i * 2 >= 2 ? 'full' : 'half';
          this.sprite(kind ? 'heart_' + kind + H_ + f + '_blinking' : (hc ? 'heart_hc_' : 'heart_') + f + '_blink', x, y);
        }
        const hpv = hp - i * 2;
        if (hpv >= 1) {
          const f = hpv >= 2 ? 'full' : 'half';
          this.sprite(kind ? 'heart_' + kind + H_ + f : (hc ? 'heart_hc_' : 'heart_') + f, x, y);
        }
      }
      // armor (above all the heart rows)
      const ap = p.inv.armorPoints(), ay = hy2 - (rows - 1) * rowH - 10;
      if (ap > 0) for (let i = 0; i < 10; i++) {
        const v = ap - i * 2;
        this.sprite(v >= 2 ? 'armor_full' : v >= 1 ? 'armor_half' : 'armor_empty', hx + i * 8, ay);
      }
      // food (riding a living mount: its hearts instead, in rows of 10, and the jump bar over the experience bar)
      const mount = p.vehicle && p.vehicle.maxHealth ? p.vehicle : null;
      if (mount) {
        const mh = Math.ceil(mount.maxHealth / 2);
        for (let i = 0; i < Math.min(mh, 30); i++) {
          const x = hx + 182 - 9 - (i % 10) * 8, y = hy2 - Math.floor(i / 10) * 10, v = Math.ceil(mount.health) - i * 2;
          this.sprite('heart_vehicle_container', x, y);
          if (v >= 2) this.sprite('heart_vehicle_full', x, y); else if (v >= 1) this.sprite('heart_vehicle_half', x, y);
        }
      }
      if (!mount) for (let i = 0; i < 10; i++) {
        const x = hx + 182 - 9 - i * 8;
        let y = hy2;
        if (p.saturation <= 0 && g.tickCount % (p.food * 3 + 1) === 0) y += Math.round(Math.random() * 2 - 1);
        const hu = p.hasEffect && p.hasEffect('hunger') ? '_hunger' : '';
        this.sprite('food_empty' + hu, x, y);
        const fv = p.food - i * 2;
        if (fv >= 2) this.sprite('food_full' + hu, x, y); else if (fv >= 1) this.sprite('food_half' + hu, x, y);
      }
      // air
      if (p.eyeInWater || p.air < 300) {
        const bubbles = Math.ceil((p.air - 2) * 10 / 300), full = Math.ceil(p.air * 10 / 300) - bubbles;
        for (let i = 0; i < 10; i++) {
          const x = hx + 182 - 9 - i * 8;
          if (i < bubbles) this.sprite('air', x, hy2 - 10);
          else if (i < bubbles + full && p.air > 0) this.sprite('air_bursting', x, hy2 - 10);
        }
      }
    }
    // held item name
    if (p.inv.sel !== this.lastSel) { this.lastSel = p.inv.sel; this.itemNameT = performance.now(); }
    const held = p.inv.held, hd = held && ITEMS[held.id];
    const dt = performance.now() - this.itemNameT;
    if (hd && dt < 2500) {
      const a = dt > 2000 ? 1 - (dt - 2000) / 500 : 1;
      c.globalAlpha = a;
      Font.center(c, hd.cn || hd.key, W / 2, H - (p.creative ? 38 : 58), '#FFFFFF');
      c.globalAlpha = 1;
    }
    // action bar message
    if (this.actionBar && performance.now() - this.actionBar.t < 2500) Font.center(c, this.actionBar.text, W / 2, H - (p.creative ? 50 : 70), this.actionBar.color || '#FFFFFF');
    // boss bars (vanilla BossHealthOverlay): the dragon's (pink), the raids' (red, in tenths), one under another
    const bars = [];
    const dr = g.dragon && g.dragon();
    if (dr) bars.push({ name: '末影龙', progress: dr.health / dr.maxHealth, color: 'pink' });
    if (g.raidBars) bars.push(...g.raidBars());
    bars.forEach((b, i) => {
      const bx = Math.floor(W / 2 - 91), by = 12 + i * 19, bg = b.color === 'red' ? 'boss_red_bg' : 'boss_bg', fg = b.color === 'red' ? 'boss_red_fg' : 'boss_fg';
      Font.center(c, b.name, W / 2, by - 9, '#FFFFFF');
      this.sprite(bg, bx, by);
      if (b.notch === 10 && this.img.boss_n10_bg) this.sprite('boss_n10_bg', bx, by);
      const pw = Math.ceil(182 * clamp(b.progress, 0, 1));
      if (pw > 0) {
        c.drawImage(this.img[fg], 0, 0, pw, 5, bx, by, pw, 5);
        if (b.notch === 10 && this.img.boss_n10_fg) c.drawImage(this.img.boss_n10_fg, 0, 0, pw, 5, bx, by, pw, 5);
      }
    });
    this.drawChat();
    this.drawSubtitles();
    this.drawToasts();
    if (this.debug) this.drawDebug();
    if (g.sleepFade > 0) { c.fillStyle = `rgba(10,10,20,${g.sleepFade})`; c.fillRect(0, 0, W, H); }
    // the mouse isn't captured (just joined a world, or capturing again after a screen closed failed): the pause
    // menu, like vanilla when the window loses focus - its "back to game" click captures the mouse. A short grace
    // for a capture still in flight; g.noLockPause (scripted tests, which never get the lock) keeps playing instead
    // closed with Esc, though, the browser refuses the lock (a key press is no "user gesture" for it): a line asking
    // for a click instead of the same menu coming straight back (Mac, players' feedback 2026-10-31). Nor while the Esc
    // that closed a screen is still down (escCapture: the lock is asked for when it comes up, main.js) - held past the
    // grace, the pause menu opened anyway: chat + Esc did that, feedback 2026-11-01 14:13
    const unlocked = document.pointerLockElement !== g.canvas, escWait = g.escCapture && g.escHeld && performance.now() - g.escHeld < 1500;
    if (g.clickToResume && (!unlocked || this.screen || g.state !== 'play')) g.clickToResume = 0;
    if (g.clickToResume && !touchOn(g) && !g.lockFails) {
      const t = '点击画面继续游戏', tw = Font.width(t);
      c.globalAlpha = 0.6; c.fillStyle = '#000'; c.fillRect(Math.floor(W / 2 - tw / 2 - 6), Math.floor(H / 2) + 14, tw + 12, 14); c.globalAlpha = 1;
      Font.center(c, t, W / 2, Math.floor(H / 2) + 17, '#FFFFFF');
    } else if (!this.screen && g.state === 'play' && unlocked && !g.debugPause && !touchOn(g) && !g.noLockPause && !g.lockFails && !escWait) {
      const now = performance.now();
      if (!this.unlockedAt) this.unlockedAt = now;
      else if (now - this.unlockedAt > 250) { this.unlockedAt = 0; this.open(new PauseScreen(g)); }
    } else this.unlockedAt = 0;
  }
  drawChat() {
    const c = this.ctx, now = performance.now(), open = this.screen && this.screen.isChat;
    let y = this.h - 48 - (this.touch ? this.touch.chatLift() : 0);
    const pin = this.pinned;
    if (pin && now >= pin.until) { this.pinned = null; this.message(pin.text, pin.color); }
    else if (pin) {
      c.globalAlpha = 0.5; c.fillStyle = '#000'; c.fillRect(2, y - 1, 320, 10); c.globalAlpha = 1;
      Font.draw(c, pin.text, 4, y, pin.color);
      y -= 10;
    }
    const off = open ? Math.min(this.chatOff || 0, Math.max(0, this.chat.length - 20)) : 0, n = open ? (this.pinned ? 19 : 20) : (this.pinned ? 9 : 10);
    const list = this.chat.slice(Math.max(0, this.chat.length - off - n), this.chat.length - off);
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i], age = now - m.t;
      if (!open && age > 10000) continue;
      const a = open ? 1 : clamp((10000 - age) / 1000, 0, 1);
      c.globalAlpha = a * 0.5; c.fillStyle = '#000'; c.fillRect(2, y - 1, 320, 10); c.globalAlpha = a;
      if (m.parts) { let x = 4; for (const [t, col] of m.parts) { Font.draw(c, t, x, y, col); x += Font.width(t); } } // (an administrator's coloured name)
      else Font.draw(c, m.text, 4, y, m.color);
      c.globalAlpha = 1;
      y -= 10;
    }
  }
  // subtitles (vanilla SubtitleOverlay): the sounds heard in the last 3 seconds, each where it was last heard - an
  // arrow on the side it comes from when it's off to a side, the text greying as it gets older
  hearSound(ev, pos, vol) {
    const g = this.game;
    if (!g.settings.subtitles || !self.SUBTITLES || !SUBTITLES[ev]) return;
    const L = Sound.listener;
    if (pos && Math.hypot(pos[0] - L.x, pos[1] - L.y, pos[2] - L.z) > Math.max(16, 16 * vol)) return;
    const text = SUBTITLES[ev], s = this.subs.find(e => e.text === text);
    if (s) { s.pos = pos; s.t = performance.now(); } else this.subs.push({ text, pos, t: performance.now() });
  }
  drawSubtitles() {
    const g = this.game, now = performance.now();
    if (!g.settings.subtitles || g.state !== 'play') { this.subs.length = 0; return; }
    this.subs = this.subs.filter(s => now - s.t < 3000);
    if (!this.subs.length) return;
    const c = this.ctx, L = Sound.listener, lw = Font.width('<'), sw = Font.width(' ');
    const k = Math.max(...this.subs.map(s => Font.width(s.text))) + lw * 2 + sw * 2;
    this.subs.forEach((s, i) => {
      const cx = this.w - k / 2 - 2, cy = this.h - 35 - i * 10, f = Math.round(255 - (now - s.t) / 3000 * 180);
      const col = `rgb(${f},${f},${f})`;
      c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(Math.round(cx - k / 2 - 1), cy - 5, k + 2, 10);
      Font.draw(c, s.text, Math.round(cx - Font.width(s.text) / 2), cy - 4, col, false);
      if (!s.pos) return;
      const dx = s.pos[0] - L.x, dz = s.pos[2] - L.z, d = Math.hypot(dx, s.pos[1] - L.y, dz);
      const right = d > 0.5 ? (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d : 0;
      if (right > 0.5) Font.draw(c, '>', Math.round(cx + k / 2 - lw), cy - 4, col, false);
      else if (right < -0.5) Font.draw(c, '<', Math.round(cx - k / 2), cy - 4, col, false);
    });
  }
  drawToasts() {
    const c = this.ctx, now = performance.now();
    const g = this.game;
    if (g.state === 'play' && g.tutorial >= 0 && g.mode === 'survival' && !this.toasts.length && !this.debug) {
      // with touch controls the toast sits below the pause / chat buttons
      const st = TUTORIAL[g.tutorial], x = this.w - 160, ty = this.touch ? this.touch.topInset() : 0, touch = touchOn(g);
      this.sprite('toast', x, ty);
      this.drawItem({ id: item(st.icon), count: 1 }, x + 8, ty + 8);
      Font.draw(c, st.title, x + 30, ty + 7, '#55FFFF', false);
      Font.draw(c, touch && st.touch || st.text, x + 30, ty + 18, '#FFFFFF', false);
    }
    this.toasts = this.toasts.filter(t => now - t.t < 5500);
    let y = this.touch ? this.touch.topInset() : 0;
    for (const t of this.toasts) {
      const age = now - t.t;
      if (age > 5000 && !t.out) { t.out = true; Sound.ev('ui.toast.out', null, 1, 1); }
      const slide = age < 400 ? 1 - age / 400 : age > 5000 ? (age - 5000) / 500 : 0;
      const x = this.w - 160 + Math.round(slide * 160);
      this.sprite('toast', x, y);
      if (t.icon) this.drawItem({ id: t.icon, count: 1 }, x + 8, y + 8);
      Font.draw(c, t.title, x + 30, y + 7, '#FFFF00', false);
      Font.draw(c, t.sub, x + 30, y + 18, '#FFFFFF', false);
      y += 32;
    }
  }
  drawDebug() {
    const g = this.game, p = g.player, c = this.ctx;
    const x = Math.floor(p.pos[0]), y = Math.floor(p.pos[1]), z = Math.floor(p.pos[2]);
    const dirs = ['南 (+Z)', '西 (-X)', '北 (-Z)', '东 (+X)'];
    let yaw = ((-p.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180;
    const facing = dirs[Math.round(((yaw + 180) % 360) / 90) % 4];
    const ch = g.world.getChunk(x >> 4, z >> 4);
    const bi = ch ? BIOMES[ch.biome[((z & 15) << 4) | (x & 15)]] : '?';
    const l = g.world.getLight(x, y, z);
    const t = g.dayTime();
    const L = [
      `OpusMC (26.2 官方材质)`,
      `${g.fps} fps  区段: ${g.renderer.stats ? g.renderer.stats.sections : 0}  三角形: ${g.renderer.stats ? g.renderer.stats.tris : 0}` + (typeof DynRes !== 'undefined' && g.settings.dynRes ? `  渲染比例: ${Math.round(DynRes.scale * 100)}%` : ''),
      `区块: 已加载 ${g.world.chunks.size}  待生成 ${g.genQueueLen || 0}  实体: ${g.entities.length}  粒子: ${g.particles.list.length}`,
      ``,
      `XYZ: ${p.pos[0].toFixed(3)} / ${(p.pos[1] + (g.world.minY || 0)).toFixed(3)} / ${p.pos[2].toFixed(3)}`,
      `方块: ${x} ${y + (g.world.minY || 0)} ${z}   区块: ${x >> 4} ${z >> 4}`,
      `朝向: ${facing} (${yaw.toFixed(1)} / ${(p.pitch * 180 / Math.PI).toFixed(1)})`,
      `生物群系: ${bi}`,
      `光照: 天空 ${l >> 4}  方块 ${l & 15}`,
      `时间: 第 ${Math.floor(g.worldTime / 24000) + 1} 天  ${String(Math.floor((t / 1000 + 6) % 24)).padStart(2, '0')}:${String(Math.floor((t % 1000) * 0.06)).padStart(2, '0')}`,
      `种子: ${g.world.seed}   维度: ${DIM_CN[g.dim] || g.dim}`,
    ];
    if (g.target) { const b = BLOCKS[g.world.getBlock(...g.target.pos)]; L.push(`目标方块: minecraft:${b ? b.key : '?'} (${g.target.pos[0]}, ${g.target.pos[1] + (g.world.minY || 0)}, ${g.target.pos[2]})`); }
    let yy = 2;
    for (const s of L) { if (s) { const w = Font.width(s); c.fillStyle = 'rgba(80,80,80,0.55)'; c.fillRect(1, yy - 1, w + 2, 10); Font.draw(c, s, 2, yy, '#E0E0E0', false); } yy += 10; }
    // right column (like vanilla's): performance and memory; frame-time graph at the bottom
    PerfMon.gpuOn = true;
    // a narrow screen has no room for two columns side by side: the second goes below the first
    yy = this.w < 560 ? yy + 6 : 2;
    for (const l of PerfMon.lines(g)) {
      const s = typeof l === 'string' ? l : l.text, col = typeof l === 'string' ? '#E0E0E0' : l.color;
      if (s) { const w = Font.width(s), x0 = this.w - w - 2; c.fillStyle = 'rgba(80,80,80,0.55)'; c.fillRect(x0 - 1, yy - 1, w + 2, 10); Font.draw(c, s, x0, yy, col, false); }
      yy += 10;
    }
    PerfMon.drawGraph(c, 2, this.h - 2, Math.min(240, Math.floor(this.w / 2) - 4), 60, g);
  }

  // ---- frame ------------------------------------------------------------------------------
  draw() {
    const c = this.ctx;
    // (a page with no size - an app web view in the background or a frame folded away: the vignette copy, made the
    // canvas's size, could not be drawn - telemetry 11-02/03 'canvas element with a width or height of 0' - and there is
    // nothing to see anyway: nothing drawn until it has a size again, which resize() gives it)
    if (!this.canvas.width || !this.canvas.height) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    const g = this.game;
    if (g.state === 'play') {
      this.drawOverlays();
      this.drawHUD();
    }
    this.wantBlur = false;
    if (this.screen) this.screen.draw(this);
    if (typeof UnlockSparks !== 'undefined') UnlockSparks.draw(this); // (account.js: something just unlocked)
    if (this.wantBlur !== !!this.blurOn) {
      this.blurOn = this.wantBlur;
      const st = g.canvas.style;
      st.filter = this.blurOn ? 'blur(5px)' : ''; st.transform = this.blurOn ? 'scale(1.03)' : '';
    }
    this.drawInputText();
    if (this.touch) this.touch.draw(this);
    if (this.cursor) this.drawItem(this.cursor, this.mouse.x - 8, this.mouse.y - 8);
  }
  // the underwater tile at brightness q (0-1): black at 1 - q laid over it inside its own alpha, which is what the
  // brightness(q) filter did to it (at most 33 of 16x16 kept)
  waterTile(q) {
    const src = this.img.underwater;
    if (this.waterOf !== src) { this.waterOf = src; this.waterTiles = new Map(); }
    let cv = this.waterTiles.get(q);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const k = cv.getContext('2d'); k.drawImage(src, 0, 0);
      if (q < 1) { k.globalCompositeOperation = 'source-atop'; k.fillStyle = `rgba(0,0,0,${1 - q})`; k.fillRect(0, 0, cv.width, cv.height); }
      this.waterTiles.set(q, cv);
    }
    return cv;
  }
  drawOverlays() {
    const g = this.game, p = g.player, c = this.ctx, W = this.w, H = this.h;
    // vignette
    // vanilla darkens the screen by the texture's brightness (blend ZERO, ONE_MINUS_SRC_COLOR);
    // the UI canvas is transparent, so turn it into a black overlay with that brightness as alpha
    if (!this.vigCanvas && this.img.vignette && this.img.vignette.width) {
      const src = this.img.vignette, vc = document.createElement('canvas');
      vc.width = src.width; vc.height = src.height;
      const vx = vc.getContext('2d'); vx.drawImage(src, 0, 0);
      const id = vx.getImageData(0, 0, vc.width, vc.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 0; }
      vx.putImageData(id, 0, 0);
      this.vigCanvas = vc;
    }
    // scaled to the canvas once (at half strength) and then copied 1:1 each frame: stretching the 256 px texture
    // over the whole screen every frame is cheap only while the browser draws canvases on the GPU - when it falls
    // back to drawing them in software (it can, after a while, until the page reloads) it cost most of a frame
    const cw = this.canvas.width, chh = this.canvas.height;
    if (this.vigCanvas && (!this.vigFull || this.vigFull.width !== cw || this.vigFull.height !== chh)) {
      const vf = this.vigFull = document.createElement('canvas'); vf.width = cw; vf.height = chh;
      const fx = vf.getContext('2d'); fx.globalAlpha = 0.5; fx.imageSmoothingEnabled = true; fx.drawImage(this.vigCanvas, 0, 0, cw, chh);
    }
    if (this.vigFull) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.vigFull, 0, 0); c.restore(); }
    // under water: vanilla ScreenEffectRenderer.renderWater - underwater.png stretched four times across the
    // screen each way, at 10% and darkened by the light at the eyes, sliding 1/64 tile per degree of turning.
    // Darkened beforehand: the 16 px tile kept per brightness step (1/32: under 1/2 a level of the 10% overlay) - a
    // canvas filter made the browser draw each of the 25 tiles through an offscreen layer of its own
    if (g.headInWater && this.img.underwater) {
      const [sky, blk] = p.lightAt(), lv = Math.max(sky * g.daylight(), blk), br = lv / (4 - 3 * lv);
      const tw = W / 4, th = H / 4, D = 180 / Math.PI, im = this.waterTile(Math.round(br * 32) / 32);
      const ox = (((p.yaw * D / 64) % 1 + 1) % 1) * tw, oy = (((p.pitch * D / 64) % 1 + 1) % 1) * th;
      c.globalAlpha = 0.1; c.imageSmoothingEnabled = true;
      for (let x = ox - tw; x < W; x += tw) for (let y = oy - th; y < H; y += th) c.drawImage(im, x, y, tw, th);
      c.globalAlpha = 1; c.imageSmoothingEnabled = false;
    }
    if (g.headInLava) { c.fillStyle = 'rgba(200,60,0,0.75)'; c.fillRect(0, 0, W, H); }
    // freezing in powder snow: vanilla's frost round the edges of the view, as strong as how frozen (140 ticks = full)
    if ((p.frozenT || 0) > 0 && this.img.powder_snow_outline) {
      c.globalAlpha = Math.min(1, p.frozenT / 140); c.imageSmoothingEnabled = true;
      c.drawImage(this.img.powder_snow_outline, 0, 0, W, H);
      c.globalAlpha = 1; c.imageSmoothingEnabled = false;
    }
    // burning: two animated flames at the bottom corners of the view (vanilla screen fire)
    if (p.fire > 0 && !p.creative && !p.fireproof && g.perspective === 0 && !g.headInLava) {
      const r = g.renderer, base = T('fire_1'), frames = ANIM_FRAMES[base] || 1, layer = base + (Math.floor(g.worldTime / 2) % frames);
      const sz = Math.round(H * 0.62);
      c.globalAlpha = 0.9; c.imageSmoothingEnabled = false;
      for (const side of [-1, 1]) {
        c.save();
        c.translate(W / 2 + side * W * 0.27, H - sz * 0.32);
        c.transform(1, side * 0.08, 0, 1, 0, 0);
        if (side < 0) c.scale(-1, 1);
        c.drawImage(r.stripCanvas, ...r.tileXY(layer), 16, 16, -sz / 2, -sz / 2, sz, sz);
        c.restore();
      }
      c.globalAlpha = 1;
    }
    // the eyes in a block: its texture, dark (vanilla ScreenEffectRenderer) - not the caves and ores beyond it
    const wallId = g.perspective === 0 && !p.noClip && g.inWallBlock ? g.inWallBlock() : 0;
    if (wallId) {
      const r = g.renderer, b = BLOCKS[wallId], layer = b.particle ?? (Array.isArray(b.tex) ? b.tex[0] : b.tex);
      c.imageSmoothingEnabled = false;
      if (layer != null) c.drawImage(r.stripCanvas, ...r.tileXY(layer), 16, 16, 0, 0, W, H);
      c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(0, 0, W, H);
    }
    if (g.portalOverlay > 0) {
      const r = g.renderer, layer = T('nether_portal') + (Math.floor(performance.now() / 100) % 32);
      c.globalAlpha = Math.min(0.85, g.portalOverlay * 0.9); c.imageSmoothingEnabled = false;
      c.drawImage(r.stripCanvas, ...r.tileXY(layer), 16, 16, 0, 0, W, H);
      c.globalAlpha = 1;
    }
    if (p.fire > 0 && !p.creative && g.perspective === 0) {
      const r = g.renderer, layer = T('fire_0') + (g.tickCount % 32);
      c.globalAlpha = 0.85;
      const s = Math.min(W, H) * 0.45;
      c.drawImage(r.stripCanvas, ...r.tileXY(layer), 16, 16, W / 2 - s * 1.1, H - s * 0.75, s, s);
      c.drawImage(r.stripCanvas, ...r.tileXY(layer), 16, 16, W / 2 + s * 0.1, H - s * 0.75, s, s);
      c.globalAlpha = 1;
    }
    if (p.hurtTime > 0) { c.fillStyle = `rgba(160,0,0,${p.hurtTime / 10 * 0.25})`; c.fillRect(0, 0, W, H); }
    if (p.deathTime > 0) { const a = Math.min(0.6, p.deathTime / 40); const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, `rgba(80,0,0,${a})`); gr.addColorStop(1, `rgba(160,20,20,${a})`); c.fillStyle = gr; c.fillRect(0, 0, W, H); }
  }

  // ---- input routing -----------------------------------------------------------------------
  mouseMove(ev) {
    [this.mouse.x, this.mouse.y] = this.toGui(ev);
    if (this.screen && this.screen.mouseMove) this.screen.mouseMove(this, this.mouse.x, this.mouse.y);
  }
  mouseDown(ev) {
    [this.mouse.x, this.mouse.y] = this.toGui(ev);
    this.mouse.down = true; this.mouse.button = ev.button;
    if (this.screen && this.screen.mouseDown) this.screen.mouseDown(this, this.mouse.x, this.mouse.y, ev.button, ev.shiftKey);
  }
  mouseUp(ev) {
    [this.mouse.x, this.mouse.y] = this.toGui(ev);
    this.mouse.down = false;
    if (this.screen && this.screen.mouseUp) this.screen.mouseUp(this, this.mouse.x, this.mouse.y, ev.button);
  }
  wheel(dy) { if (this.screen && this.screen.wheel) this.screen.wheel(this, dy); }
  key(ev) { if (this.screen && this.screen.key) return this.screen.key(this, ev); return false; }
}

// ---------------------------------------------------------------------------
// Container screen base (slot handling, MC click semantics)
// ---------------------------------------------------------------------------
class ContainerScreen {
  constructor(game, bg, w, h, title) { this.game = game; this.bg = bg; this.gw = w; this.gh = h; this.title = title; this.slots = []; this.dragSlots = null; }
  layout() { const u = this.game.ui; this.x = Math.floor((u.w - this.gw) / 2); this.y = Math.floor((u.h - this.gh) / 2); }
  addPlayerSlots(y0, hotY) {
    const inv = this.game.player.inv;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
      const i = 9 + r * 9 + c;
      this.slots.push({ x: 8 + c * 18, y: y0 + r * 18, get: () => inv.slots[i], set: (s) => { inv.slots[i] = s; }, group: 'main', idx: i });
    }
    for (let c = 0; c < 9; c++) this.slots.push({ x: 8 + c * 18, y: hotY, get: () => inv.slots[c], set: (s) => { inv.slots[c] = s; }, group: 'hotbar', idx: c });
  }
  slotAt(mx, my) {
    for (const s of this.slots) if (mx >= this.x + s.x - 1 && mx < this.x + s.x + 17 && my >= this.y + s.y - 1 && my < this.y + s.y + 17) return s;
    return null;
  }
  drawBase(ui) {
    ui.dim(0.6);
    ui.ctx.drawImage(ui.img[this.bg], 0, 0, this.gw, this.gh, this.x, this.y, this.gw, this.gh);
    if (this.title) Font.draw(ui.ctx, this.title, this.x + (this.titleX ?? 8), this.y + 6, '#404040', false);
  }
  drawSlots(ui) {
    const hov = this.slotAt(ui.mouse.x, ui.mouse.y);
    for (const s of this.slots) {
      const st = s.get();
      if (!st && s.emptyIcon) { ui.ctx.globalAlpha = 0.6; ui.sprite(s.emptyIcon, this.x + s.x, this.y + s.y); ui.ctx.globalAlpha = 1; }
      ui.drawItem(st, this.x + s.x, this.y + s.y);
      if (s === hov || (this.dragSlots && this.dragSlots.has(s))) { ui.ctx.fillStyle = 'rgba(255,255,255,0.5)'; ui.ctx.fillRect(this.x + s.x, this.y + s.y, 16, 16); }
    }
    if (hov && hov.get() && !ui.cursor) ui.tooltip(ui.tipLines(hov.get()), ui.mouse.x, ui.mouse.y);
  }
  draw(ui) { this.drawBase(ui); this.drawExtra && this.drawExtra(ui); this.drawSlots(ui); }
  canPlace(s, st) { return !s.output && (!s.accept || s.accept(st)); }
  maxIn(s, st) { return Math.min(maxStack(st.id), s.max || 64); }
  mouseDown(ui, mx, my, button, shift) {
    const s = this.slotAt(mx, my);
    if (!s) {
      if (this.outside && this.outside(mx, my) && ui.cursor) {
        if (button === 0) { this.game.dropFromPlayer(ui.cursor); ui.cursor = null; }
        else if (button === 2) { this.game.dropFromPlayer({ ...ui.cursor, count: 1 }); ui.cursor.count--; if (!ui.cursor.count) ui.cursor = null; }
      }
      return;
    }
    Sound.init();
    // (a long press - the touch layer's right click - on a result takes all it can make: there is no shift on a phone)
    if (s.output) { this.takeOutput(ui, s, shift || (button === 2 && typeof touchOn === 'function' && touchOn(this.game))); return; }
    if (shift && button === 0) { this.quickMove(s); this.changed(); return; }
    const st = s.get(), now = performance.now();
    // double click (vanilla PICKUP_ALL): the stack just picked up from this slot, clicked again - the same items from
    // every other slot gathered onto it. (It used to take the remembered stack back as the cursor, which a quick
    // tap sequence could leave lying in a slot too: the same tool in two places - 「背包随便划拉一下就能复制物品」,
    // and a real double click never got there - 「电脑双击不能收集一组」, feedback 2026-11-02)
    if (button === 0 && ui.cursor && !st && this.lastClick && now - this.lastClick.t < 300 && this.lastClick.slot === s && this.lastClick.stack === ui.cursor) {
      const c = ui.cursor, ms = maxStack(c.id);
      if (!(ITEMS[c.id] && ITEMS[c.id].durability)) for (const o of this.slots) {
        if (o.output || c.count >= ms) continue;
        const os = o.get();
        if (os && os !== c && sameKind(os, c)) { const k = Math.min(os.count, ms - c.count); c.count += k; os.count -= k; if (!os.count) o.set(null); }
      }
      this.lastClick = null; this.changed(); return;
    }
    // start drag distribution
    if (ui.cursor && (button === 0 || button === 2) && (!st || sameKind(st, ui.cursor))) {
      this.dragSlots = new Set([s]); this.dragButton = button; this.dragStart = s;
    }
    if (this.dragSlots) return; // resolved on mouseUp
    this.clickSlot(ui, s, button);
    this.lastClick = { t: now, slot: s, stack: ui.cursor };
  }
  clickSlot(ui, s, button) {
    const st = s.get();
    if (s.armorSlot !== undefined && st && enchLevel(st, 'binding_curse') && !this.game.player.creative) return;
    if (button === 0) {
      if (!ui.cursor) { if (st) { ui.cursor = st; s.set(null); } }
      else if (!st) { if (this.canPlace(s, ui.cursor)) { const k = Math.min(ui.cursor.count, this.maxIn(s, ui.cursor)); s.set({ ...ui.cursor, count: k }); ui.cursor.count -= k; if (!ui.cursor.count) ui.cursor = null; } }
      else if (sameKind(st, ui.cursor) && !(ITEMS[st.id] && ITEMS[st.id].durability)) { const k = Math.min(ui.cursor.count, this.maxIn(s, st) - st.count); st.count += k; ui.cursor.count -= k; if (!ui.cursor.count) ui.cursor = null; }
      else if (this.canPlace(s, ui.cursor)) { s.set(ui.cursor); ui.cursor = st; }
    } else if (button === 2) {
      if (!ui.cursor) { if (st) { const k = Math.ceil(st.count / 2); ui.cursor = { ...st, count: k }; st.count -= k; if (!st.count) s.set(null); } }
      else if (!st) { if (this.canPlace(s, ui.cursor)) { s.set({ ...ui.cursor, count: 1 }); ui.cursor.count--; if (!ui.cursor.count) ui.cursor = null; } }
      else if (sameKind(st, ui.cursor) && st.count < this.maxIn(s, st)) { st.count++; ui.cursor.count--; if (!ui.cursor.count) ui.cursor = null; }
      else if (this.canPlace(s, ui.cursor)) { s.set(ui.cursor); ui.cursor = st; }
    }
    this.changed();
  }
  mouseMove(ui, mx, my) {
    if (this.dragSlots && ui.mouse.down && ui.cursor) {
      const s = this.slotAt(mx, my);
      if (s && !s.output && (!s.get() || sameKind(s.get(), ui.cursor)) && this.canPlace(s, ui.cursor) && this.dragSlots.size < ui.cursor.count + (this.dragButton === 2 ? 0 : 0)) this.dragSlots.add(s);
    }
  }
  mouseUp(ui, mx, my, button) {
    if (!this.dragSlots) return;
    const set = [...this.dragSlots]; this.dragSlots = null;
    if (set.length === 1) { this.clickSlot(ui, set[0], this.dragButton); return; }
    if (!ui.cursor) return;
    const per = this.dragButton === 2 ? 1 : Math.floor(ui.cursor.count / set.length);
    if (per < 1) return;
    for (const s of set) {
      if (!ui.cursor) break;
      const st = s.get();
      const room = this.maxIn(s, ui.cursor) - (st ? st.count : 0);
      const k = Math.min(per, room, ui.cursor.count);
      if (k <= 0) continue;
      if (st) st.count += k; else s.set({ ...ui.cursor, count: k });
      ui.cursor.count -= k; if (!ui.cursor.count) ui.cursor = null;
    }
    this.changed();
  }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    let targets;
    if (s.group === 'hotbar') targets = this.slots.filter(o => o.group === 'container').length ? this.slots.filter(o => o.group === 'container') : this.slots.filter(o => o.group === 'main');
    else if (s.group === 'main') targets = this.slots.filter(o => o.group === 'container').length ? this.slots.filter(o => o.group === 'container') : this.slots.filter(o => o.group === 'hotbar');
    else targets = this.slots.filter(o => o.group === 'hotbar' || o.group === 'main').sort((a, b) => (a.group === 'hotbar' ? 1 : 0) - (b.group === 'hotbar' ? 1 : 0)).reverse();
    if (ITEMS[st.id] && ITEMS[st.id].armor && (s.group === 'main' || s.group === 'hotbar')) {
      const a = this.slots.find(o => o.armorSlot === ITEMS[st.id].armor.slot && !o.get());
      if (a) { a.set(st); s.set(null); return; }
    }
    targets = targets.filter(t => this.canPlace(t, st));
    for (const t of targets) { const ts = t.get(); if (ts && sameKind(ts, st) && !(ITEMS[st.id] && ITEMS[st.id].durability)) { const k = Math.min(st.count, this.maxIn(t, st) - ts.count); ts.count += k; st.count -= k; if (!st.count) { s.set(null); return; } } }
    for (const t of targets) { if (!t.get()) { const k = Math.min(st.count, this.maxIn(t, st)); t.set({ ...st, count: k }); st.count -= k; if (!st.count) { s.set(null); return; } } }
  }
  takeOutput(ui, s, shift) {
    const st = s.get(); if (!st) return;
    if (shift) {
      let guard = 0;
      while (s.get() && guard++ < 64) {
        const out = s.get(), inv = this.game.player.inv;
        // only a result that fits whole: part of it put in, the rest refused, was a part had without paying
        let room = 0; const ms = maxStack(out.id);
        for (let i = 0; i < 36; i++) { const t = inv.slots[i]; room += !t ? ms : sameKind(t, out) && !ITEMS[t.id].durability ? Math.max(0, ms - t.count) : 0; }
        if (room < out.count) break;
        inv.add({ ...out });
        s.onTake(out);
        this.changed();
      }
      return;
    }
    if (!ui.cursor) { ui.cursor = { ...st }; s.onTake(st); }
    else if (sameKind(ui.cursor, st) && ui.cursor.count + st.count <= maxStack(st.id)) { ui.cursor.count += st.count; s.onTake(st); }
    this.changed();
  }
  key(ui, ev) {
    const k = ev.key;
    if (k >= '1' && k <= '9') {
      const s = this.slotAt(ui.mouse.x, ui.mouse.y);
      if (s && !s.output) {
        const inv = this.game.player.inv, i = +k - 1;
        const a = s.get(), b = inv.slots[i];
        if (!b || this.canPlace(s, b)) { s.set(b); inv.slots[i] = a; this.changed(); }
      }
      return true;
    }
    if (k === 'q' || k === 'Q') {
      const s = this.slotAt(ui.mouse.x, ui.mouse.y);
      if (s && s.get() && !s.output) { const st = s.get(); const n = ev.ctrlKey ? st.count : 1; this.game.dropFromPlayer({ ...st, count: n }); st.count -= n; if (!st.count) s.set(null); this.changed(); }
      return true;
    }
    return false;
  }
  outside(mx, my) { return mx < this.x || my < this.y || mx > this.x + this.gw || my > this.y + this.gh; }
  changed() { }
}

class CraftingScreen extends ContainerScreen {
  constructor(game, size) {
    const big = size === 3;
    super(game, big ? 'crafting_table' : 'inventory', 176, 166, big ? '合成' : null);
    this.size = size; this.grid = new Array(size * size).fill(null);
    if (big) this.titleX = 29; // vanilla CraftingScreen title position
    const ox = big ? 30 : 98, oy = big ? 17 : 18;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const i = r * size + c;
      this.slots.push({ x: ox + c * 18, y: oy + r * 18, get: () => this.grid[i], set: (s) => { this.grid[i] = s; }, group: 'craft' });
    }
    this.result = null;
    this.slots.push({ x: big ? 124 : 154, y: big ? 35 : 28, output: true, get: () => this.result, set: () => { }, onTake: () => this.consume() });
    if (!big) {
      const inv = game.player.inv;
      const icons = ['slot_helmet', 'slot_chestplate', 'slot_leggings', 'slot_boots'];
      for (let i = 0; i < 4; i++) this.slots.push({ x: 8, y: 8 + i * 18, armorSlot: i, emptyIcon: icons[i], get: () => inv.slots[36 + i], set: (s) => { inv.slots[36 + i] = s; }, accept: (st) => !!ITEMS[st.id] && ITEMS[st.id].armor && ITEMS[st.id].armor.slot === i, max: 1, group: 'armor' });
    }
    this.addPlayerSlots(84, 142);
    if (!big && !game.net) { const inv = game.player.inv; this.slots.push({ x: 77, y: 62, emptyIcon: 'slot_shield', get: () => inv.slots[40], set: (s) => { inv.slots[40] = s; }, group: 'offhand' }); }
  }
  changed() {
    const r = matchRecipe(this.grid, this.size);
    const src = r && r.keep !== undefined ? this.grid.find(s => s && r.ing[r.keep].includes(s.id)) : null;
    this.result = r ? { ...(src || {}), id: r.result, count: r.count, dmg: src ? src.dmg || 0 : 0 } : null;
  }
  // vanilla recipe book: closed by default; when open the GUI moves right (RecipeBookComponent)
  layout() {
    super.layout();
    const u = this.game.ui;
    // vanilla widthTooNarrow (< 379): the open book is drawn centred in place of the container
    this.narrow = u.w < 379;
    this.bookOpen = this.game.settings.recipeBook === true;
    if (this.bookOpen && !this.narrow) this.x = 177 + Math.floor((u.w - this.gw - 200) / 2);
    if (!this.bookOpen || !this.narrow) this.peek = false;
    this.bookBtn = this.size === 3 ? { x: 5, y: 34, w: 20, h: 18 } : { x: 104, y: 61, w: 20, h: 18 };
    this.page = this.page || 0; this.tab = this.tab || 0; this.search = this.search || '';
    if (!this.bookOpen && this.searching) { u.hideInput(); this.searching = false; }
  }
  // vanilla crafting book categories: 1 equipment, 2 building blocks, 3 misc, 4 redstone
  static category(id) {
    const it = ITEMS[id], k = it.key;
    if (it.tool || it.armor || ['bow', 'arrow', 'shears', 'flint_and_steel', 'fishing_rod'].includes(k)) return 1;
    if (['tnt', 'note_block', 'oak_door', 'oak_trapdoor', 'redstone_block'].includes(k)) return 4;
    if (it.block !== undefined && !['crafting_table', 'furnace', 'chest', 'torch', 'ladder', 'jack_o_lantern', 'bookshelf', 'end_crystal'].includes(k) && !BLOCKS[it.block].bed) return 2;
    return 3;
  }
  bookRecipes() {
    const n = this.size * this.size;
    // a recipe that takes another of the same kind of thing and only changes its colour (a dye and a bed of another
    // colour): its ingredient lists hold items whose names end the same way as the result's
    const tail = (id) => String(ITEMS[id] && ITEMS[id].key || '').replace(/^.*?_/, '');
    const recolours = (x) => { const t = tail(x.result); return (x.ing || Object.values(x.keys || {})).some((alts) => [].concat(alts).some((id) => id !== x.result && tail(id) === t && ITEMS[id].key !== ITEMS[x.result].key)); };
    const inv = this.game.player.inv;
    const avail = new Map();
    for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s) avail.set(s.id, (avail.get(s.id) || 0) + s.count); }
    for (const s of this.grid) if (s) avail.set(s.id, (avail.get(s.id) || 0) + s.count);
    const q = this.search.trim().toLowerCase();
    // one entry per result item (vanilla groups alternative recipes into one "many" button)
    const byResult = new Map();
    for (const r of RECIPES) {
      if (r.type === 'shaped' ? (r.w > this.size || r.h > this.size) : r.ing.length > n) continue;
      if (this.tab > 0 && CraftingScreen.category(r.result) !== this.tab) continue;
      if (q && !ITEMS[r.result].cn.toLowerCase().includes(q) && !ITEMS[r.result].key.includes(q)) continue;
      const plan = planRecipe(r, avail, this.size);
      let e = byResult.get(r.result);
      // (the one shown: one that can be made now, else the item's own recipe before a re-colouring one - a white
      // bed showed "dye + any bed" when the wool and planks weren't there yet, and players took it for the only way)
      const rank = (x, p) => (p ? 4 : 0) + (x.type === 'shaped' ? 2 : 0) + (recolours(x) ? 0 : 1);
      if (!e) byResult.set(r.result, e = { r, plan, many: false });
      else { e.many = true; if (rank(r, plan) > rank(e.r, e.plan)) { e.r = r; e.plan = plan; } }
    }
    let list = [...byResult.values()];
    if (this.onlyCraftable) list = list.filter(e => e.plan);
    list.sort((a, b) => (b.plan ? 1 : 0) - (a.plan ? 1 : 0));
    return list;
  }
  // bookRecipes, again only when what it depends on changed: the inventory, the grid, the tab, the search, the filter
  // (it ran every frame - about 950 recipes planned against the inventory: 「图鉴太卡点不动」「翻页卡顿」, worse in rooms)
  bookList() {
    const inv = this.game.player.inv, sig = (st) => (st ? st.id + ':' + st.count : '-');
    let key = this.size + '|' + this.tab + '|' + this.search + '|' + !!this.onlyCraftable + '|' + !!this.net + '|';
    for (let i = 0; i < 36; i++) key += sig(inv.slots[i]) + ',';
    for (const st of this.grid) key += sig(st) + ',';
    // (in a room the grid is the server's window, not this.grid: there, also at most every half second)
    const now = performance.now();
    if (key !== this.bookKey || (this.net && now - this.bookAt > 500)) { this.bookKey = key; this.bookAt = now; this.bookCache = this.bookRecipes(); }
    return this.bookCache;
  }
  fillRecipe(entry, max) {
    const inv = this.game.player.inv, ui = this.game.ui;
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i]) { ui.returnStack(this.grid[i]); this.grid[i] = null; }
    const avail = new Map();
    for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s) avail.set(s.id, (avail.get(s.id) || 0) + s.count); }
    const plan = planRecipe(entry.r, avail, this.size);
    this.ghost = null;
    if (!plan) {
      // not enough materials: show the recipe as a red "ghost" in the grid, like vanilla
      const g = new Array(this.size * this.size).fill(null), r = entry.r;
      if (r.type === 'shaped') { for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const ch = r.pattern[y][x]; if (ch && ch !== ' ') g[y * this.size + x] = r.keys[ch]; } }
      else r.ing.forEach((opts, i) => { g[i] = opts; });
      this.ghost = { slots: g, result: r.result, t: performance.now() };
      this.changed(); return;
    }
    let times = 1;
    if (max) {
      const need = new Map(); for (const c of plan) if (c) need.set(c.id, (need.get(c.id) || 0) + 1);
      times = 64;
      for (const [id, k] of need) times = Math.min(times, Math.floor(avail.get(id) / k), maxStack(id));
      times = Math.max(1, times);
    }
    plan.forEach((c, i) => { if (c) { inv.remove(c.id, times); this.grid[i] = { id: c.id, count: times, dmg: 0 }; } });
    this.changed();
    Sound.click();
  }
  bookLayout() { return { x: Math.floor((this.game.ui.w - 147) / 2) - (this.narrow ? 0 : 86), y: Math.floor((this.game.ui.h - 166) / 2), w: 147, h: 166 }; }
  drawBook(ui) {
    const c = ui.ctx, P = this.bookLayout();
    // category tabs on the left edge (the selected one sticks out 2 px further)
    this.tabRects = [];
    const icons = [['compass'], ['iron_axe', 'golden_sword'], ['bricks'], ['lava_bucket', 'apple'], ['redstone']];
    icons.forEach((ic, i) => {
      const sel = i === this.tab, x = P.x - 30 - (sel ? 2 : 0), y = P.y + 3 + i * 27;
      ui.sprite(sel ? 'rb_tab_selected' : 'rb_tab', x, y);
      this.tabRects.push({ x, y, w: 35, h: 27 });
      let ids = ic.map(k => ITEM_KEY[k]).filter(v => v !== undefined);
      if (!ids.length) ids = [ITEM_KEY.iron_pickaxe];
      ids.forEach((id, k) => ui.drawItem({ id, count: 1 }, x + 9 + (ids.length > 1 ? 3 * k - 2 : 0), y + 5 + (ids.length > 1 ? 3 * k - 1 : 0)));
    });
    c.drawImage(ui.img.recipe_book, 1, 1, 147, 166, P.x, P.y, 147, 166);
    // search box (its frame is part of the panel texture)
    this.searchRect = { x: P.x + 25, y: P.y + 13, w: 81, h: 14 };
    if (!this.searching && !this.search) Font.draw(c, '搜索…', P.x + 27, P.y + 15, '#808080', false);
    else if (!this.searching) Font.draw(c, this.search, P.x + 27, P.y + 15, '#E0E0E0', false);
    // craftable-only toggle
    this.filterBtn = { x: P.x + 110, y: P.y + 12, w: 26, h: 16 };
    ui.sprite((this.onlyCraftable ? 'rb_filter_enabled' : 'rb_filter_disabled') + (ui.hit(this.filterBtn) ? '_hl' : ''), this.filterBtn.x, this.filterBtn.y);
    const list = this.bookList();
    const per = 20, pages = Math.max(1, Math.ceil(list.length / per));
    this.page = clamp(this.page, 0, pages - 1);
    this.bookCells = [];
    let hover = null;
    list.slice(this.page * per, this.page * per + per).forEach((e, i) => {
      const x = P.x + 11 + (i % 5) * 25, y = P.y + 31 + Math.floor(i / 5) * 25;
      const cell = { x, y, w: 25, h: 25, e };
      this.bookCells.push(cell);
      ui.sprite('rb_slot_' + (e.many ? 'many_' : '') + (e.plan ? 'craftable' : 'uncraftable'), x, y);
      ui.drawItem({ id: e.r.result, count: e.r.count }, x + 4, y + 4);
      if (ui.hit(cell)) hover = e;
    });
    this.prevBtn = { x: P.x + 38, y: P.y + 137, w: 12, h: 17 }; this.nextBtn = { x: P.x + 93, y: P.y + 137, w: 12, h: 17 };
    if (pages > 1) {
      const t = (this.page + 1) + '/' + pages;
      Font.draw(c, t, P.x + 73 - Math.floor(Font.width(t) / 2), P.y + 141, '#FFFFFF', false);
      if (this.page > 0) ui.sprite('rb_page_backward' + (ui.hit(this.prevBtn) ? '_hl' : ''), this.prevBtn.x, this.prevBtn.y);
      if (this.page < pages - 1) ui.sprite('rb_page_forward' + (ui.hit(this.nextBtn) ? '_hl' : ''), this.nextBtn.x, this.nextBtn.y);
    }
    if (ui.hit(this.filterBtn) && !ui.cursor) ui.tooltip([{ text: this.onlyCraftable ? '显示全部' : '显示可合成的配方' }], ui.mouse.x, ui.mouse.y);
    else if (hover && !ui.cursor) ui.tooltip(ui.itemLines({ id: hover.r.result, count: hover.r.count }), ui.mouse.x, ui.mouse.y);
  }
  // red ghost of an uncraftable recipe (vanilla ghost slots); gone once something is placed
  drawGhost(ui) {
    const g = this.ghost;
    if (!g) return;
    if (this.grid.some(s => s)) { this.ghost = null; return; }
    const c = ui.ctx, cyc = Math.floor((performance.now() - g.t) / 1000);
    let k = 0;
    for (const s of this.slots) {
      if (s.group !== 'craft' && !s.output) continue;
      const opts = s.output ? [g.result] : g.slots[k++];
      if (!opts) continue;
      const id = opts[cyc % opts.length];
      c.fillStyle = 'rgba(255,0,0,0.19)'; c.fillRect(this.x + s.x, this.y + s.y, 16, 16);
      c.globalAlpha = 0.5; ui.drawItem({ id, count: 1 }, this.x + s.x, this.y + s.y); c.globalAlpha = 1;
    }
  }
  consume() {
    const r = this.result;
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (s) {
        if (s.id === item('water_bucket') || s.id === item('lava_bucket')) { this.grid[i] = makeStack('bucket'); continue; }
        s.count--; if (!s.count) this.grid[i] = null;
      }
    }
    if (r) this.game.onCraft(r.id, r.count);
    this.changed();
  }
  draw(ui) {
    const b = this.bookBtn, btn = () => ui.sprite(ui.hit({ x: this.x + b.x, y: this.y + b.y, w: b.w, h: b.h }) ? 'rb_button_hl' : 'rb_button', this.x + b.x, this.y + b.y);
    // (narrow: the book covers the grid - once a recipe is chosen it steps aside (peek) so the grid and the result show;
    // its button brings it back. Phone players chose a recipe and saw nothing happen: 「配方表点不进去」)
    if (this.bookOpen && this.narrow && !this.peek) { ui.dim(0.6); this.drawBook(ui); btn(); return; }
    this.drawBase(ui);
    if (this.bookOpen && !this.peek) this.drawBook(ui);
    this.drawExtra(ui);
    btn();
    this.drawGhost(ui);
    this.drawSlots(ui);
  }
  mouseDown(ui, mx, my, button, shift) {
    const b = this.bookBtn;
    if (ui.hit({ x: this.x + b.x, y: this.y + b.y, w: b.w, h: b.h }, mx, my)) {
      if (this.peek) { this.peek = false; Sound.click(); return; }
      this.game.settings.recipeBook = !this.bookOpen; this.game.saveSettings(); this.layout(); Sound.click(); return;
    }
    if (this.bookOpen && !this.peek) {
      const none = { x: 0, y: 0, w: 0, h: 0 };
      if (ui.hit(this.filterBtn || none, mx, my)) { this.onlyCraftable = !this.onlyCraftable; this.page = 0; Sound.click(); return; }
      if (ui.hit(this.prevBtn || none, mx, my)) { this.page--; Sound.click(); return; }
      if (ui.hit(this.nextBtn || none, mx, my)) { this.page++; Sound.click(); return; }
      for (let i = 0; i < (this.tabRects || []).length; i++) if (ui.hit(this.tabRects[i], mx, my)) { this.tab = i; this.page = 0; Sound.click(); return; }
      if (ui.hit(this.searchRect || none, mx, my)) {
        const r = this.searchRect; this.searching = true;
        ui.showInput(r.x, r.y, r.w, r.h, this.search, () => { }, { onInput: (v) => { this.search = v; this.page = 0; this.tab = 0; }, onEsc: () => { ui.hideInput(); this.searching = false; }, max: 30 });
        return;
      }
      if (this.searching) { ui.hideInput(); this.searching = false; }
      // (a long press - right click - fills as many as the materials make, as shift does)
      for (const c of this.bookCells || []) if (ui.hit(c, mx, my)) { if (!ui.cursor) { this.fillRecipe(c.e, shift || button === 2); if (this.narrow) this.peek = true; } return; }
      if (ui.hit(this.bookLayout(), mx, my) || this.narrow) return;
    }
    super.mouseDown(ui, mx, my, button, shift);
  }
  wheel(ui, dy) { if (this.bookOpen && !this.peek && ui.hit(this.bookLayout())) this.page += Math.sign(dy); }
  outside(mx, my) { return super.outside(mx, my) && !(this.bookOpen && !this.peek && this.game.ui.hit(this.bookLayout(), mx, my)); }
  drawExtra(ui) {
    if (this.size === 2) {
      Font.draw(ui.ctx, '合成', this.x + 97, this.y + 6, '#404040', false);
      // player preview
      const pv = this.game.renderer.playerPreview(this.game, ui, this.x + 26, this.y + 8, 49, 70);
      if (pv) { ui.ctx.imageSmoothingEnabled = true; ui.ctx.drawImage(pv, this.x + 26, this.y + 8, 49, 70); ui.ctx.imageSmoothingEnabled = false; }
    } else Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 72, '#404040', false);
  }
  close() {
    for (const s of this.grid) if (s) this.game.ui.returnStack(s);
    this.grid.fill(null);
    // (the result too: the 图鉴 button opens over this window and closes it - back from it, the old result was still
    // there to take from an empty grid, free planks; feedback 2026-11-01/02)
    this.result = null; this.ghost = null;
    if (this.searching) { this.game.ui.hideInput(); this.searching = false; }
  }
}

// one block entity = small chest (3 rows), two = large chest (6 rows)
class ChestScreen extends ContainerScreen {
  constructor(game, bes, title = '箱子') {
    if (!Array.isArray(bes)) bes = [bes];
    const rows = bes.length * 3;
    super(game, 'generic_54', 176, 114 + rows * 18, title);
    this.bes = bes; this.be = bes[0]; this.rows = rows;
    bes.forEach((be, h) => {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        this.slots.push({ x: 8 + c * 18, y: 18 + (h * 3 + r) * 18, get: () => be.slots[i], set: (s) => { be.slots[i] = s; }, group: 'container' });
      }
    });
    this.addPlayerSlots(31 + rows * 18, 89 + rows * 18);
    for (const be of bes) game.openChests.add(be.pos.join(','));
  }
  // closing the screen when a half is broken
  owns(be) { return this.bes.includes(be); }
  drawBase(ui) {
    ui.dim(0.6);
    const c = ui.ctx, im = ui.img.generic_54, top = 17 + this.rows * 18;
    c.drawImage(im, 0, 0, 176, top, this.x, this.y, 176, top);
    c.drawImage(im, 0, 126, 176, 96, this.x, this.y + top, 176, 96);
    Font.draw(c, this.title, this.x + 8, this.y + 6, '#404040', false);
    Font.draw(c, '物品栏', this.x + 8, this.y + top + 3, '#404040', false);
  }
  close() {
    for (const be of this.bes) { this.game.markBlockEntity(be); this.game.openChests.delete(be.pos.join(',')); }
    const p = this.be.pos; Sound.chest([p[0] + 0.5, p[1] + 0.5, p[2] + 0.5], false);
  }
}

class FurnaceScreen extends ContainerScreen {
  constructor(game, be) {
    super(game, 'furnace', 176, 166, '熔炉');
    this.be = be;
    this.slots.push({ x: 56, y: 17, get: () => be.input, set: (s) => { be.input = s; }, group: 'container', accept: (st) => !!COOKING[be.kind || 'smelting'][st.id] });
    this.slots.push({ x: 56, y: 53, get: () => be.fuel, set: (s) => { be.fuel = s; }, group: 'container', accept: (st) => fuelValue(st.id) > 0 });
    this.slots.push({ x: 116, y: 35, output: true, get: () => be.output, set: (s) => { be.output = s; }, onTake: (st) => { this.game.onSmeltTake(st, be); be.output = null; } });
    this.addPlayerSlots(84, 142);
  }
  canPlace(s, st) { if (s.output) return false; return !s.accept || s.accept(st); }
  quickMove(s) {
    const st = s.get(); if (!st) return;
    if (s.group === 'main' || s.group === 'hotbar') {
      const tgt = COOKING[this.be.kind || 'smelting'][st.id] ? this.slots[0] : fuelValue(st.id) ? this.slots[1] : null;
      if (tgt) {
        const ts = tgt.get();
        if (!ts) { tgt.set(st); s.set(null); return; }
        if (sameKind(ts, st)) { const k = Math.min(st.count, maxStack(st.id) - ts.count); ts.count += k; st.count -= k; if (!st.count) s.set(null); return; }
      }
    }
    super.quickMove(s);
  }
  drawExtra(ui) {
    const be = this.be, c = ui.ctx;
    if (be.burn > 0) {
      const f = Math.ceil(be.burn / be.burnMax * 13) + 1;
      c.drawImage(ui.img.lit_progress, 0, 14 - f, 14, f, this.x + 56, this.y + 36 + 14 - f, 14, f);
    }
    if (be.cook > 0) {
      const w = Math.ceil(be.cook / (be.cookMax || 200) * 24);
      c.drawImage(ui.img.burn_progress, 0, 0, w, 16, this.x + 79, this.y + 34, w, 16);
    }
    Font.draw(c, '物品栏', this.x + 8, this.y + 73, '#404040', false);
  }
  close() { this.game.markBlockEntity(this.be); }
}

class CreativeScreen extends ContainerScreen {
  constructor(game) {
    super(game, 'tab_items', 195, 136, null);
    this.tab = 0; this.scroll = 0; this.search = '';
    this.items = [];
    this.trash = null;
    const inv = game.player.inv;
    for (let c = 0; c < 9; c++) this.slots.push({ x: 9 + c * 18, y: 112, get: () => inv.slots[c], set: (s) => { inv.slots[c] = s; }, group: 'hotbar' });
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
      const k = r * 9 + c;
      this.slots.push({ x: 9 + c * 18, y: 18 + r * 18, creative: true, get: () => { const e = this.items[this.scroll * 9 + k]; return e == null ? null : typeof e === 'object' ? { ...e, count: 1 } : { id: e, count: 1 }; }, set: () => { } });
    }
    this.trashSlot = { x: 173, y: 112, trash: true, get: () => null, set: () => { } };
    this.slots.push(this.trashSlot);
    this.itemSlots = this.slots;
    // vanilla's survival inventory tab: armour, offhand, the whole inventory, the player
    const A = ['slot_helmet', 'slot_chestplate', 'slot_leggings', 'slot_boots'];
    this.invSlots = [
      ...[0, 1, 2, 3].map(i => ({ x: 54 + Math.floor(i / 2) * 54, y: 6 + (i % 2) * 27, armorSlot: i, emptyIcon: A[i], max: 1, group: 'armor',
        get: () => inv.slots[36 + i], set: (s) => { inv.slots[36 + i] = s; }, accept: (st) => !!ITEMS[st.id] && ITEMS[st.id].armor && ITEMS[st.id].armor.slot === i })),
      { x: 35, y: 20, emptyIcon: 'slot_shield', group: 'offhand', get: () => inv.slots[40], set: (s) => { inv.slots[40] = s; } },
      ...Array.from({ length: 27 }, (_, k) => ({ x: 9 + (k % 9) * 18, y: 54 + Math.floor(k / 9) * 18, group: 'main', get: () => inv.slots[9 + k], set: (s) => { inv.slots[9 + k] = s; } })),
      ...this.itemSlots.filter(s => s.group === 'hotbar'), this.trashSlot,
    ];
    this.setTab(0);
  }
  tabs() { return [...CREATIVE_TABS, { name: '搜索物品', icon: 'compass_search', search: true }, { name: '生存模式物品栏', inv: true }]; }
  setTab(t) {
    this.tab = t; this.scroll = 0;
    const tabs = this.tabs();
    this.slots = tabs[t].inv ? this.invSlots : this.itemSlots;
    if (tabs[t].inv) { this.bg = 'tab_inventory'; this.items = []; this.game.ui.hideInput(); return; }
    if (tabs[t].search) {
      this.bg = 'tab_item_search';
      const q = this.search.trim().toLowerCase();
      // (vanilla searches the tooltip: an enchanted book is found by its enchantment's name, a potion by its effect -
      // so the tabs' books and potions are searched too, by what their tooltip says)
      const plain = ITEMS.filter(it => it && !(BLOCKS[it.id] && BLOCKS[it.id].noItem)).map(it => it.id);
      const extra = q ? CREATIVE_TABS.flatMap(t => t.items.filter(k => typeof k === 'object').map(k => { const { key, ...data } = k; return { id: item(key), count: 1, dmg: 0, ...data }; })) : [];
      const text = (st) => { const it = ITEMS[st.id] || ITEMS[st]; const lines = typeof netItemLines === 'function' && typeof st === 'object' ? netItemLines(st, [{ text: it.cn, color: '#FFFFFF' }]) : [{ text: it.cn }]; return (lines.map(l => l.text).join(' ') + ' ' + it.key + ' ' + (st.e ? st.e.map(e => e[0]).join(' ') : '') + ' ' + (st.pot || '')).toLowerCase(); };
      this.items = [...plain, ...extra].filter(st => !q || text(st).includes(q));
      const u = this.game.ui;
      if (this.x !== undefined) u.showInput(this.x + 82, this.y + 6, 89, 10, this.search, () => { }, { onInput: (v) => { this.search = v; this.setTab(this.tab); }, onEsc: () => u.close(), max: 30 });
    } else {
      this.bg = 'tab_items';
      this.items = tabs[t].items.map(k => { if (typeof k !== 'object') return item(k); const { key, ...data } = k; return { id: item(key), ...data }; });
      this.game.ui.hideInput();
    }
  }
  layout() { super.layout(); if (this.tabs()[this.tab].search) this.setTab(this.tab); }
  maxScroll() { return Math.max(0, Math.ceil(this.items.length / 9) - 5); }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy), 0, this.maxScroll()); }
  // vanilla's tab places: five on top, five below, the search tab at the top right
  tabCol(i) { return i >= 10 ? 6 : i % 5; }
  tabTop(i) { return i < 5 || i === 10; }
  tabRect(i) { const c = this.tabCol(i); return { x: this.x + (c === 6 ? 167 : c * 27), y: this.tabTop(i) ? this.y - 28 : this.y + 132, w: 26, h: 30 }; }
  tabSprite(i, sel) { return 'tab_' + (this.tabTop(i) ? 'top' : 'bottom') + (sel ? '_selected_' : '_unselected_') + (this.tabCol(i) + 1); }
  draw(ui) {
    ui.dim(0.6);
    const c = ui.ctx, tabs = this.tabs();
    for (let i = 0; i < tabs.length; i++) if (i !== this.tab) { const r = this.tabRect(i); ui.sprite(this.tabSprite(i, false), r.x, r.y); }
    c.drawImage(ui.img[this.bg], 0, 0, 195, 136, this.x, this.y, 195, 136);
    { const r = this.tabRect(this.tab); ui.sprite(this.tabSprite(this.tab, true), r.x, r.y); }
    for (let i = 0; i < tabs.length; i++) {
      const r = this.tabRect(i);
      const icon = tabs[i].search ? item('book') : tabs[i].inv ? item('chest') : item(tabs[i].icon);
      ui.drawItem({ id: icon, count: 1 }, r.x + 5, r.y + (this.tabTop(i) ? 9 : 7));
    }
    if (!tabs[this.tab].inv) Font.draw(c, tabs[this.tab].name, this.x + 8, this.y + 6, '#404040', false);
    // scroller
    const ms = this.maxScroll();
    const sy = this.y + 18 + (ms ? Math.round(this.scroll / ms * (112 - 15 - 18)) : 0);
    if (!tabs[this.tab].inv) ui.sprite(ms ? 'scroller' : 'scroller_disabled', this.x + 175, sy);
    else {
      // the player, as in the survival inventory
      const pv = this.game.renderer.playerPreview(this.game, ui, this.x + 73, this.y + 6, 32, 43);
      if (pv) { c.imageSmoothingEnabled = true; c.drawImage(pv, this.x + 73, this.y + 6, 32, 43); c.imageSmoothingEnabled = false; }
    }
    // trash slot
    ui.ctx.fillStyle = '#8b8b8b'; ui.ctx.fillRect(this.x + 173, this.y + 112, 16, 16);
    Font.center(c, 'X', this.x + 181, this.y + 116, '#FF5555');
    this.drawSlots(ui);
    for (let i = 0; i < tabs.length; i++) if (ui.hit(this.tabRect(i))) ui.tooltip([{ text: tabs[i].name }], ui.mouse.x, ui.mouse.y);
  }
  drawSlots(ui) {
    const hov = this.slotAt(ui.mouse.x, ui.mouse.y);
    for (const s of this.slots) {
      if (s.trash) continue;
      if (!s.get() && s.emptyIcon) { ui.ctx.globalAlpha = 0.6; ui.sprite(s.emptyIcon, this.x + s.x, this.y + s.y); ui.ctx.globalAlpha = 1; }
      ui.drawItem(s.get(), this.x + s.x, this.y + s.y);
      if (s === hov) { ui.ctx.fillStyle = 'rgba(255,255,255,0.5)'; ui.ctx.fillRect(this.x + s.x, this.y + s.y, 16, 16); }
    }
    if (hov && hov.get() && !ui.cursor) ui.tooltip(ui.tipLines(hov.get()), ui.mouse.x, ui.mouse.y);
  }
  mouseDown(ui, mx, my, button, shift) {
    const tabs = this.tabs();
    for (let i = 0; i < tabs.length; i++) if (ui.hit(this.tabRect(i), mx, my)) { this.setTab(i); Sound.click(); return; }
    if (!tabs[this.tab].inv && mx >= this.x + 175 && mx < this.x + 187 && my >= this.y + 18 && my < this.y + 130) { this.scrolling = true; this.mouseMove(ui, mx, my); return; }
    const s = this.slotAt(mx, my);
    if (s && s.trash) { if (ui.cursor) ui.cursor = null; else if (shift) this.game.player.inv.slots.fill(null, 0, 36); return; }
    if (s && s.creative) {
      const st = s.get();
      if (ui.cursor) { ui.cursor = null; return; }
      if (!st) return;
      if (shift) { const inv = this.game.player.inv; const i = inv.slots.findIndex((x, j) => j < 9 && !x); inv.slots[i >= 0 ? i : inv.sel] = { ...st, count: maxStack(st.id), dmg: 0 }; return; }
      ui.cursor = { ...st, count: button === 2 ? 1 : maxStack(st.id), dmg: 0 };
      return;
    }
    if (s && button === 1 && s.get()) { ui.cursor = { ...s.get(), count: maxStack(s.get().id) }; return; }
    super.mouseDown(ui, mx, my, button, shift);
  }
  mouseMove(ui, mx, my) {
    if (this.scrolling && ui.mouse.down) { const ms = this.maxScroll(); this.scroll = clamp(Math.round((my - this.y - 25) / (112 - 15 - 18) * ms), 0, ms); return; }
    super.mouseMove(ui, mx, my);
  }
  mouseUp(ui, mx, my, b) { this.scrolling = false; super.mouseUp(ui, mx, my, b); }
  quickMove(s) { if (this.tabs()[this.tab].inv) return super.quickMove(s); if (s.group === 'hotbar') s.set(null); }
  outside(mx, my) { return super.outside(mx, my) && my > this.y - 28 && my < this.y + 164; }
  key(ui, ev) { if (this.tabs()[this.tab].search && document.activeElement === ui.input) return true; return super.key(ui, ev); }
}

// ---------------------------------------------------------------------------
// Menu screens (buttons & sliders)
// ---------------------------------------------------------------------------
class MenuScreen {
  constructor(game, title) { this.game = game; this.title = title; this.widgets = []; this.bgDim = 0.5; this.blurBg = true; }
  layout() { }
  draw(ui) {
    if (this.blurBg) ui.menuBackground(); else if (this.bgDirt) this.drawDirt(ui); else if (this.bgDim) ui.dim(this.bgDim);
    if (this.title) Font.center(ui.ctx, this.title, ui.w / 2, this.titleY ?? 30, '#FFFFFF');
    if (this.drawExtra) this.drawExtra(ui);
    for (const w of this.widgets) { if (w.slider) ui.slider(w); else if (w.text) Font.center(ui.ctx, typeof w.text === 'function' ? w.text() : w.text, w.x, w.y, w.color || '#FFFFFF'); else ui.button(w); }
    for (const w of this.widgets) if (w.tip && ui.hit(w)) ui.tooltip(w.tip.map(t => ({ text: t })), ui.mouse.x, ui.mouse.y);
  }
  drawDirt(ui) {
    const r = this.game.renderer;
    if (!ui.dirtTile) {
      const t = ui.dirtTile = document.createElement('canvas'); t.width = 32; t.height = 32;
      const x = t.getContext('2d'); x.imageSmoothingEnabled = false;
      x.drawImage(r.stripCanvas, ...r.tileXY(T('dirt')), 16, 16, 0, 0, 32, 32);
      x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(0, 0, 32, 32);
    }
    ui.tiled(ui.dirtTile, 'dirt', 0, 0, ui.w, ui.h); // (no pattern fill on the screen: UI.tiled)
  }
  mouseDown(ui, mx, my, button) {
    if (button !== 0) return;
    for (const w of this.widgets) {
      if (w.slider && ui.hit(w, mx, my)) { this.dragging = w; this.mouseMove(ui, mx, my); Sound.click(); return; }
      if (!w.slider && !w.text && w.enabled !== false && ui.hit(w, mx, my)) { Sound.init(); Sound.click(); w.onClick(); return; }
    }
  }
  mouseMove(ui, mx) {
    if (this.dragging && ui.mouse.down) { const w = this.dragging; w.value = clamp((mx - w.x - 4) / (w.w - 8), 0, 1); w.onChange(w.value); }
  }
  mouseUp() { this.dragging = null; }
  key(ui, ev) { if (ev.key === 'Escape' && this.onEsc) { this.onEsc(); return true; } return false; }
}

// Choose concrete ingredient ids for a recipe given available counts; returns per-grid-slot list or null
function planRecipe(r, avail, size) {
  const left = new Map(avail);
  const take = (opts) => {
    let best = -1, bestN = 0;
    for (const id of opts) { const n = left.get(id) || 0; if (n > bestN) { best = id; bestN = n; } }
    if (best < 0) return null;
    left.set(best, bestN - 1);
    return { id: best };
  };
  const out = new Array(size * size).fill(null);
  if (r.type === 'shaped') {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const ch = r.pattern[y][x];
      if (ch === ' ' || ch === undefined) continue;
      const t = take(r.keys[ch]); if (!t) return null;
      out[y * size + x] = t;
    }
  } else {
    for (let i = 0; i < r.ing.length; i++) { const t = take(r.ing[i]); if (!t) return null; out[i] = t; }
  }
  return out;
}
