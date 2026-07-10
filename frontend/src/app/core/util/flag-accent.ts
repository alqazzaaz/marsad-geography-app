/**
 * Extracts a tasteful accent color from a country's flag: the dominant
 * saturated hue, re-clamped to a muted tone that sits well on the dark
 * observatory palette. Returns null (→ Marsad gold fallback) when the flag
 * can't be sampled (CORS, load failure) or has no saturated color.
 */
export async function extractFlagAccent(url: string): Promise<string | null> {
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 20;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    ctx.drawImage(img, 0, 0, 32, 20);
    const { data } = ctx.getImageData(0, 0, 32, 20);

    // Weight hue buckets by saturation so whites/blacks don't win.
    const buckets = new Array(24).fill(0);
    const bucketS = new Array(24).fill(0);
    const bucketL = new Array(24).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.25 || l < 0.12 || l > 0.9) {
        continue;
      }
      const b = Math.floor((h / 360) * 24) % 24;
      buckets[b] += s;
      bucketS[b] += s;
      bucketL[b] += l;
    }
    const top = buckets.indexOf(Math.max(...buckets));
    if (buckets[top] <= 0) {
      return null;
    }
    const count = buckets[top] / (bucketS[top] / buckets[top]); // ≈ pixel count
    const hue = top * 15 + 7.5;
    const sat = Math.min(55, Math.round((bucketS[top] / count) * 100));
    const light = Math.min(62, Math.max(48, Math.round((bucketL[top] / count) * 100)));
    return `hsl(${Math.round(hue)}, ${sat}%, ${light}%)`;
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60;
  } else {
    h = ((rn - gn) / d + 4) * 60;
  }
  return [h, s, l];
}
