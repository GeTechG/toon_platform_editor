/**
 * The plain template: no framework, no dependencies, no build-time anything.
 * It draws its window with the editor's own classes, so it looks native
 * without a line of CSS of its own.
 *
 * Its words are its own: `locales` is the catalogue the editor hands to its
 * i18next under a namespace of this plugin, `{ t: '…' }` in the manifest is a
 * key into it, and `host.t` reads it at runtime.
 */
export default {
  id: 'example.shift',
  api: 1,
  locales: {
    ru: {
      label: 'Сдвиг',
      title: 'Сдвиг — двигает штрихи кадра',
      step: 'шаг',
      apply: 'Сдвинуть',
    },
    en: {
      label: 'Shift',
      title: 'Shift — moves the strokes of the frame',
      step: 'step',
      apply: 'Shift',
    },
  },
  tool: {
    label: { t: 'label' },
    title: { t: 'title' },
    key: '',
    icon: '<path d="M4 12h16M14 6l6 6-6 6" />',

    activate(host) {
      const el = host.window({ title: host.t('label') });
      el.innerHTML = `
        <label class="toggle">
          <input type="range" min="1" max="50" value="10" />
          <span class="toggle-label">${host.t('step')}</span>
        </label>
        <button class="key" type="button">${host.t('apply')}</button>`;
      const step = el.querySelector('input');
      el.querySelector('button').addEventListener('click', () => {
        const by = Number(step.value);
        host.edit((strokes) => {
          for (const stroke of strokes) {
            stroke.points = stroke.points.map((value, i) => (i % 2 === 0 ? value + by : value));
          }
        });
      });
    },
  },
};
