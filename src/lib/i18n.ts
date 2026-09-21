/**
 * Every word the editor says out loud, and the one instance that serves them.
 *
 * The editor is the lower package: the site embeds it from source, so both
 * share one module graph and therefore one i18next. The editor owns the
 * instance and the `editor` namespace; whoever embeds it registers its own
 * namespace on the same instance (`translator`), and one language switch then
 * moves the whole screen instead of half of it.
 *
 * Russian is the only language today. What the library buys over a plain table
 * of strings is the door it leaves open: `addResourceBundle` takes a locale
 * that was not in the build, which is how a translation can arrive without one.
 */
import i18next from 'i18next';
import ru from './i18n/ru.json';

export const BASE_LOCALE = 'ru';

i18next.init({
  lng: BASE_LOCALE,
  fallbackLng: BASE_LOCALE,
  resources: { ru: { editor: ru } },
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

/** The editor's own words. */
export const t = translator('editor');

/** The shared instance, for whoever adds a namespace or a locale to it. */
export const i18n = i18next;
