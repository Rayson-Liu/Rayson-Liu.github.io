/* Campus & indoor maps */
(function () {
  "use strict";

  // Tile legend
  // 0 grass, 1 path, 2 wall, 3 tree, 4 water, 5 floor, 6 fence
  // 7 flower, 8 door/portal, 9 sakura, 10 desk, 11 shelf, 12 table
  // 13 window-wall, 14 blackboard, 15 locker, 16 counter, 17 gym-floor
  // 18 mat, 19 sofa, 20 plant, 21 stairs, 22 carpet

  function fill(m, w, h, v) {
    const arr = m || [];
    for (let y = 0; y < h; y++) {
      arr[y] = [];
      for (let x = 0; x < w; x++) arr[y][x] = v;
    }
    return arr;
  }

  function rect(m, x0, y0, x1, y1, v) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (m[y] && m[y][x] != null) m[y][x] = v;
  }

  function set(m, x, y, v) {
    if (m[y]) m[y][x] = v;
  }

  /* ===== Outdoor campus 40 x 28 ===== */
  function outdoor() {
    const W = 40, H = 28;
    const m = [];
    fill(m, W, H, 0);

    // main cross paths
    rect(m, 2, 20, 37, 21, 1);
    rect(m, 18, 6, 19, 26, 1);
    rect(m, 4, 16, 8, 17, 1);
    rect(m, 30, 16, 35, 17, 1);
    rect(m, 14, 12, 25, 13, 1);

    // main school building
    rect(m, 10, 2, 29, 8, 2);
    rect(m, 11, 5, 28, 5, 5); // interior corridor strip
    // windows on south face of building drawn via wall; doors:
    set(m, 14, 8, 8); set(m, 15, 8, 8); // classroom
    set(m, 22, 8, 8); set(m, 23, 8, 8); // hallway
    set(m, 11, 5, 8); set(m, 28, 5, 8); // library from hall
    set(m, 16, 2, 8); set(m, 23, 2, 8); // rooftop stairs

    // gym (east)
    rect(m, 32, 12, 38, 18, 2);
    set(m, 34, 18, 8); set(m, 35, 18, 8);

    // cafeteria (west)
    rect(m, 1, 12, 7, 18, 2);
    set(m, 3, 18, 8); set(m, 4, 18, 8);

    // student council annex
    rect(m, 1, 4, 5, 7, 2);
    set(m, 3, 7, 8);

    // shoe locker entrance building near gate
    rect(m, 32, 23, 37, 26, 2);
    set(m, 34, 23, 8);

    // fountain
    set(m, 18, 15, 4); set(m, 19, 15, 4);
    set(m, 18, 16, 4); set(m, 19, 16, 4);

    // trees
    [
      [8, 3], [9, 4], [30, 3], [31, 4],
      [3, 9], [36, 9], [3, 24], [36, 22],
      [12, 18], [27, 18], [12, 24], [27, 24],
      [8, 10], [31, 10],
    ].forEach(([x, y]) => set(m, x, y, 3));

    // sakura
    [
      [10, 11], [14, 11], [25, 11], [29, 11],
      [10, 14], [29, 14], [16, 18], [23, 18],
      [8, 15], [31, 15], [7, 12], [32, 12],
      [13, 19], [26, 19], [17, 10], [22, 10],
      [6, 20], [33, 20],
    ].forEach(([x, y]) => set(m, x, y, 9));

    // flowers
    for (let i = 0; i < 20; i++) {
      const x = 6 + (i % 10) * 2.5;
      const y = 22 + Math.floor(i / 10);
      if (m[y] && m[Math.floor(x)] && m[Math.floor(y)][Math.floor(x)] === 0)
        set(m, Math.floor(x), Math.floor(y), 7);
    }

    // fence border
    for (let x = 0; x < W; x++) { set(m, x, 0, 6); set(m, x, H - 1, 6); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 6); set(m, W - 1, y, 6); }
    set(m, 18, H - 1, 8); set(m, 19, H - 1, 8); // gate

    return { w: W, h: H, tiles: m, id: "outdoor", name: "校园" };
  }

  /* ===== Indoor generators ===== */
  function classroom() {
    const W = 16, H = 12;
    const m = fill([], W, H, 5);
    // walls
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    // windows north
    for (let x = 2; x < W - 2; x += 2) set(m, x, 0, 13);
    // blackboard south wall
    rect(m, 4, H - 1, 11, H - 1, 14);
    // desks 3 cols x 3 rows
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        set(m, 3 + c * 3, 3 + r * 2, 10);
        set(m, 4 + c * 3, 3 + r * 2, 10);
      }
    }
    // teacher desk
    set(m, 7, 9, 10); set(m, 8, 9, 10);
    // door exit bottom
    set(m, 7, H - 1, 8);
    set(m, 8, H - 1, 8);
    // plants
    set(m, 1, 1, 20); set(m, W - 2, 1, 20);
    return { w: W, h: H, tiles: m, id: "classroom", name: "教室", indoor: true };
  }

  function library() {
    const W = 18, H = 13;
    const m = fill([], W, H, 5);
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    // shelves
    for (let y = 2; y <= 8; y += 2) {
      rect(m, 2, y, 6, y, 11);
      rect(m, 11, y, 15, y, 11);
    }
    // reading tables
    set(m, 8, 4, 12); set(m, 9, 4, 12);
    set(m, 8, 7, 12); set(m, 9, 7, 12);
    set(m, 8, 10, 12); set(m, 9, 10, 12);
    // carpet center
    rect(m, 7, 3, 10, 10, 22);
    // windows
    for (let x = 3; x < 15; x += 3) set(m, x, 0, 13);
    // door
    set(m, 8, H - 1, 8); set(m, 9, H - 1, 8);
    set(m, 1, 1, 20); set(m, W - 2, 1, 20);
    return { w: W, h: H, tiles: m, id: "library", name: "图书室", indoor: true };
  }

  function hallway() {
    const W = 20, H = 8;
    const m = fill([], W, H, 5);
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    // windows north
    for (let x = 2; x < W - 2; x += 2) set(m, x, 0, 13);
    // lockers south
    for (let x = 2; x < W - 2; x++) set(m, x, H - 2, 15);
    // exit doors
    set(m, 2, H - 1, 8); set(m, 3, H - 1, 8); // outdoor
    set(m, 9, 0, 8); // to classroom
    set(m, 16, 0, 8); // to library
    set(m, 18, H - 1, 8); // rooftop stairs
    // plants
    set(m, 5, 2, 20); set(m, 12, 2, 20);
    return { w: W, h: H, tiles: m, id: "hallway", name: "走廊", indoor: true };
  }

  function cafeteria() {
    const W = 18, H = 12;
    const m = fill([], W, H, 5);
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    // serving counter
    rect(m, 2, 1, 8, 1, 16);
    // tables
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        set(m, 4 + c * 4, 4 + r * 2, 12);
        set(m, 5 + c * 4, 4 + r * 2, 12);
      }
    }
    // windows
    for (let x = 3; x < 15; x += 3) set(m, x, 0, 13);
    set(m, 8, H - 1, 8); set(m, 9, H - 1, 8);
    set(m, 1, 1, 20); set(m, W - 2, 1, 20);
    return { w: W, h: H, tiles: m, id: "cafeteria", name: "食堂", indoor: true };
  }

  function gym() {
    const W = 18, H = 14;
    const m = fill([], W, H, 17);
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    // court mats
    rect(m, 4, 3, 13, 10, 18);
    // windows high
    for (let x = 2; x < W - 2; x += 2) set(m, x, 0, 13);
    set(m, 8, H - 1, 8); set(m, 9, H - 1, 8);
    return { w: W, h: H, tiles: m, id: "gym", name: "体育馆", indoor: true };
  }

  function rooftop() {
    const W = 16, H = 12;
    const m = fill([], W, H, 5);
    // fence
    for (let x = 0; x < W; x++) { set(m, x, 0, 6); set(m, x, H - 1, 6); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 6); set(m, W - 1, y, 6); }
    // open sky area is floor; water tower
    set(m, 3, 3, 2); set(m, 4, 3, 2); set(m, 3, 4, 2); set(m, 4, 4, 2);
    // plants
    set(m, 12, 3, 20); set(m, 13, 8, 20); set(m, 2, 9, 20);
    // stairs exit
    set(m, 7, H - 1, 8); set(m, 8, H - 1, 8);
    // some floor variation
    rect(m, 6, 5, 10, 8, 22);
    return { w: W, h: H, tiles: m, id: "rooftop", name: "屋顶", indoor: true };
  }

  function council() {
    const W = 12, H = 10;
    const m = fill([], W, H, 5);
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    rect(m, 2, 2, 9, 7, 22);
    // long table
    set(m, 4, 4, 12); set(m, 5, 4, 12); set(m, 6, 4, 12); set(m, 7, 4, 12);
    set(m, 4, 5, 12); set(m, 5, 5, 12); set(m, 6, 5, 12); set(m, 7, 5, 12);
    // sofa
    set(m, 2, 2, 19); set(m, 3, 2, 19);
    set(m, 2, 8, 19); set(m, 3, 8, 19);
    set(m, 9, 2, 19);
    // windows
    for (let x = 2; x < 10; x += 2) set(m, x, 0, 13);
    set(m, 5, H - 1, 8); set(m, 6, H - 1, 8);
    set(m, 1, 1, 20); set(m, W - 2, 1, 20);
    return { w: W, h: H, tiles: m, id: "council", name: "学生会室", indoor: true };
  }

  function lockers() {
    const W = 12, H = 8;
    const m = fill([], W, H, 5);
    for (let x = 0; x < W; x++) { set(m, x, 0, 2); set(m, x, H - 1, 2); }
    for (let y = 0; y < H; y++) { set(m, 0, y, 2); set(m, W - 1, y, 2); }
    for (let x = 1; x < W - 1; x++) set(m, x, 1, 15);
    set(m, 5, H - 1, 8); set(m, 6, H - 1, 8);
    return { w: W, h: H, tiles: m, id: "lockers", name: "鞋柜处", indoor: true };
  }

  const MAPS = {
    outdoor: outdoor(),
    classroom: classroom(),
    library: library(),
    hallway: hallway(),
    cafeteria: cafeteria(),
    gym: gym(),
    rooftop: rooftop(),
    council: council(),
    lockers: lockers(),
  };

  /* Portals per map: from tile -> dest map + spawn */
  const PORTALS = {
    outdoor: [
      { x: 14, y: 8, to: "classroom", spawn: [7, 10] },
      { x: 15, y: 8, to: "classroom", spawn: [8, 10] },
      { x: 22, y: 8, to: "hallway", spawn: [3, 6] },
      { x: 23, y: 8, to: "hallway", spawn: [4, 6] },
      { x: 34, y: 18, to: "gym", spawn: [8, 12] },
      { x: 35, y: 18, to: "gym", spawn: [9, 12] },
      { x: 3, y: 18, to: "cafeteria", spawn: [8, 10] },
      { x: 4, y: 18, to: "cafeteria", spawn: [9, 10] },
      { x: 3, y: 7, to: "council", spawn: [5, 8] },
      { x: 34, y: 23, to: "lockers", spawn: [5, 6] },
      { x: 18, y: 27, to: "outdoor", spawn: [18, 25] },
      { x: 19, y: 27, to: "outdoor", spawn: [19, 25] },
    ],
    classroom: [
      { x: 7, y: 11, to: "hallway", spawn: [9, 2] },
      { x: 8, y: 11, to: "hallway", spawn: [10, 2] },
    ],
    library: [
      { x: 8, y: 12, to: "hallway", spawn: [16, 2] },
      { x: 9, y: 12, to: "hallway", spawn: [17, 2] },
    ],
    hallway: [
      { x: 2, y: 7, to: "outdoor", spawn: [22, 10] },
      { x: 3, y: 7, to: "outdoor", spawn: [23, 10] },
      { x: 9, y: 0, to: "classroom", spawn: [7, 10] },
      { x: 16, y: 0, to: "library", spawn: [8, 11] },
      { x: 18, y: 7, to: "rooftop", spawn: [7, 10] },
    ],
    cafeteria: [
      { x: 8, y: 11, to: "outdoor", spawn: [4, 20] },
      { x: 9, y: 11, to: "outdoor", spawn: [5, 20] },
    ],
    gym: [
      { x: 8, y: 13, to: "outdoor", spawn: [34, 20] },
      { x: 9, y: 13, to: "outdoor", spawn: [35, 20] },
    ],
    rooftop: [
      { x: 7, y: 11, to: "hallway", spawn: [18, 6] },
      { x: 8, y: 11, to: "hallway", spawn: [18, 6] },
    ],
    council: [
      { x: 5, y: 9, to: "outdoor", spawn: [3, 9] },
      { x: 6, y: 9, to: "outdoor", spawn: [4, 9] },
    ],
    lockers: [
      { x: 5, y: 7, to: "outdoor", spawn: [34, 25] },
      { x: 6, y: 7, to: "outdoor", spawn: [35, 25] },
    ],
  };

  /* Outdoor label spots */
  const OUTDOOR_LABELS = [
    { x: 19.5, y: 1.2, label: "教学楼" },
    { x: 19.5, y: 14.2, label: "喷泉" },
    { x: 4.0, y: 14.5, label: "食堂" },
    { x: 35.0, y: 14.5, label: "体育馆" },
    { x: 3.0, y: 5.2, label: "学生会" },
    { x: 34.5, y: 24.2, label: "鞋柜" },
    { x: 19.5, y: 25.8, label: "校门" },
    { x: 19.5, y: 10.5, label: "中庭" },
  ];

  window.MAPS = { get: (id) => MAPS[id] || MAPS.outdoor, PORTALS, OUTDOOR_LABELS, MAPS };
})();
