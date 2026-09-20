/**
 * The plain template: no framework, no dependencies, no build-time anything.
 * It draws its window with the editor's own classes, so it looks native
 * without a line of CSS of its own.
 */
export default {
  id: 'example.shift',
  api: 1,
  tool: {
    label: 'Сдвиг',
    title: 'Сдвиг — двигает штрихи кадра',
    key: '',
    icon: '<path d="M4 12h16M14 6l6 6-6 6" />',

    activate(host) {
      const el = host.window({ title: 'Сдвиг' });
      el.innerHTML = `
        <label class="toggle">
          <input type="range" min="1" max="50" value="10" />
          <span class="toggle-label">шаг</span>
        </label>
        <button class="key" type="button">Сдвинуть</button>`;
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
