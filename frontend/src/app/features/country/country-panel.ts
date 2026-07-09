import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { STRINGS } from '../../core/i18n/strings';
import { CountryDetail } from '../../core/models/country.model';
import { CountryInsights } from '../../core/models/insights.model';
import { InsightsService } from '../../core/services/insights.service';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // give up after ~90s

type InsightsState = 'idle' | 'generating' | 'ready' | 'limited' | 'error';

/**
 * Sliding side panel with a country's hard facts (from countries.dev via the
 * backend cache) and the AI-crafted Marsad insights layer.
 */
@Component({
  selector: 'app-country-panel',
  imports: [DecimalPipe],
  templateUrl: './country-panel.html',
  styleUrl: './country-panel.scss',
})
export class CountryPanel {
  private readonly insightsService = inject(InsightsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly country = input<CountryDetail | null>(null);
  readonly loading = input(false);
  readonly error = input(false);

  readonly closed = output<void>();
  readonly borderSelected = output<string>();

  readonly t = STRINGS.country;
  readonly ti = STRINGS.insights;

  readonly insightsState = signal<InsightsState>('idle');
  readonly insights = signal<CountryInsights | null>(null);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollAttempts = 0;

  constructor() {
    effect(() => {
      const c = this.country();
      this.stopPolling();
      this.insights.set(null);
      this.insightsState.set('idle');
      if (c) {
        this.pollAttempts = 0;
        this.fetchInsights(c.alpha2_code);
      }
    });
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  private fetchInsights(code: string): void {
    if (this.country()?.alpha2_code !== code) {
      return;
    }
    this.insightsService.getInsights(code).subscribe({
      next: (res) => {
        if (this.country()?.alpha2_code !== code) {
          return;
        }
        if (res.status === 'ready' && res.data) {
          this.insights.set(res.data);
          this.insightsState.set('ready');
        } else {
          this.insightsState.set('generating');
          this.schedulePoll(code);
        }
      },
      error: (err: HttpErrorResponse) => {
        if (this.country()?.alpha2_code !== code) {
          return;
        }
        this.insightsState.set(err.status === 429 || err.status === 503 ? 'limited' : 'error');
      },
    });
  }

  private schedulePoll(code: string): void {
    if (++this.pollAttempts > POLL_MAX_ATTEMPTS) {
      this.insightsState.set('error');
      return;
    }
    this.pollTimer = setTimeout(() => this.fetchInsights(code), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

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
