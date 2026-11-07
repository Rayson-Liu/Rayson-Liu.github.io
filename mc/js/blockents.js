'use strict';
// ---------------------------------------------------------------------------
// Block entities drawn as models, like vanilla's block-entity renderers: chests of every kind, shulker boxes,
// banners, heads and skulls, decorated pots, conduits and copper golem statues. Their blocks are data blocks of
// kind 'entity' (tools/build_blocks.py; chests keep the chest's own facing / double-chest meta); the state picks
// the pose. Models are in pixels, y up, facing -z (like the mob models), drawn at the block's bottom centre.
// ---------------------------------------------------------------------------
// vanilla's dye colours (DyeColor texture colours), for banners
const DYE_RGB = { white: 0xF9FFFE, orange: 0xF9801D, magenta: 0xC74EBD, light_blue: 0x3AB3DA, yellow: 0xFED83D, lime: 0x80C71F, pink: 0xF38BAA,
  gray: 0x474F52, light_gray: 0x9D9D97, cyan: 0x169C9C, purple: 0x8932B8, blue: 0x3C44AA, brown: 0x835432, green: 0x5E7C16, red: 0xB02E26, black: 0x1D1D21 };
const dyeOf = (key) => { for (const c in DYE_RGB) if (key.startsWith(c + '_')) return c; return 'white'; };
// facing -> vanilla angle (0 south, 90 west, 180 north, 270 east)
const FACING_DEG = { south: 0, west: 90, north: 180, east: 270 };
// the model rotation that turns the -z-facing models to a vanilla angle
const beYaw = (deg) => Math.PI - deg * Math.PI / 180;

// textures of the block-entity models: GL textures made from ASSETS.images the first time they are drawn
Renderer.prototype.beTex = function (k) {
  if (!this.entityTex[k]) { const im = this.images[k]; if (!im) return null; this.entityTex[k] = this.tex2D(im, false); }
  return k;
};
Renderer.prototype.initBEModels = function () {
  if (this.models.be_head) return;
  const M = this.models, P = (tw, th, parts) => { for (const p of parts) p.mesh = this.makeModelPart(p.boxes, tw, th); return { parts }; };
  const part = (boxes, extra = {}) => ({ name: 'p', pivot: [0, 0, 0], boxes, ...extra });
  M.be_head = P(64, 32, [part([[0, 0, -4, 0, -4, 8, 8, 8]])]);
  M.be_head64 = P(64, 64, [part([[0, 0, -4, 0, -4, 8, 8, 8]])]);
  M.be_player_head = P(64, 64, [part([[0, 0, -4, 0, -4, 8, 8, 8], [32, 0, -4, 0, -4, 8, 8, 8, 0.25]])]);
  M.be_piglin_head = P(64, 64, [part([[0, 0, -5, 0, -4, 10, 8, 8], [31, 1, -2, 0, -5, 4, 4, 1], [2, 4, 2, 0, -5, 1, 2, 1], [2, 0, -3, 0, -5, 1, 2, 1]])]);
  M.be_dragon_head = P(256, 256, [part([[112, 30, -8, 0, -8, 16, 16, 16], [176, 44, -6, 4, -22, 12, 5, 16], [176, 65, -6, 0, -22, 12, 4, 16]])]);
  // banners: pole and bar (banner_base), the cloth (base pattern, dyed)
  M.be_banner_pole = P(64, 64, [part([[44, 0, -1, 0, -1, 2, 42, 2], [0, 42, -10, 40, -1, 20, 2, 2]])]);
  M.be_banner_bar = P(64, 64, [part([[0, 42, -10, 14, 5, 20, 2, 2]])]);
  M.be_banner_flag = P(64, 64, [part([[0, 0, -10, 0, -2, 20, 40, 1]])]);
  M.be_shulker = P(64, 64, [part([[0, 28, -8, 0, -8, 16, 8, 16], [0, 0, -8, 4, -8, 16, 12, 16]])]);
  // decorated pot: neck, top and bottom (decorated_pot_base), the four sides (decorated_pot_side)
  M.be_pot_base = P(32, 32, [part([[0, 0, -4, 16, -4, 8, 3, 8], [0, 5, -3, 19, -3, 6, 1, 6], [-14, 13, -7, 16, -7, 14, 0, 14], [-14, 13, -7, 0, -7, 14, 0, 14]])]);
  const side = (ry) => ({ name: 's', pivot: [0, 0, 0], rotY: ry, boxes: [[1, 0, -7, 0, -7, 14, 16, 0]] });
  M.be_pot_sides = P(16, 16, [side(0), side(Math.PI / 2), side(Math.PI), side(-Math.PI / 2)]);
  M.be_conduit = P(32, 16, [part([[0, 0, -3, 5, -3, 6, 6, 6]])]);
  M.be_golem = P(64, 64, [part([[0, 27, -4, 0, -2, 4, 5, 4], [16, 27, 0, 0, -2, 4, 5, 4], [0, 15, -4, 5, -3, 8, 6, 6], [0, 0, -4, 11, -5, 8, 5, 10],
    [56, 0, -1, 12, -7, 2, 3, 2], [37, 8, -1, 16, -1, 2, 4, 2], [37, 0, -2, 20, -2, 4, 4, 4], [36, 16, -8, 1, -2, 4, 10, 4], [36, 16, 4, 1, -2, 4, 10, 4, 0, true]])]);
};

