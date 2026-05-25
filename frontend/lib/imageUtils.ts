const MAX_DIM = 1280;

export async function maybeConvertHeic(file: File): Promise<File> {
  const isHeic =
    /\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
  if (!isHeic) return file;
  try {
    const mod = await import('heic2any');
    const heic2any = (
      mod as unknown as {
        default: (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;
      }
    ).default;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' });
  } catch (e) {
    throw new Error(`HEIC 변환 실패: ${e instanceof Error ? e.message : ''}`);
  }
}

export function drawToCanvas(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 미지원');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function fileToResizedDataUrlFallback(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.onload = () => {
        try { resolve(drawToCanvas(img, img.naturalWidth, img.naturalHeight)); }
        catch (err) { reject(err); }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export async function fileToResizedDataUrl(file: File): Promise<string> {
  const working = await maybeConvertHeic(file);
  try {
    const bitmap = await createImageBitmap(working);
    return drawToCanvas(bitmap, bitmap.width, bitmap.height);
  } catch {
    return fileToResizedDataUrlFallback(working);
  }
}
