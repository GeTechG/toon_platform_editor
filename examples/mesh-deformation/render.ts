import { compileProgram, parseHexRgb } from '../../src/lib/render/webgl/shaders';
import { MAX_BEND, MAX_SHEAR, warpContour, type Grid, type MeshContour } from './mesh';
import { HEIGHT, WIDTH, type Paint } from './scene';

export type BoundPaint = Omit<Paint, 'contours'> & { contours: MeshContour[] };

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  paints: readonly BoundPaint[],
  moved: Float32Array,
): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  for (const paint of paints) {
    ctx.beginPath();
    for (const contour of paint.contours) {
      const points = warpContour(contour, moved);
      ctx.moveTo(points[0] * WIDTH, points[1] * HEIGHT);
      for (let i = 2; i < points.length; i += 2) {
        ctx.lineTo(points[i] * WIDTH, points[i + 1] * HEIGHT);
      }
      ctx.closePath();
    }
    ctx.globalCompositeOperation = paint.erase ? 'destination-out' : 'source-over';
    ctx.globalAlpha = paint.opacity;
    ctx.fillStyle = paint.color;
    ctx.fill('nonzero');
  }
}

const vertex = `#version 300 es
in vec2 aPoint;
uniform vec2 uGrid;
uniform vec2 uMotion;
uniform bool uCover;

// Same formula as moveGrid(). Evaluate it at the three corners, so every
// point inside a triangle follows an affine map between the moving corners.
vec2 move(vec2 point) {
  vec2 delta = 2.0 * point - 1.0;
  return point + uMotion * vec2(
    (1.0 - delta.x * delta.x) * delta.y,
    (1.0 - delta.y * delta.y) * delta.x * (1.0 - 0.6 * delta.x * delta.x)
  );
}

void main() {
  vec2 point = aPoint;
  if (!uCover) {
    vec2 uv = aPoint * uGrid;
    vec2 cell = clamp(floor(uv), vec2(0.0), uGrid - 1.0);
    vec2 local = uv - cell;
    vec2 a = move(cell / uGrid);
    vec2 c = move((cell + 1.0) / uGrid);
    if (local.x >= local.y) {
      vec2 b = move((cell + vec2(1.0, 0.0)) / uGrid);
      point = (1.0 - local.x) * a + (local.x - local.y) * b + local.y * c;
    } else {
      vec2 b = move((cell + vec2(0.0, 1.0)) / uGrid);
      point = (1.0 - local.y) * a + local.x * c + (local.y - local.x) * b;
    }
  }
  gl_Position = vec4(point.x * 2.0 - 1.0, 1.0 - point.y * 2.0, 0.0, 1.0);
}`;

const fragment = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 color;
void main() {
  color = vec4(uColor.rgb * uColor.a, uColor.a);
}`;

interface DrawStroke {
  ranges: { start: number; count: number }[];
  color: [number, number, number];
  alpha: number;
  erase: boolean;
  scissor: [number, number, number, number];
}

export function createWebGL(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2', { stencil: true, depth: false, premultipliedAlpha: true });
  if (!context || context.getParameter(context.STENCIL_BITS) === 0) throw new Error('WebGL2 со stencil-буфером недоступен.');
  const gl: WebGL2RenderingContext = context;
  const program = compileProgram(gl, vertex, fragment);
  const buffer = gl.createBuffer();
  if (!program || !buffer) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    throw new Error('Не удалось запустить WebGL2.');
  }

  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  const aPoint = gl.getAttribLocation(program, 'aPoint');
  const uGrid = gl.getUniformLocation(program, 'uGrid');
  const uMotion = gl.getUniformLocation(program, 'uMotion');
  const uCover = gl.getUniformLocation(program, 'uCover');
  const uColor = gl.getUniformLocation(program, 'uColor');
  let strokes: DrawStroke[] = [];
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(aPoint);
  gl.vertexAttribPointer(aPoint, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, WIDTH, HEIGHT);
  gl.enable(gl.STENCIL_TEST);
  gl.enable(gl.BLEND);

  function upload(grid: Grid, paints: readonly BoundPaint[]): void {
    const quad = [0, 0, 1, 0, 0, 1, 1, 1];
    const size = paints.reduce((total, paint) =>
      total + paint.contours.reduce((sum, contour) => sum + contour.rest.length, 0), quad.length);
    const data = new Float32Array(size);
    data.set(quad);
    let cursor = quad.length;
    const next = paints.map((paint): DrawStroke => {
      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      const ranges = paint.contours.map(({ rest }) => {
        const start = cursor / 2;
        data.set(rest, cursor);
        cursor += rest.length;
        for (let i = 0; i < rest.length; i += 2) {
          minX = Math.min(minX, rest[i]);
          minY = Math.min(minY, rest[i + 1]);
          maxX = Math.max(maxX, rest[i]);
          maxY = Math.max(maxY, rest[i + 1]);
        }
        return { start, count: rest.length / 2 };
      });
      const x = Math.max(0, Math.floor((minX - MAX_SHEAR) * WIDTH) - 1);
      const y = Math.max(0, Math.floor((1 - maxY - MAX_BEND) * HEIGHT) - 1);
      const right = Math.min(WIDTH, Math.ceil((maxX + MAX_SHEAR) * WIDTH) + 1);
      const top = Math.min(HEIGHT, Math.ceil((1 - minY + MAX_BEND) * HEIGHT) + 1);
      return { ranges, color: parseHexRgb(paint.color), alpha: paint.opacity, erase: paint.erase, scissor: [x, y, right - x, top - y] };
    });
    gl.uniform2f(uGrid, grid.columns, grid.rows);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Не удалось загрузить контуры в WebGL2.');
    strokes = next;
  }

  function draw(shear: number, bend: number): void {
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.uniform2f(uMotion, shear, bend);
    let erase = false;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const stroke of strokes) {
      gl.scissor(...stroke.scissor);
      gl.uniform1i(uCover, 0);
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
      for (const { start, count } of stroke.ranges) gl.drawArrays(gl.TRIANGLE_FAN, start, count);

      // Fill once for the entire stroke, including multiple outline rings.
      // The cover also clears the just-used stencil values inside the scissor.
      gl.uniform1i(uCover, 1);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      if (erase !== stroke.erase) {
        erase = stroke.erase;
        gl.blendFunc(erase ? gl.ZERO : gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.uniform4f(uColor, ...stroke.color, stroke.alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  return { renderer, upload, draw };
}
