'use strict';
// ---------------------------------------------------------------------------
// Commands: one list for the chat box's suggestions (like vanilla's CommandSuggestions: the matching commands or
// arguments above the input, Tab to take one, the usage below) and the /help menu (each command and what it does;
// a click puts it in the chat box). Single player runs them itself (runCommand); on a server they are the
// server's, in vanilla's syntax.
// ---------------------------------------------------------------------------
const CMD_ITEMS = () => Object.keys(ITEM_KEY);
const CMD_MOBS = () => [...Object.keys(MOB_TYPES), 'ender_dragon', 'tnt'];
const CMD_STRUCTS = ['village', 'stronghold', 'fortress', 'bastion_remnant', 'pillager_outpost', 'ancient_city', 'trial_chambers', 'trail_ruins',
  'desert_pyramid', 'jungle_pyramid', 'swamp_hut', 'igloo', 'shipwreck', 'ocean_ruin_cold', 'ocean_ruin_warm', 'ruined_portal', 'mineshaft',
  'buried_treasure', 'end_city', 'monument', 'mansion'];
const CMD_PLAYERS = (g) => ['@s', '@p', '@a', ...(g.net ? [...g.net.players.values()].filter(Boolean) : [])];
const CMD_DIMS = ['overworld', 'nether', 'end'];
const CMD_MODES = ['survival', 'creative', 'spectator', 'adventure'];
// [name, usage, what it does, the choices for each argument (a list, or a function of the game giving one)]
const CMD_SEL = ['@s', '@p', '@a', '@r', '@e', '@e[type='];
const CMD_EFFECTS = () => Object.keys(EFFECTS);
const CMD_ENCH = () => (typeof ENCH !== 'undefined' ? Object.keys(ENCH) : []);
const CMD_BLOCKS = () => Object.keys(BID);
const CMD_RULES = () => (typeof GAME_RULES !== 'undefined' ? Object.keys(GAME_RULES) : []);
const CMD_XYZ = [['~'], ['~'], ['~']];
// single player: vanilla's syntax (cmdrun.js runs them)
const CMDS_LOCAL = [
  ['gamemode', '/gamemode <模式> [目标]', '切换游戏模式', [CMD_MODES, CMD_SEL]],
  ['difficulty', '/difficulty [难度]', '查看或设置难度', [['peaceful', 'easy', 'normal', 'hard']]],
  ['time', '/time set|add|query <时间>', '设置时间：day / noon / night / midnight、数值或 10s / 1d', [['set', 'add', 'query'], ['day', 'noon', 'night', 'midnight', 'sunrise', 'sunset', 'daytime', 'gametime', 'day']]],
  ['weather', '/weather clear|rain|thunder [时长]', '设置天气', [['clear', 'rain', 'thunder']]],
  ['give', '/give <目标> <物品> [数量]', '给予物品，如 /give @s diamond 64', [(g) => [...CMD_SEL, ...CMD_ITEMS()], CMD_ITEMS]],
  ['clear', '/clear [目标] [物品] [最大数量]', '清除物品栏里的物品', [CMD_SEL, CMD_ITEMS]],
  ['tp', '/tp [目标] <x y z | 目标实体> [偏航 俯仰]', '传送（~ 相对位置，^ 视线方向的局部坐标）', [(g) => ['~', '^', ...CMD_SEL], ['~', '^'], ['~', '^']]],
  ['summon', '/summon <实体> [x y z]', '生成实体（含 lightning_bolt、tnt）', [() => [...CMD_MOBS(), 'lightning_bolt', 'experience_orb'], ...CMD_XYZ]],
  ['kill', '/kill [目标]', '杀死实体，如 /kill @e[type=zombie]', [CMD_SEL]],
  ['effect', '/effect give|clear <目标> [效果] [秒数] [等级] [隐藏粒子]', '给予或清除状态效果', [['give', 'clear'], CMD_SEL, CMD_EFFECTS, ['30', 'infinite'], ['0', '1', '2', '4', '9', '255'], ['true', 'false']]],
  ['enchant', '/enchant <目标> <魔咒> [等级]', '给手上的物品附魔', [CMD_SEL, CMD_ENCH]],
  ['xp', '/xp add|set|query <目标> <数量> [points|levels]', '经验（/xp 30L 也可以）', [['add', 'set', 'query'], CMD_SEL, [], ['points', 'levels']]],
  ['setblock', '/setblock <x y z> <方块> [destroy|keep|replace]', '放置方块，可带状态：oak_stairs[facing=east]', [['~'], ['~'], ['~'], CMD_BLOCKS, ['destroy', 'keep', 'replace']]],
  ['fill', '/fill <x1 y1 z1> <x2 y2 z2> <方块> [destroy|hollow|keep|outline|replace [过滤]]', '填充区域（最多 32768 格）', [['~'], ['~'], ['~'], ['~'], ['~'], ['~'], CMD_BLOCKS, ['destroy', 'hollow', 'keep', 'outline', 'replace'], CMD_BLOCKS]],
  ['clone', '/clone <x1 y1 z1> <x2 y2 z2> <目标 x y z> [replace|masked] [normal|force|move]', '复制区域', [['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['replace', 'masked'], ['normal', 'force', 'move']]],
  ['gamerule', '/gamerule <规则> [值]', '查看或修改游戏规则', [CMD_RULES, ['true', 'false']]],
  ['locate', '/locate structure <结构>', '查找最近的结构', [['structure'], CMD_STRUCTS]],
  ['tpdim', '/tpdim <维度>', '直接前往某个维度', [CMD_DIMS]],
  ['spawnpoint', '/spawnpoint [目标] [x y z]', '设置重生点', [CMD_SEL, ...CMD_XYZ]],
  ['setworldspawn', '/setworldspawn [x y z]', '设置世界重生点', CMD_XYZ],
  ['title', '/title <目标> title|subtitle|actionbar|clear|reset|times <文本>', '在屏幕上显示标题', [CMD_SEL, ['title', 'subtitle', 'actionbar', 'clear', 'reset', 'times']]],
  ['tellraw', '/tellraw <目标> <JSON 文本>', '发送 JSON 格式的消息', [CMD_SEL]],
  ['say', '/say <消息>', '向所有人说话', []],
  ['me', '/me <动作>', '以第三人称说话', []],
  ['msg', '/msg <玩家> <消息>', '悄悄话', [CMD_SEL]],
  ['playsound', '/playsound <声音> [来源] [目标] [x y z] [音量] [音调]', '播放声音', [() => (typeof SOUND_EVENTS !== 'undefined' ? Object.keys(SOUND_EVENTS) : []), ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'], CMD_SEL]],
  ['particle', '/particle <粒子> [x y z] [dx dy dz] [速度] [数量]', '显示粒子', [() => Object.keys(CMD_PARTICLES)]],
  ['damage', '/damage <目标> <伤害> [伤害类型]', '对实体造成伤害', [CMD_SEL]],
  ['ride', '/ride <目标> mount <载具> | dismount', '骑乘实体', [CMD_SEL, ['mount', 'dismount'], CMD_SEL]],
  ['tag', '/tag <目标> add|remove|list [标签]', '给实体加标签（选择器 tag= 可用）', [CMD_SEL, ['add', 'remove', 'list']]],
  ['defaultgamemode', '/defaultgamemode <模式>', '设置默认游戏模式', [CMD_MODES]],
  ['random', '/random value|roll <范围>', '随机数，如 /random roll 1..6', [['value', 'roll'], ['1..6', '1..100']]],
  ['list', '/list', '在线玩家', []],
  ['seed', '/seed', '显示世界种子', []],
  ['help', '/help', '打开这个命令列表', []],
];
// on a server: vanilla's commands (what this player may use is up to the server)
const CMDS_NET = [
  ['gamemode', '/gamemode <模式> [玩家]', '切换游戏模式', [CMD_MODES, CMD_PLAYERS]],
  ['time', '/time set|add|query <时间>', '设置 / 查询时间', [['set', 'add', 'query'], ['day', 'noon', 'night', 'midnight', 'daytime', 'gametime']]],
  ['weather', '/weather clear|rain|thunder [时长]', '设置天气', [['clear', 'rain', 'thunder']]],
  ['give', '/give <玩家> <物品> [数量]', '给予物品', [CMD_PLAYERS, CMD_ITEMS]],
  ['tp', '/tp <目标> | <x> <y> <z>', '传送', [(g) => ['~', ...CMD_PLAYERS(g)], ['~'], ['~']]],
  ['summon', '/summon <实体> [x y z]', '生成实体', [CMD_MOBS]],
  ['kill', '/kill [目标]', '杀死实体', [(g) => ['@e[type=', ...CMD_PLAYERS(g)]]],
  ['locate', '/locate structure <结构>', '查找最近的结构', [['structure', 'biome', 'poi'], CMD_STRUCTS]],
  ['effect', '/effect give <目标> <效果> [秒] [等级]', '给予状态效果', [['give', 'clear'], CMD_PLAYERS, () => Object.keys(EFFECTS)]],
  ['enchant', '/enchant <目标> <魔咒> [等级]', '给手上的物品附魔', [CMD_PLAYERS]],
  ['xp', '/xp add <目标> <数量> [levels]', '给予经验', [['add', 'set', 'query'], CMD_PLAYERS]],
  ['clear', '/clear [玩家] [物品]', '清除物品', [CMD_PLAYERS, CMD_ITEMS]],
  ['difficulty', '/difficulty <难度>', '设置难度', [['peaceful', 'easy', 'normal', 'hard']]],
  ['gamerule', '/gamerule <规则> [值]', '修改游戏规则', [['keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'naturalRegeneration', 'showDeathMessages']]],
  ['setblock', '/setblock <x> <y> <z> <方块>', '放置方块', [['~'], ['~'], ['~'], CMD_ITEMS]],
  ['fill', '/fill <x1> <y1> <z1> <x2> <y2> <z2> <方块>', '填充区域', [['~'], ['~'], ['~'], ['~'], ['~'], ['~'], CMD_ITEMS]],
  ['spawnpoint', '/spawnpoint [玩家]', '设置重生点', [CMD_PLAYERS]],
  ['msg', '/msg <玩家> <消息>', '悄悄话', [CMD_PLAYERS]],
  ['me', '/me <动作>', '以第三人称说话', []],
  ['list', '/list', '在线玩家', []],
  ['seed', '/seed', '显示世界种子', []],
  ['help', '/help', '打开这个命令列表', []],
];
const cmdList = (g) => (g.net ? CMDS_NET : CMDS_LOCAL);

// the suggestions for what is typed so far: { list, at (where the word being completed starts), usage }; null if none
function cmdSuggest(g, text) {
  if (!text.startsWith('/')) return null;
  // (extra spaces don't count as empty words: suggestions went away after a double space)
  const words = text.slice(1).replace(/^ +/, '').split(/ +/), last = words[words.length - 1].replace(/^minecraft:/, '');
  const at = text.length - words[words.length - 1].length;
  const cmds = cmdList(g);
  if (words.length === 1) {
    const list = cmds.map((c) => c[0]).filter((n) => n.startsWith(last));
    const exact = cmds.find((c) => c[0] === last);
    return { list: exact && list.length === 1 ? [] : list, at, usage: exact ? exact[1] : null };
  }
  const spec = cmds.find((c) => c[0] === words[0]);
  if (!spec) return null;
  let ch = spec[3][words.length - 2];
  if (typeof ch === 'function') ch = ch(g);
  const list = (ch || []).filter((v) => v.startsWith(last) && v !== last);
  // the ones starting with the word first, then the ones where a part of the name does (… _sword)
  if (last.length > 1 && ch && list.length < 10) for (const v of ch) if (!v.startsWith(last) && v.includes('_' + last) && !list.includes(v)) list.push(v);
  return { list: list.slice(0, 50), at, usage: spec[1] };
}

// ---- the chat box: suggestions drawn above it, Up / Down choose among them, Tab takes one ----
(() => {
  const _layout = ChatScreen.prototype.layout, _draw = ChatScreen.prototype.draw;
  ChatScreen.prototype.layout = function () {
    _layout.call(this);
    const el = this.game.ui.input, prev = el.onkeydown;
    this.sugSel = 0; this.sugFor = null;
    el.onkeydown = (e) => {
      const s = this.sug && this.sug.list.length ? this.sug : null;
      if (s && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault(); e.stopPropagation();
        this.sugSel = (this.sugSel + (e.key === 'ArrowUp' ? -1 : 1) + s.list.length) % s.list.length;
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (s) this.takeSuggestion(el); return; }
      // /help (with nothing after it) opens the list instead of asking anyone
      if (e.key === 'Enter' && el.value.trim() === '/help') { e.preventDefault(); e.stopPropagation(); this.game.ui.close(); this.game.ui.open(new CommandHelpScreen(this.game)); return; }
      prev(e);
    };
  };
  ChatScreen.prototype.takeSuggestion = function (el) {
    const s = this.sug, v = s.list[this.sugSel] || s.list[0];
    el.value = el.value.slice(0, s.at) + v + (v.endsWith('=') || v.endsWith('[') ? '' : ' ');
    this.sugSel = 0;
  };
  ChatScreen.prototype.draw = function (ui) {
    _draw.call(this, ui);
    const el = ui.input, v = el.value;
    if (v !== this.sugFor) { this.sugFor = v; this.sug = cmdSuggest(this.game, v); this.sugSel = 0; }
    const s = this.sug; if (!s) return;
    const c = ui.ctx, x0 = 4 + Font.width(v.slice(0, s.at)), y0 = ui.h - 14;
    // the usage, just above the box (vanilla shows it in grey where the suggestions would be)
    if (!s.list.length) {
      if (s.usage) { const w = Font.width(s.usage) + 2; c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(2, y0 - 12, w, 12); Font.draw(c, s.usage, 3, y0 - 10, '#AAAAAA'); }
      return;
    }
    // ten at a time around the chosen one
    const n = Math.min(10, s.list.length), first = Math.max(0, Math.min(s.list.length - n, this.sugSel - 4));
    const shown = s.list.slice(first, first + n), w = Math.max(...shown.map((t) => Font.width(t))) + 2;
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(x0 - 1, y0 - 12 * n, w, 12 * n);
    shown.forEach((t, i) => Font.draw(c, t, x0, y0 - 12 * n + 2 + i * 12, first + i === this.sugSel ? '#FFFF00' : '#AAAAAA'));
    if (s.usage) Font.draw(c, s.usage, x0 + w + 4, y0 - 10, '#AAAAAA');
  };
  // a click on a suggestion takes it
  const _md = ChatScreen.prototype.mouseDown;
  ChatScreen.prototype.mouseDown = function (ui, mx, my, button) {
    const s = this.sug;
    if (s && s.list.length && button === 0) {
      const n = Math.min(10, s.list.length), first = Math.max(0, Math.min(s.list.length - n, this.sugSel - 4)), y0 = ui.h - 14 - 12 * n;
      const i = Math.floor((my - y0) / 12);
      if (my >= y0 && i >= 0 && i < n) { this.sugSel = first + i; this.takeSuggestion(ui.input); ui.input.focus(); return; }
    }
    if (_md) return _md.call(this, ui, mx, my, button);
  };
})();

// ---- /help: every command and what it does, a page at a time; a click puts it in the chat box ----
class CommandHelpScreen extends MenuScreen {
  constructor(game) { super(game, '命令'); this.page = 0; }
  layout() {
    const ui = this.game.ui, g = this.game, list = cmdList(g), cx = ui.w / 2;
    const per = Math.max(4, Math.floor((ui.h - 90) / 22)), pages = Math.ceil(list.length / per);
    this.page = clamp(this.page, 0, pages - 1);
    const bw = Math.min(420, ui.w - 20);
    this.widgets = list.slice(this.page * per, this.page * per + per).map((c, i) => ({
      // the usage and, where it fits, what it does
      x: cx - bw / 2, y: 44 + i * 22, w: bw, h: 20, label: Font.width(c[1] + '   ' + c[2]) < bw - 12 ? c[1] + '   ' + c[2] : c[1], tip: [c[2], '点击填入聊天框'],
      onClick: () => { ui.close(); ui.open(new ChatScreen(g, '/' + c[0] + (c[3].length ? ' ' : ''))); },
    }));
    const y = ui.h - 30;
    if (pages > 1) {
      this.widgets.push({ x: cx - 150, y, w: 70, h: 20, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } });
      this.widgets.push({ x: cx + 80, y, w: 70, h: 20, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } });
      this.widgets.push({ text: `${this.page + 1} / ${pages}`, x: cx, y: y - 11, color: '#AAAAAA' });
    }
    this.widgets.push({ x: cx - 70, y, w: 140, h: 20, label: '完成', onClick: () => ui.close() });
  }
  drawExtra(ui) { Font.center(ui.ctx, this.game.net ? '服务器上能不能用由服务器决定' : (this.game.cheats ? '' : '这个世界没有开作弊，只有 /help /seed 等可用'), ui.w / 2, 32, '#AAAAAA'); }
}
