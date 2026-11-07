'use strict';
// ---------------------------------------------------------------------------
// Commands in single player, in vanilla's syntax: target selectors (@s @p @a @r @e with type= name= distance= limit=
// sort= x= y= z= dx= dy= dz= tag=), coordinates (absolute, ~relative, ^local), block states (oak_stairs[facing=east]),
// times (10s, 1d), and the commands people use most: gamemode, difficulty, time, weather, give, clear, tp/teleport,
// summon, kill, effect, enchant, xp, setblock, fill, clone, gamerule, spawnpoint, setworldspawn, say, me, msg, tellraw,
// title, playsound, particle, damage, ride, defaultgamemode, tag, random, list, seed, locate, help. The game rules
// (26.2's names, the older camelCase ones too) are kept with the world and act on the game. On a server the server
// runs commands itself (net.js).
// ---------------------------------------------------------------------------
class CmdError extends Error { }
const cmdFail = (m) => { throw new CmdError(m); };

// ---- game rules (GameRules, 26.2 ids) -------------------------------------------------------------------------------------
const GAME_RULES = {
  advance_time: true, advance_weather: true, keep_inventory: false, spawn_mobs: true, spawn_monsters: true, spawn_patrols: true, spawn_phantoms: true,
  spawn_wandering_traders: true, spawn_wardens: true, natural_health_regeneration: true, fall_damage: true, fire_damage: true, drowning_damage: true,
  freeze_damage: true, immediate_respawn: false, show_death_messages: true, mob_griefing: true, raids: true, random_tick_speed: 3, mob_drops: true,
  block_drops: true, entity_drops: true, tnt_explodes: true, send_command_feedback: true, pvp: true, universal_anger: false, forgive_dead_players: true,
  max_entity_cramming: 24, players_sleeping_percentage: 100, spread_vines: true, water_source_conversion: true, lava_source_conversion: false,
  ender_pearls_vanish_on_death: true, projectiles_can_break_blocks: true, show_advancement_messages: true, limited_crafting: false, respawn_radius: 10,
  max_block_modifications: 32768, fire_spread_radius_around_player: 128, locator_bar: true, reduced_debug_info: false, max_snow_accumulation_height: 1,
  command_blocks_work: true, command_block_output: true, max_command_sequence_length: 65536,
};
const RULE_ALIAS = {
  doDaylightCycle: 'advance_time', doWeatherCycle: 'advance_weather', keepInventory: 'keep_inventory', doMobSpawning: 'spawn_mobs', spawnMonsters: 'spawn_monsters',
  doPatrolSpawning: 'spawn_patrols', doInsomnia: 'spawn_phantoms', doTraderSpawning: 'spawn_wandering_traders', doWardenSpawning: 'spawn_wardens',
  naturalRegeneration: 'natural_health_regeneration', fallDamage: 'fall_damage', fireDamage: 'fire_damage', drowningDamage: 'drowning_damage',
  freezeDamage: 'freeze_damage', doImmediateRespawn: 'immediate_respawn', showDeathMessages: 'show_death_messages', mobGriefing: 'mob_griefing',
  randomTickSpeed: 'random_tick_speed', doMobLoot: 'mob_drops', doTileDrops: 'block_drops', doEntityDrops: 'entity_drops', tntExplodes: 'tnt_explodes',
  sendCommandFeedback: 'send_command_feedback', universalAnger: 'universal_anger', forgiveDeadPlayers: 'forgive_dead_players', maxEntityCramming: 'max_entity_cramming',
  playersSleepingPercentage: 'players_sleeping_percentage', doVinesSpread: 'spread_vines', waterSourceConversion: 'water_source_conversion',
  lavaSourceConversion: 'lava_source_conversion', enderPearlsVanishOnDeath: 'ender_pearls_vanish_on_death', projectilesCanBreakBlocks: 'projectiles_can_break_blocks',
  announceAdvancements: 'show_advancement_messages', doLimitedCrafting: 'limited_crafting', spawnRadius: 'respawn_radius', commandModificationBlockLimit: 'max_block_modifications',
  locatorBar: 'locator_bar', reducedDebugInfo: 'reduced_debug_info', snowAccumulationHeight: 'max_snow_accumulation_height',
  commandBlocksEnabled: 'command_blocks_work', commandBlockOutput: 'command_block_output', maxCommandChainLength: 'max_command_sequence_length',
};
// a game rule's value in this world (the default when never set)
Game.prototype.rule = function (k) { const r = this.gameRules; return r && r[k] !== undefined ? r[k] : GAME_RULES[k]; };

