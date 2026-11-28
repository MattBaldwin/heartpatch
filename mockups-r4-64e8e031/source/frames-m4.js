(function (g) {
  const K = g.KIT, C = K.C;
  const FONT = `-apple-system,'SF Pro Rounded','Nunito',system-ui,sans-serif`;
  const ink = '#6b5a73';
  const svg = (W, H, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${K.defs()}${SQDEFS}${inner}</svg>`;
  const SQDEFS = `<defs>
    <radialGradient id="gGearbit" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#f9cf86"/><stop offset=".5" stop-color="#e49a45"/><stop offset="1" stop-color="#b9672a"/></radialGradient>
    <radialGradient id="gGearbitBelly" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#fdebc8"/><stop offset="1" stop-color="#f1c98a"/></radialGradient>
    <radialGradient id="gBulbun" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e9ddfb"/><stop offset="1" stop-color="#c3aee8"/></radialGradient>
    <linearGradient id="gBgDay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f3fb"/><stop offset="1" stop-color="#fdeef4"/></linearGradient>
    <linearGradient id="gArena" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe9f7"/><stop offset=".5" stop-color="#eaf6fd"/><stop offset="1" stop-color="#fdf1f6"/></linearGradient>
  </defs>`;

  const eye = (x, y, r = 8, look = 0, brave = false) => `<g>
    <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.12}" fill="#3a2a4a"/>
    <ellipse cx="${x + look}" cy="${y + 1}" rx="${r * 0.78}" ry="${r * 0.92}" fill="#4d3866"/>
    <circle cx="${x - r * 0.3 + look}" cy="${y - r * 0.4}" r="${r * 0.38}" fill="#fff"/>
    <circle cx="${x + r * 0.35 + look}" cy="${y + r * 0.35}" r="${r * 0.17}" fill="#fff" opacity=".9"/>
    ${brave ? `<path d="M${x - r * 1.2} ${y - r * 1.5} L${x + r * 1.1} ${y - r * 1.05}" stroke="#3a2a4a" stroke-width="2.4" stroke-linecap="round" transform="${x < 0 ? '' : `scale(1 1)`}"/>` : ''}
  </g>`;
  const cheek = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="5.2" fill="#ff9db5" opacity=".7"/>`;
  const mouth = (mood) => mood === 'open'
    ? `<path d="M-8 -34 Q0 -22 8 -34 Q0 -30 -8 -34Z" fill="#8a2a4a" stroke="#5a1a30" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="0" cy="-29" rx="4" ry="2.4" fill="#ff8da1"/>`
    : `<path d="M-7 -34 Q0 -27 7 -34" fill="none" stroke="#5a3a52" stroke-width="2.6" stroke-linecap="round"/>`;
  const scarf = (c1, c2, knotSide = 1) => `<g>
    <path d="M-40 -42 Q0 -26 40 -42 Q42 -33 38 -29 Q0 -13 -38 -29 Q-42 -34 -40 -42Z" fill="${c1}" stroke="${c2}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M-30 -38 Q0 -26 30 -38" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="4 7" opacity=".8" stroke-linecap="round"/>
    <path d="M${knotSide * 20} -30 q${knotSide * 6} 20 ${knotSide * 2} 30 l${knotSide * 12} -2 q${knotSide * 2} -16 ${knotSide * -6} -28Z" fill="${c1}" stroke="${c2}" stroke-width="1.6" stroke-linejoin="round"/>
  </g>`;

  // ---------------------------------------------------------------- Gearbit
  // opts: mood 'idle'|'cheer'|'battle', frostHat, key (show wind-up key), gearRot
  function gearbit({ mood = 'idle', scale = 1, flip = false, gearRot = 0, scarfOn = false, labels = false } = {}) {
    const battle = mood === 'battle', cheer = mood === 'cheer';
    const squash = battle ? 'scale(1.06 .94)' : cheer ? 'scale(.97 1.05)' : '';
    return `<g transform="scale(${flip ? -scale : scale} ${scale})">
      <ellipse cx="2" cy="4" rx="56" ry="13" fill="url(#gShadow)"/>
      <g transform="translate(0 ${cheer ? -10 : 0}) ${squash}">
        <!-- wind-up key peeking from the back -->
        <g transform="translate(50 -58) rotate(${battle ? -24 : 14})"><rect x="-3.6" y="-14" width="7.2" height="44" rx="3.6" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.3"/><path d="M0 -8 C-20 -10 -22 -34 -9 -36 C-2 -37 0 -30 0 -26 C0 -30 2 -37 9 -36 C22 -34 20 -10 0 -8Z" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.5" stroke-linejoin="round"/><path d="M-9 -28 C-9 -32 -4 -32 -3 -27 M9 -28 C9 -32 4 -32 3 -27" stroke="${C.brassLo}" stroke-width="1.4" fill="none" opacity=".7"/><ellipse cx="-6" cy="-32" rx="3" ry="1.8" fill="#fff" opacity=".8" transform="rotate(-30 -6 -32)"/></g>
        <!-- feet -->
        <ellipse cx="-22" cy="-4" rx="15" ry="9" fill="#a85d26"/><ellipse cx="22" cy="-4" rx="15" ry="9" fill="#a85d26"/>
        <!-- gear ears -->
        ${K.gear(-36, -108, 17, 8, 'url(#gBrass)', gearRot)}${K.gear(38, -112, 15, 8, 'url(#gCopper)', -gearRot * 1.2 + 10)}
        <path d="M-44 -122 q8 -8 18 -4 q-8 8 -18 4Z" fill="#fff" opacity=".95"/>
        <!-- body -->
        <ellipse cx="0" cy="-52" rx="55" ry="48" fill="url(#gGearbit)" stroke="#9a5a25" stroke-width="1.6"/>
        <ellipse cx="0" cy="-36" rx="32" ry="26" fill="url(#gGearbitBelly)" opacity=".92"/>
        <ellipse cx="-20" cy="-82" rx="14" ry="7" fill="#fff" opacity=".6" transform="rotate(-28 -20 -82)"/>
        <!-- rivets -->
        <circle cx="-48" cy="-52" r="2.6" fill="${C.brassLo}" opacity=".6"/><circle cx="48" cy="-52" r="2.6" fill="${C.brassLo}" opacity=".6"/>
        <!-- face -->
        ${eye(-20, -62, 9, battle ? 1.5 : 0, battle)}${eye(20, -62, 9, battle ? -1.5 : 0, battle)}
        <g transform="translate(0 -4)">${mouth(battle || cheer ? 'open' : 'closed')}</g>
        ${scarfOn ? `<g transform="translate(0 11)">${scarf('#e5555f', '#a83a48', 1)}</g>` : ''}
        <!-- arms -->
        <ellipse cx="-52" cy="-34" rx="9" ry="12" fill="#d98a3c" transform="rotate(${cheer ? 40 : 18} -52 -34)"/><ellipse cx="52" cy="-34" rx="9" ry="12" fill="#d98a3c" transform="rotate(${cheer ? -40 : -18} 52 -34)"/>
        ${battle ? `<g opacity=".95">${[[-70, -96], [72, -92], [-60, -130]].map(([x, y]) => `<path d="M${x} ${y - 7} l3 6 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1Z" fill="#ffe36b" stroke="#e5a32a" stroke-width="1"/>`).join('')}</g>` : ''}
      </g>
    </g>`;
  }

  // ----------------------------------------------------------------- Bulbun
  function bulbun({ mood = 'idle', scale = 1, flip = false, glowOn = true, scarfOn = false } = {}) {
    const battle = mood === 'battle', cheer = mood === 'cheer';
    return `<g transform="scale(${flip ? -scale : scale} ${scale})">
      <ellipse cx="2" cy="4" rx="52" ry="12" fill="url(#gShadow)"/>
      <g transform="translate(0 ${cheer ? -10 : 0}) ${battle ? 'scale(1.04 .96)' : ''}">
        <!-- ears -->
        <g transform="rotate(${battle ? -14 : -8} -22 -86)"><ellipse cx="-22" cy="-122" rx="14" ry="36" fill="url(#gBulbun)" stroke="#a98bd8" stroke-width="1.5"/><ellipse cx="-22" cy="-118" rx="7" ry="25" fill="#ffc9d8"/></g>
        <g transform="rotate(${battle ? 14 : 12} 22 -86)"><ellipse cx="24" cy="-120" rx="14" ry="34" fill="url(#gBulbun)" stroke="#a98bd8" stroke-width="1.5"/><ellipse cx="24" cy="-116" rx="7" ry="23" fill="#ffc9d8"/>
          <path d="M14 -142 q10 -12 22 -2" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/></g>
        <ellipse cx="-20" cy="-4" rx="15" ry="9" fill="#b69ce0"/><ellipse cx="20" cy="-4" rx="15" ry="9" fill="#b69ce0"/>
        <!-- tail -->
        <circle cx="46" cy="-22" r="13" fill="#fff" stroke="#e0d3f4" stroke-width="1.4"/>
        <!-- body -->
        <ellipse cx="0" cy="-48" rx="50" ry="46" fill="url(#gBulbun)" stroke="#a98bd8" stroke-width="1.6"/>
        <ellipse cx="-18" cy="-78" rx="13" ry="6.5" fill="#fff" opacity=".7" transform="rotate(-28 -18 -78)"/>
        <!-- face -->
        ${eye(-22, -58, 8.5, battle ? 1.5 : 0, battle)}${eye(22, -58, 8.5, battle ? -1.5 : 0, battle)}
        ${cheek(-36, -42)}${cheek(36, -42)}
        <!-- bulb nose -->
        ${glowOn ? K.glow(0, -46, 38) : ''}
        <rect x="-4.5" y="-34" width="9" height="6" rx="1.8" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width=".9"/>
        <path d="M-9 -38 a9 9 0 1 1 18 0 q0 4 -3 6 h-12 q-3 -2 -3 -6Z" fill="${glowOn ? '#fff4bd' : '#e6edf3'}" stroke="${C.brass}" stroke-width="1.6"/>
        <path d="M-3 -36 q3 -6 6 0" stroke="${C.brassLo}" stroke-width="1.2" fill="none" opacity=".8"/>
        ${shineBulb()}
        <g transform="translate(0 -6)">${battle || cheer ? mouth('open').replace(/-34/g, '-27').replace(/-29/g, '-23').replace(/-22/g, '-16') : `<path d="M-6 -27 Q0 -21 6 -27" fill="none" stroke="#5a3a52" stroke-width="2.4" stroke-linecap="round"/>`}</g>
        ${scarfOn ? `<g transform="translate(0 15) scale(.94 .92)">${scarf('#6cc4c9', '#3d98a0', -1)}</g>` : ''}
        <ellipse cx="-48" cy="-30" rx="8.5" ry="11" fill="#d8c8f2" transform="rotate(${cheer ? 40 : 18} -48 -30)"/><ellipse cx="48" cy="-30" rx="8.5" ry="11" fill="#d8c8f2" transform="rotate(${cheer ? -40 : -18} 48 -30)"/>
        ${battle ? `<g>${[[-62, -84], [64, -82]].map(([x, y]) => `<path d="M${x} ${y - 7} l3 6 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1Z" fill="#fff4bd" stroke="#e5a32a" stroke-width="1"/>`).join('')}</g>` : ''}
      </g>
    </g>`;
  }
  function shineBulb() { return `<ellipse cx="-3.4" cy="-44" rx="2.4" ry="1.6" fill="#fff" opacity=".95" transform="rotate(-35 -3.4 -44)"/>`; }

  const chip = (x, y, t, tone = 'cream') => {
    const w = t.length * 7.2 + 22;
    const f = { cream: ['#fff1d6', '#7a4b12'], green: ['#dff4ea', '#24684a'], blue: ['#e2ecfb', '#2f4f86'], grey: ['#ece6f0', ink], yellow: ['#fff0b4', '#7a5a0a'], lilac: ['#ece0fb', '#5b3f8f'] }[tone];
    return `<g transform="translate(${x - w / 2} ${y})"><rect width="${w}" height="26" rx="13" fill="${f[0]}"/><text x="${w / 2}" y="17.5" text-anchor="middle" font-size="12.5" font-weight="800" fill="${f[1]}">${t}</text></g>`;
  };
  const txt = (x, y, t, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 14}" font-weight="${o.fw || 700}" fill="${o.fill || ink}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''}>${t}</text>`;
  const snow = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#gSnowGround)" stroke="#cfe5f3" stroke-width="2"/>`;
  const sparkle = (pts) => K.frostSparkles(pts);
  const hpBar = (x, y, w, name, lvl, pct, col = '#7fd18b') => `<g transform="translate(${x} ${y})"><rect width="${w}" height="54" rx="18" fill="#fff" opacity=".96" stroke="#eadff0" stroke-width="2"/>${txt(14, 22, name, { fs: 15, fw: 800 })}${txt(w - 14, 22, 'Lv ' + lvl, { fs: 12.5, fw: 700, fill: '#8c7b94', anchor: 'end' })}<rect x="14" y="32" width="${w - 28}" height="10" rx="5" fill="#eee6f3"/><rect x="14" y="32" width="${(w - 28) * pct}" height="10" rx="5" fill="${col}"/></g>`;
  const pine = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="2" cy="2" rx="16" ry="5" fill="url(#gShadow)"/><rect x="-3" y="-10" width="6" height="12" rx="2" fill="#8a5a34"/><path d="M0 -62 L-20 -24 H20Z M0 -48 L-24 -10 H24Z" fill="#5fae86" stroke="#3f8a64" stroke-width="1.4" stroke-linejoin="round"/><path d="M0 -62 L-9 -44 Q0 -40 9 -44Z M0 -46 L-12 -26 Q0 -22 12 -26Z" fill="#fff"/></g>`;
  const hills = (W, H, y0) => `<path d="M0 ${y0 + 20} Q90 ${y0 - 26} 200 ${y0 + 8} Q310 ${y0 - 30} ${W} ${y0 + 10} V${H} H0Z" fill="#f3f9fd"/><path d="M0 ${y0 + 70} Q120 ${y0 + 30} 240 ${y0 + 60} Q330 ${y0 + 40} ${W} ${y0 + 66} V${H} H0Z" fill="#ffffff" opacity=".9"/>`;
  const snowfall = (W, H, n = 40) => { let s = 11, o = ''; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); for (let i = 0; i < n; i++) o += `<circle cx="${r() * W}" cy="${r() * H}" r="${1.2 + r() * 2.4}" fill="#fff" opacity="${0.5 + r() * 0.4}"/>`; return o; };

  g.M4 = {
    idle() { // phone: both squishies idling on a frosty patch, windmill in the background
      const W = 393, H = 852;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H) + hills(W, H, 300) +
        txt(W / 2, 100, 'Two tinker squishies', { fs: 22, fw: 800, anchor: 'middle' }) + txt(W / 2, 122, 'Only on Clockwork Isle', { fs: 13, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        // Gearbit
        `<g transform="translate(300 312) scale(.95)">${K.windmill({ level: 1, state: 'lit' })}</g>${pine(24, 366, .7)}${pine(350, 360, .85)}` +
        `<g transform="translate(0 0)">${snow(110, 440, 100, 24)}<g transform="translate(110 440) scale(1.28)">${gearbit({ mood: 'idle', gearRot: 6 })}</g>${chip(110, 466, 'Gearbit', 'yellow')}${chip(110, 498, '⚡ Spark · Joy', 'cream')}${txt(110, 540, 'Its gear ears spin when it is happy!', { fs: 11.5, fw: 600, fill: '#8c7b94', anchor: 'middle' })}</g>` +
        `<g transform="translate(0 0)">${snow(286, 640, 100, 24)}<g transform="translate(286 640) scale(1.28)">${bulbun({ mood: 'idle' })}</g>${chip(286, 666, 'Bulbun', 'lilac')}${chip(286, 698, '💡 Light · Cozy', 'cream')}${txt(286, 740, 'Its bulb nose glows at dusk.', { fs: 11.5, fw: 600, fill: '#8c7b94', anchor: 'middle' })}</g>` +
        sparkle([[30, 120, 5], [350, 200, 6], [60, 600, 4], [340, 520, 5]]));
    },
    battle() { // phone: battle scene, Gearbit (yours) vs Bulbun
      const W = 393, H = 852;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gArena)"/>` + snowfall(W, H, 50) +
        hpBar(16, 76, 200, 'Bulbun', 7, 0.78) + hpBar(W - 170, 592, 158, 'Gearbit', 8, 0.92, '#7fd18b') +
        `<g>${snow(285, 290, 118, 28)}<g transform="translate(285 286) scale(1.05)">${bulbun({ mood: 'battle', flip: true })}</g></g>` +
        `<g>${snow(118, 612, 100, 26)}<g transform="translate(118 608) scale(1.25)">${gearbit({ mood: 'battle', gearRot: 14 })}</g></g>` +
        // move banner
        `<g transform="translate(${W / 2} 380)"><rect x="-136" y="-21" width="272" height="42" rx="21" fill="#fff0b4" stroke="#e5a32a" stroke-width="2"/><text y="6" text-anchor="middle" font-size="16" font-weight="800" fill="#7a4b12">Gearbit used Whirly Spin! ⚡</text></g>` +
        // moves
        [['Whirly Spin', '⚡ Spark', '#fff0b4', '#7a5a0a'], ['Tickle Tackle', '⭐ Normal', '#ece6f0', ink], ['Cozy Hum', '💡 Light', '#ece0fb', '#5b3f8f'], ['Gear Hug', '⚡ Spark', '#fff0b4', '#7a5a0a']].map(([n, t, bg, c], i) => `<g transform="translate(${16 + (i % 2) * 182} ${666 + Math.floor(i / 2) * 72})"><rect width="171" height="62" rx="20" fill="#fff" stroke="#eadff0" stroke-width="2"/><text x="14" y="27" font-size="15" font-weight="800" fill="${ink}">${n}</text><g transform="translate(14 34)"><rect width="${t.length * 7 + 14}" height="20" rx="10" fill="${bg}"/><text x="${(t.length * 7 + 14) / 2}" y="14" text-anchor="middle" font-size="11.5" font-weight="800" fill="${c}">${t}</text></g></g>`).join('') +
        sparkle([[40, 300, 5], [350, 120, 6], [330, 560, 5]]));
    },
    parts() { // phone: part sheet
      const W = 393, H = 852;
      const row = (y, art, title, desc, tag) => `<g transform="translate(14 ${y})"><rect width="${W - 28}" height="132" rx="24" fill="#fff" opacity=".92" stroke="#eadff0" stroke-width="2"/><rect x="12" y="12" width="108" height="108" rx="20" fill="#f4f0f8"/>${art}${txt(134, 38, title, { fs: 18, fw: 800 })}${txt(134, 60, desc, { fs: 12.5, fw: 600, fill: '#8c7b94' })}${chip(134 + (tag.length * 7.2 + 22) / 2, 84, tag, 'cream')}</g>`;
      const earArt = `<g transform="translate(66 80)">${K.gear(-18, -8, 22, 8, 'url(#gBrass)', 8)}${K.gear(22, 4, 15, 8, 'url(#gCopper)', -6)}</g>`;
      const noseArt = `<g transform="translate(66 86) scale(2.1)"><circle cx="0" cy="-6" r="22" fill="url(#gGlow)"/><rect x="-4.5" y="-2" width="9" height="6" rx="1.8" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width=".9"/><path d="M-9 -6 a9 9 0 1 1 18 0 q0 4 -3 6 h-12 q-3 -2 -3 -6Z" fill="#fff4bd" stroke="${C.brass}" stroke-width="1.6"/><path d="M-3 -4 q3 -6 6 0" stroke="${C.brassLo}" stroke-width="1.2" fill="none"/><ellipse cx="-3.4" cy="-12" rx="2.4" ry="1.6" fill="#fff" transform="rotate(-35 -3.4 -12)"/></g>`;
      const keyArt = `<g transform="translate(66 84) rotate(-10) scale(1.05)"><rect x="-3.6" y="-4" width="7.2" height="30" rx="3.6" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.3"/><path d="M0 -8 C-20 -10 -22 -34 -9 -36 C-2 -37 0 -30 0 -26 C0 -30 2 -37 9 -36 C22 -34 20 -10 0 -8Z" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.5" stroke-linejoin="round"/><rect x="-8" y="20" width="16" height="5" rx="2.5" fill="url(#gCopper)"/></g>`;
      const scarfArt = `<g transform="translate(62 94) scale(1.15)"><g transform="translate(0 -4)">${scarf('#e5555f', '#a83a48', 1)}</g></g>`;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H, 30) +
        txt(W / 2, 100, 'Tinker parts', { fs: 22, fw: 800, anchor: 'middle' }) + txt(W / 2, 122, 'The base look. No scarves here.', { fs: 13, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        row(140, earArt, 'Gear ears', 'Spins when it is happy.', 'Gearbit') +
        row(276, noseArt, 'Bulb nose', 'Soft glass. Glows at dusk.', 'Bulbun') +
        row(412, keyArt, 'Wind-up key', 'Turns when it skips about.', 'Gearbit') +
        row(548, scarfArt, 'Frosty scarf', 'Red or teal wool. Snowy days.', 'Wardrobe item') +
        `<g transform="translate(14 690)"><rect width="${W - 28}" height="116" rx="24" fill="#fff" opacity=".7"/>${txt(24, 34, 'Same parts, new looks', { fs: 15, fw: 800 })}<g transform="translate(86 104) scale(.4)">${gearbit({ mood: 'idle', scarfOn: false })}</g><g transform="translate(196 104) scale(.4)">${bulbun({ mood: 'idle', scarfOn: false })}</g><g transform="translate(300 104) scale(.4)">${gearbit({ mood: 'cheer', gearRot: 20 })}</g></g>`);
    },
    wardrobe() { // phone: the scarf as a Wardrobe accessory
      const W = 393, H = 852;
      const sw = (x, y, c1, c2, label, sel) => `<g transform="translate(${x} ${y})"><rect width="150" height="64" rx="20" fill="#fff" stroke="${sel ? '#7a4b12' : '#eadff0'}" stroke-width="${sel ? 3 : 2}"/><g transform="translate(34 40) scale(.5)">${scarf(c1, c2, 1)}</g>${txt(70, 38, label, { fs: 14, fw: 800 })}</g>`;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H, 36) + hills(W, H, 300) +
        txt(W / 2, 100, 'Wardrobe', { fs: 22, fw: 800, anchor: 'middle' }) + txt(W / 2, 122, 'Dress-up for squishies', { fs: 13, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        `<g>${snow(110, 410, 100, 24)}<g transform="translate(110 410) scale(1.25)">${gearbit({ mood: 'cheer', gearRot: 10, scarfOn: true })}</g>${chip(110, 436, 'Gearbit', 'yellow')}</g>` +
        `<g>${snow(286, 410, 100, 24)}<g transform="translate(286 410) scale(1.25)">${bulbun({ mood: 'cheer', scarfOn: true })}</g>${chip(286, 436, 'Bulbun', 'lilac')}</g>` +
        `<g transform="translate(14 500)"><rect width="${W - 28}" height="212" rx="26" fill="#fff" opacity=".96" stroke="#eadff0" stroke-width="2"/>` +
        txt(24, 40, 'Frosty Scarf', { fs: 20, fw: 800 }) + `<g transform="translate(${W - 28 - 24 - 150} 20)"><rect width="150" height="26" rx="13" fill="#dff4ea"/><text x="75" y="17.5" text-anchor="middle" font-size="12.5" font-weight="800" fill="#24684a">Wardrobe accessory</text></g>` +
        txt(24, 66, 'Wool, with a little knot. Just for looks.', { fs: 13, fw: 600, fill: '#8c7b94' }) +
        sw(24, 86, '#e5555f', '#a83a48', 'Red', true) + sw(190, 86, '#6cc4c9', '#3d98a0', 'Teal', false) +
        `<g transform="translate(24 162)"><rect width="${W - 76}" height="38" rx="19" fill="url(#gBrass)"/><text x="${(W - 76) / 2}" y="25" text-anchor="middle" font-size="15" font-weight="800" fill="#5a3a0d">Put it on</text></g></g>` +
        K.frostSparkles([[30, 160, 5], [350, 220, 6], [340, 620, 5]]));
    },
    ipad() { // iPad: idle pair + battle side by side
      const W = 1024, H = 1366;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H, 80) +
        txt(W / 2, 70, 'Clockwork Isle squishies', { fs: 32, fw: 800, anchor: 'middle' }) + txt(W / 2, 100, 'Gearbit and Bulbun', { fs: 16, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        `<g>${snow(300, 470, 220, 46)}<g transform="translate(300 466) scale(2.1)">${gearbit({ mood: 'idle', gearRot: 6 })}</g>${chip(300, 500, 'Gearbit', 'yellow')}${chip(300, 534, '⚡ Spark · Joy', 'cream')}</g>` +
        `<g>${snow(724, 470, 220, 46)}<g transform="translate(724 466) scale(2.1)">${bulbun({ mood: 'idle' })}</g>${chip(724, 500, 'Bulbun', 'lilac')}${chip(724, 534, '💡 Light · Cozy', 'cream')}</g>` +
        `<g transform="translate(0 600)"><rect x="40" y="0" width="${W - 80}" height="680" rx="36" fill="url(#gArena)" stroke="#eadff0" stroke-width="2"/>${hpBar(80, 40, 280, 'Bulbun', 7, 0.78)}${hpBar(W - 360, 440, 280, 'Gearbit', 8, 0.92)}
          ${snow(740, 340, 190, 40)}<g transform="translate(740 336) scale(1.55)">${bulbun({ mood: 'battle', flip: true })}</g>
          ${snow(280, 560, 210, 44)}<g transform="translate(280 556) scale(2.3)">${gearbit({ mood: 'battle', gearRot: 14 })}</g>
          <g transform="translate(${W / 2} 640)"><rect x="-210" y="-28" width="420" height="56" rx="28" fill="#fff0b4" stroke="#e5a32a" stroke-width="2"/><text y="8" text-anchor="middle" font-size="21" font-weight="800" fill="#7a4b12">Gearbit used Whirly Spin! ⚡</text></g></g>`);
    },
  };
})(window);
