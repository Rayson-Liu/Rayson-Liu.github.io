'use strict';
// ---------------------------------------------------------------------------
// Command blocks and the command block minecart, as vanilla's CommandBlock, CommandBlockEntity, BaseCommandBlock,
// MinecartCommandBlock and the two edit screens: impulse (脉冲) / chain (连锁) / repeat (循环), conditional (条件制约),
// needs redstone (红石控制) / always active (保持开启); a chain runs along the blocks' facing in the same tick; the
// success count is what a comparator reads (through a detector rail for the minecart); the last output with the
// time; /say from one says [@]. Game master blocks: only a creative player with cheats on (an operator on a
// server) places, breaks or opens them. Commands run as cmdrun.js's cmdExec with the block as the source.
// On a server the server runs them: the screens send set_command_block / set_command_minecart, the block's data
// comes when it is opened (ServerPlayer.openCommandBlock), the minecart's command in its entity data.
// ---------------------------------------------------------------------------
const CMD_MODE = {}; // block id -> its mode (CommandBlockEntity.Mode)
for (const [k, m] of [['command_block', 'redstone'], ['chain_command_block', 'sequence'], ['repeating_command_block', 'auto']]) if (BID[k] !== undefined) CMD_MODE[BID[k]] = m;
const CMD_BLOCK_OF = { redstone: 'command_block', sequence: 'chain_command_block', auto: 'repeating_command_block' };
const CMD_MODE_CN = { sequence: '连锁', auto: '循环', redstone: '脉冲' };
const GM_BLOCKS = new Set(['command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw', 'test_block', 'test_instance_block'].filter((k) => BID[k] !== undefined).map((k) => BID[k]));
for (const id in CMD_MODE) RS_IDS.add(+id);

// Player.canUseGameMasterBlocks: creative, and permission level 2 (cheats in single player)
Game.prototype.canUseGameMasterBlocks = function () { return this.mode === 'creative' && (this.net ? (this.net.opLevel | 0) >= 2 : !!this.cheats); };

