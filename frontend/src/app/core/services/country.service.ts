import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CountryDetail, CountrySummary } from '../models/country.model';

@Injectable({ providedIn: 'root' })
export class CountryService {
  private readonly http = inject(HttpClient);

  listCountries(): Observable<CountrySummary[]> {
    return this.http.get<CountrySummary[]>('/api/countries');
  }

  getCountry(code: string): Observable<CountryDetail> {
    return this.http.get<CountryDetail>(`/api/countries/${code}`);
  }
}
