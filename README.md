# CloudEstimate

CloudEstimate is a static Astro utility for sizing self-managed enterprise workloads across Google Cloud, AWS, and Azure. It maps published reference architectures to concrete instance shapes, applies cached pricing snapshots, and renders shareable estimate pages without accounts or runtime pricing or AI calls.

Current roster (24 ISVs). Links point to the official product or documentation pages used as source material:

| ISV | Official site |
| --- | --- |
| [Apache Kafka via Confluent Platform](https://docs.confluent.io/platform/current/kafka/deployment.html) | Confluent docs |
| [CockroachDB Self-Hosted](https://www.cockroachlabs.com/docs/stable/recommended-production-settings) | Cockroach Labs docs |
| [Confluence Data Center](https://confluence.atlassian.com/security/confluence-data-center-infrastructure-recommendations-1409093099.html) | Atlassian docs |
| [Consul](https://developer.hashicorp.com/consul/docs/architecture) | HashiCorp docs |
| [Couchbase Server Enterprise](https://docs.couchbase.com/server/current/install/sizing-general.html) | Couchbase docs |
| [EDB Postgres Advanced Server](https://www.enterprisedb.com/docs/epas/latest/planning/planning_prerequisites/epas_requirements/) | EDB docs |
| [Elasticsearch OSS](https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html) | Elastic docs |
| [GitLab Self-Managed](https://archives.docs.gitlab.com/17.11/administration/reference_architectures/) | GitLab docs |
| [InfluxDB Enterprise](https://docs.influxdata.com/enterprise_influxdb/v1/guides/hardware_sizing/) | InfluxData docs |
| [JFrog Artifactory Self-Hosted](https://jfrog.com/reference-architecture/self-managed/deployment/sizing/) | JFrog docs |
| [Jira Data Center](https://confluence.atlassian.com/security/infrastructure-recommendations-for-enterprise-jira-instances-on-aws-1409092894.html) | Atlassian docs |
| [Keycloak](https://www.keycloak.org/high-availability/single-cluster/concepts-memory-and-cpu-sizing) | Keycloak docs |
| [Kong Gateway](https://developer.konghq.com/gateway/resource-sizing-guidelines/) | Kong docs |
| [MinIO](https://min.io/docs/minio/linux/operations/installation.html) | MinIO docs |
| [MongoDB Enterprise Advanced](https://www.mongodb.com/docs/manual/administration/production-notes/) | MongoDB docs |
| [Neo4j Enterprise](https://neo4j.com/docs/operations-manual/current/clustering/clustering-advanced/) | Neo4j docs |
| [Nomad](https://developer.hashicorp.com/nomad/docs/install/production) | HashiCorp docs |
| [OpenSearch](https://docs.opensearch.org/docs/2.17/tuning-your-cluster/) | OpenSearch docs |
| [Redpanda Self-Managed](https://docs.redpanda.com/current/deploy/redpanda/manual/production/requirements/) | Redpanda docs |
| [Redis Enterprise](https://redis.io/docs/latest/operate/rs/7.22/installing-upgrading/install/plan-deployment/hardware-requirements/) | Redis docs |
| [Sonatype Nexus Repository](https://help.sonatype.com/en/sonatype-nexus-repository-reference-architectures.html) | Sonatype docs |
| [Teleport Self-Hosted](https://goteleport.com/docs/reference/deployment/scaling/) | Teleport docs |
| [VictoriaMetrics](https://docs.victoriametrics.com/cluster-victoriametrics/) | VictoriaMetrics docs |
| [YugabyteDB Self-Hosted](https://docs.yugabyte.com/stable/deploy/checklist/) | Yugabyte docs |

## What is in this repo

- Static Astro site for estimate, comparison, share, and policy pages
- Schema-validated ISV catalog in `src/content/isvs/`
- Shared sizing and Terraform generation logic in `shared/`
- Firebase Hosting and Cloud Functions deploy wiring
- Build-time pricing and explanation cache fetch pipeline

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

This repo intentionally avoids hardcoded production IDs.

Copy `.env.example` to `.env` if you want to test canonical URLs, analytics tags, Search Console verification, or remote cache downloads.

Available local env vars:
- `PUBLIC_SITE_URL`
- `PUBLIC_GA4_MEASUREMENT_ID`
- `PUBLIC_GOOGLE_SITE_VERIFICATION`
- `CLOUDESTIMATE_CACHE_BUCKET`

In GitHub Actions, public configuration belongs in repository or environment variables. Secrets such as `GCP_SA_KEY` belong in GitHub Actions Secrets.

## Quality checks

```bash
npm run validate:isvs
npm run lint
npm run test
npm run check:functions
npm run validate:terraform -- --mode=generate-only
npm run build
```

If Terraform is installed locally, run the full gate with:

```bash
npm run validate:terraform
```

## Contributing and security

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security reporting: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- License: [LICENSE](LICENSE)
