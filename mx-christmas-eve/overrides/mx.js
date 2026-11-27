// MOCK (capture time): window.__mx.<fn>() builds DOM overlays over the real app. Art is CSS/SVG stand-ins, not the 3D renderer.
(() => {
  const $ = (h) => { const d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstElementChild; };
  const add = (n) => { document.body.appendChild(n); return n; };
  const clear = () => document.querySelectorAll('.mx-x').forEach((n) => n.remove());
  const tag = (n) => { n.classList.add('mx', 'mx-x'); return n; };
  // Snowbundle stand-in (SVG): fat two-tier gumdrop, ice-blue body, white belly+cap, cranberry hat+scarf, lit gold star, dot eyes, blush, smile.
  const snowbundle = (w, tiny) => `<svg viewBox="0 0 220 240" width="${w}" aria-label="Snowbundle, a big snowy squishy" role="img">
   <defs><radialGradient id="b${tiny ? 't' : ''}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#d9eefc"/><stop offset="1" stop-color="#a9cfee"/></radialGradient>
   <radialGradient id="g${tiny ? 't' : ''}"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#ffcc4d" stop-opacity="0"/></radialGradient></defs>
   <ellipse cx="110" cy="228" rx="84" ry="9" fill="#9fc1e0" opacity=".35"/>
   <ellipse cx="110" cy="160" rx="100" ry="68" fill="url(#b${tiny ? 't' : ''})" stroke="#9fc1e0" stroke-width="2"/>
   <ellipse cx="110" cy="176" rx="64" ry="44" fill="#fff"/>
   <ellipse cx="22" cy="165" rx="14" ry="22" fill="#d9eefc" stroke="#9fc1e0" stroke-width="2"/><ellipse cx="198" cy="165" rx="14" ry="22" fill="#d9eefc" stroke="#9fc1e0" stroke-width="2"/>
   <ellipse cx="110" cy="92" rx="58" ry="52" fill="url(#b${tiny ? 't' : ''})" stroke="#9fc1e0" stroke-width="2"/>
   <path d="M62 78 Q110 -6 158 78 Z" fill="#d9485a"/><rect x="58" y="72" width="104" height="14" rx="7" fill="#fff"/>
   <path d="M150 22 Q172 4 176 30" fill="none" stroke="#d9485a" stroke-width="10" stroke-linecap="round"/>
   <circle cx="176" cy="30" r="22" fill="url(#g${tiny ? 't' : ''})"/><path d="M176 18 l4 9 10 1 -8 6 3 10 -9-5 -9 5 3-10 -8-6 10-1z" fill="#ffcc4d" stroke="#e0a52e" stroke-width="1.5"/>
   <circle cx="90" cy="104" r="6" fill="#4a3150"/><circle cx="130" cy="104" r="6" fill="#4a3150"/><circle cx="92" cy="102" r="2" fill="#fff"/><circle cx="132" cy="102" r="2" fill="#fff"/>
   <ellipse cx="76" cy="118" rx="9" ry="6" fill="#f7a9b8" opacity=".8"/><ellipse cx="144" cy="118" rx="9" ry="6" fill="#f7a9b8" opacity=".8"/>
   <path d="M98 120 Q110 130 122 120" fill="none" stroke="#4a3150" stroke-width="3.5" stroke-linecap="round"/>
   <path d="M52 134 Q110 160 168 134 L172 152 Q110 178 48 152 Z" fill="#d9485a"/><path d="M150 150 Q168 190 150 214" fill="none" stroke="#d9485a" stroke-width="16" stroke-linecap="round"/></svg>`;
  const bundlebit = (w) => `<svg viewBox="0 0 120 120" width="${w}" aria-label="Bundlebit, the tiny form" role="img"><ellipse cx="60" cy="112" rx="38" ry="5" fill="#9fc1e0" opacity=".35"/>
   <ellipse cx="60" cy="68" rx="46" ry="42" fill="#d9eefc" stroke="#9fc1e0" stroke-width="2"/><ellipse cx="60" cy="80" rx="30" ry="24" fill="#fff"/>
   <path d="M24 46 Q60 -8 96 46 Z" fill="#d9485a"/><rect x="22" y="42" width="76" height="11" rx="5.5" fill="#fff"/><circle cx="60" cy="6" r="8" fill="#ffcc4d" stroke="#e0a52e" stroke-width="1.5"/>
   <circle cx="45" cy="64" r="4.5" fill="#4a3150"/><circle cx="75" cy="64" r="4.5" fill="#4a3150"/><ellipse cx="34" cy="74" rx="6" ry="4" fill="#f7a9b8" opacity=".8"/><ellipse cx="86" cy="74" rx="6" ry="4" fill="#f7a9b8" opacity=".8"/>
   <path d="M53 76 Q60 83 67 76" fill="none" stroke="#4a3150" stroke-width="3" stroke-linecap="round"/><path d="M30 90 Q60 104 90 90 L92 100 Q60 114 28 100 Z" fill="#d9485a"/></svg>`;
  const puddlepuff = (w) => `<svg viewBox="0 0 100 110" width="${w}" aria-label="Puddlepuff, for scale" role="img"><ellipse cx="50" cy="104" rx="30" ry="4" fill="#9fc1e0" opacity=".35"/>
   <path d="M50 4 Q86 44 86 70 A36 34 0 0 1 14 70 Q14 44 50 4 Z" fill="#7cc0f4" stroke="#3f86d8" stroke-width="2"/><ellipse cx="50" cy="82" rx="22" ry="14" fill="#e8f6ff"/>
   <circle cx="38" cy="62" r="4" fill="#2f4a6e"/><circle cx="62" cy="62" r="4" fill="#2f4a6e"/><path d="M42 74 Q50 82 58 74" fill="none" stroke="#2f4a6e" stroke-width="3" stroke-linecap="round"/></svg>`;
  const W = window.__mx = { clear, snowbundle, bundlebit, puddlepuff };
  // (a) patch bar in the real boss strip. pct 0..100. Idempotent (a 50 ms loop keeps it if the HUD re-renders).
  W.patchBar = (pct) => {
    W.pct = pct;
    if (W.loop) return;
    const put = () => {
      const strip = document.querySelector('.boss-strip'); if (!strip) return;
      const lines = strip.querySelectorAll('.boss-strip-line'); const line = lines[lines.length - 1]; if (!line) return;
      let p = line.querySelector('.mx-patch');
      if (!p) { p = $('<div class="mx mx-patch" ><span class="mx-star" aria-hidden="true">❄️</span><div class="mx-track" role="progressbar" aria-label="Snowy patch bar"><div class="mx-fill"></div></div><span class="mx-pct"></span></div>');
        const slot = line.querySelector('.boss-slot'); line.insertBefore(p, slot); }
      p.querySelector('.mx-fill').style.width = W.pct + '%';
      p.querySelector('.mx-pct').textContent = W.pct + '%';
      p.querySelector('.mx-track').setAttribute('aria-valuenow', W.pct);
      p.classList.toggle('mx-full', W.pct >= 100);
    };
    put(); W.loop = setInterval(put, 50);
  };
  W.sticker = (text, top) => { add(tag($(`<div class="mx-sticker" data-cap-text style="top:${top}px">${text}</div>`))); };
  // (b) notice chip + event card
  W.chip = (text) => add(tag($(`<div class="mx-chip" data-cap-target><span class="e">❄️</span><span data-cap-text>${text}</span></div>`)));
  W.eventCard = () => add(tag($(`<div class="mx-card" role="dialog"><button class="x" aria-label="Close" data-cap-target>✕</button>
    <div class="row"><div class="art">${snowbundle(92)}</div><div><h2 data-cap-text>A BIG snowy squishy!</h2></div></div>
    <p data-cap-text>It's coming to see your lights. Bring your friends and make the patch cozy!</p>
    <div class="mx-box" data-cap-text><b>Here from 4 pm tonight.</b> Everyone who joins in shares the big snowy fall tomorrow morning ☃️</div>
    <button class="mx-btn" data-cap-target><span data-cap-text style="color:#fff">Show me where</span></button>
    <button class="mx-btn sec" data-cap-target><span data-cap-text style="color:#7a2d55">Later</span></button></div>`)));
  // (c) the fall
  W.fall = (n = 46) => {
    const w = innerWidth, h = innerHeight;
    for (let i = 0; i < n; i++) { const f = $('<div class="mx-flake mx-x"></div>'); const s = 5 + (i * 7) % 9;
      f.style.cssText += `width:${s}px;height:${s}px;left:${(i * 53) % w}px;top:${(i * 97) % (h * .6) + h * .08}px;opacity:${.55 + (i % 5) / 12}`; add(f); }
    const b = tag($(`<div class="mx-bigslot">${snowbundle(Math.min(260, w * .62))}</div>`));
    b.style.left = '50%'; b.style.top = Math.round(h * .24) + 'px'; b.style.transform = 'translateX(-50%) scale(1,.9)'; b.style.transformOrigin = 'bottom center'; add(b);
  };
  W.thanks = () => add(tag($(`<div class="mx-card" role="dialog"><button class="x" aria-label="Close" data-cap-target>✕</button>
    <h2 data-cap-text>Snowbundle says thank you!</h2>
    <p data-cap-text>The whole patch lit up. Snowbundle flopped into a big, happy snow pillow.</p>
    <div class="mx-loot"><span data-cap-text>🎁 Present</span><span data-cap-text>❄️ Frost Dust</span><span data-cap-text>💖 3 Heart Charms</span></div>
    <div class="mx-box"><span data-cap-text><b>Be friends?</b> Bundlebit would love to join you. <span class="mx-hearts">❤️❤️🤍🤍</span> You get 2 asks.</span></div>
    <button class="mx-btn" data-cap-target><span data-cap-text style="color:#fff">Ask to be friends</span><small data-cap-text style="color:#fff">3 💖</small></button>
    <button class="mx-btn sec" data-cap-target><span data-cap-text style="color:#7a2d55">Wave goodbye</span></button></div>`)));
  W.morning = () => add(tag($(`<div class="mx-card" role="dialog"><button class="x" aria-label="Close" data-cap-target>✕</button>
    <div class="row"><div class="art">${snowbundle(84)}</div><div><h2 data-cap-text>It dozed off!</h2></div></div>
    <p data-cap-text>Snowbundle got sleepy and wandered home. It left you a thank-you bundle.</p>
    <div class="mx-loot"><span data-cap-text>🎁 Present</span><span data-cap-text>❄️ Frost Dust</span></div>
    <button class="mx-btn" data-cap-target><span data-cap-text style="color:#fff">Thanks, Snowbundle!</span></button></div>`)));
  // (d) gallery
  W.gallery = () => add(tag($(`<div class="mx-gal" role="dialog"><button class="x mx-btn" style="position:absolute;top:8px;right:8px;width:44px;height:44px;border-radius:50%;margin:0;padding:0;background:#f6dceb;color:#7a2d55;box-shadow:none" aria-label="Close" data-cap-target>✕</button>
    <h2 data-cap-text>Snowbundle</h2><div class="sub" data-cap-text>The BIG snowy squishy. Frost · Cozy. Only visits on Christmas Eve!</div>
    <div class="stage"><div class="ground"></div>
      <div style="position:absolute;left:4%;bottom:26px" id="mx-big">${snowbundle(200)}</div>
      <div style="position:absolute;left:61%;bottom:26px" id="mx-tiny">${bundlebit(68)}</div>
      <div style="position:absolute;left:82%;bottom:26px" id="mx-pp">${puddlepuff(60)}</div>
      <div class="lab l1" data-cap-text>Snowbundle</div><div class="lab l2" data-cap-text>Bundlebit</div><div class="lab l3" data-cap-text>Puddlepuff</div></div>
    <p style="margin-top:8px" data-cap-text>Bundlebit is its tiny form: the friend who joins your team. (Stand-in drawing, not the 3D art.)</p></div>`)));
})();
