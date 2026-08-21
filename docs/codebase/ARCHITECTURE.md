# Architecture

## 1) Architectural Style

- Primary style: local capability-based desktop architecture with an explicit trusted-main/untrusted-renderer boundary.
- Classification evidence: the renderer is sandboxed, receives a frozen preload API, uses opaque model IDs and reads assets only through `nexoip://app/` (`electron/main.js:235-252`, `electron/preload.cjs:40-103`).
- Primary constraints: offline-first operation, explicit user approval for every scan/drop, no native paths in renderer DTOs, bounded parsing and Windows-only packaging.

## 2) System Flow

```text
native folder picker or dropped File
  -> frozen preload capability
  -> sender/origin-validated IPC
  -> live in-memory FileScanner registry with progressive publication
  -> display-only DTO with opaque ID
  -> identity-checked nexoip:// asset stream
  -> abortable Three.js loader and resource budget
  -> React inspector / WebGL viewport / local export
```

1. `dialog.showOpenDialog` or `webUtils.getPathForFile` establishes explicit user intent (`electron/main.js:153`, `electron/preload.cjs:75`).
2. `registerIpcHandler` verifies the sender, top frame and renderer origin before the main process handles a request (`electron/main.js:116-141`).
3. `FileScanner` canonicalises user-selected roots, traverses them cycle-safely and cancellably, and stores private paths only in memory (`electron/file-scanner.js`).
4. Renderer DTOs expose name, extension, size, timestamp and opaque ID, never a path (`electron/file-scanner.js:70-79`).
5. The private protocol resolves an ID, opens an identity-checked descriptor and streams it with a safe MIME type (`electron/main.js:82-114`, `electron/file-scanner.js:328-396`).
6. `load3DModel` blocks remote sidecars, supports cancellation, enforces decoded-resource budgets and returns a clean export clone (`src/utils/loaders.js:419-489`).
7. KTX2/Basis keeps the renderer CSP strict: a fixed same-origin static worker receives the legacy dynamic-code exception, has no network or bridge access, and returns only transcoded texture data (`src/utils/ktx2-static-worker.js`, `public/basis/ktx2-transcoder-worker.js`, `electron/security.js`).

## 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
| --- | --- | --- | --- |
| `electron/main.js` | Application lifecycle, native integrations, IPC registration and protocol routing | Model parsing or renderer UI | `electron/main.js:39-318` |
| `electron/file-scanner.js` | User-approved path registry, progressive structurally-valid discovery, opaque IDs and safe file handles | DOM state or network transport | `electron/file-scanner.js` |
| `electron/security.js` | Shared allowlists, URL/path validation and MIME mapping | Filesystem I/O | `electron/security.js:3-224` |
| `electron/preload.cjs` | Narrow capability surface | Final authorization decisions | `electron/preload.cjs:40-103` |
| `src/App.jsx` | Product state, catalog orchestration, selection and export actions | Native paths or Electron modules | `src/App.jsx:31-500` |
| `src/components/Viewport3D.jsx` | Three.js lifecycle, camera, animation and GPU resources | Native filesystem access | `src/components/Viewport3D.jsx:36-660` |
| `src/utils/loaders.js` | Format adapters, resource budgets, stats and disposal | User-interface layout | `src/utils/loaders.js:4-601` |
| `src/utils/ktx2-static-worker.js` / `public/basis/ktx2-transcoder-worker.js` | Bind the trusted static Basis worker without relaxing renderer CSP | Renderer IPC, DOM or arbitrary worker URLs | `src/utils/ktx2-static-worker.js:1`, `public/basis/ktx2-transcoder-worker.js:1` |

## 4) Reused Patterns

| Pattern | Where found | Why it exists |
| --- | --- | --- |
| Capability bridge | `electron/preload.cjs` | Minimises renderer authority and avoids arbitrary IPC |
| Opaque registry ID | `electron/file-scanner.js:66`, `electron/file-scanner.js:84` | Keeps private paths outside renderer-visible data |
| Validate at both boundaries | `electron/preload.cjs`, `electron/main.js:129` | Preload improves ergonomics; main remains the trust boundary |
| Open-and-verify handle | `electron/file-scanner.js:328` | Prevents serving a path swapped after validation |
| AbortController / stale-result rejection | `electron/file-scanner.js:201`, `src/components/Viewport3D.jsx:381` | Makes scans and model switches cancellable |
| Dynamic loader/exporter imports | `src/utils/loaders.js:154`, `src/App.jsx:325` | Keeps format-specific code out of the initial renderer path |
| Least-privilege legacy worker | `src/utils/ktx2-static-worker.js`, `electron/security.js` | Limits Basis' required `unsafe-eval` to one static worker response rather than the renderer |

## 5) Known Architectural Risks

- Three.js parsers still process the complete file before decoded-resource budgets can reject the resulting scene. The file cap, private protocol and post-parse budgets reduce exposure but do not constitute a malware sandbox (`src/utils/loaders.js:83-124`, `src/utils/loaders.js:472`).
- The packaged self-test now loads ten representative scenarios across all seven advertised extensions, but format fidelity beyond that corpus and clean Windows/AT/constrained-GPU evidence remain open (`docs/PRODUCT_READINESS.md`).
- `App.jsx`, `Viewport3D.jsx`, `loaders.js` and artifact smoke scripts are high-churn, multi-responsibility files; changes require focused and packaged regression tests.

## 6) Evidence

- `docs/ARCHITECTURE.md`
- `electron/main.js`
- `electron/file-scanner.js`
- `electron/preload.cjs`
- `src/App.jsx`
- `src/utils/loaders.js`
