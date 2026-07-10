import { HttpClient } from '@angular/common/http';
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
    return this.http.get<InsightsResponse>(`/api/countries/${code}/insights`);
  }

  getCulture(code: string): Observable<CultureResponse> {
    return this.http.get<CultureResponse>(`/api/countries/${code}/culture`);
  }

  getEmblems(code: string): Observable<EmblemsResponse> {
    return this.http.get<EmblemsResponse>(`/api/countries/${code}/emblems`);
  }

  getMedia(code: string): Observable<MediaResponse> {
    return this.http.get<MediaResponse>(`/api/countries/${code}/media`);
  }

  getFeed(limit = 8): Observable<FeedResponse> {
    return this.http.get<FeedResponse>(`/api/feed`, { params: { limit } });
  }
}
