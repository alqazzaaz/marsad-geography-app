/** Mirrors the backend country schemas (app/schemas/country.py). */

export interface CountryLanguage {
  name: string;
  native_name: string | null;
  iso639_1: string | null;
}

export interface CountryCurrency {
  code: string | null;
  name: string | null;
  symbol: string | null;
}

export interface CountrySummary {
  alpha2_code: string;
  alpha3_code: string;
  name: string;
  capital: string | null;
  region: string | null;
  flag_emoji: string | null;
  flag_png: string | null;
  latlng: number[] | null;
  population: number | null;
}

export interface CountryDetail extends CountrySummary {
  native_name: string | null;
  subregion: string | null;
  demonym: string | null;
  area: number | null;
  borders: string[];
  timezones: string[];
  languages: CountryLanguage[];
  currencies: CountryCurrency[];
  calling_codes: string[];
  top_level_domains: string[];
  flag_svg: string | null;
}
