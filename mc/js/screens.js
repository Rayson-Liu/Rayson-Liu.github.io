'use strict';
// ---------------------------------------------------------------------------
// Menu screens
// ---------------------------------------------------------------------------
const SPLASHES = ['也试试 Java 版！', '100% 纯手工打造！', '方块！', '在浏览器里运行！', '无需安装！', '还有苦力怕！', '挖矿与合成！', 'WebGL2！', '平滑光照！', '流动的水！', '会爆炸的 TNT！', '自带昼夜循环！', '小心岩浆！', '钻石！', '羊毛有很多颜色！'];

// importing a vanilla world (anvil.js): progress, then what came over and what didn't
class ImportScreen extends MenuScreen {
  constructor(game, parent, files) {
    super(game, '导入原版存档'); this.parent = parent; this.titleY = 20; this.p = 0; this.stats = null; this.result = null; this.error = null;
    VanillaImport.run(game, files, (p, s) => { this.p = p; this.stats = s; })
      .then((r) => { this.result = r; this.layout(); }, (e) => { console.error(e); this.error = String(e && e.message || e); this.layout(); });
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    this.widgets = [];
    if (this.result) {
      this.widgets.push({ x: cx - 154, y: u.h - 40, w: 150, h: 20, label: '进入世界', onClick: () => g.loadWorld(this.result.meta.id) });
      this.widgets.push({ x: cx + 4, y: u.h - 40, w: 150, h: 20, label: '返回', onClick: () => g.ui.open(new WorldListScreen(g)) });
    } else if (this.error) this.widgets.push({ x: cx - 100, y: u.h - 40, w: 200, h: 20, label: '返回', onClick: () => g.ui.open(new WorldListScreen(g)) });
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2;
    let y = 44;
    const line = (t, col = '#FFFFFF') => { Font.center(c, t, cx, y, col); y += 11; };
    if (this.error) { line('导入失败', '#FF5555'); y += 4; line(this.error, '#FFFFFF'); return; }
    const s = this.result ? this.result.stats : this.stats;
    if (!this.result) {
      line('正在读取区块…');
      const bw = 182, bx = Math.floor(cx - bw / 2);
      c.fillStyle = '#808080'; c.fillRect(bx, y + 2, bw, 3);
      c.fillStyle = '#80FF80'; c.fillRect(bx, y + 2, Math.floor(bw * this.p), 3);
      y += 12;
      if (s) line(`已导入 ${s.chunks} 个区块，区域文件 ${s.regions} 个`, '#A0A0A0');
      return;
    }
    const m = this.result.meta, dn = { overworld: '主世界', nether: '下界', end: '末地' };
    line(`“${m.name}” 导入完成`, '#55FF55');
    line(`原版 ${m.imported.version}，种子 ${m.seed}`, '#A0A0A0');
    line('区块：' + Object.entries(s.perDim).map(([d, n]) => `${dn[d] || d} ${n}`).join('，') + `；箱子和熔炉 ${s.containers} 个；生物和载具等 ${s.entities || 0} 个`);
    if (s.entitiesMissing && s.entitiesMissing.length) line('本游戏还没有、没导入的实体：' + s.entitiesMissing.slice(0, 4).map(([n, k]) => `${n} ×${k}`).join('，'), '#A0A0A0');
    if (s.partial || s.old || s.skipped) line(`未完成生成的区块 ${s.partial} 个（进入后由生成器补全）` + (s.old ? `，1.18 以前格式 ${s.old} 个` : '') + (s.skipped ? `，无法读取 ${s.skipped} 个` : ''), '#A0A0A0');
    if (s.substituted && s.substituted.length) {
      line(`本游戏还没有、以相近方块代替的：${s.substituted.length} 种`, '#FFFF55');
      line(s.substituted.slice(0, 5).map(([n, k]) => `${n} ×${k}`).join('，'), '#A0A0A0');
    }
    if (s.missing.length) {
      line(`本游戏还没有、以空气代替的：${s.missing.length} 种`, '#FFFF55');
      line(s.missing.slice(0, 5).map(([n, k]) => `${n} ×${k}`).join('，'), '#A0A0A0');
    }
    y += 4; line('没探索过的地方会按同一个种子生成，和原版地形一致', '#A0A0A0');
  }
  onEsc() { if (this.result || this.error) this.game.ui.open(new WorldListScreen(this.game)); }
}

class LoadingScreen extends MenuScreen {
  constructor(game, text) { super(game, null); this.text = text; this.blurBg = false; this.bgDirt = true; this.pauses = false; this.queue = null; }
  // waiting for a room to start on a full server: the place in the queue, a way out, and after two minutes the
  // public rooms and local rooms suggested
  setQueue(q) {
    const was = !!this.queue;
    this.queue = q ? { ...q, since: (this.queue && this.queue.since) || performance.now() } : null;
    if (was !== !!q) this.layout();
  }
  layout() {
    const u = this.game.ui, g = this.game, cx = u.w / 2;
    this.widgets = []; // 离线版：联机排队界面已移除
  }
  drawExtra(ui) {
    const c = ui.ctx, g = this.game, q = this.queue;
    if (q) {
      Font.center(c, '服务器上的房间已经满了，正在排队', ui.w / 2, ui.h / 2 - 30, '#FFFFFF');
      Font.center(c, `你的房间排在第 ${q.pos} 位（一共 ${q.of} 个在等），有位置时会自动启动`, ui.w / 2, ui.h / 2 - 14, '#A0A0A0');
      const secs = Math.floor((performance.now() - q.since) / 1000);
      Font.center(c, `已经等了 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒`, ui.w / 2, ui.h / 2 + 2, '#A0A0A0');
      if (secs >= 120) Font.center(c, '等太久的话，可以先加入正在玩的公开房间，或者在「联机」里开本地房间', ui.w / 2, ui.h / 2 + 30, '#FFFF55');
      return;
    }
    const msg = this.text || '正在生成地形…';
    Font.center(c, msg, ui.w / 2, ui.h / 2 - 20, '#FFFFFF');
    const p = g.loadProgress || 0, bw = 182, bx = Math.floor(ui.w / 2 - bw / 2), by = Math.floor(ui.h / 2);
    c.fillStyle = '#808080'; c.fillRect(bx, by, bw, 3);
    c.fillStyle = '#80FF80'; c.fillRect(bx, by, Math.floor(bw * p), 3);
    Font.center(c, `区块: ${g.world ? g.world.chunks.size : 0}`, ui.w / 2, by + 10, '#A0A0A0');
  }
}

