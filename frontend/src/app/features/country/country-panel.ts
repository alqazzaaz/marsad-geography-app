import { DecimalPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  WritableSignal,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

import { STRINGS } from '../../core/i18n/strings';
import { CountryDetail } from '../../core/models/country.model';
import {
  AiContentResponse,
  CountryCulture,
  CountryInsights,
} from '../../core/models/insights.model';
import { InsightsService } from '../../core/services/insights.service';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // give up after ~90s

type AiState = 'idle' | 'generating' | 'ready' | 'limited' | 'error';

/** Polling state machine for one kind of AI content (insights / culture). */
class AiContent<T> {
  readonly state = signal<AiState>('idle');
  readonly data: WritableSignal<T | null> = signal(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(
    private readonly fetchFn: (code: string) => Observable<AiContentResponse<T>>,
    private readonly currentCode: () => string | undefined,
  ) {}

  start(code: string): void {
    this.reset();
    this.fetch(code);
  }

  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.attempts = 0;
    this.state.set('idle');
    this.data.set(null);
  }

  private fetch(code: string): void {
    if (this.currentCode() !== code) {
      return;
    }
    this.fetchFn(code).subscribe({
      next: (res) => {
        if (this.currentCode() !== code) {
          return;
        }
        if (res.status === 'ready' && res.data) {
          this.data.set(res.data);
          this.state.set('ready');
        } else {
          this.state.set('generating');
          if (++this.attempts > POLL_MAX_ATTEMPTS) {
            this.state.set('error');
            return;
          }
          this.timer = setTimeout(() => this.fetch(code), POLL_INTERVAL_MS);
        }
      },
      error: (err: HttpErrorResponse) => {
        if (this.currentCode() !== code) {
          return;
        }
        this.state.set(err.status === 429 || err.status === 503 ? 'limited' : 'error');
      },
    });
  }
}

/**
 * Sliding side panel with a country's hard facts (from countries.dev via the
 * backend cache) plus the AI-crafted insights and language & culture layers.
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
  readonly tc = STRINGS.culture;

  readonly insights = new AiContent<CountryInsights>(
    (code) => this.insightsService.getInsights(code),
    () => this.country()?.alpha2_code,
  );
  readonly culture = new AiContent<CountryCulture>(
    (code) => this.insightsService.getCulture(code),
    () => this.country()?.alpha2_code,
  );

  constructor() {
    effect(() => {
      const c = this.country();
      if (c) {
        this.insights.start(c.alpha2_code);
        this.culture.start(c.alpha2_code);
      } else {
        this.insights.reset();
        this.culture.reset();
      }
    });
    this.destroyRef.onDestroy(() => {
      this.insights.reset();
      this.culture.reset();
    });
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
