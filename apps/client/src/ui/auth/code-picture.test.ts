import { describe, expect, it } from 'vitest';
import {
  CODE_PICTURE_TEXT,
  codePictureFileName,
  drawCodePicture,
  type PictureContext,
} from './code-picture.js';

/** A canvas stand-in that records the words drawn and does nothing else. */
function recorder(): PictureContext & { words: string[] } {
  const words: string[] = [];
  const noop = () => undefined;
  return {
    words,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    fillText: (text: string) => {
      words.push(text);
    },
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    arcTo: noop,
    arc: noop,
    bezierCurveTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
  };
}

describe('the recovery code picture (#197)', () => {
  it('shows the name and the code, and nothing else about the account', () => {
    const g = recorder();
    drawCodePicture(g, 'Pip_42', 'ABCD-EFGH-JKMN');
    expect(g.words).toEqual([
      CODE_PICTURE_TEXT.title,
      CODE_PICTURE_TEXT.subtitle,
      CODE_PICTURE_TEXT.name,
      'Pip_42',
      CODE_PICTURE_TEXT.code,
      'ABCD-EFGH-JKMN',
      CODE_PICTURE_TEXT.keep,
      CODE_PICTURE_TEXT.site,
    ]);
  });

  it('names the file after the player', () => {
    expect(codePictureFileName('Pip_42')).toBe('heartpatch-pip_42.png');
  });
});
