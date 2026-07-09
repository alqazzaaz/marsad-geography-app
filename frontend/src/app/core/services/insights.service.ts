import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { InsightsResponse } from '../models/insights.model';

@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly http = inject(HttpClient);

  getInsights(code: string): Observable<InsightsResponse> {
    return this.http.get<InsightsResponse>(`/api/countries/${code}/insights`);
  }
}
