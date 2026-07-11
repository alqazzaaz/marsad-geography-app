import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import mapboxgl from 'mapbox-gl/dist/mapbox-gl-csp.js';

import { STRINGS } from '../../core/i18n/strings';
import { CountryDetail } from '../../core/models/country.model';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { CountryService } from '../../core/services/country.service';
import { AuthPanel } from '../auth/auth-panel';
import { CountryPanel } from '../country/country-panel';
import { FeedCard } from '../feed/feed-card';

const COUNTRY_SOURCE = 'country-boundaries';
const COUNTRY_SOURCE_LAYER = 'country_boundaries';
const FILL_LAYER = 'marsad-country-fills';
const LINE_LAYER = 'marsad-country-lines';
const PROMOTED_LABEL_SOURCE = 'marsad-promoted-labels';
const PROMOTED_LABEL_LAYER = 'marsad-promoted-label-layer';
const SELECTED_FILL_LAYER = 'marsad-selected-fill';
const SELECTED_LINE_LAYER = 'marsad-selected-line';
const NO_SELECTION_FILTER: mapboxgl.FilterSpecification = ['==', ['get', 'iso_3166_1'], '__none__'];

/**
 * Which polygons are interactive, honoring the configurable worldview:
 * undisputed polygons in the "all"/US worldview, PLUS disputed polygons of
 * promoted countries, MINUS excluded countries entirely.
 */
function countryFilter(excluded: string[], promoted: string[]): mapboxgl.FilterSpecification {
  return [
    'all',
    [
      'any',
      ['==', ['get', 'disputed'], 'false'],
      ['in', ['get', 'iso_3166_1'], ['literal', promoted]],
    ],
    ['any', ['==', ['get', 'worldview'], 'all'], ['in', 'US', ['get', 'worldview']]],
    ['!', ['in', ['get', 'iso_3166_1'], ['literal', excluded]]],
    ['!', ['in', ['get', 'iso_3166_1_alpha_3'], ['literal', excluded]]],
  ] as mapboxgl.FilterSpecification;
}

@Component({
  selector: 'app-map-page',
  imports: [AuthPanel, CountryPanel, FeedCard, RouterLink],
  templateUrl: './map-page.html',
  styleUrl: './map-page.scss',
})
export class MapPage implements AfterViewInit, OnDestroy {
  private readonly configService = inject(ConfigService);
  private readonly countryService = inject(CountryService);
  readonly auth = inject(AuthService);

  private readonly mapContainer = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  private map: mapboxgl.Map | null = null;
  private hoveredCountryId: string | number | null = null;
  private styleLoaded = false;
  private pulseFrame: number | null = null;
  private selected: { a2: string; a3: string } | null = null;
  excluded: string[] = [];
  private promoted: string[] = [];

  readonly t = STRINGS;

  readonly tokenMissing = signal(false);
  readonly mapError = signal(false);
  // True from first paint until the map style has loaded — covers the
  // backend cold start (scale-to-zero can take ~10-20s on the first visit).
  readonly mapLoading = signal(true);
  readonly welcomeVisible = signal(true);
  readonly panelOpen = signal(false);
  readonly authOpen = signal(false);
  readonly country = signal<CountryDetail | null>(null);
  readonly countryLoading = signal(false);
  readonly countryError = signal(false);

