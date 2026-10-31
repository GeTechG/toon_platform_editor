/** Страницы тура первого входа, по порядку: привет, рассказ и — когда есть из чего — выбор набора. */
export type TourPage = 'welcome' | 'toon' | 'plugins' | 'panels' | 'export' | 'continue' | 'open' | 'layout';

/**
 * Рассказ открывается открытостью, совместимость с Тунио — после (владелец, 2026-10-18).
 * Продолжения — дело площадки: студия без неё о них не рассказывает. Панели
 * расставляют только на десктопе (`desk`): на телефоне рассказывать не о чем.
 * Выбирать набор есть из чего, только когда второй принёс плагин.
 */
export function tourPages(platform: boolean, desk: boolean, presetCount: number): TourPage[] {
  return ['welcome', 'open', 'toon', 'plugins', ...(desk ? (['panels'] as const) : []), 'export', ...(platform ? (['continue'] as const) : []), ...(presetCount > 1 ? (['layout'] as const) : [])];
}
