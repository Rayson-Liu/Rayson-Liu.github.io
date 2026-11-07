'use strict';
// ---------------------------------------------------------------------------
// Key bindings (vanilla KeyMapping names / categories / defaults, Chinese strings from zh_cn), the vanilla
// 26.2 control screens (Controls, Mouse Settings, Key Binds) and the bound input actions.
// A binding is a KeyboardEvent.code, 'Mouse0' / 'Mouse1' / 'Mouse2', or '' (unbound).
// ---------------------------------------------------------------------------
const KEYBIND_CATS = [
  ['移动', [['forward', '向前移动', 'KeyW'], ['left', '向左移动', 'KeyA'], ['back', '向后移动', 'KeyS'], ['right', '向右移动', 'KeyD'],
    ['jump', '跳跃', 'Space'], ['sneak', '潜行', 'ShiftLeft'], ['sprint', '疾跑', 'ControlLeft']]],
  ['游戏内容', [['attack', '攻击/摧毁', 'Mouse0'], ['use', '使用物品/放置方块', 'Mouse2'], ['pickItem', '选取方块', 'Mouse1']]],
  ['物品栏', [['drop', '丢弃所选物品', 'KeyQ'], ['inventory', '开启/关闭物品栏', 'KeyE'], ['swapOffhand', '与副手交换物品', 'KeyF'],
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ['hotbar.' + n, '快捷栏' + n, 'Digit' + n])]],
  ['其他', [['chat', '打开聊天栏', 'KeyT'], ['command', '输入命令', 'Slash']]],
  ['杂项', [['advancements', '进度', 'KeyL'], ['screenshot', '截图', 'F2'], ['togglePerspective', '切换视角', 'F5'],
    ['toggleGui', '切换界面', 'F1'], ['fullscreen', '切换全屏显示', 'F11'], ['help', '游戏说明', 'KeyH']]],
];
const KEY_DEFAULT = {}, KEY_CN = {};
for (const [, list] of KEYBIND_CATS) for (const [n, cn, d] of list) { KEY_DEFAULT[n] = d; KEY_CN[n] = cn; }

const KEY_NAMES = { Space: '空格', ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl', AltLeft: '左Alt', AltRight: '右Alt',
  MetaLeft: '左Win', MetaRight: '右Win', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock', Escape: 'Esc', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', ArrowUp: '上方向键', ArrowDown: '下方向键', ArrowLeft: '左方向键', ArrowRight: '右方向键',
  Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  ContextMenu: '菜单', NumLock: 'Num Lock', ScrollLock: 'Scroll Lock', Pause: 'Pause', PrintScreen: 'Print Screen', Mouse0: '左键', Mouse1: '中键', Mouse2: '右键' };
function keyLabel(code) {
  if (!code) return '未指定';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘' + code.slice(6);
  if (code.startsWith('Mouse')) return '鼠标按键' + (+code.slice(5) + 1);
  return code;
}
const keyOf = (g, name) => { const k = g.settings.keys && g.settings.keys[name]; return k !== undefined ? k : KEY_DEFAULT[name]; };
const bindingsFor = (g, code) => code ? Object.keys(KEY_DEFAULT).filter(n => keyOf(g, n) === code) : [];
// is the key / mouse button bound to an action held down
function bindDown(g, name) {
  if (g.touchHeld && g.touchHeld[name]) return true; // on-screen touch controls
  const k = keyOf(g, name);
  if (!k) return false;
  if (k.startsWith('Mouse')) return !!(g.rawMouse && g.rawMouse[+k.slice(5)]);
  return !!g.keys[k];
}

