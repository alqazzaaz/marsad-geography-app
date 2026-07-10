/**
 * Type shim for the CSP build of mapbox-gl.
 *
 * We use the CSP build because Angular's production minifier re-minifies the
 * regular mapbox-gl bundle, breaking its self-extracting blob worker
 * ("ReferenceError: Dt is not defined" inside a blob: URL). The CSP build
 * loads its worker from a separate file instead (see workerUrl in map-page).
 */
declare module 'mapbox-gl/dist/mapbox-gl-csp.js' {
  export * from 'mapbox-gl';
  import mapboxgl from 'mapbox-gl';
  export default mapboxgl;
}
