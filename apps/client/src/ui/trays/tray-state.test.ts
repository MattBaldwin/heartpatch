import { describe, expect, it } from 'vitest';
import {
  handleBadge,
  INITIAL_TRAYS,
  newPeeks,
  trayReducer,
  type TrayAction,
  type TrayAlert,
  type TrayState,
} from './tray-state.js';

const run = (...actions: TrayAction[]): TrayState => actions.reduce(trayReducer, INITIAL_TRAYS);

describe('trays', () => {
  it('start hidden and shut', () => {
    expect(INITIAL_TRAYS).toEqual({ visible: false, open: null, hint: false });
  });

  it('never open while the map is off screen', () => {
    expect(run({ type: 'open', side: 'adventure' }).open).toBeNull();
    expect(run({ type: 'toggle', side: 'heartpatch' }).open).toBeNull();
    expect(run({ type: 'hint' }).hint).toBe(false);
  });

  it('open one at a time, and a second tap on the same handle shuts it', () => {
    const left = run({ type: 'show' }, { type: 'toggle', side: 'adventure' });
    expect(left.open).toBe('adventure');
    expect(trayReducer(left, { type: 'toggle', side: 'heartpatch' }).open).toBe('heartpatch');
    expect(trayReducer(left, { type: 'toggle', side: 'adventure' }).open).toBeNull();
    expect(trayReducer(left, { type: 'close' }).open).toBeNull();
  });

  it('shut everything when the map goes away', () => {
    const open = run({ type: 'show' }, { type: 'open', side: 'heartpatch' });
    expect(trayReducer(open, { type: 'hide' })).toEqual(INITIAL_TRAYS);
  });

  it('show the first-time hint only over the map with both trays shut', () => {
    expect(run({ type: 'show' }, { type: 'hint' }).hint).toBe(true);
    expect(run({ type: 'show' }, { type: 'open', side: 'adventure' }, { type: 'hint' }).hint).toBe(
      false,
    );
  });

  it('count opening a tray as answering the hint', () => {
    const hinted = run({ type: 'show' }, { type: 'hint' });
    expect(trayReducer(hinted, { type: 'toggle', side: 'adventure' }).hint).toBe(false);
    expect(trayReducer(hinted, { type: 'dismiss-hint' }).hint).toBe(false);
  });

  it('return the same state when nothing changes', () => {
    const shown = run({ type: 'show' });
    expect(trayReducer(shown, { type: 'show' })).toBe(shown);
    expect(trayReducer(shown, { type: 'close' })).toBe(shown);
    expect(trayReducer(shown, { type: 'dismiss-hint' })).toBe(shown);
  });
});

describe('handle badges', () => {
  const alerts: TrayAlert[] = [
    { side: 'adventure', count: 2, peek: 'New challenge report!' },
    { side: 'adventure', count: 1, peek: null },
    { side: 'heartpatch', count: 0, peek: 'Nothing yet' },
  ];

  it('add up one side’s alerts', () => {
    expect(handleBadge(alerts, 'adventure')).toEqual({ text: '3', peek: 'New challenge report!' });
  });

  it('show nothing for a side with no live alerts', () => {
    expect(handleBadge(alerts, 'heartpatch')).toEqual({ text: null, peek: null });
  });

  it('cap a big number', () => {
    expect(handleBadge([{ side: 'heartpatch', count: 12, peek: null }], 'heartpatch').text).toBe(
      '9+',
    );
  });

  it('peek only for alerts that are new or changed', () => {
    const before: TrayAlert[] = [{ side: 'adventure', count: 1, peek: 'New challenge report!' }];
    expect(newPeeks(before, before)).toEqual([]);
    const more: TrayAlert[] = [{ side: 'adventure', count: 2, peek: 'New challenge report!' }];
    expect(newPeeks(before, more)).toEqual(more);
    expect(newPeeks([], [{ side: 'heartpatch', count: 1, peek: null }])).toEqual([]);
  });
});
