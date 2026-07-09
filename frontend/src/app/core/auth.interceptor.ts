import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Attaches the JWT to API requests when a session exists.
 * Reads localStorage directly (not AuthService) to avoid a circular
 * dependency: AuthService issues an HTTP call in its constructor.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('marsad_token');
  if (token && req.url.startsWith('/api/')) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }
  return next(req);
};
