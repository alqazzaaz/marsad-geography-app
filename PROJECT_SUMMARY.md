# Marsad (مرصد) — Project Summary

**The observatory of the world.** An AI-powered platform for exploring every
country on Earth through an interactive globe — verified hard facts,
Claude-crafted cultural insights, and a live Q&A guide — built as a
portfolio project by Abdullah Al-Qazzaz with Claude Code, July 9–11, 2026.

**Live:** https://marsad.alqazzaaz.com ·
**Repo:** https://github.com/alqazzaaz/marsad-geography-app

---

## 1. The Concept

Marsad (Arabic for *observatory*, from *rasada* — "to observe") lets users
click any country on a full-screen Mapbox globe and receive genuinely
interesting depth: surprising history, real cultural context, language
essentials, iconic cultural emblems — content that goes far beyond a
Wikipedia summary. The design language is modern-premium with a subtle
Islamic Golden Age accent (midnight ink, gold astrolabe motifs, Cormorant
and Amiri typography), inspired by Baghdad's House of Wisdom and the
traveler Ibn Battuta.

The defining architectural idea: **hard facts are never AI-generated**
(they come from countries.dev), while **AI content is generated exactly
once per country, ever**, then cached permanently — making AI cost a
bounded, one-time investment rather than a running expense.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20 (standalone components, signals), Mapbox GL JS 3 (CSP build) |
| Backend | Python 3.12, FastAPI (async), SQLAlchemy 2 + asyncpg |
| Data | PostgreSQL (JSONB caching), Redis (cache + Pub/Sub queue) |
| AI | Anthropic Claude API (claude-sonnet-4-6), structured JSON outputs, SSE streaming |
| Facts | countries.dev (free, keyless) |
| Imagery | Wikimedia: Wikidata P948 banners, Wikipedia page images (keyless) |
| Auth | JWT (PyJWT) + BCrypt |
| Observability | Sentry (backend) |
| CI/CD | GitHub Actions → GHCR → Azure |
| Hosting | Azure Static Web Apps + Azure Container Apps + Neon PostgreSQL + Upstash Redis (all free tiers) |

## 3. Build Timeline — The Eight Phases

**Phase 1 — Foundation.** Angular scaffold, FastAPI skeleton, Docker
Compose stack (Postgres 16, Redis 7, backend, nginx-served frontend),
environment-based configuration, health endpoint verifying both stores.

**Phase 2 — Data + Caching Core.** countries.dev client; `countries` table
storing full JSONB payloads with promoted columns; the multi-layer cache
(Redis → PostgreSQL → external API, write-back to both). A full-sync marker
table prevents partial rows from masquerading as the complete dataset —
a real bug caught by end-to-end testing during the phase. Every response
carries `X-Cache-Source: redis|postgres|api`.

**Phase 3 — Interactive Map.** Full-screen dark globe with atmosphere and
stars; animated welcome moment ("You are now in the Marsad…"); country
hover/click via the Mapbox country-boundaries tileset (worldview-filtered);
sliding profile panel with facts and clickable border chips; Mapbox token
served at runtime from the backend so it never enters the bundle.

**Phase 4 — AI Insights.** Async Claude client with structured JSON
schemas; insights cached permanently (one generation per country, ever);
Redis Pub/Sub background worker so cache misses return `202` instantly
while generation happens off the request path; **daily USD budget guard**
metered from real token usage; **per-IP daily rate limiting**. Frontend
polls and renders Surprising History, Cultural Context, Notable People,
Hidden Gems.

