/**
 * Every word the editor says out loud.
 *
 * The instance lives next door in `./i18n-core.ts`, and it lives there so that
 * whoever wants the instance does not get this catalogue with it: a static
 * import travels with whatever touches the module, and the site's own i18n —
 * which the root layout pulls in — used to touch this one. The editor's 32 KB
 * of labels rode to the feed on eight lines of shared plumbing.
 *
 * Nothing about the call sites changes: `{ t }` still comes from `../i18n`, and
 * so do `i18n` and `translator` for anyone who was reading them here.
 */
import ru from './i18n/ru.json';
import { BASE_LOCALE, i18n, translator } from './i18n-core';

i18n.addResourceBundle(BASE_LOCALE, 'editor', ru);

/** The editor's own words. */
export const t = translator('editor');

export { BASE_LOCALE, i18n, translator } from './i18n-core';
