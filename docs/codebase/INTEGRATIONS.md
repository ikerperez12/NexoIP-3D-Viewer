# External Integrations

## 1) Integration Inventory

| System | Type | Purpose | Auth model | Criticality | Evidence |
| --- | --- | --- | --- | --- | --- |
| Windows native file dialog | OS capability | Explicitly approve folders for indexing | Local interactive user | High | `electron/main.js:153-162` |
| Windows Explorer | OS shell capability | Reveal an already registered model | Opaque ID validated in main | Low | `electron/main.js:169-182` |
| Local filesystem | OS data source | Read approved models and sidecars | User approval plus path/identity checks | High | `electron/file-scanner.js:242-396` |
| Static Basis worker | Local packaged worker | Transcode KTX2/Basis textures without relaxing renderer CSP | Fixed same-origin URL, no bridge, no network | Medium | `src/utils/ktx2-static-worker.js`, `public/basis/ktx2-transcoder-worker.js`, `electron/security.js` |
| Loopback Vite server | Development-only HTTP | Serve renderer during `npm run dev` | Exact `127.0.0.1:3000` allowlist | Low | `package.json:25`, `electron/security.js:185-219` |
| npm registry | Build-time package source | Reproduce dependencies from lockfile | npm client / public packages | High | `package-lock.json`, `.github/workflows/ci.yml:31-32` |
| GitHub Actions and Releases | Build-time CI/publication | Checks, CodeQL, artifacts, SBOM and provenance | Minimal `GITHUB_TOKEN`, OIDC for attestations | High | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |
| Official Electron GitHub release | Release-time baseline | Verify packaged Electron PE files against the official archive | Public HTTPS plus official SHA-256 file | High | `.github/workflows/release.yml:115-141` |

The packaged application itself has no remote API, account, telemetry, analytics, update beacon or embedded HTTP server (`README.md:62-68`, `SECURITY.md:26-36`).

## 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
| --- | --- | --- | --- | --- |
| In-memory `Map` registry | Current-session model catalog and private paths | `FileScanner` | Catalog is intentionally lost at exit; grows with user-selected roots while each asset remains subject to validation and per-file safety policy | `electron/file-scanner.js`, `electron/security.js` |
| User-selected model files | Read-only model and sidecar bytes | Verified file descriptors and private protocol | Hostile parser input or later file replacement | `electron/file-scanner.js:328-396` |
| Temporary smoke directories | Capability config, profiles and diagnostic reports | Test scripts and packaged self-test | Residue if a host/installer fails unexpectedly | `scripts/packaged-smoke.mjs:91-185`, `scripts/release-artifact-smoke.mjs:658-788` |

No database, cache service, browser storage catalog or cloud synchronization is used.

## 3) Secrets and Credentials Handling

- Runtime credential sources: none.
- Stable signing uses `CSC_LINK` and `CSC_KEY_PASSWORD` only in the protected `production-signing` build step; the expected certificate subject is a protected environment variable. The subject is exported only after signature verification so the release notes can state the exact expected public identity.
- The attestation job has OIDC and attestation permissions but cannot write releases. The later publish job has only `contents: write`, consumes verified artifacts, and independently downloads the reserved draft assets to check their names, sizes, and SHA-256 values before publication.
- GitHub checkout disables persisted credentials in CI and release builds.
- Hardcoding checks: Gitleaks and GitHub secret scanning are external gates; repository policy also forbids certificates, `.env` files and credentials (`CONTRIBUTING.md:27`).
- [TODO] Certificate owner, rotation procedure and recovery contact remain undefined until a signing provider is selected.

## 4) Reliability and Failure Behavior

- Runtime file operations fail closed and expose generic messages across IPC.
- Scans and primary model reads support cancellation. Selected roots have no global depth, directory, entry or model-count cap; structural validation, path containment, per-file size and decoded-resource limits remain explicit.
- Smoke harnesses use bounded polling, process timeouts, guarded cleanup and a ten-scenario representative format matrix (`scripts/packaged-smoke.mjs`, `scripts/release-artifact-smoke.mjs`, `scripts/packaged-fixture-matrix.mjs`).
- The stable release workflow verifies source/tag identity twice, verifies every uploaded draft asset before publishing, and removes only its own unpublished draft after failure.
- GitHub/Electron release downloads do not implement application-level retry or backoff; workflow reruns are the recovery mechanism.

## 5) Observability for Integrations

- Runtime: local UI errors and startup stderr only; no remote logs by design.
- Packaged checks: JSON reports, captured bounded stdout/stderr, GitHub step summaries and failure-only diagnostic artifacts.
- Release: signature, PE inventory, hashes, SBOM and attestations are recorded as artifacts and summaries.
- Missing visibility gap: privacy constraints mean real-user crash/GPU telemetry is unavailable; reproducible private bug reports and explicit diagnostics are required instead.

## 6) Evidence

- `electron/main.js`
- `electron/file-scanner.js`
- `scripts/packaged-smoke.mjs`
- `scripts/release-artifact-smoke.mjs`
- `.github/workflows/release.yml`
- `SECURITY.md`
