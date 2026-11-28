(function (g) {
  const K = g.KIT;
  const STATES = [['lit', 'Working'], ['out', 'Resting'], ['off', 'Needs power']];
  const bg = (w, h) => `<defs><linearGradient id="bgSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6f3fb"/><stop offset="1" stop-color="#fdeef4"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#bgSky)"/>`;
  const title = (w, t, sub) => `<text x="${w / 2}" y="46" text-anchor="middle" font-size="22" font-weight="800" fill="#6b5a73">${t}</text><text x="${w / 2}" y="68" text-anchor="middle" font-size="13" font-weight="600" fill="#8c7b94">${sub}</text>`;
  const chip = (x, y, t, tone = 'cream') => {
    const w = t.length * 7.2 + 22;
    const f = { cream: ['#fff1d6', '#7a4b12'], green: ['#dff4ea', '#24684a'], blue: ['#e2ecfb', '#2f4f86'], grey: ['#ece6f0', '#6b5a73'] }[tone];
    return `<g transform="translate(${x - w / 2} ${y})"><rect width="${w}" height="26" rx="13" fill="${f[0]}"/><text x="${w / 2}" y="17.5" text-anchor="middle" font-size="12.5" font-weight="700" fill="${f[1]}">${t}</text></g>`;
  };
  const row = (W, y, label, caption, fn, scale, chips, wide) => {
    const cols = STATES.length, cw = W / cols;
    let s = `<g transform="translate(0 ${y})"><text x="18" y="0" font-size="16" font-weight="800" fill="#6b5a73">${label}</text><text x="18" y="18" font-size="12" font-weight="600" fill="#8c7b94">${caption}</text>`;
    STATES.forEach(([st, name], i) => {
      const cx = cw * i + cw / 2;
      s += `<g transform="translate(${cx} 36)"><ellipse cx="0" cy="${150}" rx="${cw * 0.4}" ry="22" fill="url(#gSnowGround)" stroke="#cfe5f3" stroke-width="2"/>`;
      s += `<g transform="translate(0 ${150}) scale(${scale})">${fn(st)}</g>`;
      s += `${chip(0, 178, name, st === 'lit' ? 'green' : st === 'out' ? 'grey' : 'cream')}</g>`;
      if (chips && chips[st]) s += `<g transform="translate(${cx} 36)">${chip(0, -6, chips[st], 'blue')}</g>`;
    });
    return s + '</g>';
  };
  const frame = (W, H, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,'SF Pro Rounded','Nunito',system-ui,sans-serif">${K.defs()}${bg(W, H)}${inner}</svg>`;

  g.M3 = {
    a() { // phone: Windmill L1, L2, Sorter
      const W = 393, H = 852;
      return frame(W, H, title(W, 'Windmill & Sorter', 'Brass, wood and wool. Snow on every roof.') +
        row(W, 92, 'Windmill · Level 1', 'Runs on winter wind', (s) => K.windmill({ level: 1, state: s }), 1.0, { lit: '❄️ Brrr! Fast', out: '💨 Slow wind', off: '' }) +
        row(W, 342, 'Windmill · Level 2', 'Taller, six woolly sails', (s) => K.windmill({ level: 2, state: s }), 0.8, { lit: '❄️ Brrr! Fast', out: '💨 Slow wind', off: '' }) +
        row(W, 592, 'Sorter', 'Sorts greens into treats, hands-free', (s) => K.sorter({ state: s }), 0.95, null, true));
    },
    b() { // phone: Rail Depot, Research Bench, Beacon
      const W = 393, H = 852;
      return frame(W, H, title(W, 'Depot, Bench & Beacon', 'Little workshops for clever Keepers.') +
        row(W, 92, 'Rail Depot + cart', 'Rail-joined squishies drop off here', (s) => '<g transform="translate(-12 0)">' + K.railDepot({ level: 1, state: s }) + '</g>', 0.78, null) +
        row(W, 342, 'Research Bench', 'Tinker up new blueprints', (s) => K.bench({ state: s }), 1.05, null) +
        row(W, 592, 'Clockwork Beacon', 'The Hollow Man keeps his distance', (s) => K.beacon({ state: s }), 1.0, null, true));
    },
    ipad() { // all five at once, 3 states
      const W = 1024, H = 1366;
      const items = [
        ['Windmill · L1', (s) => K.windmill({ level: 1, state: s }), 1.45],
        ['Windmill · L2', (s) => K.windmill({ level: 2, state: s }), 1.15],
        ['Sorter', (s) => K.sorter({ state: s }), 1.25],
        ['Rail Depot', (s) => K.railDepot({ level: 1, state: s }), 0.76],
        ['Research Bench', (s) => K.bench({ state: s }), 1.5],
        ['Clockwork Beacon', (s) => K.beacon({ state: s }), 1.3],
      ];
      let inner = title(W, 'Clockwork Isle machines', 'Working · Resting · Needs power');
      items.forEach(([n, fn, sc], i) => {
        const col = i % 2, r = Math.floor(i / 2);
        const x0 = 24 + col * 500, y0 = 110 + r * 410;
        inner += `<g transform="translate(${x0} ${y0})"><rect width="476" height="388" rx="28" fill="#ffffff" opacity=".6"/><text x="22" y="34" font-size="19" font-weight="800" fill="#6b5a73">${n}</text>`;
        STATES.forEach(([st, name], j) => {
          const cx = 80 + j * 158;
          inner += `<ellipse cx="${cx + 8}" cy="250" rx="60" ry="22" fill="url(#gSnowGround)" stroke="#cfe5f3" stroke-width="2"/><g transform="translate(${cx + 8} 250) scale(${sc})">${fn(st)}</g>${chip(cx + 8, 322, name, st === 'lit' ? 'green' : st === 'out' ? 'grey' : 'cream')}`;
        });
        inner += '</g>';
      });
      return frame(W, H, inner);
    },
  };
})(window);