const cmdKey = (x, y, z) => x + ',' + y + ',' + z;
const cmdProp = (g, x, y, z, k) => Features.propOf(g.world.getBlock(x, y, z), g.world.getMeta(x, y, z), k);
const cmdConditional = (g, x, y, z) => cmdProp(g, x, y, z, 'conditional') === 'true';
// the block entity (made like newBlockEntity: a chain command block starts always active)
Game.prototype.cmdEntity = function (x, y, z) {
  const k = cmdKey(x, y, z);
  let be = this.blockEntities.get(k);
  if (!be || be.type !== 'command_block') {
    be = { type: 'command_block', pos: [x, y, z], command: '', success: 0, output: '', track: true, auto: CMD_MODE[this.world.getBlock(x, y, z)] === 'sequence', powered: RS.neighborSignal(this, x, y, z), met: false };
    this.blockEntities.set(k, be);
  }
  return be;
};
// markConditionMet: a conditional one runs only when the command block behind it succeeded last time
function cmdMarkMet(g, be) {
  const [x, y, z] = be.pos;
  be.met = true;
  if (cmdConditional(g, x, y, z)) {
    const v = RS_DIRS[cmdProp(g, x, y, z, 'facing')], bx = x - v[0], by = y - v[1], bz = z - v[2];
    const o = CMD_MODE[g.world.getBlock(bx, by, bz)] !== undefined ? g.blockEntities.get(cmdKey(bx, by, bz)) : null;
    be.met = !!o && o.type === 'command_block' && o.success > 0;
  }
  return be.met;
}
const cmdStamp = () => { const d = new Date(), t = (n) => String(n).padStart(2, '0'); return `[${t(d.getHours())}:${t(d.getMinutes())}:${t(d.getSeconds())}] `; };
// BaseCommandBlock.performCommand: once a tick at most; the source keeps the last output when it tracks output,
// and tells the operators in chat ([@: …], command_block_output)
const CMD_LAST = new WeakMap();
function cmdPerform(g, cb, where) {
  if (CMD_LAST.get(cb) === g.tickCount) return false;
  if (/^searge$/i.test(cb.command)) { cb.output = '#itzlipofutzli'; cb.success = 1; return true; }
  cb.success = 0;
  if (g.rule('command_blocks_work') && cb.command) {
    cb.output = '';
    const src = { ...where, name: '@',
      say(m, always) {
        if (!cb.track) return;
        if (g.rule('send_command_feedback')) cb.output = cmdStamp() + m;
        if (!always && g.rule('command_block_output') && g.rule('send_command_feedback') && g.cheats) g.ui.message(`[@: ${m}]`, '#AAAAAA');
      },
      fail(m) { if (cb.track) cb.output = cmdStamp() + m; } };
    if (cmdExec(g, cb.command, src)) cb.success = 1;
  }
  CMD_LAST.set(cb, g.tickCount);
  return true;
}
const cmdBlockSource = (g, x, y, z) => ({ pos: [x + 0.5, y + 0.5, z + 0.5], rot: [{ north: Math.PI, south: 0, west: Math.PI / 2, east: -Math.PI / 2 }[cmdProp(g, x, y, z, 'facing')] || 0, 0] });
// CommandBlock.execute and executeChain: the chain command blocks in front, each turning the way it faces
function cmdExecute(g, x, y, z, be) {
  if (be.command) cmdPerform(g, be, cmdBlockSource(g, x, y, z)); else be.success = 0;
  let dir = cmdProp(g, x, y, z, 'facing'), n = g.rule('max_command_sequence_length');
  while (n-- > 0) {
    const v = RS_DIRS[dir]; x += v[0]; y += v[1]; z += v[2];
    if (CMD_MODE[g.world.getBlock(x, y, z)] !== 'sequence') break;
    const c = g.blockEntities.get(cmdKey(x, y, z));
    if (!c || c.type !== 'command_block') break;
    if (c.powered || c.auto) {
      if (cmdMarkMet(g, c)) { if (!cmdPerform(g, c, cmdBlockSource(g, x, y, z))) break; RS.wake(x, y, z); }
      else if (cmdConditional(g, x, y, z)) c.success = 0;
    }
    dir = cmdProp(g, x, y, z, 'facing');
  }
}
// setPoweredAndUpdate: power coming on starts an impulse or repeating block that needs redstone (next tick)
function cmdSetPowered(g, x, y, z, be, p) {
  if (p === be.powered) return;
  be.powered = p;
  if (!p || be.auto || CMD_MODE[g.world.getBlock(x, y, z)] === 'sequence') return;
  cmdMarkMet(g, be); g.world.schedule(x, y, z, 1);
}
// setAutomatic / onModeSwitch: switched to always active, or made a repeating one that is on, it starts
function cmdSetAuto(g, be, auto) {
  const was = be.auto, [x, y, z] = be.pos; be.auto = auto;
  if (!was && auto && !be.powered && CMD_MODE[g.world.getBlock(x, y, z)] !== 'sequence') { cmdMarkMet(g, be); g.world.schedule(x, y, z, 1); }
}
function cmdModeSwitch(g, be) {
  const [x, y, z] = be.pos;
  if (CMD_MODE[g.world.getBlock(x, y, z)] === 'auto' && (be.powered || be.auto)) { cmdMarkMet(g, be); g.world.schedule(x, y, z, 1); }
}

