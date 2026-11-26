/* Capture-time DOM sync (no app code touched): sets data-cap on <html> from the picker's visibility
   (window.__capForce = 'collapsed' pins it) and mirrors each team card's energy % onto the chip ring as --pct. */
(() => {
  if (window.__capSync) return;
  window.__capSync = setInterval(() => {
    const picker = document.querySelector('.boss-picker');
    const open = picker && !picker.hidden;
    document.documentElement.dataset.cap = window.__capForce === 'collapsed' ? 'collapsed' : open ? 'risen' : 'collapsed';
    for (const f of document.querySelectorAll('.boss-friend')) {
      const b = f.querySelector('.battle-energy');
      const v = b && b.getAttribute('aria-valuenow');
      if (v !== null && v !== undefined) f.style.setProperty('--pct', String(v));
    }
  }, 50);
})();