// what to draw for a block entity block: [model, texture, model matrix, opts] parts
function beParts(r, b, m, x, y, z) {
  const st = (b.states && b.states[m]) || {}, key = b.key;
  const rot16 = (st.rotation !== undefined ? +st.rotation : 0) * 22.5;
  switch (b.be) {
    case 'head': case 'wall_head': {
      const wall = b.be === 'wall_head', deg = wall ? FACING_DEG[st.facing] ?? 0 : rot16;
      const kind = key.replace(/_(wall_)?(head|skull)$/, '');
      const [model, tex] = kind === 'skeleton' ? ['be_head', 'skeleton'] : kind === 'wither_skeleton' ? ['be_head', 'wither_skeleton']
        : kind === 'creeper' ? ['be_head', 'creeper'] : kind === 'zombie' ? ['be_head64', 'zombie'] : kind === 'piglin' ? ['be_piglin_head', 'piglin']
        : kind === 'dragon' ? ['be_dragon_head', 'dragon'] : ['be_player_head', 'steve'];
      const t = M4.create(); M4.translate(t, x + 0.5, y, z + 0.5); M4.rotY(t, beYaw(deg));
      if (wall) M4.translate(t, 0, 4 / 16, 4 / 16);
      if (kind === 'dragon') M4.scale(t, 0.75, 0.75, 0.75);
      return [[model, tex, t]];
    }
    case 'banner': case 'wall_banner': {
      const wall = b.be === 'wall_banner', deg = wall ? FACING_DEG[st.facing] ?? 0 : rot16;
      const t = M4.create(); M4.translate(t, x + 0.5, y, z + 0.5); M4.rotY(t, beYaw(deg));
      const c = DYE_RGB[dyeOf(key)], tint = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
      if (wall) {
        const f = new Float32Array(t); M4.translate(f, 0, -24 / 16, 6 / 16);
        return [['be_banner_bar', 'banner_base', t], ['be_banner_flag', 'banner_pattern_base', f, { tint }]];
      }
      const f = new Float32Array(t); M4.translate(f, 0, 2 / 16, 0);
      return [['be_banner_pole', 'banner_base', t], ['be_banner_flag', 'banner_pattern_base', f, { tint }]];
    }
    case 'shulker_box': {
      const t = M4.create(); M4.translate(t, x + 0.5, y + 0.5, z + 0.5);
      const f = st.facing || 'up';
      if (f === 'down') M4.rotX(t, Math.PI);
      else if (f !== 'up') { M4.rotY(t, beYaw(FACING_DEG[f])); M4.rotX(t, -Math.PI / 2); }
      M4.translate(t, 0, -0.5, 0);
      const color = key === 'shulker_box' ? '' : '_' + key.replace(/_shulker_box$/, '');
      return [['be_shulker', 'shulker' + color, t]];
    }
    case 'decorated_pot': {
      const t = M4.create(); M4.translate(t, x + 0.5, y, z + 0.5); M4.rotY(t, beYaw(FACING_DEG[st.facing] ?? 0));
      return [['be_pot_base', 'decorated_pot_base', t], ['be_pot_sides', 'decorated_pot_side', t]];
    }
    case 'conduit': {
      const t = M4.create(); M4.translate(t, x + 0.5, y, z + 0.5);
      return [['be_conduit', 'conduit_base', t]];
    }
    case 'golem_statue': {
      const t = M4.create(); M4.translate(t, x + 0.5, y, z + 0.5); M4.rotY(t, beYaw(FACING_DEG[st.facing] ?? 0));
      const ox = key.replace(/^waxed_/, '').replace(/copper_golem_statue$/, '').replace(/_$/, '');
      return [['be_golem', 'copper_golem' + (ox ? '_' + ox : ''), t]];
    }
  }
  return [];
}
// a block-entity block drawn in the world or as an icon (opts.vp: the icon's projection)
Renderer.prototype.drawBE = function (b, m, x, y, z, light, env, opts = {}) {
  this.initBEModels();
  for (const [model, tex, mat, o] of beParts(this, b, m, x, y, z)) {
    if (!this.beTex(tex)) continue;
    let mm = mat;
    if (opts.base) { mm = new Float32Array(16); M4.mul(mm, opts.base, mat); }
    this.drawModel(model, tex, mm, null, light, env, { ...(o || {}), vp: opts.vp });
  }
};

