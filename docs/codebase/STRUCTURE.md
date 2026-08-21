# Codebase Structure

## 1) Top-Level Map

| Path | Purpose | Evidence |
| --- | --- | --- |
| `electron/` | Trusted main process, preload capability bridge, file registry, protocol and startup policy | `electron/main.js:1`, `electron/preload.cjs:1` |
| `src/` | Untrusted React renderer, UI components and Three.js model utilities | `src/main.jsx:1`, `src/App.jsx:1` |
| `scripts/` | Fuse verification and packaged NSIS/portable smoke harnesses | `scripts/verify-fuses.mjs:1`, `scripts/packaged-smoke.mjs:1` |
| `tests/` | Vitest suites, Playwright wrapper and redistributable fixture corpus | `vite.config.mjs:38`, `playwright.config.mjs:4`, `tests/fixtures/README.md` |
| `.github/` | Contribution templates, Dependabot and immutable CI/release workflows | `.github/dependabot.yml`, `.github/workflows/ci.yml` |
| `docs/` | Public architecture, readiness and Spanish documentation | `docs/ARCHITECTURE.md`, `docs/PRODUCT_READINESS.md` |
| `build/`, `public/` | Source icons plus the fixed static Basis worker used by packaging and renderer | `package.json:93`, `index.html:18`, `public/basis/ktx2-transcoder-worker.js:1` |
| Root manifests | npm, Vite, lint, Playwright, licensing and policy | `package.json`, `vite.config.mjs`, `SECURITY.md` |

Generated `dist/`, `release/`, `test-results/`, local `demo_models/` and dependencies are ignored and are not source-of-truth directories (`.gitignore:8-14`, `.gitignore:50`).

## 2) Entry Points

- Main runtime entry: `electron/main.js`, selected by `package.json:11`.
- Preload entry: `electron/preload.cjs`, supplied to `BrowserWindow` in `electron/main.js:246`.
- Renderer entry: `index.html` -> `src/main.jsx` -> `src/App.jsx`.
- Build/test entry points: the scripts in `package.json:24-38` and the three files under `scripts/`.
- There is no production server, database process or background service. KTX2 transcoding uses one fixed static same-origin Web Worker; it is not a separate application process and has no bridge or network authority.

## 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
| --- | --- | --- |
| Electron main | Native dialogs, filesystem registry, validated IPC, protocol responses, window/session policy | Renderer presentation or renderer-visible filesystem paths |
| Preload | Frozen, narrow capability adapters and first-pass argument validation | Business trust decisions, raw Electron exposure or arbitrary IPC |
| Renderer | UI state, accessible interaction, Three.js parsing/rendering and local export | Node.js, native paths, shell access or remote service calls |
| Scripts/workflows | Reproducible packaging, verification, signing and publication gates | Runtime application behavior |
| Tests/fixtures | Deterministic boundary, loader, accessibility and artifact evidence | User-owned models or generated release binaries |

## 4) Naming and Organization Rules

- React component files and exported components use PascalCase, for example `Viewport3D.jsx` and `FileLibrarySidebar.jsx`.
- Utilities and Electron modules use lowercase or kebab-case, for example `camera-controls.js`, `file-scanner.js` and `startup-policy.js`.
- Tests live under `tests/` and use `*.test.js`, `*.test.jsx` or the packaged `*.spec.mjs` wrapper.
- Imports are relative; there are no path aliases or barrel exports (`src/App.jsx:1-19`).
- Source is organized by runtime boundary first (`electron/`, `src/`, `scripts/`) and by UI component inside the renderer.

## 5) Evidence

- `git ls-files`
- `package.json`
- `.gitignore`
- `electron/main.js`
- `src/main.jsx`
- `vite.config.mjs`
