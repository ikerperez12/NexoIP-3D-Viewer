# Contributor automation guide

These instructions apply to the entire repository, including AI-assisted changes.

## Project contract

- Use Node.js 24.12.0 or newer and install with `npm ci` from the committed lockfile.
- Keep the application offline and privacy-first. Do not add telemetry, accounts, remote assets, analytics, update services, or network APIs without an explicit reviewed product decision.
- Preserve Electron isolation: sandbox and context isolation stay enabled; renderer code receives no Node.js capability or native filesystem path.
- Keep filesystem authority in the main process behind opaque IDs, canonical-path containment, regular-file checks, per-resource budgets, and validated IPC/protocol requests.
- Selected library roots have no arbitrary global depth, folder, entry, or model-count cap. Discovery remains cancellable and progressively publishes only prechecked candidates through bounded catalog pages.
- Do not weaken startup-policy, CSP, fuse, KTX2-worker capability, dependency-review, signing, or release-evidence checks to make a test pass.

## Change discipline

- Keep runtime dependencies minimal. Prefer platform APIs and focused modules over broad frameworks.
- Use exact dependency versions. New fixtures must be redistributable, attributed, and SHA-256 pinned.
- Never commit local models, absolute user paths, tokens, certificates, signing material, generated release binaries, coverage output, or diagnostic logs.
- Treat `docs/PRODUCT_READINESS.md` as the stable-release contract. Do not describe the alpha as stable until every documented manual and automated gate has evidence for the exact artifact.
- Existing tags are immutable; never move or reuse `v1.0.0`.

## Required verification

- Run `npm run check` for source changes. It enforces lint, the V8 coverage floor, tests, production build, and dependency audit.
- Run `npm run test:smoke:ci` when Electron boundaries, packaging, loaders, scanning, shared formats, or packaged fixtures change.
- Run `npm run dist:win` followed by `npm run test:release-artifacts` for release-workflow or distributable changes on an appropriate Windows host.
- Report automated evidence separately from still-open manual Windows, accessibility, GPU, signing, and endurance gates.