// chests: the chest renderer's model per kind (normal, trapped, ender, copper in four stages; waxed the same)
function chestTexBase(key) {
  const k = key.replace(/^waxed_/, '');
  if (k === 'chest') return 'chest_normal';
  if (k === 'trapped_chest') return 'chest_trapped';
  if (k === 'ender_chest') return 'chest_ender';
  const st = k.replace(/_?copper_chest$/, '');
  return 'chest_copper' + (st ? '_' + st : '');
}

// every block entity block in range: chests (lids open with their screens) and the others
Game.prototype.drawChests = function (a, env) {
  const p = this.player, w = this.world, r = this.renderer, px = Math.floor(p.pos[0]), pz = Math.floor(p.pos[2]);
  const dist = Math.min(64, r.renderDist * 16);
  if (!BE_IDS.length) return;
  r.gl.disable(r.gl.CULL_FACE);
  for (let cx = (px - dist) >> 4; cx <= (px + dist) >> 4; cx++) for (let cz = (pz - dist) >> 4; cz <= (pz + dist) >> 4; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    if (!ch.chests) { ch.chests = []; ch.findAll(BE_IDS, (i) => ch.chests.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)])); }
    for (const [x, y, z] of ch.chests) {
      const id = w.getBlock(x, y, z), b = BLOCKS[id];
      if (!b || !(b.beRender || BOOK_BLOCKS.has(id) || id === BELL_ID)) continue;
      if (!aabbInFrustum(r.planes, x - 1, y - 2, z - 1, x + 2, y + 3, z + 2)) continue;
      const m = w.getMeta(x, y, z), l = w.getLight(x, y, z), L = [(l >> 4) / 15, (l & 15) / 15];
      if (BOOK_BLOCKS.has(id)) { this.drawBook(b, m, x, y, z, L, env, a); continue; }
      if (id === BELL_ID) { this.drawBell(x, y, z, L, env, a); continue; }
      if (!b.chestLike) { r.drawBE(b, m, x, y, z, L, env); continue; }
      const t = chestType(m);
      // a double chest's lid opens together: use whichever half has the most open lid
      const s = chestSeam(m), k = `${x},${y},${z}`;
      const la = this.chestLids.get(k), lb = s && this.chestLids.get(`${x + s[0]},${y},${z + s[1]}`);
      const lid = Math.max(la ? lerp(la.prev, la.o, a) : 0, lb ? lerp(lb.prev, lb.o, a) : 0);
      const ang = (1 - Math.pow(1 - lid, 3)) * Math.PI / 2;
      const mat = M4.create();
      M4.translate(mat, x + 0.5, y, z + 0.5); M4.rotY(mat, CHEST_ROT[m & 7] || 0);
      M4.translate(mat, -0.5, 0, -0.5); M4.scale(mat, -1, -1, 1);
      const model = t === 1 ? 'chest_left' : t === 2 ? 'chest_right' : 'chest';
      // (the plain chest's halves are chest_left / chest_right in the assets, the other kinds <base>_left / _right;
      // asking for chest_normal_left fell back to the single chest's texture and each half looked like a chest of its own)
      const base = chestTexBase(b.key), hb = base === 'chest_normal' ? 'chest' : base, tex = t === 1 ? hb + '_left' : t === 2 ? hb + '_right' : base;
      r.drawModel(model, r.beTex(tex) || 'chest_normal', mat, { lid: { rx: ang }, lock: { rx: ang } }, L, env, {});
    }
  }
  r.gl.enable(r.gl.CULL_FACE);
  if (this.signs && this.signs.size) this.drawSignTexts(env);
};

