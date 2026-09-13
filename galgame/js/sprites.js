/* High-res map sprites — portrait head + detailed body */
(function () {
  "use strict";

  const IMAGES = {};
  let loaded = false;

  const BODY = {
    sakura: { body: "#2c3a5c", trim: "#f5ebe0", skirt: "#2c3a5c", ribbon: "#c04040", cardigan: "#f5ebe0" },
    nagi: { body: "#1e2a44", trim: "#f0e8dc", skirt: "#2c3a5c", ribbon: "#1e2a44", cardigan: null },
    reina: { body: "#1e2a44", trim: "#c04050", skirt: "#1e2a44", ribbon: "#c04050", cardigan: null, armband: true },
    hiyori: { body: "#6b8c7a", trim: "#f0e8dc", skirt: "#6b8c7a", ribbon: "#6b8c7a", cardigan: null },
    player: { body: "#3d5a80", trim: "#2c3a5c", skirt: null, ribbon: null, cardigan: null },
  };

  const FACE = {
    sakura: { x: 0.28, y: 0.14, s: 0.42 },
    nagi: { x: 0.30, y: 0.18, s: 0.40 },
    reina: { x: 0.28, y: 0.14, s: 0.40 },
    hiyori: { x: 0.28, y: 0.15, s: 0.40 },
  };

  function load() {
    if (loaded) return;
    loaded = true;
    if (typeof GAME === "undefined" || !GAME.CHARACTERS) return;
    Object.keys(GAME.CHARACTERS).forEach((id) => {
      const img = new Image();
      img.src = GAME.CHARACTERS[id].portrait;
      IMAGES[id] = img;
    });
  }

  function drawPlayerFace(ctx, cx, cy, r) {
    // soft detailed player head
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, r * 0.2, cx, cy, r);
    g.addColorStop(0, "#f8dcc4");
    g.addColorStop(1, "#f0c8a8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // hair
    ctx.fillStyle = "#4a3728";
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.12, r, Math.PI * 0.95, Math.PI * 0.05);
    ctx.fill();
    ctx.fillRect(cx - r, cy - r * 0.15, r * 2, r * 0.38);
    ctx.fillStyle = "#6b5040";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.25, cy - r * 0.55, r * 0.35, r * 0.18, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = "#2a2030";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.32, cy + r * 0.08, r * 0.12, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.32, cy + r * 0.08, r * 0.12, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx - r * 0.32, cy + r * 0.02, r * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * 0.32, cy + r * 0.02, r * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // mouth
    ctx.strokeStyle = "#c08080";
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.35, r * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  function drawPortraitHead(ctx, id, cx, cy, r) {
    const img = IMAGES[id];
    if (id === "player" || !img || !img.complete || !img.naturalWidth) {
      drawPlayerFace(ctx, cx, cy, r);
    } else {
      const f = FACE[id] || FACE.sakura;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const side = Math.min(iw, ih) * f.s;
      const sx = iw * f.x;
      const sy = ih * f.y;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }
    // soft rim
    const rim = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(1, "rgba(255,255,255,0.25)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(61,44,78,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawBody(ctx, id, cx, feetY, s, walkT) {
    const st = BODY[id] || BODY.player;
    const bob = walkT ? Math.sin(walkT * 2) * 1.2 : 0;
    const y = feetY + bob;
    const swing = walkT ? Math.sin(watchWalk(walkT)) : 0;

    function watchWalk(w) {
      return w * 2;
    }

    // shadow
    const sh = ctx.createRadialGradient(cx, y, 1, cx, y, 14 * s);
    sh.addColorStop(0, "rgba(40,20,50,0.22)");
    sh.addColorStop(1, "rgba(40,20,50,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(cx, y + 2, 12 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    const legSwing = swing * 3 * s;
    ctx.fillStyle = "#2a3550";
    roundRect(ctx, cx - 6 * s, y - 10 * s + legSwing * 0.3, 4.5 * s, 10 * s - legSwing * 0.2, 1.5 * s);
    ctx.fill();
    roundRect(ctx, cx + 1.5 * s, y - 10 * s - legSwing * 0.3, 4.5 * s, 10 * s + legSwing * 0.2, 1.5 * s);
    ctx.fill();
    // shoes
    ctx.fillStyle = "#3a2a28";
    ctx.fillRect(cx - 7 * s, y - 2 * s, 6 * s, 2.5 * s);
    ctx.fillRect(cx + 1 * s, y - 2 * s, 6 * s, 2.5 * s);

    // skirt
    if (st.skirt) {
      ctx.fillStyle = st.skirt;
      ctx.beginPath();
      ctx.moveTo(cx - 11 * s, y - 10 * s);
      ctx.lineTo(cx + 11 * s, y - 10 * s);
      ctx.lineTo(cx + 8 * s, y - 20 * s);
      ctx.lineTo(cx - 8 * s, y - 20 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(cx - 8 * s, y - 18 * s, 16 * s, 2 * s);
    }

    // torso
    const top = y - 36 * s;
    if (st.cardigan) {
      ctx.fillStyle = st.cardigan;
      roundRect(ctx, cx - 10 * s, top, 20 * s, 20 * s, 3 * s);
      ctx.fill();
      ctx.fillStyle = st.body;
      ctx.fillRect(cx - 5 * s, top + 2 * s, 10 * s, 16 * s);
    } else {
      ctx.fillStyle = st.body;
      roundRect(ctx, cx - 10 * s, top, 20 * s, 20 * s, 3 * s);
      ctx.fill();
    }
    // sailor / trim
    ctx.fillStyle = st.trim;
    ctx.beginPath();
    ctx.moveTo(cx - 9 * s, top + 1 * s);
    ctx.lineTo(cx, top + 10 * s);
    ctx.lineTo(cx + 9 * s, top + 1 * s);
    ctx.lineTo(cx + 7 * s, top);
    ctx.lineTo(cx, top + 7 * s);
    ctx.lineTo(cx - 7 * s, top);
    ctx.closePath();
    ctx.fill();
    if (st.ribbon) {
      ctx.fillStyle = st.ribbon;
      ctx.beginPath();
      ctx.moveTo(cx, top + 8 * s);
      ctx.lineTo(cx - 7 * s, top + 5 * s);
      ctx.lineTo(cx - 5 * s, top + 12 * s);
      ctx.lineTo(cx, top + 10 * s);
      ctx.lineTo(cx + 5 * s, top + 12 * s);
      ctx.lineTo(cx + 7 * s, top + 5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, top + 9 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (st.armband) {
      ctx.fillStyle = "#c04050";
      ctx.fillRect(cx - 10 * s, top + 8 * s, 4 * s, 7 * s);
    }

    // arms
    const arm = swing * 4 * s;
    ctx.fillStyle = st.cardigan || st.body;
    roundRect(ctx, cx - 13 * s, top + 3 * s + arm, 5 * s, 14 * s, 2 * s);
    ctx.fill();
    roundRect(ctx, cx + 8 * s, top + 3 * s - arm, 5 * s, 14 * s, 2 * s);
    ctx.fill();
    // hands
    ctx.fillStyle = "#f5d0b0";
    ctx.beginPath();
    ctx.arc(cx - 10.5 * s, top + 18 * s + arm, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 10.5 * s, top + 18 * s - arm, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function draw(ctx, id, cx, feetY, scale, dir, walkT) {
    load();
    const s = scale || 1;
    const headR = 16 * s;
    const bob = walkT ? Math.sin(walkT * 2) * 1.2 : 0;
    const headY = feetY - 40 * s + bob;
    drawBody(ctx, id, cx, feetY, s, walkT);
    drawPortraitHead(ctx, id, cx, headY, headR);
  }

  function drawPortraitThumb(ctx, id, x, y, size) {
    load();
    drawPortraitHead(ctx, id, x + size / 2, y + size / 2, size / 2);
  }

  window.SPRITES = {
    draw,
    load,
    drawPortraitThumb,
    BODY,
    get ready() {
      return Object.keys(IMAGES).every(
        (k) => IMAGES[k] && IMAGES[k].complete && IMAGES[k].naturalWidth > 0
      );
    },
  };
})();