// ---- the redstone side: neighbours, the scheduled tick, what a comparator reads ----
const _cmdRsUpdate = RS.update;
RS.update = function (g, x, y, z) {
  if (CMD_MODE[g.world.getBlock(x, y, z)] === undefined || !g.world.isLoaded(x, z)) return _cmdRsUpdate.call(this, g, x, y, z);
  const fresh = !g.blockEntities.has(cmdKey(x, y, z)), be = g.cmdEntity(x, y, z);
  if (!fresh) cmdSetPowered(g, x, y, z, be, RS.neighborSignal(g, x, y, z));
};
const _cmdRsTick = RS.tick;
RS.tick = function (g, x, y, z) {
  const mode = CMD_MODE[g.world.getBlock(x, y, z)];
  if (mode === undefined) return _cmdRsTick.call(this, g, x, y, z);
  const be = g.blockEntities.get(cmdKey(x, y, z));
  if (!be || be.type !== 'command_block') return true;
  const was = be.met;
  if (mode === 'auto') {
    cmdMarkMet(g, be);
    if (was) cmdExecute(g, x, y, z, be); else if (cmdConditional(g, x, y, z)) be.success = 0;
    if (be.powered || be.auto) g.world.schedule(x, y, z, 1);
  } else if (mode === 'redstone') {
    if (was) cmdExecute(g, x, y, z, be); else if (cmdConditional(g, x, y, z)) be.success = 0;
  }
  RS.wake(x, y, z); // (updateNeighbourForOutputSignal: comparators look again)
  return true;
};
const _cmdRsAnalog = RS.analog;
RS.analog = function (g, x, y, z) {
  const w = g.world, id = w.getBlock(x, y, z);
  if (CMD_MODE[id] !== undefined) { const be = g.blockEntities.get(cmdKey(x, y, z)); return be && be.type === 'command_block' ? Math.min(15, be.success) : 0; }
  // a detector rail reads a command block minecart on it first (DetectorRailBlock.getAnalogOutputSignal)
  if (BLOCKS[id] && BLOCKS[id].key === 'detector_rail' && Features.propOf(id, w.getMeta(x, y, z), 'powered') === 'true') {
    const carts = RS.entitiesIn(g, [x + 0.2, y, z + 0.2, x + 0.8, y + 0.8, z + 0.8], (e) => e instanceof Minecart && e.kind === 'command_block');
    if (carts.length) return Math.min(15, cartCmd(carts[0]).success);
  }
  return _cmdRsAnalog.call(this, g, x, y, z);
};

// ---- placing, breaking, using (game master blocks) ----
// setPlacedBy: placed by a player it starts afresh (tracking output as send_command_feedback says) and looks at
// the power it has; a game master block only goes down for someone who can use it
const _cmdPlaceAt = Game.prototype.placeAt;
Game.prototype.placeAt = function (x, y, z, id, ...rest) {
  if (GM_BLOCKS.has(id) && !this.canUseGameMasterBlocks()) return;
  const r = _cmdPlaceAt.call(this, x, y, z, id, ...rest);
  if (!this.net && CMD_MODE[id] !== undefined && this.world.getBlock(x, y, z) === id) {
    this.blockEntities.delete(cmdKey(x, y, z));
    const be = this.cmdEntity(x, y, z);
    be.powered = false; be.track = !!this.rule('send_command_feedback');
    cmdSetPowered(this, x, y, z, be, RS.neighborSignal(this, x, y, z));
  }
  return r;
};
const _cmdBreak = Game.prototype.breakBlock;
Game.prototype.breakBlock = function (x, y, z, natural, ...rest) {
  if (!natural && this.mode === 'creative' && GM_BLOCKS.has(this.world.getBlock(x, y, z)) && !this.canUseGameMasterBlocks()) return false;
  return _cmdBreak.call(this, x, y, z, natural, ...rest);
};
for (const id in CMD_MODE) BLOCKS[id].onUse = (g, x, y, z) => { if (!g.canUseGameMasterBlocks()) return false; g.ui.open(cmdBlockScreen(g, x, y, z)); return true; };

// handleSetCommandBlock: the mode picks the block (facing kept), then the command, output, trigger
function cmdApply(g, x, y, z, d) {
  const w = g.world, id = w.getBlock(x, y, z);
  if (CMD_MODE[id] === undefined) return;
  const be = g.cmdEntity(x, y, z), old = CMD_MODE[id], nid = BID[CMD_BLOCK_OF[d.mode]] ?? id;
  let nm = Features.withProp(nid, 0, 'facing', cmdProp(g, x, y, z, 'facing'));
  nm = Features.withProp(nid, nm, 'conditional', d.cond ? 'true' : 'false');
  if (nid !== id || nm !== w.getMeta(x, y, z)) { w.setBlock(x, y, z, nid, nm); g.blockEntities.set(cmdKey(x, y, z), be); g.flushMesh && g.flushMesh(); }
  be.command = d.command; be.success = 0;
  be.track = d.track; if (!d.track) be.output = '';
  cmdSetAuto(g, be, d.auto);
  if (old !== d.mode) cmdModeSwitch(g, be);
  if (d.command) g.ui.message(g.rule('command_blocks_work') ? `成功设置命令：${d.command}` : `成功设置命令：${d.command}，但命令方块仍被禁用`);
}
function cmdBlockScreen(g, x, y, z) {
  const be = g.cmdEntity(x, y, z), id = g.world.getBlock(x, y, z);
  return new CommandBlockScreen(g, { command: be.command, output: be.output, track: be.track, mode: CMD_MODE[id], cond: cmdConditional(g, x, y, z), auto: be.auto,
    valid: () => CMD_MODE[g.world.getBlock(x, y, z)] !== undefined, apply: (d) => cmdApply(g, x, y, z, d) });
}