// ---- actions ------------------------------------------------------------------------------------------
// a bound key / button went down while playing (no screen open)
function pressAction(g, act, e) {
  const p = g.player, ui = g.ui, s = g.settings, now = performance.now();
  switch (act) {
    case 'inventory': if (g.mode !== 'spectator') ui.open(g.mode === 'creative' ? new CreativeScreen(g) : g.net ? g.net.inventoryScreen() : new CraftingScreen(g, 2)); return true;
    case 'chat': ui.open(new ChatScreen(g)); return true;
    case 'command': ui.open(new ChatScreen(g, '/')); return true;
    case 'help': ui.open(new HelpScreen(g, null)); ui.screen.parent = null; return true;
    case 'advancements': ui.open(new AdvancementsScreen(g, null)); return true;
    case 'companion': if (!Companion.shown) return false; if (Companion.ready) ui.open(new CompanionChatScreen(g)); else ui.open(new CompanionScreen(g, null)); return true;
    case 'toggleGui': ui.hideHud = !ui.hideHud; return false;
    case 'togglePerspective': g.perspective = (g.perspective + 1) % 3; return false;
    case 'fullscreen': toggleFullscreen(); return false;
    case 'screenshot': g.wantScreenshot = true; return false;
    case 'pickItem': g.pickBlock(); return false;
    case 'swapOffhand': if (g.mode !== 'spectator') g.swapOffhand(); return false;
    case 'drop':
      if (g.net) { if (g.mode !== 'spectator' && p.inv.held) { g.net.drop(!!(e && e.ctrlKey)); p.swing(); } return false; }
      if (g.mode !== 'spectator') {
        const h = p.inv.held;
        if (h) { const n = e && e.ctrlKey ? h.count : 1; g.dropFromPlayer({ ...h, count: n }); h.count -= n; if (!h.count) p.inv.slots[p.inv.sel] = null; p.swing(); }
      }
      return false;
    case 'jump':
      // creative: a double tap toggles flying first; otherwise a press in the air opens the elytra
      if (g.mode === 'creative' && now - (g.lastTap.space || 0) < 300) { p.flying = !p.flying; p.vel[1] = 0; p.gliding = false; g.lastTap.space = 0; return false; }
      g.lastTap.space = now;
      if (!p.onGround && !p.flying && g.tryGlide) g.tryGlide();
      return false;
    case 'forward':
      // double-tap forward to sprint, within the sprint window (ticks)
      if (now - (g.lastTap.w || 0) < (s.sprintWindow ?? 7) * 50) g.sprintToggle = true;
      g.lastTap.w = now;
      return false;
    case 'sneak': if (s.toggleSneak) g.sneakToggled = !g.sneakToggled; return false;
    case 'sprint': if (s.toggleSprint) g.sprintToggled = !g.sprintToggled; return false;
    case 'attack':
      if (s.toggleAttack) { g.mouseBtn[0] = !g.mouseBtn[0]; if (!g.mouseBtn[0]) return false; } else g.mouseBtn[0] = true;
      g.mouseClicked0 = true; g.attackCd = Math.min(g.attackCd, 0);
      if (!g.targetEntity && !g.target) p.swing();
      return false;
    case 'use':
      if (s.toggleUse) g.mouseBtn[2] = !g.mouseBtn[2]; else g.mouseBtn[2] = true;
      g.useCd = 0;
      return false;
  }
  if (act.startsWith('hotbar.')) p.inv.sel = +act.slice(7) - 1;
  return false;
}
function releaseAction(g, act) {
  const s = g.settings;
  if (act === 'attack' && !s.toggleAttack) g.mouseBtn[0] = false;
  if (act === 'use' && !s.toggleUse) g.mouseBtn[2] = false;
  if (act === 'forward') g.sprintToggle = false;
}

