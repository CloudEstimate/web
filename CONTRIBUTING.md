# Contributing

CloudEstimate is maintained in spare time. Contributions are welcome, but every change is reviewed before publishing.

## Local Setup

1. Check out the repository and install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```

## Adding an ISV

1. Add a YAML file in `src/content/isvs/`.
2. Make sure the filename matches the `slug`.
3. Validate it against the JSON Schema in `src/schemas/isv.schema.json`.
4. Include a public, versioned reference architecture source and retrieval date.
5. Update any pricing, explanation, or changelog content needed for the new coverage.

Run:

```bash
npm run validate:isvs
```

The validator is the build gate. A YAML file that fails schema validation fails the build.

## Pull requests

- Keep scope tight.
- Cite sources for any new or changed ISV sizing data.
- Do not add out-of-scope product features without discussion.
- Expect spare-time review cadence rather than same-day turnaround.

## Source of truth

The ISV YAML schema defined in `.github/docs/SPEC.md` section 4.1 and implemented in `src/schemas/isv.schema.json` is the source of truth for all ISV content.
