import { Injectable, signal } from '@angular/core';

export type Theme = 'night' | 'day';

const STORAGE_KEY = 'marsad-theme';

/** Night (midnight observatory) vs. day (parchment daylight) theme. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(restore());

  constructor() {
    this.applyBodyClass();
  }

  toggle(): Theme {
    this.theme.update((t) => (t === 'night' ? 'day' : 'night'));
    try {
      localStorage.setItem(STORAGE_KEY, this.theme());
    } catch {
      // Private browsing — theme simply won't persist.
    }
    this.applyBodyClass();
    return this.theme();
  }

  private applyBodyClass(): void {
    document.body.classList.toggle('theme-day', this.theme() === 'day');
  }
}

function restore(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'day' ? 'day' : 'night';
  } catch {
    return 'night';
  }
}
