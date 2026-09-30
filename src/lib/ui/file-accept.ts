type Nav = { userAgent: string; platform: string; maxTouchPoints: number };

/**
 * A file picker's `accept`, or none on iOS. WebKit there (WKFileUploadPanel)
 * maps each extension to a MIME type and drops one it has none for, so
 * `.toonop,.toon,.json` became JSON alone and every mult file was greyed out.
 * The file is checked when it is read either way. iPadOS says «Macintosh»;
 * a Mac has no touch points.
 */
export function pickerAccept(accept: string, nav: Nav | undefined = globalThis.navigator): string | undefined {
  if (!nav) return accept;
  const ios = /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return ios ? undefined : accept;
}
