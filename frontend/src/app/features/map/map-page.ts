import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import mapboxgl from 'mapbox-gl';

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

/** Undisputed polygons visible in the "all"/US worldview (avoids duplicates). */
const WORLDVIEW_FILTER: mapboxgl.FilterSpecification = [
  'all',
  ['==', ['get', 'disputed'], 'false'],
  ['any', ['==', ['get', 'worldview'], 'all'], ['in', 'US', ['get', 'worldview']]],
];

@Component({
  selector: 'app-map-page',
  imports: [AuthPanel, CountryPanel, FeedCard],
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

  readonly t = STRINGS;

  readonly tokenMissing = signal(false);
  readonly mapError = signal(false);
  readonly welcomeVisible = signal(true);
  readonly panelOpen = signal(false);
  readonly authOpen = signal(false);
  readonly country = signal<CountryDetail | null>(null);
  readonly countryLoading = signal(false);
  readonly countryError = signal(false);

  async ngAfterViewInit(): Promise<void> {
    try {
      const { mapbox_token } = await this.configService.load();
      if (!mapbox_token) {
        this.tokenMissing.set(true);
        return;
      }
      this.initMap(mapbox_token);
    } catch {
      this.mapError.set(true);
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  dismissWelcome(): void {
    this.welcomeVisible.set(false);
  }

  closePanel(): void {
    this.panelOpen.set(false);
    this.country.set(null);
    if (this.map) {
      this.map.easeTo({ padding: { right: 0 }, duration: 600 });
    }
  }

  selectCountry(code: string): void {
    this.dismissWelcome();
    this.panelOpen.set(true);
    this.countryLoading.set(true);
    this.countryError.set(false);

    this.countryService.getCountry(code).subscribe({
      next: (detail) => {
        this.country.set(detail);
        this.countryLoading.set(false);
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
      }
    });

    this.map.on('style.load', () => {
      this.styleLoaded = true;
      this.mapError.set(false);
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
  }

  private addCountryLayers(): void {
    const map = this.map!;

    map.addSource(COUNTRY_SOURCE, {
      type: 'vector',
      url: 'mapbox://mapbox.country-boundaries-v1',
    });

    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: COUNTRY_SOURCE,
      'source-layer': COUNTRY_SOURCE_LAYER,
      filter: WORLDVIEW_FILTER,
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
      filter: WORLDVIEW_FILTER,
      paint: {
        'line-color': 'rgba(201, 162, 75, 0.35)',
        'line-width': 0.6,
      },
    });

    map.on('mousemove', FILL_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) {
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
      if (typeof code === 'string' && code.length === 2) {
        this.selectCountry(code);
      }
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
