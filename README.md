# CloudEstimate

CloudEstimate is a static Astro utility for sizing self-managed enterprise workloads across Google Cloud, AWS, and Azure. It maps published reference architectures to concrete instance shapes, applies cached pricing snapshots, and renders shareable estimate pages without accounts or runtime pricing or AI calls.

Current roster:
- GitLab Self-Managed
- Redis Enterprise
- JFrog Artifactory Self-Hosted
- Sonatype Nexus Repository
- Jira Data Center
- Confluence Data Center

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
