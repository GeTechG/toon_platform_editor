/**
 * Whether the browser draws without the video card, and the one time the
 * studio says so.
 *
 * A heavy drawing on a weak processor with acceleration off — or a driver the
 * browser refuses — is every line rasterized by the processor: the studio
 * crawls, and nothing on the page says why (a sent file, 2026-11-14). Turning
 * acceleration on or updating the driver is the author's to do; the studio
 * only tells them, once on a device.
 */

/**
 * Renderers that are the processor under a video card's name: Chrome's
 * SwiftShader, Mesa's llvmpipe/softpipe/lavapipe, Windows' Basic Render Driver
 * (no driver installed — Chrome's software_rendering_list.json entry 74).
 */
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|lavapipe|Basic Render|Software Rasterizer|Software Adapter/i;

/** Whether a reported GL renderer string names a CPU software rasterizer. */
export function isSoftwareRendererName(renderer: string | null): boolean {
  return renderer !== null && SOFTWARE.test(renderer);
}

/**
 * Whether the browser draws on the processor: it has no WebGL at all, refused
 * a context it would have to draw slowly (`failIfMajorPerformanceCaveat` —
 * what pmndrs/detect-gpu and the WebGL list go by, and the one sign where a
 * browser hides the renderer's name), or names a software renderer. Chrome
 * also turns the card off for drivers it lists as bad — AMD's 8.17.10.* among
 * them (entry 166) — and then this is how it shows.
 */
export function drawsInSoftware(renderer: string | null, caveat = false): boolean {
  return renderer === null || caveat || SOFTWARE.test(renderer);
}

/**
 * The WebGL renderer's name (null where there is no WebGL), and whether the
 * browser refused a context with the performance caveat. Contexts are given
 * back at once.
 */
export function webglProbe(): { renderer: string | null; caveat: boolean } {
  const take = (attributes?: WebGLContextAttributes): WebGLRenderingContext | null => {
    try {
      return document.createElement('canvas').getContext('webgl', attributes) as WebGLRenderingContext | null;
    } catch {
      return null;
    }
  };
  const lose = (gl: WebGLRenderingContext | null): void => {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  };
  const gl = take();
  if (!gl) {
    return { renderer: null, caveat: false };
  }
  let renderer: string | null = null;
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    renderer = '';
  }
  lose(gl);
  const strict = take({ failIfMajorPerformanceCaveat: true });
  const caveat = strict === null;
  lose(strict);
  return { renderer, caveat };
}

const HINT_KEY = 'toon-editor:software-render-hint';

/**
 * True the first time on a device, and marks it. Where storage is blocked
 * nothing can be marked, and a hint every visit would be worse than none.
 */
export function softwareHintDue(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    if (storage.getItem(HINT_KEY) !== null) {
      return false;
    }
    storage.setItem(HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
