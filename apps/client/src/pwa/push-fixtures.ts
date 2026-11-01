import type { PushSettings } from '@heartpatch/shared';
import type { PushDevice, PushStatus, SubscribeOutcome } from './push-client.js';
import type { PushUiClient } from './push-offer.js';

// Fakes for the push UI's tests (#726): a push client that logs every call.

export const VAPID_KEY = `B${'A'.repeat(86)}`;
export const SETTINGS: PushSettings = {
  dusk: true,
  gatherers: true,
  friend: true,
  longNight: true,
};

export interface FakeClientOptions {
  supported?: boolean;
  permission?: NotificationPermission;
  status?: PushStatus;
  device?: boolean;
  subscribed?: boolean;
  /** What each `subscribe` resolves, in turn (the last one repeats). */
  outcomes?: SubscribeOutcome[];
  /** The permission once `subscribe` has asked (the prompt's answer). */
  answer?: NotificationPermission;
  saved?: (patch: Partial<PushSettings>) => PushSettings | 'off' | null;
}

/** A fake push client: every call lands in `log`, in order. */
export function fakeClient(opts: FakeClientOptions = {}) {
  const log: string[] = [];
  let permission: NotificationPermission = opts.permission ?? 'default';
  let subscribed = opts.subscribed ?? false;
  const outcomes = [...(opts.outcomes ?? ['on'])];
  const device: PushDevice = {
    subscribe: (key) => {
      log.push(`subscribe ${key === VAPID_KEY ? 'key' : key}`);
      if (permission === 'default') permission = opts.answer ?? 'granted';
      const outcome = (outcomes.length > 1 ? outcomes.shift() : outcomes[0]) ?? 'on';
      if (outcome === 'on') subscribed = true;
      return Promise.resolve(outcome);
    },
    unsubscribe: () => {
      log.push('unsubscribe');
      subscribed = false;
      return Promise.resolve();
    },
    subscription: () =>
      Promise.resolve(
        subscribed
          ? {
              endpoint: 'https://push.example/1',
              toJSON: () => ({}),
              unsubscribe: () => Promise.resolve(true),
            }
          : null,
      ),
  };
  const client: PushUiClient = {
    supported: () => opts.supported ?? true,
    permission: () => ((opts.supported ?? true) ? permission : 'unsupported'),
    status: () => {
      log.push('status');
      return Promise.resolve(
        opts.status ?? { state: 'available', vapidPublicKey: VAPID_KEY, settings: SETTINGS },
      );
    },
    device: () => {
      log.push('device');
      return Promise.resolve((opts.device ?? true) ? device : null);
    },
    saveSettings: (patch) => {
      log.push(`save ${JSON.stringify(patch)}`);
      return Promise.resolve(opts.saved ? opts.saved(patch) : { ...SETTINGS, ...patch });
    },
  };
  return { client, device, log, permission: () => permission };
}

/** Lets every pending promise settle. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
