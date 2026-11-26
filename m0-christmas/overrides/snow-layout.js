// MOCK: the `fall` drift mode already exists (leaves); give it snow's size, height and sway, over all land.
if (sessionStorage.getItem('__capSnow') === '1') {
  TERRAINS_FOR.leaves = ['meadow', 'forest', 'old-forest', 'hills', 'pumpkin-fields', 'mountains', 'clearing', 'coast'];
  Object.assign(STYLE.leaves, { lift: [0.9, 1.7], size: [0.05, 0.085], range: [0.3, 0.55], speed: [0.35, 0.65] });
}
