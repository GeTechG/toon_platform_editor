# Деформация вектора

Из каталога `editor` запусти `bun run dev` и открой `/examples/mesh-deformation/`.
Оба режима получают контуры одних и тех же штрихов. Контуры разрезаются на
границах треугольников общей сетки. Canvas 2D пересчитывает координаты на CPU,
а WebGL2 деформирует те же вершины в шейдере и заполняет контуры через stencil.

Для локального сравнения на первом кадре [«Eyes» автора Gulya](https://toonop.ru/a/6vdmqf6t6ucq)
сохрани его рядом с примером. Файл с кадром исключён из Git.

```sh
curl -fsS --compressed https://toonop.ru/api/a/6vdmqf6t6ucq/body | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); [layer.update(frames=layer["frames"][:1]) for layer in d["layers"]]; json.dump(d,sys.stdout)' \
  > examples/mesh-deformation/sample.local.json
```

Без файла открывается синтетический кадр. Можно загрузить свой `.toonop`
с одним видимым слоем, карандашом и ластиком.

«Сравнить» прогревает каждый режим и запускает его на 2,2 секунды при размере
960 × 540. Длинным считается интервал между callback'ами `requestAnimationFrame`
свыше 1,5 медианного интервала вкладки в покое. p95 измеряет время вызова из
JavaScript, включая работу Canvas 2D или отправку команд WebGL2. Загрузка
векторных данных в WebGL2 и подготовка сетки происходят до этого замера.
Результат доступен в `window.meshBenchmark`.
