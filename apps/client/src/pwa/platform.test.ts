import { describe, expect, it } from 'vitest';
import { isIosSafari, isStandalone, shouldShowInstallGuide } from './platform.js';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneHomeScreen:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

describe('isIosSafari', () => {
  it('spots Safari on iPhone', () => {
    expect(isIosSafari(UA.iphoneSafari, 5)).toBe(true);
  });

  it('spots Safari on iPad, which says it is a Mac but has a touch screen', () => {
    expect(isIosSafari(UA.ipadSafari, 5)).toBe(true);
    expect(isIosSafari(UA.ipadSafari, 0)).toBe(false); // a real Mac
  });

  it('skips other browsers and the home-screen app', () => {
    expect(isIosSafari(UA.iphoneChrome, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneHomeScreen, 5)).toBe(false);
    expect(isIosSafari(UA.androidChrome, 5)).toBe(false);
  });
});

describe('shouldShowInstallGuide', () => {
  const tab = { iosStandalone: false, standaloneDisplay: false };

  it('shows once in a Safari tab', () => {
    expect(shouldShowInstallGuide(true, tab, false)).toBe(true);
    expect(shouldShowInstallGuide(true, tab, true)).toBe(false);
  });

  it('never shows in the installed app or other browsers', () => {
    expect(isStandalone({ iosStandalone: true, standaloneDisplay: false })).toBe(true);
    expect(isStandalone({ iosStandalone: undefined, standaloneDisplay: true })).toBe(true);
    expect(shouldShowInstallGuide(true, { ...tab, iosStandalone: true }, false)).toBe(false);
    expect(shouldShowInstallGuide(false, tab, false)).toBe(false);
  });
});
