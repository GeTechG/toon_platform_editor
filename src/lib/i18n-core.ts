/**
 * The one i18next instance, and nothing else.
 *
 * The editor is the lower package: the site embeds it from source, so both
 * share one module graph and therefore one i18next. The editor owns the
 * instance and the `editor` namespace; whoever embeds it registers its own
 * namespace on the same instance (`translator`), and one language switch then
 * moves the whole screen instead of half of it.
 *
 * This file exists because that sharing used to cost the site the editor's
 * whole vocabulary. `./i18n.ts` owns the instance *and* imports the editor's
 * `ru.json` at the top, and a static import travels with whatever touches the
 * module: the site reached in here for `i18n` and `translator`, the root layout
 * imports the site's i18n, and 32 KB of brush and export and plugin labels
 * rode along to the feed. The catalogue now registers next door, where only the
 * editor's own surfaces pull it in.
 *
 * Russian is the only language today. What the library buys over a plain table
 * of strings is the door it leaves open: `addResourceBundle` takes a locale
 * that was not in the build, which is how a translation can arrive without one.
 */
import i18next from 'i18next';

export const BASE_LOCALE = 'ru';

i18next.init({
  lng: BASE_LOCALE,
  fallbackLng: BASE_LOCALE,
  // Empty on purpose: every namespace registers itself, the editor's included.
  resources: {},
  // Svelte escapes every value it puts in the DOM. A second escaping here is
  // what turns «кисть» into «&#39;кисть&#39;» on screen.
  interpolation: { escapeValue: false },
});

/**
 * The reader for one namespace. Resolution happens per call, so a language
 * changed at runtime is picked up by the next render.
 *
 * ponytail: a language switched while the editor is open does not re-render by
 * itself — nothing subscribes to `languageChanged` yet, because nothing can
 * switch it. A rune that bumps on that event is the upgrade, and it belongs in
 * a `.svelte.ts` module: this one is imported by plain unit tests.
 */
export function translator(namespace: string) {
  return (key: string, params?: Record<string, unknown>): string =>
    i18next.t(key, { ns: namespace, ...params });
}

/** The shared instance, for whoever adds a namespace or a locale to it. */
export const i18n = i18next;