// vanilla 26.x title screen (LogoRenderer / SplashRenderer positions); the live world replaces the panorama
class TitleScreen extends MenuScreen {
  constructor(game) { super(game, null); this.blurBg = false; this.bgDim = 0; this.splash = SPLASHES[(Math.random() * SPLASHES.length) | 0]; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, l = Math.floor(u.h / 4 + 48), g = this.game;
    this.widgets = [
      { x: cx - 100, y: l, w: 200, h: 20, label: '单人游戏', onClick: () => g.ui.open(new WorldListScreen(g)) },
      { x: cx - 100, y: l + 24, w: 200, h: 20, label: '游戏说明', onClick: () => g.ui.open(new HelpScreen(g, this)) },
      { x: cx - 100, y: l + 48, w: 98, h: 20, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      { x: cx + 2, y: l + 48, w: 98, h: 20, label: '退出游戏', onClick: () => quitGame(g) },
      fsSupported() ? { x: cx + 104, y: l + 48, w: 20, h: 20, icon: 'icon_accessibility', tip: ['全屏'], onClick: () => toggleFullscreen() } : null,
    ].filter(Boolean);
  }
  drawExtra(ui) {
    const c = ui.ctx, w = ui.w, lg = ui.img.logo, ed = ui.img.edition;
    // LogoRenderer: blit(logo, w/2-128, 30, 0, 0, 256, 44, 256, 64); blit(edition, w/2-64, 67, 0, 0, 128, 14, 128, 16)
    const lx = Math.floor(w / 2 - 128), ly = 30;
    c.imageSmoothingEnabled = true;
    c.drawImage(lg, 0, 0, lg.width, lg.height * 44 / 64, lx, ly, 256, 44);
    c.drawImage(ed, 0, 0, ed.width, ed.height * 14 / 16, lx + 64, ly + 37, 128, 14);
    c.imageSmoothingEnabled = false;
    // SplashRenderer
    c.save();
    c.translate(w / 2 + 123, 69);
    c.rotate(-20 * Math.PI / 180);
    let s = 1.8 - Math.abs(Math.sin((performance.now() % 1000) / 1000 * Math.PI * 2) * 0.1);
    s = s * 100 / (Font.width(this.splash) + 32);
    c.scale(s, s);
    Font.center(c, this.splash, 0, -8, '#FFFF00');
    c.restore();
    // 「退出游戏」could not close the page (quitGame)
    if (this.quitTip && performance.now() - this.quitTip < 6000) {
      const q = '这里不能直接关闭网页，请用返回键或关闭标签页退出', l = Math.floor(ui.h / 4 + 48) + 108;
      c.globalAlpha = 0.6; c.fillStyle = '#000'; c.fillRect(Math.floor(w / 2 - Font.width(q) / 2 - 4), l - 2, Font.width(q) + 8, 12); c.globalAlpha = 1;
      Font.center(c, q, w / 2, l, '#FFFF55');
    }
    Font.draw(c, 'OpusMC · 仅在 B站 Toy 平台发布', 2, ui.h - 10, '#FFFFFF');
    const t = '非官方作品-UP主自制toy';
    Font.draw(c, t, ui.w - Font.width(t) - 2, ui.h - 10, '#FFFFFF');
  }
}

// vanilla SelectWorldScreen + WorldSelectionList
class WorldListScreen extends MenuScreen {
  constructor(game) {
    super(game, '选择世界'); this.titleY = 8; this.worlds = null; this.sel = -1; this.scroll = 0; this.filter = ''; this.icons = {};
    // (storage that fails - blocked, full, a broken database: said, instead of 加载世界列表中 for ever)
    DB.listWorlds().then(w => { this.worlds = w; this.layout(); })
      .catch((e) => { console.error(e); this.worlds = []; this.loadErr = '读取存档失败: ' + String(e && e.message || e); this.layout(); });
  }
  shown() { return (this.worlds || []).filter(w => !this.filter || w.name.toLowerCase().includes(this.filter.toLowerCase())); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    const list = this.shown(), has = this.sel >= 0 && !!list[this.sel];
    this.widgets = [
      { x: cx - 154, y: u.h - 76, w: 150, h: 20, label: '导入原版存档（文件夹）', onClick: () => this.pick(true), tip: ['选择原版 Java 版存档的世界文件夹', '（里面有 level.dat），支持 1.18 及以上'] },
      { x: cx + 4, y: u.h - 76, w: 150, h: 20, label: '导入原版存档（.zip）', onClick: () => this.pick(false), tip: ['选择打包成 .zip 的原版世界存档', '手机上请用这个'] },
      { x: cx - 154, y: u.h - 52, w: 150, h: 20, label: '进入选中的世界', enabled: has, onClick: () => this.play() },
      { x: cx + 4, y: u.h - 52, w: 150, h: 20, label: '创建新的世界', onClick: () => g.ui.open(new CreateWorldScreen(g, this)) },
      { x: cx - 154, y: u.h - 28, w: 72, h: 20, label: '编辑', enabled: has, onClick: () => g.ui.open(new EditWorldScreen(g, this, list[this.sel])) },
      { x: cx - 76, y: u.h - 28, w: 72, h: 20, label: '删除', enabled: has, onClick: () => this.del() },
      { x: cx + 4, y: u.h - 28, w: 72, h: 20, label: '重建', enabled: has, onClick: () => g.ui.open(new CreateWorldScreen(g, this, list[this.sel])) },
      { x: cx + 82, y: u.h - 28, w: 72, h: 20, label: '取消', onClick: () => this.onEsc() },
    ];
    this.listTop = 48; this.listBottom = u.h - 88; this.rowW = 270;
    this.search = { x: cx - 100, y: 22, w: 200, h: 20 };
    u.showInput(this.search.x + 4, this.search.y + 6, this.search.w - 8, 10, this.filter, () => { if (this.sel >= 0) this.play(); },
      { onInput: (v) => { this.filter = v; this.sel = -1; this.scroll = 0; this.layout(); }, onEsc: () => this.onEsc(), max: 32 });
  }
  play() { const w = this.shown()[this.sel]; if (w) { this.game.ui.hideInput(); this.game.loadWorld(w.id); } }
  // the browser's file picker: a world folder, or a .zip of one
  pick(folder) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (folder) { inp.webkitdirectory = true; inp.multiple = true; } else inp.accept = '.zip,application/zip';
    inp.onchange = () => { if (inp.files && inp.files.length) { this.game.ui.hideInput(); this.game.ui.open(new ImportScreen(this.game, this, inp.files)); } };
    inp.click();
  }
  del() {
    const w = this.shown()[this.sel]; if (!w) return;
    const g = this.game;
    g.ui.open(new ConfirmScreen(g, '你确定要删除这个世界吗？', `“${w.name}”将会永久消失！（真的很久！）`, '删除', async (yes) => {
      if (yes) { await DB.deleteWorld(w.id); this.worlds = await DB.listWorlds(); this.sel = -1; }
      g.ui.open(this);
    }));
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, top = this.listTop, bottom = this.listBottom;
    ui.listBackground(top, bottom);
    ui.nine('text_field_hl', this.search.x, this.search.y, this.search.w, this.search.h, 1);
    if (!ui.input.value && document.activeElement !== ui.input) Font.draw(c, '搜索世界', this.search.x + 4, this.search.y + 6, '#707070');
    if (DB.backend === 'memory') Font.center(c, '注意：当前浏览器禁止本地存储，存档在关闭页面后会丢失', cx, bottom + 2, '#FF5555');
    if (!this.worlds) { Font.center(c, '加载世界列表中', cx, top + 20, '#FFFFFF'); return; }
    if (this.loadErr) Font.center(c, fitText(this.loadErr, ui.w - 8), cx, top + 20, '#FF5555');
    const list = this.shown(), rowH = 36, x0 = Math.floor(cx - this.rowW / 2) + 2;
    const vis = Math.floor((bottom - top - 4) / rowH);
    this.scroll = clamp(this.scroll, 0, Math.max(0, list.length - vis));
    c.save(); c.beginPath(); c.rect(0, top, ui.w, bottom - top); c.clip();
    list.slice(this.scroll, this.scroll + vis + 1).forEach((w, i) => {
      const y = top + 4 + i * rowH, idx = i + this.scroll;
      if (idx === this.sel) {
        c.fillStyle = '#FFFFFF'; c.fillRect(x0 - 2, y - 2, this.rowW, 36);
        c.fillStyle = '#000000'; c.fillRect(x0 - 1, y - 1, this.rowW - 2, 34);
      }
      // world icon: snapshot taken when the world was first played, or vanilla's "unknown" icon
      let icon = this.icons[w.id];
      if (w.icon && !icon) { icon = this.icons[w.id] = new Image(); icon.src = w.icon; }
      c.imageSmoothingEnabled = true;
      c.drawImage(icon && icon.complete && icon.naturalWidth ? icon : ui.img.unknown_server, x0, y, 32, 32);
      c.imageSmoothingEnabled = false;
      const hov = ui.mouse.y >= Math.max(top, y - 2) && ui.mouse.y < Math.min(bottom, y + 34) && ui.mouse.x >= x0 - 2 && ui.mouse.x < x0 - 2 + this.rowW;
      if (hov) {
        c.fillStyle = 'rgba(144,144,144,0.627)'; c.fillRect(x0, y, 32, 32);
        ui.sprite(ui.mouse.x - x0 < 32 ? 'wl_join_hl' : 'wl_join', x0, y);
      }
      Font.draw(c, w.name, x0 + 35, y + 1, '#FFFFFF');
      const d = new Date(w.lastPlayed), pad = (n) => String(n).padStart(2, '0');
      Font.draw(c, `${w.id} (${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())})`, x0 + 35, y + 12, '#808080');
      let tx = x0 + 35;
      const part = (t, col) => { Font.draw(c, t, tx, y + 21, col); tx += Font.width(t); };
      if (w.hardcore) part('极限模式', '#FF0000'); else part(w.mode === 'creative' ? '创造模式' : w.mode === 'spectator' ? '旁观模式' : '生存模式', '#808080');
      if (w.cheats ?? true) part(', 命令', '#808080');
      part(', 26.2', '#808080');
    });
    c.restore();
    if (!list.length && this.filter) Font.center(c, '找不到匹配的世界', cx, top + 20, '#AAAAAA');
    if (list.length > vis) {
      const sx = Math.floor(cx + this.rowW / 2 + 4), h = bottom - top, bh = clamp(Math.floor(h * h / (list.length * rowH + 4)), 32, h - 8);
      const by = top + Math.floor((h - bh) * this.scroll / Math.max(1, list.length - vis));
      ui.nine('wscroller_bg', sx, top, 6, h, 1); ui.nine('wscroller', sx, by, 6, bh, 1);
    }
  }
  mouseDown(ui, mx, my, b) {
    const list = this.shown(), x0 = Math.floor(ui.w / 2 - this.rowW / 2) + 2;
    if (this.worlds && my >= this.listTop && my < this.listBottom && mx >= x0 - 2 && mx < x0 - 2 + this.rowW) {
      const i = Math.floor((my - this.listTop - 4 + 2) / 36) + this.scroll;
      if (i < list.length && i >= 0) {
        const now = performance.now();
        Sound.init(); Sound.click();
        if (mx - x0 < 32 || (this.sel === i && now - (this.lastT || 0) < 250)) { this.sel = i; this.play(); return; }
        this.sel = i; this.lastT = now; this.layout();
      }
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(ui, dy) { if (this.worlds) this.scroll += Math.sign(dy); }
  onEsc() { this.game.ui.hideInput(); this.game.ui.open(new TitleScreen(this.game)); }
}

// vanilla ConfirmScreen
class ConfirmScreen extends MenuScreen {
  constructor(game, title, message, yesLabel, cb) { super(game, title); this.titleY = 70; this.message = message; this.yesLabel = yesLabel; this.cb = cb; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.floor(u.h / 6 + 96);
    this.widgets = [
      { x: cx - 155, y, w: 150, h: 20, label: this.yesLabel, onClick: () => this.cb(true) },
      { x: cx + 5, y, w: 150, h: 20, label: '取消', onClick: () => this.cb(false) },
    ];
  }
  drawExtra(ui) { Font.center(ui.ctx, this.message, ui.w / 2, 90, '#FFFFFF'); }
  onEsc() { this.cb(false); }
}

// vanilla EditWorldScreen
class EditWorldScreen extends MenuScreen {
  constructor(game, parent, world) { super(game, '编辑世界'); this.titleY = 15; this.parent = parent; this.world = world; this.name = world.name; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.field = { x: cx - 100, y: 53, w: 200, h: 20 };
    const no = { enabled: false, tip: ['网页版无法访问存档文件夹'] };
    this.widgets = [
      { x: cx - 100, y: 77, w: 200, h: 20, label: '重置图标', enabled: !!this.world.icon, onClick: async () => { delete this.world.icon; delete this.parent.icons[this.world.id]; await DB.putWorld(this.world); this.layout(); } },
      { x: cx - 100, y: 101, w: 200, h: 20, label: '打开世界文件夹', ...no },
      { x: cx - 100, y: 125, w: 200, h: 20, label: '进行备份', ...no },
      { x: cx - 100, y: 149, w: 200, h: 20, label: '打开备份文件夹', ...no },
      { x: cx - 100, y: 173, w: 200, h: 20, label: '优化世界', ...no },
      { x: cx - 100, y: u.h - 27, w: 98, h: 20, label: '保存', onClick: () => this.save() },
      { x: cx + 2, y: u.h - 27, w: 98, h: 20, label: '取消', onClick: () => this.back() },
    ];
    u.showInput(this.field.x + 4, this.field.y + 6, this.field.w - 8, 10, this.name, () => this.save(), { onInput: (v) => { this.name = v; }, onEsc: () => this.back(), max: 32 });
  }
  async save() { this.world.name = this.name.trim() || this.world.name; await DB.putWorld(this.world); this.back(); }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
  drawExtra(ui) {
    Font.draw(ui.ctx, '世界名称', this.field.x, 40, '#A0A0A0');
    ui.nine('text_field_hl', this.field.x, this.field.y, this.field.w, this.field.h, 1);
  }
  onEsc() { this.back(); }
}

// vanilla CreateWorldScreen: TabNavigationBar (游戏 / 世界 / 更多) + footer
class CreateWorldScreen extends MenuScreen {
  constructor(game, parent, from) {
    super(game, null); this.parent = parent; this.tab = 0;
    this.name = from ? from.name : '新的世界'; this.seed = from ? String(from.seed) : '';
    this.mode = from ? (from.hardcore ? 'hardcore' : from.mode === 'creative' ? 'creative' : 'survival') : 'survival'; this.flat = from ? !!from.flat : false;
    this.difficulty = from ? (from.difficulty ?? 2) : 2; this.cheats = from ? (from.cheats ?? true) : false;
    this.structures = from ? from.structures !== false : true; this.bonus = from ? !!from.bonus : false;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    const tabsW = Math.min(400, u.w) - 28, tw = Math.floor(tabsW / 3), tx0 = Math.floor(cx - tw * 3 / 2);
    this.tabs = ['游戏', '世界', '更多'].map((t, i) => ({ x: tx0 + i * tw, y: 0, w: tw, h: 24, label: t }));
    const area = u.h - 33 - 24, top = (h) => 24 + Math.floor((area - h) / 6); // GridLayoutTab: aligned at 1/6 of the tab area
    const W = [];
    const MODES = { survival: ['生存', '探索未知的世界，尽情建造、收集、合成并与怪物战斗。'], hardcore: ['极限', '难度锁定为“困难”的生存模式，且死亡后无法重生。'], creative: ['创造', '无拘无束地探索创造。可以飞行，材料取之不尽，且不受怪物伤害。'] };
    const DIFF = [['和平', '不会生成绝大多数敌对生物。饥饿值不会消耗，且生命值会自然恢复。'], ['简单', '敌对生物会生成，但伤害较低。生命值在饥饿值耗尽后最终会降至5颗心。'], ['普通', '敌对生物会生成，且伤害适中。生命值在饥饿值耗尽后最终会降至半颗心。'], ['困难', '敌对生物会生成，且伤害较高。饥饿值耗尽后最终会饿死。']];
    const hc = this.mode === 'hardcore';
    this.field = null; this.fieldLabel = null;
    if (this.tab === 0) {
      const y = top(117), cw = cx - 105;
      this.field = { x: cx - 104, y: y + 13, w: 208, h: 20 }; this.fieldLabel = ['世界名称', y];
      W.push({ x: cw, y: y + 41, w: 210, h: 20, label: () => '游戏模式：' + MODES[this.mode][0], tip: [MODES[this.mode][1]],
        onClick: () => { this.mode = { survival: 'hardcore', hardcore: 'creative', creative: 'survival' }[this.mode]; this.cheats = this.mode === 'creative'; this.layout(); } });
      W.push({ x: cw, y: y + 69, w: 210, h: 20, label: () => '难度：' + (hc ? '极限' : DIFF[this.difficulty][0]), enabled: !hc, tip: hc ? null : [DIFF[this.difficulty][1]], onClick: () => { this.difficulty = (this.difficulty + 1) % 4; this.layout(); } });
      W.push({ x: cw, y: y + 97, w: 210, h: 20, label: () => '允许命令：' + (this.cheats && !hc ? '开' : '关'), enabled: !hc, tip: ['例如/gamemode、/experience等命令'], onClick: () => { this.cheats = !this.cheats; } });
      u.showInput(this.field.x + 4, this.field.y + 6, this.field.w - 8, 10, this.name, () => this.create(), { onInput: (v) => { this.name = v; }, onEsc: () => this.back(), max: 32 });
    } else if (this.tab === 1) {
      const y = top(117), cw = cx - 155;
      W.push({ x: cw, y, w: 150, h: 20, label: () => '世界类型：' + (this.flat ? '超平坦' : '默认'), onClick: () => { this.flat = !this.flat; } });
      W.push({ x: cw + 160, y, w: 150, h: 20, label: '自定义', enabled: false });
      this.field = { x: cx - 154, y: y + 41, w: 308, h: 20 }; this.fieldLabel = ['世界生成器的种子', y + 28];
      W.push({ x: cw, y: y + 69, w: 310, h: 20, label: () => '生成结构：' + (this.structures ? '开' : '关'), tip: ['村庄、沉船等'], onClick: () => { this.structures = !this.structures; } });
      W.push({ x: cw, y: y + 97, w: 310, h: 20, label: () => '奖励箱：' + (this.bonus ? '开' : '关'), onClick: () => { this.bonus = !this.bonus; } });
      u.showInput(this.field.x + 4, this.field.y + 6, this.field.w - 8, 10, this.seed, () => this.create(), { onInput: (v) => { this.seed = v; }, onEsc: () => this.back(), max: 32 });
    } else {
      const y = top(68), cw = cx - 105;
      u.hideInput();
      const no = { enabled: false, tip: ['本复刻版暂不支持'] };
      W.push({ x: cw, y, w: 210, h: 20, label: '游戏规则', ...no });
      W.push({ x: cw, y: y + 24, w: 210, h: 20, label: '实验性内容', ...no });
      W.push({ x: cw, y: y + 48, w: 210, h: 20, label: '数据包', ...no });
    }
    W.push({ x: cx - 154, y: u.h - 27, w: 150, h: 20, label: '创建新的世界', onClick: () => this.create() });
    W.push({ x: cx + 4, y: u.h - 27, w: 150, h: 20, label: '取消', onClick: () => this.back() });
    this.widgets = W;
  }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
  create() {
    const g = this.game;
    g.ui.hideInput();
    const hc = this.mode === 'hardcore';
    this.error = null;
    // (a world that could not be made - storage refused, the generator threw: this screen again with why, instead of
    // nothing happening or the loading screen for ever)
    g.createWorld(this.name.trim() || '新的世界', this.seed.trim(), hc ? 'survival' : this.mode, this.flat,
      { hardcore: hc, difficulty: hc ? 3 : this.difficulty, cheats: !hc && this.cheats, structures: this.structures, bonus: this.bonus })
      .catch((e) => {
        console.error(e);
        this.error = '创建世界失败: ' + String(e && e.message || e);
        if (g.state !== 'play' && g.state !== 'loading') g.ui.open(this);
      });
  }
  drawExtra(ui) {
    const c = ui.ctx, t0 = this.tabs[0], t2 = this.tabs[2];
    // TabNavigationBar: header background, separator either side of the tabs
    ui.tile('tab_header_bg', 0, 0, ui.w, 24);
    ui.tile(ui.sepName('header'), 0, 22, t0.x, 2);
    ui.tile(ui.sepName('header'), t2.x + t2.w, 22, ui.w - t2.x - t2.w, 2);
    this.tabs.forEach((t, i) => {
      const hov = ui.hit(t), sel = i === this.tab;
      ui.nine(sel ? (hov ? 'tab_sel_hl' : 'tab_sel') : (hov ? 'tab_hl' : 'tab'), t.x, t.y, t.w, t.h, 2);
      Font.center(c, t.label, t.x + t.w / 2, t.y + (sel ? 8 : 10), sel ? '#FFFFFF' : '#A0A0A0');
      if (sel) { const lw = Math.min(Font.width(t.label), t.w - 4); c.fillStyle = '#FFFFFF'; c.fillRect(Math.floor(t.x + (t.w - lw) / 2), t.y + t.h - 2, lw, 1); }
    });
    ui.tile(ui.sepName('footer'), 0, ui.h - 35, ui.w, 2);
    if (this.error) Font.center(c, fitText(this.error, ui.w - 8), ui.w / 2, ui.h - 46, '#FF5555');
    if (this.field) {
      Font.draw(c, this.fieldLabel[0], this.field.x, this.fieldLabel[1], '#FFFFFF');
      ui.nine('text_field_hl', this.field.x, this.field.y, this.field.w, this.field.h, 1);
      if (this.tab === 1 && !ui.input.value && document.activeElement !== ui.input) Font.draw(c, '留空以生成随机种子', this.field.x + 4, this.field.y + 6, '#707070');
    }
  }
  mouseDown(ui, mx, my, b) {
    for (let i = 0; i < this.tabs.length; i++) if (ui.hit(this.tabs[i], mx, my)) { if (this.tab !== i) { this.tab = i; this.layout(); Sound.init(); Sound.click(); } return; }
    super.mouseDown(ui, mx, my, b);
  }
  onEsc() { this.back(); }
}

// vanilla OptionsScreen: header (title + FOV / difficulty), 2-column grid of sub-menus, 完成
class OptionsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '选项'); this.parent = parent; this.pauses = game.state === 'play'; this.titleY = 12; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, s = this.game.settings, g = this.game;
    const DIFF = ['和平', '简单', '普通', '困难'];
    const top = 61 + Math.floor((u.h - 33 - 61 - 116) / 2);
    const sub = (i, label, make) => ({ x: i % 2 ? cx + 5 : cx - 155, y: top + Math.floor(i / 2) * 24, w: 150, h: 20, label, enabled: !!make, tip: make ? null : ['本复刻版暂不支持'], onClick: () => make && g.ui.open(make()) });
    this.widgets = [
      { slider: true, x: cx - 155, y: 29, w: 150, h: 20, value: (s.fov - 30) / 80, label: () => '视场角：' + (Math.round(s.fov) === 70 ? '中' : Math.round(s.fov) === 110 ? '超广角' : Math.round(s.fov)), onChange: (v) => { s.fov = Math.round(30 + v * 80); g.applySettings(); g.saveSettings(); } },
      { x: cx + 5, y: 29, w: 150, h: 20, label: () => '难度：' + (g.hardcore ? '极限' : DIFF[g.difficulty]), enabled: !g.hardcore && g.state === 'play', onClick: () => { g.difficulty = (g.difficulty + 1) % 4; } },
      sub(0, '皮肤自定义…', null),
      sub(1, '声音…', () => new OptionsListScreen(g, this, '声音选项', 'sound')),
      sub(2, '视频设置…', () => new OptionsListScreen(g, this, '视频设置', 'video')),
      sub(3, '控制…', () => new OptionsListScreen(g, this, '按键控制', 'controls')),
      sub(4, '语言…', null),
      sub(5, '聊天设置…', null),
      sub(6, '资源包…', null),
      sub(7, '辅助功能设置…', () => new OptionsListScreen(g, this, '辅助功能设置', 'access')),
      sub(8, '制作人员名单与致谢…', () => creditsRoll(g, this)),
      { x: cx - 100, y: u.h - 27, w: 200, h: 20, label: '完成', onClick: () => this.done() },
    ];
  }
  done() { this.game.saveSettings(); this.game.ui.open(this.parent); }
  onEsc() { this.done(); }
}
// 选项 → 制作人员名单与致谢: the credits roll (dims.js CreditsScreen) - the button opened 游戏说明 (players' feedback
// 11-01 to 11-03, 4+). As vanilla's from the options: without the End poem; and a click or a tap goes back (a phone has
// no Esc, and the whole roll takes minutes)
function creditsRoll(g, parent) {
  const sc = new CreditsScreen(g, () => g.ui.open(parent)), L = sc.lines, i = L.findIndex((l) => l.t === '============');
  if (i > 9) sc.lines = [...L.slice(0, 9), ...L.slice(i - 1)]; // (the blank lines and the logo, then the credits)
  sc.pauses = g.state === 'play'; sc.onEsc = () => sc.finish(); sc.mouseDown = () => sc.finish();
  return sc;
}

