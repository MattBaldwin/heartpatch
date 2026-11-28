// Clockwork Isle mockup kit: hand-drawn SVG props in a soft vinyl-toy look.
// Every prop is drawn around (0,0) = centre of its base, y up is negative, ~100 units wide.
// state: 'lit' (working, warm glow, steam, blades turning) | 'out' (powered, idle: dim bulb, still)
//        | 'off' (unpowered: cold, dark bulb, dangling wire + badge)
(function (g) {
  const C = {
    brass: '#e3a93a', brassHi: '#ffe08a', brassLo: '#a8721f',
    copper: '#cf7a43', copperHi: '#f2a56c', copperLo: '#8f4a28',
    wood: '#b9824f', woodHi: '#dba873', woodLo: '#7d5030',
    wool: '#f7ecdc', woolLo: '#e1cfb8', red: '#dc5a64', redLo: '#a83a48',
    ink: '#6b5a73', glow: '#ffd27a', snow: '#ffffff', frost: '#dff3ff', frostLo: '#b6d9ee',
    teal: '#6cc4c9', tealLo: '#3d98a0',
  };
  let uid = 0;
  const id = (p) => `${p}${++uid}`;

  // Shared gradient defs (include once per SVG).
  const defs = () => `
  <defs>
    <linearGradient id="gBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.brassHi}"/><stop offset=".55" stop-color="${C.brass}"/><stop offset="1" stop-color="${C.brassLo}"/></linearGradient>
    <linearGradient id="gCopper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.copperHi}"/><stop offset=".6" stop-color="${C.copper}"/><stop offset="1" stop-color="${C.copperLo}"/></linearGradient>
    <linearGradient id="gWood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.woodHi}"/><stop offset=".5" stop-color="${C.wood}"/><stop offset="1" stop-color="${C.woodLo}"/></linearGradient>
    <linearGradient id="gWool" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${C.woolLo}"/></linearGradient>
    <linearGradient id="gRed" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a92"/><stop offset="1" stop-color="${C.redLo}"/></linearGradient>
    <linearGradient id="gCold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9e4ee"/><stop offset="1" stop-color="#8fa2b6"/></linearGradient>
    <radialGradient id="gGlow"><stop offset="0" stop-color="#fff3c4" stop-opacity=".95"/><stop offset=".45" stop-color="${C.glow}" stop-opacity=".55"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="gShadow"><stop offset="0" stop-color="#3b2a52" stop-opacity=".38"/><stop offset="1" stop-color="#3b2a52" stop-opacity="0"/></radialGradient>
    <radialGradient id="gSnowGround"><stop offset="0" stop-color="#fff"/><stop offset=".8" stop-color="#eef7ff"/><stop offset="1" stop-color="#d4e8f6"/></radialGradient>
    <linearGradient id="gCone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".85"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></linearGradient>
    <radialGradient id="gCone2"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".55"/><stop offset=".6" stop-color="#ffd27a" stop-opacity=".28"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="1.2"/></filter>
    <filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>`;

  const shadow = (rx = 46, ry = 14) => `<ellipse cx="3" cy="3" rx="${rx}" ry="${ry}" fill="url(#gShadow)"/>`;
  const glow = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#gGlow)"/>`;
  const shine = (x, y, rx, ry, rot = -25, o = 0.7) =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff" opacity="${o}" transform="rotate(${rot} ${x} ${y})"/>`;
  const snowCap = (d) => `<path d="${d}" fill="#fff" stroke="#d5e9f7" stroke-width="1.2" stroke-linejoin="round"/>`;
  const gear = (cx, cy, r, teeth = 8, fill = 'url(#gBrass)', rot = 0) => {
    let p = '';
    for (let i = 0; i < teeth; i++) {
      p += `<rect x="${-r * 0.2}" y="${-r * 1.28}" width="${r * 0.4}" height="${r * 0.5}" rx="${r * 0.12}" transform="rotate(${(360 / teeth) * i})"/>`;
    }
    return `<g transform="translate(${cx} ${cy}) rotate(${rot})" fill="${fill}" stroke="${C.brassLo}" stroke-width="${Math.max(0.8, r * 0.07)}">
      ${p}<circle r="${r}"/><circle r="${r * 0.42}" fill="${C.copperLo}" stroke="none" opacity=".55"/><circle r="${r * 0.2}" fill="#fff" stroke="none" opacity=".6"/></g>`;
  };
  const steam = (x, y, n = 3, s = 1) => {
    let o = '';
    for (let i = 0; i < n; i++) {
      o += `<circle cx="${x + i * 5 * s - 4 * s}" cy="${y - i * 12 * s}" r="${(6 + i * 2.2) * s}" fill="#fff" opacity="${0.85 - i * 0.2}"/>`;
    }
    return o;
  };
  const badge = (x, y, text = '⚡') =>
    `<g transform="translate(${x} ${y})"><circle r="9" fill="#fff1d6" stroke="${C.brassLo}" stroke-width="1.4"/><text y="4" text-anchor="middle" font-size="11">${text}</text></g>`;
  const frostSparkles = (pts) =>
    pts.map(([x, y, s]) => `<path d="M${x} ${y - s}L${x + s * 0.28} ${y - s * 0.28}L${x + s} ${y}L${x + s * 0.28} ${y + s * 0.28}L${x} ${y + s}L${x - s * 0.28} ${y + s * 0.28}L${x - s} ${y}L${x - s * 0.28} ${y - s * 0.28}Z" fill="#fff" opacity=".9"/>`).join('');
  const bulb = (cx, cy, r, state) => {
    const on = state === 'lit';
    const dim = state === 'out';
    return `${on ? glow(cx, cy, r * 3.4) : ''}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${on ? '#fff3b8' : dim ? '#e9d9a6' : '#b8c6d3'}" stroke="${on ? C.brass : '#8a98a6'}" stroke-width="1.3"/>
      <rect x="${cx - r * 0.55}" y="${cy + r * 0.8}" width="${r * 1.1}" height="${r * 0.7}" rx="1.5" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width=".8"/>
      ${shine(cx - r * 0.3, cy - r * 0.3, r * 0.28, r * 0.18, -35, 0.85)}`;
  };

  // ---------------------------------------------------------------- Windmill
  // level 1: small tower, 4 sails. level 2: taller, 6 sails, brass ring, bigger. wind: 1..3 changes sail tilt label only.
  function windmill({ level = 1, state = 'lit', frostBlades = true, rot = 0 } = {}) {
    const L2 = level === 2;
    const h = L2 ? 92 : 70;
    const topW = L2 ? 20 : 17, botW = L2 ? 36 : 32;
    const hub = [0, -h - 6];
    const n = L2 ? 6 : 4;
    const bodyFill = state === 'off' ? 'url(#gWood)' : 'url(#gWood)';
    let sails = '';
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i + rot + (state === 'lit' ? 0 : 12);
      const len = L2 ? 44 : 38;
      sails += `<g transform="rotate(${a})">
        <rect x="-1.8" y="-${len}" width="3.6" height="${len}" rx="1.6" fill="url(#gBrass)"/>
        <path d="M2 -${len - 2} q ${L2 ? 17 : 15} ${L2 ? 2 : 4} ${L2 ? 14 : 12} ${L2 ? 24 : 22} L 2 -12 Z" fill="url(#gWool)" stroke="${C.woolLo}" stroke-width="1"/>
        <path d="M5 -${len - 8} q ${L2 ? 9 : 8} 2 ${L2 ? 8 : 7} 12" fill="none" stroke="${C.red}" stroke-width="2.2" stroke-linecap="round" opacity=".85"/>
        ${frostBlades ? `<path d="M2 -${len - 2} q ${L2 ? 17 : 15} ${L2 ? 2 : 4} ${L2 ? 14 : 12} ${L2 ? 24 : 22}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".95"/>` : ''}
      </g>`;
    }
    const motion = state === 'lit'
      ? `<g opacity=".28"><circle cx="${hub[0]}" cy="${hub[1]}" r="${L2 ? 42 : 36}" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="10 14"/></g>` : '';
    return `<g>${shadow(50, 15)}
      ${state === 'lit' ? glow(0, -h * 0.35, 46) : ''}
      <path d="M${-botW} 0 Q${-botW - 3} -6 ${-botW + 4} -10 L${-topW} ${-h} L${topW} ${-h} L${botW - 4} -10 Q${botW + 3} -6 ${botW} 0 Z" fill="${bodyFill}" stroke="${C.woodLo}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M${-botW + 5} -4 L${-topW + 3} ${-h + 4}" stroke="#fff" stroke-width="3.5" opacity=".28" stroke-linecap="round"/>
      ${[0.3, 0.62].map((t) => `<path d="M${-(botW - (botW - topW) * t) + 1} ${-h * t} L${botW - (botW - topW) * t - 1} ${-h * t}" stroke="${C.woodLo}" stroke-width="1.2" opacity=".5"/>`).join('')}
      ${L2 ? `<path d="M${-botW + 8} ${-h * 0.5} L${botW - 8} ${-h * 0.5}" stroke="url(#gBrass)" stroke-width="5" stroke-linecap="round"/>` : ''}
      <path d="M${-8} 0 L${-8} -17 Q0 -26 8 -17 L8 0 Z" fill="${C.woodLo}" stroke="${C.ink}" stroke-width="1" opacity=".9"/>
      <circle cx="0" cy="${-h * 0.56}" r="${L2 ? 7 : 6}" fill="${state === 'lit' ? '#fff3b8' : state === 'out' ? '#eadcae' : '#b9c7d4'}" stroke="${C.brassLo}" stroke-width="1.6"/>
      ${state === 'lit' ? glow(0, -h * 0.56, 22) : ''}
      <path d="M${-topW - 6} ${-h + 2} Q0 ${-h - 30} ${topW + 6} ${-h + 2} Q0 ${-h - 2} ${-topW - 6} ${-h + 2} Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.5"/>
      ${snowCap(`M${-topW - 4} ${-h + 0} Q0 ${-h - 30} ${topW + 4} ${-h + 0} Q${topW - 4} ${-h - 10} 0 ${-h - 15} Q${-topW + 4} ${-h - 10} ${-topW - 4} ${-h} Z`)}
      ${snowCap(`M${-botW - 2} -2 Q${-botW + 10} -14 ${-botW + 20} -6 Q0 -16 ${botW - 20} -6 Q${botW - 10} -14 ${botW + 2} -2 Q0 6 ${-botW - 2} -2 Z`)}
      <g transform="translate(${hub[0]} ${hub[1]})">${sails}
        <circle r="7" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.5"/>${shine(-2, -2.5, 2.4, 1.6)}</g>
      ${state === 'off' ? badge(0, -h - 52) : ''}
    </g>`;
  }

  // ------------------------------------------------------------------ Sorter
  function sorter({ state = 'lit', frost = true } = {}) {
    const on = state === 'lit';
    return `<g>${shadow(54, 15)}
      ${on ? glow(0, -28, 50) : ''}
      <rect x="-40" y="-46" width="80" height="46" rx="12" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1.6"/>
      <path d="M-34 -42 L-34 -6" stroke="#fff" stroke-width="4" opacity=".25" stroke-linecap="round"/>
      <path d="M-44 -46 L-22 -78 L22 -78 L44 -46 Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.6" stroke-linejoin="round"/>
      ${snowCap('M-40 -48 L-24 -74 L24 -74 L40 -48 Q28 -58 14 -54 Q0 -62 -14 -54 Q-28 -58 -40 -48 Z')}
      <rect x="-26" y="-92" width="52" height="16" rx="8" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.4"/>
      ${shine(-14, -88, 7, 2.4, 0, 0.8)}
      ${[['#7fd18b', -22], ['#f7c85a', 0], ['#ff8da1', 22]].map(([c, x]) => `<circle cx="${x}" cy="-96" r="6" fill="${state === 'off' ? '#b8c6d3' : c}" stroke="#fff" stroke-width="1.3" opacity="${state === 'off' ? 1 : 0.95}"/>`).join('')}
      <rect x="-30" y="-36" width="38" height="24" rx="8" fill="${on ? '#fff0b4' : state === 'out' ? '#e8d9ae' : '#aebccb'}" stroke="${C.brassLo}" stroke-width="1.6"/>
      ${on ? glow(-11, -24, 24) : ''}
      <path d="M-24 -20 h26" stroke="${C.woodLo}" stroke-width="1.4" opacity=".5"/><path d="M-11 -34 v20" stroke="${C.woodLo}" stroke-width="1.4" opacity=".5"/>
      ${gear(22, -26, 10, 8, 'url(#gBrass)', on ? 10 : 0)}
      ${gear(34, -12, 6, 7, 'url(#gCopper)', on ? -14 : 8)}
      <rect x="36" y="-70" width="10" height="26" rx="4" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.2"/>
      <ellipse cx="41" cy="-70" rx="6" ry="2.4" fill="${C.copperLo}"/>
      ${on ? steam(41, -78, 3, 1) : ''}
      <rect x="-56" y="-12" width="22" height="9" rx="4.5" fill="${C.ink}" opacity=".85"/>
      <circle cx="-52" cy="-7.5" r="2.6" fill="${C.brassHi}"/><circle cx="-44" cy="-7.5" r="2.6" fill="${C.brassHi}"/><circle cx="-36" cy="-7.5" r="2.6" fill="${C.brassHi}"/>
      ${on ? `<rect x="-52" y="-20" width="9" height="8" rx="2.5" fill="${C.red}" stroke="${C.redLo}" stroke-width="1"/><rect x="-40" y="-18" width="9" height="6" rx="2.5" fill="#7fd18b" stroke="#3d9b58" stroke-width="1"/>` : ''}
      ${state === 'off' ? `<path d="M-40 -34 q-16 4 -14 20 q 2 12 -8 18" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="-62" cy="5" r="3" fill="${C.brassHi}" stroke="${C.ink}"/>${badge(0, -118)}` : ''}
      ${state === 'out' ? `<text x="30" y="-96" font-size="13" fill="${C.ink}" font-weight="800">z</text><text x="40" y="-106" font-size="10" fill="${C.ink}" font-weight="800">z</text>` : ''}
      ${snowCap('M-44 -2 Q-34 -12 -22 -4 Q-8 -10 8 -4 Q22 -12 34 -4 Q42 -10 46 -2 Q0 8 -44 -2Z')}
    </g>`;
  }

  // ------------------------------------------------------------- Rail Depot
  function cart({ loaded = true, state = 'lit' } = {}) {
    return `<g>
      <ellipse cx="0" cy="4" rx="22" ry="5" fill="url(#gShadow)"/>
      <path d="M-20 -14 L20 -14 L16 -2 L-16 -2 Z" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M-20 -14 L20 -14" stroke="url(#gBrass)" stroke-width="3" stroke-linecap="round"/>
      ${loaded ? `<circle cx="-8" cy="-19" r="6" fill="${C.red}"/><circle cx="3" cy="-21" r="6.5" fill="#7fd18b"/><circle cx="12" cy="-18" r="5" fill="#f7c85a"/>${shine(-10, -21, 2, 1.2)}${shine(1, -23.5, 2, 1.2)}` : ''}
      <circle cx="-11" cy="0" r="5" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.3"/><circle cx="11" cy="0" r="5" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.3"/>
      <circle cx="-11" cy="0" r="1.6" fill="${C.copperLo}"/><circle cx="11" cy="0" r="1.6" fill="${C.copperLo}"/>
      ${snowCap('M-20 -14 Q-14 -18 -6 -14 Q4 -17 12 -14 Q16 -16 20 -14 L18 -11 Q0 -9 -18 -11Z')}
    </g>`;
  }
  function railDepot({ level = 1, state = 'lit', withCart = true } = {}) {
    const on = state === 'lit';
    return `<g>${shadow(60, 16)}
      ${on ? glow(-14, -30, 50) : ''}
      <rect x="-50" y="-50" width="70" height="50" rx="10" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1.6"/>
      ${[-36, -22, -8, 6].map((x) => `<path d="M${x} -48 L${x} -2" stroke="${C.woodLo}" stroke-width="1.2" opacity=".45"/>`).join('')}
      <path d="M-58 -48 L-15 -84 L28 -48 Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.6" stroke-linejoin="round"/>
      ${snowCap('M-54 -50 L-15 -80 L24 -50 Q10 -60 -4 -55 Q-18 -63 -32 -55 Q-44 -60 -54 -50Z')}
      <rect x="-34" y="-34" width="38" height="32" rx="6" fill="${on ? '#fff0b4' : state === 'out' ? '#e8d9ae' : '#aebccb'}" stroke="${C.brassLo}" stroke-width="1.6"/>
      <path d="M-34 -18 L4 -18 M-15 -34 L-15 -2" stroke="${C.woodLo}" stroke-width="2" opacity=".6"/>
      ${on ? glow(-15, -18, 28) : ''}
      <circle cx="-15" cy="-62" r="8" fill="#fff8e6" stroke="${C.brassLo}" stroke-width="2"/><path d="M-15 -62 v-5 M-15 -62 l4 2" stroke="${C.ink}" stroke-width="1.6" stroke-linecap="round"/>
      ${level === 2 ? gear(14, -66, 7, 8, 'url(#gBrass)', 8) : ''}
      <path d="M22 -2 L84 -2" stroke="${C.woodLo}" stroke-width="0" />
      <g transform="translate(46 -2)">${[0, 16, 32].map((x) => `<rect x="${x - 4}" y="-3" width="8" height="${9}" rx="2" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1"/>`).join('')}
        <path d="M-6 -1 L40 -1 M-6 3 L40 3" stroke="url(#gBrass)" stroke-width="2.4" stroke-linecap="round"/></g>
      ${withCart ? `<g transform="translate(58 -6) scale(.95)">${cart({ loaded: state !== 'off' })}</g>` : ''}
      ${snowCap('M-52 -2 Q-40 -10 -26 -4 Q-10 -9 6 -4 Q16 -9 22 -2 Q-14 6 -52 -2Z')}
      ${state === 'off' ? badge(-15, -98) : ''}
    </g>`;
  }

  // ----------------------------------------------------------- Research Bench
  function bench({ state = 'lit' } = {}) {
    const on = state === 'lit';
    return `<g>${shadow(44, 13)}
      ${on ? glow(0, -34, 44) : ''}
      <path d="M-38 -34 L38 -34 L34 -26 L-34 -26 Z" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1.4" stroke-linejoin="round"/>
      <rect x="-34" y="-28" width="68" height="8" rx="3" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1.4"/>
      <rect x="-30" y="-20" width="8" height="20" rx="3" fill="${C.woodLo}"/><rect x="22" y="-20" width="8" height="20" rx="3" fill="${C.woodLo}"/>
      ${gear(-30, -44, 7, 8, 'url(#gBrass)', 6)}
      <circle cx="24" cy="-46" r="8" fill="#fff" fill-opacity=".45" stroke="${C.brass}" stroke-width="2.4"/><path d="M29.5 -40.5 l7 7" stroke="${C.brassLo}" stroke-width="3" stroke-linecap="round"/>
      <path d="M36 -30 L36 -70" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M36 -70 q -6 -8 -16 -4" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>
      ${bulb(16, -72, 6, state)}
      ${snowCap('M-36 -34 Q-30 -39 -26 -35 Q-14 -39 -8 -34 Q8 -36 16 -34 Q26 -38 38 -33 Q0 -29 -36 -34Z')}
      <g>${on ? glow(-4, -50, 26) : ''}
        <path d="M-26 -42 L8 -54 L26 -43 L-8 -31 Z" fill="${state === 'off' ? '#d3dbe4' : on ? '#ffffff' : '#eaf3fb'}" stroke="${state === 'off' ? '#8fa2b6' : '#4f8fc0'}" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M-18 -41 L6 -49 M-14 -38 L12 -47 M-10 -35 L14 -43" stroke="${state === 'off' ? '#9aa9b9' : '#4f8fc0'}" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="-2" cy="-43" r="4.2" fill="none" stroke="${state === 'off' ? '#9aa9b9' : C.brassLo}" stroke-width="1.5"/>
        ${on ? frostSparkles([[18, -52, 4], [-24, -50, 3]]) : ''}</g>
      ${state === 'off' ? badge(0, -92) : ''}
    </g>`;
  }

  // ------------------------------------------------------------------ Beacon
  function beacon({ state = 'lit', cone = false } = {}) {
    const on = state === 'lit';
    return `<g>${shadow(30, 10)}
      ${''}
      <rect x="-5" y="-86" width="10" height="84" rx="4" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.3"/>
      <path d="M-18 0 Q-18 -14 -8 -20 L8 -20 Q18 -14 18 0 Z" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1.5"/>
      ${gear(0, -46, 9, 8, 'url(#gCopper)', on ? 14 : 0)}
      ${on ? glow(0, -102, 60) : ''}
      <path d="M-14 -88 L14 -88 L10 -80 L-10 -80 Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.3"/>
      <circle cx="0" cy="-100" r="15" fill="${on ? '#fff4bd' : state === 'out' ? '#eadcae' : '#b9c7d4'}" stroke="${C.brass}" stroke-width="2.4"/>
      ${on ? `<circle cx="0" cy="-100" r="8" fill="#fffdf0"/>` : ''}
      ${shine(-5, -106, 4.4, 2.6, -35, 0.9)}
      <path d="M-12 -112 Q0 -126 12 -112 Q0 -108 -12 -112Z" fill="url(#gCopper)" stroke="${C.copperLo}" stroke-width="1.2"/>
      ${snowCap('M-12 -112 Q0 -128 12 -112 Q4 -115 0 -118 Q-4 -115 -12 -112Z')}
      ${state === 'off' ? badge(0, -134) : ''}
      ${snowCap('M-20 -2 Q-12 -10 -4 -3 Q4 -9 12 -3 Q16 -8 20 -2 Q0 5 -20 -2Z')}
    </g>`;
  }

  // ------------------------------------------------------------- Wire + Rail
  // post: small wood post with a glass insulator
  function post(lit) {
    return `<g>
      <ellipse cx="2" cy="2" rx="9" ry="3" fill="url(#gShadow)"/>
      <rect x="-3" y="-30" width="6" height="30" rx="2.5" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="1"/>
      <rect x="-9" y="-28" width="18" height="4" rx="2" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width=".8"/>
      <circle cx="-7" cy="-31" r="3" fill="${lit ? '#fff3b8' : '#cfe0ef'}" stroke="${C.brassLo}" stroke-width="1"/>
      <circle cx="7" cy="-31" r="3" fill="${lit ? '#fff3b8' : '#cfe0ef'}" stroke="${C.brassLo}" stroke-width="1"/>
      ${lit ? glow(0, -31, 14) : ''}
      <path d="M-4 -34 Q0 -39 4 -34 Q0 -32 -4 -34Z" fill="#fff"/>
    </g>`;
  }
  // wire path: a list of [x,y] screen points; posts at each, drooping wire between.
  function wirePath(pts, { lit = true, endUnlit = null } = {}) {
    let s = '';
    const top = (p) => [p[0], p[1] - 31];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = top(pts[i]), b = top(pts[i + 1]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + 9;
      const segLit = endUnlit !== null ? i < endUnlit : lit;
      if (segLit) s += `<path d="M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}" fill="none" stroke="${C.glow}" stroke-width="7" opacity=".55" filter="url(#soft)"/>`;
      s += `<path d="M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}" fill="none" stroke="${segLit ? '#fff0b0' : '#7f8da0'}" stroke-width="2.4" stroke-linecap="round" ${segLit ? '' : 'stroke-dasharray="1 0"'}/>`;
      if (segLit) s += `<path d="M${a[0]} ${a[1]} Q${mx} ${my} ${b[0]} ${b[1]}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="3 9" stroke-linecap="round"/>`;
    }
    const order = [...pts.keys()].sort((i, j) => pts[i][1] - pts[j][1]);
    const posts = order.map((i) => `<g transform="translate(${pts[i][0]} ${pts[i][1]})">${post(endUnlit !== null ? i <= endUnlit : lit)}</g>`).join('');
    return posts + s;
  }
  // rail: sleepers + two brass rails along a polyline; `scale` may be a number or fn(y) for perspective.
  function railPath(pts, { snowy = true, scale = 1 } = {}) {
    let s = '', rails = '';
    const f = typeof scale === 'function' ? scale : () => scale;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const sc = f((y0 + y1) / 2);
      const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx), nx = -Math.sin(ang), ny = Math.cos(ang);
      const w = 11 * sc, n = Math.max(1, Math.round(d / (13 * sc)));
      for (let q = 0; q <= n; q++) {
        const t = q / n, cx = x0 + dx * t, cy = y0 + dy * t;
        s += `<g transform="translate(${cx} ${cy}) rotate(${(ang * 180) / Math.PI + 90})"><rect x="${-w}" y="${-2.8 * sc}" width="${w * 2}" height="${5.6 * sc}" rx="${2.4 * sc}" fill="url(#gWood)" stroke="${C.woodLo}" stroke-width="${0.8 * sc}"/>${snowy ? `<rect x="${-w + 2}" y="${-2.8 * sc}" width="${w * 2 - 4}" height="${2 * sc}" rx="1" fill="#fff" opacity=".9"/>` : ''}</g>`;
      }
      const o = 5 * sc;
      const seg = `M${x0 + nx * o} ${y0 + ny * o} L${x1 + nx * o} ${y1 + ny * o} M${x0 - nx * o} ${y0 - ny * o} L${x1 - nx * o} ${y1 - ny * o}`;
      rails += `<path d="${seg}" stroke="${C.brassLo}" stroke-width="${3.8 * sc}" stroke-linecap="round" stroke-linejoin="round"/><path d="${seg}" stroke="url(#gBrass)" stroke-width="${2.2 * sc}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return `<g>${s}${rails}</g>`;
  }

  // ------------------------------------------------------ ground disc + wind
  const ground = (rx = 60, ry = 36, snow = true) => `<ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" fill="${snow ? 'url(#gSnowGround)' : C.woolLo}" stroke="#cfe5f3" stroke-width="2" opacity=".96"/>
    <ellipse cx="0" cy="0" rx="${rx - 8}" ry="${ry - 6}" fill="none" stroke="${C.wood}" stroke-width="3" stroke-dasharray="1 9" stroke-linecap="round" opacity=".7"/>`;

  // wind chevron arrow, strength 1..3 (bigger + more opaque + more tint)
  function windArrow(strength, x, y, rot = -20) {
    const s = [0, 0.8, 1.15, 1.55][strength];
    const col = ['', '#b9e1f5', '#7cc6ec', '#3a9bd8'][strength];
    const o = [0, 0.55, 0.72, 0.9][strength];
    return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" opacity="${o}">
      <path d="M-16 -3 H10 M-16 3 H4" stroke="${col}" stroke-width="3.4" stroke-linecap="round" fill="none"/>
      <path d="M2 -9 L14 0 L2 9" stroke="${col}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M-16 -3 H10 M2 -9 L14 0 L2 9" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".8"/>
    </g>`;
  }

  g.KIT = { C, defs, windmill, sorter, railDepot, cart, bench, beacon, post, wirePath, railPath, ground, windArrow, badge, gear, glow, steam, bulb, shadow, snowCap, shine, frostSparkles };
})(typeof window !== 'undefined' ? window : globalThis);
