(function (g) {
  const K = g.KIT, C = K.C;
  const FONT = `-apple-system,'SF Pro Rounded','Nunito',system-ui,sans-serif`;
  const ink = '#6b5a73';
  const svg = (W, H, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${K.defs()}${SQDEFS}${inner}</svg>`;
  const SQDEFS = `<defs>
    <radialGradient id="gGearbit" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".55" stop-color="#ffc552"/><stop offset="1" stop-color="#ee9a33"/></radialGradient>
    <radialGradient id="gGearbitBelly" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#fff6d6"/><stop offset="1" stop-color="#ffe19a"/></radialGradient>
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
  function gearbit({ mood = 'idle', scale = 1, flip = false, gearRot = 0, scarfOn = true, labels = false } = {}) {
    const battle = mood === 'battle', cheer = mood === 'cheer';
    const squash = battle ? 'scale(1.06 .94)' : cheer ? 'scale(.97 1.05)' : '';
    return `<g transform="scale(${flip ? -scale : scale} ${scale})">
      <ellipse cx="2" cy="4" rx="56" ry="13" fill="url(#gShadow)"/>
      <g transform="translate(0 ${cheer ? -10 : 0}) ${squash}">
        <!-- wind-up key peeking from the back -->
        <g transform="translate(46 -70) rotate(${battle ? -20 : 15})"><rect x="-3" y="-6" width="6" height="22" rx="3" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.2"/><ellipse cx="0" cy="-10" rx="13" ry="9" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.4"/><ellipse cx="0" cy="-10" rx="6" ry="3.6" fill="${C.copperLo}" opacity=".55"/></g>
        <!-- feet -->
        <ellipse cx="-22" cy="-4" rx="15" ry="9" fill="#e98f2e"/><ellipse cx="22" cy="-4" rx="15" ry="9" fill="#e98f2e"/>
        <!-- gear ears -->
        ${K.gear(-36, -108, 17, 8, 'url(#gBrass)', gearRot)}${K.gear(38, -112, 15, 8, 'url(#gCopper)', -gearRot * 1.2 + 10)}
        <path d="M-44 -122 q8 -8 18 -4 q-8 8 -18 4Z" fill="#fff" opacity=".95"/>
        <!-- body -->
        <ellipse cx="0" cy="-52" rx="55" ry="48" fill="url(#gGearbit)" stroke="#d98728" stroke-width="1.6"/>
        <ellipse cx="0" cy="-36" rx="32" ry="26" fill="url(#gGearbitBelly)" opacity=".92"/>
        <ellipse cx="-20" cy="-82" rx="14" ry="7" fill="#fff" opacity=".6" transform="rotate(-28 -20 -82)"/>
        <!-- rivets -->
        <circle cx="-48" cy="-52" r="2.6" fill="${C.brassLo}" opacity=".6"/><circle cx="48" cy="-52" r="2.6" fill="${C.brassLo}" opacity=".6"/>
        <!-- face -->
        ${eye(-20, -62, 9, battle ? 1.5 : 0, battle)}${eye(20, -62, 9, battle ? -1.5 : 0, battle)}
        ${cheek(-34, -48)}${cheek(34, -48)}
        <g transform="translate(0 -4)">${mouth(battle || cheer ? 'open' : 'closed')}</g>
        ${scarfOn ? `<g transform="translate(0 11)">${scarf('#e5555f', '#a83a48', 1)}</g>` : ''}
        <!-- arms -->
        <ellipse cx="-52" cy="-34" rx="9" ry="12" fill="#f5a73a" transform="rotate(${cheer ? 40 : 18} -52 -34)"/><ellipse cx="52" cy="-34" rx="9" ry="12" fill="#f5a73a" transform="rotate(${cheer ? -40 : -18} 52 -34)"/>
        ${battle ? `<g opacity=".95">${[[-70, -96], [72, -92], [-60, -130]].map(([x, y]) => `<path d="M${x} ${y - 7} l3 6 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1Z" fill="#ffe36b" stroke="#e5a32a" stroke-width="1"/>`).join('')}</g>` : ''}
      </g>
    </g>`;
  }

  // ----------------------------------------------------------------- Bulbun
  function bulbun({ mood = 'idle', scale = 1, flip = false, glowOn = true, scarfOn = true } = {}) {
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
  const snowfall = (W, H, n = 40) => { let s = 11, o = ''; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); for (let i = 0; i < n; i++) o += `<circle cx="${r() * W}" cy="${r() * H}" r="${1.2 + r() * 2.4}" fill="#fff" opacity="${0.5 + r() * 0.4}"/>`; return o; };

  g.M4 = {
    idle() { // phone: both squishies idling on a frosty patch, windmill in the background
      const W = 393, H = 852;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H) +
        txt(W / 2, 54, 'Two tinker squishies', { fs: 22, fw: 800, anchor: 'middle' }) + txt(W / 2, 76, 'Only on Clockwork Isle', { fs: 13, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        // Gearbit
        `<g>${snow(300, 300, 70, 16)}<g transform="translate(300 298) scale(.9)">${K.windmill({ level: 1, state: 'lit' })}</g></g>` +
        `<g transform="translate(0 0)">${snow(110, 440, 100, 24)}<g transform="translate(110 440) scale(1.28)">${gearbit({ mood: 'idle', gearRot: 6 })}</g>${chip(110, 466, 'Gearbit', 'yellow')}${chip(110, 498, '⚡ Spark · Joy', 'cream')}${txt(110, 540, 'Its gear ears spin when it is happy!', { fs: 11.5, fw: 600, fill: '#8c7b94', anchor: 'middle' })}</g>` +
        `<g transform="translate(0 0)">${snow(286, 640, 100, 24)}<g transform="translate(286 640) scale(1.28)">${bulbun({ mood: 'idle' })}</g>${chip(286, 666, 'Bulbun', 'lilac')}${chip(286, 698, '💡 Light · Cozy', 'cream')}${txt(286, 740, 'Its bulb nose glows at dusk.', { fs: 11.5, fw: 600, fill: '#8c7b94', anchor: 'middle' })}</g>` +
        sparkle([[30, 120, 5], [350, 200, 6], [60, 600, 4], [340, 520, 5]]));
    },
    battle() { // phone: battle scene, Gearbit (yours) vs Bulbun
      const W = 393, H = 852;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gArena)"/>` + snowfall(W, H, 50) +
        hpBar(16, 62, 200, 'Bulbun', 7, 0.78) + hpBar(W - 196, 584, 180, 'Gearbit', 8, 0.92, '#7fd18b') +
        `<g>${snow(285, 300, 118, 28)}<g transform="translate(285 296) scale(1.1)">${bulbun({ mood: 'battle', flip: true })}</g></g>` +
        `<g>${snow(112, 560, 128, 32)}<g transform="translate(112 556) scale(1.45)">${gearbit({ mood: 'battle', gearRot: 14 })}</g></g>` +
        // move banner
        `<g transform="translate(${W / 2} 372)"><rect x="-122" y="-20" width="244" height="40" rx="20" fill="#fff0b4" stroke="#e5a32a" stroke-width="2"/><text y="6" text-anchor="middle" font-size="16" font-weight="800" fill="#7a4b12">Gearbit used Whirly Spin! ⚡</text></g>` +
        // moves
        [['Whirly Spin', '⚡ Spark', '#fff0b4', '#7a5a0a'], ['Tickle Tackle', '⭐ Normal', '#ece6f0', ink], ['Cozy Hum', '💡 Light', '#ece0fb', '#5b3f8f'], ['Gear Hug', '⚡ Spark', '#fff0b4', '#7a5a0a']].map(([n, t, bg, c], i) => `<g transform="translate(${16 + (i % 2) * 182} ${666 + Math.floor(i / 2) * 72})"><rect width="171" height="62" rx="20" fill="#fff" stroke="#eadff0" stroke-width="2"/><text x="14" y="27" font-size="15" font-weight="800" fill="${ink}">${n}</text><g transform="translate(14 34)"><rect width="${t.length * 7 + 14}" height="20" rx="10" fill="${bg}"/><text x="${(t.length * 7 + 14) / 2}" y="14" text-anchor="middle" font-size="11.5" font-weight="800" fill="${c}">${t}</text></g></g>`).join('') +
        sparkle([[40, 300, 5], [350, 120, 6], [330, 560, 5]]));
    },
    parts() { // phone: part sheet
      const W = 393, H = 852;
      const row = (y, art, title, desc, tag) => `<g transform="translate(14 ${y})"><rect width="${W - 28}" height="132" rx="24" fill="#fff" opacity=".92" stroke="#eadff0" stroke-width="2"/><rect x="12" y="12" width="108" height="108" rx="20" fill="#f4f0f8"/>${art}${txt(134, 38, title, { fs: 18, fw: 800 })}${txt(134, 60, desc, { fs: 12.5, fw: 600, fill: '#8c7b94' })}${chip(134 + (tag.length * 7.2 + 22) / 2, 84, tag, 'cream')}</g>`;
      const earArt = `<g transform="translate(66 80)">${K.gear(-18, -8, 22, 8, 'url(#gBrass)', 8)}${K.gear(22, 4, 15, 8, 'url(#gCopper)', -6)}</g>`;
      const noseArt = `<g transform="translate(66 86) scale(2.1)"><circle cx="0" cy="-6" r="22" fill="url(#gGlow)"/><rect x="-4.5" y="-2" width="9" height="6" rx="1.8" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width=".9"/><path d="M-9 -6 a9 9 0 1 1 18 0 q0 4 -3 6 h-12 q-3 -2 -3 -6Z" fill="#fff4bd" stroke="${C.brass}" stroke-width="1.6"/><path d="M-3 -4 q3 -6 6 0" stroke="${C.brassLo}" stroke-width="1.2" fill="none"/><ellipse cx="-3.4" cy="-12" rx="2.4" ry="1.6" fill="#fff" transform="rotate(-35 -3.4 -12)"/></g>`;
      const keyArt = `<g transform="translate(66 74) rotate(-14) scale(1.7)"><rect x="-3.4" y="-4" width="6.8" height="40" rx="3.4" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.2"/><ellipse cx="0" cy="-14" rx="18" ry="12" fill="url(#gBrass)" stroke="${C.brassLo}" stroke-width="1.5"/><ellipse cx="0" cy="-14" rx="9" ry="5.4" fill="${C.copperLo}" opacity=".55"/><rect x="-9" y="30" width="18" height="6" rx="3" fill="url(#gCopper)"/></g>`;
      const scarfArt = `<g transform="translate(62 94) scale(1.15)"><g transform="translate(0 -4)">${scarf('#e5555f', '#a83a48', 1)}</g></g>`;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H, 30) +
        txt(W / 2, 50, 'Tinker parts', { fs: 22, fw: 800, anchor: 'middle' }) + txt(W / 2, 72, 'Mix and match for the isle squishies', { fs: 13, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        row(96, earArt, 'Gear ears', 'Spins when it is happy.', 'Gearbit') +
        row(240, noseArt, 'Bulb nose', 'Soft glass. Glows at dusk.', 'Bulbun') +
        row(384, keyArt, 'Wind-up key', 'Turns when it skips about.', 'Gearbit') +
        row(528, scarfArt, 'Frosty scarf', 'Red or teal wool. Snowy days.', 'Both') +
        `<g transform="translate(14 672)"><rect width="${W - 28}" height="148" rx="24" fill="#fff" opacity=".7"/>${txt(24, 34, 'Same parts, new looks', { fs: 15, fw: 800 })}<g transform="translate(86 128) scale(.5)">${gearbit({ mood: 'idle', scarfOn: false })}</g><g transform="translate(196 128) scale(.5)">${bulbun({ mood: 'idle', scarfOn: false })}</g><g transform="translate(300 128) scale(.5)">${gearbit({ mood: 'cheer', gearRot: 20 })}</g></g>`);
    },
    ipad() { // iPad: idle pair + battle side by side
      const W = 1024, H = 1366;
      return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#gBgDay)"/>` + snowfall(W, H, 80) +
        txt(W / 2, 70, 'Clockwork Isle squishies', { fs: 32, fw: 800, anchor: 'middle' }) + txt(W / 2, 100, 'Gearbit and Bulbun (draft names)', { fs: 16, fw: 600, fill: '#8c7b94', anchor: 'middle' }) +
        `<g>${snow(300, 470, 220, 46)}<g transform="translate(300 466) scale(2.1)">${gearbit({ mood: 'idle', gearRot: 6 })}</g>${chip(300, 500, 'Gearbit', 'yellow')}${chip(300, 534, '⚡ Spark · Joy', 'cream')}</g>` +
        `<g>${snow(724, 470, 220, 46)}<g transform="translate(724 466) scale(2.1)">${bulbun({ mood: 'idle' })}</g>${chip(724, 500, 'Bulbun', 'lilac')}${chip(724, 534, '💡 Light · Cozy', 'cream')}</g>` +
        `<g transform="translate(0 600)"><rect x="40" y="0" width="${W - 80}" height="680" rx="36" fill="url(#gArena)" stroke="#eadff0" stroke-width="2"/>${hpBar(80, 40, 280, 'Bulbun', 7, 0.78)}${hpBar(W - 360, 440, 280, 'Gearbit', 8, 0.92)}
          ${snow(740, 260, 190, 40)}<g transform="translate(740 256) scale(1.9)">${bulbun({ mood: 'battle', flip: true })}</g>
          ${snow(280, 560, 210, 44)}<g transform="translate(280 556) scale(2.3)">${gearbit({ mood: 'battle', gearRot: 14 })}</g>
          <g transform="translate(${W / 2 + 40} 372)"><rect x="-150" y="-26" width="300" height="52" rx="26" fill="#fff0b4" stroke="#e5a32a" stroke-width="2"/><text y="8" text-anchor="middle" font-size="21" font-weight="800" fill="#7a4b12">Gearbit used Whirly Spin! ⚡</text></g></g>`);
    },
  };
})(window);