// vanilla OptionsSubScreen: header title, OptionsList (rows of two 150-wide buttons, 25 tall) on the list background, 完成
class OptionsListScreen extends MenuScreen {
  constructor(game, parent, title, page) { super(game, title); this.parent = parent; this.page = page; this.pauses = game.state === 'play'; this.titleY = 12; this.scroll = 0; }
  options() {
    const s = this.game.settings, g = this.game;
    const sl = (label, val, set, wide) => ({ slider: true, wide, value: val, label, onChange: (v) => { set(v); g.applySettings(); g.saveSettings(); } });
    const bt = (label, fn, extra) => ({ label, onClick: () => { fn(); g.applySettings(); g.saveSettings(); }, ...extra });
    const onoff = (v) => v ? '开' : '关';
    // vanilla accessibility: how much flying, sprinting and drawing a bow change the field of view
    if (this.page === 'access') return [
      sl(() => '视场角效果：' + ((s.fovEffects ?? 1) > 0 ? Math.round((s.fovEffects ?? 1) * 100) + '%' : '关'), s.fovEffects ?? 1, v => s.fovEffects = Math.round(v * 20) / 20, true),
    ];
    if (this.page === 'sound') return [
      sl(() => '主音量：' + (s.volume > 0 ? Math.round(s.volume * 100) + '%' : '关'), s.volume, v => s.volume = v, true),
      bt(() => '显示字幕：' + onoff(!!s.subtitles), () => s.subtitles = !s.subtitles, { tip: ['在屏幕右下角用文字列出听到的声音和方向'] }),
    ];
    // changing one of the options a preset sets makes the preset "custom"
    const own = (fn) => (v) => { s.preset = 'custom'; fn(v); };
    // (maxFps 0 is 60 on a 90/120 Hz phone or tablet, -1 the display's own rate there - perf.js FramePacer.playLimit)
    const fpsLabel = () => '最大帧率：' + (s.maxFps > 0 ? s.maxFps + ' fps' : s.maxFps !== -1 && this.game.pacer && this.game.pacer.auto60 ? '自动（60 fps）' : '无限制');
    return [
      bt(() => '画质预设：' + (PRESET_NAMES[s.preset] || '自定义') + (s.preset === 'auto' && s.autoPreset ? '（' + PRESET_NAMES[s.autoPreset] + '）' : ''), () => {
        const order = ['auto', 'low', 'medium', 'high', 'ultra'];
        applyPreset(g, order[(order.indexOf(s.preset) + 1) % order.length]);
      }, { tip: ['自动：按设备性能选择（' + TouchDevice.name + '）', '低 / 中 / 高 / 极高：渲染距离、分辨率、云、图形品质'] }),
      bt(() => '图形品质：' + (s.graphics === 'fast' ? '流畅' : '高品质'), own(() => { s.graphics = s.graphics === 'fast' ? 'fancy' : 'fast'; g.graphicsChanged(); }),
        { tip: ['流畅：树叶不透明，相邻树叶之间的面不绘制', '省显存和显卡，森林里更流畅'] }),
      bt(() => '光影：' + FX_NAMES[s.shaders || 0] + (g.renderer.fx && !g.renderer.fx.ok ? '（不支持）' : ''), () => { if (g.renderer.fx && g.renderer.fx.ok) s.shaders = ((s.shaders || 0) + 1) % FX_NAMES.length; }, { tip: ['关 / 低 / 中 / 高 / 极限：实时阴影、水面反射、体积光等'] }),
      bt(() => '渲染分辨率：' + Math.round(s.resScale * 100) + '%', own(() => { s.resScale = s.resScale >= 1 ? 0.5 : s.resScale + 0.25; })),
      sl(() => '渲染距离：' + s.renderDist + '个区块', (s.renderDist - 2) / 14, own(v => s.renderDist = Math.round(2 + v * 14)), true),
      // vanilla: 10 - 260 in steps of 10, the top end is "unlimited"
      sl(fpsLabel, s.maxFps > 0 ? (s.maxFps - 10) / 250 : 1, v => { const f = Math.round(v * 25) * 10 + 10; s.maxFps = f >= 260 ? (s.maxFps === -1 ? -1 : 0) : f; }),
      bt(() => '垂直同步：' + onoff(s.vsync !== false), () => s.vsync = s.vsync === false, { tip: ['开：帧与显示器刷新同步，不撕裂', '关：帧率可超过刷新率（浏览器需带 --disable-gpu-vsync 启动才能显示出来）'] }),
      bt(() => '动态分辨率：' + onoff(s.dynRes), own(() => s.dynRes = !s.dynRes), { tip: ['显卡跟不上时自动降低渲染分辨率（最低 50%），恢复后再调回'] }),
      bt(() => '云：' + (s.clouds ? '高品质' : '关'), own(() => s.clouds = !s.clouds)),
      sl(() => '亮度：' + (s.gamma < 0.01 ? '昏暗' : s.gamma > 0.99 ? '明亮' : Math.round(s.gamma * 100) + '%'), s.gamma, v => s.gamma = v),
      bt(() => '界面尺寸：' + (s.guiScale || '自动'), () => { s.guiScale = (s.guiScale + 1) % 5; setTimeout(() => g.ui.resize(), 0); }),
      fsSupported() ? bt(() => '全屏：' + onoff(!!fsElement()), () => toggleFullscreen()) : bt('全屏：不支持', () => { }, { enabled: false, tip: ['这个浏览器不支持网页全屏'] }),
      bt(() => '视角摇晃：' + onoff(s.bobbing), () => s.bobbing = !s.bobbing),
      bt('平滑光照：开', () => { }, { enabled: false }),
      bt('复制性能报告', () => copyText(PerfMon.report(g, null, 0)).then(ok => g.ui.message(ok ? '性能报告已复制到剪贴板' : '无法写入剪贴板，报告已输出到浏览器控制台', '#FFFF55')),
        { tip: ['复制最近 240 帧的帧时间、内存和设备信息', '游戏中按 F3 + L 记录 10 秒的完整报告'] }),
    ];
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.top = 33; this.bottom = u.h - 33;
    const rows = [], opts = this.options();
    for (let i = 0; i < opts.length;) {
      const o = opts[i];
      if (o.wide) { rows.push([Object.assign(o, { x: cx - 155, w: 310 })]); i++; continue; }
      const r = [Object.assign(o, { x: cx - 155, w: 150 })];
      if (opts[i + 1] && !opts[i + 1].wide) r.push(Object.assign(opts[i + 1], { x: cx + 5, w: 150 }));
      rows.push(r); i += r.length;
    }
    this.rows = rows;
    this.doneBtn = { x: cx - 100, y: u.h - 27, w: 200, h: 20, label: '完成', onClick: () => this.back() };
    this.place();
  }
  place() {
    const list = [];
    const maxScroll = Math.max(0, this.rows.length * 25 + 4 - (this.bottom - this.top));
    this.scroll = clamp(this.scroll, 0, maxScroll);
    this.rows.forEach((r, i) => { const y = this.top + 4 - this.scroll + i * 25 + 2; for (const w of r) { w.y = y; w.h = 20; if (y >= this.top && y + 20 <= this.bottom) list.push(w); } });
    this.widgets = [...list, this.doneBtn];
  }
  back() { this.game.saveSettings(); this.game.ui.open(this.parent); }
  drawExtra(ui) { ui.listBackground(this.top, this.bottom); }
  wheel(ui, dy) { this.scroll += Math.sign(dy) * 25; this.place(); }
  onEsc() { this.back(); }
}

