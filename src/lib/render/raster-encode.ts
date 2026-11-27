import { webpStill } from '../export/webp';

type Request = { resolve: (bytes: Uint8Array<ArrayBuffer>) => void; reject: (error: Error) => void };
type Reply = { id: number; bytes?: Uint8Array<ArrayBuffer> };

const requests = new Map<number, Request>();
let worker: Worker | null | undefined;
let sequence = 0;

function encoder(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const created = new Worker(new URL('./raster-encode-worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = ({ data }: MessageEvent<Reply>) => {
      const request = requests.get(data.id);
      requests.delete(data.id);
      if (data.bytes) request?.resolve(data.bytes);
      else request?.reject(new Error('Lossless WebP encoding failed'));
    };
    created.onerror = () => {
      created.terminate();
      worker = null;
      for (const request of requests.values()) request.reject(new Error('Raster encoder is unavailable'));
      requests.clear();
    };
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

export async function encodeRasterPixels(pixels: ImageData): Promise<Uint8Array<ArrayBuffer>> {
  const encode = encoder();
  if (encode) {
    const id = ++sequence;
    try {
      return await new Promise((resolve, reject) => {
        requests.set(id, { resolve, reject });
        encode.postMessage({ id, pixels });
      });
    } catch {
      requests.delete(id);
      // Keep a fallback when the browser cannot create or load the worker.
    }
  }
  return new Uint8Array(await webpStill(null, () => pixels, 1));
}
