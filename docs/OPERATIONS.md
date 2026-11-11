# CloudEstimate — Operations

This document covers the non-product wiring around Firebase Hosting, scheduled snapshot refreshes, analytics, and launch checks.

## Secrets — where everything lives

A single reference table to avoid ambiguity:

| Secret / config | Value type | Where it lives | Used by |
|---|---|---|---|
| `GCP_SA_KEY` | Sensitive | GitHub Actions Secrets | CI deploy + scheduled snapshot workflows |
| `CLOUDESTIMATE_GITHUB_TOKEN` | Sensitive | Cloud Secret Manager | Legacy `triggerRebuild` function at runtime |
| `CLOUDESTIMATE_REBUILD_TOKEN` | Sensitive (optional) | Function env / Secret | Optional shared bearer secret checked by `triggerRebuild` |
| `CLOUDESTIMATE_CACHE_BUCKET` | Non-sensitive | Function env var | Legacy Functions/GCS cache path |
| `GCLOUD_PROJECT` | Non-sensitive | Platform-provided runtime env var | Functions |
| `CLOUDESTIMATE_GCP_LOCATION` | Non-sensitive | Function env var | Functions |
| `CLOUDESTIMATE_VERTEX_MODEL` | Non-sensitive | Function env var or GH Actions Variable | Legacy Functions + explanation snapshot workflow |
| `CLOUDESTIMATE_EXPLANATION_LIMIT` | Non-sensitive | GH Actions Variable | Explanation snapshot workflow |
| `CLOUDESTIMATE_EXPLANATION_TIME_BUDGET_MS` | Non-sensitive | GH Actions Variable | Explanation snapshot workflow |
| `CLOUDESTIMATE_EXPLANATION_CONCURRENCY` | Non-sensitive | GH Actions Variable | Explanation snapshot script |
| `CLOUDESTIMATE_GITHUB_OWNER` | Non-sensitive | Function env var | Legacy Functions rebuild dispatch |
| `CLOUDESTIMATE_GITHUB_REPO` | Non-sensitive | Function env var | Legacy Functions rebuild dispatch |
| `PUBLIC_SITE_URL` | Non-sensitive | GH Actions Variable + `.env` | CI build + local dev |
| `PUBLIC_GA4_MEASUREMENT_ID` | Non-sensitive | GH Actions Variable + `.env` | CI build + local dev |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | Non-sensitive | GH Actions Variable + `.env` | CI build + local dev |
| `CLOUDESTIMATE_GCP_PROJECT_ID` | Non-sensitive | GH Actions Variable | CI pipeline |

Enable the Cloud Billing API on the Google Cloud project referenced by `CLOUDESTIMATE_GCP_PROJECT_ID` before the scheduled pricing workflow runs:

```bash
gcloud services enable cloudbilling.googleapis.com --project=$CLOUDESTIMATE_GCP_PROJECT_ID
```

Enable the Secret Manager API as well if the legacy Cloud Functions rebuild-dispatch path is deployed:

```bash
gcloud services enable secretmanager.googleapis.com --project=$CLOUDESTIMATE_GCP_PROJECT_ID
```

## Firebase Project

- Firebase project: configured via GitHub Actions variable `CLOUDESTIMATE_GCP_PROJECT_ID`
- Hosting config: [`firebase.json`](../firebase.json) (`nodejs22` Functions runtime)
- GitHub Actions deploy workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
- Active deploy target: Firebase Hosting only. Cloud Functions files remain in the repo for the optional private `triggerRebuild` endpoint.

## GitHub Actions Variables

The deploy workflow expects these repository or environment variables:

- `CLOUDESTIMATE_GCP_PROJECT_ID`
  Firebase / Google Cloud project ID used for auth, Terraform plan, and deploy.
- `PUBLIC_SITE_URL`
  Canonical production URL used for Astro `site`, canonical tags, JSON-LD, `/llms.txt`, `/api/v1/*`, and share redirects.
- `PUBLIC_GA4_MEASUREMENT_ID`
  Enables the GA4 tag in [`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro).
- `PUBLIC_GOOGLE_SITE_VERIFICATION`
  Adds the Search Console verification meta tag in [`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro).

