# Contributing

CloudEstimate is maintained in spare time. Contributions are welcome, but every change is reviewed before publishing.

## Before you start

- Keep scope tight.
- Use public, versioned sources for any sizing or pricing-related change.
- Open an issue before starting a large feature, a new integration, or a broad refactor.
- Do not introduce hardcoded production IDs, secrets, or environment-specific values.

## Local setup

```bash
npm install
npm install --prefix functions
npm run validate:isvs
npm run dev
```

If you touch Functions, generated runtime data, or shared sizing logic, also run:

```bash
npm run sync:functions-data
```

## Adding or updating an ISV

1. Add or edit the YAML file in `src/content/isvs/`.
2. Keep the filename aligned with the `slug`.
3. Cite a public reference architecture source and retrieval date.
4. Keep notes and disclaimers honest about what is and is not modelled.
5. Run the schema validator:

```bash
npm run validate:isvs
```

The schema in `src/schemas/isv.schema.json` is the source of truth for ISV content. A YAML file that fails validation fails the build.

## Pull requests

Before opening a PR, run the checks that match your change:

```bash
npm run validate:isvs
npm run lint
npm run test
npm run check:functions
npm run validate:terraform -- --mode=generate-only
```

PRs should:
- explain the user-visible change clearly
- cite sources for new or changed sizing data
- include tests when behaviour changes
- avoid unrelated cleanup in the same branch

## Review expectations

- Review is best-effort, not same-day.
- The owner is required on all PRs via `CODEOWNERS`.
- Contributions may be declined if they add product scope the project is not ready to support.
