import { describe, expect, it } from 'vitest';
import { SpeciesVisualSchema, type Species } from '../../schemas/data/species.js';
import { GAME_DATA } from '../index.js';
import { SECRET_SPECIES } from './secret-species.js';

/**
 * Every species that existed before the optional `floater` (a camera-facing
 * glyph above a squishy, like Heartsong's song note), except Heartsong, which
 * the floater replaced body-attached parts on. New species don't move this.
 */
const BEFORE_FLOATER = (
  'puddlepuff splashmallow drizzledoze pebblesnooze boulderdoze rumblehorn ' +
  'emberbun hearthbun embernap snoozicle drowsiberg twirlicle fuzzbolt frizzbolt ' +
  'glidebolt fizzlepop zingaling snugglestar bubbletub bubbletide bubblejelly ' +
  'thistlepip bristlebloom petalprance flurrypup blusterpup mittenpup glimmerock ' +
  'glittercrag geodoze nookling snugglenook mothnook mossmuffin mossquilt ' +
  'sprinklemuff dawndrop dazzledrop moondrop thunderpuff thunderplume stormhoot ' +
  'gourdon glowgourd squashboo glowboo brightboo lullaboo upsybat topsywing ' +
  'hushwing candlekit wickwhisker sparklewick crunchkin maplecrunch huddlenut ' +
  'moonmoth cometsnail shellnap gnomnom lilyhop hailhop chillypep flakefluff ' +
  'heartlet heartbloom'
).split(' ');

describe('optional species visual fields stay off by default', () => {
  it('keeps every species without a floater exactly as it was', () => {
    // A hash of each one's parsed visual, taken before `floater` existed: a
    // species that doesn't ask for a floater must not move. FNV-1a over the
    // JSON text, public and secret species alike.
    const all = new Map<string, Species>(
      [...GAME_DATA.species, ...SECRET_SPECIES].map((s) => [s.id, s]),
    );
    let hash = 0x811c9dc5;
    const add = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
      }
    };
    for (const id of BEFORE_FLOATER) {
      const species = all.get(id);
      expect(species, id).toBeDefined();
      const visual = SpeciesVisualSchema.parse(species?.visual);
      expect(visual, id).not.toHaveProperty('floater');
      add(id + JSON.stringify(visual));
    }
    expect(hash.toString(16)).toBe('940f36dc');
  });
});
