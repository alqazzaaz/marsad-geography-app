/** Mirrors the backend insight schemas (app/services/claude_client.py). */

export interface InsightItem {
  title: string;
  detail: string;
}

export interface NotablePerson {
  name: string;
  known_for: string;
  widely_known: boolean;
}

export interface HiddenGem {
  name: string;
  detail: string;
}

export interface CountryInsights {
  surprising_history: InsightItem[];
  cultural_context: InsightItem[];
  notable_people: NotablePerson[];
  hidden_gems: HiddenGem[];
}

export interface AiContentResponse<T> {
  status: 'ready' | 'generating';
  data?: T;
  generated_at?: string;
}

export type InsightsResponse = AiContentResponse<CountryInsights>;

/** Language & culture card (backend kind: "culture"). */

export interface KeyPhrase {
  meaning: string;
  local: string;
  pronunciation: string;
}

export interface EtiquetteItem {
  topic: string;
  advice: string;
}

export interface CountryCulture {
  key_phrases: KeyPhrase[];
  dos: string[];
  donts: string[];
  etiquette: EtiquetteItem[];
}

export type CultureResponse = AiContentResponse<CountryCulture>;

/** Cultural emblems (backend kind: "emblems"). */

export interface CulturalEmblem {
  name: string;
  local_name: string;
  category: string;
  description: string;
  image_url?: string | null;
}

export interface MediaResponse {
  banner_url: string | null;
}

export interface CountryEmblems {
  emblems: CulturalEmblem[];
}

export type EmblemsResponse = AiContentResponse<CountryEmblems>;

/** "Did You Know?" feed. */

export interface FeedFact {
  id: number;
  country_name: string;
  alpha2_code: string | null;
  fact: string;
}

export interface FeedResponse {
  status: 'ready' | 'generating';
  facts: FeedFact[];
}
