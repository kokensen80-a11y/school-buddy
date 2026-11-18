/**
 * Text recognition on a photo, entirely in the browser (Tesseract). The photo never leaves
 * the device; only the recognition engine and the Dutch language data are downloaded once
 * and then cached by the browser.
 */

const MAX_SIDE = 2200;

/** Scales big phone photos down; that makes recognition several times faster. */
async function prepare(file: Blob): Promise<HTMLCanvasElement | Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.filter = 'grayscale(1) contrast(1.25)';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return file;
  }
}

/**
 * Returns the text on the image. `onProgress` gets a fraction from 0 to 1 and a short
 * Dutch description of the current step.
 */
export async function recognizeText(
  file: Blob,
  onProgress?: (fraction: number, step: string) => void,
): Promise<string> {
  onProgress?.(0, 'Foto voorbereiden');
  const [{ createWorker }, image] = await Promise.all([import('tesseract.js'), prepare(file)]);
  const worker = await createWorker(['nld', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(0.3 + m.progress * 0.7, 'Tekst lezen');
      else if (/load|initializ/.test(m.status)) onProgress?.(Math.min(0.3, m.progress * 0.3), 'Herkenning laden');
    },
  });
  try {
    const { data } = await worker.recognize(image);
    onProgress?.(1, 'Klaar');
    return data.text ?? '';
  } finally {
    void worker.terminate();
  }
}
