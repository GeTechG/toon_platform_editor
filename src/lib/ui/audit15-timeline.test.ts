import { describe, expect, it } from 'bun:test';

// Пятнадцатый аудит: таймлайн, слои, звук и плеер. Компоненты на рунах
// проверяются по исходнику, как в audit14-timeline.test.ts.
const UI = new URL('./', import.meta.url).pathname;
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const timelineStyle = timeline.slice(timeline.indexOf('<style'));
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const player = await Bun.file(UI + '../player/Player.svelte').text();

/** Тело функции из исходника компонента, до закрывающей скобки. */
function fn(source: string, name: string): string {
  return source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  }`))?.[0] ?? '';
}

describe('пятнадцатый аудит: плеер не молчит картинкой из-за звука', () => {
  it('картинку останавливает только запрет браузера, а не формат, который он не играет', () => {
    // Safari 16 не играет ogg: play() отказывал NotSupportedError, и мульт
    // на странице не шёл вовсе — кнопка «играть» возвращалась сразу.
    expect(player).toContain('playRefusal');
    expect(player).toMatch(/playRefusal\(err\) === 'blocked'\) \{?\s*playing = false/);
  });

  it('привязанный трек, начатый за своим концом, молчит до круга, а не тянет картинку к кадру 0', () => {
    // currentTime за концом — это «закончился», и play() перематывал трек в
    // начало; тактовая дорожка брала кадр из времени трека — картинка прыгала.
    expect(player).toContain('trackTimeFor(');
    expect(player).toMatch(/if \(at !== null\)/);
  });
});

describe('пятнадцатый аудит: имя слоя и ввод через IME', () => {
  it('Enter и Esc, подтверждающие набор иероглифа, не закрывают поле', () => {
    const body = fn(rows, 'onRenameKeydown');
    expect(body).toMatch(/e\.isComposing/);
    expect(body.indexOf('isComposing')).toBeLessThan(body.indexOf("'Enter'"));
  });
});

describe('пятнадцатый аудит: дорожка звука во всю длину ленты', () => {
  it('подложка волны тянется на все кадры, а не на первый экран', () => {
    // Блок шириной с окно ленты: при прокрутке тихий кусок терял подложку и
    // читался как «волна не загрузилась».
    expect(timeline).toMatch(/class="wave"[^>]*style:min-width=\{`\$\{stripExtent\}px`\}/);
    expect(timelineStyle).toMatch(/\.wave \{[^}]*box-sizing: border-box;/);
  });
});

describe('пятнадцатый аудит: выделение мышью кончается с кнопкой', () => {
  it('без зажатой кнопки наведение не тянет блок', () => {
    // Кнопку отпустили за окном (Alt+Tab посреди протяжки): pointerup не
    // пришёл, и каждое наведение потом растягивало выделение.
    const body = fn(timeline, 'onCellEnter');
    expect(body).toMatch(/e\.buttons & 1/);
  });
});

describe('пятнадцатый аудит: меню кадра на телефоне при 200 % текста', () => {
  it('не шире экрана', () => {
    // 13rem при 200 % — 416 px на экране 320: пункты уходили за правый край.
    // min-width сильнее max-width, так что предел — в нём самом; меню fixed,
    // и 100 % — окно без полосы прокрутки (100vw студия не берёт).
    expect(timelineStyle).toMatch(/\.frame-menu \{[^}]*min-width: min\(13rem, calc\(100% - 8px\)\);/);
    expect(timelineStyle).toMatch(/\.frame-menu \{[^}]*max-width: calc\(100% - 8px\);/);
  });
});