The scheduled snapshot workflow (`.github/workflows/refresh-snapshots.yml`) also accepts:

- `CLOUDESTIMATE_GCP_LOCATION`
  Vertex AI location; defaults to `global`.
- `CLOUDESTIMATE_VERTEX_MODEL`
  Vertex model; defaults to `gemini-3.5-flash-lite` (can be overridden to `gemini-3.8-flash` if desired).
- `CLOUDESTIMATE_EXPLANATION_LIMIT`
  Optional maximum new explanations to add per scheduled run. If unset, the script regenerates all missing or hash-invalidated keys within the time budget.
- `CLOUDESTIMATE_EXPLANATION_TIME_BUDGET_MS`
  Time budget for the generation loop; defaults to `3900000` ms.
- `CLOUDESTIMATE_EXPLANATION_CONCURRENCY`
  Concurrent Vertex requests for the snapshot script; defaults to `24`.

## Cloud Functions Environment

`triggerRebuild` in [`functions/index.mjs`](../functions/index.mjs) is configured with `{ invoker: "private" }`, restricts HTTP methods to `POST`, and optionally verifies a constant-time `Authorization: Bearer <CLOUDESTIMATE_REBUILD_TOKEN>` header before dispatching a GitHub rebuild.

### Plain environment variables (set on the function config)

- `CLOUDESTIMATE_CACHE_BUCKET`
- `GCLOUD_PROJECT` (platform-provided)
- `CLOUDESTIMATE_GCP_LOCATION` (defaults to `global`)
- `CLOUDESTIMATE_VERTEX_MODEL` (defaults to `gemini-3.5-flash-lite`)
- `CLOUDESTIMATE_GITHUB_OWNER`
- `CLOUDESTIMATE_GITHUB_REPO`

### Sensitive secrets (Cloud Secret Manager)

`CLOUDESTIMATE_GITHUB_TOKEN` is a fine-grained GitHub PAT used by `triggerRebuild` to call the GitHub `repository_dispatch` API. Store it in Cloud Secret Manager and grant `roles/secretmanager.secretAccessor` to the Cloud Functions service account.

## Terraform Quality Gate

Run the multi-cloud Terraform / OpenTofu gate with:

```bash
npm run validate:terraform
```

Modes:

- `npm run validate:terraform -- --mode=validate`
  Runs `terraform init` (using a shared `TF_PLUGIN_CACHE_DIR`) and `terraform validate` across generated Google Cloud, AWS, and Azure XS, M, and XL baselines.
- `npm run validate:terraform -- --mode=plan`
  Also runs `terraform plan` on Google Cloud baselines after authentication.
- `npm run validate:terraform -- --mode=generate-only`
  Generates all multi-cloud cases without invoking the Terraform CLI.

Implementation: [`scripts/validate-terraform.mjs`](../scripts/validate-terraform.mjs)

## Scheduled Snapshot Flow

1. [`.github/workflows/refresh-snapshots.yml`](../.github/workflows/refresh-snapshots.yml) runs daily (`0 2 * * *`) and can be started manually via `workflow_dispatch`.
2. It authenticates with `GCP_SA_KEY`, fetches live pricing across 12 global regions (4 per cloud) from the Google Cloud Billing Catalog API, AWS public EC2/EBS/S3 offer files, and the Azure Retail Prices API, and writes normalized snapshots to `src/data/generated/pricing/*.json`.
3. Next, it runs `npm run regenerate:explanations:snapshot`, computing a SHA-256 `prompt_hash` per estimate tuple, pruning orphaned keys, and regenerating any missing or stale explanations in `src/data/generated/explanations/{single,compare}.json`.
4. If snapshots changed, the workflow commits the updated artifacts back to `main` and explicitly dispatches `deploy.yml` so Firebase Hosting serves the refreshed static build.
5. [`.github/workflows/check-snapshot-freshness.yml`](../.github/workflows/check-snapshot-freshness.yml) verifies daily that committed snapshots are under 48 hours old and files a GitHub issue on staleness or failure.