// vanilla PauseScreen grid (rows of 204 / 98+98, padding-top 50, aligned at 1/4 of the screen)
class PauseScreen extends MenuScreen {
  constructor(game) { super(game, '游戏菜单'); this.pauses = true; this.titleY = 40; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game, y = Math.floor((u.h - 166) / 4) + 50;
    // in a room the right of the fourth row is 房间…; the game mode (owner, members, administrators) gets a row of its
    // own under it - both sat on the same place and the mode button, first in the list, took every click (10-31)
    const room = !!(g.net && g.net.room), roomMode = room && (g.net.opLevel | 0) >= 2;
    this.widgets = [
      { x: cx - 102, y, w: 204, h: 20, label: '回到游戏', onClick: () => g.ui.close() },
      { x: cx - 102, y: y + 24, w: 98, h: 20, label: '进度', onClick: () => g.ui.open(new AdvancementsScreen(g, this)) },
      { x: cx + 4, y: y + 24, w: 98, h: 20, label: '统计信息', onClick: () => g.ui.open(new StatsScreen(g, this)) },
      { x: cx - 102, y: y + 48, w: 98, h: 20, label: '游戏说明', onClick: () => g.ui.open(new HelpScreen(g, this)) },
      { x: cx + 4, y: y + 48, w: 98, h: 20, label: '统计与说明', onClick: () => g.ui.open(new HelpScreen(g, this)) },
      room && !roomMode ? null : { x: roomMode ? cx - 102 : cx + 4, y: roomMode ? y + 96 : y + 72, w: roomMode ? 204 : 98, h: 20, label: () => '模式：' + MODE_NAMES[g.mode], enabled: !!g.cheats || !!g.net, tip: g.cheats || g.net ? ['生存 → 创造 → 旁观（也可按 F3 + F4）'] : ['需要开启“允许命令”'], onClick: () => g.requestMode(MODE_NEXT[g.mode]) },
      { x: cx - 102, y: y + 72, w: 98, h: 20, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      { x: cx - 102, y: y + (roomMode ? 120 : 96), w: 204, h: 20, label: '保存并退回到标题屏幕', onClick: () => g.quitToTitle() },
    ].filter(Boolean);
  }
  onEsc() { this.game.ui.close(); }
}
const MODE_NAMES = { survival: '生存', creative: '创造', spectator: '旁观' };
const MODE_NEXT = { survival: 'creative', creative: 'spectator', spectator: 'survival' };

class AdvancementsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '进度'); this.parent = parent; this.pauses = true; this.bgDim = 0.75; this.titleY = 16; }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) }]; }
  drawExtra(ui) {
    const c = ui.ctx, keys = Object.keys(ADVANCEMENTS);
    const done = keys.filter(k => this.game.adv[k]).length;
    Font.center(c, `已完成 ${done} / ${keys.length}`, ui.w / 2, 28, '#AAAAAA');
    // (scrolled by the wheel, or a finger through it: on a tablet the list ran off the bottom - feedback 11-01)
    const cols = 2, cw = 150, x0 = ui.w / 2 - cw, top = 40, bot = ui.h - 32, rows = Math.ceil(keys.length / cols);
    this.maxScroll = Math.max(0, rows * 20 + 4 - (bot - top)); this.scroll = clamp(this.scroll || 0, 0, this.maxScroll);
    c.save(); c.beginPath(); c.rect(0, top, ui.w, bot - top); c.clip();
    keys.forEach((k, i) => {
      const x = x0 + (i % cols) * cw, y = top + 2 + Math.floor(i / cols) * 20 - this.scroll;
      if (y > bot || y + 18 < top) return;
      const got = !!this.game.adv[k];
      c.fillStyle = got ? 'rgba(40,120,40,0.6)' : 'rgba(0,0,0,0.5)'; c.fillRect(x + 2, y, cw - 4, 18);
      ui.drawItem({ id: item(ADVANCEMENTS[k][1]), count: 1 }, x + 4, y + 1);
      Font.draw(c, ADVANCEMENTS[k][0], x + 24, y + 5, got ? '#FFFF55' : '#808080');
    });
    c.restore();
  }
  wheel(ui, dy) { this.scroll = clamp((this.scroll || 0) + Math.sign(dy) * 20, 0, this.maxScroll || 0); }
  onEsc() { this.game.ui.open(this.parent); }
}

class StatsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '统计信息'); this.parent = parent; this.pauses = true; this.bgDim = 0.75; }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) }]; }
  drawExtra(ui) {
    const g = this.game, s = g.stats, c = ui.ctx;
    const lines = [['游戏天数', Math.floor(g.worldTime / 24000) + 1], ['放置的方块', s.placed], ['挖掘的方块', s.mined], ['击杀的生物', s.kills], ['经验等级', g.xpLevel()], ['世界种子', g.world.seed]];
    lines.forEach(([a, b], i) => { Font.draw(c, a, ui.w / 2 - 100, 50 + i * 14, '#FFFFFF'); const t = String(b); Font.draw(c, t, ui.w / 2 + 100 - Font.width(t), 50 + i * 14, '#FFFF55'); });
  }
  onEsc() { this.game.ui.open(this.parent); }
}

class DeathScreen extends MenuScreen {
  constructor(game) { super(game, null); this.blurBg = false; this.bgDim = 0; this.pauses = false; this.t = performance.now(); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.floor(u.h / 4 + 72), g = this.game;
    const toTitle = () => { g.player.health = 20; g.player.deathTime = 0; g.respawn(); g.quitToTitle(); };
    this.widgets = g.hardcore ? [
      { x: cx - 100, y, w: 200, h: 20, label: '旁观世界', onClick: () => { g.respawn(); g.setMode('spectator', true); } },
      { x: cx - 100, y: y + 24, w: 200, h: 20, label: '标题屏幕', onClick: toTitle },
    ] : [
      { x: cx - 100, y, w: 200, h: 20, label: '重生', onClick: () => g.respawn() },
      { x: cx - 100, y: y + 24, w: 200, h: 20, label: '标题屏幕', onClick: toTitle },
    ];
  }
  draw(ui) {
    const c = ui.ctx;
    // vanilla DeathScreen: fillGradient(0x60500000 -> 0xA0803030)
    const gr = c.createLinearGradient(0, 0, 0, ui.h);
    gr.addColorStop(0, 'rgba(80,0,0,0.376)'); gr.addColorStop(1, 'rgba(128,48,48,0.627)');
    c.fillStyle = gr; c.fillRect(0, 0, ui.w, ui.h);
    c.save(); c.scale(2, 2); Font.center(c, this.game.hardcore ? '游戏结束！' : '你死了！', ui.w / 4, 30, '#FFFFFF'); c.restore();
    Font.center(c, this.game.deathMsg || '', ui.w / 2, 85, '#FFFFFF');
    const sc = '分数：', sv = String(this.game.deathScore || 0), sx = ui.w / 2 - Font.width(sc + sv) / 2;
    Font.draw(c, sc, sx, 100, '#FFFFFF'); Font.draw(c, sv, sx + Font.width(sc), 100, '#FFFF55');
    const ok = performance.now() - this.t > 1000;
    for (const w of this.widgets) { w.enabled = ok; ui.button(w); }
  }
}

