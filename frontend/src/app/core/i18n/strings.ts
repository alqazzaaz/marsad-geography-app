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
  insights: {
    heading: 'Marsad Insights',
    badge: 'AI-crafted',
    generating: 'The observatory is composing insights for this country…',
    error: 'Insights are unavailable right now.',
    limit: 'Insight generation is paused for today — already-explored countries remain available.',
    surprisingHistory: 'Surprising History',
    culturalContext: 'Cultural Context',
    notablePeople: 'Notable People',
    hiddenGems: 'Hidden Gems',
    lesserKnown: 'worth knowing',
    disclaimer: 'Insights are AI-generated interpretations — hard facts above come from verified data.',
  },
  culture: {
    heading: 'Language & Culture',
    generating: 'The observatory is preparing this country’s culture card…',
    keyPhrases: 'Key Phrases',
    dos: 'Do',
    donts: 'Don’t',
    etiquette: 'Know Before You Go',
  },
  feed: {
    heading: 'Did you know?',
    generating: 'The observatory is gathering surprising facts…',
    next: 'Next fact',
    refresh: 'New facts',
    open: 'Did you know?',
    close: 'Close feed',
  },
} as const;
