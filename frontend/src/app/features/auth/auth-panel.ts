import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';

import { STRINGS } from '../../core/i18n/strings';
import { AuthService } from '../../core/services/auth.service';

/** Small sign-in / register modal. Browsing never requires it. */
@Component({
  selector: 'app-auth-panel',
  imports: [FormsModule],
  templateUrl: './auth-panel.html',
  styleUrl: './auth-panel.scss',
})
export class AuthPanel {
  private readonly auth = inject(AuthService);

  readonly closed = output<void>();

  readonly t = STRINGS.auth;

  readonly mode = signal<'login' | 'register'>('login');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  email = '';
  password = '';
  displayName = '';

  switchMode(): void {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set(null);
  }

  submit(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    const request =
      this.mode() === 'login'
        ? this.auth.login(this.email, this.password)
        : this.auth.register(this.email, this.displayName, this.password);

    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.closed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const detail = err.error?.detail;
        this.error.set(typeof detail === 'string' ? detail : this.t.genericError);
      },
    });
  }
}