// ---- reading arguments --------------------------------------------------------------------------------------------------------
// words, keeping [...] {...} and "..." together
function cmdWords(s) {
  const out = []; let cur = '', depth = 0, q = false;
  for (const c of s) {
    if (q) { cur += c; if (c === '"') q = false; continue; }
    if (c === '"') { q = true; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ' ' && depth <= 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
const stripNs = (s) => String(s || '').replace(/^minecraft:/, '');
const vanillaY = (g) => (g.world && g.world.minY) || 0;
// a position from three words (absolute, ~relative to the source, ^local along its view): internal coordinates
function cmdPos(ctx, a, b, c, centre = false) {
  if ([a, b, c].some((w) => w === undefined)) cmdFail('坐标不完整（需要 x y z）');
  const g = ctx.g, ws = [a, b, c];
  if (ws.some((w) => w[0] === '^')) {
    if (!ws.every((w) => w[0] === '^')) cmdFail('不能混用世界坐标和局部坐标（^）');
    const [l, u, f] = ws.map((w) => parseFloat(w.slice(1)) || 0), y = ctx.rot[0], p = ctx.rot[1];
    const F = [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)], L = [-Math.cos(y), 0, Math.sin(y)];
    const U = [F[1] * L[2] - F[2] * L[1], F[2] * L[0] - F[0] * L[2], F[0] * L[1] - F[1] * L[0]];
    return [0, 1, 2].map((i) => ctx.pos[i] + L[i] * l + U[i] * u + F[i] * f);
  }
  return ws.map((w, i) => {
    if (w[0] === '~') return ctx.pos[i] + (parseFloat(w.slice(1)) || 0);
    const v = parseFloat(w);
    if (isNaN(v)) cmdFail('无效的坐标：' + w);
    // (a whole number for x or z means the middle of that block, like vanilla's Vec3Argument)
    return (i === 1 ? v - vanillaY(g) : v + (centre && i !== 1 && !w.includes('.') ? 0.5 : 0));
  });
}
const cmdBlockPos = (ctx, a, b, c) => cmdPos(ctx, a, b, c).map(Math.floor);
function cmdInt(w, name, min = -Infinity, max = Infinity) {
  const v = Number(w);
  if (!Number.isInteger(v)) cmdFail(`${name}应为整数，实际为 ${w}`);
  if (v < min) cmdFail(`${name}不能小于 ${min}，实际为 ${v}`);
  if (v > max) cmdFail(`${name}不能大于 ${max}，实际为 ${v}`);
  return v;
}
// ticks from a time argument: 100, 100t, 5s, 1d
function cmdTime(w) {
  const m = /^(\d+(?:\.\d+)?)([tsd]?)$/.exec(String(w || ''));
  if (!m) cmdFail('无效的时间：' + w);
  return Math.round(parseFloat(m[1]) * ({ '': 1, t: 1, s: 20, d: 24000 })[m[2]]);
}
// a block and its state: oak_stairs[facing=east,half=top] -> [id, meta]
function cmdBlock(w) {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(String(w || ''));
  if (!m) cmdFail('无效的方块：' + w);
  const key = m[1];
  if (key === 'air' || key === 'cave_air' || key === 'void_air') return [0, 0];
  const alias = typeof STATE_ALIAS !== 'undefined' ? STATE_ALIAS[key] : undefined, id = BID[key] ?? BID[alias];
  if (id === undefined) cmdFail('未知的方块：' + key);
  const b = BLOCKS[id];
  // blocks with vanilla's state list: each property checked; the older hand-made ones (stairs, slabs ...) and the
  // default state: the world importer's mapping (terrain2.js)
  if (m[2] && b.states) {
    let meta = (typeof mapVanillaState === 'function' && (mapVanillaState(key) || [])[1]) || 0;
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=').map((q) => q.trim());
      if (!k) continue;
      if (!b.states.some((st) => k in st)) cmdFail(`方块 ${key} 没有属性 ${k}`);
      const nm = Features.withProp(id, meta, k, v);
      if (!b.states[nm] || b.states[nm][k] !== v) cmdFail(`方块 ${key} 的属性 ${k} 不能为 ${v}`);
      meta = nm;
    }
    return [id, meta];
  }
  const r = typeof mapVanillaState === 'function' ? mapVanillaState(key + (m[2] ? '[' + m[2] + ']' : '')) : null;
  return r || [id, 0];
}
// an item: diamond_sword[enchantments={sharpness:5}] -> a stack of 1 (the enchantments and a custom name are read)
function cmdItem(w) {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(String(w || ''));
  if (!m || ITEM_KEY[m[1]] === undefined) cmdFail('未知的物品：' + stripNs(w));
  const st = { id: ITEM_KEY[m[1]], count: 1, dmg: 0 };
  if (m[2]) {
    const en = /enchantments=\{([^}]*)\}/.exec(m[2]);
    if (en) st.e = en[1].split(',').map((kv) => kv.split(':').map((s) => s.trim().replace(/"/g, ''))).filter((kv) => kv.length >= 2)
      .map((kv) => kv.length === 3 ? [kv[1], +kv[2]] : [stripNs(kv[0]), +kv[1]]).filter(([k]) => typeof ENCH === 'undefined' || ENCH[k]);
    const nm = /custom_name=(?:"([^"]*)"|'([^']*)')/.exec(m[2]);
    if (nm) st.name = nm[1] || nm[2];
  }
  return st;
}
// the type name selectors use
function cmdType(e) {
  if (e instanceof Player) return 'player';
  if (typeof ItemEntity !== 'undefined' && e instanceof ItemEntity) return 'item';
  if (typeof ExperienceOrb !== 'undefined' && e instanceof ExperienceOrb) return 'experience_orb';
  if (e.type) return String(e.type);
  return e.constructor.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}
const cmdName = (g, e) => e === g.player ? (g.playerName || '玩家') : (e.customName || (e.T && e.T.cn) || (typeof ItemEntity !== 'undefined' && e instanceof ItemEntity && e.stack ? ITEMS[e.stack.id].cn : cmdType(e)));
// a selector's arguments: split at the commas outside {} [] and quotes
function cmdSplitArgs(s) {
  const out = []; let cur = '', depth = 0, q = false;
  for (const c of s) {
    if (q) { cur += c; if (c === '"') q = false; continue; }
    if (c === '"') { q = true; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
// a range: 5, ..5, 5.., 1..5
function cmdRange(s) {
  s = String(s);
  const num = (v) => { const n = parseFloat(v); if (isNaN(n)) cmdFail('无效的范围：' + s); return n; };
  if (!s.includes('..')) { const v = num(s); return [v, v]; }
  const [a, b] = s.split('..');
  return [a === '' ? -Infinity : num(a), b === '' ? Infinity : num(b)];
}
// entities picked by a selector or a name
function cmdTargets(ctx, w, opts = {}) {
  const g = ctx.g, p = g.player;
  if (w === undefined) cmdFail('缺少目标');
  if (w[0] !== '@') {
    // a name: the player's, or an entity with that custom name / UUID-less id
    const byName = g.entities.filter((e) => !e.dead && e.customName === w);
    if (byName.length) return byName;
    if (opts.entities === false || w === (g.playerName || '') || /^[A-Za-z0-9_]{1,16}$/.test(w)) return [p];
    cmdFail('未找到实体');
  }
  const m = /^@([parse])(?:\[(.*)\])?$/.exec(w);
  if (!m) cmdFail('无效的选择器：' + w);
  const kind = m[1], args = {};
  if (m[2]) for (const kv of cmdSplitArgs(m[2])) {
    const i = kv.indexOf('='); if (i < 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    (args[k] || (args[k] = [])).push(v);
  }
  const one = (k) => args[k] && args[k][0];
  if (kind === 's') { const s = ctx.src ? ctx.entity : ctx.entity || p; return s ? filterTargets(ctx, [s], args) : []; }
  let list = kind === 'e' ? [p, ...g.entities.filter((e) => !e.dead && !(e.deathTime > 0))] : [p];
  list = filterTargets(ctx, list, args);
  const org = ['x', 'y', 'z'].map((k, i) => one(k) !== undefined ? (i === 1 ? parseFloat(one(k)) - vanillaY(g) : parseFloat(one(k))) : ctx.pos[i]);
  const dist = (e) => Math.hypot(e.pos[0] - org[0], e.pos[1] - org[1], e.pos[2] - org[2]);
  const sort = one('sort') || (kind === 'p' ? 'nearest' : kind === 'r' ? 'random' : 'arbitrary');
  if (sort === 'nearest') list.sort((a, b) => dist(a) - dist(b));
  else if (sort === 'furthest') list.sort((a, b) => dist(b) - dist(a));
  else if (sort === 'random') list.sort(() => Math.random() - 0.5);
  const lim = one('limit') !== undefined ? cmdInt(one('limit'), 'limit', 1) : kind === 'p' || kind === 'r' ? 1 : Infinity;
  return list.slice(0, lim);
}
function filterTargets(ctx, list, args) {
  const g = ctx.g;
  const one = (k) => args[k] && args[k][0];
  const org = ['x', 'y', 'z'].map((k, i) => one(k) !== undefined ? (i === 1 ? parseFloat(one(k)) - vanillaY(g) : parseFloat(one(k))) : ctx.pos[i]);
  for (const t of args.type || []) {
    const neg = t[0] === '!', want = stripNs(neg ? t.slice(1) : t);
    list = list.filter((e) => (cmdType(e) === want) !== neg);
  }
  for (const t of args.name || []) { const neg = t[0] === '!', want = (neg ? t.slice(1) : t).replace(/^"|"$/g, ''); list = list.filter((e) => (cmdName(g, e) === want) !== neg); }
  for (const t of args.tag || []) { const neg = t[0] === '!', want = neg ? t.slice(1) : t; list = list.filter((e) => (want === '' ? !!(e.tags && e.tags.size) : !!(e.tags && e.tags.has(want))) !== neg); }
  if (one('distance')) { const [lo, hi] = cmdRange(one('distance')); list = list.filter((e) => { const d = Math.hypot(e.pos[0] - org[0], e.pos[1] - org[1], e.pos[2] - org[2]); return d >= lo && d <= hi; }); }
  if (['dx', 'dy', 'dz'].some((k) => one(k) !== undefined)) {
    const d = ['dx', 'dy', 'dz'].map((k) => parseFloat(one(k)) || 0);
    const lo = org.map((v, i) => Math.min(v, v + d[i])), hi = org.map((v, i) => Math.max(v, v + d[i]) + 1);
    list = list.filter((e) => { const b = e.box ? e.box() : [e.pos[0], e.pos[1], e.pos[2], e.pos[0], e.pos[1], e.pos[2]]; return b[0] < hi[0] && b[3] > lo[0] && b[1] < hi[1] && b[4] > lo[1] && b[2] < hi[2] && b[5] > lo[2]; });
  }
  for (const t of args.gamemode || []) { const neg = t[0] === '!', want = neg ? t.slice(1) : t; list = list.filter((e) => (e instanceof Player && g.mode === want) !== neg); }
  if (one('level')) { const [lo, hi] = cmdRange(one('level')); list = list.filter((e) => e instanceof Player && g.xpLevel() >= lo && g.xpLevel() <= hi); }
  return list;
}
const needTargets = (list) => { if (!list.length) cmdFail('未找到实体'); return list; };
const needPlayers = (list) => { list = list.filter((e) => e instanceof Player); if (!list.length) cmdFail('未找到玩家'); return list; };

// ---- the commands -------------------------------------------------------------------------------------------------------------
const MODE_CN = { survival: '生存模式', creative: '创造模式', spectator: '旁观模式', adventure: '冒险模式' };
const DIFF_NAMES = ['peaceful', 'easy', 'normal', 'hard'], DIFF_CN = ['和平', '简单', '普通', '困难'];
function cmdMode(w) {
  const m = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative', adventure: 'adventure', a: 'adventure', 2: 'adventure', spectator: 'spectator', sp: 'spectator', 3: 'spectator' }[w];
  if (!m) cmdFail('未知的游戏模式：' + w);
  // (adventure mode isn't a mode of its own here: survival)
  return m === 'adventure' ? 'survival' : m;
}
// removes a block entity left where a block was replaced
function cmdSetBlock(g, x, y, z, id, meta) {
  const w = g.world, k = `${x},${y},${z}`;
  if (g.blockEntities && g.blockEntities.has(k)) g.blockEntities.delete(k);
  // vanilla /setblock and /fill don't check the placed block itself (a lone door half stays, the other half can
  // follow); its neighbours still get their update, and sand still falls
  g.cmdPlaced = k;
  try { w.setBlock(x, y, z, id, meta); } finally { g.cmdPlaced = null; }
}
const CMD_RUN = {
  help() { this.ui.open(new CommandHelpScreen(this)); },
  seed(ctx) { ctx.say('种子：[' + (this.worldMeta ? this.worldMeta.seed : this.world.seed) + ']', '#FFFFFF', true); },
  list(ctx) { ctx.say(`当前共有 1 名玩家在线（最大玩家数为 1）：${this.playerName || '玩家'}`, '#FFFFFF', true); },
  gamemode(ctx, a) {
    if (!a[0]) cmdFail('用法：/gamemode <模式> [目标]');
    const m = cmdMode(a[0]), ts = a[1] ? needPlayers(cmdTargets(ctx, a[1])) : [this.player];
    // (setMode tells the player itself)
    if (m === this.mode) cmdFail('游戏模式未改变'); this.setMode(m);
  },
  defaultgamemode(ctx, a) { const m = cmdMode(a[0]); if (this.worldMeta) this.worldMeta.defaultMode = m; ctx.say(`默认游戏模式现在为${MODE_CN[m]}`); },
  difficulty(ctx, a) {
    if (!a[0]) { ctx.say(`难度为${DIFF_CN[this.difficulty]}`, '#FFFFFF', true); return; }
    const d = DIFF_NAMES.indexOf(a[0]) >= 0 ? DIFF_NAMES.indexOf(a[0]) : ['0', '1', '2', '3'].indexOf(a[0]);
    if (d < 0) cmdFail('无效的难度：' + a[0]);
    if (this.hardcore) cmdFail('极限模式下不能修改难度');
    if (d === this.difficulty) cmdFail(`难度未改变，它已被设置为${DIFF_CN[d]}`);
    this.difficulty = d; ctx.say(`难度已被设置为${DIFF_CN[d]}`);
  },
  time(ctx, a) {
    const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
    if (a[0] === 'set' || a[0] === 'add') {
      const v = named[a[1]] ?? cmdTime(a[1]);
      if (a[0] === 'set') this.worldTime = Math.floor(this.worldTime / 24000) * 24000 + v; else this.worldTime += v;
      ctx.say('已将时间设为 ' + (((this.worldTime % 24000) + 24000) % 24000));
    } else if (a[0] === 'query') {
      const t = a[1] === 'gametime' ? this.tickCount : a[1] === 'day' ? Math.floor(this.worldTime / 24000) : ((this.worldTime % 24000) + 24000) % 24000;
      ctx.say('时间是 ' + t, '#FFFFFF', true);
    } else cmdFail('用法：/time set|add|query …');
  },
  weather(ctx, a) {
    const dur = a[1] ? cmdTime(a[1]) : null;
    if (a[0] === 'clear') { this.rainTarget = 0; this.weather = 0; this.thunder = false; this.weatherTimer = dur ?? 12000 + Math.random() * 168000; ctx.say('天气已设为晴天'); }
    else if (a[0] === 'rain') { this.rainTarget = 1; this.weather = 1; this.thunder = false; this.weatherTimer = dur ?? 12000 + Math.random() * 12000; ctx.say('天气已设为雨天'); }
    else if (a[0] === 'thunder') { this.rainTarget = 1; this.weather = 1; this.thunder = true; this.weatherTimer = dur ?? 3600 + Math.random() * 12000; ctx.say('天气已设为雷暴'); }
    else cmdFail('用法：/weather clear|rain|thunder [时长]');
  },
  give(ctx, a) {
    // (/give <item> [count] still works, as it did here before)
    let ts, iw, cw;
    if (a[0] && (a[0][0] === '@' || (ITEM_KEY[stripNs(a[0]).replace(/\[.*$/, '')] === undefined && a[1]))) { ts = needPlayers(cmdTargets(ctx, a[0])); iw = a[1]; cw = a[2]; }
    else { ts = [this.player]; iw = a[0]; cw = a[1]; }
    const st = cmdItem(iw), n = cw !== undefined ? cmdInt(cw, '数量', 1, 6400) : 1, p = this.player;
    let left = n;
    while (left > 0) { const k = Math.min(left, maxStack(st.id)); const r = p.inv.add({ ...st, count: k }); if (r) this.dropFromPlayer({ ...st, count: r }); left -= k; }
    ctx.say(`已将 ${n} 个 [${ITEMS[st.id].cn}] 给予 ${cmdName(this, p)}`);
  },
  clear(ctx, a) {
    const ts = a[0] ? needPlayers(cmdTargets(ctx, a[0])) : [this.player], st = a[1] ? cmdItem(a[1]) : null, max = a[2] !== undefined ? cmdInt(a[2], '数量', 0) : Infinity;
    const p = this.player; let n = 0;
    for (let i = 0; i < p.inv.slots.length && n < max; i++) {
      const s = p.inv.slots[i]; if (!s || (st && s.id !== st.id)) continue;
      const k = Math.min(s.count, max - n); n += k;
      if (max !== 0) { s.count -= k; if (!s.count) p.inv.slots[i] = null; }
    }
    if (!n) cmdFail(`未在 ${cmdName(this, p)} 身上找到物品`);
    ctx.say(max === 0 ? `在 ${cmdName(this, p)} 身上找到了 ${n} 个匹配的物品` : `已从 ${cmdName(this, p)} 移除 ${n} 个物品`);
  },
  tp(ctx, a) {
    // /tp <destination> | <x y z> [yaw pitch] | <targets> <destination> | <targets> <x y z> [yaw pitch]
    let ts, dest = null, rot = null;
    const isPos = (w) => w !== undefined && /^[~^]?-?[\d.]*$/.test(w);
    if (a.length === 1) { ts = [ctx.entity || this.player]; dest = needTargets(cmdTargets(ctx, a[0]))[0]; }
    else if (a.length >= 3 && isPos(a[0]) && isPos(a[1]) && isPos(a[2])) { ts = [ctx.entity || this.player]; dest = cmdPos(ctx, a[0], a[1], a[2], true); if (a[3] !== undefined) rot = [a[3], a[4]]; }
    else if (a.length === 2) { ts = needTargets(cmdTargets(ctx, a[0])); dest = needTargets(cmdTargets(ctx, a[1]))[0]; }
    else if (a.length >= 4) { ts = needTargets(cmdTargets(ctx, a[0])); dest = cmdPos(ctx, a[1], a[2], a[3], true); if (a[4] !== undefined) rot = [a[4], a[5]]; }
    else cmdFail('用法：/tp <目标> | <x> <y> <z>');
    const to = Array.isArray(dest) ? dest : [...dest.pos];
    for (const e of ts) {
      if (e.vehicle && e.dismount) e.dismount();
      e.pos = [...to]; e.prev = [...to]; if (e.vel) e.vel = [0, 0, 0]; e.fallDist = 0;
      if (!Array.isArray(dest)) { e.yaw = dest.yaw; e.pitch = dest.pitch; }
      if (rot) {
        const ry = (w, cur) => w === undefined ? cur : w[0] === '~' ? cur + (parseFloat(w.slice(1)) || 0) : parseFloat(w);
        // (vanilla yaw: 0 south, 90 west; here 0 is north, radians)
        if (rot[0] !== undefined) e.yaw = rot[0][0] === '~' ? e.yaw - (parseFloat(rot[0].slice(1)) || 0) * Math.PI / 180 : Math.PI - parseFloat(rot[0]) * Math.PI / 180;
        if (rot[1] !== undefined) e.pitch = -ry(rot[1], -e.pitch * 180 / Math.PI) * Math.PI / 180;
      }
    }
    const shown = to.map((v, i) => (v + (i === 1 ? vanillaY(this) : 0)).toFixed(2)).join(', ');
    ctx.say(ts.length === 1 ? `已将 ${cmdName(this, ts[0])} 传送至 ${Array.isArray(dest) ? shown : cmdName(this, dest)}` : `已将 ${ts.length} 个实体传送至 ${Array.isArray(dest) ? shown : cmdName(this, dest)}`);
  },
  summon(ctx, a) {
    const t = stripNs(a[0]);
    if (!t) cmdFail('用法：/summon <实体> [x y z]');
    const pos = a[1] !== undefined ? cmdPos(ctx, a[1], a[2], a[3], true) : (() => { const p = this.player, d = this.lookDir(); return [p.pos[0] + d[0] * 3, p.pos[1] + 0.5, p.pos[2] + d[2] * 3]; })();
    let e = null;
    if (t === 'tnt') e = new PrimedTNT(this, Math.floor(pos[0]), pos[1], Math.floor(pos[2]));
    else if (t === 'lightning_bolt') { this.strikeLightning(pos[0], pos[1], pos[2]); ctx.say('已召唤新的闪电'); return; }
    else if (t === 'ender_dragon') e = new EnderDragon(this, pos[0], pos[1], pos[2]);
    else if (t === 'experience_orb' && typeof ExperienceOrb !== 'undefined') { this.dropXp(pos[0], pos[1], pos[2], 1); ctx.say('已召唤新的经验球'); return; }
    else if (MOB_TYPES[t]) { e = createMob(this, t, pos[0], pos[1], pos[2]); if (e) e.persistent = true; }
    if (!e) cmdFail('无法召唤实体：' + t);
    const nm = /CustomName:"([^"]*)"|CustomName:'([^']*)'/.exec(a.slice(4).join(' '));
    if (nm) e.customName = nm[1] || nm[2];
    if (/NoAI:1b|NoAI:true/.test(a.slice(4).join(' '))) e.noAI = true;
    this.addEntity(e);
    ctx.say('已召唤新的' + cmdName(this, e));
  },
  kill(ctx, a) {
    const ts = needTargets(a[0] ? cmdTargets(ctx, a[0]) : [ctx.entity || this.player]);
    let n = 0;
    for (const e of ts) {
      if (e === this.player) { if (this.mode === 'creative' || this.mode === 'spectator') { e.health = 0; e.die({ type: 'void' }); } else e.hurt(Infinity, { type: 'void', bypass: true }); n++; continue; }
      if (typeof EnderDragon !== 'undefined' && e instanceof EnderDragon) { if (e.deathTime === 0) { e.health = 0; e.deathTime = 1; Sound.ev('entity.ender_dragon.death', e.pos, 10, 1); n++; } continue; }
      if (e instanceof Living) { if (e.deathTime === 0) { e.health = 0; e.die({ type: 'void' }); n++; } }
      else { e.dead = true; n++; }
    }
    ctx.say(n === 1 ? `已清除 ${cmdName(this, ts[0])}` : `已清除 ${n} 个实体`);
  },
  effect(ctx, a) {
    if (a[0] === 'clear') {
      const ts = needTargets(a[1] ? cmdTargets(ctx, a[1]) : [this.player]).filter((e) => e instanceof Living), k = a[2] ? stripNs(a[2]) : null;
      if (k && !EFFECTS[k]) cmdFail('未知的状态效果：' + k);
      let n = 0;
      for (const e of ts) { if (k) { if (e.hasEffect(k)) { e.removeEffect(k); n++; } } else if (e.effects && e.effects.size) { e.clearEffects(); n++; } }
      if (!n) cmdFail('目标没有可移除的效果');
      ctx.say(k ? `已移除 ${ts.length === 1 ? cmdName(this, ts[0]) : ts.length + ' 个目标'} 的 ${EFFECTS[k].cn} 效果` : `已移除 ${ts.length === 1 ? cmdName(this, ts[0]) : ts.length + ' 个目标'} 的所有效果`);
      return;
    }
    if (a[0] !== 'give') cmdFail('用法：/effect give <目标> <效果> [秒数] [等级] [隐藏粒子]  或  /effect clear [目标] [效果]');
    const ts = needTargets(cmdTargets(ctx, a[1])).filter((e) => e instanceof Living), k = stripNs(a[2]);
    if (!EFFECTS[k]) cmdFail('未知的状态效果：' + k);
    const instant = k === 'instant_health' || k === 'instant_damage';
    const secs = a[3] === 'infinite' ? -1 : a[3] !== undefined ? cmdInt(a[3], '秒数', 1, 1000000) : instant ? 1 : 30;
    const amp = a[4] !== undefined ? cmdInt(a[4], '等级', 0, 255) : 0, hide = a[5] === 'true';
    let n = 0;
    for (const e of ts) { e.addEffect(k, amp, secs < 0 ? -1 : instant ? 1 : secs * 20, false); const fx = e.effects && e.effects.get(k); if (fx && hide) fx.hidden = true; n++; }
    if (!n) cmdFail('无法应用此效果（目标对效果免疫，或已有更强的效果）');
    ctx.say(`已将 ${EFFECTS[k].cn} 效果应用于 ${ts.length === 1 ? cmdName(this, ts[0]) : ts.length + ' 个目标'}`);
  },
  enchant(ctx, a) {
    const ts = needTargets(cmdTargets(ctx, a[0])), k = stripNs(a[1]), E = ENCH[k];
    if (!E) cmdFail('未知的魔咒：' + k);
    const lvl = a[2] !== undefined ? cmdInt(a[2], '等级', 1) : 1;
    if (lvl > E.max) cmdFail(`${lvl} 级超过了该魔咒支持的最高等级 ${E.max}`);
    const p = this.player, st = p.inv.held;
    if (!st) cmdFail(`${cmdName(this, p)} 手上没有物品`);
    if (!E.sup.has(st.id) && ITEMS[st.id].key !== 'book') cmdFail(`${ITEMS[st.id].cn} 不支持该魔咒`);
    const cn = (q) => (typeof NET_ENCH_CN !== 'undefined' && NET_ENCH_CN[q]) || q;
    for (const [ek] of st.e || []) if (ek !== k && !enchCompatible(ek, k)) cmdFail(`${cn(k)} 与物品上已有的 ${cn(ek)} 冲突`);
    st.e = [...(st.e || []).filter(([ek]) => ek !== k), [k, lvl]];
    ctx.say(`已将魔咒 ${cn(k)}${E.max === 1 ? '' : ' ' + romanNum(lvl)} 施加于 ${cmdName(this, p)} 的物品上`);
  },
  xp(ctx, a) {
    // (/xp <amount> still works, as before)
    if (a[0] !== undefined && /^-?\d+L?$/i.test(a[0])) { const v = parseInt(a[0]); if (/L$/i.test(a[0])) a = ['add', '@s', String(v), 'levels']; else a = ['add', '@s', String(v)]; }
    const op = a[0], p = this.player;
    if (!['add', 'set', 'query'].includes(op)) cmdFail('用法：/xp add|set|query <目标> [数量] [points|levels]');
    needPlayers(cmdTargets(ctx, a[1] || '@s'));
    const levels = (op === 'query' ? a[2] : a[3]) === 'levels';
    if (op === 'query') { ctx.say(levels ? `${cmdName(this, p)} 拥有 ${this.xpLevel()} 级经验` : `${cmdName(this, p)} 拥有 ${p.xp - this.xpTotalFor(this.xpLevel())} 点经验`, '#FFFFFF', true); return; }
    const n = cmdInt(a[2], '数量');
    const before = this.xpLevel();
    if (levels) {
      const target = op === 'add' ? Math.max(0, before + n) : Math.max(0, n), into = p.xp - this.xpTotalFor(before);
      p.xp = this.xpTotalFor(target) + Math.min(into, this.xpNeeded(target) - 1);
    } else if (op === 'add') p.xp = Math.max(0, p.xp + n);
    else { if (n > this.xpNeeded(before)) cmdFail('经验点数不能超过玩家当前等级所需的点数'); p.xp = this.xpTotalFor(before) + Math.max(0, n); }
    if (this.xpLevel() > before) Sound.ev('entity.player.levelup', p.pos, 0.75, 1);
    ctx.say(op === 'add' ? `已给予 ${cmdName(this, p)} ${n} ${levels ? '级' : '点'}经验` : `已将 ${cmdName(this, p)} 的经验${levels ? '等级' : '点数'}设为 ${n}`);
  },
  setblock(ctx, a) {
    const [x, y, z] = cmdBlockPos(ctx, a[0], a[1], a[2]), [id, meta] = cmdBlock(a[3]), mode = a[4] || 'replace', w = this.world;
    if (y < 0 || y >= HEIGHT || !w.isLoaded(x, z)) cmdFail('该位置尚未加载');
    const old = w.getBlock(x, y, z);
    if (mode === 'keep' && old) cmdFail('无法放置方块');
    if (old === id && w.getMeta(x, y, z) === meta) cmdFail('无法放置方块');
    if (mode === 'destroy' && old) { this.dropBlockLoot(x, y, z, old, w.getMeta(x, y, z), null); this.particles.blockBreak(x, y, z, old, w.getMeta(x, y, z)); }
    cmdSetBlock(this, x, y, z, id, meta); this.flushMesh();
    ctx.say(`已更改位于 ${x}, ${y + vanillaY(this)}, ${z} 的方块`);
  },
  fill(ctx, a) {
    const A = cmdBlockPos(ctx, a[0], a[1], a[2]), B = cmdBlockPos(ctx, a[3], a[4], a[5]), [id, meta] = cmdBlock(a[6]);
    const mode = a[7] || 'replace', filter = mode === 'replace' && a[8] ? cmdBlock(a[8]) : null, w = this.world;
    const lo = A.map((v, i) => Math.min(v, B[i])), hi = A.map((v, i) => Math.max(v, B[i]));
    const vol = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1), max = this.rule('max_block_modifications');
    if (vol > max) cmdFail(`指定区域内的方块太多（最大值为 ${max}，指定值为 ${vol}）`);
    if (lo[1] < 0 || hi[1] >= HEIGHT) cmdFail('该位置超出了世界的范围');
    for (let x = lo[0]; x <= hi[0]; x += 16) for (let z = lo[2]; z <= hi[2]; z += 16) if (!w.isLoaded(x, z)) cmdFail('该位置尚未加载');
    if (!w.isLoaded(hi[0], hi[2])) cmdFail('该位置尚未加载');
    let n = 0;
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const edge = x === lo[0] || x === hi[0] || y === lo[1] || y === hi[1] || z === lo[2] || z === hi[2];
      const old = w.getBlock(x, y, z), om = w.getMeta(x, y, z);
      let nid = id, nm = meta;
      if (mode === 'outline' && !edge) continue;
      if (mode === 'hollow' && !edge) { nid = 0; nm = 0; }
      if (mode === 'keep' && old) continue;
      if (filter && (old !== filter[0] || (a[8].includes('[') && om !== filter[1]))) continue;
      if (old === nid && om === nm) continue;
      if (mode === 'destroy' && old) this.dropBlockLoot(x, y, z, old, om, null);
      cmdSetBlock(this, x, y, z, nid, nm); n++;
    }
    if (!n) cmdFail('没有方块被填充');
    this.flushMesh();
    ctx.say(`成功填充了 ${n} 个方块`);
  },
  clone(ctx, a) {
    const A = cmdBlockPos(ctx, a[0], a[1], a[2]), B = cmdBlockPos(ctx, a[3], a[4], a[5]), D = cmdBlockPos(ctx, a[6], a[7], a[8]), w = this.world;
    const mask = a[9] || 'replace', flow = a[10] || 'normal';
    const lo = A.map((v, i) => Math.min(v, B[i])), hi = A.map((v, i) => Math.max(v, B[i])), size = hi.map((v, i) => v - lo[i] + 1);
    const vol = size[0] * size[1] * size[2], max = this.rule('max_block_modifications');
    if (vol > max) cmdFail(`指定区域内的方块太多（最大值为 ${max}，指定值为 ${vol}）`);
    if (lo[1] < 0 || hi[1] >= HEIGHT || D[1] < 0 || D[1] + size[1] > HEIGHT) cmdFail('该位置超出了世界的范围');
    for (const [x, z] of [[lo[0], lo[2]], [hi[0], hi[2]], [D[0], D[2]], [D[0] + size[0] - 1, D[2] + size[2] - 1]]) if (!w.isLoaded(x, z)) cmdFail('该位置尚未加载');
    const overlap = [0, 1, 2].every((i) => D[i] <= hi[i] && D[i] + size[i] - 1 >= lo[i]);
    if (overlap && flow !== 'force') cmdFail('源区域和目标区域不能重叠');
    const copy = [];
    for (let x = 0; x < size[0]; x++) for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) {
      const sx = lo[0] + x, sy = lo[1] + y, sz = lo[2] + z, id = w.getBlock(sx, sy, sz);
      if (mask === 'masked' && !id) continue;
      if (mask === 'filtered' && a[11] && id !== cmdBlock(a[11])[0]) continue;
      const be = this.blockEntities && this.blockEntities.get(`${sx},${sy},${sz}`);
      copy.push([x, y, z, id, w.getMeta(sx, sy, sz), be ? JSON.parse(JSON.stringify(be)) : null, sx, sy, sz]);
    }
    if (flow === 'move') for (const c of copy) cmdSetBlock(this, c[6], c[7], c[8], 0, 0);
    let n = 0;
    for (const [x, y, z, id, meta, be] of copy) {
      const tx = D[0] + x, ty = D[1] + y, tz = D[2] + z;
      if (ty < 0 || ty >= HEIGHT) continue;
      cmdSetBlock(this, tx, ty, tz, id, meta);
      if (be && this.blockEntities) { be.pos = [tx, ty, tz]; this.blockEntities.set(`${tx},${ty},${tz}`, be); }
      n++;
    }
    this.flushMesh();
    ctx.say(`成功复制了 ${n} 个方块`);
  },
  gamerule(ctx, a) {
    if (!a[0]) cmdFail('用法：/gamerule <规则> [值]');
    const k = RULE_ALIAS[a[0]] || stripNs(a[0]);
    if (!(k in GAME_RULES)) cmdFail('未知的游戏规则：' + a[0]);
    if (a[1] === undefined) { ctx.say(`游戏规则 ${k} 目前为：${this.rule(k)}`, '#FFFFFF', true); return; }
    const def = GAME_RULES[k];
    let v;
    if (typeof def === 'boolean') { if (a[1] !== 'true' && a[1] !== 'false') cmdFail('应为 true 或 false'); v = a[1] === 'true'; }
    else v = cmdInt(a[1], '值', 0);
    (this.gameRules || (this.gameRules = {}))[k] = v;
    ctx.say(`游戏规则 ${k} 已被设置为：${v}`);
  },
  spawnpoint(ctx, a) {
    const p = this.player;
    const pos = a[1] !== undefined ? cmdBlockPos(ctx, a[1], a[2], a[3]) : p.pos.map(Math.floor);
    if (a[0]) needPlayers(cmdTargets(ctx, a[0]));
    p.spawn = pos; p.bedSpawn = false; if (this.dim !== 'overworld') p.spawnDim = this.dim;
    ctx.say(`已将 ${cmdName(this, p)} 的重生点设置为 (${pos[0]}, ${pos[1] + vanillaY(this)}, ${pos[2]})`);
  },
  setworldspawn(ctx, a) {
    const pos = a[0] !== undefined ? cmdBlockPos(ctx, a[0], a[1], a[2]) : this.player.pos.map(Math.floor);
    if (this.worldMeta) this.worldMeta.spawn = pos;
    ctx.say(`已将世界重生点设置为 (${pos[0]}, ${pos[1] + vanillaY(this)}, ${pos[2]})`);
  },
  say(ctx, a) { if (!a.length) cmdFail('用法：/say <消息>'); this.ui.message(`[${ctx.name || this.playerName || '玩家'}] ${a.join(' ')}`); },
  me(ctx, a) { this.ui.message(`* ${ctx.name || this.playerName || '玩家'} ${a.join(' ')}`); },
  msg(ctx, a) {
    if (a.length < 2) cmdFail('用法：/msg <玩家> <消息>');
    needPlayers(cmdTargets(ctx, a[0]));
    const t = a.slice(1).join(' ');
    this.ui.message(`你悄悄地对 ${this.playerName || '玩家'} 说：${t}`, '#AAAAAA'); this.ui.message(`${this.playerName || '玩家'} 悄悄地对你说：${t}`, '#AAAAAA');
  },
  tellraw(ctx, a) {
    needPlayers(cmdTargets(ctx, a[0]));
    const j = a.slice(1).join(' ');
    let comp; try { comp = JSON.parse(j); } catch (e) { comp = j.replace(/^"|"$/g, ''); }
    const parts = [];
    const walk = (c, color) => {
      if (c == null) return;
      if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') { parts.push([String(c), color]); return; }
      if (Array.isArray(c)) { c.forEach((x) => walk(x, color)); return; }
      const col = c.color && (CMD_COLORS[c.color] || (/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null)) || color;
      if (c.text !== undefined) parts.push([String(c.text), col]);
      else if (c.translate) parts.push([c.translate, col]);
      for (const x of c.extra || []) walk(x, col);
    };
    walk(comp, '#FFFFFF');
    // (one colour per line here: the first part's)
    this.ui.message(parts.map((x) => x[0]).join(''), (parts[0] && parts[0][1]) || '#FFFFFF');
  },
  title(ctx, a) {
    needPlayers(cmdTargets(ctx, a[0]));
    const ui = this.ui, op = a[1];
    const text = () => { const j = a.slice(2).join(' '); try { const c = JSON.parse(j); return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? x).join('') : (c.text ?? '') + (c.extra || []).map((x) => x.text ?? x).join(''); } catch (e) { return j.replace(/^"|"$/g, ''); } };
    const t = ui.titleState || (ui.titleState = { fadeIn: 10, stay: 70, fadeOut: 20 });
    if (op === 'title') { t.title = text(); t.start = this.tickCount; if (t.sub === undefined) t.sub = ''; }
    else if (op === 'subtitle') t.sub = text();
    else if (op === 'actionbar') ui.actionBar = { text: text(), t: performance.now() };
    else if (op === 'clear') { t.title = null; }
    else if (op === 'reset') { ui.titleState = { fadeIn: 10, stay: 70, fadeOut: 20 }; }
    else if (op === 'times') { t.fadeIn = cmdTime(a[2]); t.stay = cmdTime(a[3]); t.fadeOut = cmdTime(a[4]); }
    else cmdFail('用法：/title <目标> title|subtitle|actionbar|clear|reset|times …');
    ctx.say(op === 'times' ? '已更改标题显示时间' : op === 'clear' ? '已清除标题' : op === 'reset' ? '已重置标题选项' : '已显示标题');
  },
  playsound(ctx, a) {
    const s = stripNs(a[0]); if (!s) cmdFail('用法：/playsound <声音> [来源] [目标] [x y z] [音量] [音调]');
    if (a[2]) needPlayers(cmdTargets(ctx, a[2]));
    const pos = a[3] !== undefined ? cmdPos(ctx, a[3], a[4], a[5], true) : [...this.player.pos];
    const vol = a[6] !== undefined ? parseFloat(a[6]) : 1, pitch = a[7] !== undefined ? parseFloat(a[7]) : 1;
    if (!Sound.ev(s, pos, vol, pitch) && typeof SOUND_EVENTS !== 'undefined' && !SOUND_EVENTS[s]) cmdFail('未知的声音：' + s);
    ctx.say(`已向 ${cmdName(this, this.player)} 播放声音 ${s}`);
  },
  stopsound(ctx) { if (Sound.stopAll) Sound.stopAll(); ctx.say('已停止所有声音'); },
  particle(ctx, a) {
    const name = stripNs(a[0]); if (!name) cmdFail('用法：/particle <粒子> [x y z] [dx dy dz] [速度] [数量]');
    const pos = a[1] !== undefined ? cmdPos(ctx, a[1], a[2], a[3], true) : [...this.player.pos];
    const d = [a[4], a[5], a[6]].map((v) => parseFloat(v) || 0), speed = parseFloat(a[7]) || 0, count = a[8] !== undefined ? cmdInt(a[8], '数量', 0, 2000) : 1;
    const type = CMD_PARTICLES[name] || name;
    for (let i = 0; i < Math.max(1, count); i++) {
      const g2 = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
      this.particles.spawn(type, pos[0] + d[0] * g2(), pos[1] + d[1] * g2(), pos[2] + d[2] * g2(), (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed);
    }
    ctx.say(`正在显示粒子 ${name}`);
  },
  damage(ctx, a) {
    const ts = needTargets(cmdTargets(ctx, a[0])).filter((e) => e instanceof Living), n = parseFloat(a[1]);
    if (isNaN(n) || n < 0) cmdFail('伤害量无效');
    const type = stripNs(a[2] || 'generic'), src = { type: type === 'generic' ? 'magic' : type };
    if (a[3] === 'by' && a[4]) { const by = cmdTargets(ctx, a[4])[0]; if (by) { src.attacker = by; src.knockFrom = by.pos; } }
    for (const e of ts) e.hurt(n, src);
    ctx.say(`已对 ${ts.length === 1 ? cmdName(this, ts[0]) : ts.length + ' 个实体'} 造成 ${n} 点伤害`);
  },
  ride(ctx, a) {
    const t = needTargets(cmdTargets(ctx, a[0]))[0];
    if (a[1] === 'dismount') { if (t === this.player && t.vehicle) { t.dismount(); ctx.say(`${cmdName(this, t)} 已停止骑乘`); return; } cmdFail('该实体没有在骑乘'); }
    if (a[1] !== 'mount') cmdFail('用法：/ride <目标> mount <载具> | dismount');
    const v = needTargets(cmdTargets(ctx, a[2]))[0];
    if (t !== this.player) cmdFail('这里只有玩家能被设为骑乘');
    if (v === t) cmdFail('实体不能骑乘自己');
    t.mount(v); ctx.say(`${cmdName(this, t)} 开始骑乘 ${cmdName(this, v)}`);
  },
  tag(ctx, a) {
    const ts = needTargets(cmdTargets(ctx, a[0])), op = a[1], name = a[2];
    if (op === 'list') { const all = [...new Set(ts.flatMap((e) => [...(e.tags || [])]))]; ctx.say(all.length ? `${ts.length === 1 ? cmdName(this, ts[0]) : ts.length + ' 个实体'} 共有 ${all.length} 个标签：${all.join(', ')}` : '没有标签', '#FFFFFF', true); return; }
    if (!name) cmdFail('用法：/tag <目标> add|remove|list <名称>');
    let n = 0;
    for (const e of ts) { const s = e.tags || (e.tags = new Set()); if (op === 'add' ? !s.has(name) && s.add(name) : s.delete(name)) n++; }
    if (!n) cmdFail(op === 'add' ? '无法添加标签：目标已有此标签' : '无法移除标签：目标没有此标签');
    ctx.say(`已${op === 'add' ? '为' : '从'} ${ts.length === 1 ? cmdName(this, ts[0]) : n + ' 个实体'} ${op === 'add' ? '添加' : '移除'}标签 ${name}`);
  },
  random(ctx, a) {
    const r = a[1] || a[0]; if (!r) cmdFail('用法：/random value|roll <范围>');
    const [lo, hi] = cmdRange(r); if (!isFinite(lo) || !isFinite(hi) || hi < lo) cmdFail('无效的范围');
    const v = randInt(lo, hi);
    if (a[0] === 'roll') this.ui.message(`${this.playerName || '玩家'} 掷出了 ${v}（从 ${lo} 到 ${hi}）`); else ctx.say('随机数：' + v, '#FFFFFF', true);
  },
};
CMD_RUN.teleport = CMD_RUN.tp; CMD_RUN.tell = CMD_RUN.w = CMD_RUN.msg; CMD_RUN.experience = CMD_RUN.xp; CMD_RUN.gm = CMD_RUN.gamemode;
const CMD_COLORS = { black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA', dark_red: '#AA0000', dark_purple: '#AA00AA', gold: '#FFAA00', gray: '#AAAAAA',
  dark_gray: '#555555', blue: '#5555FF', green: '#55FF55', aqua: '#55FFFF', red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF' };
// vanilla particle names -> this game's
const CMD_PARTICLES = { happy_villager: 'bone_meal', angry_villager: 'smoke', large_smoke: 'smoke', explosion_emitter: 'explosion', poof: 'poof', heart: 'heart', note: 'note',
  flame: 'flame', soul_fire_flame: 'flame', crit: 'crit', enchanted_hit: 'crit', bubble: 'bubble', portal: 'portal', lava: 'lava', smoke: 'smoke', rain: 'rain', effect: 'effect', entity_effect: 'effect' };

// runs one command line (the chat box, without the slash already checked); the commands the old runCommand had
// and these new ones are all here. src: a command block or command block minecart running it (cmdblock.js) - its
// position, its entity for @s (none for a block), its name for /say ("@"), and where feedback and errors go
// (say / fail); then the slash is optional, cheats don't matter, and it returns whether the command succeeded
function cmdExec(g, text, src) {
  const ui = g.ui, p = g.player;
  if (src && text[0] !== '/') text = '/' + text;
  const words = cmdWords(text.slice(1)), cmd = (words[0] || '').replace(/^minecraft:/, ''), a = words.slice(1);
  const ctx = src ? { g, pos: [...src.pos], rot: src.rot || [0, 0], entity: src.entity || null, src, name: src.name, say: (m, color, always = false) => src.say(m, always) }
    : { g, pos: [...p.pos], rot: [p.yaw, p.pitch], entity: p, say: (m, color = '#AAAAAA', always = false) => { if (always || g.rule('send_command_feedback')) ui.message(m, color); } };
  const err = (m) => { if (src) src.fail(m); else ui.message(m, '#FF5555'); return false; };
  if (!src && !g.cheats && !['help', 'seed', 'me', 'msg', 'tell', 'w', 'list', 'trigger', 'random'].includes(cmd)) return err('未知或不完整的命令，错误见下\n…/' + cmd + '<--[此处]');
  const fn = CMD_RUN[cmd];
  if (!fn) return err(`未知或不完整的命令「${cmd}」。输入 /help 查看命令`);
  try { fn.call(g, ctx, a); return true; } catch (e) { if (e instanceof CmdError) return err(e.message); err('执行命令时出现意外错误：' + e.message); console.error(e); return false; }
}

// ---- what the game rules do ---------------------------------------------------------------------------------------------------
(() => {
  // advance_time / advance_weather
  const _tick = Game.prototype.tick;
  Game.prototype.tick = function () {
    const t0 = this.worldTime, w0 = this.weatherTimer;
    const r = _tick.call(this);
    if (!this.net && this.state === 'play') {
      if (this.rule('advance_time') === false && this.worldTime !== t0 && !(this.ui.screen && this.ui.screen.pauses) && this.worldTime === t0 + 1) this.worldTime = t0;
      if (this.rule('advance_weather') === false && w0 !== undefined) this.weatherTimer = w0;
      // a thunderstorm: now and then a bolt within 64 blocks (vanilla ServerLevel.tickThunder: 1 in 100000 per chunk)
      if (this.thunder && this.weather > 0.8 && this.dim === 'overworld' && Math.random() < 1 / 400) {
        const p = this.player, x = Math.floor(p.pos[0] + (Math.random() - 0.5) * 128), z = Math.floor(p.pos[2] + (Math.random() - 0.5) * 128);
        if (this.world.isLoaded(x, z)) this.strikeLightning(x + 0.5, this.world.surfaceY(x, z) + 1, z + 0.5);
      }
      if (!this.rainTarget) this.thunder = false;
    }
    return r;
  };
  // keep_inventory, show_death_messages, immediate_respawn
  const _death = Game.prototype.onPlayerDeath;
  Game.prototype.onPlayerDeath = function (src) {
    const p = this.player;
    if (!this.net && this.rule('keep_inventory')) {
      const keep = p.inv.slots.slice(), xp = p.xp, msgs = this.ui.chat.length;
      p.inv.slots.fill(null);
      const r = _death.call(this, src);
      p.inv.slots = keep; p.xp = xp; this.deathScore = xp;
      if (!this.rule('show_death_messages')) this.ui.chat.length = msgs;
      return r;
    }
    const msgs = this.ui.chat.length, r = _death.call(this, src);
    if (!this.net && !this.rule('show_death_messages')) this.ui.chat.length = msgs;
    if (!this.net && this.rule('immediate_respawn')) setTimeout(() => { if (this.state === 'play' && this.player.deathTime > 0) { this.ui.close(); this.respawn(); } }, 1050);
    return r;
  };
  // fall / fire / drowning / freeze damage
  const _hurt = Player.prototype.hurt;
  Player.prototype.hurt = function (amount, src) {
    const g = this.game, t = src && src.type;
    if (!g.net) {
      if (t === 'fall' && !g.rule('fall_damage')) return false;
      if ((t === 'fire' || t === 'lava' || t === 'hotFloor') && !g.rule('fire_damage')) return false;
      if (t === 'drown' && !g.rule('drowning_damage')) return false;
      if (t === 'freeze' && !g.rule('freeze_damage')) return false;
    }
    return _hurt.call(this, amount, src);
  };
  // natural_health_regeneration: the full-food healing (peaceful's too)
  const _hunger = Player.prototype.hungerTick;
  Player.prototype.hungerTick = function () {
    const g = this.game;
    if (!g.net && !g.rule('natural_health_regeneration')) { const h = this.health; const r = _hunger.call(this); if (this.health > h && !this.creative) this.health = h; return r; }
    return _hunger.call(this);
  };
  // spawn_mobs / spawn_monsters / spawn_phantoms / spawn_wandering_traders
  const _spawn = Game.prototype.spawnMobs;
  Game.prototype.spawnMobs = function () {
    if (!this.rule('spawn_mobs')) return;
    const n0 = this.entities.length, ph = this.trySpawnPhantoms, tr = this.trySpawnTrader;
    if (!this.rule('spawn_phantoms')) this.trySpawnPhantoms = null;
    if (!this.rule('spawn_wandering_traders')) this.trySpawnTrader = null;
    try { _spawn.call(this); } finally { this.trySpawnPhantoms = ph; this.trySpawnTrader = tr; }
    if (!this.rule('spawn_monsters')) for (let i = n0; i < this.entities.length; i++) { const e = this.entities[i]; if (e instanceof Mob && e.T && e.T.hostile) e.dead = true; }
  };
  // random_tick_speed: the random ticks each section gets (vanilla 3)
  const _rt = World.prototype.randomTick;
  World.prototype.randomTick = function (px, pz, rng) {
    const n = this.listener && this.listener.rule ? this.listener.rule('random_tick_speed') : 3;
    if (n === 3) return _rt.call(this, px, pz, rng);
    for (let i = 0; i < Math.floor(n / 3); i++) _rt.call(this, px, pz, rng);
    if (n % 3 && Math.random() < (n % 3) / 3) _rt.call(this, px, pz, rng);
  };
  // mob_drops / block_drops
  const _drop = Game.prototype.dropBlockLoot;
  Game.prototype.dropBlockLoot = function (...a) { if (!this.net && !this.rule('block_drops')) return; return _drop.apply(this, a); };
  // saved with the world
  const _save = Game.prototype.saveWorld;
  Game.prototype.saveWorld = function (quiet) {
    if (this.worldMeta && this.state === 'play') { this.worldMeta.gameRules = this.gameRules || {}; this.worldMeta.thunder = !!this.thunder; }
    return _save.call(this, quiet);
  };
  const _load = Game.prototype.loadWorld;
  Game.prototype.loadWorld = async function (id) {
    this.gameRules = {}; this.thunder = false;
    const r = await _load.call(this, id);
    if (this.worldMeta) { this.gameRules = Object.assign({}, this.worldMeta.gameRules || {}); this.thunder = !!this.worldMeta.thunder; }
    return r;
  };
  const _create = Game.prototype.createWorld;
  // a new world, every mode: keep_inventory on from the start (the user's choice, 2026-11-01; /gamerule and the
  // options can still turn it off); older worlds keep what they had
  Game.prototype.createWorld = function (...a) {
    const fresh = () => ({ keep_inventory: true });
    this.gameRules = fresh(); this.thunder = false;
    const set = () => {
      const r = this.gameRules || (this.gameRules = {}); if (r.keep_inventory === undefined) r.keep_inventory = true;
      if (this.worldMeta) this.worldMeta.gameRules = Object.assign({}, r);
    };
    const r = _create.apply(this, a);
    if (r && r.then) return r.then((v) => { set(); return v; });
    set(); return r;
  };
})();
// mob_drops: no loot or experience from mobs (both kinds of mob drop through dropItem / dropXp while dying)
for (const C of [Mob, VMob]) {
  const _die = C.prototype.die;
  C.prototype.die = function (src) {
    const g = this.game;
    if (!g.net && !g.rule('mob_drops')) { const d = g.dropItem, x = g.dropXp; g.dropItem = () => { }; g.dropXp = () => { }; try { return _die.call(this, src); } finally { g.dropItem = d; g.dropXp = x; } }
    return _die.call(this, src);
  };
}

// ---- lightning (vanilla LightningBolt): a flash and thunder, 5 damage and fire around where it strikes (also
// what the channeling enchantment calls) ----
Game.prototype.strikeLightning = function (x, y, z) {
  const w = this.world;
  this.lightningFlash = 4;
  const p = this.player, d = Math.hypot(p.pos[0] - x, p.pos[2] - z);
  Sound.ev('entity.lightning_bolt.thunder', d < 32 ? [x, y, z] : null, 10000 / 16, 0.8 + Math.random() * 0.2);
  Sound.ev('entity.lightning_bolt.impact', [x, y, z], 2, 0.5 + Math.random() * 0.2);
  for (let i = 0; i < 12; i++) this.particles.spawn('smoke', x + (Math.random() - 0.5), y + Math.random() * 2, z + (Math.random() - 0.5), 0, 0.05, 0);
  if (this.difficulty > 0 && this.rule('fire_spread_radius_around_player') !== 0) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (!w.getBlock(bx, by, bz) && BLOCKS[w.getBlock(bx, by - 1, bz)].solid) w.setBlock(bx, by, bz, 171, 0);
  }
  for (const e of [p, ...this.entities]) {
    if (!(e instanceof Living) || e.dead || e.deathTime) continue;
    if (Math.abs(e.pos[0] - x) > 3 || Math.abs(e.pos[2] - z) > 3 || e.pos[1] < y - 3 || e.pos[1] > y + 6) continue;
    if (e.onLightning && e.onLightning()) continue;
    if (!e.fireproof) e.fire = Math.max(e.fire || 0, 160);
    e.hurt(5, { type: 'lightning' });
  }
  this.flushMesh && this.flushMesh();
};

// ---- /title on the screen (vanilla Gui.renderTitle): fades in, stays, fades out; the subtitle under it ----
(() => {
  // (drawn with the HUD, before the chat: under any open screen, like vanilla)
  const _draw = UI.prototype.drawChat;
  UI.prototype.drawChat = function () {
    const t = this.titleState, g = this.game;
    if (t && t.title != null && g && g.state === 'play') {
      const age = g.tickCount - t.start, total = t.fadeIn + t.stay + t.fadeOut;
      if (age >= total) t.title = null;
      else {
        const a = age < t.fadeIn ? age / Math.max(1, t.fadeIn) : age > t.fadeIn + t.stay ? (total - age) / Math.max(1, t.fadeOut) : 1;
        const c = this.ctx; c.save(); c.globalAlpha = clamp(a, 0, 1);
        c.translate(this.w / 2, this.h / 2); c.scale(4, 4); Font.center(c, t.title, 0, -10, '#FFFFFF'); c.restore();
        if (t.sub) { c.save(); c.globalAlpha = clamp(a, 0, 1); c.translate(this.w / 2, this.h / 2); c.scale(2, 2); Font.center(c, t.sub, 0, 5, '#FFFFFF'); c.restore(); }
      }
    }
    return _draw.apply(this, arguments);
  };
})();