// ---- sign texts (from the server: net.js; signs placed here have none yet) ----
// vanilla's text colours of the dyes
const SIGN_TEXT_RGB = { white: '#FFFFFF', orange: '#FF681F', magenta: '#FF00FF', light_blue: '#9AC0CD', yellow: '#FFFF00', lime: '#BFFF00', pink: '#FF69B4',
  gray: '#808080', light_gray: '#D3D3D3', cyan: '#00FFFF', purple: '#A020F0', blue: '#0000FF', brown: '#8B4513', green: '#00FF00', red: '#FF0000', black: '#000000' };
// a side's text as a texture (96 x 48: the board's 16 x 8 pixels, 4 lines), cached by content
Renderer.prototype.signTextTex = function (side) {
  const key = 'sign:' + side.c + (side.g ? '*' : '') + side.l.join('|');
  if (this.entityTex[key]) return key;
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 48;
  const c = cv.getContext('2d');
  side.l.slice(0, 4).forEach((t, i) => { if (t) Font.center(c, t, 48, 4 + i * 10, SIGN_TEXT_RGB[side.c] || '#000000', false); });
  this.entityTex[key] = this.tex2D(cv, false);
  (this.signTexKeys || (this.signTexKeys = [])).push(key);
  // keep the most recent 256
  while (this.signTexKeys.length > 256) { const k = this.signTexKeys.shift(); this.gl.deleteTexture(this.entityTex[k]); delete this.entityTex[k]; }
  return key;
};
Game.prototype.drawSignTexts = function (env) {
  const r = this.renderer, w = this.world, cam = r.camPos;
  r.initBEModels();
  if (!r.models.be_sign_text) {
    const P = (boxes) => ({ parts: [{ name: 'p', pivot: [0, 0, 0], boxes, mesh: r.makeModelPart(boxes, 16, 8) }] });
    r.models.be_sign_text = P([[0, 0, -8, 9.333, -0.75, 16, 8, 0]]);
    r.models.be_wall_sign_text = P([[0, 0, -8, 4.333, 6.25, 16, 8, 0]]);
    r.models.be_hanging_sign_text = P([[0, 0, -7, 1, -1.05, 14, 8, 0]]);
  }
  r.gl.disable(r.gl.CULL_FACE);
  for (const [k, t] of this.signs) {
    const [x, y, z] = k.split(',').map(Number);
    if ((x - cam[0]) ** 2 + (y - cam[1]) ** 2 + (z - cam[2]) ** 2 > 32 * 32) continue;
    const b = BLOCKS[w.getBlock(x, y, z)];
    if (!b || !b.key.endsWith('sign') || !aabbInFrustum(r.planes, x, y, z, x + 1, y + 1, z + 1)) continue;
    const st = (b.states && b.states[w.getMeta(x, y, z)]) || {};
    const wall = b.key.includes('wall'), hanging = b.key.includes('hanging');
    const deg = st.rotation !== undefined ? +st.rotation * 22.5 : FACING_DEG[st.facing] ?? 0;
    const model = hanging ? 'be_hanging_sign_text' : wall ? 'be_wall_sign_text' : 'be_sign_text';
    const l = w.getLight(x, y, z);
    for (const [side, flip] of [[t.f, 0], [t.b, Math.PI]]) {
      if (!side || !side.l.some(Boolean) || (wall && !hanging && flip)) continue;
      const m = M4.create(); M4.translate(m, x + 0.5, y, z + 0.5); M4.rotY(m, beYaw(deg) + flip);
      const tex = r.signTextTex(side);
      r.drawModel(model, tex, m, null, side.g ? [1, 1] : [(l >> 4) / 15, (l & 15) / 15], env, { bright: side.g });
    }
  }
  r.gl.enable(r.gl.CULL_FACE);
};
// the blocks drawn above (filled once the blocks exist)
const BE_IDS = [];
for (const b of BLOCKS) if (b && b.beRender) BE_IDS.push(b.id);

