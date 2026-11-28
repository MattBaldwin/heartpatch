(function (g) {
  const K = g.KIT;
  const FONT = `-apple-system,'SF Pro Rounded','Nunito',system-ui,sans-serif`;
  const svg = (W, H, inner) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${K.defs()}${inner}</svg>`;
  const plate = (name, W, H) => `<image href="plates/plate-${name}.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;

  // frost dressing: icy vignette + cool wash + sparkles (a client-side tint in the real build)
  function frost(W, H, night = false, strength = 1) {
    const sp = [];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) sp.push([rnd() * W, rnd() * H, 2.4 + rnd() * 4.2]);
    return `<defs><radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#cfeaff" stop-opacity="0"/><stop offset="1" stop-color="#e9f6ff" stop-opacity="${0.5 * strength}"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="#bfe1fb" opacity="${night ? 0.1 : 0.16 * strength}" style="mix-blend-mode:multiply"/>
      <rect width="${W}" height="${H}" fill="url(#vig)"/>${K.frostSparkles(sp)}`;
  }
  const at = (x, y, s, inner, ground = true) => `<g transform="translate(${x} ${y}) scale(${s})">${ground ? `<ellipse cx="3" cy="6" rx="46" ry="15" fill="#3b2a52" opacity=".16" filter="url(#soft)"/><path d="M-40 4 Q-30 -8 -16 -2 Q-4 -9 10 -2 Q26 -8 40 4 Q22 14 0 13 Q-24 14 -40 4Z" fill="#fff" opacity=".94"/>` : ''}${inner}</g>`;

  // town layout on the 393x852 mid plate (dist 16)
  const L = {
    w2: [84, 360, 0.62], w1: [308, 344, 0.58], sorter: [148, 452, 0.56], bench: [240, 486, 0.62], depot: [182, 302, 0.5], beacon: [308, 456, 0.6], s2: [258, 612, 0.52],
  };
  const townSorted = (list) => list.sort((a, b) => a.y - b.y).map((o) => o.svg).join('');
  function town(state = 'lit', opt = {}) {
    const items = [
      { y: L.w2[1], svg: at(L.w2[0], L.w2[1], L.w2[2], K.windmill({ level: 2, state })) },
      { y: L.w1[1], svg: at(L.w1[0], L.w1[1], L.w1[2], K.windmill({ level: 1, state })) },
      { y: L.sorter[1], svg: at(L.sorter[0], L.sorter[1], L.sorter[2], K.sorter({ state })) },
      { y: L.bench[1], svg: at(L.bench[0], L.bench[1], L.bench[2], K.bench({ state })) },
      { y: L.depot[1], svg: at(L.depot[0], L.depot[1], L.depot[2], K.railDepot({ level: 1, state })) },
      { y: L.beacon[1], svg: at(L.beacon[0], L.beacon[1], L.beacon[2], K.beacon({ state, cone: !!opt.cone })) },
    ];
    return townSorted(items);
  }

  // wind overlay for a land rect: strength 1..3, arrows on a staggered grid, blue tint
  function windLayer(strength, x0, y0, x1, y1, gap = 56, rot = -18) {
    const tint = ['', '#cfeeff', '#8fd0f2', '#3a9bd8'][strength];
    const a = [0, 0.1, 0.2, 0.32][strength];
    let s = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${tint}" opacity="${a}" style="mix-blend-mode:multiply"/>`;
    let row = 0;
    for (let y = y0 + gap / 2; y < y1; y += gap * 0.8, row++) {
      for (let x = x0 + (row % 2 ? gap / 2 : 0) + gap / 3; x < x1; x += gap) s += K.windArrow(strength, x, y, rot);
    }
    return s;
  }

  // natural-looking wind field: calm inland (1), breezier midway (2), strong on the coast (3)
  function windField(cx, cy, a, b, x0, y0, x1, y1, gap = 54, rot = -18, only = null) {
    const str = (x, y) => { let d = Math.hypot((x - cx) / a, (y - cy) / b) + 0.16 * Math.sin(x / 37) * Math.cos(y / 41); return d < 0.5 ? 1 : d < 0.85 ? 2 : 3; };
    const colors = ['', '#cfeeff', '#8fd0f2', '#3a9bd8'], ops = [0, 0.22, 0.3, 0.4];
    let blobs = '', arrows = '', row = 0;
    for (let y = y0 + gap / 2; y < y1; y += gap * 0.8, row++) {
      for (let x = x0 + (row % 2 ? gap / 2 : 0) + gap / 3; x < x1; x += gap) {
        const st = only || str(x, y);
        blobs += `<circle cx="${x}" cy="${y}" r="${gap * 0.62}" fill="${colors[st]}" opacity="${ops[st]}"/>`;
        arrows += K.windArrow(st, x, y, rot);
      }
    }
    return `<g style="mix-blend-mode:multiply" filter="url(#blur6)">${blobs}</g>${arrows}`;
  }

  const pill = (x, y, t, o = {}) => {
    const w = o.w || t.length * 7.4 + 28, h = o.h || 34;
    return `<g transform="translate(${x - w / 2} ${y})"><rect width="${w}" height="${h}" rx="${h / 2}" fill="${o.fill || '#fff1d6'}" stroke="${o.stroke || 'none'}" stroke-width="1.5"/><text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" font-size="${o.fs || 14}" font-weight="800" fill="${o.ink || '#7a4b12'}">${t}</text></g>`;
  };
  // speech bubble: tail tip at (x, y); body shifted sideways by `shift` so it can stay on screen
  const bubble = (x, y, t, shift = 0) => {
    const w = t.length * 6.9 + 26, bc = shift;
    return `<g transform="translate(${x} ${y})"><rect x="${bc - w / 2}" y="-50" width="${w}" height="32" rx="16" fill="#fff1d6" stroke="${K.C.brassLo}" stroke-width="1.5"/><path d="M-8 -19 L0 -3 L8 -19Z" fill="#fff1d6" stroke="${K.C.brassLo}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-6.5 -19.5 h13" stroke="#fff1d6" stroke-width="3"/>
      <text x="${bc}" y="-29" text-anchor="middle" font-size="12.5" font-weight="800" fill="#7a4b12">${t}</text></g>`;
  };

  g.M1 = {
    ipad() { const W = 1024, H = 1366; return svg(W, H, plate('ipad-wide', W, H) + frost(W, H) + `<g transform="translate(406 409) scale(.67)">${town('lit')}</g>`); },
    ipadnight() { const W = 1024, H = 1366; return svg(W, H, plate('ipad-widenight', W, H) + frost(W, H, true) + `<g transform="translate(406 409) scale(.67)"><g style="filter:brightness(.8) saturate(.92)">${town('lit', { cone: true })}</g>${nightGlows()}</g>`); },
    zoomday() { const W = 393, H = 852; return svg(W, H, plate('mid', W, H) + frost(W, H) + town('lit')); },
    zoomwind() { const W = 393, H = 852; return svg(W, H, plate('mid', W, H) + frost(W, H) + windField(200, 420, 360, 520, 0, 0, W, 700, 64) + town('lit')); },
    farwind() { const W = 393, H = 852; return svg(W, H, plate('wide', W, H) + frost(W, H) + townFar(W, H) + windField(214, 400, 300, 280, 0, 0, W, 690, 62)); },
    wide() { const W = 393, H = 852; return svg(W, H, plate('wide', W, H) + frost(W, H) + townFar(W, H)); },
    night() { const W = 393, H = 852; return svg(W, H, plate('midnight', W, H) + frost(W, H, true) + `<g style="filter:brightness(.8) saturate(.92)">${town('lit', { cone: true })}</g>` + nightGlows()); },
    wind(q) { const W = 393, H = 852; const s = +q.get('w') || 0;
      if (s) return svg(W, H, plate('wide', W, H) + frost(W, H) + townFar(W, H) + windLayer(s, 0, 0, W, 690, 62));
      // three bands, feathered into each other, each with a small label
      const defsB = `<defs><linearGradient id="fadeV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
        [0, 1, 2].map((i) => `<mask id="mb${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="0" y="${i * 230 - 28}" width="${W}" height="286" fill="${i === 0 ? '#fff' : 'url(#fadeV)'}"/></mask>`).join('') + `</defs>`;
      const lab = (y, t) => { const w = t.length * 8 + 28; return `<g transform="translate(${W - 16 - w} ${y})"><rect width="${w}" height="30" rx="15" fill="#fff" opacity=".95" stroke="#eadff0" stroke-width="1.5"/><text x="${w / 2}" y="20" text-anchor="middle" font-size="13.5" font-weight="800" fill="#2f4f86">${t}</text></g>`; };
      return svg(W, H, plate('wide', W, H) + frost(W, H) + townFar(W, H) + defsB + [1, 2, 3].map((st, i) => `<g mask="url(#mb${i})">${windLayer(st, 0, i * 230 - 28, W, i * 230 + 258, 62)}</g>`).join('') + lab(74, '💨 Little breeze') + lab(304, '💨 Good breeze') + lab(534, '❄️ Big brrr!')); },
  };
  // far-view town: tiny props on the homestead of the wide plate (homestead centre ~ (214,428), tile ~34px wide)
  function townFar(W, H) {
    const P = (dx, dy, s, svgs) => `<g transform="translate(${214 + dx} ${420 + dy}) scale(${s})">${svgs}</g>`;
    const items = [
      [-60, -40, K.windmill({ level: 2, state: 'lit' }), 0.26], [58, -34, K.windmill({ level: 1, state: 'lit' }), 0.24],
      [-20, 2, K.sorter({ state: 'lit' }), 0.24], [28, 18, K.bench({ state: 'lit' }), 0.26], [-4, -48, K.railDepot({ level: 1, state: 'lit' }), 0.22],
      [62, 14, K.beacon({ state: 'lit' }), 0.26],
    ].sort((a, b) => a[1] - b[1]);
    return items.map(([dx, dy, art, s]) => P(dx, dy, s * 1.3, art)).join('');
  }
  function nightGlows() { // warm light pools drawn after the dimmed props
    const pools = [[L.sorter, -10, -22, 40], [L.depot, -10, -18, 34], [L.bench, 0, -32, 40], [L.w2, 0, -34, 38], [L.w1, 0, -26, 32], [L.beacon, 0, -64, 110]];
    return `<g style="mix-blend-mode:screen">${pools.map(([p, dx, dy, r]) => `<circle cx="${p[0] + dx * p[2]}" cy="${p[1] + dy * p[2]}" r="${r}" fill="url(#gGlow)" opacity=".75"/>`).join('')}</g>
      <ellipse cx="${L.beacon[0]}" cy="${L.beacon[1] + 6}" rx="150" ry="86" fill="url(#gCone2)" style="mix-blend-mode:screen"/>`;
  }

  // ---------------------------------------------------------------- M2
  const ink = '#6b5a73';
  const card = (x, y, w, h, inner, o = {}) => `<g transform="translate(${x} ${y})"><rect width="${w}" height="${h}" rx="22" fill="${o.fill || '#fff'}" stroke="${o.stroke || '#eadff0'}" stroke-width="${o.sw || 2}"/>${inner}</g>`;
  const txt = (x, y, t, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 14}" font-weight="${o.fw || 700}" fill="${o.fill || ink}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''}>${t}</text>`;
  const costChip = (x, y, t) => { const w = t.length * 7.2 + 18; return `<g transform="translate(${x} ${y})"><rect width="${w}" height="24" rx="12" fill="#fff1d6"/><text x="${w / 2}" y="16.5" text-anchor="middle" font-size="12.5" font-weight="800" fill="#7a4b12">${t}</text></g>`; };

  // map content for M2 on the mid plate
  const wiresLit = [[104, 394], [124, 424], [138, 448 - 6]];
  function m2Map(opts = {}) {
    const W = 393, H = 852;
    const lines = (opts.lines !== false);
    // wire from Windmill L2 (84,360) to Sorter (148,452): lit chain
    const wire1 = K.wirePath([[96, 380], [112, 408], [128, 432]], { lit: true });
    // second chain from Windmill L1 (308,344) down, then a gap (missing tile), ending at the cut-off sorter
    const wire2 = K.wirePath([[312, 376], [326, 410]], { lit: true }) + `<g transform="translate(332 452)"><path d="M0 -37 L33 -19 L33 19 L0 37 L-33 19 L-33 -19Z" transform="scale(1 .62)" fill="#fff" fill-opacity=".35" stroke="${K.C.brassLo}" stroke-width="3.2" stroke-dasharray="6 7" stroke-linejoin="round"/><text y="6" text-anchor="middle" font-size="18" font-weight="800" fill="${K.C.brassLo}">+</text></g>` + K.wirePath([[328, 490], [312, 534], [292, 576]], { lit: false });
    const rails = K.railPath([[354, 104], [330, 130], [313, 170], [300, 200], [274, 236], [250, 236], [226, 262], [200, 274]], { scale: (y) => 0.55 + (y / 852) * 0.7 });
    const sorterOn = at(L.sorter[0], L.sorter[1], L.sorter[2], K.sorter({ state: 'lit' }));
    const sorterOff = at(L.s2[0], L.s2[1], L.s2[2], K.sorter({ state: 'off' }));
    const w2 = at(L.w2[0], L.w2[1], L.w2[2], K.windmill({ level: 2, state: 'lit' }));
    const w1 = at(L.w1[0], L.w1[1], L.w1[2], K.windmill({ level: 1, state: 'lit' }));
    const dep = at(L.depot[0], L.depot[1], L.depot[2], K.railDepot({ level: 1, state: 'lit', withCart: false }));
    const cartOnRail = `<g transform="translate(306 188) scale(.62)">${K.cart({ loaded: true })}</g>`;
    const bench = at(L.bench[0], L.bench[1], L.bench[2], K.bench({ state: 'lit' }));
    return (opts.plateless ? '' : plate('mid', W, H) + frost(W, H)) + (lines ? rails + cartOnRail : '') + dep + w2 + w1
      + (lines ? wire1 : '') + sorterOn + (lines ? wire2 : '') + sorterOff
      + bubble(L.s2[0], L.s2[1] - 72, 'Needs a wire to a Windmill ⚡', -62);
  }
  function hudStrip(W, H, text, sub) {
    return `<g><rect x="16" y="${H - 118}" width="${W - 32}" height="76" rx="26" fill="#fff" opacity=".96" stroke="#eadff0" stroke-width="2"/>
      <text x="${W / 2}" y="${H - 84}" text-anchor="middle" font-size="16" font-weight="800" fill="${ink}">${text}</text>
      <text x="${W / 2}" y="${H - 62}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#8c7b94">${sub}</text></g>`;
  }
  const topBar = (W, label) => `<g><rect x="12" y="66" width="${W - 24}" height="44" rx="22" fill="#fff" opacity=".95" stroke="#eadff0" stroke-width="2"/><text x="${W / 2}" y="94" text-anchor="middle" font-size="15" font-weight="800" fill="${ink}">${label}</text></g>`;

  const IPAD_T = 'translate(406 409) scale(.67)';
  g.M2 = {
    ipad() { const W = 1024, H = 1366; return svg(W, H, plate('ipad-wide', W, H) + frost(W, H) + `<g transform="${IPAD_T}">${m2Map({ plateless: true })}</g>` + topBar(W, '⚡ Wires & rails') + hudStrip(W, H, 'Wire to a Sorter · 3 of 6 tiles', 'Tap the next tile to keep going')); },
    overlay() { const W = 393, H = 852; return svg(W, H, m2Map() + topBar(W, '⚡ Wires & rails') + hudStrip(W, H, 'Wire to a Sorter · 3 of 6 tiles', 'Tap the next tile to keep going')); },
    overlaynight() { const W = 393, H = 852; return svg(W, H, m2Map()+ `<rect width="${W}" height="${H}" fill="#14204a" opacity=".38"/>`+nightGlows()+ topBar(W, '⚡ Wires & rails')); },
    sheet() {
      const W = 393, H = 852, sy = 362;
      const rowc = (y, art, name, desc, costs, tag, lvl) => card(14, y, W - 28, 128,
        `<rect x="12" y="12" width="88" height="88" rx="18" fill="#eaf4fb"/>${art}` + txt(112, 34, name, { fs: 17, fw: 800 }) + (tag ? `<g transform="translate(${W - 28 - 12 - (tag.length * 6.6 + 18)} 14)"><rect width="${tag.length * 6.6 + 18}" height="22" rx="11" fill="#dff4ea"/><text x="${(tag.length * 6.6 + 18) / 2}" y="15" text-anchor="middle" font-size="11.5" font-weight="800" fill="#24684a">${tag}</text></g>` : '') +
        txt(112, 56, desc, { fs: 13, fw: 600, fill: '#8c7b94' }) + costs.map((c, i) => costChip(112 + i * 80, 68, c)).join('') + txt(112, 118, lvl, { fs: 12, fw: 700, fill: '#8c7b94' }));
      const wireArt = `<g transform="translate(34 74)">${K.wirePath([[0, 0], [28, 4]], { lit: true })}</g><g transform="translate(18 74) scale(.001)"/>`;
      const wireIcon = `<g transform="translate(14 14)"><g transform="translate(14 64)">${K.post(true)}</g><g transform="translate(66 62)">${K.post(true)}</g><path d="M14 33 Q40 46 66 31" stroke="#fff0b0" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M14 33 Q40 46 66 31" stroke="${K.C.glow}" stroke-width="7" fill="none" opacity=".5" filter="url(#soft)"/></g>`;
      const railIcon = (lv) => `<g transform="translate(14 14)"><ellipse cx="40" cy="58" rx="36" ry="12" fill="#fff" opacity=".8"/><g transform="translate(40 52)">${K.railPath([[-30, 12], [-4, 6], [6, -8], [30, -14]], { scale: 0.7 })}</g><g transform="translate(40 40) scale(.5)">${K.cart({ loaded: true })}</g>${lv === 2 ? `<g transform="translate(60 64)">${K.gear(0, 0, 7, 8, 'url(#gBrass)')}</g>` : ''}</g>`;
      return svg(W, H, plate('mid', W, H) + frost(W, H) + `<rect width="${W}" height="${H}" fill="#3b2a52" opacity=".28"/>` +
        `<path d="M0 ${sy} q0 -26 26 -26 H${W - 26} q26 0 26 26 V${H} H0Z" fill="#fff8fb"/><rect x="${W / 2 - 24}" y="${sy - 20}" width="48" height="5" rx="2.5" fill="#d9cfe0"/>` +
        txt(20, sy + 14, 'Build', { fs: 22, fw: 800 }) +
        [['Homes', 0], ['Works', 1], ['Lines', 2]].map(([t, i]) => `<g transform="translate(${130 + i * 82} ${sy - 6})"><rect width="74" height="34" rx="17" fill="${i === 2 ? '#7a4b12' : '#f3ecf6'}"/><text x="37" y="22" text-anchor="middle" font-size="13.5" font-weight="800" fill="${i === 2 ? '#fff' : ink}">${t}</text></g>`).join('') +
        `<g transform="translate(0 ${sy + 36})">` +
        rowc(0, wireIcon, 'Wire', 'Carries Spark. Up to 6 tiles.', ['⚙️ 1 each'], '', 'One per tile · half back if removed') +
        rowc(142, railIcon(1), 'Rail', 'Carts carry goodies home.', ['🪵 2', '⚙️ 1'], 'Level 1', 'Reach 2 · rolls a bit faster') +
        rowc(284, railIcon(2), 'Rail, brass', 'Shinier! Carts roll faster.', ['🪵 4', '🪨 2', '⚙️ 2'], 'Needs Tidy Rails', 'Reach 3 · rolls faster still') + `</g>`);
    },
    badge() { // the works card: unpowered Sorter with the need line
      const W = 393, H = 852, sy = 466;
      const dim = plate('mid', W, H) + frost(W, H) + at(L.sorter[0], L.sorter[1], L.sorter[2], K.sorter({ state: 'lit' })) + at(290, 330, 0.66, K.sorter({ state: 'off' })) + bubble(290, 244, 'Needs a wire to a Windmill ⚡', -62);
      return svg(W, H, dim + `<rect width="${W}" height="${H}" fill="#3b2a52" opacity=".25"/>` +
        `<path d="M0 ${sy} q0 -26 26 -26 H${W - 26} q26 0 26 26 V${H} H0Z" fill="#fff8fb"/><rect x="${W / 2 - 24}" y="${sy - 20}" width="48" height="5" rx="2.5" fill="#d9cfe0"/>` +
        `<g transform="translate(20 ${sy + 12})"><rect width="92" height="92" rx="16" fill="#ece8f3"/><g transform="translate(46 80) scale(.62)">${K.sorter({ state: 'off', })}</g></g>` +
        txt(126, sy + 40, 'Sorter', { fs: 22, fw: 800 }) + txt(126, sy + 62, 'Level 1 · Cold and quiet', { fs: 13, fw: 700, fill: '#8c7b94' }) +
        `<g transform="translate(20 ${sy + 120})"><rect width="${W - 40}" height="64" rx="16" fill="#fff1d6"/><text x="${(W - 40) / 2}" y="28" text-anchor="middle" font-size="16" font-weight="800" fill="#7a4b12">Needs a wire to a Windmill ⚡</text><text x="${(W - 40) / 2}" y="49" text-anchor="middle" font-size="13" font-weight="700" fill="#a0702f">Lay wires from land that's joined up to home!</text></g>` +
        `<g transform="translate(20 ${sy + 200})"><rect width="${W - 40}" height="52" rx="26" fill="url(#gBrass)"/><text x="${(W - 40) / 2}" y="33" text-anchor="middle" font-size="17" font-weight="800" fill="#5a3a0d">⚡ Lay a wire</text></g>` +
        `<g transform="translate(20 ${sy + 264})"><rect width="${W - 40}" height="48" rx="24" fill="#f3ecf6"/><text x="${(W - 40) / 2}" y="30" text-anchor="middle" font-size="15" font-weight="800" fill="${ink}">Close</text></g>`);
    },
  };
  g.PIECES = { windField, nightGlows, frost, at, town, windLayer, pill, bubble, svg, plate, L, townFar, FONT };
})(window);
