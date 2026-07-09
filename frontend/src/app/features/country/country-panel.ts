import { DecimalPipe } from '@angular/common';
import { Component, input, output } from '@angular/core';

import { STRINGS } from '../../core/i18n/strings';
import { CountryDetail } from '../../core/models/country.model';

/**
 * Sliding side panel with a country's hard facts (from countries.dev via the
 * backend cache). The AI insights layer joins this panel in Phase 4.
 */
@Component({
  selector: 'app-country-panel',
  imports: [DecimalPipe],
  templateUrl: './country-panel.html',
  styleUrl: './country-panel.scss',
})
export class CountryPanel {
  readonly country = input<CountryDetail | null>(null);
  readonly loading = input(false);
  readonly error = input(false);

  readonly closed = output<void>();
  readonly borderSelected = output<string>();

  readonly t = STRINGS.country;

  languageList(country: CountryDetail): string {
    return country.languages.map((l) => l.name).join(', ');
  }

  currencyList(country: CountryDetail): string {
    return country.currencies
      .map((c) => (c.symbol ? `${c.name} (${c.symbol})` : c.name))
      .filter(Boolean)
      .join(', ');
  }
}
