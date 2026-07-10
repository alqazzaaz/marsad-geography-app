import { HttpClient } from '@angular/common/http';
import { api } from '../api';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { TokenResponse, User } from '../models/auth.model';

const TOKEN_KEY = 'marsad_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly currentUser = signal<User | null>(null);

  constructor() {
    if (this.token) {
      // Restore the session; a stale/expired token just logs the user out.
      this.http.get<User>(api('/api/auth/me')).subscribe({
        next: (user) => this.currentUser.set(user),
        error: () => this.logout(),
      });
    }
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  register(email: string, displayName: string, password: string): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(api('/api/auth/register'), {
        email,
        display_name: displayName,
        password,
      })
      .pipe(tap((res) => this.storeSession(res)));
  }

  login(email: string, password: string): Observable<TokenResponse> {
    return this.http
      .post<TokenResponse>(api('/api/auth/login'), { email, password })
      .pipe(tap((res) => this.storeSession(res)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.currentUser.set(null);
  }

  private storeSession(res: TokenResponse): void {
    localStorage.setItem(TOKEN_KEY, res.access_token);
    this.currentUser.set(res.user);
  }
}