import { webpStill } from '../export/webp';

interface Request {
  id: number;
  pixels: ImageData;
}

self.onmessage = async ({ data: { id, pixels } }: MessageEvent<Request>) => {
  try {
    const bytes = new Uint8Array(await webpStill(null, () => pixels, 1));
    self.postMessage({ id, bytes }, { transfer: [bytes.buffer] });
  } catch {
    self.postMessage({ id });
  }
};
