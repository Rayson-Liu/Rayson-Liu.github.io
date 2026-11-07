'use strict';
// ---------------------------------------------------------------------------
// Block & item registry, recipes, smelting
// ---------------------------------------------------------------------------
function T(name) {
  const l = ASSETS.tiles[name];
  if (l === undefined) { console.warn('missing tile', name); return ASSETS.tiles.white; }
  return l;
}

const BLOCKS = new Array(MAX_BLOCKS).fill(null);
const ITEMS = [];          // id -> item def (blocks + items)
const ITEM_KEY = {};       // key -> id
const BID = {};            // block key -> id

// Shape constants
const SH_CUBE = 0, SH_CROSS = 1, SH_LIQUID = 2, SH_BOXES = 3, SH_TORCH = 4, SH_NONE = 5, SH_CROP = 6, SH_CACTUS = 7, SH_MODEL = 8, SH_FIRE = 9;

function defBlock(id, key, cn, o = {}) {
  const shape = o.shape ?? SH_CUBE;
  const b = {
    id, key, cn, shape,
    render: o.render || (shape === SH_CUBE ? 'opaque' : 'cutout'),
    solid: o.solid ?? (shape === SH_CUBE || shape === SH_BOXES || shape === SH_CACTUS || shape === SH_MODEL),
    model: o.model || null, bed: !!o.bed,
    opaque: false,
    light: o.light || 0,
    hardness: o.hardness ?? 1,
    tool: o.tool || null, level: o.level || 0, needsTool: o.needsTool ?? false,
    sound: o.sound || 'stone',
    tint: o.tint || null,
    gravity: !!o.gravity,
    replaceable: !!o.replaceable,
    cullSame: !!o.cullSame,
    drops: o.drops,
    boxes: o.boxes || null,
    climbable: !!o.climbable,
    facing: !!o.facing, axis: !!o.axis, beRender: !!o.beRender, chestLike: !!o.chestLike, be: o.be || null,
    needsSupport: !!o.needsSupport,
    onUse: o.onUse || null,
    flammable: !!o.flammable,
    texFn: o.texFn || null,
    fuel: o.fuel || 0,
    noItem: !!o.noItem,
    icon: o.icon || null,
    damage: o.damage || 0,
    slip: o.slip || 0.6,
    tex: [0, 0, 0, 0, 0, 0], overlay: [0, 0, 0, 0, 0, 0],
    particle: 0,
    slab: !!o.slab, stairs: !!o.stairs, door: !!o.door, trapdoor: !!o.trapdoor, ladder: !!o.ladder, gate: !!o.gate,
    collide: o.collide || null, slow: o.slow || 0, fence: o.fence || null, xp: o.xp || null, portal: !!o.portal,
  };
  b.opaque = o.opaque ?? (shape === SH_CUBE && b.render === 'opaque');
  b.opacity = o.opacity ?? (b.opaque ? 15 : 0);
  const t = o.tex;
  if (o.texFaces) b.tex = o.texFaces.map(T);
  else if (typeof t === 'string') b.tex.fill(T(t));
  else if (t) {
    const side = t.side ? T(t.side) : 0;
    b.tex = [side, side, T(t.bottom || t.top || t.side), T(t.top || t.side), side, side];
    if (t.front) b.texFront = T(t.front);
    if (t.frontOn) b.texFrontOn = T(t.frontOn);
  }
  if (o.overlay) b.overlay = [T(o.overlay), T(o.overlay), 0, 0, T(o.overlay), T(o.overlay)];
  b.particle = o.particle ? T(o.particle) : b.tex[0];
  if (b.texFront && !o.texFn) {
    b.texFn = (face, meta) => (face === (meta & 7) ? ((meta & 8) && b.texFrontOn ? b.texFrontOn : b.texFront) : b.tex[face]);
  }
  BLOCKS[id] = b; BID[key] = id;
  if (!b.noItem) {
    ITEMS[id] = { id, key, cn, block: id, stack: o.stack || 64, fuel: b.fuel, flat: o.flatIcon || null };
    ITEM_KEY[key] = id;
  }
  return b;
}

// ---- helpers for drops -----------------------------------------------------
const drop = (key, n = 1) => () => [[key, n]];
const nothing = () => [];

// Axis textures: logs rotate their texture
function logTex(face, meta) {
  const a = meta & 3; // 0 y, 1 x, 2 z
  const b = this;
  if (a === 0) return b.tex[face];
  if (a === 1) return (face === 0 || face === 1) ? b.tex[3] : b.tex[0];
  return (face === 4 || face === 5) ? b.tex[3] : b.tex[0];
}

