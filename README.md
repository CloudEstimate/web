# CloudEstimate

CloudEstimate is a static Astro utility for sizing self-managed enterprise and open-source workloads across Google Cloud, AWS, and Azure, and a worked example of the [Precomputed AI](https://precomputedai.com) design pattern. It maps published reference architectures to current-generation instance shapes, applies cached pricing snapshots across 12 global regions, generates multi-cloud Terraform / OpenTofu baselines, and renders shareable estimate pages without accounts or runtime pricing or AI calls.

Precomputed AI citation: Raquedan, R. (2026). *Precomputed AI: Reason Ahead of Time, Serve Instantly.* https://precomputedai.com

Current roster (34 ISVs). Links point to the official product or documentation pages used as source material:

| ISV | Official site |
| --- | --- |
| [Apache Kafka via Confluent Platform](https://docs.confluent.io/platform/current/kafka/deployment.html) | Confluent docs |
| [ClickHouse Self-Managed](https://clickhouse.com/docs/en/Manage/sizing-and-hardware-recommendations) | ClickHouse docs |
| [CockroachDB Self-Hosted](https://www.cockroachlabs.com/docs/stable/recommended-production-settings) | Cockroach Labs docs |
| [Confluence Data Center](https://confluence.atlassian.com/enterprise/confluence-data-center-load-profiles-946603546.html) | Atlassian docs |
| [Consul](https://developer.hashicorp.com/consul/docs/architecture) | HashiCorp docs |
| [Couchbase Server Enterprise](https://docs.couchbase.com/server/current/install/sizing-general.html) | Couchbase docs |
| [EDB Postgres Advanced Server](https://www.enterprisedb.com/docs/epas/latest/planning/planning_prerequisites/epas_requirements/) | EDB docs |
| [Elasticsearch (AGPL / Self-Managed)](https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html) | Elastic docs |
| [GitLab Self-Managed](https://docs.gitlab.com/administration/reference_architectures/) | GitLab docs |
| [Grafana LGTM Observability Stack](https://grafana.com/docs/mimir/latest/manage/plan-and-size/) | Grafana Labs docs |
| [Harbor Registry](https://goharbor.io/docs/latest/install-config/installation-prereqs/) | Harbor docs |
| [HashiCorp Vault Enterprise](https://developer.hashicorp.com/vault/tutorials/day-one-raft/raft-reference-architecture) | HashiCorp docs |
| [InfluxDB Enterprise](https://docs.influxdata.com/enterprise_influxdb/v1/guides/hardware_sizing/) | InfluxData docs |
| [JFrog Artifactory Self-Hosted](https://jfrog.com/reference-architecture/self-managed/deployment/sizing/) | JFrog docs |
| [Jira Data Center](https://confluence.atlassian.com/enterprise/jira-data-center-size-profiles-955171062.html) | Atlassian docs |
| [Keycloak](https://www.keycloak.org/high-availability/single-cluster/concepts-memory-and-cpu-sizing) | Keycloak docs |
| [Kong Gateway](https://developer.konghq.com/gateway/resource-sizing-guidelines/) | Kong docs |
| [Mattermost Enterprise](https://docs.mattermost.com/deploy/scaling-for-enterprise.html) | Mattermost docs |
| [MinIO Object Storage](https://min.io/docs/minio/linux/operations/installation.html) | MinIO docs |
| [MongoDB Enterprise Advanced](https://www.mongodb.com/docs/manual/administration/production-notes/) | MongoDB docs |
| [Neo4j Enterprise](https://neo4j.com/docs/operations-manual/current/clustering/clustering-advanced/) | Neo4j docs |
| [Nomad](https://developer.hashicorp.com/nomad/docs/install/production) | HashiCorp docs |
| [OpenSearch](https://docs.opensearch.org/docs/latest/tuning-your-cluster/) | OpenSearch docs |
| [Qdrant Self-Managed](https://qdrant.tech/documentation/guides/capacity-planning/) | Qdrant docs |
| [Redis Software / Enterprise](https://redis.io/docs/latest/operate/rs/installing-upgrading/install/plan-deployment/hardware-requirements/) | Redis docs |
| [Redpanda Self-Managed](https://docs.redpanda.com/current/deploy/redpanda/manual/production/requirements/) | Redpanda docs |
| [SeaweedFS Object Store](https://github.com/seaweedfs/seaweedfs/wiki/Production-Setup) | SeaweedFS docs |
| [Sonatype Nexus Repository](https://help.sonatype.com/en/sonatype-nexus-repository-reference-architectures.html) | Sonatype docs |
| [Teleport Self-Hosted](https://goteleport.com/docs/reference/deployment/scaling/) | Teleport docs |
| [Temporal Self-Hosted](https://docs.temporal.io/self-hosted-guide/production-checklist) | Temporal docs |
| [Valkey](https://valkey.io/topics/cluster-tutorial/) | Valkey docs |
| [VictoriaMetrics](https://docs.victoriametrics.com/cluster-victoriametrics/) | VictoriaMetrics docs |
| [vLLM Inference Server](https://docs.vllm.ai/en/latest/serving/distributed_serving.html) | vLLM docs |
| [YugabyteDB Self-Hosted](https://docs.yugabyte.com/stable/deploy/checklist/) | Yugabyte docs |

## What is in this repo

- Static Astro site for estimate, comparison, share, static JSON API (`/api/v1/*`), `/llms.txt`, and policy pages
- Schema-validated ISV catalog in `src/content/isvs/`
- Shared sizing, Arm64 comparison, and multi-cloud Terraform / OpenTofu generation logic in `shared/`
- Firebase Hosting deploy wiring (`nodejs22`)
- Build-time generated pricing (12 global regions) and prompt-hashed explanation cache pipeline

## Getting started

```bash
npm install
npm install --prefix functions
npm run validate:isvs
npm run dev
```

If you are working on Functions or shared generated data, run:

```bash
npm run sync:functions-data
```

## Local configuration

This repo intentionally avoids hardcoded production IDs, except for the public production URL fallback used by GitHub Actions when `PUBLIC_SITE_URL` is not configured.

Copy `.env.example` to `.env` if you want to test canonical URLs, analytics tags, Search Console verification, or remote cache downloads.

Available local env vars:
- `PUBLIC_SITE_URL`
- `PUBLIC_GA4_MEASUREMENT_ID`
- `PUBLIC_GOOGLE_SITE_VERIFICATION`
- `CLOUDESTIMATE_CACHE_BUCKET`

`PUBLIC_SITE_URL` is required for production builds so canonical URLs, robots output, and the sitemap point at the real site. In local dev, the app falls back to `http://localhost:4321` if it is not set.

In GitHub Actions, public configuration belongs in repository or environment variables. Secrets such as `GCP_SA_KEY` belong in GitHub Actions Secrets.

The `functions/` directory retains a hardened private `triggerRebuild` HTTP function and shared library code. Scheduled pricing and explanation refreshes run in GitHub Actions. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the current pipeline.

## Scheduled data refresh architecture

Pricing and explanation caches are refreshed in GitHub Actions and committed into `src/data/generated/**`. The build reads those committed JSON files and `npm run build` first runs `npm run ensure:caches` so local builds have seeded fallback cache files when generated files are missing.

- Daily pricing and explanation snapshot: `.github/workflows/refresh-snapshots.yml` (runs the pricing refresh across 12 regions, then prompt-hashed explanation regeneration, then a single commit)
- Daily freshness check: `.github/workflows/check-snapshot-freshness.yml` (files a GitHub issue if the committed snapshot is older than 48 hours)

The pricing step calls the Google Cloud Billing Catalog API first, then public AWS and Azure pricing APIs. The Google Cloud project used by `GCP_SA_KEY` / `CLOUDESTIMATE_GCP_PROJECT_ID` must have `cloudbilling.googleapis.com` enabled.

The explanation step uses Vertex AI through `@google/genai`. The workflow default model is `gemini-3.5-flash-lite`; override it with `CLOUDESTIMATE_VERTEX_MODEL` (for example `gemini-3.8-flash`) when needed.

Manual local equivalents:

```bash
npm run refresh:pricing:snapshot
npm run regenerate:explanations:snapshot
```

### GitHub Actions variables for the snapshot architecture

Required repository variables:

- `CLOUDESTIMATE_GCP_PROJECT_ID` (used by deploy, pricing refresh, and explanation regeneration)
- `PUBLIC_SITE_URL` (recommended for canonical production build output)

Optional repository variables:

- `CLOUDESTIMATE_GCP_LOCATION` (defaults to `global`)
- `CLOUDESTIMATE_VERTEX_MODEL` (defaults to `gemini-3.5-flash-lite` in the GitHub Actions workflow)
- `CLOUDESTIMATE_EXPLANATION_LIMIT` (optional cap on new explanations per run; unset means no count cap)
- `CLOUDESTIMATE_EXPLANATION_TIME_BUDGET_MS` (defaults to `3900000`, just under 65 minutes)
- `CLOUDESTIMATE_EXPLANATION_CONCURRENCY` (defaults to `24`)
- `PUBLIC_GA4_MEASUREMENT_ID`
- `PUBLIC_GOOGLE_SITE_VERIFICATION`

Required repository secrets:

- `GCP_SA_KEY` (used by deploy and scheduled snapshot workflows for Google auth)

## Quality checks

```bash
npm run sync:functions-data
npm run validate:isvs
npm run lint
npm run test
npm run check:functions
npm run validate:terraform -- --mode=generate-only
npm run build
```

If Terraform is installed locally, run the full gate across Google Cloud, AWS, and Azure with:

```bash
npm run validate:terraform
```

## Contributing and security

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Operations guide: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- Security reporting: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- License: [LICENSE](LICENSE)