// ---- the command block minecart: runs on a powered activator rail (every 4 ticks at most), drops a minecart ----
function cartCmd(c) { return c.cmd || (c.cmd = { command: '', success: 0, output: '', track: true }); }
const _cmdOnRail = Minecart.prototype.moveOnRail;
Minecart.prototype.moveOnRail = function (bx, by, bz, id) {
  const r = _cmdOnRail.call(this, bx, by, bz, id);
  if (this.kind === 'command_block' && !this.game.net && !this.dead && BLOCKS[id].key === 'activator_rail' && Features.propOf(id, this.world.getMeta(bx, by, bz), 'powered') === 'true' && this.age - (this.cmdAt || 0) >= 4) {
    cmdPerform(this.game, cartCmd(this), { pos: [...this.pos], rot: [this.yaw, this.pitch || 0], entity: this });
    this.cmdAt = this.age;
  }
  return r;
};
const _cmdCartUse = Minecart.prototype.interact;
Minecart.prototype.interact = function (p, held) {
  if (this.kind !== 'command_block') return _cmdCartUse.call(this, p, held);
  if (!this.game.canUseGameMasterBlocks()) return false;
  this.game.ui.open(cartScreen(this.game, this));
  return true;
};
const _cmdCartDrop = Minecart.prototype.dropSelf;
Minecart.prototype.dropSelf = function () {
  if (this.kind !== 'command_block') return _cmdCartDrop.call(this);
  this.game.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], makeStack('minecart'));
};
const _cmdCartSave = Minecart.prototype.saveData, _cmdCartLoad = Minecart.prototype.loadData;
Minecart.prototype.saveData = function () { const d = _cmdCartSave.call(this); if (this.kind === 'command_block') d.cmd = cartCmd(this); return d; };
Minecart.prototype.loadData = function (d) { _cmdCartLoad.call(this, d); if (d && d.cmd) this.cmd = { ...cartCmd(this), ...d.cmd }; };
function cartScreen(g, cart) {
  const cb = cartCmd(cart);
  return new CommandBlockScreen(g, { cart: true, command: cb.command, output: cb.output, track: cb.track, valid: () => !cart.dead,
    apply: (d) => {
      if (g.net) { g.net.send({ t: 'cmdcart', id: cart.netId, command: d.command, track: d.track }); return; }
      cb.command = d.command; cb.success = 0; cb.track = d.track; if (!d.track) cb.output = '';
      if (d.command) g.ui.message(`成功设置命令：${d.command}`);
    } });
}

