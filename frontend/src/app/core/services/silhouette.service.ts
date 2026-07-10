import { Injectable } from '@angular/core';

interface GeoFeature {
  id: string;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface Silhouette {
  path: string;
  viewBox: string;
}

const VIEW_WIDTH = 200;
const MAX_RINGS = 12;

/**
 * Builds SVG silhouettes of countries from a static world GeoJSON
 * (Natural Earth 110m, served from /world.geo.json, keyed by alpha-3).
 */
@Injectable({ providedIn: 'root' })
export class SilhouetteService {
  private geoPromise: Promise<Map<string, GeoFeature>> | null = null;
  private readonly cache = new Map<string, Silhouette | null>();

  async getSilhouette(alpha3: string): Promise<Silhouette | null> {
    const code = alpha3.toUpperCase();
    if (this.cache.has(code)) {
      return this.cache.get(code) ?? null;
    }

    this.geoPromise ??= this.load();
    let features: Map<string, GeoFeature>;
    try {
      features = await this.geoPromise;
    } catch {
      this.geoPromise = null;
      return null;
    }

    const feature = features.get(code);
    const silhouette = feature ? this.build(feature) : null;
    this.cache.set(code, silhouette);
    return silhouette;
  }

  private async load(): Promise<Map<string, GeoFeature>> {
    const response = await fetch('/world.geo.json');
    if (!response.ok) {
      throw new Error(`world.geo.json: ${response.status}`);
    }
    const data = (await response.json()) as { features: GeoFeature[] };
    return new Map(data.features.map((f) => [f.id, f]));
  }

  private build(feature: GeoFeature): Silhouette | null {
    const rings =
      feature.geometry.type === 'Polygon'
        ? [(feature.geometry.coordinates as number[][][])[0]]
        : (feature.geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);

    // Project (Web Mercator) and keep only the significant rings so island
    // scatter doesn't turn the silhouette into noise.
    const projected = rings
      .map((ring) => ring.map(([lng, lat]) => this.project(lng, lat)))
      .map((ring) => ({ ring, area: Math.abs(this.area(ring)) }))
      .sort((a, b) => b.area - a.area);

    if (projected.length === 0 || projected[0].area === 0) {
      return null;
    }
    const kept = projected
      .filter((p, i) => i === 0 || (i < MAX_RINGS && p.area > projected[0].area * 0.02))
      .map((p) => p.ring);

    // Normalize to a fixed-width viewBox.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of kept) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    const scale = VIEW_WIDTH / (maxX - minX || 1);
    const height = Math.max(1, Math.round((maxY - minY) * scale));

    const path = kept
      .map(
        (ring) =>
          'M' +
          ring
            .map(
              ([x, y]) =>
                `${((x - minX) * scale).toFixed(1)},${((y - minY) * scale).toFixed(1)}`,
            )
            .join('L') +
          'Z',
      )
      .join('');

    return { path, viewBox: `0 0 ${VIEW_WIDTH} ${height}` };
  }

  /** Web Mercator; y grows downward so SVG renders north-up. */
  private project(lng: number, lat: number): [number, number] {
    const clamped = Math.max(-85, Math.min(85, lat));
    const y = -Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
    return [lng, (y * 180) / Math.PI];
  }

  private area(ring: [number, number][]): number {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
  }
}