class HelpScreen extends MenuScreen {
  constructor(game, parent) { super(game, '游戏说明'); this.parent = parent; this.pauses = true; this.bgDim = 0.8; this.bgDirt = parent instanceof TitleScreen; this.page = 0; this.titleY = 10; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: u.h - 26, w: 74, h: 20, label: '< 上一页', onClick: () => this.page = Math.max(0, this.page - 1) },
      { x: cx - 76, y: u.h - 26, w: 152, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      { x: cx + 80, y: u.h - 26, w: 74, h: 20, label: '下一页 >', onClick: () => this.page = Math.min(HELP_PAGES.length - 1, this.page + 1) },
    ];
  }
  drawExtra(ui) {
    const c = ui.ctx, pg = HELP_PAGES[this.page];
    Font.center(c, `${pg.title}  (${this.page + 1}/${HELP_PAGES.length})`, ui.w / 2, 24, '#FFFF55');
    let y = 40;
    for (const line of pg.lines) {
      if (y > ui.h - 40) break;
      const [k, v] = line.split('|');
      if (v !== undefined) { Font.draw(c, k, ui.w / 2 - 150, y, '#FFFFA0'); Font.draw(c, v, ui.w / 2 - 60, y, '#FFFFFF'); }
      else Font.draw(c, k, ui.w / 2 - 150, y, '#E0E0E0');
      y += 11;
    }
  }
  onEsc() { this.game.ui.open(this.parent); }
}
const HELP_PAGES = [
  { title: '基本操作', lines: ['W A S D|移动', '空格|跳跃 / 游泳上浮 / (创造) 双击切换飞行', '左 Shift|潜行（不会从边缘掉落）/ 飞行下降', '左 Ctrl 或 双击 W|疾跑', '鼠标移动|转动视角', '鼠标左键|挖掘方块 / 攻击生物（按住持续挖掘）', '鼠标右键|放置方块 / 使用物品 / 打开容器 / 吃东西 / 拉弓', '鼠标中键|选取方块', '滚轮 / 1-9|切换快捷栏', 'E|打开物品栏', 'Q|丢弃物品 (Ctrl+Q 丢弃一组)', 'F1 / F3 / F5|隐藏界面 / 调试信息 / 切换视角', 'T 或 /|打开聊天与命令', 'Esc|游戏菜单（暂停）'] },
  { title: '物品栏操作', lines: ['左键|拿起 / 放下整组物品', '右键|拿起一半 / 放下一个', 'Shift + 左键|快速移动物品', '按住左键拖动|在多个格子之间平均分配', '按住右键拖动|每个格子放一个', '双击|收集同类物品', '悬停 + 数字键|与快捷栏交换', '悬停 + Q|丢弃物品', '', '创造模式物品栏：点击顶部标签切换分类，', '滚轮滚动；最后一个标签可以搜索物品。', '把物品放到右下角的 X 格可以删除。'] },
  { title: '触屏操作', lines: ['（选项 → 控制… → 触屏操作；手机和平板默认开启）', '左下方向键|移动（按住上键时出现斜向键）', '方向键中间|潜行（点一下切换）', '跳跃键|跳跃 / 游泳上浮 / (创造) 双击切换飞行', '飞行时|跳跃键上升，下方按钮下降', '疾跑键 / 双击上键|疾跑', '在屏幕上拖动|转动视角', '轻点|放置方块 / 使用物品 / 攻击准星对准的生物', '按住不动|挖掘方块（手持食物、弓等则为使用）', '“互动”按钮|与准星对准的生物互动 / 交易', '点 / 按住快捷栏|选择 / 丢弃整组物品', '快捷栏右侧 …|打开物品栏', '物品栏里|点击=左键，长按=右键，双击=快速移动'] },
  { title: '生存入门', lines: ['1. 徒手撸树获得原木，合成木板（在物品栏 2x2 合成格）', '2. 4 个木板合成工作台，右键打开 3x3 合成', '3. 木板竖放 2 个合成木棍，制作木镐', '4. 挖石头获得圆石，制作石镐、熔炉', '5. 煤炭 + 木棍合成火把，照亮洞穴防止怪物生成', '6. 用熔炉把粗铁冶炼成铁锭，制作铁镐与铁甲', '7. 铁镐可以挖掘钻石矿（在 Y<16 的深层）', '', '饥饿值不足时无法疾跑、不能回血，记得吃东西！', '夜晚会生成僵尸、骷髅、苦力怕和蜘蛛。', '摔落、溺水、岩浆、仙人掌都会造成伤害。', '按 Esc → 进度 查看你的成就目标。'] },
  { title: '常用配方', lines: ['工作台|4 木板 (2x2)', '木棍|2 木板竖放', '镐|上排 3 材料 + 中间竖放 2 木棍', '斧 / 锹 / 剑 / 锄|同原版摆法', '熔炉|8 圆石围一圈', '箱子|8 木板围一圈', '火把|煤炭/木炭 在 木棍 上方', '面包|3 小麦横排', 'TNT|火药与沙子交错 (5 火药 + 4 沙子)', '床|3 羊毛 + 3 木板，夜晚右键睡觉跳过黑夜', '弓 / 箭|木棍+线 / 燧石+木棍+羽毛', '桶|3 铁锭 V 形；可装水和熔岩', '盔甲|皮革/铁/钻石，同原版摆法', '其他: 楼梯、台阶、门、梯子、书架、砖块…'] },
  { title: '玩法机制', lines: ['• 平滑光照与环境光遮蔽，火把/荧石/熔岩发光', '• 真实的水与熔岩流动，水遇熔岩生成黑曜石/圆石', '• 沙子与沙砾会受重力下落', '• TNT 与苦力怕爆炸可以破坏地形并连锁引爆', '• 用锄头耕地、种小麦，骨粉催熟；树苗可以长成树', '• 用剪刀剪羊毛，用小麦/种子/胡萝卜引诱并繁殖动物', '• 熔炉冶炼矿石与烹饪食物，获得经验', '• 昼夜循环、月相、星空、云层、雨雪天气；床可跳过夜晚', '• 多种生物群系：平原、森林、桦木林、针叶林、', '  雪原、沙漠、山地、海洋、河流、沙滩', '• 世界自动保存，可在主菜单管理多个存档', '• 三个维度：主世界、下界、末地（各自独立保存）', '• 使用原版音效（声音来自对应方向和距离）', '• 两个箱子并排放置会合成大型箱子（潜行放置则不合并）', '• 选项 → 光影：关 / 低 / 中 / 高 / 极限（实时阴影、水面反射等）'] },
  { title: '通关路线', lines: ['1. 准备铁装备、弓箭、食物，挖到钻石做钻石镐', '2. 用钻石镐挖 10 块以上黑曜石（水浇在熔岩源上）', '3. 黑曜石搭 4x5 门框，打火石点燃 → 进入下界', '4. 在下界找到下界要塞（暗红色砖块的桥与走廊）', '5. 击杀烈焰人获得烈焰棒 → 合成烈焰粉', '6. 击杀末影人获得末影珍珠（别盯着它的眼睛看！）', '7. 末影珍珠 + 烈焰粉 = 末影之眼（准备 12 个以上）', '8. 回主世界向空中扔末影之眼，它会飞向要塞方向', '9. 在眼睛掉落处往下挖，找到要塞里的末地传送门', '10. 把末影之眼放进 12 个框架，跳进传送门', '11. 用弓箭射掉黑曜石柱顶的末地水晶（会治疗末影龙）', '12. 末影龙停在中央传送门上时攻击它的头部', '13. 击败末影龙后跳进返回传送门 → 终末之诗 → 通关！'] },
  { title: '下界与末地', lines: ['• 下界：没有昼夜和水，水会蒸发，床会爆炸', '  坐标与主世界 1:8 对应，传送门会自动建造或连接', '• 恶魂：远程发射火球，用剑或拳头可以把火球打回去', '• 烈焰人：三连发小火球，会点燃你；要塞里有刷怪笼', '• 僵尸猪灵：中立，攻击一只会让附近的同伴一起围攻', '• 岩浆怪：会分裂；末影人：直视会激怒，遇水瞬移', '• 末影珍珠：右键投掷后传送到落点，受到 5 点伤害', '• 末地：床同样会爆炸；掉进虚空会死亡', '• 末影龙 200 生命值：盘旋、俯冲、喷射龙息火球，', '  停在传送门上时喷吐龙息（站在紫雾里会持续掉血）', '• 头部受到全额伤害，身体和翅膀只受到约 1/4 伤害', '• 末地水晶爆炸威力很大，不要近战打它！'] },
  { title: '村庄与结构', lines: ['• 原版地形的世界会生成原版结构：五种风格的村庄、', '  掠夺者前哨站、古城、试炼密室、古迹废墟、沙漠神殿、', '  丛林神庙、沼泽小屋、雪屋、沉船、海底废墟、', '  废弃传送门、废弃矿井、埋藏的宝藏；下界有堡垒遗迹、', '  下界要塞与下界化石', '• 结构里的箱子按原版战利品表生成物品', '• 无业村民会认领附近的工作站（堆肥桶→农民、', '  讲台→图书管理员、高炉→盔甲匠…）', '• 右键有职业的村民打开交易界面：点左侧的交易，', '  材料会自动放好，取走右侧物品即完成交易', '• 交易让村民升级（新手→大师）并解锁新交易', '• 铁傀儡守护村庄，会攻击附近的敌对生物', '• /locate village 查找最近的村庄（或其他结构名）'] },
  { title: '命令 (按 T 或 /)', lines: ['/gamemode creative|survival|切换游戏模式', '/time set day|night|noon|<数值>|设置时间', '/weather clear|rain|设置天气', '/give <物品英文名> [数量]|给予物品，如 /give ender_eye 12', '/tp <x> <y> <z>|传送', '/summon <生物>|生成生物，如 blaze ghast ender_dragon', '/kill|自杀', '/kill @e[type=<生物>]|清除指定实体，如 ender_dragon', '/locate <结构>|查找结构，如 village stronghold fortress', '/tpdim overworld|nether|end|直接前往某个维度', '/spawnpoint|设置重生点为当前位置', '/seed|显示世界种子', '/clear|清空物品栏', '/xp <数量>|获得经验'] },
];