// ---- screens ----------------------------------------------------------------------------------------------
// ControlsScreen (26.2): mouse settings / key binds, then the hold-or-toggle options, auto-jump and the sprint window
Object.assign(OptionsListScreen.prototype, {
  controlOptions() {
    const s = this.game.settings, g = this.game;
    const bt = (label, fn, extra) => ({ label, onClick: () => { fn(); g.applySettings(); g.saveSettings(); }, ...extra });
    const sl = (label, val, set) => ({ slider: true, value: val, label, onChange: (v) => { set(v); g.applySettings(); g.saveSettings(); } });
    const hold = (cn, k) => bt(() => cn + '：' + (s[k] ? '切换' : '按住'), () => { s[k] = !s[k]; g.sneakToggled = g.sprintToggled = false; });
    const onoff = (v) => v ? '开' : '关';
    if (this.page === 'mouse') return [
      sl(() => '鼠标灵敏度：' + (s.sens < 0.01 ? '*哈欠*' : s.sens > 0.99 ? '超高速！！！' : Math.round(s.sens * 200) + '%'), s.sens, v => s.sens = Math.max(0.005, v)),
      bt(() => '反转鼠标X轴：' + onoff(s.invertX), () => s.invertX = !s.invertX),
      bt(() => '反转鼠标Y轴：' + onoff(s.invertY), () => s.invertY = !s.invertY),
      sl(() => '滚轮灵敏度：' + (s.scrollSens ?? 1).toFixed(2), Math.log10((s.scrollSens ?? 1) * 100) / 3, v => s.scrollSens = Math.round(Math.pow(10, v * 3 - 2) * 100) / 100),
      bt(() => '离散滚动：' + onoff(s.discreteScroll), () => s.discreteScroll = !s.discreteScroll),
      bt(() => '原始输入：' + onoff(s.rawInput !== false), () => { s.rawInput = s.rawInput === false; }),
    ];
    if (this.page === 'touch') return [
      sl(() => '按钮大小：' + Math.round(touchSizeOf(s) * 100) + '%', (touchSizeOf(s) - 0.5) / 1.5, v => s.touchSize = Math.round((0.5 + v * 1.5) * 20) / 20),
      sl(() => '按钮不透明度：' + Math.round((s.touchOpacity ?? 0.7) * 100) + '%', ((s.touchOpacity ?? 0.7) - 0.2) / 0.8, v => s.touchOpacity = Math.round((0.2 + v * 0.8) * 20) / 20),
      // (25%-500% on a log scale: 100% was the old default, the old most 180%)
      Object.assign(sl(() => '视角灵敏度：' + Math.round(touchLook(s) * 100) + '%', Math.log(touchLook(s) / 0.25) / Math.log(20), v => s.touchLook = Math.round(0.25 * Math.pow(20, v) * 20) / 20),
        { tip: ['手指滑动转视角的快慢（只管触屏，鼠标在「鼠标设置」里）'] }),
      bt(() => '疾跑按钮：' + (s.touchSprintBtn === false ? '隐藏' : '显示'), () => s.touchSprintBtn = s.touchSprintBtn === false),
    ];
    return [
      bt('鼠标设置…', () => g.ui.open(new OptionsListScreen(g, this, '鼠标设置', 'mouse'))),
      bt('按键绑定…', () => g.ui.open(new KeyBindsScreen(g, this))),
      Object.assign(bt(() => '触屏操作：' + onoff(touchOn(g)), () => { s.touch = !touchOn(g); if (g.ui.touch) g.ui.touch.reset(); }),
        { tip: ['在屏幕上显示虚拟按键，用手指操作游戏。', '检测到的设备：' + TouchDevice.name + '（默认' + (TouchDevice.defaultOn ? '开启' : '关闭') + '）'] }),
      // (bright blue with the gold buttons' glint: players didn't notice it among the other buttons, the user 2026-11-03)
      Object.assign(bt('触控设置…', () => g.ui.open(new OptionsListScreen(g, this, '触控设置', 'touch'))), { glowBlue: true }),
      hold('潜行', 'toggleSneak'), hold('疾跑', 'toggleSprint'),
      hold('攻击/摧毁', 'toggleAttack'), hold('使用物品/放置方块', 'toggleUse'),
      bt(() => '自动跳跃：' + onoff(s.autoJump), () => s.autoJump = !s.autoJump),
      Object.assign(sl(() => '疾跑间隔：' + (s.sprintWindow ?? 7) + '刻', ((s.sprintWindow ?? 7) - 1) / 9, v => s.sprintWindow = Math.round(1 + v * 9)),
        { tip: ['双击前进键激活疾跑的最大时间间隔，以刻为单位。'] }),
    ];
  },
});
// 皮肤与装饰 (COMMUNITY_PLAN.md「显示设置」): whose decorations are drawn - capes, hats, pets, name prefixes
// (settings.cosShow, cosmetics.js) - and the wardrobe
Object.assign(OptionsListScreen.prototype, {
  cosOptions() {
    const s = this.game.settings, g = this.game, ORDER = ['all', 'mine', 'none'], CN = { all: '全部', mine: '只显示自己的', none: '都不显示' };
    return [
      { label: () => '显示装饰：' + CN[s.cosShow || 'all'], onClick: () => { s.cosShow = ORDER[(ORDER.indexOf(s.cosShow || 'all') + 1) % ORDER.length]; g.saveSettings(); },
        tip: ['显示装饰：全部 / 只显示自己的 / 都不显示'] },
    ];
  },
});
(() => {
  const prev = OptionsListScreen.prototype.options;
  OptionsListScreen.prototype.options = function () {
    if (this.page === 'controls' || this.page === 'mouse' || this.page === 'touch') return this.controlOptions();
    if (this.page === 'cos') return this.cosOptions();
    return prev.call(this);
  };
})();

