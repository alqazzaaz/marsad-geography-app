import { HttpClient } from '@angular/common/http';
import { api } from '../api';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CultureResponse,
  EmblemsResponse,
  FeedResponse,
  InsightsResponse,
  MediaResponse,
} from '../models/insights.model';

@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly http = inject(HttpClient);

  getInsights(code: string): Observable<InsightsResponse> {
    return this.http.get<InsightsResponse>(api(`/api/countries/${code}/insights`));
  }

  getCulture(code: string): Observable<CultureResponse> {
    return this.http.get<CultureResponse>(api(`/api/countries/${code}/culture`));
  }

  getEmblems(code: string): Observable<EmblemsResponse> {
    return this.http.get<EmblemsResponse>(api(`/api/countries/${code}/emblems`));
  }

  getMedia(code: string): Observable<MediaResponse> {
    return this.http.get<MediaResponse>(api(`/api/countries/${code}/media`));
  }

  getFeed(limit = 8): Observable<FeedResponse> {
    return this.http.get<FeedResponse>(api('/api/feed'), { params: { limit } });
  }
}