// bells (vanilla BellRenderer): the block model is only the frame - the bell itself is this model, drawn the same
// for every attachment; a right click rings it (block.bell.use) and it swings for 50 ticks across the way it was
// struck. It was never drawn and could not be rung (players' feedback 2026-10-31「钟看不见不能敲」)
const BELL_ID = BID.bell;
if (BELL_ID !== undefined) {
  BE_IDS.push(BELL_ID); BLOCKS[BELL_ID].beDraw = true;
  // (vanilla BellBlock's shape: the frame and the bell - BELL_TOP_SHAPE and BELL_BOTTOM_SHAPE - to aim at and bump into)
  const frame = BLOCKS[BELL_ID].boxes;
  BLOCKS[BELL_ID].boxes = (m) => (frame ? frame(m) || [] : []).concat([[5, 6, 5, 11, 13, 11], [4, 4, 4, 12, 6, 12]]);
  BLOCKS[BELL_ID].onUse = function (g, x, y, z) {
    const p = g.player, dx = x + 0.5 - p.pos[0], dz = z + 0.5 - p.pos[2];
    (g.bells || (g.bells = new Map())).set(x + ',' + y + ',' + z, { t: g.tickCount, alongX: Math.abs(dx) >= Math.abs(dz) });
    Sound.ev('block.bell.use', [x + 0.5, y + 0.5, z + 0.5], 2, 1);
    return true;
  };
}
Game.prototype.drawBell = function (x, y, z, L, env, a) {
  const r = this.renderer, m = EM.get(r, 'bell#main'), tex = r.etex('entity/bell/bell_body');
  if (!m || !tex) return;
  EM.reset(m);
  const s = this.bells && this.bells.get(x + ',' + y + ',' + z), f = s ? this.tickCount - s.t + a : 0;
  if (s && f >= 50) this.bells.delete(x + ',' + y + ',' + z);
  const swing = s && f < 50 ? Math.sin(f / Math.PI) / (4 + f / 3) : 0;
  const mat = M4.create(); M4.translate(mat, x, y, z);
  // the swing turns the bell about its top (vanilla: bell_body's pivot, 12 px up)
  if (swing) { M4.translate(mat, 0.5, 0.75, 0.5); if (s.alongX) M4.rotZ(mat, -swing); else M4.rotX(mat, swing); M4.translate(mat, -0.5, -0.75, -0.5); }
  // drawEM turns entity models over (scale -1, -1, 1 and a 1.501 drop); block-entity models are drawn as they are
  M4.translate(mat, 0, 1.501, 0); M4.scale(mat, -1, -1, 1);
  r.drawEM(m, tex, mat, L, env);
  r.gl.disable(r.gl.CULL_FACE);
};

// a block-entity block as an item in a hand or on the ground (banners, chests, heads, pots, shulker boxes ...): its
// block entity model in the item's 0..1 space, like vanilla's special item renderers (it used to be a white cube)
Game.prototype.drawBEItem = function (b, mat, light, env, vp) {
  const r = this.renderer;
  const st = b.states ? Math.max(0, b.states.findIndex(s => (s.rotation === undefined || s.rotation === '0') && (s.facing === undefined || s.facing === 'south' || s.facing === 'up'))) : 0;
  if (b.chestLike) {
    r.initBEModels();
    const m = new Float32Array(mat);
    M4.scale(m, -1, -1, 1); // (the chest model's own south-facing pose, like the world's)
    r.drawModel('chest', r.beTex(chestTexBase(b.key)) || 'chest_normal', m, null, light, env, { vp });
    return;
  }
  r.drawBE(b, st, 0, 0, 0, light, env, { vp, base: mat });
};

