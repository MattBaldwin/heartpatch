import { describe, expect, it } from 'vitest';
import { wardrobeBackTo, wardrobeFrom } from './wardrobe-return.js';

describe('where the wardrobe goes back to', () => {
  it('goes back to the patch it was opened on', () => {
    const from = wardrobeFrom({ lobbyOpen: false, patch: 'patch-1', glade: null });
    expect(from).toEqual({ mapId: 'patch-1', glade: false });
    expect(wardrobeBackTo(from, null)).toBe('patch-1');
  });

  it('goes back to the lobby when opened from its list, even over a map', () => {
    expect(wardrobeFrom({ lobbyOpen: true, patch: null, glade: null })).toBeNull();
    expect(wardrobeFrom({ lobbyOpen: true, patch: 'patch-1', glade: null })).toBeNull();
    expect(wardrobeBackTo(null, null)).toBeNull();
  });

  it('goes back to the lobby when no patch is on screen', () => {
    expect(wardrobeFrom({ lobbyOpen: false, patch: null, glade: null })).toBeNull();
  });

  it('goes back to the Glade while its run still has it open', () => {
    const from = wardrobeFrom({ lobbyOpen: false, patch: 'glade-1', glade: 'glade-1' });
    expect(from).toEqual({ mapId: 'glade-1', glade: true });
    expect(wardrobeBackTo(from, 'glade-1')).toBe('glade-1');
    // The tutorial's wardrobe step can open it while the Glade's map loads.
    expect(wardrobeFrom({ lobbyOpen: false, patch: null, glade: 'glade-1' })).toEqual(from);
  });

  it('goes to the lobby once that run is put away or done', () => {
    const from = wardrobeFrom({ lobbyOpen: false, patch: 'glade-1', glade: 'glade-1' });
    expect(wardrobeBackTo(from, null)).toBeNull();
    expect(wardrobeBackTo(from, 'glade-2')).toBeNull();
  });

  it('keeps a patch even if a Glade opens meanwhile', () => {
    const from = wardrobeFrom({ lobbyOpen: false, patch: 'patch-1', glade: null });
    expect(wardrobeBackTo(from, 'glade-1')).toBe('patch-1');
  });
});
