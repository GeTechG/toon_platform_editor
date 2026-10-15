/** Страницы тура первого входа, по порядку: привет, рассказ, выбор набора. */
export type TourPage = 'welcome' | 'toon' | 'plugins' | 'panels' | 'export' | 'continue' | 'open' | 'layout';

/**
 * Продолжения — дело площадки: студия без неё о них не рассказывает. Панели
 * расставляют только на десктопе (`desk`): на телефоне рассказывать не о чем.
 */
export function tourPages(platform: boolean, desk: boolean): TourPage[] {
  return ['welcome', 'toon', 'plugins', ...(desk ? (['panels'] as const) : []), 'export', ...(platform ? (['continue'] as const) : []), 'open', 'layout'];
}
