// Round 4 (owner direction): buildings centred on their tile, cozy-steampunk variety, varied heights,
// a road ring around every building, and a dense "cozy metropolis" far frame.
(function (g) {
  const K = g.KIT, K2 = g.KIT2, PC = g.PIECES;
  const OLD2 = g.M2;
  const FONT = PC.FONT, ink = '#6b5a73';
  const svg = (W, H, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${K.defs()}${K2.defs2()}${inner}</svg>`;
  const plate = PC.plate, frost = PC.frost;

  // ---- tile lookups for a projected plate set ('mid' | 'wide' | 'ipad')
  function grid(set) {
    const m = new Map(g.TILES[set].map(([q, r, x, y]) => [q + ',' + r, [x, y]]));
    const c = m.get('-2,10'), e = m.get('-1,10');
    const sp = Math.abs(e[0] - c[0]);
    return { at: (q, r) => m.get(q + ',' + r) || null, sp, s: (0.82 * sp) / 76, has: (q, r) => m.has(q + ',' + r) };
  }
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  const hexDist = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[0] + a[1] - b[0] - b[1]) + Math.abs(a[1] - b[1])) / 2;

  // ---- building catalogue
  const B = {
    windmill2: (st) => K2.windmill({ level: 2, state: st }), windmill1: (st) => K2.windmill({ level: 1, state: st }),
    sorter: (st) => K2.sorter({ state: st }), depot: (st) => K2.depot({ state: st }), bench: (st) => K2.bench({ state: st }),
    beacon: (st) => K2.beacon({ state: st }), clock: (st) => K2.clockTower({ state: st }), greenhouse: (st) => K2.greenhouse({ state: st }),
    tank: (st) => K2.waterTank({ state: st }), workshop: (st) => K2.workshop({ state: st }),
    houseA: (st) => K2.cottage({ state: st, c: 'teal', r: 'red', h: 30 }), houseB: (st) => K2.cottage({ state: st, c: 'cream', r: 'verd', h: 26, chim: 'pipe' }),
    houseC: (st) => K2.cottage({ state: st, c: 'mustard', r: 'slate', h: 32 }), houseD: (st) => K2.cottage({ state: st, c: 'sage', r: 'red', h: 28, w: 20 }),
    townA: (st) => K2.townhouse({ state: st, c: 'plum', r: 'slate' }), townB: (st) => K2.townhouse({ state: st, c: 'teal', r: 'red' }),
  };

  // roads: a ring around every building and a link to each neighbouring building tile
  function roads(G, list, extraTiles = []) {
    const set = new Set(list.map(([q, r]) => q + ',' + r)), ex = new Set(extraTiles.map(([q, r]) => q + ',' + r));
    const rx = 0.41 * G.sp, ry = 0.235 * G.sp, wd = Math.max(2.2, 0.075 * G.sp);
    let s = '';
    for (const [q, r] of list) {
      const c = G.at(q, r); if (!c) continue;
      for (const [dq, dr] of NB) {
        const k = (q + dq) + ',' + (r + dr);
        if ((set.has(k) || ex.has(k)) && (q + dq > q || (q + dq === q && r + dr > r))) { const n = G.at(q + dq, r + dr); if (n) s += K2.roadLink(c[0], c[1], n[0], n[1], wd); }
      }
    }
    for (const [q, r] of list) { const c = G.at(q, r); if (c) s += K2.roadRing(c[0], c[1] + 1, rx, ry, wd); }
    return s;
  }
  const place = (G, q, r, art, k = 1) => { const c = G.at(q, r); return c ? `<g transform="translate(${c[0]} ${c[1] + 3}) scale(${G.s * k})">${art}</g>` : ''; };
  function buildings(G, list, state = 'lit', skip = null) {
    return list.slice().sort((a, b) => (G.at(a[0], a[1])?.[1] || 0) - (G.at(b[0], b[1])?.[1] || 0)).map(([q, r, t, k, st]) => place(G, q, r, B[t](st || state), k || 1)).join('');
  }

  // scalable wire posts
  function post(lit, s) {
    return `<g transform="scale(${s})"><ellipse cx="2" cy="2" rx="9" ry="3" fill="#3b2a52" opacity=".22"/><rect x="-3" y="-30" width="6" height="30" rx="2.5" fill="url(#gWood)" stroke="${K.C.woodLo}" stroke-width="1"/><rect x="-9" y="-28" width="18" height="4" rx="2" fill="url(#gWood)" stroke="${K.C.woodLo}" stroke-width=".8"/><circle cx="-7" cy="-31" r="3" fill="${lit ? '#fff3b8' : '#cfe0ef'}" stroke="${K.C.brassLo}" stroke-width="1"/><circle cx="7" cy="-31" r="3" fill="${lit ? '#fff3b8' : '#cfe0ef'}" stroke="${K.C.brassLo}" stroke-width="1"/><path d="M-4 -34 Q0 -39 4 -34 Q0 -32 -4 -34Z" fill="#fff"/></g>`;
  }
  function wire(pts, litFlags, s) {
    let w = '', p = '';
    const top = (a) => [a[0], a[1] - 31 * s];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = top(pts[i]), b = top(pts[i + 1]), lit = litFlags[i];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + 8 * s;
      if (lit) w += `<path d="M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}" fill="none" stroke="${K.C.glow}" stroke-width="${6 * s}" opacity=".55" filter="url(#soft)"/>`;
      w += `<path d="M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}" fill="none" stroke="${lit ? '#fff0b0' : '#7f8da0'}" stroke-width="${2.2 * s}" stroke-linecap="round"/>`;
    }
    const order = [...pts.keys()].sort((i, j) => pts[i][1] - pts[j][1]);
    p = order.map((i) => `<g transform="translate(${pts[i][0]} ${pts[i][1]})">${post(i === 0 ? litFlags[0] : litFlags[i - 1] || litFlags[i], s)}</g>`).join('');
    return p + w;
  }
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  // ------------------------------------------------------ the town layout (mid/wide/ipad share tile coordinates)
  const TOWN = [
    [-2, 8, 'windmill2'], [-1, 8, 'beacon'], [0, 8, 'windmill1'],
    [-3, 9, 'houseA'], [-2, 9, 'bench'],
    [-3, 10, 'sorter'], [-1, 10, 'depot'],
    [-3, 11, 'houseB'], [-2, 11, 'houseC'], [-1, 11, 'workshop'],
  ];
  function scene(set, plateName, W, H, { night = false, wind = null, town = TOWN, rails = false } = {}) {
    const G = grid(set);
    const bg = plate(plateName, W, H) + frost(W, H, night);
    const inner = roads(G, town.map(([q, r]) => [q, r])) + buildings(G, town, 'lit');
    return { G, svg: bg + (wind || '') + (night ? `<g style="filter:brightness(.82) saturate(.95)">${inner}</g>` + nightLight(G, town) : inner) };
  }
  function nightLight(G, town) {
    let s = '<g style="mix-blend-mode:screen">';
    for (const [q, r, t] of town) {
      const c = G.at(q, r); if (!c) continue;
      const hgt = { windmill2: 40, windmill1: 32, beacon: 98, clock: 70, townA: 36, townB: 36 }[t] || 15;
      s += `<circle cx="${c[0]}" cy="${c[1] - hgt * G.s * 0.45}" r="${(t === 'beacon' ? 20 : 26) * G.s}" fill="url(#gGlow)" opacity=".8"/>`;
    }
    const b = town.find((x) => x[2] === 'beacon');
    if (b) { const c = G.at(b[0], b[1]); s += `<ellipse cx="${c[0]}" cy="${c[1] - 10 * G.s}" rx="${2.1 * G.sp}" ry="${1.2 * G.sp}" fill="url(#gCone2)"/><circle cx="${c[0]}" cy="${c[1] - 100 * G.s}" r="${34 * G.s}" fill="url(#gGlow)"/>`; }
    return s + '</g>';
  }

  // ------------------------------------------------------------- the cozy metropolis
  function metropolis(set, plateName, W, H, radius, { night = false } = {}) {
    const G = grid(set), center = [-2, 10];
    const tiles = []; for (let q = -12; q <= 8; q++) for (let r = 0; r <= 20; r++) if (G.has(q, r) && hexDist([q, r], center) <= radius) tiles.push([q, r]);
    const hash = (q, r) => { let h = (q * 73856093) ^ (r * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
    const pool = [['houseA', 9], ['houseB', 8], ['houseC', 8], ['houseD', 8], ['workshop', 7], ['townA', 7], ['townB', 6], ['greenhouse', 4], ['tank', 3], ['windmill1', 4], ['windmill2', 2], ['beacon', 3], ['sorter', 5], ['depot', 2], ['bench', 3], ['clock', 2]];
    const total = pool.reduce((a, [, w]) => a + w, 0);
    const list = [];
    for (const [q, r] of tiles) {
      const h = hash(q, r); if (h < 0.1 && hexDist([q, r], center) > 0) continue; // a few quiet tiles keep their trees
      let x = hash(r + 7, q + 3) * total, t = pool[0][0]; for (const [n, w] of pool) { x -= w; if (x <= 0) { t = n; break; } }
      // tall things toward the back (smaller r on screen = further), squat in front
      list.push([q, r, t]);
    }
    // a clock tower in the middle
    const mid = list.findIndex(([q, r]) => q === -2 && r === 9); if (mid >= 0) list[mid][2] = 'clock';
    const bg = plate(plateName, W, H) + frost(W, H, night);
    const inner = roads(G, list) + buildings(G, list, 'lit');
    return bg + (night ? `<g style="filter:brightness(.82)">${inner}</g>` + nightLight(G, list) : inner);
  }

  // -------------------------------------------------------------- UI bits (copied from round 2)
  const topBar = (W, label) => `<g><rect x="12" y="66" width="${W - 24}" height="44" rx="22" fill="#fff" opacity=".95" stroke="#eadff0" stroke-width="2"/><text x="${W / 2}" y="94" text-anchor="middle" font-size="15" font-weight="800" fill="${ink}">${label}</text></g>`;
  const hudStrip = (W, H, text, sub) => `<g><rect x="16" y="${H - 118}" width="${W - 32}" height="76" rx="26" fill="#fff" opacity=".96" stroke="#eadff0" stroke-width="2"/><text x="${W / 2}" y="${H - 84}" text-anchor="middle" font-size="16" font-weight="800" fill="${ink}">${text}</text><text x="${W / 2}" y="${H - 62}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#8c7b94">${sub}</text></g>`;
  const bubble = PC.bubble;
  const bubbleBelow = (x, y, t, shift = 0) => { const w = t.length * 6.9 + 26; return `<g transform="translate(${x} ${y})"><rect x="${shift - w / 2}" y="18" width="${w}" height="32" rx="16" fill="#fff1d6" stroke="${K.C.brassLo}" stroke-width="1.5"/><path d="M-8 19 L0 3 L8 19Z" fill="#fff1d6" stroke="${K.C.brassLo}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-6.5 18.5 h13" stroke="#fff1d6" stroke-width="3"/><text x="${shift}" y="39" text-anchor="middle" font-size="12.5" font-weight="800" fill="#7a4b12">${t}</text></g>`; };
  const txt = (x, y, t, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 14}" font-weight="${o.fw || 700}" fill="${o.fill || ink}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''}>${t}</text>`;

  // =========================================================== M1
  const windFor = (set, G, W, H, y1) => PC.windField(196, 400, 300 * (G.sp / 76 * 0.9 + 0.1), 280, 0, 0, W, y1, 62 * Math.max(0.8, G.sp / 76));
  g.M1 = {
    zoomday() { const W = 393, H = 852; return svg(W, H, scene('mid', 'mid', W, H).svg); },
    wide() { const W = 393, H = 852; return svg(W, H, scene('wide', 'wide', W, H).svg); },
    zoomwind() { const W = 393, H = 852, G = grid('mid'); return svg(W, H, scene('mid', 'mid', W, H, { wind: PC.windField(200, 420, 360, 520, 0, 0, W, 700, 64) }).svg); },
    farwind() { const W = 393, H = 852; return svg(W, H, scene('wide', 'wide', W, H, { wind: PC.windField(214, 400, 300, 280, 0, 0, W, 690, 62) }).svg); },
    wind() { const W = 393, H = 852;
      const sc = scene('wide', 'wide', W, H);
      const defsB = `<defs><linearGradient id="fadeV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` + [0, 1, 2].map((i) => `<mask id="mb${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="${i * 230 - 28}" width="${W}" height="286" fill="${i === 0 ? '#fff' : 'url(#fadeV)'}"/></mask>`).join('') + `</defs>`;
      const lab = (y, t) => { const w = t.length * 8 + 28; return `<g transform="translate(${W - 16 - w} ${y})"><rect width="${w}" height="30" rx="15" fill="#fff" opacity=".95" stroke="#eadff0" stroke-width="1.5"/><text x="${w / 2}" y="20" text-anchor="middle" font-size="13.5" font-weight="800" fill="#2f4f86">${t}</text></g>`; };
      return svg(W, H, sc.svg + defsB + [1, 2, 3].map((st, i) => `<g mask="url(#mb${i})">${PC.windLayer(st, 0, i * 230 - 28, W, i * 230 + 258, 62)}</g>`).join('') + lab(74, '💨 Little breeze') + lab(304, '💨 Good breeze') + lab(534, '❄️ Big brrr!')); },
    night() { const W = 393, H = 852; return svg(W, H, scene('mid', 'midnight', W, H, { night: true }).svg); },
    ipad() { const W = 1024, H = 1366; return svg(W, H, scene('ipad', 'ipad-wide', W, H).svg); },
    ipadnight() { const W = 1024, H = 1366; return svg(W, H, scene('ipad', 'ipad-widenight', W, H, { night: true }).svg); },
    metro() { const W = 393, H = 852; return svg(W, H, metropolis('wide', 'wide', W, H, 4)); },
    metronight() { const W = 393, H = 852; return svg(W, H, metropolis('wide', 'widenight', W, H, 4, { night: true })); },
    metroipad() { const W = 1024, H = 1366; return svg(W, H, metropolis('ipad', 'ipad-wide', W, H, 6)); },
  };

  // =========================================================== M2
  function m2Scene(set, plateName, W, H) {
    const G = grid(set), s = G.s;
    const list = [[-2, 8, 'windmill2'], [0, 8, 'windmill1'], [-3, 10, 'sorter'], [-1, 10, 'depot'], [-2, 9, 'bench'], [-3, 11, 'houseB'], [-2, 12, 'sorter', 1, 'off']];
    const C = (q, r) => G.at(q, r);
    const edge = (a, b, t = 0.42) => lerp(C(...a), C(...b), t);
    // wires
    const A = [edge([-2, 8], [-3, 9]), C(-3, 9), edge([-3, 10], [-3, 9])];
    const Bl = [edge([0, 8], [-1, 9]), C(-1, 9)];
    const Bu = [C(-2, 11), edge([-2, 12], [-2, 11])];
    const wires = wire(A, [true, true], s) + wire(Bl, [true], s) + wire(Bu, [false], s);
    // rail to the depot stub
    const dc = C(-1, 10), tip = [dc[0] + 50 * s, dc[1] + 3 * s];
    const path = [C(2, 6), C(1, 7), C(1, 8), C(0, 9), tip];
    const rails = K.railPath(path, { scale: () => 0.62 * (G.sp / 76) + 0.2 });
    const cart = `<g transform="translate(${C(1, 8)[0]} ${C(1, 8)[1] + 2}) scale(${0.7 * s})">${K.cart({ loaded: true })}</g>`;
    // gap marker: one empty tile, no post
    const gc = C(-2, 10), hr = G.sp * 0.5;
    const gap = `<g transform="translate(${gc[0]} ${gc[1]})"><path d="M0 ${-hr * 0.78} L${hr * 0.866} ${-hr * 0.39} L${hr * 0.866} ${hr * 0.39} L0 ${hr * 0.78} L${-hr * 0.866} ${hr * 0.39} L${-hr * 0.866} ${-hr * 0.39}Z" fill="#fff" fill-opacity=".35" stroke="${K.C.brassLo}" stroke-width="${Math.max(2, G.sp * 0.045)}" stroke-dasharray="6 7" stroke-linejoin="round"/><text y="${hr * 0.2}" text-anchor="middle" font-size="${G.sp * 0.3}" font-weight="800" fill="${K.C.brassLo}">+</text></g>`;
    const cold = C(-2, 12);
    const bub = bubbleBelow(cold[0], cold[1] + 12 * s, 'Needs a wire to a Windmill ⚡', -70);
    const bs = buildings(G, list, 'lit');
    // wires sit among the buildings: draw posts after the buildings that are behind them, simple order: roads, rails, gap, buildings, wires
    return { G, svg: plate(plateName, W, H) + frost(W, H) + roads(G, list.map(([q, r]) => [q, r])) + rails + gap + cart + bs + wires + bub };
  }
  g.M2 = {
    ...OLD2,
    overlay() { const W = 393, H = 852; return svg(W, H, m2Scene('mid', 'mid', W, H).svg + topBar(W, '⚡ Wires & rails') + hudStrip(W, H, 'Wire to a Sorter · 3 of 6 tiles', 'Tap the next tile to keep going')); },
    ipad() { const W = 1024, H = 1366; return svg(W, H, m2Scene('ipad', 'ipad-wide', W, H).svg + topBar(W, '⚡ Wires & rails') + hudStrip(W, H, 'Wire to a Sorter · 3 of 6 tiles', 'Tap the next tile to keep going')); },
    badge() {
      const W = 393, H = 852, sy = 466, G = grid('mid');
      const list = [[-3, 10, 'sorter'], [-2, 9, 'bench'], [-1, 9, 'houseA']];
      // shift the whole map up so the cold Sorter shows above the sheet
      const cold = [[-1, 8, 'sorter', 1, 'off']];
      const up = `<g transform="translate(0 -100)">${plate('mid', W, H)}${frost(W, H)}${roads(G, [...list, ...cold].map(([q, r]) => [q, r]))}${buildings(G, [...list, ...cold], 'lit')}${bubble(G.at(-1, 8)[0], G.at(-1, 8)[1] - 118 * G.s, 'Needs a wire to a Windmill ⚡', -50)}</g>`;
      return svg(W, H, up + `<rect width="${W}" height="${H}" fill="#3b2a52" opacity=".25"/>` +
        `<path d="M0 ${sy} q0 -26 26 -26 H${W - 26} q26 0 26 26 V${H} H0Z" fill="#fff8fb"/><rect x="${W / 2 - 24}" y="${sy - 20}" width="48" height="5" rx="2.5" fill="#d9cfe0"/>` +
        `<g transform="translate(20 ${sy + 12})"><rect width="92" height="92" rx="16" fill="#ece8f3"/><g transform="translate(46 82) scale(.85)">${K2.sorter({ state: 'off' })}</g></g>` +
        txt(126, sy + 40, 'Sorter', { fs: 22, fw: 800 }) + txt(126, sy + 62, 'Level 1 · Cold and quiet', { fs: 13, fw: 700, fill: '#8c7b94' }) +
        `<g transform="translate(20 ${sy + 120})"><rect width="${W - 40}" height="64" rx="16" fill="#fff1d6"/><text x="${(W - 40) / 2}" y="28" text-anchor="middle" font-size="16" font-weight="800" fill="#7a4b12">Needs a wire to a Windmill ⚡</text><text x="${(W - 40) / 2}" y="49" text-anchor="middle" font-size="13" font-weight="700" fill="#a0702f">Lay wires from land that's joined up to home!</text></g>` +
        `<g transform="translate(20 ${sy + 200})"><rect width="${W - 40}" height="52" rx="26" fill="url(#gBrass)"/><text x="${(W - 40) / 2}" y="33" text-anchor="middle" font-size="17" font-weight="800" fill="#5a3a0d">⚡ Lay a wire</text></g>` +
        `<g transform="translate(20 ${sy + 264})"><rect width="${W - 40}" height="48" rx="24" fill="#f3ecf6"/><text x="${(W - 40) / 2}" y="30" text-anchor="middle" font-size="15" font-weight="800" fill="${ink}">Close</text></g>`);
    },
  };

  // =========================================================== M3: each machine centred on a tile with its road ring
  const STATES = [['lit', 'Working'], ['out', 'Resting'], ['off', 'Needs power']];
  const WN = ['Working', 'Resting', 'Needs a wire'];
  const bgSheet = (w, h) => `<defs><linearGradient id="bgSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f3fb"/><stop offset="1" stop-color="#fdeef4"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#bgSky)"/>`;
  const title = (w, t, sub) => `<text x="${w / 2}" y="100" text-anchor="middle" font-size="22" font-weight="800" fill="${ink}">${t}</text><text x="${w / 2}" y="122" text-anchor="middle" font-size="13" font-weight="600" fill="#8c7b94">${sub}</text>`;
  const chip = (x, y, t, tone = 'cream') => { const w = t.length * 7.2 + 22; const f = { cream: ['#fff1d6', '#7a4b12'], green: ['#dff4ea', '#24684a'], blue: ['#e2ecfb', '#2f4f86'], grey: ['#ece6f0', ink] }[tone]; return `<g transform="translate(${x - w / 2} ${y})"><rect width="${w}" height="26" rx="13" fill="${f[0]}"/><text x="${w / 2}" y="17.5" text-anchor="middle" font-size="12.5" font-weight="700" fill="${f[1]}">${t}</text></g>`; };
  const hexTile = (cx, cy, R) => { const p = [[0, -R * 0.8], [R * 0.866, -R * 0.4], [R * 0.866, R * 0.4], [0, R * 0.8], [-R * 0.866, R * 0.4], [-R * 0.866, -R * 0.4]].map(([x, y]) => `${cx + x},${cy + y}`).join(' '); return `<polygon points="${p}" fill="#fdf0f2" stroke="#e8d2db" stroke-width="3" stroke-linejoin="round"/><polygon points="${p}" fill="none" stroke="#fff" stroke-width="1.4" transform="translate(0 -2)" opacity=".8"/>`; };
  function m3row(W, y, label, caption, fn, scale, chips, names, R = 62) {
    const cw = W / 3; let s = `<g transform="translate(0 ${y})">${txt(18, 0, label, { fs: 16, fw: 800 })}${txt(18, 18, caption, { fs: 12, fw: 600, fill: '#8c7b94' })}`;
    STATES.forEach(([st, name], i) => {
      const cx = cw * i + cw / 2, cy = 168;
      s += `${hexTile(cx, cy, R)}${K2.roadRing(cx, cy + 1, R * 0.55, R * 0.32, 5.5)}<g transform="translate(${cx} ${cy + 3}) scale(${scale})">${fn(st)}</g>${chip(cx, 218, names ? names[i] : name, st === 'lit' ? 'green' : st === 'out' ? 'grey' : 'cream')}`;
      if (chips && chips[st]) s += chip(cx, 38, chips[st], 'blue');
    });
    return s + '</g>';
  }
  const frame = (W, H, inner) => svg(W, H, bgSheet(W, H) + inner);
  const wc = { lit: '❄️ Brrr! Fast', out: '💨 Slow wind', off: '🔌 No wire yet' };
  g.M3 = {
    a() { const W = 393, H = 852; return frame(W, H, title(W, 'Windmills', 'Tall and breezy. Painted wood, brick, copper.') +
      m3row(W, 160, 'Windmill · Level 1', 'Runs on winter wind', (s) => K2.windmill({ level: 1, state: s }), 0.8, wc, WN) +
      m3row(W, 460, 'Windmill · Level 2', 'Taller, six woolly sails', (s) => K2.windmill({ level: 2, state: s }), 0.68, wc, WN)); },
    b() { const W = 393, H = 852; return frame(W, H, title(W, 'Sorter & Rail Depot', 'Squat and snug. Room for a road all round.') +
      m3row(W, 160, 'Sorter', 'Sorts goodies into tidy piles.', (s) => K2.sorter({ state: s }), 0.95, null) +
      m3row(W, 460, 'Rail Depot + cart', 'Carts bring goodies home', (s) => K2.depot({ state: s }), 0.74, null)); },
    c() { const W = 393, H = 852; return frame(W, H, title(W, 'Bench & Beacon', 'Think it up. Light it up.') +
      m3row(W, 160, 'Research Bench', 'Tinker up new blueprints', (s) => K2.bench({ state: s }), 1.1, null) +
      m3row(W, 460, 'Clockwork Beacon', 'The Hollow Man keeps his distance', (s) => K2.beacon({ state: s }), 0.78, null)); },
    skyline() { const W = 393, H = 852; // all six on one baseline: the skyline's rhythm
      const items = [['Sorter', K2.sorter({ state: 'lit' }), 0.95], ['Depot', K2.depot({ state: 'lit', stub: false, withCart: false }), 0.95], ['Bench', K2.bench({ state: 'lit' }), 1.05], ['Windmill', K2.windmill({ level: 1, state: 'lit' }), 0.8], ['Beacon', K2.beacon({ state: 'lit' }), 0.86], ['Windmill II', K2.windmill({ level: 2, state: 'lit' }), 0.68]];
      let s = title(W, 'Skyline', 'Squat, medium and tall: every tile different.') + `<rect x="0" y="330" width="${W}" height="360" fill="#fff" opacity=".65"/><rect x="0" y="604" width="${W}" height="26" fill="#efe3cf" stroke="#bda88e" stroke-width="2"/><path d="M0 617 H${W}" stroke="#fff" stroke-width="2.4" stroke-dasharray="10 12" stroke-linecap="round"/>`;
      items.forEach(([n, art, sc], i) => { const x = 36 + i * 64.2; s += `<g transform="translate(${x} 596) scale(${sc})">${art}</g>${txt(x, 656, n, { fs: 10, fw: 800, anchor: 'middle' })}`; });
      return frame(W, H, s); },
    ipad() { const W = 1024, H = 1366;
      const items = [['Windmill · L1', (s) => K2.windmill({ level: 1, state: s }), 1.25, WN], ['Windmill · L2', (s) => K2.windmill({ level: 2, state: s }), 1.0, WN], ['Sorter', (s) => K2.sorter({ state: s }), 1.5, null], ['Rail Depot', (s) => K2.depot({ state: s }), 1.15, null], ['Research Bench', (s) => K2.bench({ state: s }), 1.6, null], ['Clockwork Beacon', (s) => K2.beacon({ state: s }), 1.15, null]];
      let inner = title(W, 'Clockwork Isle machines', 'Working · Resting · Needs power').replace('y="100"', 'y="70"').replace('y="122"', 'y="98"');
      items.forEach(([n, fn, sc, names], i) => {
        const col = i % 2, r = Math.floor(i / 2), x0 = 24 + col * 500, y0 = 130 + r * 400;
        inner += `<g transform="translate(${x0} ${y0})"><rect width="476" height="380" rx="28" fill="#fff" opacity=".6"/>${txt(22, 34, n, { fs: 19, fw: 800 })}`;
        STATES.forEach(([st, name], j) => { const cx = 80 + j * 158 + 8, cy = 232; inner += `${hexTile(cx, cy, 70)}${K2.roadRing(cx, cy + 1, 38, 22, 6)}<g transform="translate(${cx} ${cy + 3}) scale(${sc * 0.82})">${fn(st)}</g>${chip(cx, 322, names ? names[j] : name, st === 'lit' ? 'green' : st === 'out' ? 'grey' : 'cream')}`; });
        inner += '</g>';
      });
      return frame(W, H, inner); },
  };
})(window);
