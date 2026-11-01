import { describe, expect, it } from 'vitest';
import { fakeClient, SETTINGS, VAPID_KEY, type FakeClientOptions } from './push-fixtures.js';
import { loadNudges } from './push-settings.js';

const load = (opts: FakeClientOptions & { standalone?: boolean } = {}) => {
  const fake = fakeClient(opts);
  return {
    ...fake,
    nudges: loadNudges({ client: fake.client, standalone: () => opts.standalone ?? true }),
  };
};

describe('Settings › Nudges row', () => {
  it('is On with permission granted and a subscription here', async () => {
    const t = load({ permission: 'granted', subscribed: true });
    expect((await t.nudges)?.state).toBe('on');
    expect((await t.nudges)?.settings).toEqual(SETTINGS);
  });

  it('is Off with permission not asked yet', async () => {
    expect((await load().nudges)?.state).toBe('off');
  });

  it('is Off (offering On) when granted but with no subscription, after a logout', async () => {
    expect((await load({ permission: 'granted', subscribed: false }).nudges)?.state).toBe('off');
  });

  it('is "Off in iPhone Settings" when iOS said no', async () => {
    expect((await load({ permission: 'denied' }).nudges)?.state).toBe('blocked');
  });

  it('is "Add to Home Screen first" in a plain tab', async () => {
    expect((await load({ supported: false, standalone: false }).nudges)?.state).toBe('install');
  });

  it('hides when push is off for me (NOT_FOUND), unreachable, or this app has no push', async () => {
    expect(await load({ status: { state: 'off' } }).nudges).toBeNull();
    expect(await load({ status: { state: 'unreachable' } }).nudges).toBeNull();
    expect(await load({ supported: false, standalone: true }).nudges).toBeNull();
    expect(await load({ device: false }).nudges).toBeNull();
  });

  it('reads the status and device before the On control shows (tap rule)', async () => {
    const t = load();
    await t.nudges;
    expect(t.log).toEqual(['status', 'device']);
  });
});

describe('the On/Off control', () => {
  it('On subscribes synchronously (the tap rule)', async () => {
    const t = load();
    const nudges = await t.nudges;
    t.log.length = 0;
    const marker = Promise.resolve().then(() => t.log.push('first await'));
    const outcome = nudges?.turnOn();
    expect(t.log).toEqual(['subscribe key']);
    await marker;
    expect(await outcome).toBe('on');
  });

  it('On retries once when subscribe failed with the prompt open but Allow was tapped', async () => {
    const t = load({ outcomes: ['failed', 'on'] });
    expect(await (await t.nudges)?.turnOn()).toBe('on');
    expect(t.log.filter((l) => l === 'subscribe key')).toHaveLength(2);
  });

  it('Off unsubscribes this device; the next read is Off', async () => {
    const t = load({ permission: 'granted', subscribed: true });
    await (await t.nudges)?.turnOff();
    expect(t.log).toContain('unsubscribe');
    const again = await loadNudges({ client: t.client, standalone: () => true });
    expect(again?.state).toBe('off');
  });

  it('has no control in the blocked state (never re-prompts)', async () => {
    const t = load({ permission: 'denied' });
    expect(await (await t.nudges)?.turnOn()).toBe('failed');
    expect(t.log).not.toContain('subscribe key');
  });
});

describe('the four switches', () => {
  it('save one switch at a time and keep what the server saved', async () => {
    const t = load({ permission: 'granted', subscribed: true });
    const nudges = await t.nudges;
    const saving = nudges?.toggle('friend', false);
    // Optimistic: the new value shows while the save is out.
    expect(nudges?.settings.friend).toBe(false);
    expect(await saving).toBe(false);
    expect(t.log).toContain('save {"friend":false}');
    expect(nudges?.settings).toEqual({ ...SETTINGS, friend: false });
  });

  it('go back when the save fails', async () => {
    const t = load({ permission: 'granted', subscribed: true, saved: () => null });
    const nudges = await t.nudges;
    expect(await nudges?.toggle('dusk', false)).toBe(true);
    expect(nudges?.settings.dusk).toBe(true);
  });

  it('go back when push turned off for me', async () => {
    const t = load({ permission: 'granted', subscribed: true, saved: () => 'off' });
    const nudges = await t.nudges;
    expect(await nudges?.toggle('gatherers', false)).toBe(true);
    expect(nudges?.settings.gatherers).toBe(true);
  });

  it('start from the server, not a stored flag', async () => {
    const t = load({
      permission: 'granted',
      subscribed: true,
      status: {
        state: 'available',
        vapidPublicKey: VAPID_KEY,
        settings: { ...SETTINGS, longNight: false },
      },
    });
    expect((await t.nudges)?.settings.longNight).toBe(false);
  });
});
