import type { PushSettings } from '@heartpatch/shared';
import type { SubscribeOutcome } from './push-client.js';
import { subscribeOnTap, type PushUiClient } from './push-offer.js';

// Settings › Nudges (#726 plan, "Client UI flow"), without the DOM: the row's
// state from the real permission and this device's subscription (never a
// stored flag), the On/Off control and the four switches. The view is
// `push-settings-view.ts`.

/**
 * The row: `install` outside a Home Screen app, `blocked` when iOS says no
 * (Settings › Notifications › Heartpatch), `off` (including granted with no
 * subscription, after a logout) and `on`.
 */
export type NudgesState = 'install' | 'blocked' | 'off' | 'on';

/** One of the four switches. */
export type NudgeSwitch = keyof PushSettings;

export interface NudgesDeps {
  client: PushUiClient;
  /** A Home Screen app (`isStandalone()`), whether or not it has push. */
  standalone: () => boolean;
}

export interface Nudges {
  readonly state: NudgesState;
  /** The switches as last saved (or shown, while a save is out). */
  readonly settings: PushSettings;
  /**
   * The On control (only in `off`). Subscribes synchronously: call it first
   * thing in the click handler (the tap rule). Resolves the outcome.
   */
  turnOn: () => Promise<SubscribeOutcome>;
  /** The Off control (only in `on`): stops nudges on this device. */
  turnOff: () => Promise<void>;
  /**
   * A switch, optimistic: `settings` changes at once and goes back when the
   * save fails or push turned off. Resolves the value it ends on.
   */
  toggle: (key: NudgeSwitch, on: boolean) => Promise<boolean>;
}

/**
 * Reads the row fresh (call it each time Settings opens). Null hides the
 * group: push is off for this player (NOT_FOUND), the server can't be
 * reached, or this Home Screen app has no push (iOS before 16.4).
 */
export async function loadNudges(deps: NudgesDeps): Promise<Nudges | null> {
  const { client } = deps;
  const status = await client.status();
  if (status.state !== 'available') return null;
  let settings: PushSettings = { ...status.settings };
  const nudges = (
    state: NudgesState,
    turnOn: Nudges['turnOn'] = () => Promise.resolve('failed'),
    turnOff: Nudges['turnOff'] = () => Promise.resolve(),
  ): Nudges => ({
    state,
    get settings() {
      return settings;
    },
    turnOn,
    turnOff,
    toggle: async (key, on) => {
      const before = settings[key];
      settings = { ...settings, [key]: on };
      const saved = await client.saveSettings({ [key]: on });
      if (saved === null || saved === 'off') {
        settings = { ...settings, [key]: before };
        return before;
      }
      settings = { ...saved };
      return saved[key];
    },
  });
  if (!client.supported()) return deps.standalone() ? null : nudges('install');
  const permission = client.permission();
  if (permission === 'denied') return nudges('blocked');
  // Both before the On control shows: its click handler may not await.
  const device = await client.device();
  if (!device) return null;
  const subscription = permission === 'granted' ? await device.subscription() : null;
  const key = status.vapidPublicKey;
  return nudges(
    subscription ? 'on' : 'off',
    () => subscribeOnTap(device, key, client.permission),
    () => device.unsubscribe(),
  );
}
