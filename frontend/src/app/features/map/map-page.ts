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
import { Theme, ThemeService } from '../../core/services/theme.service';
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
const CAPITAL_SOURCE = 'marsad-capitals';
const CAPITAL_GLOW_LAYER = 'marsad-capital-glow';
const CAPITAL_DOT_LAYER = 'marsad-capital-dot';
const NO_SELECTION_FILTER: mapboxgl.FilterSpecification = ['==', ['get', 'iso_3166_1'], '__none__'];

const MAP_STYLES: Record<Theme, string> = {
  night: 'mapbox://styles/mapbox/dark-v11',
  day: 'mapbox://styles/mapbox/light-v11',
};

const FOG: Record<Theme, mapboxgl.FogSpecification> = {
  night: {
    color: 'rgba(11, 15, 23, 0.9)',
    'high-color': 'rgba(28, 36, 54, 0.6)',
    'space-color': '#070a10',
    'horizon-blend': 0.04,
    'star-intensity': 0.35,
  },
  day: {
    color: 'rgba(244, 239, 226, 0.9)',
    'high-color': 'rgba(190, 205, 225, 0.5)',
    'space-color': '#d9e2ee',
    'horizon-blend': 0.06,
    'star-intensity': 0,
  },
};

// Promoted-country labels copy the base style's own country-label paint so
// they are indistinguishable from neighbours — per style.
const PROMOTED_LABEL_PAINT: Record<Theme, { color: string; halo: string }> = {
  night: { color: 'hsl(0, 0%, 40%)', halo: 'hsl(0, 0%, 3%)' },
  day: { color: 'hsl(0, 0%, 35%)', halo: 'hsl(0, 0%, 98%)' },
};

