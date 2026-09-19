/**
 * The distort tool (toonio.bundle.js `Distort`): not a session but a
 * destructive brush — horizontal travel sets a strength, and every point of
 * the frame gets a random kick of that size on every accepted move. The
 * document is written as the gesture runs; the caller snapshots first, so the
 * whole shake is one undo step.
 */

/** Strength from the drag: whole hundreds of horizontal travel, in reference px. */
export function distortRate(x: number, startX: number): number {
  // `|| 0` only turns -0 into 0: a leftward drag of 99 px is no strength, not a signed one.
  return Math.trunc((x - startX) / 100) || 0;
}

/** Every coordinate kicked by `~~((random − 0.5) · rate)`; a copy, never in place. */
export function jitter(
  points: readonly number[],
  rate: number,
  random: () => number = Math.random,
): number[] {
  const out = points.slice();
  if (rate === 0) {
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    out[i] += Math.trunc((random() - 0.5) * rate);
  }
  return out;
}
