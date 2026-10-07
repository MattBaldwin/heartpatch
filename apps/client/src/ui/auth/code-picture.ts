// "Save a picture" (#197): a card with the player's name and recovery code,
// drawn on a canvas in the browser. It never leaves the device: the player
// saves it to Photos through the share sheet, or by pressing and holding it.

export const CODE_PICTURE_WIDTH = 900;
export const CODE_PICTURE_HEIGHT = 1200;

/** The canvas calls the picture uses (tests pass a recording fake). */
export type PictureContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'fillRect'
  | 'fillText'
  | 'beginPath'
  | 'moveTo'
  | 'arcTo'
  | 'arc'
  | 'bezierCurveTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'setLineDash'
  | 'save'
  | 'restore'
  | 'translate'
  | 'scale'
>;

// The auth card's colours (auth.css), so the picture looks like the game.
const INK = '#4a3150';
const INK_SOFT = '#6b4b6e';
const INK_HINT = '#7d6380';
const BERRY = '#b8487a';
const ROUND = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/** The words on the picture, top to bottom (style guide: short, warm). */
export const CODE_PICTURE_TEXT = {
  title: 'Heartpatch',
  subtitle: 'My way back in',
  name: 'Name',
  code: 'Recovery code',
  keep: 'Keep it secret. Keep it safe!',
  site: 'play.pumpkinpatchgames.com',
} as const;

/** The file name the share sheet shows. */
export function codePictureFileName(username: string): string {
  return `heartpatch-${username.toLowerCase()}.png`;
}

/** Draws the picture at CODE_PICTURE_WIDTH × CODE_PICTURE_HEIGHT. */
export function drawCodePicture(g: PictureContext, username: string, code: string): void {
  const W = CODE_PICTURE_WIDTH;
  const H = CODE_PICTURE_HEIGHT;
  const font = (weight: number, size: number) => `${String(weight)} ${String(size)}px ${ROUND}`;
  const rounded = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  g.fillStyle = '#fde8f0';
  g.fillRect(0, 0, W, H);
  for (const [x, y, r, colour] of [
    [120, 140, 60, '#ffd9e8'],
    [780, 210, 80, '#ffe7c2'],
    [140, 1060, 90, '#e2f2dc'],
    [800, 1040, 50, '#ffd9e8'],
  ] as const) {
    g.fillStyle = colour;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = '#fffafc';
  rounded(70, 230, W - 140, 760, 56);
  g.fill();

  // A heart on top.
  g.fillStyle = BERRY;
  g.save();
  g.translate(W / 2, 150);
  g.scale(3.2, 3.2);
  g.beginPath();
  g.moveTo(0, 18);
  g.bezierCurveTo(-22, 4, -20, -14, -9, -14);
  g.bezierCurveTo(-3, -14, 0, -9, 0, -6);
  g.bezierCurveTo(0, -9, 3, -14, 9, -14);
  g.bezierCurveTo(20, -14, 22, 4, 0, 18);
  g.fill();
  g.restore();

  g.textAlign = 'center';
  const text = (words: string, y: number, weight: number, size: number, colour: string) => {
    g.font = font(weight, size);
    g.fillStyle = colour;
    g.fillText(words, W / 2, y);
  };
  text(CODE_PICTURE_TEXT.title, 330, 900, 64, INK);
  text(CODE_PICTURE_TEXT.subtitle, 385, 700, 36, INK_SOFT);
  text(CODE_PICTURE_TEXT.name, 480, 700, 34, INK_HINT);
  text(username, 560, 900, 72, INK);
  text(CODE_PICTURE_TEXT.code, 660, 700, 34, INK_HINT);

  g.setLineDash([18, 12]);
  g.lineWidth = 6;
  g.strokeStyle = '#e3a6c6';
  g.fillStyle = '#ffffff';
  rounded(130, 690, W - 260, 130, 30);
  g.fill();
  g.stroke();
  g.setLineDash([]);
  g.font = `700 66px ${MONO}`;
  g.fillStyle = INK;
  g.fillText(code, W / 2, 778);

  text(CODE_PICTURE_TEXT.keep, 910, 700, 32, INK_SOFT);
  text(CODE_PICTURE_TEXT.site, 1110, 600, 28, INK_HINT);
}

/** The picture as a PNG, made in this browser; null if the canvas can't draw. */
export function codePictureBlob(username: string, code: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = CODE_PICTURE_WIDTH;
  canvas.height = CODE_PICTURE_HEIGHT;
  const g = canvas.getContext('2d');
  if (!g) return Promise.resolve(null);
  drawCodePicture(g, username, code);
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

/**
 * Opens the share sheet with the picture where it takes files (iOS 15+:
 * "Save Image" is one tap). Resolves 'shared' (or cancelled there), or
 * 'show' when the caller should show the picture to press and hold instead.
 */
export async function sharePicture(blob: Blob, username: string): Promise<'shared' | 'show'> {
  const file = new File([blob], codePictureFileName(username), { type: 'image/png' });
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) {
    return 'show';
  }
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (err) {
    // Closing the sheet is fine; anything else falls back to the picture.
    return err instanceof DOMException && err.name === 'AbortError' ? 'shared' : 'show';
  }
}
