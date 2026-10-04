import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName } from './players.js';

/**
 * Sound (#25), checked through the dev hook's signals, never real sound
 * (headless WebKit has no audio output). Whether a context can run depends on
 * the browser, so the checks hold for every state past `locked`.
 */

interface AudioSignals {
  state: 'locked' | 'starting' | 'running' | 'suspended' | 'unsupported';
  engine: 'idle' | 'loading' | 'ready' | 'failed';
  track: string;
  playing: string | null;
  lastCue: string | null;
  cues: number;
  played: number;
  settings: { music: number; sounds: number; musicOn: boolean; soundsOn: boolean };
}

const audio = (page: Page) => hook<AudioSignals>(page, 'audio');

test('sound waits for a tap, ticks for buttons, and keeps its settings on this device', async ({
  browser,
}) => {
  // Signup goes through the Keeper picker's 3D preview (#42); CI renders in software.
  test.setTimeout(90_000);
  const page = await newPlayer(browser, uniqueName('snd'));

  // Signing up was all taps: sound is unlocked (or the browser has none), and
  // the buttons asked for ticks.
  await expect.poll(async () => (await audio(page))?.state).not.toBe('locked');
  const first = await audio(page);
  expect(first?.lastCue).toBe('tick');
  expect(first?.cues).toBeGreaterThan(0);
  if (first?.state === 'running') {
    await expect.poll(async () => (await audio(page))?.engine).toBe('ready');
    // The loop for where the player is (day, night or Halloween, by date).
    await expect.poll(async () => (await audio(page))?.playing).toBe(first.track);
  }

  // Settings: switch the music off and turn the sounds down.
  const lobby = page.getByTestId('lobby');
  await lobby.getByTestId('lobby-settings').tap();
  const settings = lobby.getByTestId('audio-settings');
  await expect(settings).toBeVisible();
  const musicSwitch = settings.getByRole('button', { name: 'Play music' });
  await expect(musicSwitch).toHaveAttribute('aria-pressed', 'true');
  await musicSwitch.tap();
  await expect(musicSwitch).toHaveAttribute('aria-pressed', 'false');
  await expect(settings.getByTestId('audio-music-volume')).toBeDisabled();
  await settings.getByTestId('audio-sounds-volume').fill('3');
  await expect
    .poll(async () => (await audio(page))?.settings)
    .toEqual(expect.objectContaining({ musicOn: false, sounds: 0.3 }));
  expect((await audio(page))?.playing).toBeNull();

  // A fresh page: silent and locked until a tap, with the settings kept.
  await page.reload();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  const reloaded = await audio(page);
  expect(reloaded?.state).toBe('locked');
  expect(reloaded?.engine).toBe('idle');
  expect(reloaded?.settings).toEqual(expect.objectContaining({ musicOn: false, sounds: 0.3 }));
  await lobby.getByTestId('lobby-settings').tap();
  await expect(settings.getByRole('button', { name: 'Play music' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(settings.getByTestId('audio-sounds-volume')).toHaveValue('3');
  await expect.poll(async () => (await audio(page))?.state).not.toBe('locked');
  // Music stays off after the unlock.
  expect((await audio(page))?.playing).toBeNull();
  await page.context().close();
});
