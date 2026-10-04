import { describe, expect, it } from 'bun:test';

const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();

describe('второе нажатие на тип кисти закрывает список', () => {
  // A press on the button takes the focus out of the list: the list closed on
  // that, and the click that followed opened it again.
  it('фокус, ушедший на саму кнопку, список не закрывает', () => {
    const out = panel.slice(panel.indexOf('onfocusout='), panel.indexOf('onclick=', panel.indexOf('onfocusout=')));
    expect(out).toMatch(/!list\?\.contains\(to\) && !trigger\?\.contains\(to\)/);
  });

  // Before it is shown the list has no size: placed by a height of zero it
  // stood under the button for a frame and then jumped above it.
  it('место считается по нарисованному списку, до первого кадра', () => {
    const before = panel.slice(panel.indexOf('onbeforetoggle='), panel.indexOf('ontoggle='));
    expect(before).toMatch(/requestAnimationFrame\(place\)/);
    expect(before).not.toMatch(/\) place\(\);/);
  });

  // In a low window the list fitted neither side and lay over its button: the
  // second press picked a type instead of closing.
  it('список не ложится на свою кнопку: берёт сторону просторнее и её высоту', () => {
    const place = panel.slice(panel.indexOf('function place()'), panel.indexOf('const popoverWorks'));
    expect(place).toMatch(/list\.scrollHeight/);
    expect(place).toMatch(/room: /);
    expect(panel).toMatch(/style:max-height=/);
  });
});
