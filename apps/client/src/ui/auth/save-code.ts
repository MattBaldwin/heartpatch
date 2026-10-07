import { el } from '../dom.js';
import { codePictureBlob, sharePicture } from './code-picture.js';

// The "save your recovery code" screen (#197): shown once after sign up, a
// reset with the code, or a new code from Settings. "Save a picture", "Copy",
// and an "I've saved it" tick that wakes up the button. One panel that swaps
// its own views, so the caller's update hold (#47) is never let go mid-way.

export const SAVE_CODE_TEXT = {
  subtitle: "Here's your secret recovery code:",
  hint: "It's your way back in if you forget your password. Keep it secret!",
  picture: 'Save a picture',
  copy: 'Copy',
  copied: 'Copied!',
  copyFailed: 'Write it down instead',
  tick: "I've saved it",
  next: 'Next',
  press: 'Press and hold the picture, then tap Save to Photos.',
  noPicture: "We couldn't make a picture here. Copy it or write it down instead!",
  done: 'Done',
  oneMoment: 'One moment…',
} as const;

export interface SaveCodeOptions {
  title: string;
  /** The `id` the dialog's `aria-labelledby` points at. */
  titleId: string;
  username: string;
  code: string;
  /** Tapped once "I've saved it" is ticked. */
  onDone: () => void;
  doneLabel?: string;
}

export function saveCodePanel(options: SaveCodeOptions): HTMLElement {
  const panel = el('div', { class: 'auth-form' });
  let pictureUrl: string | null = null;
  const dropPicture = () => {
    if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    pictureUrl = null;
  };

  const tickBox = el('input', {
    type: 'checkbox',
    id: `${options.titleId}-saved`,
    'data-testid': 'auth-code-saved',
  });
  const tick = el(
    'label',
    { class: 'auth-tick', for: `${options.titleId}-saved` },
    tickBox,
    el('span', {}, SAVE_CODE_TEXT.tick),
  );
  const done = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'auth-code-done' },
    options.doneLabel ?? SAVE_CODE_TEXT.next,
  );
  const sync = () => {
    // Asleep until the tick is on.
    done.disabled = !tickBox.checked;
    tick.classList.toggle('auth-tick-on', tickBox.checked);
  };
  tickBox.addEventListener('change', sync);
  let left = false;
  done.addEventListener('click', () => {
    if (!tickBox.checked || left) return;
    // Once only: after sign up the next screen may wait on the network.
    left = true;
    done.disabled = true;
    done.textContent = SAVE_CODE_TEXT.oneMoment;
    tickBox.disabled = true;
    dropPicture();
    options.onDone();
  });
  sync();

  const status = el('p', { class: 'auth-error', role: 'alert' });
  const picture = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'auth-code-picture' },
    SAVE_CODE_TEXT.picture,
  );
  picture.addEventListener('click', () => {
    if (picture.disabled) return;
    picture.disabled = true;
    status.textContent = '';
    void codePictureBlob(options.username, options.code)
      .then(async (blob) => {
        if (!blob) {
          status.textContent = SAVE_CODE_TEXT.noPicture;
          return;
        }
        if ((await sharePicture(blob, options.username)) === 'show') showPicture(blob);
      })
      .catch(() => {
        status.textContent = SAVE_CODE_TEXT.noPicture;
      })
      .finally(() => {
        picture.disabled = false;
      });
  });

  const copy = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft' },
    SAVE_CODE_TEXT.copy,
  );
  copy.addEventListener('click', () => {
    navigator.clipboard
      .writeText(options.code)
      .then(() => {
        copy.textContent = SAVE_CODE_TEXT.copied;
      })
      .catch(() => {
        copy.textContent = SAVE_CODE_TEXT.copyFailed;
      });
  });

  const codeView = [
    el('h1', { class: 'auth-title', id: options.titleId }, options.title),
    el('p', { class: 'auth-subtitle' }, SAVE_CODE_TEXT.subtitle),
    el('p', { class: 'auth-code', 'data-testid': 'auth-recovery-code' }, options.code),
    el('p', { class: 'auth-hint auth-center' }, SAVE_CODE_TEXT.hint),
    el('div', { class: 'auth-pair' }, picture, ...('clipboard' in navigator ? [copy] : [])),
    status,
    tick,
    done,
  ];

  const showCode = () => {
    dropPicture();
    panel.replaceChildren(...codeView);
  };

  function showPicture(blob: Blob): void {
    dropPicture();
    pictureUrl = URL.createObjectURL(blob);
    const back = el('button', { type: 'button', class: 'auth-button' }, SAVE_CODE_TEXT.done);
    back.addEventListener('click', showCode);
    panel.replaceChildren(
      el('h1', { class: 'auth-title', id: options.titleId }, SAVE_CODE_TEXT.picture),
      el('img', {
        class: 'auth-picture',
        src: pictureUrl,
        alt: `A picture with the name ${options.username} and the recovery code ${options.code}`,
        'data-testid': 'auth-code-image',
      }),
      el('p', { class: 'auth-subtitle' }, SAVE_CODE_TEXT.press),
      back,
    );
  }

  showCode();
  return panel;
}