// ---- the edit screen (AbstractCommandBlockEditScreen / CommandBlockEditScreen / MinecartCommandBlockEditScreen) ----
// view: { command, output, track, mode, cond, auto, cart, ready (false: waiting for the server's data), valid(), apply(d) }
class CommandBlockScreen extends MenuScreen {
  constructor(game, view) {
    super(game, null); this.v = view; this.pauses = !game.net;
    this.command = view.command || ''; this.output = view.output || ''; this.track = view.track !== false;
    this.mode = view.mode || 'redstone'; this.cond = !!view.cond; this.auto = !!view.auto; this.ready = view.ready !== false;
  }
  // updateGui: the server's data came
  fill(d) { Object.assign(this, d); this.ready = true; if (this.game.ui.screen === this) this.layout(); }
  get prevY() { return this.v.cart ? 150 : 135; }
  layout() {
    const u = this.game.ui, cx = Math.floor(u.w / 2), on = this.ready, by = Math.floor(u.h / 4) + 132;
    this.field = { x: cx - 150, y: 50, w: 300, h: 20 };
    this.prev = { x: cx - 150, y: this.prevY, w: 276, h: 20 };
    const W = [{ x: cx + 130, y: this.prevY, w: 20, h: 20, label: () => (this.track ? 'O' : 'X'), enabled: on, onClick: () => { this.track = !this.track; } }];
    if (!this.v.cart) {
      const NEXT = { sequence: 'auto', auto: 'redstone', redstone: 'sequence' };
      W.push({ x: cx - 154, y: 165, w: 100, h: 20, label: () => CMD_MODE_CN[this.mode], enabled: on, onClick: () => { this.mode = NEXT[this.mode]; } });
      W.push({ x: cx - 50, y: 165, w: 100, h: 20, label: () => (this.cond ? '条件制约' : '不受制约'), enabled: on, onClick: () => { this.cond = !this.cond; } });
      W.push({ x: cx + 54, y: 165, w: 100, h: 20, label: () => (this.auto ? '保持开启' : '红石控制'), enabled: on, onClick: () => { this.auto = !this.auto; } });
    }
    W.push({ x: cx - 154, y: by, w: 150, h: 20, label: '完成', enabled: on, onClick: () => this.done() });
    W.push({ x: cx + 4, y: by, w: 150, h: 20, label: '取消', onClick: () => this.cancel() });
    this.widgets = W;
    u.showInput(this.field.x + 4, this.field.y + 6, this.field.w - 8, 10, this.command, () => this.done(), { onInput: (v) => { this.command = v; }, onEsc: () => this.cancel(), max: 32500 });
  }
  done() { if (!this.ready) return; this.v.apply({ command: this.command, mode: this.mode, track: this.track, cond: this.cond, auto: this.auto }); this.game.ui.close(); }
  cancel() { this.game.ui.close(); }
  onEsc() { this.cancel(); }
  drawExtra(ui) {
    if (this.v.valid && !this.v.valid()) { setTimeout(() => { if (ui.screen === this) ui.close(); }, 0); return; }
    const c = ui.ctx, cx = Math.floor(ui.w / 2);
    Font.center(c, '设置此方块的控制台命令', cx, 20, '#FFFFFF');
    Font.draw(c, '控制台命令', cx - 149, 40, '#A0A0A0');
    ui.nine('text_field_hl', this.field.x, this.field.y, this.field.w, this.field.h, 1);
    // the previous output (shown only when there is one; "-" while output isn't tracked)
    const out = this.track ? this.output : '-';
    if (out) {
      Font.draw(c, '上一个输出', cx - 149, 75 + 46 + this.prevY - 135 + 4, '#A0A0A0');
      const r = this.prev;
      ui.nine('text_field', r.x, r.y, r.w, r.h, 1);
      let s = out; while (s && Font.width(s) > r.w - 8) s = s.slice(0, -1);
      Font.draw(c, s, r.x + 4, r.y + 6, '#707070');
    }
  }
}

