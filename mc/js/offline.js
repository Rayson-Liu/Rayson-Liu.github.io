/* ============================================================================
 * offline.js — OpusMC 离线单机接管层
 *
 * 本项目已移除以下平台化模块（文件已删除）：
 *   account.js  toy.js  cloudsave.js  social.js  telemetry.js  checkin.js
 *   news.js     companion.js  jing_tex.js  capes.js  cosmetics.js  skins.js
 *   netconfig.js  net.js  p2p.js
 * 即：登录 / 账号 / 三连解锁 / 赞助式奖励 / 签到 / 公告 / 云存档 /
 *     皮肤披风商城 / AI 同伴 / 遥测上报 / 社交邀请 / 联机房间服务。
 *
 * 这些模块里混有引擎依赖的通用 UI 工具（fitText、FormScreen 等），
 * 因此本文件保留其最小必要实现，其余符号一律接管为「惰性空对象」：
 * 可调用、可 new、可读写属性、可迭代（空）、转字符串为空，永远不会
 * 发起网络请求，也不会创建任何界面。从而保证核心引擎零改动即可运行。
 * ========================================================================== */
(function () {
  'use strict';

  var FALSE_KEYS = new Set(['loggedIn','shown','available','enabled','on','online','connected',
    'joined','isOwner','hasAccount','inIframe','inToy','following','liked','favorited',
    'requireAccount','triple','follow','admin','super','premium','paid','gated','needLogin',
    'blocked','frozen','banned','visible','active','dirty','synced','claimed','opened',
    'isAdmin','isNew','hasAccount','inApp','isBili','locked','claimedToday']);
  var TRUE_KEYS = new Set(['allUnlocked','unlocked','hasKey','isUnlocked']);
  var VOID;

  function makeObj(name) {
    var cache = Object.create(null);
    return new Proxy({}, {
      get: function (t, k) {
        if (k === Symbol.toPrimitive) return function () { return ''; };
        if (k === Symbol.iterator) return function* () {};
        if (k === 'then') return undefined;
        if (k === 'toString' || k === 'valueOf') return function () { return ''; };
        if (k === Symbol.toStringTag) return 'OfflineStub';
        if (k in cache) return cache[k];
        return (cache[k] = stub(name + '.' + String(k)));
      },
      set: function (t, k, v) { cache[k] = v; return true; },
      has: function () { return true; },
      ownKeys: function () { return []; },
      getOwnPropertyDescriptor: function () { return undefined; }
    });
  }

  function stub(name) {
    var fn = function () { return VOID; };
    var cache = Object.create(null);
    return new Proxy(fn, {
      get: function (t, k) {
        if (k === 'prototype') return cache.prototype || (cache.prototype = {});
        if (k === Symbol.toPrimitive) return function () { return ''; };
        if (k === Symbol.iterator) return function* () {};
        if (k === 'then') return undefined;
        if (k === 'toString' || k === 'valueOf') return function () { return ''; };
        if (k === 'length') return 0;
        if (k === 'name') return name;
        if (k === Symbol.hasInstance) return function () { return false; };
        if (k === Symbol.toStringTag) return 'OfflineStub';
        if (k in cache) return cache[k];
        if (typeof k === 'string' && FALSE_KEYS.has(k)) return false;
        if (typeof k === 'string' && TRUE_KEYS.has(k)) return true;
        return (cache[k] = stub(name + '.' + String(k)));
      },
      set: function (t, k, v) { cache[k] = v; return true; },
      has: function () { return true; },
      apply: function () { return VOID; },
      construct: function () { return makeObj(name); },
      ownKeys: function () { return []; },
      getOwnPropertyDescriptor: function () { return undefined; }
    });
  }
  VOID = stub('void');
  window.__offlineStub = stub;

  /* ---- 通用 UI 工具（从被删模块中原样保留，引擎本身依赖） ---------------- */
  var fitText = function (t, w) {
    t = String(t == null ? '' : t);
    try {
      if (Font.width(t) <= w) return t;
      while (t.length && Font.width(t + '\u2026') > w) t = t.slice(0, -1);
      return t + '\u2026';
    } catch (e) { return t; }
  };
  var drawCard = function (c, x, y, w, h, gold) {
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x, y, w, h);
    c.strokeStyle = gold ? '#E8B830' : '#555555'; c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (gold) { c.fillStyle = 'rgba(232,184,48,0.10)'; c.fillRect(x + 1, y + 1, w - 2, h - 2); }
  };
  var romanNum = function (n) {
    return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
  };
  var netItemLines = function () {};
  var feedbackShot = function () { return null; };
  var singleGate = function (g, then) { return then && then(); };
  var onlineGate = function (g, then) { return then && then(); };
  window.fitText = fitText; window.drawCard = drawCard; window.romanNum = romanNum;
  window.netItemLines = netItemLines; window.feedbackShot = feedbackShot;
  window.singleGate = singleGate; window.onlineGate = onlineGate;

  /* ---- 通用容器类（extras.js / cmdblock.js 会扩展它们的 prototype） ------ */
  var MenuBase = (typeof MenuScreen !== 'undefined') ? MenuScreen : class {};
  window.FormScreen = class FormScreen extends MenuBase {
  constructor(game, title, parent) { super(game, title); this.parent = parent; this.titleY = 20; this.fields = {}; this.field = null; this.note = ''; this.noteColor = '#A0A0A0'; }
  addField(k, x, y, w, label, max, filter) { this.fields[k] = { x, y, w, h: 20, label, max, filter }; }
  focus(k) {
    const u = this.game.ui, b = this.fields[k]; if (!b) return;
    this.field = k;
    u.showInput(b.x + 4, b.y + 6, b.w - 8, 10, this[k], () => this.submit(), { onInput: (v) => { this[k] = b.filter ? b.filter(v) : v; }, onEsc: () => this.onEsc(), max: b.max });
  }
  submit() { }
  mouseDown(ui, mx, my, b) {
    for (const k in this.fields) { const r = this.fields[k]; if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) { this.focus(k); return; } }
    super.mouseDown(ui, mx, my, b);
  }
  drawFields(ui) {
    const c = ui.ctx;
    for (const k in this.fields) {
      const r = this.fields[k];
      Font.draw(c, r.label, r.x, r.y - 11, '#A0A0A0');
      ui.nine(this.field === k ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== k) Font.draw(c, String(this[k] || ''), r.x + 4, r.y + 6, '#E0E0E0');
    }
    if (this.note) Font.center(c, this.note, ui.w / 2, ui.h - 52, this.noteColor);
  }
  say(text, bad) { this.note = text; this.noteColor = bad ? '#FF6060' : '#A0A0A0'; }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent || new TitleScreen(this.game)); }
  onEsc() { this.back(); }
};
  window.NetClient = class NetClient {};
  window.RoomScreen = class RoomScreen extends MenuBase {};

  /* ---- 关键对象：给出明确的离线语义，避免惰性对象误入平台分支 ---------- */
  window.RoomService = stub('RoomService');
  RoomService.base = function () { return ''; };
  RoomService.fromUrl = function () { return false; };
  RoomService.ws = function () { return ''; };

  window.Account = stub('Account');
  Account.loggedIn = false;
  Account.name = 'Player';
  Account.allUnlocked = function () { return true; };
  Account.has = function () { return true; };
  Account.loadGate = async function () { return { requireAccount: false, follow: false, triple: false }; };

  window.Toy = stub('Toy');
  Toy.inToy = async function () { return false; };
  Toy.ready = async function () { return false; };
  Toy.closeBrowser = async function () {};
  Toy.inIframe = false;

  window.Telemetry = stub('Telemetry');
  Telemetry.enabled = false;
  window.CloudSave = stub('CloudSave');
  window.Checkin = stub('Checkin');
  window.NewsBoard = stub('NewsBoard');
  window.Capes = stub('Capes');
  window.Cosmetics = stub('Cosmetics');
  window.Skins = stub('Skins');
  Skins.get = function () { return null; };
  Skins.has = function () { return false; };
  // 渲染器把这三个返回值当作 models / 纹理表的键，必须是真实名称
  Skins.modelOf = function () { return 'steve'; };
  Skins.texOf = function () { return 'steve'; };
  Skins.armOf = function (g, left) { return left ? 'arm_left' : 'arm'; };
  window.Companion = stub('Companion');
  window.Jing = stub('Jing');

  window.NET_CONFIG = { rooms: '', share: '' };
  window.NET_STATION = stub('NET_STATION');
  window.NET_ENCH_CN = {};
  window.GAME_BUILD = 'offline';
  window.WHATS_NEW = {};
  window.LEGAL = { v: 0 };
  window.FPS_TEST_V = 0;
  window.VIDEOS = {};
  window.AUTHOR_MID = 0;

  /* ---- 其余平台符号：全部接管为惰性空对象 -------------------------------- */
  window.ACCOUNT_SETTINGS = stub("ACCOUNT_SETTINGS");
  window.ADMIN_COLORS = stub("ADMIN_COLORS");
  window.AccountScreen = stub("AccountScreen");
  window.AdminScreen = stub("AdminScreen");
  window.BanListScreen = stub("BanListScreen");
  window.CHK_BOX = stub("CHK_BOX");
  window.CHK_PAL = stub("CHK_PAL");
  window.CHK_PENGUIN = stub("CHK_PENGUIN");
  window.COMPANION_OFF = stub("COMPANION_OFF");
  window.CheckinScreen = stub("CheckinScreen");
  window.CloudConflictScreen = stub("CloudConflictScreen");
  window.CloudScreen = stub("CloudScreen");
  window.CodeLoginScreen = stub("CodeLoginScreen");
  window.CodeShowScreen = stub("CodeShowScreen");
  window.CompanionChatScreen = stub("CompanionChatScreen");
  window.CompanionLimitsScreen = stub("CompanionLimitsScreen");
  window.CompanionScreen = stub("CompanionScreen");
  window.CompanionSharedScreen = stub("CompanionSharedScreen");
  window.CreateRoomScreen = stub("CreateRoomScreen");
  window.Crumbs = stub("Crumbs");
  window.DirectConnectScreen = stub("DirectConnectScreen");
  window.FEEDBACK_KINDS = stub("FEEDBACK_KINDS");
  window.FeedbackScreen = stub("FeedbackScreen");
  window.FollowGateScreen = stub("FollowGateScreen");
  window.FrozenScreen = stub("FrozenScreen");
  window.GM_CN = stub("GM_CN");
  window.GuestAvatar = stub("GuestAvatar");
  window.ICON_PIX = stub("ICON_PIX");
  window.Instances = stub("Instances");
  window.InviteCardScreen = stub("InviteCardScreen");
  window.InviteScreen = stub("InviteScreen");
  window.JING_KAOMOJI = stub("JING_KAOMOJI");
  window.JING_TEX = stub("JING_TEX");
  window.LocalGuest = stub("LocalGuest");
  window.LocalHost = stub("LocalHost");
  window.LocalRoomScreen = stub("LocalRoomScreen");
  window.LocalRoomStatusScreen = stub("LocalRoomStatusScreen");
  window.LoginScreen = stub("LoginScreen");
  window.MultiplayerScreen = stub("MultiplayerScreen");
  window.MyRoomsScreen = stub("MyRoomsScreen");
  window.NET_CHUNK_MSG = stub("NET_CHUNK_MSG");
  window.NET_DELAY = stub("NET_DELAY");
  window.NET_DIR = stub("NET_DIR");
  window.NET_ENCH_ONE = stub("NET_ENCH_ONE");
  window.NET_FACE = stub("NET_FACE");
  window.NET_META_DEFAULTS = stub("NET_META_DEFAULTS");
  window.NET_MOBS = stub("NET_MOBS");
  window.NET_OUTPUT = stub("NET_OUTPUT");
  window.NET_PLAYER_T = stub("NET_PLAYER_T");
  window.NET_POTION_CN = stub("NET_POTION_CN");
  window.NET_POTION_PLAIN = stub("NET_POTION_PLAIN");
  window.NET_QUIET = stub("NET_QUIET");
  window.NET_RB_TAB = stub("NET_RB_TAB");
  window.NET_SCREEN = stub("NET_SCREEN");
  window.NET_SPRITE = stub("NET_SPRITE");
  window.NET_USE_ON_PASS = stub("NET_USE_ON_PASS");
  window.NEWS_T = stub("NEWS_T");
  window.NetPlayer = stub("NetPlayer");
  window.NewsEditScreen = stub("NewsEditScreen");
  window.NewsScreen = stub("NewsScreen");
  window.P2PLink = stub("P2PLink");
  window.P2P_MAX = stub("P2P_MAX");
  window.R2D = stub("R2D");
  window.REPORT_REASONS = stub("REPORT_REASONS");
  window.ReportScreen = stub("ReportScreen");
  window.SINGLE_OPEN = stub("SINGLE_OPEN");
  window.SavePickScreen = stub("SavePickScreen");
  window.TELEMETRY_V = stub("TELEMETRY_V");
  window.TelemetryScreen = stub("TelemetryScreen");
  window.ToyDiagScreen = stub("ToyDiagScreen");
  window.ToyError = stub("ToyError");
  window.UnlockScreen = stub("UnlockScreen");
  window.UnlockSparks = stub("UnlockSparks");
  window.WardrobeScreen = stub("WardrobeScreen");
  window.angDiff = stub("angDiff");
  window.beJson = stub("beJson");
  window.beKey = stub("beKey");
  window.chkRnd = stub("chkRnd");
  window.codeOnly = stub("codeOnly");
  window.drawIcon = stub("drawIcon");
  window.flag = stub("flag");
  window.g_netName = stub("g_netName");
  window.joinLocalRoom = stub("joinLocalRoom");
  window.nameOnly = stub("nameOnly");
  window.netApplyEquip = stub("netApplyEquip");
  window.netApplyMeta = stub("netApplyMeta");
  window.netEntityTick = stub("netEntityTick");
  window.netItemTick = stub("netItemTick");
  window.netMapData = stub("netMapData");
  window.netMax = stub("netMax");
  window.netMayPlace = stub("netMayPlace");
  window.netMetaDefaults = stub("netMetaDefaults");
  window.netMoveTo = stub("netMoveTo");
  window.netRd = stub("netRd");
  window.netRecipe = stub("netRecipe");
  window.netSelfMeta = stub("netSelfMeta");
  window.netShotTick = stub("netShotTick");
  window.netStack = stub("netStack");
  window.netStatus = stub("netStatus");
  window.netVehicleTick = stub("netVehicleTick");
  window.newsEase = stub("newsEase");
  window.newsEaseIO = stub("newsEaseIO");
  window.offlineBack = stub("offlineBack");
  window.oursToWin = stub("oursToWin");
  window.p2pBlocks = stub("p2pBlocks");
  window.p2pBytes = stub("p2pBytes");
  window.p2pFrame = stub("p2pFrame");
  window.p2pFrames = stub("p2pFrames");
  window.p2pItem = stub("p2pItem");
  window.p2pLook = stub("p2pLook");
  window.p2pPackChunk = stub("p2pPackChunk");
  window.p2pSendList = stub("p2pSendList");
  window.p2pUnpackChunk = stub("p2pUnpackChunk");
  window.p2pUrl = stub("p2pUrl");
  window.p2pWord = stub("p2pWord");
  window.pinvToOurs = stub("pinvToOurs");
  window.postFeedback = stub("postFeedback");
  window.roomAge = stub("roomAge");
  window.sameItem = stub("sameItem");
  window.sameStack = stub("sameStack");
  window.showAnnounce = stub("showAnnounce");
  window.textOk = stub("textOk");
  window.toYaw = stub("toYaw");
  window.unlockCelebrate = stub("unlockCelebrate");
  window.wrapText = stub("wrapText");
  window.xhr = stub("xhr");

  /* ---- 兜底：阻断任何残留的外部网络请求 -------------------------------- */
  var rawFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    try {
      var u = new URL(String(url), location.href);
      if (u.origin !== location.origin) return Promise.reject(new Error('离线版已禁用外部请求'));
      // 同源请求放行：audio.js 会 HEAD 探测 sounds/sfx/ 是否有原版音效包，
      // 服务器返回 404 即让它回退到程序化合成音（不再需要在这里伪造 404）。
    } catch (e) {}
    return rawFetch ? rawFetch(url, opts) : Promise.reject(new Error('fetch unavailable'));
  };
  window.WebSocket = function () { throw new Error('离线版已禁用联机'); };
  if (window.RTCPeerConnection) window.RTCPeerConnection = function () { throw new Error('离线版已禁用 P2P'); };
  if (navigator.sendBeacon) { try { navigator.sendBeacon = function () { return false; }; } catch (e) {} }
})();