// Box shapes (units of 1/16)
const SLAB_BOXES = [[[0, 0, 0, 16, 8, 16]], [[0, 8, 0, 16, 16, 16]], [[0, 0, 0, 16, 16, 16]]];
function stairBoxes(meta) {
  const f = meta & 3, top = meta & 4;
  const base = top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
  const y0 = top ? 0 : 8, y1 = top ? 8 : 16;
  // f: 0 = high side east(+x), 1 = west(-x), 2 = south(+z), 3 = north(-z)
  const step = [[8, y0, 0, 16, y1, 16], [0, y0, 0, 8, y1, 16], [0, y0, 8, 16, y1, 16], [0, y0, 0, 16, y1, 8]][f];
  return [base, step];
}
// collision / selection box = bounds of the vanilla model for this state (doors, trapdoors)
const _modelBoxCache = new Map();
function modelBoxes(b, meta) {
  const k = b.id * 256 + meta;
  let r = _modelBoxCache.get(k);
  if (r) return r;
  if (typeof VM === 'undefined' || !VM.ready) return null;
  const st = vanillaState(b, meta, null);
  const lo = [1, 1, 1], hi = [0, 0, 0];
  for (const qs of VM.select(st.key, st.p, 0)) for (const q of qs) for (const p of q.p) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  r = hi[0] > lo[0] ? [[lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]].map(v => Math.round(v * 16))] : [[0, 0, 0, 16, 16, 16]];
  _modelBoxCache.set(k, r);
  return r;
}
function doorBoxes(meta) {
  const mb = modelBoxes(BLOCKS[69], meta & ~8);
  if (mb) return mb;
  // meta: bits0-1 facing (0 E,1 W,2 S,3 N) bit2 open, bit3 upper
  let f = meta & 3;
  if (meta & 4) f = [2, 3, 1, 0][f];
  return [[[0, 0, 0, 3, 16, 16], [13, 0, 0, 16, 16, 16], [0, 0, 0, 16, 16, 3], [0, 0, 13, 16, 16, 16]][f]];
}
function ladderBoxes(meta) {
  // meta = dir index of the wall it's attached to
  return [{ 0: [0, 0, 0, 2, 16, 16], 1: [14, 0, 0, 16, 16, 16], 4: [0, 0, 0, 16, 16, 2], 5: [0, 0, 14, 16, 16, 16] }[meta] || [0, 0, 0, 16, 16, 2]];
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
defBlock(0, 'air', '空气', { shape: SH_NONE, solid: false, opaque: false, noItem: true, replaceable: true, hardness: 0 });
defBlock(1, 'stone', '石头', { tex: 'stone', hardness: 1.5, tool: 'pickaxe', needsTool: true, drops: drop('cobblestone') });
defBlock(2, 'grass_block', '草方块', { tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_side_base' }, overlay: 'grass_block_side_overlay', tint: 'grass', hardness: 0.6, tool: 'shovel', sound: 'grass', drops: drop('dirt'), particle: 'dirt',
  texFn(face, meta) { return (meta & 1) && face !== 2 && face !== 3 ? T('grass_block_snow') : this.tex[face]; } });
defBlock(3, 'dirt', '泥土', { tex: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'gravel' });
defBlock(4, 'cobblestone', '圆石', { tex: 'cobblestone', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(5, 'oak_planks', '橡木木板', { tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300, flammable: true });
defBlock(6, 'bedrock', '基岩', { tex: 'bedrock', hardness: -1 });
defBlock(7, 'water', '水', { shape: SH_LIQUID, tex: 'water_still', render: 'translucent', solid: false, opacity: 2, hardness: -1, replaceable: true, noItem: true, tint: 'water', cullSame: true });
defBlock(8, 'lava', '熔岩', { shape: SH_LIQUID, tex: 'lava_still', render: 'opaque', solid: false, opacity: 15, light: 15, hardness: -1, replaceable: true, noItem: true, cullSame: true });
defBlock(9, 'sand', '沙子', { tex: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
defBlock(10, 'gravel', '沙砾', { tex: 'gravel', hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true, drops: (m, r) => [[r() < 0.1 ? 'flint' : 'gravel', 1]] });
defBlock(11, 'gold_ore', '金矿石', { tex: 'gold_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('raw_gold') });
defBlock(12, 'iron_ore', '铁矿石', { tex: 'iron_ore', hardness: 3, tool: 'pickaxe', level: 1, needsTool: true, drops: drop('raw_iron') });
defBlock(13, 'coal_ore', '煤矿石', { tex: 'coal_ore', hardness: 3, tool: 'pickaxe', needsTool: true, drops: drop('coal'), xp: 1 });
defBlock(14, 'oak_log', '橡木原木', { tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true });
defBlock(15, 'oak_leaves', '橡树树叶', { tex: 'oak_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', tint: 'foliage',
  drops: (m, r) => { const d = []; if (r() < 0.05) d.push(['oak_sapling', 1]); if (r() < 0.02) d.push(['stick', 1 + (r() * 2 | 0)]); if (r() < 0.02) d.push(['apple', 1]); return d; } });
defBlock(16, 'glass', '玻璃', { tex: 'glass', render: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drops: nothing, cullSame: true });
defBlock(17, 'sandstone', '砂岩', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(18, 'diamond_ore', '钻石矿石', { tex: 'diamond_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('diamond') });
defBlock(19, 'crafting_table', '工作台', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, facing: true, hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 300, onUse: 'crafting' });
defBlock(20, 'furnace', '熔炉', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', frontOn: 'furnace_front_on' }, facing: true, hardness: 3.5, tool: 'pickaxe', needsTool: true, onUse: 'furnace' });
defBlock(21, 'torch', '火把', { shape: SH_TORCH, tex: 'torch', solid: false, light: 14, hardness: 0, sound: 'wood', needsSupport: true, flatIcon: 'torch' });
defBlock(22, 'bricks', '砖块', { tex: 'bricks', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(23, 'stone_bricks', '石砖', { tex: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(24, 'mossy_cobblestone', '苔石', { tex: 'mossy_cobblestone', hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(25, 'bookshelf', '书架', { tex: { top: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', drops: drop('book', 3), fuel: 300 });
defBlock(26, 'tnt', 'TNT', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass' });
defBlock(27, 'glowstone', '荧石', { tex: 'glowstone', light: 15, hardness: 0.3, sound: 'glass', drops: (m, r) => [['glowstone_dust', 2 + (r() * 3 | 0)]] });
defBlock(28, 'obsidian', '黑曜石', { tex: 'obsidian', hardness: 50, tool: 'pickaxe', level: 3, needsTool: true });
defBlock(29, 'iron_block', '铁块', { tex: 'iron_block', hardness: 5, tool: 'pickaxe', level: 1, needsTool: true, sound: 'metal' });
defBlock(30, 'gold_block', '金块', { tex: 'gold_block', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, sound: 'metal' });
defBlock(31, 'diamond_block', '钻石块', { tex: 'diamond_block', hardness: 5, tool: 'pickaxe', level: 2, needsTool: true, sound: 'metal' });
defBlock(32, 'coal_block', '煤炭块', { tex: 'coal_block', hardness: 5, tool: 'pickaxe', needsTool: true, fuel: 16000 });
defBlock(33, 'snow_block', '雪块', { tex: 'snow', hardness: 0.2, tool: 'shovel', needsTool: true, sound: 'snow', drops: drop('snowball', 4) });
// (meta & 7: layers - 1, like vanilla's 1-8; snow on snow adds one - game.js useItem. Before it was always one layer and
// would not stack, players' feedback 2026-10-31)
defBlock(34, 'snow', '雪', { shape: SH_BOXES, boxes: (m) => [[0, 0, 0, 16, 2 * ((m & 7) + 1), 16]], tex: 'snow', render: 'opaque', solid: false, hardness: 0.1, tool: 'shovel', needsTool: true, sound: 'snow', replaceable: true, needsSupport: true, drops: (m) => [['snowball', (m & 7) + 1]] });
defBlock(35, 'ice', '冰', { tex: 'ice', render: 'translucent', opaque: false, opacity: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', drops: nothing, cullSame: true, slip: 0.98 });
defBlock(36, 'clay', '黏土块', { tex: 'clay', hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: drop('clay_ball', 4) });
defBlock(37, 'cactus', '仙人掌', { shape: SH_CACTUS, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, render: 'cutout', hardness: 0.4, sound: 'wool', needsSupport: true, damage: 1 });
defBlock(38, 'sugar_cane', '甘蔗', { shape: SH_CROSS, tex: 'sugar_cane', tint: 'grass', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drops: drop('sugar_cane'), noItem: true });
defBlock(39, 'short_grass', '草', { shape: SH_CROSS, tex: 'short_grass', solid: false, hardness: 0, sound: 'grass', tint: 'grass', replaceable: true, needsSupport: true, drops: (m, r) => r() < 0.125 ? [['wheat_seeds', 1]] : [], flatIcon: 'short_grass' });
defBlock(40, 'fern', '蕨', { shape: SH_CROSS, tex: 'fern', solid: false, hardness: 0, sound: 'grass', tint: 'grass', replaceable: true, needsSupport: true, drops: (m, r) => r() < 0.125 ? [['wheat_seeds', 1]] : [], flatIcon: 'fern' });
const FLOWERS = [['dandelion', '蒲公英'], ['poppy', '虞美人'], ['cornflower', '矢车菊'], ['oxeye_daisy', '滨菊'], ['azure_bluet', '蓝花美耳草'], ['allium', '绒球葱'], ['blue_orchid', '兰花'], ['red_tulip', '红色郁金香'], ['lily_of_the_valley', '铃兰']];
const FLOWER_IDS = [41, 42, 43, 44, 98, 99, 100, 101, 102];
FLOWERS.forEach(([k, cn], i) => defBlock(FLOWER_IDS[i], k, cn, { shape: SH_CROSS, tex: k, solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: k }));
defBlock(45, 'dead_bush', '枯死的灌木', { shape: SH_CROSS, tex: 'dead_bush', solid: false, hardness: 0, sound: 'grass', replaceable: true, needsSupport: true, drops: (m, r) => [['stick', r() * 3 | 0]], flatIcon: 'dead_bush' });
defBlock(46, 'birch_log', '白桦原木', { tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300 });
defBlock(47, 'birch_leaves', '白桦树叶', { tex: 'birch_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', tint: 'birch',
  drops: (m, r) => { const d = []; if (r() < 0.05) d.push(['birch_sapling', 1]); if (r() < 0.02) d.push(['stick', 1]); return d; } });
defBlock(48, 'birch_planks', '白桦木板', { tex: 'birch_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(49, 'spruce_log', '云杉原木', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300 });
defBlock(50, 'spruce_leaves', '云杉树叶', { tex: 'spruce_leaves', render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', tint: 'spruce',
  drops: (m, r) => { const d = []; if (r() < 0.05) d.push(['spruce_sapling', 1]); if (r() < 0.02) d.push(['stick', 1]); return d; } });
defBlock(51, 'spruce_planks', '云杉木板', { tex: 'spruce_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
// chest meta: bits0-2 facing (face index of the front), bit3 unopened loot, bit4 left half, bit5 right half
function chestType(m) { return m & 16 ? 1 : m & 32 ? 2 : 0; }
function chestSeam(m) { // [dx, dz] towards the other half of a double chest
  const t = chestType(m); if (!t) return null;
  const L = { 5: [-1, 0], 4: [1, 0], 1: [0, 1], 0: [0, -1] }[m & 7] || [-1, 0];
  return t === 1 ? L : [-L[0], -L[1]];
}
function chestBoxes(m) {
  const b = [1, 0, 1, 15, 14, 15], s = chestSeam(m);
  if (s) { if (s[0] < 0) b[0] = 0; if (s[0] > 0) b[3] = 16; if (s[1] < 0) b[2] = 0; if (s[1] > 0) b[5] = 16; }
  return [b];
}
defBlock(52, 'chest', '箱子', { shape: SH_BOXES, boxes: chestBoxes, beRender: true, chestLike: true, tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, render: 'opaque', facing: true, hardness: 2.5, tool: 'axe', sound: 'wood', onUse: 'chest', fuel: 300 });
defBlock(53, 'pumpkin', '南瓜', { tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood' });
defBlock(54, 'jack_o_lantern', '南瓜灯', { tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, facing: true, light: 15, hardness: 1, tool: 'axe', sound: 'wood' });
defBlock(55, 'melon', '西瓜', { tex: { top: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', sound: 'wood', drops: (m, r) => [['melon_slice', 3 + (r() * 5 | 0)]] });
defBlock(56, 'smooth_stone', '平滑石头', { tex: 'smooth_stone', hardness: 2, tool: 'pickaxe', needsTool: true });
const slabDrop = (k) => (m) => [[k, (m & 3) === 2 ? 2 : 1]];
defBlock(57, 'smooth_stone_slab', '平滑石台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: { top: 'smooth_stone', side: 'smooth_stone_slab_side' }, render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('smooth_stone_slab') });
defBlock(58, 'oak_slab', '橡木台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'oak_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150, drops: slabDrop('oak_slab') });
defBlock(59, 'cobblestone_slab', '圆石台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'cobblestone', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('cobblestone_slab') });
defBlock(60, 'oak_stairs', '橡木楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'oak_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', stairs: true, fuel: 300 });
defBlock(61, 'cobblestone_stairs', '圆石楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'cobblestone', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(62, 'stone_brick_stairs', '石砖楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'stone_bricks', render: 'opaque', hardness: 1.5, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(63, 'farmland', '耕地', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 15, 16]], tex: { top: 'farmland', side: 'dirt' }, render: 'opaque', hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: drop('dirt'),
  texFn(face, meta) { return face === 3 ? (meta ? T('farmland_moist') : T('farmland')) : this.tex[face]; } });
const WHEAT_TEX = [0, 1, 2, 3, 4, 5, 6, 7].map(i => 'wheat_stage' + i);
defBlock(64, 'wheat', '小麦', { shape: SH_CROP, tex: 'wheat_stage0', solid: false, hardness: 0, sound: 'grass', needsSupport: true, noItem: true,
  texFn(face, meta) { return T(WHEAT_TEX[meta & 7]); },
  drops: (m, r) => (m & 7) >= 7 ? [['wheat', 1], ['wheat_seeds', 1 + (r() * 3 | 0)]] : [['wheat_seeds', 1]] });
defBlock(65, 'oak_sapling', '橡树树苗', { shape: SH_CROSS, tex: 'oak_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'oak_sapling', fuel: 100 });
defBlock(66, 'birch_sapling', '白桦树苗', { shape: SH_CROSS, tex: 'birch_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'birch_sapling', fuel: 100 });
defBlock(67, 'spruce_sapling', '云杉树苗', { shape: SH_CROSS, tex: 'spruce_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'spruce_sapling', fuel: 100 });
defBlock(68, 'ladder', '梯子', { shape: SH_BOXES, boxes: ladderBoxes, tex: 'ladder', render: 'cutout', hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, flatIcon: 'ladder', fuel: 300, ladder: true });
defBlock(69, 'oak_door', '橡木门', { shape: SH_BOXES, boxes: doorBoxes, tex: 'oak_door_bottom', render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', noItem: true, door: true,
  texFn(face, meta) { return (meta & 8) ? T('oak_door_top') : T('oak_door_bottom'); }, drops: drop('oak_door') });
defBlock(70, 'red_mushroom', '红色蘑菇', { shape: SH_CROSS, tex: 'red_mushroom', solid: false, hardness: 0, sound: 'grass', needsSupport: true, flatIcon: 'red_mushroom' });
defBlock(71, 'brown_mushroom', '棕色蘑菇', { shape: SH_CROSS, tex: 'brown_mushroom', solid: false, hardness: 0, sound: 'grass', needsSupport: true, light: 1, flatIcon: 'brown_mushroom' });
defBlock(72, 'andesite', '安山岩', { tex: 'andesite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(73, 'diorite', '闪长岩', { tex: 'diorite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(74, 'granite', '花岗岩', { tex: 'granite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(75, 'deepslate', '深板岩', { tex: { top: 'deepslate_top', side: 'deepslate' }, hardness: 3, tool: 'pickaxe', needsTool: true, sound: 'stone' });
defBlock(76, 'deepslate_coal_ore', '深层煤矿石', { tex: 'deepslate_coal_ore', hardness: 4.5, tool: 'pickaxe', needsTool: true, drops: drop('coal') });
defBlock(77, 'deepslate_iron_ore', '深层铁矿石', { tex: 'deepslate_iron_ore', hardness: 4.5, tool: 'pickaxe', level: 1, needsTool: true, drops: drop('raw_iron') });
defBlock(78, 'deepslate_gold_ore', '深层金矿石', { tex: 'deepslate_gold_ore', hardness: 4.5, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('raw_gold') });
defBlock(79, 'deepslate_diamond_ore', '深层钻石矿石', { tex: 'deepslate_diamond_ore', hardness: 4.5, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('diamond') });
defBlock(80, 'redstone_ore', '红石矿石', { tex: 'redstone_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: (m, r) => [['redstone', 4 + (r() * 2 | 0)]] });
defBlock(81, 'lapis_ore', '青金石矿石', { tex: 'lapis_ore', hardness: 3, tool: 'pickaxe', level: 1, needsTool: true, drops: (m, r) => [['lapis_lazuli', 4 + (r() * 5 | 0)]] });
defBlock(82, 'emerald_ore', '绿宝石矿石', { tex: 'emerald_ore', hardness: 3, tool: 'pickaxe', level: 2, needsTool: true, drops: drop('emerald') });
defBlock(83, 'terracotta', '陶瓦', { tex: 'terracotta', hardness: 1.25, tool: 'pickaxe', needsTool: true });
defBlock(84, 'quartz_block', '石英块', { tex: { top: 'quartz_block_top', side: 'quartz_block_side' }, hardness: 0.8, tool: 'pickaxe', needsTool: true });
defBlock(85, 'sea_lantern', '海晶灯', { tex: 'sea_lantern', light: 15, hardness: 0.3, sound: 'glass' });
defBlock(86, 'prismarine', '海晶石', { tex: 'prismarine', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(87, 'hay_block', '干草块', { tex: { top: 'hay_block_top', side: 'hay_block_side' }, hardness: 0.5, tool: 'hoe', sound: 'grass', drops: drop('wheat', 9), axis: true, texFn: logTex });
defBlock(88, 'moss_block', '苔藓块', { tex: 'moss_block', hardness: 0.1, tool: 'hoe', sound: 'grass' });
defBlock(89, 'mud_bricks', '泥砖', { tex: 'mud_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(90, 'polished_andesite', '磨制安山岩', { tex: 'polished_andesite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(91, 'polished_diorite', '磨制闪长岩', { tex: 'polished_diorite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(92, 'polished_granite', '磨制花岗岩', { tex: 'polished_granite', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(93, 'cracked_stone_bricks', '裂纹石砖', { tex: 'cracked_stone_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(94, 'mossy_stone_bricks', '苔石砖', { tex: 'mossy_stone_bricks', hardness: 1.5, tool: 'pickaxe', needsTool: true });
defBlock(95, 'bone_block', '骨块', { tex: { top: 'bone_block_top', side: 'bone_block_side' }, hardness: 2, tool: 'pickaxe', needsTool: true });
defBlock(96, 'packed_ice', '浮冰', { tex: 'packed_ice', hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drops: nothing });
defBlock(97, 'red_sand', '红沙', { tex: 'red_sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
defBlock(103, 'magma_block', '岩浆块', { tex: 'magma', light: 3, hardness: 0.5, tool: 'pickaxe', needsTool: true, damage: 1 });
defBlock(104, 'dark_oak_planks', '深色橡木木板', { tex: 'dark_oak_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(105, 'jungle_planks', '丛林木板', { tex: 'jungle_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(106, 'acacia_planks', '金合欢木板', { tex: 'acacia_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(107, 'cherry_planks', '樱花木板', { tex: 'cherry_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
defBlock(108, 'lapis_block', '青金石块', { tex: 'lapis_block', hardness: 3, tool: 'pickaxe', level: 1, needsTool: true });
defBlock(109, 'emerald_block', '绿宝石块', { tex: 'emerald_block', hardness: 5, tool: 'pickaxe', level: 2, needsTool: true, sound: 'metal' });
defBlock(110, 'redstone_block', '红石块', { tex: 'redstone_block', hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal' });
defBlock(111, 'note_block', '音符盒', { tex: 'note_block', hardness: 0.8, tool: 'axe', sound: 'wood', onUse: 'note', fuel: 300 });
defBlock(112, 'oak_trapdoor', '橡木活板门', { shape: SH_BOXES, boxes: (m) => modelBoxes(BLOCKS[112], m) || ((m & 4) ? [[0, 0, 13, 16, 16, 16]] : (m & 8 ? [[0, 13, 0, 16, 16, 16]] : [[0, 0, 0, 16, 3, 16]])), tex: 'oak_trapdoor', render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', trapdoor: true, fuel: 300 });
defBlock(113, 'stone_brick_slab', '石砖台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'stone_bricks', render: 'opaque', hardness: 1.5, tool: 'pickaxe', needsTool: true, slab: true, drops: slabDrop('stone_brick_slab') });
defBlock(114, 'brick_stairs', '砖楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'bricks', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, stairs: true });
defBlock(115, 'spruce_stairs', '云杉木楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'spruce_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', stairs: true, fuel: 300 });
defBlock(117, 'lit_furnace', '熔炉', { tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, facing: true, light: 13, hardness: 3.5, tool: 'pickaxe', needsTool: true, onUse: 'furnace', noItem: true, drops: drop('furnace') });
// Bed: vanilla template_bed_head / template_bed_foot elements (head points north at rotation 0)
const BED_HEAD = [
  { from: [0, 3, 0], to: [16, 9, 16], faces: { down: [0, 0, 16, 16, 'bed_down'], up: [0, 0, 16, 16, 'red_bed_head_up'], north: [0, 7, 16, 13, 'bed_head_north'], west: [0, 7, 16, 13, 'red_bed_head_west'], east: [0, 7, 16, 13, 'red_bed_head_east'] } },
  { from: [0, 0, 0], to: [3, 3, 3], faces: { down: [6, 13, 9, 16, 'red_bed_head_west'], north: [13, 13, 16, 16, 'bed_head_north'], south: [3, 13, 6, 16, 'red_bed_head_west'], west: [0, 13, 3, 16, 'red_bed_head_west'], east: [10, 13, 13, 16, 'bed_head_north'] } },
  { from: [13, 0, 0], to: [16, 3, 3], faces: { down: [7, 13, 10, 16, 'red_bed_head_east'], north: [0, 13, 3, 16, 'bed_head_north'], south: [10, 13, 13, 16, 'red_bed_head_east'], west: [3, 13, 6, 16, 'bed_head_north'], east: [13, 13, 16, 16, 'red_bed_head_east'] } },
];
const BED_FOOT = [
  { from: [0, 3, 0], to: [16, 9, 16], faces: { down: [0, 0, 16, 16, 'bed_down'], up: [0, 0, 16, 16, 'red_bed_foot_up'], south: [0, 7, 16, 13, 'red_bed_foot_south'], west: [0, 7, 16, 13, 'red_bed_foot_west'], east: [0, 7, 16, 13, 'red_bed_foot_east'] } },
  { from: [0, 0, 13], to: [3, 3, 16], faces: { down: [7, 13, 10, 16, 'red_bed_foot_west'], north: [10, 13, 13, 16, 'red_bed_foot_west'], south: [0, 13, 3, 16, 'red_bed_foot_south'], west: [13, 13, 16, 16, 'red_bed_foot_west'], east: [3, 13, 6, 16, 'red_bed_foot_south'] } },
  { from: [13, 0, 13], to: [16, 3, 16], faces: { down: [6, 13, 9, 16, 'red_bed_foot_east'], north: [3, 13, 6, 16, 'red_bed_foot_east'], south: [13, 13, 16, 16, 'red_bed_foot_south'], west: [10, 13, 13, 16, 'red_bed_foot_south'], east: [0, 13, 3, 16, 'red_bed_foot_east'] } },
];
for (const els of [BED_HEAD, BED_FOOT]) for (const e of els) for (const f in e.faces) e.faces[f][4] = T(e.faces[f][4]);
// meta: bits0-1 rotation (0 head north, 1 east, 2 south, 3 west), bit2 = head half
defBlock(118, 'red_bed', '红色的床', { shape: SH_MODEL, model: (m) => ({ els: (m & 4) ? BED_HEAD : BED_FOOT, rot: m & 3 }), boxes: () => [[0, 0, 0, 16, 9, 16]],
  tex: 'red_bed_foot_up', render: 'opaque', hardness: 0.2, sound: 'wool', bed: true, stack: 1, particle: 'red_bed_head_up', drops: (m) => (m & 4) ? [] : [['red_bed', 1]] });
// ---- Nether / End / structure blocks -----------------------------------------
function fenceBoxes(m) {
  const b = [[6, 0, 6, 10, 16, 10]];
  if (m & 1) b.push([0, 6, 7, 6, 9, 9], [0, 12, 7, 6, 15, 9]);
  if (m & 2) b.push([10, 6, 7, 16, 9, 9], [10, 12, 7, 16, 15, 9]);
  if (m & 4) b.push([7, 6, 0, 9, 9, 6], [7, 12, 0, 9, 15, 6]);
  if (m & 8) b.push([7, 6, 10, 9, 9, 16], [7, 12, 10, 9, 15, 16]);
  return b;
}
function fenceCollide(m) {
  const b = [[6, 0, 6, 10, 24, 10]];
  if (m & 1) b.push([0, 0, 6, 6, 24, 10]);
  if (m & 2) b.push([10, 0, 6, 16, 24, 10]);
  if (m & 4) b.push([6, 0, 0, 10, 24, 6]);
  if (m & 8) b.push([6, 0, 10, 10, 24, 16]);
  return b;
}
defBlock(119, 'netherrack', '下界岩', { tex: 'netherrack', hardness: 0.4, tool: 'pickaxe', needsTool: true, sound: 'netherrack' });
defBlock(120, 'soul_sand', '灵魂沙', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 16, 16]], collide: () => [[0, 0, 0, 16, 14, 16]], tex: 'soul_sand', render: 'opaque', opaque: true, hardness: 0.5, tool: 'shovel', sound: 'soul_sand', slow: 0.4 });
defBlock(121, 'nether_quartz_ore', '下界石英矿石', { tex: 'nether_quartz_ore', hardness: 3, tool: 'pickaxe', needsTool: true, sound: 'netherrack', drops: drop('quartz'), xp: [2, 5] });
defBlock(122, 'nether_gold_ore', '下界金矿石', { tex: 'nether_gold_ore', hardness: 3, tool: 'pickaxe', needsTool: true, sound: 'netherrack', drops: (m, r) => [['gold_nugget', 2 + (r() * 5 | 0)]], xp: [0, 1] });
defBlock(123, 'nether_bricks', '下界砖块', { tex: 'nether_bricks', hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'nether_bricks' });
defBlock(124, 'nether_brick_fence', '下界砖栅栏', { shape: SH_BOXES, boxes: fenceBoxes, collide: fenceCollide, tex: 'nether_bricks', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'nether_bricks', fence: 'nether' });
defBlock(125, 'nether_brick_stairs', '下界砖楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'nether_bricks', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'nether_bricks', stairs: true });
defBlock(126, 'nether_wart', '下界疣', { shape: SH_CROP, tex: 'nether_wart_stage0', solid: false, hardness: 0, sound: 'grass', needsSupport: true, noItem: true,
  texFn(face, meta) { return T(['nether_wart_stage0', 'nether_wart_stage1', 'nether_wart_stage1', 'nether_wart_stage2'][meta & 3]); },
  drops: (m, r) => [['nether_wart', (m & 3) >= 3 ? 2 + (r() * 3 | 0) : 1]] });
defBlock(127, 'spawner', '刷怪笼', { tex: 'spawner', render: 'cutout', opaque: false, hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal', drops: nothing, xp: [15, 43], noItem: true });
defBlock(170, 'nether_portal', '下界传送门', { shape: SH_BOXES, boxes: (m) => (m & 1) ? [[6, 0, 0, 10, 16, 16]] : [[0, 0, 6, 16, 16, 10]], tex: 'nether_portal', render: 'translucent', solid: false, light: 11, hardness: -1, cullSame: true, noItem: true, drops: nothing, sound: 'glass', portal: true });
defBlock(171, 'fire', '火', { shape: SH_FIRE, tex: 'fire_0', solid: false, light: 15, hardness: 0, replaceable: true, noItem: true, drops: nothing, sound: 'wool' });
defBlock(172, 'end_stone', '末地石', { tex: 'end_stone', hardness: 3, tool: 'pickaxe', needsTool: true });
defBlock(173, 'end_stone_bricks', '末地石砖', { tex: 'end_stone_bricks', hardness: 3, tool: 'pickaxe', needsTool: true });
defBlock(174, 'end_portal_frame', '末地传送门框架', { shape: SH_BOXES, boxes: (m) => (m & 4) ? [[0, 0, 0, 16, 13, 16], [4, 13, 4, 12, 16, 12, T('end_portal_frame_eye')]] : [[0, 0, 0, 16, 13, 16]],
  tex: { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side' }, render: 'opaque', hardness: -1, light: 1, sound: 'glass', drops: nothing });
defBlock(175, 'end_portal', '末地传送门', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 12, 16]], tex: 'end_portal_marker', render: 'opaque', solid: false, light: 15, hardness: -1, noItem: true, drops: nothing });
defBlock(176, 'dragon_egg', '龙蛋', { shape: SH_BOXES, boxes: () => [[6, 15, 6, 10, 16, 10], [5, 14, 5, 11, 15, 11], [4, 13, 4, 12, 14, 12], [3, 11, 3, 13, 13, 13], [2, 8, 2, 14, 11, 14], [1, 3, 1, 15, 8, 15], [2, 1, 2, 14, 3, 14], [3, 0, 3, 13, 1, 13]],
  tex: 'dragon_egg', render: 'opaque', hardness: 3, light: 1, gravity: true, sound: 'stone', stack: 64 });
defBlock(177, 'cobweb', '蜘蛛网', { shape: SH_CROSS, tex: 'cobweb', solid: false, hardness: 4, tool: 'sword', sound: 'wool', slow: 0.25, flatIcon: 'cobweb', drops: () => [['string', 1]] });
defBlock(178, 'oak_fence', '橡木栅栏', { shape: SH_BOXES, boxes: fenceBoxes, collide: fenceCollide, tex: 'oak_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', fence: 'wood', fuel: 300 });
defBlock(179, 'nether_brick_slab', '下界砖台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'nether_bricks', render: 'opaque', hardness: 2, tool: 'pickaxe', needsTool: true, sound: 'nether_bricks', slab: true, drops: slabDrop('nether_brick_slab') });
defBlock(180, 'crying_obsidian', '哭泣的黑曜石', { tex: 'crying_obsidian', light: 10, hardness: 50, tool: 'pickaxe', level: 3, needsTool: true });

defBlock(116, 'birch_slab', '白桦木台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'birch_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150, drops: slabDrop('birch_slab') });

const WOOLS = [['white', '白色'], ['orange', '橙色'], ['magenta', '品红色'], ['light_blue', '淡蓝色'], ['yellow', '黄色'], ['lime', '黄绿色'], ['pink', '粉红色'], ['gray', '灰色'], ['light_gray', '淡灰色'], ['cyan', '青色'], ['purple', '紫色'], ['blue', '蓝色'], ['brown', '棕色'], ['green', '绿色'], ['red', '红色'], ['black', '黑色']];
WOOLS.forEach(([c, cn], i) => defBlock(128 + i, c + '_wool', cn + '羊毛', { tex: c + '_wool', hardness: 0.8, sound: 'wool', tool: 'shears', fuel: 100 }));
const SGLASS = [['white', '白色'], ['orange', '橙色'], ['light_blue', '淡蓝色'], ['yellow', '黄色'], ['lime', '黄绿色'], ['pink', '粉红色'], ['cyan', '青色'], ['purple', '紫色'], ['blue', '蓝色'], ['red', '红色'], ['black', '黑色'], ['green', '绿色']];
SGLASS.forEach(([c, cn], i) => defBlock(144 + i, c + '_stained_glass', cn + '染色玻璃', { tex: c + '_stained_glass', render: 'translucent', opaque: false, hardness: 0.3, sound: 'glass', drops: nothing, cullSame: true }));
const CONCRETE = [['white', '白色'], ['orange', '橙色'], ['yellow', '黄色'], ['lime', '黄绿色'], ['light_blue', '淡蓝色'], ['blue', '蓝色'], ['red', '红色'], ['black', '黑色'], ['gray', '灰色']];
CONCRETE.forEach(([c, cn], i) => defBlock(160 + i, c + '_concrete', cn + '混凝土', { tex: c + '_concrete', hardness: 1.8, tool: 'pickaxe', needsTool: true }));

// ---------------------------------------------------------------------------
// Data-driven blocks (tools/build_blocks.py -> blockdata.js): terrain & vegetation of the
// vanilla 1.18+ generator. Plain cubes use the fast cube path; everything else is drawn from its
// baked vanilla model, with meta = index into the block's list of blockstate property sets.
// ---------------------------------------------------------------------------
const SOUND_GROUP = { basalt: 'basalt', wood: 'wood', cherry_wood: 'wood', mangrove_roots: 'wood', beehive: 'wood', bamboo: 'wood', creaking_heart: 'wood',
  gravel: 'gravel', mud: 'gravel', rooted_dirt: 'gravel', muddy_mangrove_roots: 'gravel', powder_snow: 'snow', glass: 'glass', sand: 'sand' };
const GRASSY = /grass|moss|leaves|sapling|vine|lichen|berry|dripleaf|roots|azalea|blossom|petals|litter|flower|lily_pad|crop|slime/;
// the newer half-transparent blocks that hide faces shared with their own kind (vanilla HalfTransparentBlock /
// PowderSnowBlock skipRendering)
const CULL_SAME_GEN = new Set(['powder_snow', 'tinted_glass', 'slime_block', 'honey_block']);
// the vanilla leaves loot tables without shears or silk touch: the sapling 1/20 (jungle 1/40, mangroves have none),
// sticks 1/50 (1-2), apples 1/200 from oak and dark oak. Without these the newer leaves dropped themselves - every
// decayed leaf an item of leaves
const LEAF_SAPLING = { jungle_leaves: 'jungle_sapling', acacia_leaves: 'acacia_sapling', dark_oak_leaves: 'dark_oak_sapling', cherry_leaves: 'cherry_sapling',
  azalea_leaves: 'azalea', flowering_azalea_leaves: 'flowering_azalea', pale_oak_leaves: 'pale_oak_sapling' };
function leafDrops(key) {
  const sap = LEAF_SAPLING[key], sapChance = key === 'jungle_leaves' ? 1 / 40 : 1 / 20, apple = key === 'dark_oak_leaves';
  return (m, r) => {
    const d = [];
    if (sap && r() < sapChance) d.push([sap, 1]);
    if (r() < 0.02) d.push(['stick', 1 + (r() * 2 | 0)]);
    if (apple && r() < 0.005) d.push(['apple', 1]);
    return d;
  };
}
// walls / panes: selection = model bounds for the connection bits, walls collide 1.5 blocks high
function connBoxes(b, m) { return modelBoxes(b, m) || [[4, 0, 4, 12, 16, 12]]; }
function wallCollide(m) {
  const b = [[4, 0, 4, 12, 24, 12]];
  if (m & 1) b.push([0, 0, 5, 4, 24, 11]);
  if (m & 2) b.push([12, 0, 5, 16, 24, 11]);
  if (m & 4) b.push([5, 0, 0, 11, 24, 4]);
  if (m & 8) b.push([5, 0, 12, 11, 24, 16]);
  return b;
}
// fence gates: solid 1.5 blocks high across the gate's axis while closed
function gateCollide(m) {
  const b = BLOCKS[this.id], s = b && b.states && b.states[m];
  if (!s || s.open === 'true') return [];
  return s.facing === 'east' || s.facing === 'west' ? [[6, 0, 0, 10, 24, 16]] : [[0, 0, 6, 16, 24, 10]];
}
// selection / collision boxes of the block-entity blocks, by kind and state
function entityBoxes(b, m) {
  const st = (b.states && b.states[m]) || {}, f = st.facing;
  const wall = (box) => { // a box against the wall behind a north-facing block, turned to the facing
    const [x0, y0, z0, x1, y1, z1] = box;
    return f === 'south' ? [x0, y0, 16 - z1, x1, y1, 16 - z0] : f === 'west' ? [z0, y0, x0, z1, y1, x1] : f === 'east' ? [16 - z1, y0, x0, 16 - z0, y1, x1] : box;
  };
  switch (b.be) {
    case 'head': return [[4, 0, 4, 12, 8, 12]];
    case 'wall_head': return [wall([4, 4, 8, 12, 12, 16])];
    case 'banner': return [[4, 0, 4, 12, 16, 12]];
    case 'wall_banner': return [wall([0, 0, 14, 16, 12.5, 16])];
    case 'decorated_pot': return [[1, 0, 1, 15, 16, 15]];
    case 'conduit': return [[5, 5, 5, 11, 11, 11]];
    case 'golem_statue': return [[2, 0, 2, 14, 14, 14]];
    case 'invisible': return b.key === 'barrier' ? [[0, 0, 0, 16, 16, 16]] : [];
  }
  return [[0, 0, 0, 16, 16, 16]];
}
function defDataBlock(d) {
  const o = { hardness: d.hardness, tool: d.tool || null, level: d.level || 0, needsTool: !!d.needsTool, light: d.light || 0, fuel: d.fuel || 0,
    damage: d.damage || 0, slip: d.slip || 0.6, climbable: !!d.climbable, replaceable: !!d.replaceable, noItem: !!d.noitem };
  o.sound = d.sound; // a vanilla sound group; audio.js falls back to a similar material when it has no events
  if (d.tint) o.tint = d.tint;
  if (d.drop === 'none') o.drops = nothing;
  else if (d.drop) o.drops = drop(d.drop);
  if (d.ore) { const [a, b] = d.oreCount || [1, 1]; o.drops = (m, r) => [[ITEM_KEY[d.ore] !== undefined ? d.ore : d.key, a + ((r() * (b - a + 1)) | 0)]]; }
  if (d.xp) o.xp = d.xp;
  if (d.kind === 'entity') {
    // drawn by blockents.js; the boxes are for selection and collision
    Object.assign(o, { shape: SH_BOXES, beRender: d.be !== 'invisible', be: d.be, render: 'cutout', opaque: false, opacity: 0, solid: !d.nonsolid, tex: d.particle || 'white' });
    if (d.be === 'chest') Object.assign(o, { facing: true, chestLike: true, boxes: chestBoxes, onUse: d.key === 'ender_chest' ? null : 'chest' });
    else o.boxes = (m) => entityBoxes(BLOCKS[d.id], m);
    const b = defBlock(d.id, d.key, d.cn, o);
    if (d.states && d.be !== 'chest') b.states = d.states;
    if (d.key === 'light') b.stateLight = (d.states || []).map(s => +s.level || 0);
    b.soundGroup = d.sound;
    return b;
  }
  if (d.kind === 'cube') {
    o.texFaces = d.tex;
    if (d.axis) { o.axis = true; o.texFn = logTex; o.flammable = true; }
    if (d.log) o.fuel = /crimson|warped/.test(d.key) ? 0 : 300; // (nether stems and hyphae don't burn in vanilla)
    if (d.leaves) Object.assign(o, { render: 'cutout', opaque: false, opacity: 1, flammable: true, drops: leafDrops(d.key) });
    if (d.translucent) Object.assign(o, { render: 'translucent', opaque: false, opacity: 1 });
    if (d.cutout) Object.assign(o, { render: 'cutout', opaque: false, opacity: 0 });
  } else {
    Object.assign(o, { shape: SH_MODEL, render: d.translucent ? 'translucent' : 'cutout', opaque: false, opacity: 0, particle: d.particle });
    if (d.plant || d.nonsolid) o.solid = false;
    if (d.plant) o.needsSupport = true;
    // built-in behaviours share the legacy blocks' meta layout and shapes
    if (d.stairs) Object.assign(o, { stairs: true, boxes: stairBoxes });
    else if (d.slab) Object.assign(o, { slab: true, boxes: (m) => SLAB_BOXES[m & 3], drops: slabDrop(d.key) });
    else if (d.fence) Object.assign(o, { fence: d.fence, boxes: fenceBoxes, collide: fenceCollide });
    else if (d.wall) Object.assign(o, { fence: 'wall', boxes: (m) => connBoxes(BLOCKS[d.id], m), collide: wallCollide });
    else if (d.pane) Object.assign(o, { fence: 'pane', boxes: (m) => connBoxes(BLOCKS[d.id], m) });
    else if (d.door) Object.assign(o, { door: true, noItem: true, boxes: (m) => modelBoxes(BLOCKS[d.id], m & ~8) || [[0, 0, 0, 16, 16, 3]], drops: (m) => (m & 8) ? [] : [[d.key, 1]] });
    else if (d.trapdoor) Object.assign(o, { trapdoor: true, boxes: (m) => modelBoxes(BLOCKS[d.id], m) || [[0, 0, 0, 16, 3, 16]] });
    else if (d.bed) Object.assign(o, { bed: true, stack: 1, boxes: () => [[0, 0, 0, 16, 9, 16]], drops: (m) => (m & 4) ? [] : [[d.key, 1]] });
    else if (d.gate) Object.assign(o, { gate: true, boxes: (m) => modelBoxes(BLOCKS[d.id], m) || [[0, 0, 6, 16, 16, 10]], collide: gateCollide });
    else o.boxes = (m) => modelBoxes(BLOCKS[d.id], m) || [[0, 0, 0, 16, 16, 16]];
  }
  if (CULL_SAME_GEN.has(d.key)) o.cullSame = true;
  // powder snow's picture has no see-through pixels: drawn as translucent (no depth), its two-sided faces showed
  // through one another - holes in a flat field of it (players' feedback 2026-10-31「细雪显示bug」)
  if (d.key === 'powder_snow') o.render = 'cutout';
  const b = defBlock(d.id, d.key, d.cn, o);
  if (d.states) b.states = d.states;
  // lit / unlit states (candles give 3 per candle)
  if (d.states && d.light && d.states.some(s => 'lit' in s)) b.stateLight = d.states.map(s => s.lit === 'true' ? (s.candles ? 3 * +s.candles : d.light) : 0);
  b.soundGroup = d.sound;
  if (d.tint && d.tint[0] === '#') b.tintRGB = [1, 3, 5].map(i => parseInt(d.tint.slice(i, i + 2), 16));
  return b;
}
for (const d of (self.BLOCK_DATA || [])) defDataBlock(d);
// redstone dust's power (0-15) is part of its vanilla state, but its 81 connection states already fill the meta:
// power 1-15 are blocks of their own (ids 4081-4095, the same model and connections, vanilla's colour for the
// level), so the power is saved with the world. WIRE_ID[p] is the block for power p; BLOCKS[id].wirePower its power.
const WIRE_ID = [];
function wireColor(p) {
  const f = p / 15;
  return [f * 0.6 + (f > 0 ? 0.4 : 0.3), clamp(f * f * 0.7 - 0.5, 0, 1), clamp(f * f * 0.6 - 0.7, 0, 1)].map(v => Math.round(v * 255));
}
if (BID.redstone_wire !== undefined) {
  const w = BLOCKS[BID.redstone_wire];
  Object.assign(w, { tint: 'rgb', tintRGB: wireColor(0), wirePower: 0 }); WIRE_ID[0] = w.id;
  for (let p = 1; p <= 15; p++) { const id = 4080 + p; BLOCKS[id] = Object.assign(Object.create(Object.getPrototypeOf(w)), w, { id, tintRGB: wireColor(p), wirePower: p }); WIRE_ID[p] = id; }
}
if (BID.barrel !== undefined) BLOCKS[BID.barrel].onUse = 'barrel';
// a lily pad can be stood on (its 1.5-pixel box collides, like vanilla); a sweet berry bush slows whoever goes
// through it (players' feedback 2026-10-31)
if (BID.lily_pad !== undefined) BLOCKS[BID.lily_pad].solid = true;
if (BID.sweet_berry_bush !== undefined) BLOCKS[BID.sweet_berry_bush].slow = 0.8;
// plants that only exist under water render (and behave) as if their cell were also water; like vanilla they
// are cutout, so the translucent water drawn after them tints them
for (const k of ['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'sea_pickle', 'tube_coral', 'brain_coral', 'bubble_coral', 'fire_coral', 'horn_coral',
  'tube_coral_fan', 'brain_coral_fan', 'bubble_coral_fan', 'fire_coral_fan', 'horn_coral_fan', 'tube_coral_wall_fan', 'brain_coral_wall_fan', 'bubble_coral_wall_fan', 'fire_coral_wall_fan', 'horn_coral_wall_fan'])
  if (BID[k] !== undefined) Object.assign(BLOCKS[BID[k]], { waterlogged: true, render: 'cutout', solid: false, replaceable: k.includes('seagrass') });

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
// item ids are fixed (tools/item_ids.json, through itemdata.js): saved inventories and chests keep their items
const ITEM_ID_OF = {};
for (const d of (self.ITEM_DATA || [])) if (d.id !== undefined) ITEM_ID_OF[d.key] = d.id;
let nextItem = 256;
function defItem(key, cn, o = {}) {
  const id = ITEM_ID_OF[key] ?? nextItem++;
  const it = Object.assign({ id, key, cn, stack: 64, tex: o.tex !== undefined ? o.tex : T('i_' + (o.texKey || key)) }, o);
  ITEMS[id] = it; ITEM_KEY[key] = id;
  return it;
}
const TOOL_MAT = { wooden: [0, 2, 59, '木'], stone: [1, 4, 131, '石'], iron: [2, 6, 250, '铁'], golden: [0, 12, 32, '金'], diamond: [3, 8, 1561, '钻石'] };
const TOOL_DMG = { sword: [4, 5, 6, 4, 7], axe: [7, 9, 9, 7, 9], pickaxe: [2, 3, 4, 2, 5], shovel: [2.5, 3.5, 4.5, 2.5, 5.5], hoe: [1, 1, 1, 1, 1] };
const TOOL_CN = { pickaxe: '镐', axe: '斧', shovel: '锹', sword: '剑', hoe: '锄' };

defItem('stick', '木棍', { fuel: 100 });
defItem('coal', '煤炭', { fuel: 1600 });
defItem('charcoal', '木炭', { fuel: 1600 });
defItem('raw_iron', '粗铁');
defItem('iron_ingot', '铁锭');
defItem('raw_gold', '粗金');
defItem('gold_ingot', '金锭');
defItem('diamond', '钻石');
defItem('emerald', '绿宝石');
defItem('lapis_lazuli', '青金石');
defItem('redstone', '红石粉');
defItem('flint', '燧石');
defItem('apple', '苹果', { food: [4, 2.4] });
defItem('bread', '面包', { food: [5, 6] });
defItem('wheat', '小麦');
defItem('wheat_seeds', '小麦种子', { places: 'wheat' });
defItem('porkchop', '生猪排', { food: [3, 1.8] });
defItem('cooked_porkchop', '熟猪排', { food: [8, 12.8] });
defItem('beef', '生牛肉', { food: [3, 1.8] });
defItem('cooked_beef', '牛排', { food: [8, 12.8] });
defItem('mutton', '生羊肉', { food: [2, 1.2] });
defItem('cooked_mutton', '熟羊肉', { food: [6, 9.6] });
defItem('chicken', '生鸡肉', { food: [2, 1.2] });
defItem('cooked_chicken', '熟鸡肉', { food: [6, 7.2] });
defItem('rotten_flesh', '腐肉', { food: [4, 0.8] });
defItem('melon_slice', '西瓜片', { food: [2, 1.2] });
defItem('cookie', '曲奇', { food: [2, 0.4] });
defItem('pumpkin_pie', '南瓜派', { food: [8, 4.8] });
defItem('golden_apple', '金苹果', { food: [4, 9.6], heal: 4 });
defItem('baked_potato', '烤马铃薯', { food: [5, 6] });
defItem('carrot', '胡萝卜', { food: [3, 3.6] });
defItem('bone', '骨头');
defItem('bone_meal', '骨粉');
defItem('arrow', '箭');
defItem('bow', '弓', { stack: 1, durability: 384 });
defItem('string', '线');
defItem('gunpowder', '火药');
defItem('feather', '羽毛');
defItem('leather', '皮革');
defItem('egg', '鸡蛋', { stack: 16 });
defItem('snowball', '雪球', { stack: 16 });
defItem('shears', '剪刀', { stack: 1, durability: 238 });
defItem('flint_and_steel', '打火石', { stack: 1, durability: 64 });
defItem('bucket', '桶', { stack: 16 });
defItem('water_bucket', '水桶', { stack: 1, places: 'water' });
defItem('lava_bucket', '熔岩桶', { stack: 1, places: 'lava', fuel: 20000 });
for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond']) {
  const [level, speed, dur, cn] = TOOL_MAT[mat];
  const mi = ['wooden', 'stone', 'iron', 'golden', 'diamond'].indexOf(mat);
  for (const t of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
    defItem(mat + '_' + t, cn + TOOL_CN[t], { stack: 1, durability: dur, tool: { type: t, level, speed }, attack: TOOL_DMG[t][mi], fuel: mat === 'wooden' ? 200 : 0 });
  }
}
defItem('oak_door', '橡木门', { places: 'oak_door', fuel: 200 });
for (const d of (self.BLOCK_DATA || [])) if (d.door) defItem(d.key, d.cn, { places: d.key, fuel: d.fuel || 0 });
defItem('sugar_cane', '甘蔗', { places: 'sugar_cane' });
defItem('sugar', '糖');
defItem('paper', '纸');
defItem('book', '书');
defItem('clay_ball', '黏土球');
defItem('brick', '红砖');
const ARMOR_PTS = { leather: [1, 3, 2, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3] };
const ARMOR_DUR = { leather: 80, iron: 240, diamond: 528 };
const ARMOR_CN = { leather: '皮革', iron: '铁', diamond: '钻石' };
for (const mat of ['leather', 'iron', 'diamond']) {
  ['helmet', 'chestplate', 'leggings', 'boots'].forEach((p, i) => {
    defItem(mat + '_' + p, ARMOR_CN[mat] + ['头盔', '胸甲', '护腿', '靴子'][i], { stack: 1, durability: ARMOR_DUR[mat], armor: { slot: i, points: ARMOR_PTS[mat][i] } });
  });
}

for (const [m, cn] of [['pig', '猪'], ['cow', '牛'], ['sheep', '羊'], ['chicken', '鸡'], ['zombie', '僵尸'], ['skeleton', '骷髅'], ['creeper', '苦力怕'], ['spider', '蜘蛛']]) defItem(m + '_spawn_egg', cn + '刷怪蛋', { spawnEgg: m });

defItem('blaze_rod', '烈焰棒', { fuel: 2400 });
defItem('blaze_powder', '烈焰粉');
defItem('ender_pearl', '末影珍珠', { stack: 16 });
defItem('ender_eye', '末影之眼');
defItem('gold_nugget', '金粒');
defItem('quartz', '下界石英');
defItem('magma_cream', '岩浆膏');
defItem('ghast_tear', '恶魂之泪');
defItem('nether_wart', '下界疣', { places: 'nether_wart' });
defItem('glowstone_dust', '荧石粉');
defItem('nether_brick', '下界砖');
defItem('fire_charge', '火焰弹');
defItem('end_crystal', '末影水晶');
for (const [m, cn] of [['enderman', '末影人'], ['blaze', '烈焰人'], ['ghast', '恶魂'], ['zombified_piglin', '僵尸猪灵'], ['magma_cube', '岩浆怪']]) defItem(m + '_spawn_egg', cn + '刷怪蛋', { spawnEgg: m });

// the rest of vanilla's items (tools/build_items.py -> itemdata.js); behaviour comes later, these show and stack
// like vanilla's. Defined here so later files (merchant.js, nether_mobs.js ...) can still add to them.
for (const d of (self.ITEM_DATA || [])) {
  if (d.id === undefined || ITEM_KEY[d.key] !== undefined) continue;
  const o = { stack: d.stack, tex: d.tex ? T(d.tex) : T('white') };
  if (d.dur) o.durability = d.dur;
  if (d.places) o.places = d.places;
  defItem(d.key, d.cn, o);
}
for (const d of (self.ITEM_DATA || [])) {
  const it = ITEMS[ITEM_KEY[d.key]]; if (!it) continue;
  it.stack = d.stack; it.tab = d.tab;
  // what it places, for the hand-written items without it (redstone dust placed nothing: players' feedback 2026-10-31)
  if (d.places && !it.places && it.block === undefined) it.places = d.places;
  // enchantability, what repairs it in an anvil, rarity, an enchantment glint of its own (enchanted golden apple ...)
  if (d.ench) it.enchantability = d.ench;
  if (d.rep) it.repair = d.rep;
  if (d.rar) it.rarity = d.rar;
  if (d.glint) it.glint = true;
}
// vanilla's tool tiers ([mining level, speed]) and attack damage, armour materials ([points by slot], toughness),
// for every tool and piece of armour (the hand-written ones included)
const TOOL_TIER = { wooden: [0, 2], stone: [1, 4], copper: [1, 5], iron: [2, 6], golden: [0, 12], diamond: [3, 8], netherite: [4, 9] };
const TOOL_ATTACK = { sword: [4, 5, 5, 6, 4, 7, 8], axe: [7, 9, 9, 9, 7, 9, 10], pickaxe: [2, 3, 3, 4, 2, 5, 6], shovel: [2.5, 3.5, 3.5, 4.5, 2.5, 5.5, 6.5], hoe: [1, 1, 1, 1, 1, 1, 1], spear: [2, 3, 3, 4, 2, 5, 6] };
const ARMOR_MAT = { leather: [[1, 3, 2, 1], 0], chainmail: [[2, 5, 4, 1], 0], copper: [[2, 4, 3, 1], 0], iron: [[2, 6, 5, 2], 0], golden: [[2, 5, 3, 1], 0], diamond: [[3, 8, 6, 3], 2], netherite: [[3, 8, 6, 3], 3] };
for (const it of ITEMS) {
  if (!it || it.block !== undefined) continue;
  const m = /^(\w+?)_(sword|axe|pickaxe|shovel|hoe|spear|helmet|chestplate|leggings|boots)$/.exec(it.key);
  if (!m) continue;
  const [, mat, kind] = m, ti = Object.keys(TOOL_TIER).indexOf(mat);
  if (TOOL_ATTACK[kind] && TOOL_TIER[mat]) {
    if (kind !== 'spear') it.tool = { type: kind, level: TOOL_TIER[mat][0], speed: TOOL_TIER[mat][1] };
    it.attack = TOOL_ATTACK[kind][ti];
  } else if (ARMOR_MAT[mat]) {
    const slot = ['helmet', 'chestplate', 'leggings', 'boots'].indexOf(kind);
    it.armor = { slot, points: ARMOR_MAT[mat][0][slot], tough: ARMOR_MAT[mat][1], mat };
  }
}
if (ITEM_KEY.turtle_helmet !== undefined) ITEMS[ITEM_KEY.turtle_helmet].armor = { slot: 0, points: 2, tough: 0, mat: 'turtle' };
if (ITEM_KEY.elytra !== undefined) ITEMS[ITEM_KEY.elytra].armor = { slot: 1, points: 0, tough: 0, mat: 'elytra' };
// 26.2's own attack damage and speed (itemdata.js: from the item components), the mace, spears and trident included
for (const d of (self.ITEM_DATA || [])) { const it = ITEMS[ITEM_KEY[d.key]]; if (it && d.atk) { it.attack = d.atk; it.attackSpeed = d.aspd; } }
// standing block -> its wall form (placed against a block's side)
const WALL_FORM = {}, IS_WALL_FORM = new Set();
for (const k in BID) {
  const w = k.replace(/_hanging_sign$/, '_wall_hanging_sign').replace(/(?<!hanging)_sign$/, '_wall_sign').replace(/_banner$/, '_wall_banner')
    .replace(/_head$/, '_wall_head').replace(/_skull$/, '_wall_skull').replace(/_coral_fan$/, '_coral_wall_fan').replace(/(^|_)torch$/, '$1wall_torch');
  if (w !== k && BID[w] !== undefined) { WALL_FORM[k] = w; IS_WALL_FORM.add(w); }
}
// a wall form drops what its standing form drops (the data gives them no loot: wall torches, signs, banners and heads
// broke into nothing - players' feedback 2026-10-31)
for (const k in WALL_FORM) {
  const wb = BLOCKS[BID[WALL_FORM[k]]], sb = BLOCKS[BID[k]];
  if (wb.drops && !wb.drops(0, () => 0.5).length) wb.drops = (m, r, t) => sb.drops ? sb.drops(0, r, t) : sb.noItem ? [] : [[sb.id, 1]];
}
// a saved stack of an item that no longer exists: the block items whose vanilla item has another name
const LEGACY_ITEM = { cocoa: 'cocoa_beans', sweet_berry_bush: 'sweet_berries', cave_vines: 'glow_berries', cave_vines_plant: 'glow_berries',
  kelp_plant: 'kelp', bamboo_sapling: 'bamboo', tall_seagrass: 'seagrass', powder_snow: 'powder_snow_bucket', big_dripleaf_stem: 'big_dripleaf',
  weeping_vines_plant: 'weeping_vines', twisting_vines_plant: 'twisting_vines', oak_wall_sign: 'oak_sign', spruce_wall_sign: 'spruce_sign' };
function fixSavedStack(s) {
  if (!s || ITEMS[s.id]) return s;
  const b = BLOCKS[s.id], to = b && ITEM_KEY[LEGACY_ITEM[b.key]];
  return to !== undefined ? { ...s, id: to } : null;
}
// two stacks that may merge: the same item, and the same potion (or other data) if they carry one
function sameKind(a, b) {
  return a.id === b.id && (a.pot || '') === (b.pot || '') && (a.x || '') === (b.x || '') && (a.name || '') === (b.name || '') && (a.rc || 0) === (b.rc || 0) && JSON.stringify(a.trim || null) === JSON.stringify(b.trim || null)
    && (!a.e && !b.e || !!a.e && !!b.e && sameEnchants(a, b));
}
function item(key) { const id = ITEM_KEY[key]; if (id === undefined) throw new Error('no item ' + key); return id; }
function itemDef(id) { return ITEMS[id]; }
function makeStack(key, count = 1) { const id = typeof key === 'number' ? key : item(key); return { id, count, dmg: 0 }; }
function maxStack(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
const TAGS = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'dark_oak_planks', 'jungle_planks', 'acacia_planks', 'cherry_planks'],
  coals: ['coal', 'charcoal'],
  stone_tool: ['cobblestone'],
  logs: ['oak_log', 'birch_log', 'spruce_log'],
  wool: ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool', 'brown_wool', 'green_wool', 'red_wool', 'black_wool'],
};
const RECIPES = [];
function shaped(result, count, pattern, keys) {
  const k = {};
  for (const c in keys) k[c] = (TAGS[keys[c]] || [keys[c]]).map(item);
  RECIPES.push({ type: 'shaped', result: item(result), count, pattern, keys: k, w: pattern[0].length, h: pattern.length });
}
function shapeless(result, count, ingredients) {
  RECIPES.push({ type: 'shapeless', result: item(result), count, ing: ingredients.map(i => (TAGS[i] || [i]).map(item)) });
}
shapeless('oak_planks', 4, ['oak_log']);
shapeless('birch_planks', 4, ['birch_log']);
shapeless('spruce_planks', 4, ['spruce_log']);
shaped('stick', 4, ['#', '#'], { '#': 'planks' });
shaped('crafting_table', 1, ['##', '##'], { '#': 'planks' });
shaped('furnace', 1, ['###', '# #', '###'], { '#': 'cobblestone' });
shaped('chest', 1, ['###', '# #', '###'], { '#': 'planks' });
shaped('torch', 4, ['C', '#'], { C: 'coals', '#': 'stick' });
const TOOL_KEYS = { wooden: 'planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const m in TOOL_KEYS) {
  const X = TOOL_KEYS[m];
  shaped(m + '_pickaxe', 1, ['XXX', ' # ', ' # '], { X, '#': 'stick' });
  shaped(m + '_axe', 1, ['XX', 'X#', ' #'], { X, '#': 'stick' });
  shaped(m + '_shovel', 1, ['X', '#', '#'], { X, '#': 'stick' });
  shaped(m + '_sword', 1, ['X', 'X', '#'], { X, '#': 'stick' });
  shaped(m + '_hoe', 1, ['XX', ' #', ' #'], { X, '#': 'stick' });
}
for (const [m, X] of [['leather', 'leather'], ['iron', 'iron_ingot'], ['diamond', 'diamond']]) {
  shaped(m + '_helmet', 1, ['XXX', 'X X'], { X });
  shaped(m + '_chestplate', 1, ['X X', 'XXX', 'XXX'], { X });
  shaped(m + '_leggings', 1, ['XXX', 'X X', 'X X'], { X });
  shaped(m + '_boots', 1, ['X X', 'X X'], { X });
}
shaped('bow', 1, [' #S', '# S', ' #S'], { '#': 'stick', S: 'string' });
shaped('arrow', 4, ['F', '#', 'E'], { F: 'flint', '#': 'stick', E: 'feather' });
shaped('bucket', 1, ['X X', ' X '], { X: 'iron_ingot' });
shaped('shears', 1, [' X', 'X '], { X: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
for (const [b, i] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['coal_block', 'coal'], ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'], ['redstone_block', 'redstone'], ['hay_block', 'wheat']]) {
  shaped(b, 1, ['XXX', 'XXX', 'XXX'], { X: i });
  shapeless(i, 9, [b]);
}
shaped('melon', 1, ['XXX', 'XXX', 'XXX'], { X: 'melon_slice' });
shaped('tnt', 1, ['#S#', 'S#S', '#S#'], { '#': 'gunpowder', S: 'sand' });
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shapeless('sugar', 1, ['sugar_cane']);
shaped('paper', 3, ['###'], { '#': 'sugar_cane' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': 'planks', B: 'book' });
shaped('bricks', 1, ['##', '##'], { '#': 'brick' });
shaped('clay', 1, ['##', '##'], { '#': 'clay_ball' });
shaped('stone_bricks', 4, ['##', '##'], { '#': 'stone' });
shaped('sandstone', 1, ['##', '##'], { '#': 'sand' });
shaped('snow_block', 1, ['##', '##'], { '#': 'snowball' });
shaped('white_wool', 1, ['##', '##'], { '#': 'string' });
shaped('polished_andesite', 4, ['##', '##'], { '#': 'andesite' });
shaped('polished_diorite', 4, ['##', '##'], { '#': 'diorite' });
shaped('polished_granite', 4, ['##', '##'], { '#': 'granite' });
shaped('smooth_stone_slab', 6, ['###'], { '#': 'smooth_stone' });
shaped('oak_slab', 6, ['###'], { '#': 'oak_planks' });
shaped('birch_slab', 6, ['###'], { '#': 'birch_planks' });
shaped('cobblestone_slab', 6, ['###'], { '#': 'cobblestone' });
shaped('stone_brick_slab', 6, ['###'], { '#': 'stone_bricks' });
shaped('oak_stairs', 4, ['#  ', '## ', '###'], { '#': 'oak_planks' });
shaped('spruce_stairs', 4, ['#  ', '## ', '###'], { '#': 'spruce_planks' });
shaped('cobblestone_stairs', 4, ['#  ', '## ', '###'], { '#': 'cobblestone' });
shaped('stone_brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'stone_bricks' });
shaped('brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'bricks' });
shaped('oak_door', 3, ['##', '##', '##'], { '#': 'planks' });
shaped('oak_trapdoor', 2, ['###', '###'], { '#': 'planks' });
shaped('ladder', 3, ['# #', '###', '# #'], { '#': 'stick' });
shaped('red_bed', 1, ['WWW', 'PPP'], { W: 'wool', P: 'planks' });
shapeless('jack_o_lantern', 1, ['pumpkin', 'torch']);
shapeless('bone_meal', 3, ['bone']);
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shaped('mossy_cobblestone', 1, ['#M'], { '#': 'cobblestone', M: 'moss_block' });
shaped('sea_lantern', 1, ['LGL', 'GGG', 'LGL'], { L: 'lapis_lazuli', G: 'glass' });
shaped('note_block', 1, ['###', '#R#', '###'], { '#': 'planks', R: 'redstone' });
shaped('quartz_block', 1, ['##', '##'], { '#': 'quartz' });
shapeless('blaze_powder', 2, ['blaze_rod']);
shapeless('ender_eye', 1, ['ender_pearl', 'blaze_powder']);
shaped('glowstone', 1, ['##', '##'], { '#': 'glowstone_dust' });
shaped('gold_ingot', 1, ['###', '###', '###'], { '#': 'gold_nugget' });
shapeless('gold_nugget', 9, ['gold_ingot']);
shaped('nether_bricks', 1, ['##', '##'], { '#': 'nether_brick' });
shaped('nether_brick_fence', 6, ['#B#', '#B#'], { '#': 'nether_bricks', B: 'nether_brick' });
shaped('nether_brick_stairs', 4, ['#  ', '## ', '###'], { '#': 'nether_bricks' });
shaped('nether_brick_slab', 6, ['###'], { '#': 'nether_bricks' });
shaped('oak_fence', 3, ['#S#', '#S#'], { '#': 'planks', S: 'stick' });
shapeless('fire_charge', 3, ['gunpowder', 'blaze_powder', 'coals']);
shaped('magma_block', 1, ['##', '##'], { '#': 'magma_cream' });
shaped('end_stone_bricks', 4, ['##', '##'], { '#': 'end_stone' });
shaped('end_crystal', 1, ['GGG', 'GEG', 'GTG'], { G: 'glass', E: 'ender_eye', T: 'ghast_tear' });

// Match a crafting grid (array of stacks|null, width w) against recipes
function matchRecipe(grid, w) {
  const h = grid.length / w;
  // find bounding box
  let minX = w, minY = h, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (!n) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== bw || r.h !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++) for (let x = 0; x < bw && ok; x++) {
          const c = r.pattern[y][mirror ? bw - 1 - x : x];
          const s = grid[(minY + y) * w + minX + x];
          if (c === ' ' || c === undefined) { if (s) ok = false; }
          else if (!s || !r.keys[c].includes(s.id)) ok = false;
        }
        if (ok) return r;
      }
    } else {
      if (r.ing.length !== n) continue;
      const used = new Array(r.ing.length).fill(false);
      let ok = true;
      for (const s of grid) {
        if (!s) continue;
        let found = false;
        for (let i = 0; i < r.ing.length; i++) if (!used[i] && r.ing[i].includes(s.id)) { used[i] = true; found = true; break; }
        if (!found) { ok = false; break; }
      }
      if (ok) return r;
    }
  }
  return null;
}

const SMELTING = {};
function smelt(a, b, xp = 0.1) { SMELTING[item(a)] = { result: item(b), xp }; }
smelt('raw_iron', 'iron_ingot', 0.7); smelt('raw_gold', 'gold_ingot', 1); smelt('sand', 'glass'); smelt('red_sand', 'glass');
smelt('cobblestone', 'stone'); smelt('stone', 'smooth_stone'); smelt('clay_ball', 'brick', 0.3); smelt('clay', 'terracotta', 0.35);
smelt('oak_log', 'charcoal', 0.15); smelt('birch_log', 'charcoal', 0.15); smelt('spruce_log', 'charcoal', 0.15);
smelt('porkchop', 'cooked_porkchop', 0.35); smelt('beef', 'cooked_beef', 0.35); smelt('mutton', 'cooked_mutton', 0.35); smelt('chicken', 'cooked_chicken', 0.35);
smelt('stone_bricks', 'cracked_stone_bricks'); smelt('cactus', 'green_concrete' in ITEM_KEY ? 'green_concrete' : 'lime_concrete');
smelt('carrot', 'baked_potato', 0.35);
smelt('netherrack', 'nether_brick', 0.1); smelt('nether_quartz_ore', 'quartz', 0.2); smelt('nether_gold_ore', 'gold_ingot', 1);

// vanilla's recipes (tools/build_recipes.py -> recipedata.js) replace the hand-written ones above: crafting,
// cooking in the furnace / blast furnace / smoker / campfire, the stonecutter and the smithing table
const COOKING = { smelting: SMELTING, blasting: {}, smoking: {}, campfire_cooking: {} }, STONECUTTING = {}, SMITHING = [];
// an ingredient (item key, '#tag' or a list of those) -> the item ids it stands for
function itemIds(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return [...new Set(v.flatMap(itemIds))];
  if (v[0] === '#') return [...new Set(((self.RECIPE_DATA && RECIPE_DATA.tags[v.slice(1)]) || []).flatMap(itemIds))];
  // every item of that name: 47 names are both one of this game's first blocks and the vanilla import (white wool: 128
  // and 1995) - a recipe took only the latter, the wool sheared or mined was the former: no bed (players' feedback
  // 2026-10-31, the most reported)
  if (!itemIds.byKey) { itemIds.byKey = {}; for (const d of ITEMS) if (d && d.key) (itemIds.byKey[d.key] = itemIds.byKey[d.key] || []).push(d.id); }
  const all = itemIds.byKey[v]; if (all) return all.slice();
  const id = ITEM_KEY[v]; return id === undefined ? [] : [id];
}
(function loadRecipes() {
  const D = self.RECIPE_DATA; if (!D) return;
  const ids = itemIds;
  RECIPES.length = 0; for (const k in SMELTING) delete SMELTING[k];
  for (const r of D.crafting) {
    const res = ITEM_KEY[r[1]]; if (res === undefined) continue;
    if (r[0] === 's') {
      const keys = {}; let ok = true;
      for (const c in r[4]) { keys[c] = ids(r[4][c]); if (!keys[c].length) ok = false; }
      if (ok) RECIPES.push({ type: 'shaped', result: res, count: r[2], pattern: r[3], keys, w: r[3][0].length, h: r[3].length });
    } else {
      const ing = r[0] === 'l' ? r[3].map(ids) : [ids(r[2]), ids(r[3])];
      // transmute (dyeing a shulker box or bundle): the result keeps the first ingredient's other data
      if (ing.every(a => a.length)) RECIPES.push({ type: 'shapeless', result: res, count: r[0] === 'l' ? r[2] : 1, ing, keep: r[0] === 't' ? 0 : undefined });
    }
  }
  for (const [kind, i, r, xp, time] of D.cooking) { const res = ITEM_KEY[r]; if (res === undefined) continue; for (const id of ids(i)) COOKING[kind][id] = { result: res, xp, time }; }
  for (const [i, r, n] of D.stonecutting) { const res = ITEM_KEY[r]; if (res === undefined) continue; for (const id of ids(i)) (STONECUTTING[id] = STONECUTTING[id] || []).push({ result: res, count: n }); }
  for (const [t, tp, base, add, r] of D.smithing) SMITHING.push({ trim: t === 'trim', template: ids(tp), base: ids(base), addition: ids(add), result: t === 'trim' ? null : ITEM_KEY[r], pattern: t === 'trim' ? r : null });
})();
// furnaces of each kind cook their own recipes; blast furnaces and smokers twice as fast (fuel lasts half as long)
const FURNACE_KIND = { furnace: 'smelting', lit_furnace: 'smelting', blast_furnace: 'blasting', smoker: 'smoking' };
for (const k of ['blast_furnace', 'smoker']) if (BID[k] !== undefined) BLOCKS[BID[k]].onUse = 'furnace';
// vanilla FuelValues (ticks; 200 smelts one item) for what this game had none for - leaf litter, bamboo, scaffolding,
// carpets, boats, bowls, dried kelp blocks ... (players' feedback 2026-10-31: leaf litter would not burn). Filled in
// once, on the first look-up (every item is defined by then); fuel already set stays. Crimson and warped don't burn
const VANILLA_FUEL = (() => {
  const W = '(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo)';
  const COL = '(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)';
  return [
    [new RegExp(`^(stripped_)?${W}_(log|wood)$|^${W}_planks$|^(stripped_)?bamboo_block$|^bamboo_mosaic(_stairs)?$|^${W}_(stairs|trapdoor|pressure_plate|fence|fence_gate|shelf)$`), 300],
    [/^(note_block|bookshelf|chiseled_bookshelf|lectern|jukebox|chest|trapped_chest|crafting_table|daylight_detector|bow|fishing_rod|ladder|crossbow|loom|barrel|cartography_table|fletching_table|smithing_table|composter|mangrove_roots)$/, 300],
    [new RegExp(`^${COL}_banner$`), 300], [new RegExp(`^${W}_slab$|^bamboo_mosaic_slab$`), 150],
    [new RegExp(`^${W}_hanging_sign$`), 800], [new RegExp(`^${W}_(sign|door)$|^wooden_(shovel|sword|spear|hoe|axe|pickaxe)$`), 200],
    [new RegExp(`^${W}_(chest_)?(boat|raft)$`), 1200], [new RegExp(`^${COL}_wool$|^${W}_button$|_sapling$|^mangrove_propagule$`), 100],
    [/^(stick|bowl|dead_bush|short_dry_grass|tall_dry_grass|azalea|flowering_azalea|leaf_litter)$/, 100],
    [new RegExp(`^${COL}_carpet$`), 67], [/^dried_kelp_block$/, 4001], [/^(bamboo|scaffolding)$/, 50],
  ];
})();
let vanillaFuelDone = false;
function fuelValue(id) {
  if (!vanillaFuelDone) {
    vanillaFuelDone = true;
    for (const d of ITEMS) if (d && !(d.fuel || (BLOCKS[d.id] && BLOCKS[d.id].fuel))) { const r = VANILLA_FUEL.find(([re]) => re.test(d.key)); if (r) d.fuel = r[1]; }
  }
  const d = ITEMS[id]; return d ? (d.fuel || (BLOCKS[id] && BLOCKS[id].fuel) || 0) : 0;
}

// Creative inventory: vanilla's tabs (top row, then bottom row); each item's tab comes from itemdata.js
const CREATIVE_TABS = [
  ['building_blocks', '建筑方块', 'bricks'], ['colored_blocks', '染色方块', 'cyan_wool'], ['natural_blocks', '自然方块', 'grass_block'],
  ['functional_blocks', '功能方块', 'oak_sign'], ['redstone_blocks', '红石方块', 'redstone'], ['tools_and_utilities', '工具与实用物品', 'diamond_pickaxe'],
  ['combat', '战斗用品', 'netherite_sword'], ['food_and_drinks', '食物与饮品', 'golden_apple'], ['ingredients', '原材料', 'iron_ingot'],
  ['spawn_eggs', '刷怪蛋', 'pig_spawn_egg'],
].map(([id, name, icon]) => ({ id, name, icon, get items() { return creativeTabItems(id); } }));
function creativeTabItems(tab) {
  const c = creativeTabItems.cache || (creativeTabItems.cache = {});
  if (!c[tab]) c[tab] = (self.ITEM_DATA || []).filter(d => d.tab === tab && ITEM_KEY[d.key] !== undefined)
    .flatMap(d => /^(potion|splash_potion|lingering_potion|tipped_arrow)$/.test(d.key) && typeof POTIONS !== 'undefined'
      ? Object.keys(POTIONS).filter(p => d.key !== 'tipped_arrow' || POTIONS[p].length).map(pot => ({ key: d.key, pot })) : [d.key]);
  return c[tab];
}

// blocks with vanilla's waterlogged property (from the 26.1 block states), less a double slab
const WATERLOGGABLE_RE = /(_stairs|_slab|_wall|_fence|_pane|_bars|_chain|_trapdoor|_sign|_shelf|_leaves|rail|_candle|_lantern|_coral|_coral_fan|_coral_wall_fan|lightning_rod|_grate|_chest|copper_golem_statue)$|^(candle|lantern|chest|ladder|glow_lichen|resin_clump|barrier|light|dried_ghast|sea_pickle|conduit|scaffolding|campfire|soul_campfire|amethyst_cluster|(large|medium|small)_amethyst_bud|sculk_sensor|calibrated_sculk_sensor|sculk_vein|sculk_shrieker|pointed_dripstone|sulfur_spike|big_dripleaf|big_dripleaf_stem|small_dripleaf|hanging_roots|decorated_pot|heavy_core|mangrove_propagule|mangrove_roots)$/;
let WATERLOGGABLE = null;
function canWaterlog(id, meta) {
  if (!WATERLOGGABLE) {
    WATERLOGGABLE = new Uint8Array(MAX_BLOCKS);
    for (const b of BLOCKS) if (b && WATERLOGGABLE_RE.test(b.key) && !/^(jack_o|sea)_lantern$/.test(b.key)) WATERLOGGABLE[b.id] = 1;
  }
  return !!WATERLOGGABLE[id] && !(BLOCKS[id].slab && (meta & 3) === 2);
}
