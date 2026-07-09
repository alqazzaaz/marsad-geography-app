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

export interface InsightsResponse {
  status: 'ready' | 'generating';
  data?: CountryInsights;
  generated_at?: string;
}