// ---- the book on a lectern and over an enchanting table (vanilla LecternRenderer, EnchantTableRenderer, BookModel) ----
const BOOK_BLOCKS = new Set(['lectern', 'enchanting_table'].map((k) => BID[k]).filter((id) => id !== undefined));
BE_IDS.push(...BOOK_BLOCKS);
// Direction.getClockWise().toYRot() of a lectern's facing
const BOOK_CW_YROT = { north: 270, east: 0, south: 90, west: 180 };
// BookModel.setupAnim: the covers and pages open by `open`, the two loose pages turned by the flips
function bookPose(m, time, rightFlip, leftFlip, open) {
  EM.reset(m);
  const P = m.parts, f = (Math.sin(time * 0.02) * 0.1 + 1.25) * open, s = Math.sin(f);
  P.left_lid.yRot = Math.PI + f; P.right_lid.yRot = -f; P.left_pages.yRot = f; P.right_pages.yRot = -f;
  P.flip_page1.yRot = f - f * 2 * rightFlip; P.flip_page2.yRot = f - f * 2 * leftFlip;
  P.left_pages.x = s; P.right_pages.x = s; P.flip_page1.x = s; P.flip_page2.x = s;
}
// EnchantingTableBlockEntity.bookAnimationTick: opens and turns toward a player within 3 blocks and flips pages,
// otherwise closes and drifts round
function enchBookTick(s, x, y, z, players) {
  s.oOpen = s.open; s.oRot = s.rot;
  let pl = null;
  for (const p of players) if ((p.pos[0] - x - 0.5) ** 2 + (p.pos[1] - y - 0.5) ** 2 + (p.pos[2] - z - 0.5) ** 2 < 9) { pl = p; break; }
  if (pl) {
    s.tRot = Math.atan2(pl.pos[2] - (z + 0.5), pl.pos[0] - (x + 0.5)); s.open += 0.1;
    if (s.open < 0.5 || Math.random() < 1 / 40) { const f1 = s.flipT; do { s.flipT += ((Math.random() * 4) | 0) - ((Math.random() * 4) | 0); } while (f1 === s.flipT); }
  } else { s.tRot += 0.02; s.open -= 0.1; }
  const wrap = (v) => { while (v >= Math.PI) v -= Math.PI * 2; while (v < -Math.PI) v += Math.PI * 2; return v; };
  s.rot = wrap(s.rot); s.tRot = wrap(s.tRot);
  s.rot += wrap(s.tRot - s.rot) * 0.4;
  s.open = clamp(s.open, 0, 1); s.time++;
  s.oFlip = s.flip;
  const f = clamp((s.flipT - s.flip) * 0.4, -0.2, 0.2);
  s.flipA += (f - s.flipA) * 0.9; s.flip += s.flipA;
}
Game.prototype.drawBook = function (b, meta, x, y, z, L, env, a) {
  const r = this.renderer, m = EM.get(r, 'book#main'), tex = r.etex('entity/enchantment/enchanting_table_book');
  if (!m || !tex) return;
  const mat = M4.create(), k = x + ',' + y + ',' + z;
  if (b.key === 'lectern') {
    const be = this.blockEntities && this.blockEntities.get(k);
    if (!(this.net ? this.net.lecternBooks.has(k) : be && be.book)) return;
    const st = (b.states && b.states[meta]) || {};
    M4.translate(mat, x + 0.5, y + 1.0625, z + 0.5);
    M4.rotY(mat, -(BOOK_CW_YROT[st.facing] || 0) * Math.PI / 180);
    M4.rotZ(mat, 67.5 * Math.PI / 180); M4.translate(mat, 0, -0.125, 0);
    bookPose(m, 0, 0.1, 0.9, 1.2);
  } else {
    const books = this.enchBooks || (this.enchBooks = new Map());
    let s = books.get(k);
    if (!s) { s = { time: 0, open: 0, oOpen: 0, rot: 0, oRot: 0, tRot: 0, flip: 0, oFlip: 0, flipT: 0, flipA: 0, at: this.tickCount }; books.set(k, s); if (books.size > 64) books.delete(books.keys().next().value); }
    if (this.tickCount - s.at > 20) s.at = this.tickCount - 20; // (out of view for a while: catch up a second at most)
    if (s.at < this.tickCount) { const players = [this.player, ...(this.net ? [...this.net.ents.values()].filter((e) => e.type === 'player') : [])]; while (s.at < this.tickCount) { enchBookTick(s, x, y, z, players); s.at++; } }
    const t = s.time + a;
    let d = s.rot - s.oRot; while (d >= Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    M4.translate(mat, x + 0.5, y + 0.75 + 0.1 + Math.sin(t * 0.1) * 0.01, z + 0.5);
    M4.rotY(mat, -(s.oRot + d * a)); M4.rotZ(mat, 80 * Math.PI / 180);
    const fl = lerp(s.oFlip, s.flip, a), frac = (v) => v - Math.floor(v);
    bookPose(m, t, clamp(frac(fl + 0.25) * 1.6 - 0.3, 0, 1), clamp(frac(fl + 0.75) * 1.6 - 0.3, 0, 1), lerp(s.oOpen, s.open, a));
  }
  // drawEM turns entity models over (scale -1, -1, 1 and a 1.501 drop); these books are drawn as they are
  M4.translate(mat, 0, 1.501, 0); M4.scale(mat, -1, -1, 1);
  r.drawEM(m, tex, mat, L, env);
  r.gl.disable(r.gl.CULL_FACE); // (drawChests draws with culling off; drawEM turns it back on)
};
