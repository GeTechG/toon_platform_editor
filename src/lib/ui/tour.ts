/** Страницы тура первого входа, по порядку: привет, рассказ, выбор набора. */
export type TourPage = 'welcome' | 'toon' | 'plugins' | 'export' | 'continue' | 'open' | 'layout';

/** Продолжения — дело площадки: студия без неё о них не рассказывает. */
export function tourPages(platform: boolean): TourPage[] {
  return ['welcome', 'toon', 'plugins', 'export', ...(platform ? (['continue'] as const) : []), 'open', 'layout'];
}
