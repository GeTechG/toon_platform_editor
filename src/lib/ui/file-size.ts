/**
 * How heavy a draft is, in words. One function, used by the autosave
 * indicator and by every card in the list — two spellings of the same
 * number is how they end up disagreeing.
 */
import { t } from '../i18n';

/** Past this a record is worth a warning: the reference's `warning` mark. */
export const DRAFT_WARN_BYTES = 30 * 1024 * 1024;
/** Past this IndexedDB on a phone stops being a safe place for it. */
export const DRAFT_TOO_BIG_BYTES = 70 * 1024 * 1024;

const UNITS = ['size.b', 'size.kb', 'size.mb', 'size.gb'];

export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  // A tenth of a unit is as fine as this number ever needs to be.
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0).replace('.', ',').replace(/,0$/, '')} ${t(UNITS[unit])}`;
}

/** Class for the indicator and the cards: '', 'warning' or 'too_big'. */
export function draftSizeClass(bytes: number | undefined): '' | 'warning' | 'too_big' {
  if (bytes === undefined || bytes < DRAFT_WARN_BYTES) {
    return '';
  }
  return bytes >= DRAFT_TOO_BIG_BYTES ? 'too_big' : 'warning';
}
