import { HttpClient } from '@angular/common/http';
import { api } from '../api';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ClientConfig {
  mapbox_token: string;
  /** ISO codes (alpha-2 + alpha-3) removed from map interactivity and labels. */
  map_excluded: string[];
  /** ISO codes made clickable even on disputed territory, with a custom label. */
  map_promoted: string[];
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private config: ClientConfig | null = null;

  async load(): Promise<ClientConfig> {
    this.config ??= await firstValueFrom(this.http.get<ClientConfig>(api('/api/config')));
    return this.config;
  }
}