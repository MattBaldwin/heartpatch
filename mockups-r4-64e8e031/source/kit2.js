// Clockwork Isle kit v2: cozy steampunk. Varied materials (brick, painted wood, iron, copper + verdigris),
// varied heights, warm window light. Every building is drawn centred on (0,0) = the middle of its tile,
// base half-width <= ~28 units so a road ring fits around it inside the tile.
// state: 'lit' (windows warm, steam up) | 'out' (powered, resting: dim windows, no steam) | 'off' (cold: grey glass, snow on chimney, ⚡)
(function (g) {
  const K1 = g.KIT, C = K1.C;
  const P = {
    brick: '#c8574c', brickLo: '#8f3a38', brickHi: '#e57d6c',
    teal: '#62b5ae', tealLo: '#3c8883', tealHi: '#9adbd2',
    cream: '#f6e7cc', creamLo: '#d9c3a0',
    mustard: '#eab24c', mustardLo: '#b97f22',
    plum: '#8b6aa8', plumLo: '#5e4577',
    sage: '#8fbf8a', sageLo: '#5e9560',
    iron: '#58546a', ironLo: '#38354a', ironHi: '#8a869e',
    slate: '#6c6a86', verd: '#79c3a3', verdLo: '#4b9a7f', verdHi: '#b4ead2',
    redroof: '#bf4a50', redroofLo: '#8a2f3a',
  };
  const pal = (n) => ({ brick: [P.brick, P.brickLo, P.brickHi], teal: [P.teal, P.tealLo, P.tealHi], cream: [P.cream, P.creamLo, '#fff6e2'], mustard: [P.mustard, P.mustardLo, '#ffd98a'], plum: [P.plum, P.plumLo, '#b79bd2'], sage: [P.sage, P.sageLo, '#bfe3b9'], iron: [P.iron, P.ironLo, P.ironHi] }[n]);

  const defs2 = () => `<defs>
    <pattern id="pBrick" width="12" height="8" patternUnits="userSpaceOnUse"><rect width="12" height="8" fill="none"/><path d="M0 .5 H12 M0 4.5 H12 M3 0 V4 M9 4 V8" stroke="#000" stroke-opacity=".16" stroke-width=".9"/></pattern>
    <pattern id="pPlank" width="8" height="10" patternUnits="userSpaceOnUse"><path d="M.5 0 V10" stroke="#000" stroke-opacity=".13" stroke-width=".9"/></pattern>
    <pattern id="pShingle" width="10" height="7" patternUnits="userSpaceOnUse"><path d="M0 6.5 H10 M5 0 V6.5" stroke="#000" stroke-opacity=".18" stroke-width=".9"/></pattern>
    <radialGradient id="gWinLit" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#ffc766"/></radialGradient>
    <linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8f7ff" stop-opacity=".9"/><stop offset="1" stop-color="#9bd0e8" stop-opacity=".75"/></linearGradient>
  </defs>`;

  const sh = (rx, ry) => `<ellipse cx="3" cy="3" rx="${rx}" ry="${ry}" fill="#3b2a52" opacity=".2" filter="url(#soft)"/>`;
  const snowTop = (x0, x1, y, wob = 3) => `<path d="M${x0} ${y} Q${(x0 * 3 + x1) / 4} ${y - wob * 2} ${(x0 + x1) / 2} ${y - wob} Q${(x0 + x1 * 3) / 4} ${y - wob * 2.4} ${x1} ${y} Q${(x0 + x1) / 2} ${y + wob * 1.4} ${x0} ${y}Z" fill="#fff" stroke="#d3e8f6" stroke-width="1" stroke-linejoin="round"/>`;
  const rivets = (x0, x1, y, n) => Array.from({ length: n }, (_, i) => `<circle cx="${x0 + ((x1 - x0) * (i + 0.5)) / n}" cy="${y}" r="1.3" fill="${C.brassHi}" stroke="${C.brassLo}" stroke-width=".5"/>`).join('');

  function win(x, y, w, h, state, { arch = false, flowers = false } = {}) {
    const fill = state === 'lit' ? 'url(#gWinLit)' : state === 'out' ? '#ecd9a3' : '#b3c2d0';
    const shape = arch
      ? `<path d="M${x - w / 2} ${y + h / 2} V${y - h / 6} A${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${y - h / 6} V${y + h / 2}Z"`
      : `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2.2"`;
    return `${shape} fill="${fill}" stroke="${P.ironLo}" stroke-width="1.5"/>
      <path d="M${x} ${y - h / 2} V${y + h / 2} M${x - w / 2} ${y} H${x + w / 2}" stroke="${P.ironLo}" stroke-width="1" opacity=".7"/>
      <rect x="${x - w / 2 - 1.5}" y="${y + h / 2}" width="${w + 3}" height="2.6" rx="1" fill="${C.woodLo}"/>
      ${flowers ? `<rect x="${x - w / 2}" y="${y + h / 2 + 1}" width="${w}" height="4" rx="1.4" fill="${C.woodLo}"/>${[-1, 0, 1].map((i) => `<circle cx="${x + i * (w / 3)}" cy="${y + h / 2 - 0.5}" r="2.4" fill="${['#ff8da1', '#fff', '#f7c85a'][i + 1]}"/>`).join('')}` : ''}`;
  }
  const door = (x, w, h, col) => `<path d="M${x - w / 2} 0 V${-h + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${-h + w / 2} V0Z" fill="${col}" stroke="${P.ironLo}" stroke-width="1.4"/><circle cx="${x + w / 4}" cy="${-h / 2}" r="1.3" fill="${C.brassHi}"/>`;
  const gauge = (x, y, r, state) => `<g><circle cx="${x}" cy="${y}" r="${r}" fill="${state === 'off' ? '#d9e2ea' : '#fffaf0'}" stroke="url(#gBrass)" stroke-width="2.2"/><path d="M${x} ${y} L${x + r * 0.6} ${y - r * 0.5}" stroke="${C.red}" stroke-width="1.4" stroke-linecap="round" transform="rotate(${state === 'lit' ? 0 : -50} ${x} ${y})"/><circle cx="${x}" cy="${y}" r="1.2" fill="${P.ironLo}"/></g>`;
  const pipe = (x0, y0, x1, y1, r = 2.6) => `<path d="M${x0} ${y0} L${x1} ${y1}" stroke="${P.ironLo}" stroke-width="${r * 2 + 1.6}" stroke-linecap="round"/><path d="M${x0} ${y0} L${x1} ${y1}" stroke="url(#gCopper)" stroke-width="${r * 2}" stroke-linecap="round"/>`;
  const chimBrick = (x, top, h, state) => `<g><rect x="${x - 4.5}" y="${top}" width="9" height="${h}" fill="${P.brick}" stroke="${P.brickLo}" stroke-width="1.2"/><rect x="${x - 4.5}" y="${top}" width="9" height="${h}" fill="url(#pBrick)"/><rect x="${x - 6}" y="${top - 3}" width="12" height="4" rx="1" fill="${P.brickLo}"/>${state === 'off' ? snowTop(x - 6, x + 6, top - 3, 2) : ''}${state === 'lit' ? K1.steam(x, top - 8, 3, 0.9) : ''}</g>`;
  const chimPipe = (x, top, h, state) => `<g><rect x="${x - 3}" y="${top}" width="6" height="${h}" fill="${P.iron}" stroke="${P.ironLo}" stroke-width="1.2"/><rect x="${x - 4.5}" y="${top + 3}" width="9" height="3" fill="url(#gBrass)"/><path d="M${x - 5} ${top} h10 l-2 -4 h-6Z" fill="${P.ironLo}"/>${state === 'off' ? snowTop(x - 5, x + 5, top - 3, 2) : ''}${state === 'lit' ? K1.steam(x, top - 8, 3, 0.85) : ''}</g>`;

  // wall body: mat 'brick' | 'wood:<color>' ; w half width, h height; side face on the right for 3/4 depth
  function wall(w, h, mat, d = 9) {
    const isBrick = mat === 'brick';
    const [c, lo, hi] = isBrick ? [P.brick, P.brickLo, P.brickHi] : pal(mat.split(':')[1]);
    return `<path d="M${w} 0 L${w + d} ${-d * 0.45} V${-h - d * 0.45} L${w} ${-h}Z" fill="${lo}" stroke="${P.ironLo}" stroke-width="1.2" stroke-linejoin="round"/>
      <rect x="${-w}" y="${-h}" width="${w * 2}" height="${h}" rx="3" fill="${c}" stroke="${P.ironLo}" stroke-width="1.4"/>
      <rect x="${-w}" y="${-h}" width="${w * 2}" height="${h}" rx="3" fill="url(#${isBrick ? 'pBrick' : 'pPlank'})"/>
      <path d="M${-w + 3} ${-h + 3} V-4" stroke="#fff" stroke-width="3" opacity=".22" stroke-linecap="round"/>
      <rect x="${-w - 1.5}" y="-5" width="${w * 2 + 3}" height="5" rx="2" fill="${P.ironLo}" opacity=".75"/>`;
  }
  // roofs. kind: gable | flat | cone | dome ; mat: red | slate | verd | copper
  function roof(kind, w, y, mat, h = 20) {
    const [c, lo] = { red: [P.redroof, P.redroofLo], slate: [P.slate, P.ironLo], verd: [P.verd, P.verdLo], copper: [C.copper, C.copperLo], teal: [P.teal, P.tealLo] }[mat];
    if (kind === 'gable') {
      return `<path d="M${-w - 5} ${y} L0 ${y - h} L${w + 5} ${y}Z" fill="${c}" stroke="${lo}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M${-w - 5} ${y} L0 ${y - h} L${w + 5} ${y}Z" fill="url(#pShingle)"/>
        <path d="M${w + 5} ${y} L${w + 14} ${y - 4} L9 ${y - h - 4} L0 ${y - h}Z" fill="${lo}" opacity=".85"/>
        ${snowTop(-w - 3, w + 3, y - 1, 3)}<path d="M${-w + 4} ${y - 4} Q0 ${y - h - 2} ${w - 4} ${y - 4}" fill="none" stroke="#fff" stroke-width="4" opacity=".9" stroke-linecap="round" transform="translate(0 ${-h * 0.06})"/>`;
    }
    if (kind === 'flat') {
      return `<rect x="${-w - 4}" y="${y - 6}" width="${w * 2 + 8}" height="8" rx="3" fill="${c}" stroke="${lo}" stroke-width="1.5"/>${rivets(-w - 1, w + 1, y - 2, 6)}${snowTop(-w - 3, w + 3, y - 6, 3)}`;
    }
    if (kind === 'cone') {
      return `<path d="M${-w - 3} ${y} L0 ${y - h} L${w + 3} ${y}Z" fill="${c}" stroke="${lo}" stroke-width="1.5" stroke-linejoin="round"/><path d="M0 ${y - h} L${w + 3} ${y} L${w * 0.2} ${y}Z" fill="${lo}" opacity=".35"/>${snowTop(-w * 0.55, w * 0.55, y - h * 0.45, 2.4)}<circle cx="0" cy="${y - h - 2}" r="2.4" fill="url(#gBrass)"/>`;
    }
    // dome
    return `<path d="M${-w - 2} ${y} Q${-w - 2} ${y - h} 0 ${y - h} Q${w + 2} ${y - h} ${w + 2} ${y}Z" fill="${c}" stroke="${lo}" stroke-width="1.5"/><path d="M${-w * 0.6} ${y - 2} Q${-w * 0.4} ${y - h * 0.85} 0 ${y - h + 2}" fill="none" stroke="#fff" stroke-width="2.4" opacity=".35"/>${snowTop(-w * 0.6, w * 0.6, y - h * 0.8, 2.4)}`;
  }
  const crate = (x, y, c) => `<g><rect x="${x - 4.5}" y="${y - 7}" width="9" height="7" rx="1.6" fill="${c}" stroke="${P.ironLo}" stroke-width="1"/><path d="M${x - 4.5} ${y - 3.5} H${x + 4.5}" stroke="#fff" stroke-opacity=".5" stroke-width="1"/></g>`;
  const badge = (x, y) => K1.badge(x, y);

  // ------------------------------------------------------------------ SORTER (squat brick, flat iron roof, hopper)
  function sorter({ state = 'lit' } = {}) {
    return `<g>${sh(36, 12)}
      ${wall(25, 32, 'brick')}
      ${rivets(-22, 22, -26, 7)}
      <rect x="-22" y="-27" width="44" height="3.4" fill="${P.iron}" opacity=".9"/>
      ${win(-11, -16, 12, 11, state)}
      ${door(11, 9, 17, '#5a7aa6')}
      ${gauge(0, -34, 0.01, state)}
      ${roof('flat', 25, -32, 'slate')}
      <!-- hopper funnel -->
      <path d="M-11 -37 L11 -37 L6 -50 L-6 -50Z" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M-6 -50 H6" stroke="${C.brassLo}" stroke-width="2"/>
      ${[['#7fd18b', -4], ['#f7c85a', 0], ['#ff8da1', 4]].map(([c, x]) => `<circle cx="${x}" cy="-52" r="3.4" fill="${state === 'off' ? '#b8c6d3' : c}" stroke="#fff" stroke-width="1"/>`).join('')}
      ${chimPipe(-17, -50, 20, state)}
      ${pipe(-17, -30, -17, -20)}
      ${gauge(18, -40, 5, state)}
      <!-- conveyor stub with crates -->
      <rect x="22" y="-9" width="22" height="7" rx="3.5" fill="${P.ironLo}"/><circle cx="26" cy="-5.5" r="2.2" fill="${C.brassHi}"/><circle cx="40" cy="-5.5" r="2.2" fill="${C.brassHi}"/>
      ${state !== 'off' ? crate(30, -9, '#e5555f') + crate(38, -9, '#7fd18b') : crate(32, -9, '#b8c6d3')}
      ${K1.gear(-24, -12, 5, 7, 'url(#gCopper)', state === 'lit' ? 12 : 0)}
      ${state === 'off' ? `<path d="M-25 -8 q-12 2 -10 14" fill="none" stroke="${P.ironLo}" stroke-width="2.4" stroke-linecap="round"/>${badge(0, -78)}` : ''}
      ${state === 'out' ? `<text x="14" y="-58" font-size="11" fill="${C.ink}" font-weight="800">z</text><text x="21" y="-66" font-size="8" fill="${C.ink}" font-weight="800">z</text>` : ''}
    </g>`;
  }

  // ------------------------------------------------------------- RAIL DEPOT (squat painted teal shed, verdigris roof)
  function depot({ state = 'lit', withCart = true, stub = true } = {}) {
    return `<g>${sh(36, 12)}
      ${wall(27, 28, 'wood:teal')}
      ${roof('gable', 27, -28, 'verd', 20)}
      ${win(-12, -15, 11, 12, state, { arch: true })}
      ${door(10, 12, 20, '#8a5a34')}
      <circle cx="0" cy="-40" r="6.6" fill="#fff8e6" stroke="${C.brassLo}" stroke-width="1.8"/><path d="M0 -40 v-4 M0 -40 l3 1.6" stroke="${P.ironLo}" stroke-width="1.4" stroke-linecap="round"/>
      ${chimBrick(17, -47, 14, state)}
      ${gauge(-20, -34, 0.01, state)}
      ${stub ? `<g transform="translate(26 0)">${[0, 12, 24].map((x) => `<rect x="${x - 3.4}" y="-2.5" width="6.8" height="8" rx="2" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width=".9"/><rect x="${x - 3}" y="-2.5" width="6" height="2" fill="#fff" opacity=".85"/>`).join('')}<path d="M-5 0 H28 M-5 3.4 H28" stroke="url(#gBrass)" stroke-width="2" stroke-linecap="round"/></g>` : ''}
      ${withCart ? `<g transform="translate(48 -5) scale(.78)">${K1.cart({ loaded: state !== 'off' })}</g>` : ''}
      ${state === 'off' ? badge(0, -62) : ''}
    </g>`;
  }

  // ---------------------------------------------------- RESEARCH BENCH (low painted cabin, skylight, drafting table)
  function bench({ state = 'lit' } = {}) {
    const lit = state === 'lit';
    return `<g>${sh(34, 11)}
      ${wall(24, 24, 'wood:cream')}
      ${roof('gable', 24, -24, 'copper', 15)}
      <path d="M-9 -34 L9 -34 L7 -40 L-7 -40Z" fill="url(#gGlass)" stroke="${P.ironLo}" stroke-width="1.2"/>
      ${win(-10, -13, 10, 11, state, { flowers: true })}
      <!-- drafting table out front with a visible blueprint -->
      <g transform="translate(14 2)"><rect x="-13" y="-9" width="26" height="4" rx="1.6" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1"/><rect x="-11" y="-5" width="3" height="7" fill="${C.woodLo}"/><rect x="8" y="-5" width="3" height="7" fill="${C.woodLo}"/>
        <path d="M-11 -9 L-3 -15 L12 -11 L5 -5 Z" transform="translate(0 0)" fill="${state === 'off' ? '#d3dbe4' : '#fff'}" stroke="${state === 'off' ? '#8fa2b6' : '#4f8fc0'}" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M-5 -10.5 L7 -9.5 M-4 -8 L5 -7.2" stroke="${state === 'off' ? '#9aa9b9' : '#4f8fc0'}" stroke-width="1" stroke-linecap="round"/></g>
      <g transform="translate(-27 0)"><rect x="-1.4" y="-30" width="2.8" height="30" fill="${P.iron}"/><path d="M0 -30 q6 -4 10 0" fill="none" stroke="${P.iron}" stroke-width="2.4" stroke-linecap="round"/>
        <circle cx="10" cy="-27" r="4.2" fill="${lit ? '#fff3b8' : state === 'out' ? '#eadcae' : '#b9c7d4'}" stroke="${C.brassLo}" stroke-width="1.3"/></g>
      ${chimPipe(14, -40, 16, state)}
      ${K1.gear(-14, -33, 5, 7, 'url(#gBrass)', lit ? 8 : 0)}
      ${state === 'off' ? badge(0, -58) : ''}
    </g>`;
  }

  // ----------------------------------------------------------------- WINDMILL (tall: brick plinth, painted tower)
  function windmill({ level = 1, state = 'lit', rot = 0 } = {}) {
    const L2 = level === 2, h = L2 ? 104 : 78, topW = L2 ? 13 : 12, botW = L2 ? 25 : 23, n = L2 ? 6 : 4, hub = [0, -h - 5];
    const body = L2 ? 'teal' : 'cream';
    const [bc, bl] = pal(body);
    let sails = '';
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i + rot + (state === 'lit' ? 0 : 12), len = L2 ? 46 : 38;
      sails += `<g transform="rotate(${a})"><rect x="-1.6" y="-${len}" width="3.2" height="${len}" rx="1.4" fill="url(#gBrass)"/><path d="M1.6 -${len - 2} q ${L2 ? 16 : 14} 2 ${L2 ? 13 : 11} ${L2 ? 24 : 21} L 1.6 -11 Z" fill="url(#gWool)" stroke="${C.woolLo}" stroke-width="1"/><path d="M4 -${len - 8} q 8 2 7 12" fill="none" stroke="${C.red}" stroke-width="2.2" stroke-linecap="round"/><path d="M1.6 -${len - 2} q ${L2 ? 16 : 14} 2 ${L2 ? 13 : 11} ${L2 ? 24 : 21}" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" opacity=".9"/></g>`;
    }
    return `<g>${sh(34, 12)}
      <path d="M${-botW} 0 L${-botW + 2} -17 H${botW - 2} L${botW} 0Z" fill="${P.brick}" stroke="${P.brickLo}" stroke-width="1.4"/><path d="M${-botW} 0 L${-botW + 2} -17 H${botW - 2} L${botW} 0Z" fill="url(#pBrick)"/>
      <path d="M${-botW + 3} -17 L${-topW} ${-h} H${topW} L${botW - 3} -17Z" fill="${bc}" stroke="${P.ironLo}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M${-botW + 3} -17 L${-topW} ${-h} H${topW} L${botW - 3} -17Z" fill="url(#pPlank)"/>
      <path d="M${-botW + 7} -22 L${-topW + 2} ${-h + 4}" stroke="#fff" stroke-width="3" opacity=".3" stroke-linecap="round"/>
      <path d="M${-(botW - 3 - (botW - 3 - topW) * 0.5)} ${-17 - (h - 17) * 0.5} H${botW - 3 - (botW - 3 - topW) * 0.5}" stroke="${bl}" stroke-width="5" opacity=".9"/>
      <path d="M${-8} 0 V-11 Q0 -19 8 -11 V0Z" fill="#8a5a34" stroke="${P.ironLo}" stroke-width="1.2"/>
      <circle cx="0" cy="${-h * 0.45}" r="5.6" fill="${state === 'lit' ? 'url(#gWinLit)' : state === 'out' ? '#ecd9a3' : '#b3c2d0'}" stroke="${C.brassLo}" stroke-width="1.6"/>
      ${L2 ? `<rect x="${-topW - 6}" y="${-h * 0.72}" width="${(topW + 6) * 2}" height="4" rx="2" fill="url(#gBrass)"/>` : ''}
      <path d="M${-topW - 5} ${-h + 1} Q0 ${-h - 26} ${topW + 5} ${-h + 1}Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.4"/>
      <path d="M${-topW - 5} ${-h + 1} Q0 ${-h - 26} ${topW + 5} ${-h + 1}Z" fill="${P.verd}" opacity=".5"/>
      ${snowTop(-topW - 3, topW + 3, -h - 6, 3)}
      <g transform="translate(${hub[0]} ${hub[1]})">${sails}<circle r="6.4" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.5"/>${K1.shine(-2, -2.4, 2.2, 1.5)}</g>
      ${state === 'off' ? badge(0, -h - 56) : ''}
    </g>`;
  }

  // ------------------------------------------------------------ BEACON (tall dark iron lattice, brass lantern)
  function beacon({ state = 'lit' } = {}) {
    const on = state === 'lit';
    return `<g>${sh(26, 9)}
      <path d="M-14 0 L-10 -12 H10 L14 0Z" fill="${P.iron}" stroke="${P.ironLo}" stroke-width="1.4"/>${rivets(-9, 9, -6, 4)}
      <path d="M-9 -12 L-3.5 -86 M9 -12 L3.5 -86" stroke="${P.ironLo}" stroke-width="3.6" stroke-linecap="round"/><path d="M-9 -12 L-3.5 -86 M9 -12 L3.5 -86" stroke="${P.iron}" stroke-width="2" stroke-linecap="round"/>
      <path d="M-8 -22 L7 -40 M8 -22 L-7 -40 M-6 -42 L5 -60 M6 -42 L-5 -60 M-4.6 -62 L3.6 -78 M4.6 -62 L-3.6 -78" stroke="${P.ironHi}" stroke-width="1.6"/>
      <rect x="-9" y="-48" width="18" height="3.4" rx="1.6" fill="url(#gBrass)"/>
      ${K1.gear(0, -30, 5.6, 8, 'url(#gCopper)', on ? 14 : 0)}
      <rect x="-12" y="-88" width="24" height="5" rx="2" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1"/>
      <rect x="-10" y="-106" width="20" height="18" rx="5" fill="${on ? 'url(#gWinLit)' : state === 'out' ? '#ecd9a3' : '#b9c7d4'}" stroke="${C.brass}" stroke-width="2"/>
      ${on ? `<circle cx="0" cy="-97" r="4" fill="#fffdf0"/>` : ''}
      ${K1.shine(-5, -102, 2.6, 1.6, -35, 0.9)}
      <path d="M-13 -106 L0 -118 L13 -106Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.3"/><path d="M-13 -106 L0 -118 L13 -106Z" fill="${P.verd}" opacity=".5"/>
      ${snowTop(-8, 8, -112, 2.2)}
      ${state === 'off' ? badge(0, -134) : ''}
    </g>`;
  }

  // ---------------------------------------------- extra skyline pieces for the metropolis (not Wave 1 content)
  function clockTower({ state = 'lit' } = {}) {
    return `<g>${sh(30, 10)}
      ${wall(19, 96, 'brick', 8)}
      ${rivets(-17, 17, -60, 5)}<rect x="-19" y="-62" width="38" height="3" fill="${P.iron}"/>
      <circle cx="0" cy="-76" r="11" fill="#fff8e6" stroke="url(#gBrass)" stroke-width="3"/><path d="M0 -76 v-7 M0 -76 l5 2.6" stroke="${P.ironLo}" stroke-width="1.8" stroke-linecap="round"/>
      ${win(0, -40, 9, 14, state, { arch: true })}${door(0, 11, 18, '#8a5a34')}
      ${roof('cone', 21, -96, 'verd', 34)}
      ${snowTop(-21, 21, -97, 3)}
    </g>`;
  }
  function cottage({ state = 'lit', c = 'teal', r = 'red', h = 30, w = 22, chim = 'brick', flowers = true } = {}) {
    return `<g>${sh(w + 8, 11)}
      ${wall(w, h, 'wood:' + c)}
      ${roof('gable', w, -h, r, 16 + h * 0.12)}
      ${win(-w * 0.45, -h * 0.5, 10, 11, state, { flowers })}${door(w * 0.4, 10, 19, '#8a5a34')}
      ${chim === 'brick' ? chimBrick(w * 0.55, -h - 10, 14, state) : chimPipe(w * 0.55, -h - 12, 16, state)}
    </g>`;
  }
  function workshop({ state = 'lit', w = 26, h = 28 } = {}) {
    return `<g>${sh(w + 8, 11)}
      ${wall(w, h, 'brick')}${roof('flat', w, -h, 'iron' in {} ? 'slate' : 'slate')}
      <path d="M${-w + 4} ${-h - 6} h${w} l-3 -9 h${-w + 6}Z" fill="url(#gGlass)" stroke="${P.ironLo}" stroke-width="1.2"/>
      ${win(-w * 0.5, -h * 0.5, 9, 11, state)}${win(w * 0.05, -h * 0.5, 9, 11, state)}${door(w * 0.6, 9, 16, '#5a7aa6')}
      ${chimPipe(w * 0.62, -h - 22, 18, state)}${pipe(w * 0.62, -h - 4, w * 0.62, -h + 4)}
    </g>`;
  }
  function townhouse({ state = 'lit', c = 'plum', r = 'slate' } = {}) {
    return `<g>${sh(28, 10)}
      ${wall(17, 66, 'wood:' + c, 8)}${roof('gable', 17, -66, r, 18)}
      ${win(-6, -52, 8, 10, state)}${win(7, -52, 8, 10, state)}${win(-6, -32, 8, 10, state, { flowers: true })}${win(7, -32, 8, 10, state)}${door(0, 9, 17, '#8a5a34')}
      ${chimBrick(10, -88, 14, state)}
    </g>`;
  }
  function greenhouse({ state = 'lit' } = {}) {
    return `<g>${sh(34, 11)}
      <rect x="-26" y="-22" width="52" height="22" rx="4" fill="url(#gGlass)" stroke="${P.ironLo}" stroke-width="1.6"/>
      <path d="M-26 -22 Q-26 -44 0 -44 Q26 -44 26 -22Z" fill="url(#gGlass)" stroke="${P.ironLo}" stroke-width="1.6"/>
      <path d="M-13 0 V-40 M0 0 V-44 M13 0 V-40 M-26 -22 H26" stroke="${P.ironLo}" stroke-width="1.2" opacity=".8"/>
      ${[-16, -6, 6, 16].map((x, i) => `<circle cx="${x}" cy="-8" r="5" fill="${['#8fd18b', '#ff8da1', '#8fd18b', '#f7c85a'][i]}" opacity=".95"/>`).join('')}
      ${snowTop(-14, 14, -42, 3)}
    </g>`;
  }
  function waterTank({ state = 'lit' } = {}) {
    return `<g>${sh(24, 9)}
      <path d="M-14 0 L-10 -34 M14 0 L10 -34 M0 0 V-34" stroke="${P.ironLo}" stroke-width="3"/><path d="M-12 -14 L10 -26 M12 -14 L-10 -26" stroke="${P.ironHi}" stroke-width="1.4"/>
      <rect x="-17" y="-60" width="34" height="28" rx="8" fill="${P.iron}" stroke="${P.ironLo}" stroke-width="1.5"/>${rivets(-14, 14, -46, 5)}<rect x="-17" y="-52" width="34" height="3" fill="url(#gBrass)"/>
      <path d="M-19 -58 Q0 -76 19 -58Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.3"/><path d="M-19 -58 Q0 -76 19 -58Z" fill="${P.verd}" opacity=".5"/>
      ${snowTop(-14, 14, -68, 2.6)}${pipe(17, -44, 24, -2, 2)}
    </g>`;
  }

  // -------------------------------------------------------- roads and tile bases
  // a road ring around a building (inside the tile), snow-dusted; rx/ry tuned per zoom by the caller
  const roadRing = (cx, cy, rx, ry, wd) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#bda88e" stroke-width="${wd + 3}"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#efe3cf" stroke-width="${wd}"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-width="${Math.max(1, wd * 0.3)}" stroke-dasharray="${wd * 1.4} ${wd * 2.2}" stroke-linecap="round" opacity=".9"/>`;
  const roadLink = (x0, y0, x1, y1, wd) => `<path d="M${x0} ${y0} L${x1} ${y1}" stroke="#bda88e" stroke-width="${wd + 3}" stroke-linecap="round"/><path d="M${x0} ${y0} L${x1} ${y1}" stroke="#efe3cf" stroke-width="${wd}" stroke-linecap="round"/><path d="M${x0} ${y0} L${x1} ${y1}" stroke="#fff" stroke-width="${Math.max(1, wd * 0.3)}" stroke-dasharray="${wd * 1.4} ${wd * 2.2}" stroke-linecap="round" opacity=".9"/>`;

  g.KIT2 = { P, defs2, sorter, depot, bench, windmill, beacon, clockTower, cottage, workshop, townhouse, greenhouse, waterTank, roadRing, roadLink, win, snowTop };
})(typeof window !== 'undefined' ? window : globalThis);
