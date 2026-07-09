/**
 * All user-facing copy lives here so it can be lifted into i18next
 * translation files later without touching components.
 */
export const STRINGS = {
  brand: {
    name: 'Marsad',
    nameArabic: 'مرصد',
    tagline: 'The Observatory of the World',
  },
  welcome: {
    line1: 'You are now in the Marsad —',
    line2: 'the observatory of the world.',
    line3: 'Choose a country to begin your journey.',
    enter: 'Enter the observatory',
  },
  map: {
    tokenMissing:
      'The map needs a Mapbox access token. Add MAPBOX_ACCESS_TOKEN to your .env file and restart the stack.',
    loadError: 'The observatory could not reach the world map. Please try again.',
  },
  country: {
    capital: 'Capital',
    region: 'Region',
    population: 'Population',
    area: 'Area',
    languages: 'Languages',
    currencies: 'Currencies',
    timezones: 'Timezones',
    callingCode: 'Calling code',
    domain: 'Internet domain',
    borders: 'Borders',
    loading: 'Consulting the observatory…',
    loadError: 'Could not load this country. Please try again.',
    close: 'Close',
  },
} as const;
