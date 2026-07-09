import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface ClientConfig {
  mapbox_token: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private config: ClientConfig | null = null;

  async load(): Promise<ClientConfig> {
    this.config ??= await firstValueFrom(this.http.get<ClientConfig>('/api/config'));
    return this.config;
  }
}