**Phase 5 — Language & Culture + Feed.** Culture card (key phrases with
pronunciation, dos & don'ts, etiquette briefings) as a second cached AI
kind; pooled "Did You Know?" feed where refreshes are free random
selections and the pool tops itself up in the background under the budget
guard.

**Phase 6 — Authentication.** JWT register/login/me with BCrypt (run off
the event loop), account-enumeration-safe errors, bcrypt 72-byte input
validation; sign-in modal and session restore on the frontend. Browsing
remains fully open — accounts exist for future save features.

**Phase 7 — Identity.** "The Story of Marsad" editorial page (the name,
the House of Wisdom, Ibn Battuta with a *Rihla* pull-quote); the SVG logo —
an astrolabe ring holding an eight-pointed star with an observer's eye —
used as favicon, header mark, and page hero; staggered entrance animation
and a personal credit line.

**Phase 8 — Operations.** GitHub Actions CI (backend error-level lint +
test hook, Angular production build, compose build); Sentry integration
(DSN-activated); deployment architecture.

## 4. Beyond the Plan — Product Iterations

- **"Ask the Observatory"** — streaming per-country Q&A over SSE (first
  tokens ~2.5s), grounded in the cached insights with instructions not to
  repeat on-screen content; budget/rate guarded; docked permanently at the
  panel's bottom.
- **Configurable map worldview** — `MAP_EXCLUDED_COUNTRIES` /
  `MAP_PROMOTED_COUNTRIES` env vars: excluded countries lose interactivity,
  labels, and border chips; promoted countries (Palestine in this
  deployment) become clickable with full profiles and a base-style-matched
  label (paint values read from the map style at runtime for an exact match).
- **Hero banners** — the human-curated Wikivoyage page banner (Wikidata
  P948) per country with the native-script name as a large watermark
  (الأردن over Petra). Strict single-source policy: a missing banner beats
  a wrong one.
- **Cultural emblems with photos** — 4 iconic items per country (shemagh,
  mansaf, dabke…) with local-script names; images resolved from exact
  Wikipedia article titles supplied by Claude in the schema (search-based
  matching was tried and removed for precision).
- **Living UI** — pulsing gold border + soft fill on the selected country
  (rAF-animated), traveling shimmer along panel hairlines, breathing feed
  pill with fact-swap animations, meaningful log-scale comparison bars
  ("0.13% of humanity · similar in population to Portugal"), region-themed
  SVG texture overlays, bigger flags.
- **Prompt tuning** — insights tightened to 2–3 sentences per entry after
  content review; per-kind max-token caps.
- **Capital pulse dots** — glowing dots on every capital when a country is
  selected, from a curated Natural Earth-derived static dataset (208
  countries, multi-capital aware: Bolivia, South Africa, Sri Lanka…) —
  zero runtime dependencies for unchanging facts.
- **Daylight theme** — full parchment-and-ink light mode: theme-token CSS
  architecture, Mapbox style swap with layer restoration, persisted toggle.
- **A cinematic entrance** — the globe idles in a slow spin behind a light
  veil; entering hands that momentum to a 5.6-second descent from deep
  space while a golden dawn flares around the atmosphere, a vignette lifts,
  and a voice (ElevenLabs, preloaded for instant playback) welcomes the
  traveler.
- **Mobile pass** — header actions collapse into a dropdown, the country
  panel narrows to 60% with the fly-to camera padding computed from the
  real panel width so countries and their capitals stay in frame.

Rejected along the way (deliberate product decisions): flag-derived accent
colors, panel silhouette (moved to the map), multi-variant insight caching,
golden shooting stars (built, then cut).

## 5. Notable Bugs & Lessons

| Bug | Lesson |
|---|---|
| Blank map in production builds: `ReferenceError` inside a blob worker | Angular's minifier corrupts mapbox-gl's self-extracting worker → use the CSP build with an external worker file |
| `.env` edits silently ignored | Compose reads env at container-create time → `--force-recreate` after every edit |
| Feed pool of one country served as "the world" | Cache layers need explicit full-sync markers |
| Failed AI jobs burned the user's daily rate limit | Cost controls must distinguish attempts from successes (fixed by key-config checks + reset) |
| Container App create failed with generic "provisioning Failed" | Placeholder image listens on :80 — creating with target-port 8000 fails the startup probe |
| CD deploy wiped Container App secrets | `secrets: []` in a CA YAML spec **deletes** secrets; omit the key to preserve them |
| Blank globe on the live site only | Azure SWA injects `Referrer-Policy: same-origin`, stripping the Referer that Mapbox URL restrictions validate → override via `staticwebapp.config.json` globalHeaders |
| Wrong emblem/banner images | Fuzzy image search is unreliable → exact-source lookups only (Wikidata P948; Claude-supplied Wikipedia titles) |
| "Works on one device, not another" after deploys | Almost always browser cache or deploy timing — verify against production with a headless browser before touching code |

## 6. Cost Model

- Per country, one-time: insights ≈ $0.02, culture ≈ $0.015, emblems ≈
  $0.012, images $0 (Wikimedia) → **≈ $0.05/country, cached forever**.
- Recurring: Q&A ≈ $0.005–0.01 per question; occasional feed batches.
- Guards: daily USD ceiling (Redis-metered from real token counts, 503 when
  reached), 30 generations/IP/day (429), single backend replica prevents
  duplicate jobs.
- **Full-catalog pre-generation: done.** A one-time GitHub Actions run
  (reading production secrets via Azure, driving Claude from the runner)
  generated all 249 countries — 726 generations, zero failures, **$11.30
  total**. Every country on Earth now serves instantly, forever; the lazy
  path remains as a self-healing fallback.

## 7. Deployment (all free tiers)

```
GitHub main ──CI──► CD ──┬─► Azure Static Web Apps ─► marsad.alqazzaaz.com (CDN + managed TLS)
                         └─► GHCR ─► Azure Container Apps (germanywestcentral, scale-to-zero)
                                        ├─► Neon serverless PostgreSQL (Frankfurt)
                                        └─► Upstash Redis (eu-central-1, TLS)
```

- One config home: `infra/containerapp.yaml` (single-line `minReplicas`
  toggle, secrets referenced by name only) + `infra/DEPLOYMENT.md` (the
  registry of every value, where it lives, how to change it).
- CD on every push to main after CI passes; deploy jobs skip gracefully
  when Azure secrets are absent; a dormant keep-warm workflow can be
  enabled by uncommenting two lines.
- Local development unchanged: `docker compose up` runs everything;
  environments differ purely by env vars (`DATABASE_URL`/`REDIS_URL`
  overrides with automatic Neon URL normalization).
- Frontend↔backend split handled by a runtime `app-config.js` (API base
  injected at deploy time) since SWA free tier has no backend proxy.

## 8. Current State & Roadmap

**Live and complete:** frontend + backend deployed and connected
(Neon/Upstash healthy), custom domain with TLS, CI/CD green (including a
22-test backend suite covering the budget guard, rate limiting, cache
locks, and schema mapping), Sentry armed, JWT secret rotated via a
zero-exposure workflow, **all 249 countries pre-generated and cached
permanently**, voice-and-motion entrance, day/night themes, mobile layout.

**Parked ideas:** Arabic localization (UI strings already centralized;
lazy per-language generation designed), favorites/visited countries (auth
is ready), city-level exploration, country comparison, quiz mode.

---

*Built in three days of intensive pairing between Abdullah Al-Qazzaz and
Claude Code — from `git init` to a custom domain in production.*
