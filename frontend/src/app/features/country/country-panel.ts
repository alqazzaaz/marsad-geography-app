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

import { FormsModule } from '@angular/forms';

import { STRINGS } from '../../core/i18n/strings';
import { CountryDetail } from '../../core/models/country.model';
import {
  AiContentResponse,
  CountryCulture,
  CountryInsights,
} from '../../core/models/insights.model';
import { AskHistoryMessage, AskService } from '../../core/services/ask.service';
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
  imports: [DecimalPipe, FormsModule],
  templateUrl: './country-panel.html',
  styleUrl: './country-panel.scss',
})
export class CountryPanel {
  private readonly insightsService = inject(InsightsService);
  private readonly askService = inject(AskService);
  private readonly destroyRef = inject(DestroyRef);

  readonly country = input<CountryDetail | null>(null);
  readonly loading = input(false);
  readonly error = input(false);

  readonly closed = output<void>();
  readonly borderSelected = output<string>();

  readonly t = STRINGS.country;
  readonly ti = STRINGS.insights;
  readonly tc = STRINGS.culture;
  readonly ta = STRINGS.ask;

  // --- Country Q&A chat ---
  readonly chat = signal<AskHistoryMessage[]>([]);
  readonly chatStreaming = signal(false);
  readonly chatError = signal<string | null>(null);
  question = '';
  private askAbort: AbortController | null = null;

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
      this.resetChat();
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
      this.askAbort?.abort();
    });
  }

  askQuestion(): void {
    const code = this.country()?.alpha2_code;
    const question = this.question.trim();
    if (!code || !question || this.chatStreaming()) {
      return;
    }

    this.question = '';
    this.chatError.set(null);
    // History sent to the API excludes the new question and empty drafts.
    const history = this.chat().filter((m) => m.content.trim().length > 0);

    this.chat.update((log) => [
      ...log,
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
    ]);
    this.chatStreaming.set(true);

    this.askAbort = new AbortController();
    void this.askService.ask(
      code,
      question,
      history.slice(-6),
      {
        onChunk: (text) => {
          this.chat.update((log) => {
            const updated = [...log];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, content: last.content + text };
            return updated;
          });
        },
        onDone: () => this.chatStreaming.set(false),
        onError: (message, status) => {
          this.chatStreaming.set(false);
          // Drop the empty assistant placeholder.
          this.chat.update((log) =>
            log[log.length - 1]?.content === '' ? log.slice(0, -1) : log,
          );
          this.chatError.set(
            status === 429 || status === 503 ? this.ta.limit : message || this.ta.error,
          );
        },
      },
      this.askAbort.signal,
    );
  }

  private resetChat(): void {
    this.askAbort?.abort();
    this.askAbort = null;
    this.chat.set([]);
    this.chatStreaming.set(false);
    this.chatError.set(null);
    this.question = '';
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
