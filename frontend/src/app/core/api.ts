/**
 * API base resolution. Locally (and behind nginx) the base is '' and all
 * calls are same-origin '/api/...'. In production the frontend lives on
 * Azure Static Web Apps while the API lives on Container Apps, so CD writes
 * the absolute backend URL into /app-config.js at deploy time.
 */
declare global {
  interface Window {
    MARSAD_API_BASE?: string;
  }
}

export function api(path: string): string {
  return (window.MARSAD_API_BASE ?? '') + path;
}
