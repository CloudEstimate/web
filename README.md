# CloudEstimate

CloudEstimate is a static Astro utility for sizing self-managed enterprise workloads across Google Cloud, AWS, and Azure. It maps published reference architectures to concrete instance shapes, applies cached pricing snapshots, and renders shareable estimate pages without accounts or runtime API calls.

The current implementation includes GitLab Self-Managed, Redis Enterprise, JFrog Artifactory Self-Hosted, Sonatype Nexus Repository, Jira Data Center, and Confluence Data Center, along with a comparison view across all three clouds, schema-validated YAML content, and the supporting pages defined in the product specification.

- Production URL: configured via `PUBLIC_SITE_URL`
- Build spec: [.github/docs/SPEC.md](.github/docs/SPEC.md)
- Brand spec: [.github/docs/BRAND.md](.github/docs/BRAND.md)
- Operations guide: [.github/docs/OPERATIONS.md](.github/docs/OPERATIONS.md)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- About the project: `/about`

## Local development

```bash
npm install
npm run validate:isvs
npm run dev
```

Copy [`.env.example`](.env.example) to a local env file if you want to test canonical URLs, GA4/Search Console tags, or pull remote build caches.

## Quality checks

```bash
npm run validate:isvs
npm run lint
npm run test
npm run validate:terraform -- --mode=generate-only
npm run build
```

If Terraform is installed locally, run `npm run validate:terraform` for the full GCP XS/M/XL export gate.
