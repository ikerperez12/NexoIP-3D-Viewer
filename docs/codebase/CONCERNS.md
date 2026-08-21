# Codebase Concerns

## 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
| --- | --- | --- | --- | --- |
| High | Stable binaries cannot be published with verified publisher identity | `docs/PRODUCT_READINESS.md:31`, protected environment currently has no signing values | Users cannot authenticate the publisher; SmartScreen may block binaries | Select a trusted Authenticode provider, define owner/rotation, configure the protected environment and verify timestamps |
| Medium | Packaged coverage is representative, not complete format-fidelity certification | `scripts/packaged-fixture-matrix.mjs`, `docs/PRODUCT_READINESS.md` | A valid but unusual scene/material/animation variant can still expose a loader gap | Grow the pinned corpus with malformed, multi-scene, embedded-resource and export round-trip cases |
| High | Stable Windows/accessibility/GPU evidence remains external and incomplete | `docs/PRODUCT_READINESS.md:58`, `docs/PRODUCT_READINESS.md:73` | A green development host cannot substantiate broad stable-support claims | Record clean Windows 10/11, assistive-technology and constrained-GPU runs against exact artifacts |
| Medium | Decoded-resource limits are enforced after parser allocation | `src/utils/loaders.js:419-472` | A compact but decompression-heavy hostile model may cause a transient memory/CPU spike before rejection | Keep strict file caps; add parser time/memory stress fixtures and explore worker isolation per loader |
| Medium | Bounded catalog preflight is not a full parser | `electron/file-scanner.js:318-340`, `src/components/FileLibrarySidebar.jsx` | A large or semantically incomplete candidate can be listed as prechecked until the loader rejects it on open | Keep the UI wording explicit, retain full parser/resource validation on open, and evaluate streaming validators only with hostile-corpus benchmarks |
| Medium | No numeric test-coverage signal is enforced | `vite.config.mjs:36-40`, package dependency inventory | Important branches can remain unmeasured despite a green test count | Add a dev-only coverage provider and meaningful per-module thresholds after measuring the baseline |

## 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
| --- | --- | --- | --- | --- |
| Large multi-responsibility modules | Rapid hardening consolidated lifecycle and verification logic | `scripts/release-artifact-smoke.mjs` (737 lines), `Viewport3D.jsx` (660), `loaders.js` (549), `packaged-self-test.js` (541), `App.jsx` (501) | Higher review cost and regression coupling | Extract pure policy/probe modules only when tests can preserve behavior |
| Legacy Basis dynamic-code requirement | The upstream Basis wrapper uses `new Function` | `public/basis/ktx2-transcoder-worker.js`, `electron/security.js` | A broad CSP exception would weaken the renderer boundary | Keep the exception limited to the fixed static worker; regression-test its CSP and runtime loading |
| Session-only catalog | Privacy-first registry intentionally avoids persistence | `electron/file-scanner.js:49-56`, `docs/ARCHITECTURE.md:37` | Users must reselect folders each launch | [ASK USER] Decide whether an opt-in, path-protected persisted library is desirable |
| Spanish-only product strings | Initial product surface targets Spanish while repository docs are bilingual | `index.html:2`, `src/App.jsx` | English Windows users receive Spanish application messages | [ASK USER] Define supported UI locales before extracting resources |

## 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
| --- | --- | --- | --- | --- |
| Complex untrusted 3D parsing | A03 / A06 | `src/utils/loaders.js:154-299`, `SECURITY.md:39` | Sandboxed renderer, local protocol, exact dependencies, file and decoded budgets | No dedicated parser process or malware-sandbox assurance |
| Inline style permission in CSP | A05 | `index.html:6`, `electron/main.js:207` | Scripts remain `self` only; renderer is sandboxed and has no Node.js | `style-src 'unsafe-inline'` remains necessary for dynamic color/indent styles |
| Signing secret lifecycle undefined | A02 / supply chain | `.github/workflows/release.yml:107-111`, `.github/workflows/release.yml:154` | Protected environment and exact subject/timestamp checks | Provider, rotation, revocation and recovery procedure are [TODO] |
| No runtime telemetry | N/A, intentional privacy control | `README.md:62`, `SECURITY.md:26` | Local diagnostics and private reports | Security crash trends depend on voluntary reports |

## 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
| --- | --- | --- | --- | --- |
| Demand-render scheduler | `src/utils/render-loop.js`, `src/components/Viewport3D.jsx` | Idle frames now stop when no animation, interaction, damping or auto-rotation is active | Regressions can reintroduce background work | Preserve scheduler unit tests and add a packaged frame/energy baseline before stable |
| Main Three.js chunk | Latest local production build reports `three.module` about 533.96 kB minified / 134.84 kB gzip | Build warning above 500 kB | Startup/read latency on slower disks | Preserve dynamic loader chunks; evaluate named imports and chunk policy with measurements |
| Parser resource accounting | `src/utils/loaders.js` | Per-load streamed source/request budgets and decoded-scene budgets bound known resource classes | A parser can still allocate or block while decoding a compact but expansive asset | Add decompression-heavy negative fixtures and worker/time budgets |
| Authoritative session catalog held in memory | `electron/file-scanner.js`, `src/App.jsx`, `src/components/FileLibrarySidebar.jsx` | The renderer receives bounded revisioned catalog/tree pages and expands folders lazily; no full-library IPC refresh remains | The private main-process registry and sort/index work still grow with catalog size | Benchmark very large real libraries; evolve the internal index only if measured memory or query latency warrants it |

## 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
| --- | --- | --- | --- |
| `package.json` / lockfile | Runtime, packaging and release scripts converge here | 10 recent commits for `package.json` | Update atomically; run `npm ci`, check, package and notices tests |
| Release workflow | Tag, signing, SBOM, provenance and cleanup interact | 6 recent commits | Keep static contract tests plus a reviewed dry-run on a fresh version |
| `electron/main.js` | Central trust boundary and lifecycle | 6 recent commits | Require negative IPC/navigation/startup tests for every capability change |
| `src/App.jsx` / `Viewport3D.jsx` / `loaders.js` | UI, asynchronous state and GPU/parser resources meet | 5-6 recent commits each | Use abort/stale-load tests, real fixtures and packaged smoke |
| Artifact smoke scripts | Windows registry, shortcuts, cache and cleanup are host-sensitive | 3-4 recent commits | Fail closed; prove ownership before cleanup; retain diagnostic artifacts on failure |

## 6) `[ASK USER]` Questions

1. [ASK USER] Should the stable application UI be Spanish-only or officially support both Spanish and English?
2. [ASK USER] Should approved folders remain session-only, or should there be an explicit opt-in persisted library with a clear privacy/reset control?
3. [ASK USER] Which trusted Authenticode provider and exact publisher subject should own the first stable release certificate?

## 7) Evidence

- `docs/PRODUCT_READINESS.md`
- `git log --name-only` high-churn scan
- `electron/main.js`
- `electron/file-scanner.js`
- `electron/packaged-self-test.js`
- `src/components/Viewport3D.jsx`
- `src/utils/loaders.js`
- `vite.config.mjs`
