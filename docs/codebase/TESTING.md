# Testing Patterns

## 1) Test Stack and Commands

- Primary framework: Vitest 4.1.11 in a Node environment.
- Assertions/mocking: Vitest `expect`, `vi.fn`, spies, injected filesystem functions and temporary directories.
- Packaged wrapper: Playwright 1.62.1 launches the no-CDP smoke command; the product self-test runs through a bounded local capability rather than a debugging transport.

```powershell
npm test
npm run test:coverage
npm run check
npm run test:smoke:ci
npm run test:e2e
npm run dist:win
npm run test:release-artifacts
```

## 2) Test Layout

- Unit and integration suites: `tests/**/*.test.{js,jsx}` selected by `vite.config.mjs:38`.
- Packaged E2E wrapper: `tests/e2e/packaged-app.spec.mjs` selected by `playwright.config.mjs:4`.
- Fixtures: `tests/fixtures/`, with provenance and SHA-256 manifests beside the format corpus.
- No global setup file is configured. Suites create and clean their own temporary state.

## 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
| --- | --- | --- | --- |
| Unit | Yes | URL/path validation, camera helpers, budgets, UI helpers | Runs in Vitest Node environment |
| Integration | Yes | FileScanner with real temp files, real Three.js loaders, GLB/STL/OBJ export round trips, release-script cleanup | Some browser primitives are mocked for Node |
| Packaged smoke | Yes, targeted | Real Electron executable, fuses, local origin, preload, protocol, runtime files, 900x600/200% invariants, ten real format loads, six pre-publication hostile rejections, one recoverable missing-dependency rejection, controlled stale-load cancellation and WebGL recovery | Covers a representative GLB, glTF, OBJ, STL, FBX, PLY and DAE path plus Meshopt, Draco and KTX2; not full format-fidelity, WCAG or constrained-GPU certification |
| Installer/portable | Yes, guarded host | NSIS install, capability test, uninstall and portable | Not a clean Windows profile matrix |
| Full WCAG / GPU endurance | No | Assistive technology, Windows scaling and repeated GPU lifecycle | Required before stable release |

## 4) Mocking and Isolation Strategy

- Filesystem boundaries use real temporary directories where behavior depends on canonical paths or file identity (`tests/file-scanner.test.js`, `tests/file-scanner-runtime.test.js`).
- Renderer-independent Three.js loaders use mocked `fetch`, image dimensions and real redistributable assets (`tests/loaders-matrix.test.js`).
- Electron window/renderer objects are narrow Vitest doubles for restoration and policy tests (`tests/packaged-accessibility.test.js`).
- Packaged tests use unique profiles and capability files; remote debugging/CDP arguments are expected to be rejected.
- Static renderer tests cover the accessible root-recovery action independently of model loading (`tests/accessibility-markup.test.jsx`).
- Common failure mode: static contract assertions can prove wiring but not actual packaged decoding. The real packaged self-test is the required functional counterpart.

## 5) Coverage and Quality Signals

- Coverage provider + threshold: pinned `@vitest/coverage-v8` with global floors of 48% statements, 50% branches, 49% functions and 50% lines. The measured baseline is higher; `npm run check` enforces the floor without pretending that host entrypoints are safely unit-importable.
- Current local evidence for this hardening worktree: focused worker-protocol tests cover channel, capability, schema and single-initialization rejection; export tests round-trip GLB/STL/OBJ through production loaders; every advertised format has a pinned malformed or geometry-free negative; and the packaged matrix proves real KTX2 decoding, six hostile pre-publication rejections, safe recovery from an OBJ whose MTL dependency is absent, stale-load cancellation and controlled replacement of a lost WebGL generation. The final PR/release commit must rerun the complete gate.
- CI additionally builds and runs the packaged Windows smoke; CodeQL runs `security-extended` queries.
- Known gaps: broader per-format fidelity, decompression-heavy and additional per-format sidecar hostile cases, Windows 10/11 clean profiles, assistive technology, constrained GPU and long-running GPU resource baselines (`docs/PRODUCT_READINESS.md`).

## 6) Evidence

- `package.json`
- `vite.config.mjs`
- `playwright.config.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/dependency-review.yml`
- `tests/loaders-matrix.test.js`
- `tests/e2e/packaged-app.spec.mjs`
