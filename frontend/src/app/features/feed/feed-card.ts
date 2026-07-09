import { Component, DestroyRef, inject, signal } from '@angular/core';

import { STRINGS } from '../../core/i18n/strings';
import { FeedFact } from '../../core/models/insights.model';
import { InsightsService } from '../../core/services/insights.service';

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_ATTEMPTS = 15;

/**
 * "Did You Know?" — a floating card cycling through surprising facts from the
 * observatory's fact pool. Cycling is local; refresh fetches a new random
 * batch (free — served from the pooled facts, no AI call per refresh).
 */
@Component({
  selector: 'app-feed-card',
  templateUrl: './feed-card.html',
  styleUrl: './feed-card.scss',
})
export class FeedCard {
  private readonly insightsService = inject(InsightsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly t = STRINGS.feed;

  readonly open = signal(false);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly facts = signal<FeedFact[]>([]);
  readonly index = signal(0);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollAttempts = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  get current(): FeedFact | null {
    return this.facts()[this.index()] ?? null;
  }

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open() && this.state() === 'idle') {
      this.load();
    }
    if (!this.open()) {
      this.stopPolling();
    }
  }

  next(): void {
    if (this.facts().length > 0) {
      this.index.update((i) => (i + 1) % this.facts().length);
    }
  }

  refresh(): void {
    this.pollAttempts = 0;
    this.load();
  }

  private load(): void {
    this.state.set('loading');
    this.insightsService.getFeed().subscribe({
      next: (res) => {
        if (res.status === 'ready' && res.facts.length > 0) {
          this.facts.set(res.facts);
          this.index.set(0);
          this.state.set('ready');
        } else if (++this.pollAttempts <= POLL_MAX_ATTEMPTS) {
          this.pollTimer = setTimeout(() => this.load(), POLL_INTERVAL_MS);
        } else {
          this.state.set('error');
        }
      },
      error: () => this.state.set('error'),
    });
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