interface Capital {
  name: string;
  lat: number;
  lng: number;
}

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
  readonly themeService = inject(ThemeService);

  private readonly mapContainer = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  private map: mapboxgl.Map | null = null;
  private hoveredCountryId: string | number | null = null;
  private styleLoaded = false;
  private handlersBound = false;
  private welcomePlayed = false;
  private welcomeAudio: HTMLAudioElement | null = null;
  private pulseFrame: number | null = null;
  private spinFrame: number | null = null;
  private selected: { a2: string; a3: string } | null = null;
  private capitals: Record<string, Capital[]> | null = null;
  excluded: string[] = [];
  private promoted: string[] = [];

  readonly t = STRINGS;

  readonly tokenMissing = signal(false);
  readonly mapError = signal(false);
  // True from first paint until the map style has loaded — covers the
  // backend cold start (scale-to-zero can take ~10-20s on the first visit).
  readonly mapLoading = signal(true);
  readonly welcomeVisible = signal(true);
  readonly welcomeLeaving = signal(false);
  readonly panelOpen = signal(false);
  readonly authOpen = signal(false);
  readonly menuOpen = signal(false);
  readonly country = signal<CountryDetail | null>(null);
  readonly countryLoading = signal(false);
  readonly countryError = signal(false);

  async ngAfterViewInit(): Promise<void> {
    void this.loadCapitals();
    this.preloadWelcomeAudio();
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
    this.stopIdleSpin();
    this.map?.remove();
  }

  dismissWelcome(): void {
    if (!this.welcomeVisible() || this.welcomeLeaving()) {
      return;
    }
    this.playWelcomeAudio();
    this.stopIdleSpin();
    // The arrival: veil dissolves, vignette lifts, a golden dawn flares
    // around the atmosphere, and the camera descends from deep space onto
    // the world — all timed to the spoken greeting (~5s).
    this.flashGoldenDawn();
    this.map?.flyTo({
      center: [24, 22],
      zoom: 1.7,
      bearing: 0,
      duration: 5600,
      curve: 1.25,
      essential: true,
    });
    this.map?.once('moveend', () => this.map?.setMinZoom(1));
    this.welcomeLeaving.set(true);
    setTimeout(() => this.welcomeVisible.set(false), 900);
  }

  /**
   * Golden dawn: two quick shimmering pulses of champagne-gold light around
   * the atmosphere — deep amber at the rim, near-white at the peaks — then
   * a long graceful decay back to night.
   */
  private flashGoldenDawn(): void {
    const map = this.map;
    if (!map || !this.styleLoaded || this.themeService.theme() !== 'night') {
      return;
    }
    const start = performance.now();
    const duration = 4600;
    // Color waypoints: night steel-blue -> deep amber -> champagne white-gold.
    const night = [28, 36, 54];
    const amber = [186, 132, 58];
    const champagne = [246, 228, 186];
    const lerp = (a: number[], b: number[], k: number) =>
      a.map((v, i) => Math.round(v + (b[i] - v) * k));

    const tick = (now: number) => {
      if (!this.map) {
        return;
      }
      const t = Math.min((now - start) / duration, 1);

      // Envelope: fast rise, long eased decay.
      const env =
        t < 0.08 ? t / 0.08 : Math.pow(1 - (t - 0.08) / 0.92, 1.7);
      // Two quick shimmer pulses riding the first 60% of the envelope,
      // then the oscillation stills and the glow simply breathes out.
      const pulsePhase = Math.min(t / 0.6, 1);
      const shimmer =
        pulsePhase < 1 ? 0.62 + 0.38 * Math.abs(Math.sin(pulsePhase * Math.PI * 2)) : 0.62;
      const glow = env * shimmer;

      // Two-stage color: rim warms to amber first, whitens near the peaks.
      const rgb =
        glow < 0.5
          ? lerp(night, amber, glow / 0.5)
          : lerp(amber, champagne, (glow - 0.5) / 0.5);
      map.setFog({
        color: `rgba(${Math.round(11 + glow * 14)}, ${Math.round(15 + glow * 10)}, ${Math.round(
          23 + glow * 2,
        )}, 0.9)`,
        'high-color': `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.6 + glow * 0.35})`,
        'space-color': '#070a10',
        'horizon-blend': 0.04 + glow * 0.075,
        'star-intensity': 0.35 + glow * 0.55,
      });
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        map.setFog(FOG.night);
      }
    };
    requestAnimationFrame(tick);
  }

  /** Slow eastward rotation while the welcome veil is up. */
  private startIdleSpin(): void {
    if (this.spinFrame !== null || !this.welcomeVisible()) {
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const map = this.map;
      if (!map || !this.welcomeVisible() || this.welcomeLeaving()) {
        this.spinFrame = null;
        return;
      }
      const dt = (now - last) / 1000;
      last = now;
      const center = map.getCenter();
      map.setCenter([center.lng + dt * 2.2, center.lat]); // ~2.2°/s drift
      this.spinFrame = requestAnimationFrame(tick);
    };
    this.spinFrame = requestAnimationFrame(tick);
  }

  private stopIdleSpin(): void {
    if (this.spinFrame !== null) {
      cancelAnimationFrame(this.spinFrame);
      this.spinFrame = null;
    }
  }

  /** The observatory greets the traveler — once, on entering. */
  private playWelcomeAudio(): void {
    if (this.welcomePlayed) {
      return;
    }
    this.welcomePlayed = true;
    try {
      // Preloaded while the welcome screen showed, so it speaks instantly.
      const audio = this.welcomeAudio ?? new Audio('/audio/welcome.mp3');
      audio.volume = 0.85;
      // Triggered by a user gesture (click/touch), so autoplay policy allows
      // it; swallow failures — the greeting is a flourish, never an error.
      void audio.play().catch(() => undefined);
    } catch {
      // Audio unsupported — silently skip.
    }
  }

  private preloadWelcomeAudio(): void {
    try {
      this.welcomeAudio = new Audio('/audio/welcome.mp3');
      this.welcomeAudio.preload = 'auto';
      this.welcomeAudio.load();
    } catch {
      // Audio unsupported — playWelcomeAudio will no-op gracefully.
    }
  }

  toggleTheme(): void {
    const theme = this.themeService.toggle();
    if (this.map && this.styleLoaded) {
      // style.load re-adds all Marsad layers and restores the selection.
      this.map.setStyle(MAP_STYLES[theme]);
    }
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

  /** Width of the open panel: clamp(240px, 60vw, 420px), mirrors its CSS. */
  private panelWidth(): number {
    return Math.round(Math.min(420, Math.max(240, window.innerWidth * 0.6)));
  }

  private flyToCountry(detail: CountryDetail): void {
    if (!this.map || !detail.latlng || detail.latlng.length !== 2) {
      return;
    }
    const [lat, lng] = detail.latlng;
    // Center the country in the strip left of the panel; on phones that
    // strip is narrow, so zoom out further to keep whole countries (and
    // their capitals) in view.
    const narrow = window.innerWidth - this.panelWidth() < 420;
    this.map.flyTo({
      center: [lng, lat],
      zoom: narrow
        ? Math.min(Math.max(this.map.getZoom(), 2.2), 3)
        : Math.max(this.map.getZoom(), 3.2),
      padding: { right: this.panelWidth() },
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
      style: MAP_STYLES[this.themeService.theme()],
      projection: 'globe',
      // Pulled back and west of the resting view — the globe idles in a slow
      // spin behind the welcome veil, and entering the observatory hands
      // that momentum to the descent (see dismissWelcome).
      center: [-60, 12],
      zoom: 0.85,
      bearing: -8,
      // Below the browsing floor for the deep-space opening; restored to 1
      // when the arrival flight lands (see dismissWelcome).
      minZoom: 0.85,
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
      this.map!.setFog(FOG[this.themeService.theme()]);
      this.addCountryLayers();
      this.startIdleSpin();
      // A theme switch replaces the whole style — restore the open selection.
      if (this.selected) {
        this.highlightSelection(this.selected.a2, this.selected.a3);
      }
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

    // Capital pulse dots: empty until a country is selected.
    map.addSource(CAPITAL_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: CAPITAL_GLOW_LAYER,
      type: 'circle',
      source: CAPITAL_SOURCE,
      paint: {
        'circle-color': '#c9a24b',
        'circle-radius': 10,
        'circle-blur': 1.2,
        'circle-opacity': 0.4,
      },
    });
    map.addLayer({
      id: CAPITAL_DOT_LAYER,
      type: 'circle',
      source: CAPITAL_SOURCE,
      paint: {
        'circle-color': '#f3d9a4',
        'circle-radius': 3.2,
        'circle-stroke-color': '#c9a24b',
        'circle-stroke-width': 1.2,
      },
    });

    this.applyWorldviewToBaseLabels();
    void this.addPromotedLabels();

    // Delegated listeners live on the map object, not the layer — bind them
    // once or a theme switch (style reload) would stack duplicates.
    if (this.handlersBound) {
      return;
    }
    this.handlersBound = true;

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
    this.updateCapitalDots(alpha2);
    this.startPulse();
  }

  /** Point the capital source at the selected country's capital(s). */
  private updateCapitalDots(alpha2: string): void {
    const map = this.map;
    if (!map || !map.getSource(CAPITAL_SOURCE)) {
      return;
    }
    const entries = this.capitals?.[alpha2.toUpperCase()] ?? [];
    (map.getSource(CAPITAL_SOURCE) as mapboxgl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: entries.map((cap) => ({
        type: 'Feature',
        properties: { name: cap.name },
        geometry: { type: 'Point', coordinates: [cap.lng, cap.lat] },
      })),
    });
  }

  /** Capitals with exact coordinates: static Natural Earth-derived dataset. */
  private async loadCapitals(): Promise<void> {
    try {
      const res = await fetch('/data/capitals.json');
      if (res.ok) {
        this.capitals = await res.json();
        // The dataset may arrive after the first country was selected.
        if (this.selected) {
          this.updateCapitalDots(this.selected.a2);
        }
      }
    } catch {
      // No dots is graceful — selection highlight still works without them.
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.stopPulse();
    const map = this.map;
    if (map?.getLayer(SELECTED_LINE_LAYER)) {
      map.setFilter(SELECTED_FILL_LAYER, NO_SELECTION_FILTER);
      map.setFilter(SELECTED_LINE_LAYER, NO_SELECTION_FILTER);
    }
    if (map?.getSource(CAPITAL_SOURCE)) {
      (map.getSource(CAPITAL_SOURCE) as mapboxgl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [],
      });
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
      if (map.getLayer(CAPITAL_GLOW_LAYER)) {
        map.setPaintProperty(CAPITAL_GLOW_LAYER, 'circle-radius', 8 + phase * 8);
        map.setPaintProperty(CAPITAL_GLOW_LAYER, 'circle-opacity', 0.25 + phase * 0.4);
      }
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
        'text-color': PROMOTED_LABEL_PAINT[this.themeService.theme()].color,
        'text-halo-color': PROMOTED_LABEL_PAINT[this.themeService.theme()].halo,
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