// ---- /setblock with the block's data: command_block{Command:"say hi",auto:1b} ----
// a small SNBT reader: compounds, lists, quoted or plain strings, numbers with their suffixes, true / false
function cmdSnbt(s) {
  let i = 0;
  const ws = () => { while (/\s/.test(s[i] || '')) i++; };
  const val = () => {
    ws();
    const ch = s[i];
    if (ch === '{') {
      i++; const o = {};
      for (ws(); s[i] !== '}'; ws()) {
        const k = key();
        ws(); if (s[i++] !== ':') cmdFail('无效的数据标签');
        o[k] = val(); ws();
        if (s[i] === ',') i++; else if (s[i] !== '}') cmdFail('无效的数据标签');
      }
      i++; return o;
    }
    if (ch === '[') {
      i++; const a = []; ws();
      if (/^[BIL];/.test(s.slice(i, i + 2))) i += 2;
      for (ws(); s[i] !== ']'; ws()) { a.push(val()); ws(); if (s[i] === ',') i++; else if (s[i] !== ']') cmdFail('无效的数据标签'); }
      i++; return a;
    }
    if (ch === '"' || ch === "'") return str();
    const m = /^[^,}\]\s]+/.exec(s.slice(i));
    if (!m) cmdFail('无效的数据标签');
    i += m[0].length;
    const t = m[0];
    if (t === 'true') return 1; if (t === 'false') return 0;
    const n = /^(-?\d*\.?\d+(?:e-?\d+)?)[bslfdBSLFD]?$/.exec(t);
    return n ? Number(n[1]) : t;
  };
  const key = () => {
    if (s[i] === '"' || s[i] === "'") return str();
    const m = /^[A-Za-z0-9_.+-]+/.exec(s.slice(i));
    if (!m) cmdFail('无效的数据标签');
    i += m[0].length; return m[0];
  };
  const str = () => {
    const q = s[i++]; let r = '';
    while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; r += s[i++]; }
    i++; return r;
  };
  const v = val();
  return v && typeof v === 'object' && !Array.isArray(v) ? v : cmdFail('无效的数据标签');
}
const _cmdSetblockRun = CMD_RUN.setblock;
CMD_RUN.setblock = function (ctx, a) {
  const m = a[3] && /^([^{]*)(\{[\s\S]*\})$/.exec(a[3]);
  if (!m) return _cmdSetblockRun.call(this, ctx, a);
  const data = cmdSnbt(m[2]), b = [...a]; b[3] = m[1];
  _cmdSetblockRun.call(this, ctx, b);
  const [x, y, z] = cmdBlockPos(ctx, a[0], a[1], a[2]);
  if (CMD_MODE[this.world.getBlock(x, y, z)] === undefined) return;
  // (CommandBlockEntity.loadAdditional; setAutomatic starts an always-active impulse or repeating one)
  const be = this.cmdEntity(x, y, z);
  if (typeof data.Command === 'string') be.command = data.Command;
  if (data.SuccessCount !== undefined) be.success = data.SuccessCount | 0;
  if (data.TrackOutput !== undefined) be.track = !!data.TrackOutput;
  if (typeof data.LastOutput === 'string') be.output = data.LastOutput;
  if (data.powered !== undefined) be.powered = !!data.powered;
  if (data.conditionMet !== undefined) be.met = !!data.conditionMet;
  if (data.auto !== undefined) cmdSetAuto(this, be, !!data.auto);
};

// ---- on a server ----
// the permission level comes as entity events 24-28 for the player (op levels 0-4)
const _cmdNetMsg = NetClient.prototype.onMessage;
NetClient.prototype.onMessage = function (m) {
  if (m.t === 'status' && m.id === this.eid && m.s >= 24 && m.s <= 28) this.opLevel = m.s - 24;
  const r = _cmdNetMsg.call(this, m);
  // a command block's data, sent when it is opened: it fills the waiting screen
  if (m.t === 'be') for (const [x, y, z, b] of m.list) {
    const sc = this.g.ui.screen;
    if (!b.cmd || !(sc instanceof CommandBlockScreen) || !sc.v.at || sc.v.at.join() !== [x, y - this.minY, z].join()) continue;
    const w = this.g.world, by = y - this.minY;
    sc.fill({ command: b.cmd.command, output: b.cmd.output, track: b.cmd.track, auto: b.cmd.auto, mode: CMD_MODE[w.getBlock(x, by, z)] || 'redstone', cond: cmdConditional(this.g, x, by, z) });
  }
  return r;
};
// the minecart's command and last output are entity data
const _cmdNetMeta = netApplyMeta;
netApplyMeta = function (net, e, m) {
  const r = _cmdNetMeta(net, e, m);
  if (e instanceof Minecart && e.kind === 'command_block') {
    const cb = cartCmd(e);
    if (m.command_name !== undefined) cb.command = m.command_name || '';
    if (m.last_output !== undefined) cb.output = m.last_output || '';
  }
  return r;
};
// using one opens the screen here, like vanilla's client (the server sends the block's data back)
const _cmdNetUse = Game.prototype.netUse;
Game.prototype.netUse = function () {
  const t = this.target, e = this.targetEntity, p = this.player, n = this.net;
  const r = _cmdNetUse.call(this);
  if (!this.canUseGameMasterBlocks()) return r;
  if (e && e instanceof Minecart && e.kind === 'command_block') this.ui.open(cartScreen(this, e));
  else if (!e && t && CMD_MODE[t.id] !== undefined && !(p.sneaking && p.inv.held)) {
    const [x, y, z] = t.pos, w = this.world;
    this.ui.open(new CommandBlockScreen(this, { at: [x, y, z], ready: false, mode: CMD_MODE[t.id], cond: cmdConditional(this, x, y, z),
      valid: () => CMD_MODE[w.getBlock(x, y, z)] !== undefined,
      apply: (d) => n.send({ t: 'cmdblock', x, y: y + n.minY, z, command: d.command, mode: d.mode, track: d.track, cond: d.cond, auto: d.auto }) }));
  }
  return r;
};
