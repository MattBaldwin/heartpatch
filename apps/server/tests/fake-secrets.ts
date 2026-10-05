import { formatRecoveryCode } from '@heartpatch/shared';
import type * as Secrets from '../src/modules/auth/secrets.js';

/**
 * `modules/auth/secrets.ts` with its Argon2 hashing swapped for a cheap
 * stand-in, for tests that are about what the auth routes do, not about
 * hashing: every attempt would otherwise cost a full Argon2id check (64 MiB,
 * four lanes), and a file with dozens of them timed out under a parallel
 * `pnpm test`. `secrets.test.ts` covers the real hashing. Mock with
 *
 *   vi.mock('./secrets.js', async (importOriginal) =>
 *     (await import('../../../tests/fake-secrets.js')).fakeSecrets(
 *       await importOriginal<typeof Secrets>(),
 *     ),
 *   );
 *
 * (`vi.mock` is hoisted above the file's imports, so the stand-in is
 * imported inside the factory, and the real module is handed in rather than
 * imported here, where the mock would hand this module back to itself.)
 */
export function fakeSecrets(actual: typeof Secrets): typeof Secrets {
  const fake = (secret: string) => `plain:${secret}`;
  const hashSecret: typeof Secrets.hashSecret = (secret) => Promise.resolve(fake(secret));
  return {
    ...actual,
    hashSecret,
    verifySecret: (hash, secret) => Promise.resolve(hash === fake(secret)),
    verifyAgainstDummy: () => Promise.resolve(false as const),
    // Calls `hashSecret` inside the real module, which the mock can't reach.
    newResetCredentials: async () => {
      const temporaryPassword = actual.newTemporaryPassword();
      const recoveryCode = actual.newRecoveryCode();
      return {
        temporaryPassword,
        recoveryCode: formatRecoveryCode(recoveryCode),
        passwordHash: await hashSecret(temporaryPassword),
        newRecoveryCodeHash: await hashSecret(recoveryCode),
      };
    },
  };
}
