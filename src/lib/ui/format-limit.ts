import { FormatLimitError } from '../model/operations';
import { formatPercent, t } from '../i18n';

/**
 * What the canvas says when the format had no room for an edit: a full frame
 * (its stroke limit). Anything else is not a limit and gets no hint.
 */
export function formatLimitHint(err: unknown): string | null {
  if (!(err instanceof FormatLimitError)) {
    return null;
  }
  return t('canvas.frame_full');
}

/**
 * The publish budget as the layer column shows it: `share` of
 * `MAX_DOCUMENT_WEIGHT` as a whole percent: rounded down up to the limit
 * and never under 101 % past it, so 100 % is said only of a mult that still
 * goes out. From 80 % the figure turns to the accent; past the limit it
 * keeps counting, and the title says the mult cannot be published.
 */
export function budgetLabel(share: number): { text: string; title: string; tight: boolean; over: boolean } {
  const over = share > 1;
  const text = formatPercent((over ? Math.max(101, Math.round(share * 100)) : Math.floor(share * 100)) / 100);
  const tight = share >= 0.8;
  const key = over ? 'canvas.budget_over' : tight ? 'canvas.budget_tight' : 'canvas.budget';
  return { text, title: t(key, { percent: text }), tight, over };
}