  async ngAfterViewInit(): Promise<void> {
    try {
      const config = await this.configService.load();
      if (!config.mapbox_token) {
        this.tokenMissing.set(true);
        this.mapLoading.set(false);
        return;
      }
      this.excluded = config.map_excluded ?? [];
      this.promoted = config.map_promoted ?? [];
      this.initMap(config.mapbox_token);
    } catch {
      this.mapError.set(true);
      this.mapLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.stopPulse();
    this.map?.remove();
  }

  dismissWelcome(): void {
    this.welcomeVisible.set(false);
  }

  closePanel(): void {
    this.panelOpen.set(false);
    this.country.set(null);
    this.clearSelection();
    if (this.map) {
      this.map.easeTo({ padding: { right: 0 }, duration: 600 });
    }
  }

  selectCountry(code: string): void {
    if (this.excluded.includes(code.toUpperCase())) {
      return;
    }
    this.dismissWelcome();
    this.panelOpen.set(true);
    this.countryLoading.set(true);
    this.countryError.set(false);

    this.countryService.getCountry(code).subscribe({
      next: (detail) => {
        this.country.set(detail);
        this.countryLoading.set(false);
        this.highlightSelection(detail.alpha2_code, detail.alpha3_code);
        this.flyToCountry(detail);
      },
      error: () => {
        this.countryLoading.set(false);
        this.countryError.set(true);
      },
    });
  }

  private flyToCountry(detail: CountryDetail): void {
    if (!this.map || !detail.latlng || detail.latlng.length !== 2) {
      return;
    }
    const [lat, lng] = detail.latlng;
    this.map.flyTo({
      center: [lng, lat],
      zoom: Math.max(this.map.getZoom(), 3.2),
      padding: { right: 420 },
      duration: 1800,
      essential: true,
    });
  }

  private initMap(token: string): void {
    mapboxgl.accessToken = token;
    // CSP build: the worker ships as a separate file (copied from
    // node_modules via angular.json assets) instead of a blob extracted from
    // the main bundle, which Angular's minifier corrupts.
    (mapboxgl as { workerUrl?: string }).workerUrl = '/mapbox-gl-csp-worker.js';

    this.map = new mapboxgl.Map({
      container: this.mapContainer().nativeElement,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: 'globe',
      center: [24, 22],
      zoom: 1.7,
      minZoom: 1,
      maxZoom: 8,
      attributionControl: true,
    });

    this.map.on('error', (event) => {
      console.error('Mapbox error', event.error);
      // Mapbox emits benign errors during startup (aborted tiles, missing
      // sprites). Only an auth failure before the style loads is fatal.
      const status = (event.error as { status?: number } | undefined)?.status;
      if (!this.styleLoaded && (status === 401 || status === 403)) {
        this.mapError.set(true);
        this.mapLoading.set(false);
      }
    });

    this.map.on('style.load', () => {
      this.styleLoaded = true;
      this.mapError.set(false);
      this.mapLoading.set(false);
      this.map!.setFog({
        color: 'rgba(11, 15, 23, 0.9)',
        'high-color': 'rgba(28, 36, 54, 0.6)',
        'space-color': '#070a10',
        'horizon-blend': 0.04,
        'star-intensity': 0.35,
      });
      this.addCountryLayers();
    });

    // First interaction with the globe dissolves the welcome overlay.
    this.map.once('mousedown', () => this.dismissWelcome());
    this.map.once('touchstart', () => this.dismissWelcome());

    // Exposed for E2E tests / debugging.
    (window as unknown as { __marsadMap?: mapboxgl.Map }).__marsadMap = this.map;
  }

  private addCountryLayers(): void {
    const map = this.map!;
    const filter = countryFilter(this.excluded, this.promoted);

    map.addSource(COUNTRY_SOURCE, {
      type: 'vector',
      url: 'mapbox://mapbox.country-boundaries-v1',
    });

    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: COUNTRY_SOURCE,
      'source-layer': COUNTRY_SOURCE_LAYER,
      filter,
      paint: {
        'fill-color': '#c9a24b',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.28,
          0.02,
        ],
      },
    });

    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: COUNTRY_SOURCE,
      'source-layer': COUNTRY_SOURCE_LAYER,
      filter,
      paint: {
        'line-color': 'rgba(201, 162, 75, 0.35)',
        'line-width': 0.6,
      },
    });

    // Selected-country highlight: a soft fill and a throbbing gold border,
    // animated via requestAnimationFrame while a country is open.
    map.addLayer({
      id: SELECTED_FILL_LAYER,
      type: 'fill',
      source: COUNTRY_SOURCE,
      'source-layer': COUNTRY_SOURCE_LAYER,
      filter: NO_SELECTION_FILTER,
      paint: { 'fill-color': '#c9a24b', 'fill-opacity': 0.1 },
    });
    map.addLayer({
      id: SELECTED_LINE_LAYER,
      type: 'line',
      source: COUNTRY_SOURCE,
      'source-layer': COUNTRY_SOURCE_LAYER,
      filter: NO_SELECTION_FILTER,
      paint: {
        'line-color': '#d9b96c',
        'line-width': 2,
        'line-opacity': 0.9,
        'line-blur': 0.5,
      },
    });

    this.applyWorldviewToBaseLabels();
    void this.addPromotedLabels();

    map.on('mousemove', FILL_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      // The selected country is already highlighted by the pulse — no hover
      // tint, no pointer cursor, not clickable.
      if (feature.properties?.['iso_3166_1'] === this.selected?.a2) {
        map.getCanvas().style.cursor = '';
        this.setHovered(null);
        return;
      }
      map.getCanvas().style.cursor = 'pointer';
      this.setHovered(feature.id ?? null);
    });

    map.on('mouseleave', FILL_LAYER, () => {
      map.getCanvas().style.cursor = '';
      this.setHovered(null);
    });

    map.on('click', FILL_LAYER, (event) => {
      const code = event.features?.[0]?.properties?.['iso_3166_1'];
      if (typeof code === 'string' && code.length === 2 && code !== this.selected?.a2) {
        this.selectCountry(code);
      }
    });
  }

  /** Point the highlight layers at the selected country and start throbbing. */
  private highlightSelection(alpha2: string, alpha3: string): void {
    this.selected = { a2: alpha2.toUpperCase(), a3: alpha3.toUpperCase() };
    const map = this.map;
    if (!map || !map.getLayer(SELECTED_LINE_LAYER)) {
      return;
    }
    const filter: mapboxgl.FilterSpecification = [
      'all',
      [
        'any',
        ['==', ['get', 'disputed'], 'false'],
        ['in', ['get', 'iso_3166_1'], ['literal', this.promoted]],
      ],
      ['any', ['==', ['get', 'worldview'], 'all'], ['in', 'US', ['get', 'worldview']]],
      [
        'any',
        ['==', ['get', 'iso_3166_1'], alpha2],
        ['==', ['get', 'iso_3166_1_alpha_3'], alpha3],
      ],
    ];
    map.setFilter(SELECTED_FILL_LAYER, filter);
    map.setFilter(SELECTED_LINE_LAYER, filter);
    this.startPulse();
  }

  private clearSelection(): void {
    this.selected = null;
    this.stopPulse();
    const map = this.map;
    if (map?.getLayer(SELECTED_LINE_LAYER)) {
      map.setFilter(SELECTED_FILL_LAYER, NO_SELECTION_FILTER);
      map.setFilter(SELECTED_LINE_LAYER, NO_SELECTION_FILTER);
    }
  }

  private startPulse(): void {
    this.stopPulse();
    const start = performance.now();
    const tick = (now: number) => {
      const map = this.map;
      if (!map || !map.getLayer(SELECTED_LINE_LAYER)) {
        return;
      }
      // ~2.4s breathing cycle.
      const phase = (Math.sin(((now - start) / 2400) * Math.PI * 2) + 1) / 2;
      map.setPaintProperty(SELECTED_LINE_LAYER, 'line-width', 1.6 + phase * 2.2);
      map.setPaintProperty(SELECTED_LINE_LAYER, 'line-opacity', 0.55 + phase * 0.45);
      map.setPaintProperty(SELECTED_LINE_LAYER, 'line-blur', 0.2 + phase * 1.4);
      map.setPaintProperty(SELECTED_FILL_LAYER, 'fill-opacity', 0.06 + phase * 0.07);
      this.pulseFrame = requestAnimationFrame(tick);
    };
    this.pulseFrame = requestAnimationFrame(tick);
  }

  private stopPulse(): void {
    if (this.pulseFrame !== null) {
      cancelAnimationFrame(this.pulseFrame);
      this.pulseFrame = null;
    }
  }

  /** Hide the base style's name labels for excluded countries. */
  private applyWorldviewToBaseLabels(): void {
    if (this.excluded.length === 0) {
      return;
    }
    const map = this.map!;
    for (const layerId of ['country-label', 'country-boundaries']) {
      if (!map.getLayer(layerId)) {
        continue;
      }
      const existing = map.getFilter(layerId);
      const exclusion: mapboxgl.ExpressionSpecification = [
        '!',
        ['in', ['coalesce', ['get', 'iso_3166_1'], ''], ['literal', this.excluded]],
      ];
      map.setFilter(
        layerId,
        existing ? (['all', existing, exclusion] as mapboxgl.FilterSpecification) : exclusion,
      );
    }
  }

  /** Add Marsad's own labels for promoted countries (name from our API). */
  private async addPromotedLabels(): Promise<void> {
    const alpha2 = this.promoted.filter((code) => code.length === 2);
    if (alpha2.length === 0 || !this.map) {
      return;
    }

    const features = await Promise.all(
      alpha2.map(async (code) => {
        try {
          const detail = await new Promise<CountryDetail>((resolve, reject) =>
            this.countryService.getCountry(code).subscribe({ next: resolve, error: reject }),
          );
          if (!detail.latlng || detail.latlng.length !== 2) {
            return null;
          }
          // Use the short common name (before any comma, e.g. "Palestine,
          // State of" -> "Palestine").
          const name = detail.name.split(',')[0].trim();
          return {
            type: 'Feature' as const,
            properties: { name },
            geometry: {
              type: 'Point' as const,
              coordinates: [detail.latlng[1], detail.latlng[0]],
            },
          };
        } catch {
          return null;
        }
      }),
    );

    const map = this.map;
    if (!map || !this.styleLoaded) {
      return;
    }
    map.addSource(PROMOTED_LABEL_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features.filter((f): f is NonNullable<typeof f> => f !== null),
      },
    });
    map.addLayer({
      id: PROMOTED_LABEL_LAYER,
      type: 'symbol',
      source: PROMOTED_LABEL_SOURCE,
      minzoom: 3,
      layout: {
        'text-field': ['get', 'name'],
        // Copied from dark-v11's own country-label layer so promoted labels
        // are indistinguishable from neighboring countries (size curve of a
        // mid-rank country, symbolrank ~5).
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate',
          ['cubic-bezier', 0.2, 0, 0.7, 1],
          ['zoom'],
          1,
          8,
          9,
          17,
        ],
        'text-transform': 'none',
      },
      paint: {
        'text-color': 'hsl(0, 0%, 40%)',
        'text-halo-color': 'hsl(0, 0%, 3%)',
        'text-halo-width': 1.25,
      },
    });
  }

  private setHovered(id: string | number | null): void {
    const map = this.map!;
    if (this.hoveredCountryId !== null) {
      map.setFeatureState(
        { source: COUNTRY_SOURCE, sourceLayer: COUNTRY_SOURCE_LAYER, id: this.hoveredCountryId },
        { hover: false },
      );
    }
    this.hoveredCountryId = id;
    if (id !== null) {
      map.setFeatureState(
        { source: COUNTRY_SOURCE, sourceLayer: COUNTRY_SOURCE_LAYER, id },
        { hover: true },
      );
    }
  }
}