class ChatScreen extends MenuScreen {
  constructor(game, prefill = '') { super(game, null); this.blurBg = false; this.bgDim = 0; this.isChat = true; this.prefill = prefill; this.hist = game.chatHistory || (game.chatHistory = []); this.hi = this.hist.length; game.ui.chatOff = 0; }
  // the wheel (or a finger dragged) goes back through the last 100 messages, 7 lines a notch, 1 with shift - like
  // vanilla's ChatScreen.mouseScrolled; there was no scrolling at all (players' feedback 2026-10-31)
  wheel(ui, dy) { ui.chatOff = clamp((ui.chatOff || 0) - Math.sign(dy) * (ui.wheelShift ? 1 : 7), 0, Math.max(0, ui.chat.length - 20)); ui.wheelShift = false; }
  layout() {
    const u = this.game.ui, send = (v) => { u.close(); if (v.trim()) { this.hist.push(v); runCommand(this.game, v.trim()); } };
    // (on a touch screen a 发送 button at the end of the line, and the keyboard's return key reads 发送: iOS players
    // found no way to send - feedback 2026-11-01 12:58)
    const tb = navigator.maxTouchPoints > 0 || (typeof touchOn === 'function' && touchOn(this.game)), bw = tb ? 34 : 0;
    this.widgets = tb ? [{ x: u.w - 2 - bw, y: u.h - 15, w: bw, h: 14, label: '发送', onClick: () => send(u.input.value) }] : [];
    // (laid out again - the window resized, as Android's on-screen keyboard coming up does - the text typed so far
    // stays: it went back to the prefill, "安卓打字时聊天框文字被清空", feedback 2026-11-01 09:15)
    const v = this.shownOnce && u.input.style.display === 'block' ? u.input.value : this.prefill; this.shownOnce = true;
    u.showInput(2, u.h - 14, u.w - 4 - (bw ? bw + 2 : 0), 12, v, send, { onEsc: () => u.close(), max: 256, enter: 'send' });
    const el = u.input, prev = el.onkeydown;
    el.onkeydown = (e) => {
      if (e.key === 'ArrowUp' && this.hi > 0) { this.hi--; el.value = this.hist[this.hi]; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.hi = Math.min(this.hist.length, this.hi + 1); el.value = this.hist[this.hi] || ''; e.preventDefault(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.complete(el); }
      prev(e);
    };
  }
  complete(el) {
    const v = el.value, parts = v.split(' ');
    if (parts[0] === '/give' && parts.length === 2) { const m = Object.keys(ITEM_KEY).filter(k => k.startsWith(parts[1])); if (m.length) el.value = '/give ' + m[0]; }
    else if (parts[0] === '/summon' && parts.length === 2) { const m = Object.keys(MOB_TYPES).filter(k => k.startsWith(parts[1])); if (m.length) el.value = '/summon ' + m[0]; }
    else if (parts.length === 1) { const m = ['/gamemode', '/time', '/weather', '/give', '/tp', '/summon', '/kill', '/locate', '/tpdim', '/spawnpoint', '/seed', '/clear', '/xp', '/help'].filter(k => k.startsWith(v)); if (m.length) el.value = m[0] + ' '; }
  }
  draw(ui) { const c = ui.ctx, b = this.widgets[0]; c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(2, ui.h - 14, ui.w - 4 - (b ? b.w + 2 : 0), 12); if (b) ui.button(b); }
}

// leaving a world for the title (single player, a room on the server, a local room) takes its chat along, like vanilla's
// disconnect (the lines typed stay for ↑): a room's messages were still there in the single-player world entered next
// (players' feedback 2026-11-01 10:09)
(() => {
  const st = Game.prototype.startTitle;
  Game.prototype.startTitle = function (...a) { if (this.ui) { this.ui.chat.length = 0; this.ui.chatOff = 0; } return st.apply(this, a); };
})();

// a command as typed, made what a server accepts: runs of spaces outside quotes one space, none at the ends (a taken
// suggestion leaves a space after it; the server's parser refuses "/gamemode creative " and double spaces - the
// command just failed: players' feedback 2026-11-01). Chat stays as typed
function cmdTidy(text) {
  if (!text.startsWith('/')) return text;
  let out = '', q = null;
  for (const ch of text.trim()) {
    if (q) { out += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    if (/\s/.test(ch)) { if (!out.endsWith(' ')) out += ' '; continue; }
    out += ch;
  }
  return out.trim();
}
function runCommand(g, text) {
  text = cmdTidy(text);
  if (g.net) { g.net.chat(text); return; } // on a server: chat and commands are the server's
  const p = g.player, ui = g.ui;
  if (!text.startsWith('/')) { ui.message('<玩家> ' + text); return; }
  // (vanilla's syntax and most commands: cmdrun.js; /locate and /tpdim still here)
  if (typeof cmdExec === 'function' && !/^\/(locate|tpdim|dimension)\b/.test(text)) { cmdExec(g, text); return; }
  const [cmd, ...a] = text.slice(1).split(/\s+/);
  const err = (m) => ui.message(m, '#FF5555');
  if (!g.cheats && !['help', 'seed', 'me', 'msg', 'tell', 'w', 'list', 'trigger'].includes(cmd)) return err('未知或不完整的命令，错误见下\n…/' + cmd + '<--[此处]');
  try {
    switch (cmd) {
      case 'help': ui.message('可用命令: /gamemode /time /weather /give /tp /summon /kill [@e[type=…]] /locate /tpdim /spawnpoint /seed /clear /xp', '#FFFF55'); break;
      case 'gamemode': case 'gm': {
        const m = { creative: 'creative', c: 'creative', 1: 'creative', survival: 'survival', s: 'survival', 0: 'survival', spectator: 'spectator', sp: 'spectator', 3: 'spectator' }[a[0]];
        if (!m) return err('用法: /gamemode creative|survival|spectator');
        g.setMode(m); break;
      }
      case 'time': {
        if (a[0] === 'set' || a[0] === 'add') {
          const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
          let v = named[a[1]] ?? parseInt(a[1]);
          if (isNaN(v)) return err('用法: /time set day|night|noon|midnight|<数值>');
          if (a[0] === 'set') g.worldTime = Math.floor(g.worldTime / 24000) * 24000 + v; else g.worldTime += v;
          ui.message('时间已设置为 ' + v, '#AAAAAA');
        } else ui.message('当前时间: ' + g.dayTime(), '#AAAAAA');
        break;
      }
      case 'weather': {
        if (a[0] === 'clear') { g.rainTarget = 0; g.weather = 0; g.weatherTimer = 24000; }
        else if (a[0] === 'rain' || a[0] === 'thunder') { g.rainTarget = 1; g.weather = 1; g.weatherTimer = 12000; }
        else return err('用法: /weather clear|rain');
        ui.message('天气已更改', '#AAAAAA'); break;
      }
      case 'give': {
        const key = (a[0] || '').replace('minecraft:', '');
        const id = ITEM_KEY[key];
        if (id === undefined) return err('未知物品: ' + key);
        const n = Math.max(1, Math.min(64 * 36, parseInt(a[1]) || 1));
        let left = n;
        while (left > 0) { const k = Math.min(left, maxStack(id)); const r = p.inv.add({ id, count: k, dmg: 0 }); if (r) { g.dropFromPlayer({ id, count: r, dmg: 0 }); } left -= k; }
        ui.message(`已将 ${n} 个 [${ITEMS[id].cn}] 给予玩家`, '#AAAAAA'); break;
      }
      case 'tp': {
        const v = a.map((s, i) => s.startsWith('~') ? p.pos[i] + (parseFloat(s.slice(1)) || 0) : parseFloat(s) - (i === 1 ? (g.world.minY || 0) : 0));
        if (v.length < 3 || v.some(isNaN)) return err('用法: /tp <x> <y> <z>');
        p.pos = [v[0], v[1], v[2]]; p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
        ui.message(`已传送至 ${v.map((x, i) => (x + (i === 1 ? (g.world.minY || 0) : 0)).toFixed(1)).join(', ')}`, '#AAAAAA'); break;
      }
      case 'summon': {
        const t = (a[0] || '').replace('minecraft:', '');
        if (t === 'tnt') { g.addEntity(new PrimedTNT(g, Math.floor(p.pos[0]), p.pos[1], Math.floor(p.pos[2]))); break; }
        if (!MOB_TYPES[t] && t !== 'ender_dragon') return err('未知生物: ' + t + '（可用: ' + Object.keys(MOB_TYPES).join(' ') + ' ender_dragon）');
        const d = g.lookDir();
        if (t === 'ender_dragon') { g.addEntity(new EnderDragon(g, p.pos[0] + d[0] * 20, p.pos[1] + 15, p.pos[2] + d[2] * 20)); ui.message('已生成 末影龙', '#AAAAAA'); break; }
        const m = createMob(g, t, p.pos[0] + d[0] * 3, p.pos[1] + 0.5, p.pos[2] + d[2] * 3);
        m.persistent = true;
        g.addEntity(m);
        ui.message('已生成 ' + MOB_TYPES[t].cn, '#AAAAAA'); break;
      }
      case 'kill': {
        const sel = a.join('').replace(/\s/g, '');
        if (sel.startsWith('@e')) {
          const m = sel.match(/type=(?:minecraft:)?([a-z_]+)/);
          let n = 0;
          for (const e of g.entities) {
            if (e.dead || (m && e.type !== m[1])) continue;
            if (!m && !(e instanceof Living) && !(e instanceof ItemEntity) && !e.hittable) continue;
            if (e instanceof EnderDragon) { if (e.deathTime === 0) { e.health = 0; e.deathTime = 1; Sound.ev('entity.ender_dragon.death', e.pos, 10, 1); n++; } continue; }
            if (e instanceof EndCrystal) { e.dead = true; n++; continue; }
            if (e instanceof Living) { if (e.deathTime === 0) { e.health = 0; e.die({ type: 'void' }); n++; } }
            else { e.dead = true; n++; }
          }
          ui.message(n ? `已清除 ${n} 个实体` : '没有找到匹配的实体', n ? '#AAAAAA' : '#FF5555');
          break;
        }
        if (g.mode === 'creative') { p.health = 0; p.die({ type: 'void' }); } else p.hurt(1000, { type: 'void' });
        break;
      }
      case 'locate': {
        const what = (a[0] === 'structure' ? a[1] : a[0]) || '';
        if (what.includes('stronghold')) { const s = g.nearestStronghold(); if (!s) return err('该维度没有要塞'); ui.message(`最近的要塞位于 [${s.x}, ~, ${s.z}]（距离 ${Math.round(Math.hypot(s.x - p.pos[0], s.z - p.pos[2]))} 格）`, '#55FF55'); }
        else if (what.includes('fortress') && !g.world.gen2) { if (g.dim !== 'nether') return err('下界要塞只存在于下界'); const f = g.world.nearestFortress(p.pos[0], p.pos[2]); if (!f) return err('附近没有下界要塞'); ui.message(`最近的下界要塞位于 [${f.x}, ${f.y}, ${f.z}]（距离 ${Math.round(Math.hypot(f.x - p.pos[0], f.z - p.pos[2]))} 格）`, '#55FF55'); }
        else if (what && g.world.gen2 && g.genPool) {
          // vanilla structures (village, bastion_remnant, pillager_outpost, ancient_city, trail_ruins, trial_chambers, ...)
          const name = what.replace('minecraft:', '');
          ui.message('正在查找 ' + name + ' ...', '#AAAAAA');
          g.genPool.request({ type: 'locate', name, cx: Math.floor(p.pos[0]) >> 4, cz: Math.floor(p.pos[2]) >> 4, dim: g.dim }, (m) => {
            if (!m.r) { ui.message('附近找不到 ' + name, '#FF5555'); return; }
            g.lastLocate = m.r;
            ui.message(`最近的 ${m.r.name} 位于 [${m.r.x}, ~, ${m.r.z}]（距离 ${Math.round(m.r.d)} 格）`, '#55FF55');
          });
        }
        else return err('用法: /locate stronghold|fortress|village|bastion_remnant|...');
        break;
      }
      case 'tpdim': case 'dimension': {
        const d = { overworld: 'overworld', nether: 'nether', the_nether: 'nether', end: 'end', the_end: 'end' }[(a[0] || '').replace('minecraft:', '')];
        if (!d) return err('用法: /tpdim overworld|nether|end');
        if (d === g.dim) return err('你已经在这个维度了');
        if (d === 'end') { g.enterEndPortal(); break; }
        if (d === 'nether' || g.dim === 'nether') { g.useNetherPortal(); break; }
        g.leaveEnd();
        break;
      }
      case 'spawnpoint': p.spawn = [Math.floor(p.pos[0]), Math.floor(p.pos[1]), Math.floor(p.pos[2])]; p.bedSpawn = false; ui.message('已设置重生点', '#AAAAAA'); break;
      case 'seed': ui.message('种子: [' + (g.worldMeta ? g.worldMeta.seed : g.world.seed) + ']', '#FFFFFF'); break;
      case 'clear': p.inv.slots.fill(null); ui.message('已清空物品栏', '#AAAAAA'); break;
      case 'xp': g.addXp(parseInt(a[0]) || 0); break;
      default: err('未知命令。输入 /help 查看帮助');
    }
  } catch (e) { err('命令出错: ' + e.message); }
}

Game.prototype.setMode = function (m, quiet) {
  const p = this.player, prev = this.mode;
  if (m !== prev) this.prevMode = prev;
  this.mode = m;
  if (m === 'spectator') { p.flying = true; p.noClip = true; }
  else {
    p.noClip = false;
    if (m === 'survival') p.flying = false;
    if (prev === 'spectator' && m === 'creative') p.flying = true;
  }
  if (!quiet) this.ui.message('已将自己的游戏模式设置为' + { survival: '生存模式', creative: '创造模式', spectator: '旁观模式' }[m], '#AAAAAA');
};

// 「退出游戏」: most places do not let a page close itself (a tab the player opened, the Bilibili app, the Toy page's
// frame) - window.close() did nothing there and the button seemed dead (Android feedback 2026-10-31). In Toy the
// container closes it (toy.closeBrowser); elsewhere the page tries, and if it is still here a moment later, says how
async function quitGame(g) {
  const sc = g.ui.screen;
  if (fsElement()) fsExit();
  try {
    if (typeof Toy !== 'undefined' && await Promise.race([Toy.inToy(), new Promise((r) => setTimeout(() => r(false), 1500))]))
      await Promise.race([Toy.closeBrowser(), new Promise((r) => setTimeout(r, 1500))]);
  } catch (e) { }
  try { window.close(); } catch (e) { }
  setTimeout(() => { if (!document.hidden && g.ui.screen === sc && sc) sc.quitTip = performance.now(); }, 600);
}

// the page full screen and back. iPhone WebKit has no element full screen at all (only a <video> can), iPads and older
// Safari only the webkit-prefixed one: requestFullscreen called where it is missing threw - telemetry 11-02/03: 878
// devices, the iOS Bilibili app and Safari. Where there is none (or the frame may not: fullscreenEnabled false) the
// 全屏 buttons say so and the key tells the player instead of doing nothing
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
// Not on an iPad either (IOS_WEBGL, 11-07): the webkit-prefixed call there since 11-06, and iPad sessions that went full
// screen died 3x as often (33.7% vs 10.6% - the page killed and opened again); before, the call failed and none did
function fsSupported() {
  const de = document.documentElement;
  if (typeof IOS_WEBGL !== 'undefined' && IOS_WEBGL) return false;
  return !!(de.requestFullscreen || de.webkitRequestFullscreen) && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled) !== false;
}
function fsExit() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  try { const r = ex && ex.call(document); if (r && r.catch) r.catch(() => { }); } catch (e) { }
}
function toggleFullscreen() {
  if (fsElement()) { fsExit(); return; }
  const de = document.documentElement, req = de.requestFullscreen || de.webkitRequestFullscreen;
  const no = () => { if (typeof game !== 'undefined' && game.ui) game.ui.message('这个浏览器不支持网页全屏', '#FFFF55'); };
  if (!req || !fsSupported()) { no(); return; }
  const lock = () => { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']).catch(() => { }); };
  try { const r = req.call(de); if (r && r.then) r.then(lock, () => { }); } catch (e) { no(); }
}
