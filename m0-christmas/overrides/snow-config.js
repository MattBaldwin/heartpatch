// MOCK: snowfall replaces pollen/fireflies; leaves become white flakes over every land terrain (config only).
if (sessionStorage.getItem('__capSnow') === '1') {
  Object.assign(MOTES.leaves, { perTile: 1.4, max: 120, color: '#ffffff' });
  MOTES.pollen.perTile = 0; MOTES.pollen.max = 0;
  MOTES.fireflies.perTile = 0; MOTES.fireflies.max = 0;
}
