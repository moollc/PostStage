/**
 * One-pass still compress for attach. Downscale + JPEG/WebP under the
 * persist budget. No quality slider. Video is not handled here.
 */

export const IMAGE_PERSIST_BUDGET = 900000;

function fileBasename(name) {
  return String(name || '').replace(/\\/g, '/').split('/').pop();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || null), type, quality);
  });
}

/**
 * Decode a fat still and encode one smaller JPEG or WebP under `budget`.
 * Returns `{ name, type, url }` with a `data:image/…` url, or null.
 * Never returns blob:, data:video, or a home path.
 */
export async function compressStill(file, budget = IMAGE_PERSIST_BUDGET) {
  if (!file || !String(file.type || '').startsWith('image/')) return null;
  if (typeof createImageBitmap !== 'function') return null;
  const cap = Number(budget);
  if (!Number.isFinite(cap) || cap <= 0) return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const w = bitmap.width;
  const h = bitmap.height;
  if (!w || !h) {
    if (bitmap.close) bitmap.close();
    return null;
  }

  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    if (bitmap.close) bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, cw, ch);
  if (bitmap.close) bitmap.close();

  let encoded = await canvasToBlob(canvas, 'image/jpeg', 0.72);
  let type = 'image/jpeg';
  if (!encoded || encoded.size > cap) {
    encoded = await canvasToBlob(canvas, 'image/webp', 0.72);
    type = 'image/webp';
  }
  if (!encoded || encoded.size > cap) return null;

  let url;
  try {
    url = await blobToDataUrl(encoded);
  } catch {
    return null;
  }
  if (!/^data:image\/(jpeg|webp|jpg)/i.test(url)) return null;
  if (/^data:video/i.test(url) || /^blob:/i.test(url)) return null;
  if (/Users|GoogleDrive|(^|\/)home(\/|$)/i.test(url)) return null;

  const base = fileBasename(file.name).replace(/\.[a-z0-9]+$/i, '') || 'still';
  const ext = type === 'image/webp' ? '.webp' : '.jpg';
  return { name: base + ext, type, url };
}
