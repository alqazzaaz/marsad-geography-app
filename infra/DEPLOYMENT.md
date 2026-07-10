# Marsad â€” Deployment Guide & Configuration Registry

Production architecture (all free tiers):

| Layer | Service | Config lives in |
|---|---|---|
| Frontend | Azure Static Web Apps (`marsad-frontend`) â†’ `marsad.alqazzaaz.com` | GitHub Actions (build-time `API_BASE_URL`) |
| Backend | Azure Container Apps (`marsad-backend`, germanywestcentral) | `infra/containerapp.yaml` + CA secrets |
| Database | Neon serverless PostgreSQL | CA secret `database-url` |
| Cache/queue | Upstash Redis | CA secret `redis-url` |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) | GitHub secrets & variables |

Local development is untouched: `docker compose up` runs local Postgres +
Redis; the same codebase switches to Neon/Upstash purely via env vars.

---

## Configuration registry â€” every value, where it lives, how to change it

| Value | Lives in | Change with |
|---|---|---|
| `minReplicas` / `maxReplicas` | `infra/containerapp.yaml` | edit + `az containerapp update -n marsad-backend -g marsad-rg --yaml infra/containerapp.yaml` |
| `DATABASE_URL` (Neon) | CA secret `database-url` | `az containerapp secret set -n marsad-backend -g marsad-rg --secrets database-url="<neon-url>"` then restart revision |
| `REDIS_URL` (Upstash) | CA secret `redis-url` | same pattern, `redis-url="rediss://..."` |
| `ANTHROPIC_API_KEY` | CA secret `anthropic-api-key` | same pattern |
| `MAPBOX_ACCESS_TOKEN` | CA secret `mapbox-access-token` | same pattern |
| `JWT_SECRET_KEY` | CA secret `jwt-secret-key` | same pattern (generate: `openssl rand -hex 48`) |
| `SENTRY_DSN` | CA secret `sentry-dsn` | same pattern (empty string disables Sentry) |
| `CORS_ORIGINS`, worldview vars, `ENVIRONMENT` | `infra/containerapp.yaml` (plain env) | edit + re-apply YAML |
| `API_BASE_URL` (backend public URL) | GitHub **variable** | repo â†’ Settings â†’ Secrets and variables â†’ Actions â†’ Variables |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | GitHub **secret** | SWA â†’ Overview â†’ Manage deployment token |
| `AZURE_CREDENTIALS` | GitHub **secret** | output of the service-principal command below |
| Daily AI budget / rate limits / model | `infra/containerapp.yaml` env (add `CLAUDE_DAILY_BUDGET_USD` etc. as needed â€” see `backend/app/core/config.py` for all names) | edit + re-apply YAML |

---

## One-time setup (about 30 minutes)

### 0. Accounts
[Azure](https://azure.microsoft.com/free) Â· [Neon](https://neon.tech) Â·
[Upstash](https://upstash.com) â€” all free tiers.

### 1. Neon
Create a project (region: EU/Frankfurt) â†’ copy the **pooled** connection
string (`postgresql://...@...neon.tech/neondb?sslmode=require`).

### 2. Upstash
Create a Redis database (region: eu-central-1) â†’ copy the **rediss://** URL
(TLS, from the "Redis connect" tab).

### 3. Azure resources
```bash
az login
az group create -n marsad-rg -l germanywestcentral

# Container Apps environment + app (placeholder image until first CD run)
az extension add --name containerapp
az containerapp env create -n marsad-env -g marsad-rg -l germanywestcentral
az containerapp create -n marsad-backend -g marsad-rg --environment marsad-env \
  --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 8000

# Secrets (paste real values)
az containerapp secret set -n marsad-backend -g marsad-rg --secrets \
  database-url="<NEON_URL>" \
  redis-url="<UPSTASH_REDISS_URL>" \
  anthropic-api-key="<KEY>" \
  mapbox-access-token="<TOKEN>" \
  jwt-secret-key="$(openssl rand -hex 48)" \
  sentry-dsn="<DSN or empty>"

# Apply the spec (image will 404 until the first CD push â€” that's fine)
az containerapp update -n marsad-backend -g marsad-rg --yaml infra/containerapp.yaml

# Note the backend URL for the API_BASE_URL GitHub variable:
az containerapp show -n marsad-backend -g marsad-rg --query properties.configuration.ingress.fqdn -o tsv
```

### 4. Static Web App
```bash
az staticwebapp create -n marsad-frontend -g marsad-rg -l westeurope --sku Free
az staticwebapp secrets list -n marsad-frontend -g marsad-rg --query properties.apiKey -o tsv
```
(SWA free isn't offered in germanywestcentral; westeurope is the nearest â€”
it's a global CDN anyway.)

### 5. GHCR pull access
After the first CD run publishes `ghcr.io/alqazzaaz/marsad-backend`, open the
package on GitHub (Profile â†’ Packages) â†’ Package settings â†’ set visibility
**Public** so Container Apps can pull it without credentials.

### 6. GitHub repo settings (Settings â†’ Secrets and variables â†’ Actions)
- Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` â€” from step 4
- Secret `AZURE_CREDENTIALS` â€” JSON output of:
  ```bash
  az ad sp create-for-rbac --name marsad-deploy --role contributor \
    --scopes $(az group show -n marsad-rg --query id -o tsv) --json-auth
  ```
- Variable `API_BASE_URL` â€” `https://<fqdn-from-step-3>`

### 7. Custom domain (marsad.alqazzaaz.com)
At your DNS provider add: `CNAME  marsad  <marsad-frontend hostname>.azurestaticapps.net`
Then: `az staticwebapp hostname set -n marsad-frontend -g marsad-rg --hostname marsad.alqazzaaz.com`
(free managed TLS certificate is issued automatically). Finally, add
`https://marsad.alqazzaaz.com` to the Mapbox token's allowed URLs.

### 8. Ship it
Push to `main` (or re-run the workflow). CI runs, then CD deploys frontend
and backend. Done.

---

## Keep-alive (optional, later)
`.github/workflows/keep-warm.yml` exists but its schedule is commented out.
Uncomment the `schedule:` block to ping `/api/health` every 10 minutes
during waking hours, trading a little free-tier quota for fewer cold starts.

## Notes
- **Cold starts**: with `minReplicas: 0`, the first request after idle takes
  a few seconds (container boot; Neon may add ~1s waking from its own idle).
- **Scale-out warning**: keep `maxReplicas: 1` until the AI worker gets a
  distributed job lock â€” multiple replicas would duplicate Claude calls.
- **Backups**: Neon free keeps short point-in-time history; export
  `country_insights` occasionally if you care about the generated corpus.
