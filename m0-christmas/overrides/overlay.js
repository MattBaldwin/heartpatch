(() => {
  const proj = (x, y, z) => {
    const s = window.__capScene; if (!s) return null;
    const m = s.getTransformMatrix().m;
    const cx = x*m[0]+y*m[4]+z*m[8]+m[12], cy = x*m[1]+y*m[5]+z*m[9]+m[13], cw = x*m[3]+y*m[7]+z*m[11]+m[15];
    return [(cx/cw*0.5+0.5)*innerWidth, (1-(cy/cw*0.5+0.5))*innerHeight];
  };
  const S3 = Math.sqrt(3), R = 0.65 * 0.98;
  const COLS = ['#fff0c4', '#ff5d52', '#5fe39a', '#ffcc4d'];
  const cv = document.createElement('canvas'); cv.id = 'cap-lights';
  const dpr = devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; document.body.appendChild(cv);
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const bulbs = [];
  const string = (a, b, n, sag, offset) => {
    const wire = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      wire.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
    }
    g.strokeStyle = 'rgba(40,28,44,0.85)'; g.lineWidth = 1; g.beginPath();
    wire.forEach((p, i) => { const s = proj(...p); if (!s) return; i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); });
    g.stroke();
    wire.forEach((p, i) => { if (i === 0 || i === n) return; const s = proj(...p); if (s) bulbs.push({ x: s[0], y: s[1], c: COLS[(i + offset) % 4] }); });
  };
  const paint = () => {
    g.globalCompositeOperation = 'lighter';
    for (const b of bulbs) {
      const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, 15);
      gr.addColorStop(0, b.c + 'cc'); gr.addColorStop(0.35, b.c + '55'); gr.addColorStop(1, b.c + '00');
      g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, 15, 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    for (const b of bulbs) { g.fillStyle = b.c; g.beginPath(); g.arc(b.x, b.y, 3.1, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(b.x, b.y - 0.7, 1.3, 0, 7); g.fill(); }
  };
  const corner = (cx, cz, k, r = R) => { const a = Math.PI / 6 + k * Math.PI / 3; return [cx + r * Math.cos(a), cz + r * Math.sin(a)]; };
  window.__capLights = {
    tile(cx, cz) {
      const y = 0.45;
      for (let k = 0; k < 6; k++) { const a = corner(cx, cz, k), b = corner(cx, cz, k + 1); string([a[0], y, a[1]], [b[0], y, b[1]], 6, 0.05, k); }
      paint();
    },
    home(cx, cz) {
      const y = 0.62, hw = 0.62;
      string([cx - hw, y, cz - 0.28], [cx + hw, y, cz - 0.28], 12, 0.1, 0);
      string([cx - hw, y + 0.30, cz - 0.1], [cx, y + 0.62, cz - 0.1], 7, 0.04, 1);
      string([cx, y + 0.62, cz - 0.1], [cx + hw, y + 0.30, cz - 0.1], 7, 0.04, 2);
      paint();
    },
    clear() { g.clearRect(0, 0, innerWidth, innerHeight); bulbs.length = 0; },
    stats() { return { bulbs: bulbs.length, byColor: Object.fromEntries(COLS.map((c) => [c, bulbs.filter((b) => b.c === c).length])), pts: bulbs.map((b) => [Math.round(b.x), Math.round(b.y)]) }; },
  };
  const ORN = [[0.5,0.30],[0.38,0.40],[0.63,0.43],[0.30,0.55],[0.50,0.54],[0.70,0.58],[0.24,0.72],[0.42,0.70],[0.60,0.73],[0.78,0.76],[0.34,0.86],[0.62,0.88]];
  const OCOL = ['#ff5d52', '#ffd04d', '#5fb7ff', '#ff8fd0', '#ffffff', '#7be39a'];
  let treeEl = null, last = {};
  window.__capTree = {
    set(wx, wz, n) {
      const base = proj(wx, 0.3, wz), edge = proj(wx + 0.65 * S3, 0.3, wz);
      const tile = Math.abs(edge[0] - base[0]); const w = tile * 1.5, h = tile * 2.4;
      if (treeEl) treeEl.remove();
      treeEl = document.createElement('div'); treeEl.id = 'cap-tree';
      treeEl.style.cssText = `left:${base[0]}px;top:${base[1] + tile * 0.1}px;width:${w}px;height:${h}px`;
      const lit = n >= 12;
      const orn = ORN.slice(0, n).map((p, i) => `<circle cx="${p[0] * 100}" cy="${p[1] * 150}" r="4.6" fill="${OCOL[i % 6]}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/><circle cx="${p[0] * 100 - 1}" cy="${p[1] * 150 - 1.2}" r="1" fill="#fff" opacity=".8"/>`).join('');
      treeEl.innerHTML = `<svg viewBox="0 0 100 150" width="100%" height="100%" overflow="visible">
        <defs><radialGradient id="sg"><stop offset="0" stop-color="#fff6b0" stop-opacity=".95"/><stop offset=".45" stop-color="#ffd24d" stop-opacity=".45"/><stop offset="1" stop-color="#ffd24d" stop-opacity="0"/></radialGradient></defs>
        <ellipse cx="50" cy="146" rx="30" ry="5" fill="rgba(60,40,70,.25)"/>
        <rect x="45" y="128" width="10" height="16" rx="2" fill="#7a4e32"/>
        <path d="M50 70 L84 130 L16 130 Z" fill="#2f8f5b"/><path d="M50 40 L77 96 L23 96 Z" fill="#37a368"/><path d="M50 14 L70 62 L30 62 Z" fill="#40b574"/>
        <path d="M50 14 L60 38 L52 33 L47 40 L40 36 Z" fill="#f4f8ff"/><path d="M50 40 L66 70 L56 66 L50 72 L43 66 L34 70 Z" fill="#f4f8ff" opacity=".9"/><path d="M50 70 L74 114 L62 109 L53 116 L44 110 L28 116 Z" fill="#f4f8ff" opacity=".9"/>
        ${orn}
        ${lit ? '<circle cx="50" cy="12" r="24" fill="url(#sg)"/>' : ''}
        <path d="M50 2 L53.2 9.6 L61.5 10 L55 15.2 L57.2 23 L50 18.6 L42.8 23 L45 15.2 L38.5 10 L46.8 9.6 Z" fill="${lit ? '#ffe36e' : '#cfc7d8'}" stroke="${lit ? '#fff7c2' : '#a79fb3'}" stroke-width="1"/>
      </svg>`;
      document.body.appendChild(treeEl); last = { n, w, h, tile, base };
    },
    clear() { treeEl?.remove(); treeEl = null; },
    stats() { return last; },
  };
})();
