# Marsad — Deployment Guide & Configuration Registry

Production architecture (all free tiers):

| Layer | Service | Config lives in |
|---|---|---|
| Frontend | Azure Static Web Apps (`marsad-frontend`) → `marsad.alqazzaaz.com` | GitHub Actions (build-time `API_BASE_URL`) |
| Backend | Azure Container Apps (`marsad-backend`, germanywestcentral) | `infra/containerapp.yaml` + CA secrets |
| Database | Neon serverless PostgreSQL | CA secret `database-url` |
| Cache/queue | Upstash Redis | CA secret `redis-url` |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) | GitHub secrets & variables |

Local development is untouched: `docker compose up` runs local Postgres +
Redis; the same codebase switches to Neon/Upstash purely via env vars.

---

## Configuration registry — every value, where it lives, how to change it

| Value | Lives in | Change with |
|---|---|---|
| `minReplicas` / `maxReplicas` | `infra/containerapp.yaml` | edit + push (CD applies it), or `az containerapp update -n marsad-backend -g marsad-rg --yaml infra/containerapp.yaml` |
| `DATABASE_URL` (Neon) | CA secret `database-url` | `az containerapp secret set -n marsad-backend -g marsad-rg --secrets database-url="<neon-url>"` then restart revision |
| `REDIS_URL` (Upstash) | CA secret `redis-url` | same pattern, `redis-url="rediss://..."` |
| `ANTHROPIC_API_KEY` | CA secret `anthropic-api-key` | same pattern |
| `MAPBOX_ACCESS_TOKEN` | CA secret `mapbox-access-token` | same pattern |
| `JWT_SECRET_KEY` | CA secret `jwt-secret-key` | same pattern (generate: `openssl rand -hex 48`) |
| `SENTRY_DSN` | CA secret `sentry-dsn` | same pattern (empty string disables Sentry) |
| `CORS_ORIGINS`, worldview vars, `ENVIRONMENT` | `infra/containerapp.yaml` (plain env) | edit + push |
| `API_BASE_URL` (backend public URL) | GitHub **variable** | repo → Settings → Secrets and variables → Actions → Variables |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | GitHub **secret** | SWA → Overview → Manage deployment token |
| `AZURE_CREDENTIALS` | GitHub **secret** | output of the service-principal command below |
| Daily AI budget / rate limits / model | `infra/containerapp.yaml` env (add `CLAUDE_DAILY_BUDGET_USD` etc. as needed — see `backend/app/core/config.py` for all names) | edit + push |

---

## One-time setup (about 30 minutes)

### 0. Accounts
[Azure](https://azure.microsoft.com/free) · [Neon](https://neon.tech) ·
[Upstash](https://upstash.com) — all free tiers.

### 1. Neon
Create a project (region: EU/Frankfurt) → copy the **pooled** connection
string (`postgresql://...@...neon.tech/neondb?sslmode=require`).

### 2. Upstash
Create a Redis database (region: eu-central-1) → copy the **rediss://** URL
(TLS, from the "Redis connect" tab).

### 3. Azure resources
```bash
az login
az provider register -n Microsoft.App --wait
az provider register -n Microsoft.OperationalInsights --wait
az group create -n marsad-rg -l germanywestcentral

# Container Apps environment + app (placeholder image until first CD run)
az extension add --name containerapp
az containerapp env create -n marsad-env -g marsad-rg -l germanywestcentral

# IMPORTANT: --target-port 80 here. The placeholder image listens on 80;
# the real port (8000) is applied by CD together with the real image.
# Creating with port 8000 + the placeholder fails the startup probe.
az containerapp create -n marsad-backend -g marsad-rg --environment marsad-env \
  --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 80

# Secrets (paste real values)
az containerapp secret set -n marsad-backend -g marsad-rg --secrets \
  database-url="<NEON_URL>" \
  redis-url="<UPSTASH_REDISS_URL>" \
  anthropic-api-key="<KEY>" \
  mapbox-access-token="<TOKEN>" \
  jwt-secret-key="$(openssl rand -hex 48)" \
  sentry-dsn="<DSN or empty>"

# Do NOT apply infra/containerapp.yaml manually — CD applies it on every
# deploy, once the real image exists in GHCR.

# Note the backend URL for the API_BASE_URL GitHub variable:
az containerapp show -n marsad-backend -g marsad-rg --query properties.configuration.ingress.fqdn -o tsv
```

### 4. Static Web App
```bash
az staticwebapp create -n marsad-frontend -g marsad-rg -l westeurope --sku Free
az staticwebapp secrets list -n marsad-frontend -g marsad-rg --query properties.apiKey -o tsv
```
(SWA free isn't offered in germanywestcentral; westeurope is the nearest —
it's a global CDN anyway.)

### 5. GHCR pull access
The **first** backend deploy pushes the image to GHCR and then fails at the
rollout step, because new GHCR packages are private. That's expected: open
the package on GitHub (Profile → Packages → `marsad-backend`) → Package
settings → set visibility **Public**, then re-run the failed
`deploy-backend` job. Every subsequent deploy just works.

### 6. GitHub repo settings (Settings → Secrets and variables → Actions)
- SWA deployment token: **already done** — creating the Static Web App with
  GitHub integration auto-added the secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN_ZEALOUS_TREE_091326110`, which the
  workflow references. (Azure also auto-committed its own workflow file;
  it was removed — ours handles the deploy with the API URL injected.)
- Secret `AZURE_CREDENTIALS` — JSON output of:
  ```bash
  az ad sp create-for-rbac --name marsad-deploy --role contributor \
    --scopes $(az group show -n marsad-rg --query id -o tsv) --json-auth
  ```
- Variable `API_BASE_URL` — `https://<fqdn-from-step-3>`

### 7. Custom domain (marsad.alqazzaaz.com)
At your DNS provider add: `CNAME  marsad  <marsad-frontend hostname>.azurestaticapps.net`
Then: `az staticwebapp hostname set -n marsad-frontend -g marsad-rg --hostname marsad.alqazzaaz.com`
(free managed TLS certificate is issued automatically). Finally, add
`https://marsad.alqazzaaz.com` to the Mapbox token's allowed URLs.

### 8. Ship it
Push to `main` (or re-run the workflow). CI runs, then CD deploys frontend
and backend. Done.

---

## Troubleshooting

- **Container App create fails with provisioning state 'Failed'**: almost
  always the startup probe — the placeholder image listens on port 80, so
  the app must be created with `--target-port 80` (see step 3). Recover:
  `az containerapp delete -n marsad-backend -g marsad-rg -y` and re-run the
  create command with port 80.
- **First deploy-backend job fails at rollout**: GHCR package is private —
  see step 5.
- **Backend 500s about database/redis**: check the secrets:
  `az containerapp secret list -n marsad-backend -g marsad-rg`.

## Keep-alive (optional, later)
`.github/workflows/keep-warm.yml` exists but its schedule is commented out.
Uncomment the `schedule:` block to ping `/api/health` every 10 minutes
during waking hours, trading a little free-tier quota for fewer cold starts.

## Notes
- **Cold starts**: with `minReplicas: 0`, the first request after idle takes
  a few seconds (container boot; Neon may add ~1s waking from its own idle).
- **Scale-out warning**: keep `maxReplicas: 1` until the AI worker gets a
  distributed job lock — multiple replicas would duplicate Claude calls.
- **Backups**: Neon free keeps short point-in-time history; export
  `country_insights` occasionally if you care about the generated corpus.
