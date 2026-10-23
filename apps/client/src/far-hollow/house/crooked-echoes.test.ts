import { CROOKED_HOUSE, echoCatch, type CrookedHouseView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { echoHint, echoPhases, echoSpots, serverClock } from './crooked-echoes.js';
import { doorEnd, litRooms } from './crooked-plan.js';

/** In the Front Hall with the north door open; the stair echo starts by the Stair Hall's middle. */
function house(over: Partial<CrookedHouseView> = {}): CrookedHouseView {
  return {
    room: 'front-hall',
    lastLitRoom: 'front-hall',
    keys: ['brass-key'],
    unlocked: ['north-door'],
    bonusOpen: [],
    chestsOpened: [],
    rooms: CROOKED_HOUSE.rooms
      .filter((r) => r.kind === 'main')
      .map((r) => ({ id: r.id, fixed: [], bloomed: r.id === 'front-hall' })),
    echoes: [{ loop: 'stair-echo', offset: 0, direction: 1 }],
    serverTime: '2026-10-30T16:00:00.000Z',
    ...over,
  };
}

const loop = CROOKED_HOUSE.echoLoops.find((l) => l.id === 'stair-echo')!;
/** The ms (a whole number of laps on) at which the stair echo is `rooms` along its loop. */
const lapAt = (rooms: number) => 1000 * loop.periodSeconds * (40 + rooms / loop.rooms.length);
const bloomed = (...ids: string[]) =>
  house().rooms.map((r) => ({ ...r, bloomed: r.id === 'front-hall' || ids.includes(r.id) }));
const northDoor = CROOKED_HOUSE.doors.find((d) => d.id === 'north-door')!;
const atNorthDoor = { x: 0.2, z: 1.6 };

describe('the echoes as the house screen draws them (#306 6d)', () => {
  it('drifts from one room’s middle to the next through the doorway between them', () => {
    const [start] = echoSpots(house(), lapAt(0));
    expect(start).toMatchObject({ loop: 'stair-echo', room: 'stair-hall', floor: 0, shown: 1 });
    expect(start!.at.x).toBeCloseTo(0.1);
    expect(start!.at.z).toBeCloseTo(5.6);
    const [there] = echoSpots(house(), lapAt(1));
    expect(there).toMatchObject({ room: 'dining-room' });
    expect(there!.at.x).toBeCloseTo(-5.7);
    // Halfway, it's in the doorway between them.
    const [half] = echoSpots(house(), lapAt(0.5));
    const door = CROOKED_HOUSE.doors.find((d) => d.id === 'dining-door')!;
    const end = doorEnd(door, 'stair-hall')!;
    const other = doorEnd(door, 'dining-room')!;
    expect(half!.at.x).toBeLessThanOrEqual(end.point.x + 1e-9);
    expect(half!.at.x).toBeGreaterThanOrEqual(other.point.x - 1e-9);
    expect(echoSpots(house(), lapAt(0.45))[0]!.at.x).toBeCloseTo(end.point.x);
    expect(half!.between).toEqual(['stair-hall', 'dining-room']);
  });

  it('goes the other way round with direction −1, on the same clock', () => {
    const back = house({ echoes: [{ loop: 'stair-echo', offset: 0, direction: -1 }] });
    const [p] = echoSpots(back, lapAt(0.25));
    expect(p!.position).toBeCloseTo(loop.rooms.length - 0.25);
  });

  it('shies from a lit room, and is gone once every room of its loop is put right', () => {
    const lit = house({ rooms: bloomed('dining-room') });
    expect(echoSpots(lit, lapAt(0))[0]!.shown).toBe(1);
    expect(echoSpots(lit, lapAt(1))[0]!.shown).toBe(0);
    expect(echoSpots(lit, lapAt(0.5))[0]!.shown).toBeCloseTo(0.5);
    expect(echoSpots(lit, lapAt(0))[0]!.gone).toBe(false);
    const all = house({ rooms: bloomed('dining-room', 'stair-hall') });
    expect(echoSpots(all, lapAt(0))[0]).toMatchObject({ shown: 0, gone: true });
  });

  it('hears an echo past a nearby dark doorway exactly when the server would catch me there', () => {
    const h = house();
    const lit = litRooms(h);
    const phases = echoPhases(h);
    for (let step = 0; step <= 40; step++) {
      const at = lapAt(step / 20);
      const heard = echoHint(h, atNorthDoor, at, false);
      expect(heard?.door.id).toBe('north-door');
      expect(heard?.room).toBe('stair-hall');
      for (const tiptoe of [false, true]) {
        const server = echoCatch(CROOKED_HOUSE, phases, {
          room: 'stair-hall',
          atMs: at,
          tiptoe,
          lit,
        });
        expect(tiptoe ? heard?.soft : heard?.plain).toBe(server?.id ?? null);
      }
    }
  });

  it('lets Tiptoe past an echo that is near but not right there (owner decision 2)', () => {
    const near = echoHint(house(), atNorthDoor, lapAt(0.22), false);
    expect(near).toMatchObject({ plain: 'stair-echo', soft: null, watching: 'stair-echo' });
    expect(echoHint(house(), atNorthDoor, lapAt(0.22), true)?.watching).toBeNull();
    const close = echoHint(house(), atNorthDoor, lapAt(0.02), true);
    expect(close).toMatchObject({
      plain: 'stair-echo',
      soft: 'stair-echo',
      watching: 'stair-echo',
    });
    expect(echoHint(house(), atNorthDoor, lapAt(1), false)).toMatchObject({
      plain: null,
      soft: null,
    });
  });

  it('hears nothing far from a doorway, through a shut door, or into a lit room', () => {
    expect(echoHint(house(), { x: 0, z: -1.5 }, lapAt(0), false)).toBeNull();
    expect(echoHint(house({ unlocked: [] }), atNorthDoor, lapAt(0), false)).toBeNull();
    expect(
      echoHint(house({ rooms: bloomed('stair-hall') }), atNorthDoor, lapAt(0), false),
    ).toBeNull();
    expect(doorEnd(northDoor, 'front-hall')).not.toBeNull();
  });

  it('keeps the server’s clock from the view', () => {
    const clock = serverClock('2026-10-30T16:00:00.000Z', Date.parse('2026-10-30T15:59:58.000Z'));
    expect(clock(Date.parse('2026-10-30T15:59:59.000Z'))).toBe(
      Date.parse('2026-10-30T16:00:01.000Z'),
    );
    expect(serverClock('nonsense', 5)(10)).toBe(10);
  });
});
