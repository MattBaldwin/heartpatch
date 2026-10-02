// Which browser we're in, for the Add to Home Screen guide. Pure functions of
// what the browser reports, so they're testable without a DOM.

/**
 * Safari on iPhone or iPad, which has no install prompt: adding to the home
 * screen is a Share-menu item players have to be shown. iPadOS reports a Mac
 * user agent, so a "Mac" with a touch screen is an iPad. Other iOS browsers
 * (Chrome, Firefox, Edge, the Google app) name themselves in the user agent.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const ios =
    /\b(iPhone|iPad|iPod)\b/.test(userAgent) ||
    (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
  return (
    ios && /\bSafari\//.test(userAgent) && !/\b(CriOS|FxiOS|EdgiOS|OPiOS|GSA)\//.test(userAgent)
  );
}

export interface DisplayInfo {
  /** `navigator.standalone`: iOS's own flag for a home-screen launch. */
  iosStandalone: boolean | undefined;
  /** `matchMedia('(display-mode: standalone)').matches` */
  standaloneDisplay: boolean;
}

/** Running as an installed app rather than a browser tab. */
export function isStandalone({ iosStandalone, standaloneDisplay }: DisplayInfo): boolean {
  return iosStandalone === true || standaloneDisplay;
}

/** The guide shows in Safari on iPhone or iPad until dismissed, and never in the installed app. */
export function shouldShowInstallGuide(
  iosSafari: boolean,
  display: DisplayInfo,
  alreadySeen: boolean,
): boolean {
  return iosSafari && !isStandalone(display) && !alreadySeen;
}
