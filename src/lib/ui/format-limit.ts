import { FormatLimitError } from '../model/operations';
import { formatPercent, t } from '../i18n';

/**
 * What the canvas says when the format had no room for an edit: a full frame
 * (its stroke limit) or a full mult (the document's budget). Anything
 * else is not a limit and gets no hint.
 */
export function formatLimitHint(err: unknown): string | null {
  if (!(err instanceof FormatLimitError)) {
    return null;
  }
  return t(err.limit === 'strokes' ? 'canvas.frame_full' : 'canvas.mult_full');
}

/**
 * The budget as the layer column shows it: `share` of `MAX_DOCUMENT_WEIGHT`
 * as a whole percent, rounded down — 100 % is said only of a mult nothing
 * more fits into. From 80 % the figure turns to the signal colour.
 */
export function budgetLabel(share: number): { text: string; title: string; tight: boolean } {
  const text = formatPercent(Math.floor(share * 100) / 100);
  const tight = share >= 0.8;
  return { text, title: t(tight ? 'canvas.budget_tight' : 'canvas.budget', { percent: text }), tight };
}