// KeyBindsScreen: categories with each binding, its key button and a reset button; 重置按键 / 完成
class KeyBindsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '按键绑定'); this.parent = parent; this.pauses = game.state === 'play'; this.titleY = 12; this.scroll = 0; this.sel = null; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game, s = g.settings;
    this.top = 33; this.bottom = u.h - 33;
    if (!s.keys) s.keys = {};
    const rows = [];
    for (const [cat, list] of KEYBIND_CATS) {
      rows.push({ cat });
      // (the AI companion's key only where the service has it on: not released yet - the user, 2026-11-02)
      for (const [n] of list) if (n !== 'companion' || (typeof Companion !== 'undefined' && Companion.shown)) rows.push({ name: n });
    }
    this.rows = rows;
    this.rowW = 340; this.rowX = cx - this.rowW / 2;
    this.footer = [
      { x: cx - 155, y: u.h - 27, w: 150, h: 20, label: '重置按键', onClick: () => { s.keys = {}; this.sel = null; g.saveSettings(); } },
      { x: cx + 5, y: u.h - 27, w: 150, h: 20, label: '完成', onClick: () => this.back() },
    ];
    this.place();
  }
  place() {
    const maxScroll = Math.max(0, this.rows.length * 20 + 4 - (this.bottom - this.top));
    this.scroll = clamp(this.scroll, 0, maxScroll);
    const g = this.game, s = g.settings, list = [];
    const right = this.rowX + this.rowW;
    this.rows.forEach((r, i) => {
      const y = this.top + 4 - this.scroll + i * 20;
      r.y = y;
      if (!r.name || y < this.top || y + 20 > this.bottom) return;
      const n = r.name, code = keyOf(g, n);
      const dup = !!code && bindingsFor(g, code).length > 1;
      list.push({ x: right - 50, y, w: 50, h: 20, label: '重置', enabled: code !== KEY_DEFAULT[n], onClick: () => { delete s.keys[n]; g.saveSettings(); this.place(); } });
      list.push({ x: right - 50 - 5 - 75, y, w: 75, h: 20, keyFor: n,
        label: () => this.sel === n ? '> ' + keyLabel(keyOf(g, n)) + ' <' : keyLabel(keyOf(g, n)),
        color: this.sel === n ? '#FFFF55' : dup ? '#FF5555' : null,
        tip: dup ? ['该按键也用于：', ...bindingsFor(g, code).filter(o => o !== n).map(o => KEY_CN[o])] : null,
        onClick: () => { this.sel = n; this.place(); } });
    });
    this.widgets = [...list, ...this.footer];
  }
  bind(code) {
    const g = this.game;
    g.settings.keys[this.sel] = code;
    this.sel = null; g.saveSettings(); this.place();
  }
  drawExtra(ui) {
    ui.listBackground(this.top, this.bottom);
    const c = ui.ctx;
    c.save(); c.beginPath(); c.rect(0, this.top, ui.w, this.bottom - this.top); c.clip();
    for (const r of this.rows) {
      if (r.y + 20 < this.top || r.y > this.bottom) continue;
      if (r.cat) Font.center(c, r.cat, ui.w / 2, r.y + 6, '#FFFFFF');
      else Font.draw(c, KEY_CN[r.name], this.rowX, r.y + 6, '#FFFFFF');
    }
    c.restore();
  }
  mouseDown(ui, mx, my, button) {
    if (this.sel) { this.bind('Mouse' + button); return; }
    super.mouseDown(ui, mx, my, button);
  }
  key(ui, ev) {
    if (this.sel) { this.bind(ev.code === 'Escape' ? '' : ev.code); return true; }
    if (ev.key === 'Escape') { this.back(); return true; }
    return false;
  }
  wheel(ui, dy) { this.scroll += Math.sign(dy) * 20; this.place(); }
  back() { this.game.saveSettings(); this.game.ui.open(this.parent); }
  onEsc() { this.back(); }
}
