import { HealthResponseSchema } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { apiCall, apiCallFor, ApiRequestError } from './api.js';

/** A fetch that records the request and answers with `status` and `body`. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    );
  };
  return { impl, calls };
}

describe('apiCall', () => {
  it('sends the CSRF header and JSON body, and validates the reply', async () => {
    const fake = fakeFetch(200, { status: 'ok', version: 'dev', uptimeSeconds: 1 });
    const health = await apiCallFor(
      '/health',
      { method: 'POST', body: { a: 1 }, schema: HealthResponseSchema },
      fake.impl,
    );
    expect(health).toEqual({ status: 'ok', version: 'dev', uptimeSeconds: 1 });
    const { url, init } = fake.calls[0]!;
    expect(url).toBe('/api/v1/health');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toEqual({
      'x-requested-with': 'heartpatch',
      'content-type': 'application/json',
    });
    expect(init.body).toBe('{"a":1}');
  });

  it('turns error envelopes into kid-readable errors', async () => {
    const fake = fakeFetch(409, { error: { code: 'CONFLICT', message: 'This patch is full!' } });
    const err = await apiCall('/maps/join', { method: 'POST', schema: null }, fake.impl).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ code: 'CONFLICT', message: 'This patch is full!' });
  });

  it('reports being offline and unreadable errors gently', async () => {
    const offline = (() => Promise.reject(new TypeError('Load failed'))) as typeof fetch;
    await expect(apiCall('/me', { method: 'GET', schema: null }, offline)).rejects.toMatchObject({
      code: 'OFFLINE',
    });
    const junk = fakeFetch(502, undefined);
    await expect(apiCall('/me', { method: 'GET', schema: null }, junk.impl)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('returns null for empty replies, reading the body out first (#163)', async () => {
    const fake = fakeFetch(204, undefined);
    expect(await apiCall('/auth/logout', { method: 'POST', schema: null }, fake.impl)).toBeNull();
    // A reply left unread is cancelled when its Response is collected, which
    // Chromium logs as net::ERR_ABORTED on every acknowledge.
    let read = false;
    const reply = new Response(null, { status: 204 });
    reply.arrayBuffer = () => {
      read = true;
      return Promise.resolve(new ArrayBuffer(0));
    };
    const watched = (() => Promise.resolve(reply)) as typeof fetch;
    expect(
      await apiCall('/tutorial/acknowledge', { method: 'POST', schema: null }, watched),
    ).toBeNull();
    expect(read).toBe(true);
  });
});
