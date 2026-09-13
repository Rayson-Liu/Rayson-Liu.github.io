/* 桜色クローバー — engine (expanded 2D campus) */
(function () {
  "use strict";

  const TILE = 40;
  const PLAYER_SPEED = 3.6;
  /* native CSS-pixel buffer × devicePixelRatio — sharp, not downscaled */
  const MAX_DPR = 2;

  const BLOCKED = new Set([2, 3, 4, 6, 10, 11, 12, 13, 14, 15, 16, 19]);

  const state = {
    mode: "title",
    day: 1,
    phase: "afternoon",
    mapId: "outdoor",
    player: { x: 19 * TILE, y: 24 * TILE, dir: "up", walkT: 0 },
    keys: {},
    affection: { sakura: 0, nagi: 0, reina: 0, hiyori: 0 },
    flags: {},
    talkedToday: {},
    currentLoc: "outdoor",
    sceneIndex: 0,
    choiceOpen: false,
    typing: false,
    typeTimer: null,
    fullText: "",
    pendingGoto: null,
    scene: null,
    canvas: null,
    ctx: null,
    npcs: [],
    petalT: 0,
    lastTs: 0,
    bgmOn: true,
    seCtx: null,
    showMinimap: false,
    ambient: [],
  };

  /* door signs on outdoor for discovery */
  const DOOR_SIGNS = {
    classroom: "教室",
    hallway: "走廊",
    gym: "体育馆",
    cafeteria: "食堂",
    council: "学生会",
    lockers: "鞋柜",
  };

  /* ---------- tiny SE ---------- */
  function ensureSe() {
    if (state.seCtx) return state.seCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    state.seCtx = new AC();
    return state.seCtx;
  }
  function se(kind) {
    const ac = ensureSe();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    if (kind === "talk") {
      o.type = "sine";
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(660, t + 0.08);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.start(t);
      o.stop(t + 0.14);
    } else if (kind === "door") {
      o.type = "triangle";
      o.frequency.setValueAtTime(440, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.15);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.start(t);
      o.stop(t + 0.2);
    } else if (kind === "choice") {
      o.type = "sine";
      o.frequency.setValueAtTime(520, t);
      o.frequency.setValueAtTime(780, t + 0.06);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t);
      o.stop(t + 0.18);
    } else if (kind === "aff") {
      o.type = "sine";
      o.frequency.setValueAtTime(660, t);
      o.frequency.setValueAtTime(990, t + 0.08);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t);
      o.stop(t + 0.24);
    }
  }

  /* ambient students for campus life */
  function spawnAmbient() {
    state.ambient = [];
    if (state.mapId !== "outdoor") return;
    const spots = [
      [8, 16], [31, 16], [12, 20], [26, 20], [20, 12], [16, 24], [24, 24],
    ];
    const hairs = ["#6b5040", "#8a6b50", "#3d3a48", "#a08060", "#5a4a60"];
    for (let i = 0; i < 5; i++) {
      const s = spots[i];
      state.ambient.push({
        x: (s[0] + 0.5) * TILE,
        y: (s[1] + 0.5) * TILE,
        vx: (i % 2 ? 0.35 : -0.3),
        vy: (i % 3 ? 0.15 : -0.2),
        hair: hairs[i],
        phase: Math.random() * 10,
      });
    }
  }

  function updateAmbient() {
    if (state.mapId !== "outdoor") return;
    state.ambient.forEach((a) => {
      a.x += a.vx;
      a.y += a.vy;
      a.phase += 0.08;
      if (a.x < 4 * TILE || a.x > 36 * TILE) a.vx *= -1;
      if (a.y < 10 * TILE || a.y > 26 * TILE) a.vy *= -1;
      if (isBlocked(a.x, a.y)) {
        a.vx *= -1;
        a.vy *= -1;
      }
    });
  }

  function drawAmbient(ctx, camX, camY) {
    state.ambient.forEach((a) => {
      const sx = a.x - camX;
      const sy = a.y - camY;
      if (sx < -40 || sy < -40 || sx > viewSize().w + 40 || sy > viewSize().h + 40) return;
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.ellipse(sx, sy + 10, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // body
      ctx.fillStyle = "#7a8aaa";
      ctx.fillRect(sx - 7, sy - 10, 14, 16);
      ctx.fillStyle = "#5a6a8a";
      ctx.fillRect(sx - 7, sy - 10, 14, 3);
      // head
      ctx.fillStyle = "#f0c8a8";
      ctx.beginPath();
      ctx.arc(sx, sy - 16, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = a.hair;
      ctx.beginPath();
      ctx.arc(sx, sy - 18, 8.5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(sx - 8, sy - 18, 16, 4);
    });
  }

  const $ = (id) => document.getElementById(id);

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const el = $(id);
    if (el) el.classList.add("active");
  }
  function showPanel(id, on) {
    const el = $(id);
    if (el) el.classList.toggle("active", !!on);
    if (state._syncMobileCtl) state._syncMobileCtl();
  }
  function toast(msg, ms = 2200) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove("show"), ms);
  }

  function map() {
    return window.MAPS.get(state.mapId);
  }

  function locName(id) {
    const L = GAME.LOCS[id];
    if (L) return L.name;
    const m = window.MAPS.get(id);
    return m ? m.name : "校园";
  }

  /* outdoor <-> GAME.LOCS mapping for VN backgrounds */
  const LOC_OF_MAP = {
    outdoor: "courtyard",
    classroom: "classroom",
    library: "library",
    hallway: "hallway",
    cafeteria: "cafeteria",
    gym: "gym",
    rooftop: "rooftop",
    council: "hallway",
    lockers: "gate",
  };

  function bgForMap() {
    return bgForLoc(LOC_OF_MAP[state.mapId] || "courtyard");
  }
  function bgForLoc(loc) {
    const L = GAME.LOCS[loc];
    return L ? L.bg : "assets/bg/courtyard.png";
  }

  /* ---------- Save ---------- */
  function saveGame() {
    const data = {
      day: state.day,
      phase: state.phase,
      mapId: state.mapId,
      affection: { ...state.affection },
      flags: { ...state.flags },
      talkedToday: { ...state.talkedToday },
      player: { x: state.player.x, y: state.player.y, dir: state.player.dir },
    };
    try {
      localStorage.setItem("sakura_clover_save", JSON.stringify(data));
      toast("已保存进度");
    } catch (e) {
      toast("保存失败");
    }
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem("sakura_clover_save");
      if (!raw) return false;
      const d = JSON.parse(raw);
      state.day = d.day || 1;
      state.phase = d.phase || "afternoon";
      state.mapId = d.mapId || "outdoor";
      state.affection = d.affection || { sakura: 0, nagi: 0, reina: 0, hiyori: 0 };
      state.flags = d.flags || {};
      state.talkedToday = d.talkedToday || {};
      if (d.player) {
        state.player.x = d.player.x;
        state.player.y = d.player.y;
        state.player.dir = d.player.dir || "down";
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  function hasSave() {
    return !!localStorage.getItem("sakura_clover_save");
  }

  function getNpcLocation(charId) {
    return (GAME.SCHEDULE[state.phase] || {})[charId] || "courtyard";
  }

  /* schedule: which map each NPC is on */
  const NPC_MAP = {
    sakura: { classroom: "classroom", cafeteria: "cafeteria", courtyard: "outdoor", gate: "outdoor" },
    nagi: { library: "library", courtyard: "outdoor" },
    reina: { hallway: "hallway", rooftop: "rooftop", cafeteria: "cafeteria" },
    hiyori: { rooftop: "rooftop", courtyard: "outdoor", gate: "outdoor", classroom: "classroom" },
  };
  const NPC_POS = {
    sakura: { outdoor: { classroom: [14, 12], cafeteria: [4, 20], courtyard: [12, 12], gate: [18, 24] },
              classroom: [5, 6], cafeteria: [5, 6] },
    nagi: { outdoor: { library: [20, 12], courtyard: [26, 12] }, library: [4, 6] },
    reina: { outdoor: { hallway: [22, 12], rooftop: [16, 12], cafeteria: [5, 20] },
             hallway: [8, 4], rooftop: [6, 5], cafeteria: [12, 6] },
    hiyori: { outdoor: { rooftop: [24, 12], courtyard: [26, 14], gate: [20, 24], classroom: [24, 12] },
              rooftop: [10, 5], classroom: [10, 5] },
  };

  function refreshNpcs() {
    state.npcs = [];
    Object.keys(GAME.CHARACTERS).forEach((id) => {
      if (state.flags["ending_" + id]) return;
      const loc = getNpcLocation(id);
      const mapId = (NPC_MAP[id] && NPC_MAP[id][loc]) || "outdoor";
      if (mapId !== state.mapId) return;
      let pos = null;
      if (mapId === "outdoor") {
        const a = NPC_POS[id] && NPC_POS[id].outdoor && NPC_POS[id].outdoor[loc];
        if (a) pos = a;
      } else {
        const a = NPC_POS[id] && NPC_POS[id][mapId];
        if (Array.isArray(a)) pos = a;
      }
      if (!pos) {
        // fallback center
        const m = map();
        pos = [Math.floor(m.w / 2), Math.floor(m.h / 2)];
      }
      state.npcs.push({
        id,
        x: (pos[0] + 0.5) * TILE,
        y: (pos[1] + 0.5) * TILE,
        loc,
        char: GAME.CHARACTERS[id],
      });
    });
    spawnAmbient();
    updateRosterHud();
  }

  function updateRosterHud() {
    const el = $("hud-roster");
    if (!el) return;
    const parts = [];
    Object.keys(GAME.CHARACTERS).forEach((id) => {
      if (state.flags["ending_" + id]) return;
      const loc = getNpcLocation(id);
      const short = { sakura: "桜", nagi: "凪", reina: "玲", hiyori: "ひ" }[id] || id;
      parts.push(
        `<span class="ros" title="${GAME.CHARACTERS[id].name} @ ${locName((NPC_MAP[id] && NPC_MAP[id][loc]) || 'outdoor')}">${short}:${locName((NPC_MAP[id] && NPC_MAP[id][loc]) || 'outdoor')}</span>`
      );
    });
    el.innerHTML = parts.join("");
  }

  function drawMinimap(ctx) {
    if (!state.showMinimap) return;
    const m = map();
    const mw = 150, mh = 108;
    const ox = viewSize().w - mw - 14;
    const oy = 56;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "rgba(255,248,245,0.92)";
    ctx.fillRect(ox - 4, oy - 4, mw + 8, mh + 8);
    ctx.strokeStyle = "rgba(61,44,78,0.25)";
    ctx.strokeRect(ox - 4.5, oy - 4.5, mw + 9, mh + 9);
    const sx = mw / (m.w * TILE);
    const sy = mh / (m.h * TILE);
    // sample tiles coarsely
    for (let y = 0; y < m.h; y += 1) {
      for (let x = 0; x < m.w; x += 1) {
        const t = m.tiles[y][x];
        if (t === 2 || t === 13 || t === 14) ctx.fillStyle = "#d8cfc0";
        else if (t === 1) ctx.fillStyle = "#e8d4b0";
        else if (t === 8) ctx.fillStyle = "#e07090";
        else if (t === 3 || t === 9) ctx.fillStyle = "#7fb069";
        else if (t === 4) ctx.fillStyle = "#7eb8d4";
        else if (m.indoor) ctx.fillStyle = "#f0e8d8";
        else ctx.fillStyle = "#c5dfb8";
        ctx.fillRect(ox + x * TILE * sx, oy + y * TILE * sy, Math.ceil(TILE * sx), Math.ceil(TILE * sy));
      }
    }
    // npcs
    state.npcs.forEach((n) => {
      ctx.fillStyle = n.char.color || "#333";
      ctx.beginPath();
      ctx.arc(ox + n.x * sx, oy + n.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    // player
    ctx.fillStyle = "#3d2c4e";
    ctx.beginPath();
    ctx.arc(ox + state.player.x * sx, oy + state.player.y * sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.font = "600 11px 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(61,44,78,0.7)";
    ctx.textAlign = "left";
    ctx.fillText("N 小地图", ox, oy + mh + 14);
  }

  function phaseTint(ctx, cw, ch) {
    const p = state.phase;
    let color = null;
    if (p === "morning") color = "rgba(180,210,240,0.12)";
    else if (p === "noon") color = "rgba(255,240,200,0.08)";
    else if (p === "afternoon") color = "rgba(255,220,180,0.10)";
    else if (p === "evening") color = "rgba(255,150,100,0.18)";
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cw, ch);
  }

  function tileAt(px, py) {
    const m = map();
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return 6;
    return m.tiles[ty][tx];
  }
  function isBlocked(px, py) {
    return BLOCKED.has(tileAt(px, py));
  }
  function tryMove(dx, dy) {
    const p = state.player;
    const nx = p.x + dx;
    const ny = p.y + dy;
    const pts = [
      [nx - 8, ny + 10],
      [nx + 8, ny + 10],
      [nx - 8, ny - 2],
      [nx + 8, ny - 2],
    ];
    if (!pts.some(([x, y]) => isBlocked(x, y))) {
      p.x = nx;
      p.y = ny;
      return true;
    }
    const ptsX = pts.map(([, y]) => [nx, y]);
    const ptsY = pts.map(([x]) => [x, ny]);
    if (dx && !ptsX.some(([x, y]) => isBlocked(x, y))) { p.x = nx; return true; }
    if (dy && !ptsY.some(([x, y]) => isBlocked(x, y))) { p.y = ny; return true; }
    return false;
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function portalsFor(mapId) {
    return window.MAPS.PORTALS[mapId] || [];
  }

  function nearbyInteract() {
    const p = state.player;
    let best = null, bestD = 46;
    state.npcs.forEach((n) => {
      const d = dist(p.x, p.y, n.x, n.y);
      if (d < bestD) { bestD = d; best = { type: "npc", npc: n }; }
    });
    if (best) return best;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (const portal of portalsFor(state.mapId)) {
      const d = Math.abs(portal.x - tx) + Math.abs(portal.y - ty);
      if (d === 0) return { type: "portal", portal };
      if (d <= 1) {
        const dpx = dist(p.x, p.y, (portal.x + 0.5) * TILE, (portal.y + 0.5) * TILE);
        if (dpx < 36) return { type: "portal", portal };
      }
    }
    return null;
  }

  function interact() {
    const target = nearbyInteract();
    const hint = $("interact-hint");
    if (!target) {
      hint.classList.remove("show");
      return;
    }
    hint.classList.remove("show");
    if (target.type === "npc") talkToNpc(target.npc.id);
    else if (target.type === "portal") usePortal(target.portal);
  }

  function usePortal(portal) {
    se("door");
    const to = portal.to;
    const sx = (portal.spawn && portal.spawn[0]) || 5;
    const sy = (portal.spawn && portal.spawn[1]) || 5;
    state.mapId = to;
    state.currentLoc = to;
    state.player.x = (sx + 0.5) * TILE;
    state.player.y = (sy + 0.5) * TILE;
    state.player.dir = "down";
    $("hud-loc").textContent = locName(to);
    refreshNpcs();

    if (!state.flags["seen_" + to]) {
      state.flags["seen_" + to] = true;
      const lines = {
        classroom: "教室里阳光正好，桌椅整齐排列。",
        library: "图书室安静得能听见翻页声，书香浮动。",
        hallway: "走廊的窗户透进午后的光。",
        cafeteria: "食堂飘着淡淡的饭菜香。",
        gym: "体育馆空旷回荡，球鞋摩擦地板仿佛还在。",
        rooftop: "屋顶的风吹乱了头发。远处是小镇与大海。",
        council: "学生会室里文件堆得很高，却很整洁。",
        lockers: "鞋柜处还留着放学时的喧闹余温。",
        outdoor: "回到校园主路，樱花正盛。",
      };
      startScene("_loc_flavor", { text: lines[to] || "来到了新的地方。", bg: bgForMap() });
    } else {
      toast("来到 " + locName(to));
    }
  }

  function talkToNpc(id) {
    se("talk");
    if (
      state.affection[id] >= GAME.CONFESSION_THRESHOLD &&
      state.day >= GAME.CONFESSION_MIN_DAY &&
      !state.flags["confessed_" + id] &&
      !state.flags["ending_" + id]
    ) {
      state.flags["confessed_" + id] = true;
      startScene(id + "_confession");
      return;
    }
    const sceneId = pickEventScene(id);
    if (sceneId) {
      startScene(sceneId);
      return;
    }
    const lines = GAME.AMBIENT[id] || ["……"];
    const text = lines[Math.floor(Math.random() * lines.length)];
    startScene("_ambient", { who: id, text, bg: bgForMap(), char: id });
  }

  function pickEventScene(id) {
    const aff = state.affection[id];
    const loc = getNpcLocation(id);
    const f = state.flags;
    if (id === "sakura") {
      if (!f.ev_sakura_c1) { f.ev_sakura_c1 = true; return "sakura_courtyard_1"; }
      if (!f.ev_sakura_caf && (loc === "cafeteria" || state.mapId === "cafeteria")) {
        f.ev_sakura_caf = true;
        return "sakura_cafeteria_1";
      }
      if (!f.ev_sakura_c2 && aff >= 6 && state.day >= 2) {
        f.ev_sakura_c2 = true;
        return "sakura_courtyard_1";
      }
    }
    if (id === "nagi") {
      if (!f.ev_nagi_c1) { f.ev_nagi_c1 = true; return "nagi_library_1"; }
      if (!f.ev_nagi_c2 && aff >= 6 && state.day >= 2) {
        f.ev_nagi_c2 = true;
        return "nagi_library_2";
      }
    }
    if (id === "reina") {
      if (!f.ev_reina_c1) { f.ev_reina_c1 = true; return "reina_hallway_1"; }
      if (!f.ev_reina_c2 && (loc === "rooftop" || state.mapId === "rooftop" || aff >= 5) && state.day >= 2) {
        f.ev_reina_c2 = true;
        return "reina_rooftop_1";
      }
    }
    if (id === "hiyori") {
      if (!f.ev_hiyo_c1) { f.ev_hiyo_c1 = true; return "hiyori_rooftop_1"; }
      if (!f.ev_hiyo_c2 && (loc === "courtyard" || state.mapId === "outdoor")) {
        f.ev_hiyo_c2 = true;
        return "hiyori_courtyard_1";
      }
    }
    return null;
  }

  function advancePhase() {
    const idx = GAME.PHASES.indexOf(state.phase);
    if (idx < GAME.PHASES.length - 1) {
      state.phase = GAME.PHASES[idx + 1];
      toast("时间来到了「" + GAME.PHASE_LABELS[state.phase] + "」");
    } else {
      state.phase = "afternoon";
      state.day += 1;
      state.talkedToday = {};
      toast("第 " + state.day + " 天开始了");
      saveGame();
      if (state.day > 7) checkAutoEnding();
    }
    $("hud-day").textContent = "第 " + state.day + " 天";
    $("hud-time").textContent = GAME.PHASE_LABELS[state.phase];
    refreshNpcs();
    updateRosterHud();
  }

  function checkAutoEnding() {
    if (state.day > 10) {
      const maxId = Object.keys(state.affection).reduce((a, b) =>
        state.affection[a] >= state.affection[b] ? a : b
      );
      if (state.affection[maxId] >= 8) startScene(maxId + "_confession");
      else startScene("_ending_alone");
    }
  }

  /* ---------- Drawing ---------- */
  function drawTile(ctx, t, sx, sy, tx, ty, indoor) {
    const s = TILE;
    const n = ((tx * 17 + ty * 31) % 7) / 7;
    const n2 = ((tx * 13 + ty * 7) % 5) / 5;
    const cx = sx + s / 2;
    const cy = sy + s / 2;

    function grassBase() {
      const r = 150 + n * 14;
      const g = 198 + n * 16;
      const b = 128 + n * 12;
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(sx, sy, s, s);
      // soft dither
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      if ((tx + ty) % 2 === 0) ctx.fillRect(sx, sy, s, s);
      // blades
      ctx.strokeStyle = `rgba(90,140,70,${0.18 + n2 * 0.1})`;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const bx = sx + 6 + i * 9 + (n * 3);
        const by = sy + s - 4 - (i % 2) * 6;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + 2, by - 8, bx + (i % 2 ? 3 : -3), by - 12);
        ctx.stroke();
      }
    }

    if (t === 0 || t === 7 || t === 9 || t === 3) grassBase();
    else if (t === 5 || t >= 10) {
      ctx.fillStyle = indoor ? "#efe4d2" : "#e6d8c0";
      ctx.fillRect(sx, sy, s, s);
      ctx.fillStyle = "rgba(0,0,0,0.03)";
      ctx.fillRect(sx, sy, s, 1);
      ctx.fillRect(sx, sy, 1, s);
    } else if (t === 17 || t === 18) {
      ctx.fillStyle = t === 18 ? "#d8bc98" : "#c8a878";
      ctx.fillRect(sx, sy, s, s);
      ctx.strokeStyle = "rgba(0,0,0,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, cy); ctx.lineTo(sx + s, cy);
      ctx.stroke();
    } else if (t === 13) {
      ctx.fillStyle = "#f7efe4";
      ctx.fillRect(sx, sy, s, s);
    }

    switch (t) {
      case 1: {
        // stone path
        ctx.fillStyle = "#ead6b4";
        ctx.fillRect(sx, sy, s, s);
        ctx.strokeStyle = "rgba(140,110,70,0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 1, sy + 1, s - 2, s - 2);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(sx + 3, sy + 3, s * 0.45, s * 0.35);
        if ((tx + ty) % 3 === 0) {
          ctx.fillStyle = "rgba(160,130,90,0.08)";
          ctx.fillRect(sx + s * 0.5, sy + s * 0.45, s * 0.4, s * 0.4);
        }
        break;
      }
      case 2: {
        const wall = indoor ? "#f2e8da" : "#f7efe3";
        ctx.fillStyle = wall;
        ctx.fillRect(sx, sy, s, s);
        // brick lines
        ctx.strokeStyle = "rgba(61,44,78,0.08)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, s - 1, s - 1);
        ctx.beginPath();
        ctx.moveTo(sx, sy + s / 2); ctx.lineTo(sx + s, sy + s / 2);
        ctx.stroke();
        if (!indoor) {
          // window
          const win = (tx + ty) % 2 === 0;
          if (win) {
            ctx.fillStyle = "#d8eaf4";
            ctx.fillRect(sx + 7, sy + 7, s - 14, s * 0.45);
            ctx.fillStyle = "#a8d4e6";
            ctx.fillRect(sx + 9, sy + 9, s - 18, s * 0.45 - 4);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(sx + 7.5, sy + 7.5, s - 15, s * 0.45 - 1);
            ctx.beginPath();
            ctx.moveTo(cx, sy + 8); ctx.lineTo(cx, sy + 8 + s * 0.45 - 3);
            ctx.stroke();
            // glass shine
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.beginPath();
            ctx.moveTo(sx + 12, sy + s * 0.4);
            ctx.lineTo(sx + 18, sy + 10);
            ctx.lineTo(sx + 22, sy + 10);
            ctx.lineTo(sx + 14, sy + s * 0.4);
            ctx.fill();
          } else {
            // wall panel
            ctx.fillStyle = "rgba(0,0,0,0.03)";
            ctx.fillRect(sx + 6, sy + 6, s - 12, s - 12);
          }
          // roof edge
          if (ty > 0) {
            const above = map().tiles[ty - 1] && map().tiles[ty - 1][tx];
            if (above !== 2 && above !== 13) {
              ctx.fillStyle = "#c9a87a";
              ctx.fillRect(sx, sy, s, 7);
              ctx.fillStyle = "#b8956a";
              ctx.fillRect(sx, sy + 5, s, 2);
            }
          }
        }
        break;
      }
      case 3: {
        grassBase();
        // tree
        ctx.fillStyle = "#6b4226";
        ctx.fillRect(sx + s * 0.42, sy + s * 0.48, s * 0.16, s * 0.4);
        ctx.fillStyle = "#5a3a1e";
        ctx.fillRect(sx + s * 0.42, sy + s * 0.48, 3, s * 0.4);
        ctx.fillStyle = "#3f7a38";
        ctx.beginPath(); ctx.arc(cx, sy + s * 0.38, s * 0.36, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#4e9344";
        ctx.beginPath(); ctx.arc(cx - 5, sy + s * 0.32, s * 0.24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#62ad56";
        ctx.beginPath(); ctx.arc(cx + 4, sy + s * 0.28, s * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath(); ctx.arc(cx - 6, sy + s * 0.26, s * 0.08, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 4: {
        // fountain basin
        ctx.fillStyle = "#d5dee8";
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = "#c5d0dc";
        ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.46, s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#7ec0dc";
        ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.38, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath(); ctx.ellipse(cx - 4, cy - 3, s * 0.12, s * 0.08, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.arc(cx - 2, cy - 2, 3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 6: {
        ctx.fillStyle = "#d8c8a8";
        ctx.fillRect(sx, sy, s, s);
        ctx.strokeStyle = "#8a7a60";
        ctx.lineWidth = 2;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(sx, sy + (s / 4) * i);
          ctx.lineTo(sx + s, sy + (s / 4) * i);
          ctx.stroke();
        }
        ctx.fillStyle = "#a89070";
        ctx.fillRect(sx + s * 0.45, sy, 3, s);
        break;
      }
      case 7: {
        grassBase();
        const cols = ["#f4a0b5", "#f0d060", "#c8a0e0", "#fff8f0"];
        const c0 = cols[(tx + ty) % 4];
        for (let i = 0; i < 5; i++) {
          const fx = sx + 8 + ((i * 11 + tx * 3) % 28);
          const fy = sy + 8 + ((i * 7 + ty * 5) % 26);
          ctx.fillStyle = "#5a9e48";
          ctx.fillRect(fx - 0.5, fy + 2, 1.5, 4);
          ctx.fillStyle = c0;
          ctx.beginPath(); ctx.arc(fx, fy, 3.2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          ctx.beginPath(); ctx.arc(fx - 1, fy - 1, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 8: {
        ctx.fillStyle = "#e8d4b0";
        ctx.fillRect(sx, sy, s, s);
        // door frame
        ctx.fillStyle = "#c9a070";
        ctx.fillRect(sx + 5, sy + 2, s - 10, s - 2);
        ctx.fillStyle = "#e07090";
        ctx.fillRect(sx + 8, sy + 5, s - 16, s - 5);
        ctx.fillStyle = "#c06090";
        ctx.fillRect(sx + 8, sy + 5, s - 16, 5);
        // panels
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 12, sy + 14, s - 24, 10);
        ctx.strokeRect(sx + 12, sy + 28, s - 24, 8);
        // handle
        ctx.fillStyle = "#f0e0a0";
        ctx.beginPath(); ctx.arc(sx + s - 12, sy + s * 0.55, 2.5, 0, Math.PI * 2); ctx.fill();
        // glow
        ctx.fillStyle = "rgba(244,160,181,0.2)";
        ctx.fillRect(sx, sy, s, s);
        break;
      }
      case 9: {
        grassBase();
        // sakura trunk
        ctx.fillStyle = "#6b4226";
        ctx.fillRect(sx + s * 0.45, sy + s * 0.5, s * 0.12, s * 0.38);
        // canopy layers
        const pinks = ["#f8c4d4", "#f4a0b5", "#ef8aa6", "#e87898", "#ffd0dc"];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rr = s * (0.18 + (i % 3) * 0.04);
          const px = cx + Math.cos(a) * s * 0.16;
          const py = sy + s * 0.36 + Math.sin(a) * s * 0.12;
          ctx.fillStyle = pinks[i % pinks.length];
          ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#ffc8d8";
        ctx.beginPath(); ctx.arc(cx - 3, sy + s * 0.3, s * 0.12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath(); ctx.arc(cx - 6, sy + s * 0.26, s * 0.06, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 10: {
        // desk
        ctx.fillStyle = "#d2b078";
        ctx.fillRect(sx + 3, sy + 8, s - 6, s * 0.45);
        ctx.fillStyle = "#b89558";
        ctx.fillRect(sx + 3, sy + 8 + s * 0.45 - 4, s - 6, 4);
        ctx.fillStyle = "#a07848";
        ctx.fillRect(sx + 6, sy + 8 + s * 0.45, 4, 8);
        ctx.fillRect(sx + s - 10, sy + 8 + s * 0.45, 4, 8);
        // wood grain
        ctx.strokeStyle = "rgba(0,0,0,0.06)";
        ctx.beginPath();
        ctx.moveTo(sx + 6, sy + 16); ctx.lineTo(sx + s - 6, sy + 14);
        ctx.stroke();
        break;
      }
      case 11: {
        // bookshelf
        ctx.fillStyle = "#8b5a3c";
        ctx.fillRect(sx + 1, sy + 2, s - 2, s - 4);
        ctx.fillStyle = "#6e442c";
        ctx.fillRect(sx + 1, sy + 2, s - 2, 4);
        const bookCols = ["#6b8c7a", "#8a6b9c", "#9c6b6b", "#6b7a9c", "#c4a070", "#5a7a9c"];
        for (let row = 0; row < 2; row++) {
          for (let i = 0; i < 5; i++) {
            ctx.fillStyle = bookCols[(i + row + tx) % bookCols.length];
            const bx = sx + 4 + i * 7;
            const by = sy + 8 + row * 14;
            ctx.fillRect(bx, by, 5, 12);
            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.fillRect(bx + 1, by + 1, 1, 10);
          }
          ctx.fillStyle = "#6e442c";
          ctx.fillRect(sx + 1, sy + 8 + row * 14 + 12, s - 2, 2);
        }
        break;
      }
      case 12: {
        // table
        ctx.fillStyle = "#d8b888";
        ctx.fillRect(sx + 2, sy + 10, s - 4, s * 0.4);
        ctx.fillStyle = "#c0a068";
        ctx.fillRect(sx + 2, sy + 10, s - 4, 3);
        ctx.fillStyle = "#a88850";
        ctx.fillRect(sx + 5, sy + 10 + s * 0.4, 4, 8);
        ctx.fillRect(sx + s - 9, sy + 10 + s * 0.4, 4, 8);
        break;
      }
      case 13: {
        ctx.fillStyle = "#a8d4e6";
        ctx.fillRect(sx + 5, sy + 5, s - 10, s - 12);
        ctx.fillStyle = "#c8e8f4";
        ctx.fillRect(sx + 7, sy + 7, s - 14, s - 16);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 5, sy + 5, s - 10, s - 12);
        ctx.beginPath();
        ctx.moveTo(cx, sy + 5); ctx.lineTo(cx, sy + s - 7);
        ctx.moveTo(sx + 5, cy); ctx.lineTo(sx + s - 5, cy);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath();
        ctx.moveTo(sx + 10, sy + s - 10);
        ctx.lineTo(sx + 18, sy + 8);
        ctx.lineTo(sx + 22, sy + 8);
        ctx.lineTo(sx + 12, sy + s - 10);
        ctx.fill();
        break;
      }
      case 14: {
        ctx.fillStyle = "#2e4a3e";
        ctx.fillRect(sx + 3, sy + 8, s - 6, s * 0.5);
        ctx.strokeStyle = "#c4a882";
        ctx.lineWidth = 3;
        ctx.strokeRect(sx + 3, sy + 8, s - 6, s * 0.5);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(sx + 6, sy + 11, s - 12, s * 0.5 - 6);
        break;
      }
      case 15: {
        ctx.fillStyle = "#dcc8a8";
        ctx.fillRect(sx + 2, sy + 3, s - 4, s - 6);
        ctx.strokeStyle = "#a89070";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.strokeRect(sx + 4, sy + 5 + i * 11, s - 8, 9);
          ctx.fillStyle = "#b8a080";
          ctx.fillRect(sx + s / 2 - 2, sy + 8 + i * 11, 4, 2);
        }
        break;
      }
      case 16: {
        ctx.fillStyle = "#e8d8b8";
        ctx.fillRect(sx, sy + 6, s, s * 0.5);
        ctx.fillStyle = "#c8a878";
        ctx.fillRect(sx, sy + 6 + s * 0.5, s, 5);
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(sx, sy + 6, s, 3);
        break;
      }
      case 19: {
        ctx.fillStyle = "#c8a0b0";
        ctx.fillRect(sx + 2, sy + 10, s - 4, s * 0.42);
        ctx.fillStyle = "#a88898";
        ctx.fillRect(sx + 2, sy + 6, s - 4, 10);
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(sx + 4, sy + 8, s - 8, 4);
        break;
      }
      case 20: {
        ctx.fillStyle = indoor ? "#efe4d2" : "#e6d8c0";
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = "#c4a070";
        ctx.fillRect(sx + s * 0.35, sy + s * 0.55, s * 0.3, s * 0.3);
        ctx.fillStyle = "#3f7a38";
        ctx.beginPath(); ctx.arc(cx, sy + s * 0.38, s * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#62ad56";
        ctx.beginPath(); ctx.arc(cx + 3, sy + s * 0.32, s * 0.16, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 21: {
        ctx.fillStyle = "#d8c8a8";
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = "#b8a888";
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(sx, sy + i * 8, s, 2);
          ctx.fillStyle = i % 2 ? "#c8b898" : "#b8a888";
        }
        break;
      }
      case 22: {
        ctx.fillStyle = "#ecd2da";
        ctx.fillRect(sx, sy, s, s);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillRect(sx + 2, sy + 2, s - 4, s - 4);
        break;
      }
    }
  }

  function drawMap(ctx) {
    const m = map();
    const vs = viewSize();
    const cw = vs.w, ch = vs.h;
    let camX = state.player.x - cw / 2;
    let camY = state.player.y - ch / 2;
    camX = Math.max(0, Math.min(camX, m.w * TILE - cw));
    camY = Math.max(0, Math.min(camY, m.h * TILE - ch));
    if (m.w * TILE < cw) camX = (m.w * TILE - cw) / 2;
    if (m.h * TILE < ch) camY = (m.h * TILE - ch) / 2;

    ctx.fillStyle = m.indoor ? "#e8dcc8" : "#9ec98a";
    ctx.fillRect(0, 0, cw, ch);

    const x0 = Math.floor(camX / TILE) - 1;
    const y0 = Math.floor(camY / TILE) - 1;
    const x1 = Math.ceil((camX + cw) / TILE) + 1;
    const y1 = Math.ceil((camY + ch) / TILE) + 1;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        drawTile(ctx, m.tiles[y][x], x * TILE - camX, y * TILE - camY, x, y, m.indoor);
      }
    }

    // outdoor labels
    if (state.mapId === "outdoor") {
      ctx.font = "600 11px 'PingFang SC', sans-serif";
      ctx.textAlign = "center";
      window.MAPS.OUTDOOR_LABELS.forEach((s) => {
        const sx = s.x * TILE - camX;
        const sy = s.y * TILE - camY;
        if (sx < -40 || sy < -20 || sx > cw + 40 || sy > ch + 20) return;
        ctx.fillStyle = "rgba(61,44,78,0.55)";
        ctx.fillText(s.label, sx, sy);
      });
      // door signs near portals
      ctx.font = "700 10px 'PingFang SC', sans-serif";
      portalsFor("outdoor").forEach((p) => {
        if (!DOOR_SIGNS[p.to] && p.to !== "outdoor") return;
        if (p.to === "outdoor") return;
        const sx = (p.x + 0.5) * TILE - camX;
        const sy = p.y * TILE - camY - 6;
        if (sx < -40 || sy < -20 || sx > cw + 40 || sy > ch + 40) return;
        const label = DOOR_SIGNS[p.to] || "";
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(61,44,78,0.75)";
        ctx.fillRect(sx - w / 2, sy - 14, w, 16);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, sx, sy - 3);
      });
    }

    // map name badge
    ctx.fillStyle = "rgba(255,248,245,0.75)";
    ctx.font = "600 12px 'PingFang SC', sans-serif";
    ctx.textAlign = "left";
    ctx.fillRect(12, ch - 36, 90, 24);
    ctx.fillStyle = "#3d2c4e";
    ctx.fillText(locName(state.mapId), 22, ch - 19);

    // ambient students under heroines
    if (state.mapId === "outdoor") drawAmbient(ctx, camX, camY);

    // sort entities by y
    const ents = [];
    state.npcs.forEach((n) => ents.push({ y: n.y, type: "npc", n }));
    ents.push({ y: state.player.y, type: "player" });
    ents.sort((a, b) => a.y - b.y);

    ents.forEach((e) => {
      if (e.type === "player") {
        window.SPRITES.draw(ctx, "player", state.player.x - camX, state.player.y - camY + 14, 1.05, state.player.dir, state.player.walkT);
      } else {
        const n = e.n;
        const sx = n.x - camX;
        const sy = n.y - camY;
        const d = dist(state.player.x, state.player.y, n.x, n.y);
        window.SPRITES.draw(ctx, n.id, sx, sy + 14, 1.0, "down", 0);
        if (d < 100) {
          ctx.font = "600 11px 'PingFang SC', sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fillRect(sx - 32, sy - 52, 64, 16);
          ctx.fillStyle = n.char.color;
          ctx.fillText(n.char.name, sx, sy - 40);
        }
        if (d < 48) {
          ctx.fillStyle = "#fff";
          ctx.font = "bold 16px sans-serif";
          ctx.fillText("！", sx, sy - 58);
        }
      }
    });

    // petals outdoor only
    if (!m.indoor) drawPetals(ctx, camX, camY);

    phaseTint(ctx, cw, ch);

    const grd = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.38, cw / 2, ch / 2, ch * 0.78);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(1, "rgba(40,20,50,0.14)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cw, ch);

    drawMinimap(ctx);
  }

  function drawPetals(ctx, camX, camY) {
    state.petalT += 0.016;
    const t = state.petalT;
    const m = map();
    for (let i = 0; i < 22; i++) {
      const seed = i * 137.5;
      const px = ((seed + t * (18 + (i % 5) * 7)) % (m.w * TILE)) - camX * 0.2;
      const py = ((seed * 0.7 + t * (30 + (i % 4) * 8)) % (m.h * TILE)) - camY * 0.2;
      const sway = Math.sin(t * 2 + i) * 8;
      ctx.fillStyle = `rgba(244,160,181,${0.3 + (i % 3) * 0.15})`;
      ctx.beginPath();
      ctx.ellipse(px + sway, py, 3, 2, t + i, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- VN ---------- */
  function startScene(id, inject) {
    let scene;
    if (id === "_ambient") {
      scene = { bg: inject.bg, lines: [{ who: inject.who, text: inject.text, char: inject.char }] };
    } else if (id === "_loc_flavor") {
      scene = { bg: inject.bg, lines: [{ who: "", text: inject.text }] };
    } else if (id === "_ending_alone") {
      scene = GAME.SCENES.ending_alone;
    } else {
      scene = GAME.SCENES[id];
    }
    if (!scene) {
      toast("……");
      return;
    }
    if (scene.ending && !scene.lines) {
      state.mode = "vn";
      state.scene = scene;
      showEnding(scene.ending);
      return;
    }
    state.mode = "vn";
    state.scene = scene;
    state.sceneIndex = 0;
    state.choiceOpen = false;
    state.pendingGoto = null;
    showScreen("screen-vn");
    const bgUrl =
      scene.bg && String(scene.bg).startsWith("assets")
        ? scene.bg
        : bgForLoc(scene.bg || "courtyard");
    $("vn-bg").style.backgroundImage = `url('${bgUrl}')`;
    $("vn-char").classList.add("hidden");
    $("vn-char").innerHTML = "";
    $("vn-name").textContent = "";
    $("vn-choices").innerHTML = "";
    $("vn-next").classList.remove("hide");
    advanceLine();
  }

  function advanceLine() {
    if (state.choiceOpen) return;
    const scene = state.scene;
    if (!scene || !scene.lines || !scene.lines.length) {
      finishScene();
      return;
    }
    if (state.sceneIndex >= scene.lines.length) {
      finishScene();
      return;
    }
    const line = scene.lines[state.sceneIndex];
    state.sceneIndex++;

    if (line.next === "enter_explore" || line.next === "explore_resume") {
      enterExplore();
      return;
    }
    if (line.ending) {
      showEnding(line.ending);
      return;
    }

    if (line.choice) {
      state.choiceOpen = true;
      $("vn-next").classList.add("hide");
      $("vn-name").textContent = "选择";
      $("vn-text").textContent = "……你要怎么做？";
      const box = $("vn-choices");
      box.innerHTML = "";
      line.choice.forEach((c) => {
        const btn = document.createElement("button");
        btn.className = "choice-btn";
        btn.textContent = c.text;
        btn.addEventListener("click", () => {
          se("choice");
          if (c.aff) {
            Object.keys(c.aff).forEach((k) => {
              state.affection[k] = Math.max(0, (state.affection[k] || 0) + c.aff[k]);
              if (c.aff[k] > 0) {
                se("aff");
                toast(GAME.CHARACTERS[k].name + " 好感 +" + c.aff[k]);
              }
            });
          }
          state.choiceOpen = false;
          box.innerHTML = "";
          $("vn-next").classList.remove("hide");
          if (c.next && GAME.SCENES[c.next]) startScene(c.next);
          else advanceLine();
        });
        box.appendChild(btn);
      });
      return;
    }

    if (line.next && GAME.SCENES[line.next] && !line.text && !line.who) {
      startScene(line.next);
      return;
    }
    state.pendingGoto = line.next && GAME.SCENES[line.next] && line.text ? line.next : null;

    const who = line.who;
    if (who && who !== "me" && GAME.CHARACTERS[who]) {
      $("vn-name").textContent = GAME.CHARACTERS[who].name;
      const img = document.createElement("img");
      img.src = GAME.CHARACTERS[who].portrait;
      img.alt = GAME.CHARACTERS[who].name;
      $("vn-char").innerHTML = "";
      $("vn-char").appendChild(img);
      $("vn-char").classList.remove("hidden");
    } else if (who === "me") {
      $("vn-name").textContent = "你";
      $("vn-char").classList.add("hidden");
    } else {
      $("vn-name").textContent = "";
      $("vn-char").classList.add("hidden");
    }

    if (line.fx && line.fx.startsWith("aff+")) {
      const id = line.fx.slice(4);
      state.affection[id] = (state.affection[id] || 0) + 1;
    }
    typeText(line.text || "");
  }

  function typeText(text) {
    state.fullText = text;
    state.typing = true;
    const el = $("vn-text");
    el.textContent = "";
    let i = 0;
    clearInterval(state.typeTimer);
    state.typeTimer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(state.typeTimer);
        state.typing = false;
      }
    }, 26);
  }

  function completeType() {
    if (!state.typing) return false;
    clearInterval(state.typeTimer);
    $("vn-text").textContent = state.fullText;
    state.typing = false;
    return true;
  }

  function finishScene() {
    if (state.pendingGoto) {
      const g = state.pendingGoto;
      state.pendingGoto = null;
      startScene(g);
      return;
    }
    enterExplore();
  }

  function enterExplore() {
    state.mode = "explore";
    state.scene = null;
    showScreen("screen-explore");
    $("vn-choices").innerHTML = "";
    refreshNpcs();
    $("hud-loc").textContent = locName(state.mapId);
    updateHud();
    if (state._syncMobileCtl) state._syncMobileCtl();
  }

  function showEnding(ending) {
    state.mode = "ending";
    if (ending.char) {
      state.flags["ending_" + ending.id] = true;
      state.affection[ending.id] = Math.max(state.affection[ending.id] || 0, 15);
    }
    const bgMap = {
      sakura: "assets/bg/courtyard.png",
      nagi: "assets/bg/library.png",
      reina: "assets/bg/rooftop.png",
      hiyori: "assets/bg/rooftop.png",
      alone: "assets/bg/gate.png",
    };
    $("ending-bg").style.backgroundImage = `url('${bgMap[ending.id] || "assets/bg/courtyard.png"}')`;
    $("ending-title").textContent = ending.title;
    $("ending-text").textContent = ending.text;
    showScreen("screen-ending");
  }

  function updateHud() {
    $("hud-day").textContent = "第 " + state.day + " 天";
    $("hud-time").textContent = GAME.PHASE_LABELS[state.phase] || state.phase;
    $("hud-loc").textContent = locName(state.mapId);
    updateRosterHud();
  }

  function renderAffection() {
    const list = $("affection-list");
    list.innerHTML = "";
    Object.values(GAME.CHARACTERS).forEach((c) => {
      const val = state.affection[c.id] || 0;
      const pct = Math.min(100, (val / 20) * 100);
      const row = document.createElement("div");
      row.className = "aff-item";
      row.innerHTML = `
        <img class="aff-avatar" src="${c.portrait}" alt="${c.name}" />
        <div class="aff-info">
          <div class="aff-name">${c.name}</div>
          <div class="aff-bar-bg"><div class="aff-bar" style="width:${pct}%"></div></div>
        </div>
        <div class="aff-val">${val}</div>
      `;
      list.appendChild(row);
    });
  }

  function renderCampusMap() {
    const wrap = $("campus-map");
    wrap.innerHTML = "";
    // schematic rooms
    const rooms = [
      { name: "教学楼", x: 50, y: 18 },
      { name: "中庭", x: 50, y: 45 },
      { name: "食堂", x: 15, y: 55 },
      { name: "体育馆", x: 85, y: 55 },
      { name: "学生会", x: 10, y: 25 },
      { name: "鞋柜", x: 85, y: 85 },
      { name: "校门", x: 50, y: 90 },
    ];
    rooms.forEach((r) => {
      const el = document.createElement("div");
      el.className = "map-spot";
      el.style.left = r.x + "%";
      el.style.top = r.y + "%";
      el.textContent = r.name;
      wrap.appendChild(el);
    });
    if (state.mapId !== "outdoor") {
      const ind = document.createElement("div");
      ind.className = "map-spot you";
      ind.style.left = "50%";
      ind.style.top = "55%";
      ind.textContent = "在 " + locName(state.mapId);
      wrap.appendChild(ind);
    } else {
      const m = map();
      const px = (state.player.x / (m.w * TILE)) * 100;
      const py = (state.player.y / (m.h * TILE)) * 100;
      const you = document.createElement("div");
      you.className = "map-dot you";
      you.style.left = px + "%";
      you.style.top = py + "%";
      wrap.appendChild(you);
    }
    Object.keys(GAME.CHARACTERS).forEach((id) => {
      const loc = getNpcLocation(id);
      const mapId = (NPC_MAP[id] && NPC_MAP[id][loc]) || "outdoor";
      const pos = mapId === "outdoor" ? { x: 50, y: 45 } : { x: 50, y: 55 };
      // rough
      const d = document.createElement("div");
      d.className = "map-dot " + id;
      if (mapId === "outdoor") {
        if (loc === "gate") { d.style.left = "50%"; d.style.top = "88%"; }
        else if (loc === "classroom") { d.style.left = "48%"; d.style.top = "20%"; }
        else if (loc === "cafeteria") { d.style.left = "15%"; d.style.top = "55%"; }
        else if (loc === "courtyard") { d.style.left = id === "sakura" ? "40%" : "60%"; d.style.top = "48%"; }
        else { d.style.left = "50%"; d.style.top = "45%"; }
      } else {
        d.style.left = "50%";
        d.style.top = "58%";
      }
      wrap.appendChild(d);
    });
  }

  /* ---------- Input ---------- */
  function panelOpen() {
    return !!document.querySelector(".panel.active");
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    state.keys[k] = true;
    if (state.mode === "vn") {
      if (k === " " || k === "enter" || k === "e") {
        e.preventDefault();
        if (completeType()) return;
        if (!state.choiceOpen) advanceLine();
      }
      return;
    }
    if (state.mode === "explore") {
      if (k === "e" || k === " " || k === "enter") {
        e.preventDefault();
        interact();
      }
      if (k === "m") {
        renderCampusMap();
        showPanel("panel-map", true);
      }
      if (k === "tab") {
        e.preventDefault();
        renderAffection();
        showPanel("panel-affection", true);
      }
      if (k === "escape") {
        showPanel("panel-map", false);
        showPanel("panel-affection", false);
        showPanel("panel-menu", false);
      }
      if (k === "b") {
        state.bgmOn = !state.bgmOn;
        if (window.BGM) {
          if (state.bgmOn) window.BGM.start();
          else window.BGM.stop();
        }
        toast(state.bgmOn ? "BGM 开" : "BGM 关");
      }
      if (k === "n") {
        state.showMinimap = !state.showMinimap;
        toast(state.showMinimap ? "小地图开" : "小地图关");
      }
    }
  }
  function onKeyUp(e) {
    state.keys[e.key.toLowerCase()] = false;
  }

  function update(dt) {
    if (state.mode !== "explore" || panelOpen()) {
      if (state._syncMobileCtl) state._syncMobileCtl();
      return;
    }
    if (state._syncMobileCtl) state._syncMobileCtl();
    updateAmbient();
    let dx = 0, dy = 0;
    const k = state.keys;
    if (k["w"] || k["arrowup"]) dy -= 1;
    if (k["s"] || k["arrowdown"]) dy += 1;
    if (k["a"] || k["arrowleft"]) dx -= 1;
    if (k["d"] || k["arrowright"]) dx += 1;
    const joy = applyJoystickToMove(dx, dy);
    dx = joy.dx;
    dy = joy.dy;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const sp = PLAYER_SPEED * (dt / 16.67);
      tryMove(dx * sp, dy * sp);
      if (Math.abs(dy) >= Math.abs(dx)) state.player.dir = dy < 0 ? "up" : "down";
      else state.player.dir = dx < 0 ? "left" : "right";
      state.player.walkT += dt / 50;
    }

    updateHintText(nearbyInteract());
  }

  function loop(ts) {
    const dt = Math.min(50, ts - (state.lastTs || ts));
    state.lastTs = ts;
    if (state.mode === "explore" && state.ctx) {
      update(dt);
      drawMap(state.ctx);
    }
    requestAnimationFrame(loop);
  }

  function startBgm() {
    if (!state.bgmOn || !window.BGM) return;
    window.BGM.start();
  }

  function newGame() {
    state.day = 1;
    state.phase = "afternoon";
    state.mapId = "outdoor";
    state.affection = { sakura: 0, nagi: 0, reina: 0, hiyori: 0 };
    state.flags = {};
    state.talkedToday = {};
    state.player.x = 19 * TILE;
    state.player.y = 22 * TILE;
    state.player.dir = "up";
    state.showMinimap = true;
    startBgm();
    startScene("prologue");
  }

  function continueGame() {
    if (!loadGame()) {
      toast("没有找到存档");
      return;
    }
    startBgm();
    updateHud();
    enterExplore();
  }

  function resizeCanvas() {
    if (!state.canvas) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const cssW = Math.max(320, window.innerWidth);
    const cssH = Math.max(240, window.innerHeight);
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (state.canvas.width !== w || state.canvas.height !== h) {
      state.canvas.width = w;
      state.canvas.height = h;
    }
    state.canvas.style.width = cssW + "px";
    state.canvas.style.height = cssH + "px";
    if (state.ctx) {
      // draw in CSS pixel space; high-res buffer for sharpness
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      state.ctx.imageSmoothingEnabled = true;
      state.ctx.imageSmoothingQuality = "high";
    }
    state.cssW = cssW;
    state.cssH = cssH;
    state.dpr = dpr;
  }

  function viewSize() {
    return {
      w: state.cssW || window.innerWidth,
      h: state.cssH || window.innerHeight,
    };
  }

  function init() {
    state.canvas = $("game-canvas");
    state.ctx = state.canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    if (window.SPRITES && window.SPRITES.load) window.SPRITES.load();

    $("btn-new").addEventListener("click", () => newGame());
    $("btn-continue").addEventListener("click", () => continueGame());
    $("btn-help").addEventListener("click", () => showScreen("screen-help"));
    $("btn-help-back").addEventListener("click", () => showScreen("screen-title"));

    $("btn-map").addEventListener("click", () => {
      renderCampusMap();
      showPanel("panel-map", true);
    });
    $("btn-map-close").addEventListener("click", () => showPanel("panel-map", false));
    $("btn-affection").addEventListener("click", () => {
      renderAffection();
      showPanel("panel-affection", true);
    });
    $("btn-aff-close").addEventListener("click", () => showPanel("panel-affection", false));
    $("btn-menu").addEventListener("click", () => showPanel("panel-menu", true));
    $("btn-menu-close").addEventListener("click", () => showPanel("panel-menu", false));
    $("btn-advance").addEventListener("click", () => {
      showPanel("panel-menu", false);
      advancePhase();
      checkAutoEnding();
    });
    $("btn-save").addEventListener("click", () => saveGame());
    $("btn-load").addEventListener("click", () => {
      if (loadGame()) {
        showPanel("panel-menu", false);
        enterExplore();
        toast("已读取存档");
      } else toast("没有存档");
    });
    $("btn-to-title").addEventListener("click", () => {
      showPanel("panel-menu", false);
      showScreen("screen-title");
      state.mode = "title";
    });
    $("btn-ending-title").addEventListener("click", () => {
      showScreen("screen-title");
      state.mode = "title";
    });
    $("btn-bgm") && $("btn-bgm").addEventListener("click", () => {
      state.bgmOn = !state.bgmOn;
      if (window.BGM) {
        if (state.bgmOn) window.BGM.start();
        else window.BGM.stop();
      }
      toast(state.bgmOn ? "BGM 开" : "BGM 关");
    });

    $("vn-box").addEventListener("click", () => {
      if (completeType()) return;
      if (!state.choiceOpen) advanceLine();
    });

    // first user gesture unlocks audio
    const unlock = () => {
      startBgm();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    if (!hasSave()) $("btn-continue").style.opacity = "0.55";
    injectMobileControls();
    requestAnimationFrame(loop);
  }

  function isMobile() {
    if (typeof location !== "undefined" && /[?&]mobile=1/.test(location.search)) {
      return true;
    }
    const ua = navigator.userAgent || "";
    const coarse =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const touch =
      (navigator.maxTouchPoints || 0) > 0 ||
      typeof window.ontouchstart !== "undefined";
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Silk/i.test(ua);
    if (uaMobile && touch) return true;
    if (coarse && touch) return true;
    // narrow touch window (many Android tablets / landscape phones)
    if (touch && window.innerWidth <= 900 && window.innerHeight <= 1200) return true;
    return false;
  }

  function updateHintText(target) {
    const hint = $("interact-hint");
    if (!hint) return;
    if (!target) {
      hint.classList.remove("show");
      return;
    }
    hint.classList.add("show");
    if (target.type === "npc") {
      hint.textContent = state.isMobile
        ? "点「互动」与 " + target.npc.char.name + " 说话"
        : "按 E 与 " + target.npc.char.name + " 说话";
    } else {
      const dest = locName(target.portal.to);
      hint.textContent = state.isMobile
        ? "点「互动」前往 " + dest
        : "按 E 前往 " + dest;
    }
  }

  function applyMobileChrome() {
    if (!state.isMobile) return;
    document.body.classList.add("is-mobile");
    const titleHint = document.querySelector(".title-hint");
    if (titleHint) titleHint.textContent = "左摇杆移动 · 右侧「互动」按钮 · 顶栏可开地图";
    const help = document.querySelector("#screen-help .help-list");
    if (help) {
      help.innerHTML = `
        <li>左下 <strong>摇杆</strong> — 拖动移动角色</li>
        <li>右下 <strong>互动</strong> — 对话 / 进门</li>
        <li>右下 <strong>地图 / 菜单</strong> — 查看校园、存档、推进时间</li>
        <li>对话时点对话框继续；选项直接点选</li>
        <li>靠近粉色门口或角色后，点「互动」</li>
      `;
    }
  }

  function injectMobileControls() {
    state.isMobile = isMobile();
    applyMobileChrome();

    // remove old pad if any
    document.querySelectorAll(".touch-pad, .mobile-controls").forEach((el) => el.remove());
    if (!state.isMobile) return;

    const root = document.createElement("div");
    root.className = "mobile-controls";
    root.innerHTML = `
      <div class="mc-joy" id="mc-joy">
        <div class="mc-joy-base">
          <div class="mc-joy-knob" id="mc-joy-knob"></div>
        </div>
      </div>
      <div class="mc-actions">
        <button class="mc-btn mc-btn-map" type="button" aria-label="地图">地图</button>
        <button class="mc-btn mc-btn-menu" type="button" aria-label="菜单">菜单</button>
        <button class="mc-btn mc-btn-talk" type="button" aria-label="互动">互动</button>
      </div>
    `;
    const wrap = document.querySelector(".explore-wrap") || document.getElementById("app");
    wrap.appendChild(root);

    // virtual joystick
    const joy = root.querySelector("#mc-joy");
    const knob = root.querySelector("#mc-joy-knob");
    const base = root.querySelector(".mc-joy-base");
    let joyId = null;
    let joyCx = 0;
    let joyCy = 0;
    const joyR = 42;

    function joyReset() {
      joyId = null;
      knob.style.transform = "translate(-50%,-50%)";
      // clear analog axes
      state.keys["w"] = state.keys["a"] = state.keys["s"] = state.keys["d"] = false;
      state.joyX = 0;
      state.joyY = 0;
    }

    function joyApply(x, y) {
      const len = Math.hypot(x, y) || 1;
      const clamped = Math.min(1, len / joyR);
      const nx = (x / len) * clamped;
      const ny = (y / len) * clamped;
      knob.style.transform = `translate(calc(-50% + ${nx * joyR}px), calc(-50% + ${ny * joyR}px))`;
      state.joyX = nx;
      state.joyY = ny;
      // also set key flags for any leftover code paths
      state.keys["arrowleft"] = nx < -0.25;
      state.keys["arrowright"] = nx > 0.25;
      state.keys["arrowup"] = ny < -0.25;
      state.keys["arrowdown"] = ny > 0.25;
    }

    function joyStart(e) {
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      joyId = t.identifier != null ? t.identifier : "mouse";
      const rect = base.getBoundingClientRect();
      joyCx = rect.left + rect.width / 2;
      joyCy = rect.top + rect.height / 2;
      joyApply(t.clientX - joyCx, t.clientY - joyCy);
    }
    function joyMove(e) {
      if (joyId == null) return;
      const list = e.changedTouches ? Array.from(e.changedTouches) : [e];
      const t = list.find((x) => (x.identifier != null ? x.identifier : "mouse") === joyId) || list[0];
      if (!t) return;
      e.preventDefault();
      joyApply(t.clientX - joyCx, t.clientY - joyCy);
    }
    function joyEnd(e) {
      const list = e.changedTouches ? Array.from(e.changedTouches) : [e];
      const hit = list.some((x) => (x.identifier != null ? x.identifier : "mouse") === joyId);
      if (hit || joyId === "mouse") joyReset();
    }

    joy.addEventListener("touchstart", joyStart, { passive: false });
    joy.addEventListener("touchmove", joyMove, { passive: false });
    joy.addEventListener("touchend", joyEnd);
    joy.addEventListener("touchcancel", joyEnd);
    joy.addEventListener("mousedown", joyStart);
    window.addEventListener("mousemove", joyMove);
    window.addEventListener("mouseup", joyEnd);

    // action buttons
    root.querySelector(".mc-btn-talk").addEventListener("click", (e) => {
      e.preventDefault();
      if (state.mode === "vn") {
        if (completeType()) return;
        if (!state.choiceOpen) advanceLine();
      } else if (state.mode === "explore") {
        interact();
      }
    });
    root.querySelector(".mc-btn-map").addEventListener("click", (e) => {
      e.preventDefault();
      if (state.mode !== "explore") return;
      renderCampusMap();
      showPanel("panel-map", true);
    });
    root.querySelector(".mc-btn-menu").addEventListener("click", (e) => {
      e.preventDefault();
      if (state.mode === "explore") showPanel("panel-menu", true);
    });

    // show controls only while exploring
    const syncVis = () => {
      root.classList.toggle("show", state.mode === "explore" && !panelOpen());
    };
    state._syncMobileCtl = syncVis;
    syncVis();
  }

  // patch loop update to use joystick axes
  function applyJoystickToMove(dx, dy) {
    if (!state.isMobile) return { dx, dy };
    const jx = state.joyX || 0;
    const jy = state.joyY || 0;
    if (Math.abs(jx) > 0.12 || Math.abs(jy) > 0.12) {
      return { dx: jx, dy: jy };
    }
    return { dx, dy };
  }

  window.GAME_ENGINE = { init, state, saveGame, loadGame, advancePhase, isMobile };
})();
