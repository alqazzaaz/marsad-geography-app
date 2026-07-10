import { HttpClient } from '@angular/common/http';
import { api } from '../api';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CountryDetail, CountrySummary } from '../models/country.model';

@Injectable({ providedIn: 'root' })
export class CountryService {
  private readonly http = inject(HttpClient);

  listCountries(): Observable<CountrySummary[]> {
    return this.http.get<CountrySummary[]>(api('/api/countries'));
  }

  getCountry(code: string): Observable<CountryDetail> {
    return this.http.get<CountryDetail>(api(`/api/countries/${code}`));
  }
}