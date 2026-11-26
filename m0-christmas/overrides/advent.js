(() => {
  document.getElementById('cap-advent')?.remove();
  const d = document.createElement('div'); d.id = 'cap-advent'; d.setAttribute('role', 'dialog');
  const claimed = new Set([1, 2, 4]), today = 5, catchUp = 3;
  let cells = '';
  for (let n = 1; n <= 25; n++) {
    let cls = 'locked', sub = '🔒', lab = `Day ${n}, locked`;
    if (claimed.has(n)) { cls = 'claimed'; sub = '🎁✓'; lab = `Day ${n}, opened`; }
    else if (n === today) { cls = 'today'; sub = '🎁'; lab = `Day ${n}, today, open it!`; }
    else if (n === catchUp) { cls = 'catch'; sub = 'catch up'; lab = `Day ${n}, you missed it, open it now`; }
    else if (n === 24) sub = '🎆';
    else if (n === 25) sub = '⭐';
    cells += `<button class="day ${cls}" aria-label="${lab}" data-cap-target><span data-cap-text>${n}</span><small data-cap-text>${sub}</small></button>`;
  }
  d.innerHTML = `<button class="x" aria-label="Close" data-cap-target>✕</button>
    <h2 data-cap-text>Presents under the tree 🎄</h2>
    <p class="sub" data-cap-text>One present a day. Open today's, or one you missed!</p>
    <div class="grid">${cells}</div>
    <div class="key"><span data-cap-text>🎁✓ opened</span><span data-cap-text>🎁 today</span><span data-cap-text>catch up: 1 a day</span><span data-cap-text>🔒 not yet</span></div>
    <div class="box" data-cap-text><b>Today's present might hold:</b> 🍬 Treats, 🥧 Pies, ✨ Heartdust, 🪙 Patch Coins, a cozy Christmas outfit… Surprise!</div>
    <button class="open" data-cap-target><span data-cap-text style="color:#fff">Open today's present</span></button>
    <button class="quiet" data-cap-target><span data-cap-text style="color:#7a2d55">Open the one I missed (Day 3)</span></button>`;
  document.body.appendChild(d);
})();
