import { afterEach, describe, expect, it } from 'bun:test';
import { dateLocale, i18n, setLanguageSource, translator } from './i18n-core';

// A server answers many visitors at once on one i18next instance, so the
// language cannot be the instance's own setting: a Russian answer still
// rendering would switch to English under another visitor's request. Whoever
// knows the request's language says so through a source, read on every call.
i18n.addResourceBundle('ru', 'probe', { hello: 'Привет' });
i18n.addResourceBundle('en', 'probe', { hello: 'Hello' });
const t = translator('probe');

afterEach(() => setLanguageSource(() => undefined));

describe('the language a phrase is read in', () => {
  it('is the source’s when one is set', () => {
    setLanguageSource(() => 'en');
    expect(t('hello')).toBe('Hello');
    expect(dateLocale()).toBe('en');
    setLanguageSource(() => 'ru');
    expect(t('hello')).toBe('Привет');
  });

  it('is the instance’s when the source has nothing to say', () => {
    expect(t('hello')).toBe('Привет');
    expect(dateLocale()).toBe('ru');
  });

  it('falls back to Russian for a phrase English lacks', () => {
    i18n.addResourceBundle('ru', 'probe', { only_ru: 'Только тут' }, true);
    setLanguageSource(() => 'en');
    expect(t('only_ru')).toBe('Только тут');
  });
});
