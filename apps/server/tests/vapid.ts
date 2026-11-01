import { createECDH, randomBytes } from 'node:crypto';

/**
 * A fresh VAPID pair (#726), base64url as `web-push`'s `generateVAPIDKeys()`
 * makes them, for tests that turn push on (config needs keys then).
 */
export function newVapidPair(): { publicKey: string; privateKey: string } {
  for (;;) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const privateKey = ecdh.getPrivateKey();
    // Node drops a leading zero byte; config wants all 32. Retry instead.
    if (privateKey.length === 32) {
      return {
        publicKey: ecdh.getPublicKey().toString('base64url'),
        privateKey: privateKey.toString('base64url'),
      };
    }
  }
}

/** A browser's subscription keys, as `PushSubscription.toJSON()` gives them. */
export function newDeviceKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}
