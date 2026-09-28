import { FormatLimitError } from '../model/operations';
import { t } from '../i18n';

/**
 * What the canvas says when the format had no room for an edit: a full frame
 * (its stroke limit) or a full mult (the document's point limit). Anything
 * else is not a limit and gets no hint.
 */
export function formatLimitHint(err: unknown): string | null {
  if (!(err instanceof FormatLimitError)) {
    return null;
  }
  return t(err.limit === 'strokes' ? 'canvas.frame_full' : 'canvas.mult_full');
}
