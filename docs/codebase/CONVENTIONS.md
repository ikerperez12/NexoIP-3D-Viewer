# Coding Conventions

## 1) Naming Rules

| Item | Rule | Example | Evidence |
| --- | --- | --- | --- |
| React files/components | PascalCase | `Viewport3D.jsx`, `ModelInspector` | `src/components/Viewport3D.jsx:36`, `src/components/ModelInspector.jsx:26` |
| Utility/module files | lowercase or kebab-case | `camera-controls.js`, `file-scanner.js` | `src/utils/camera-controls.js`, `electron/file-scanner.js` |
| Functions/variables | camelCase; handlers use `handle*` | `handleStartScan`, `load3DModel` | `src/App.jsx:169`, `src/utils/loaders.js:419` |
| Classes | PascalCase | `FileScanner`, `ModelBudgetError` | `electron/file-scanner.js:343`, `src/utils/loaders.js:28` |
| Constants | uppercase snake case | `MAX_MODEL_BYTES`, `PACKAGED_APP_ORIGIN` | `electron/file-scanner.js:18`, `electron/security.js:4` |

## 2) Formatting and Linting

- Editor rules: UTF-8, LF, final newline, two spaces and trimmed trailing whitespace (`.editorconfig`).
- Linter: ESLint flat configuration with recommended JavaScript, React Hooks and React Refresh rules (`eslint.config.mjs`).
- No separate formatter is configured. Existing source consistently uses semicolons and single-quoted JavaScript strings.
- `react-refresh/only-export-components` is a warning, but `npm run lint` promotes every warning to a failure via `--max-warnings=0` (`eslint.config.mjs:36`, `package.json:29`).

Run:

```powershell
npm run lint
npm run check
```

## 3) Import and Module Conventions

- ESM is the default; the sandbox preload remains `.cjs` because Electron loads it as CommonJS (`package.json:10`, `electron/preload.cjs:1`).
- Imports are relative and explicit; no alias or barrel layer is configured.
- Built-in Node modules use the `node:` prefix (`electron/main.js:2`).
- Format-specific Three.js loaders and exporters are dynamically imported near their use sites.

## 4) Error and Logging Conventions

- Main-process IPC catches internal errors and returns a generic renderer-safe message (`electron/main.js:129-141`).
- Renderer helpers convert unknown values to actionable Spanish messages without exposing filesystem paths (`src/App.jsx:27-29`, `src/utils/nexoip.js:28-39`).
- Expected invalid files and startup model arguments fail closed; startup failures go to stderr (`electron/main.js:51-57`, `electron/main.js:290-293`).
- There is no runtime telemetry, analytics or remote logging. Test harnesses write bounded local diagnostic reports under ignored `test-results/` (`scripts/packaged-smoke.mjs:9-10`).
- Do not log paths, self-test tokens, signing secrets or user model contents. This is enforced by review policy rather than a logging framework (`CONTRIBUTING.md:14`, `.github/PULL_REQUEST_TEMPLATE.md`).

## 5) Testing Conventions

- Unit/integration files live in `tests/` as `*.test.js` or `*.test.jsx`; packaged Playwright uses `tests/e2e/*.spec.mjs`.
- Vitest mocks boundary dependencies with `vi.fn`, dependency injection and temporary directories.
- Fixtures must be redistributable, attributed and SHA-256 pinned; deterministic temporary binary fixtures carry their expected hash in the fixture generator (`tests/fixtures/README.md`, `tests/fixtures/format-matrix/SHA256SUMS.txt`, `scripts/packaged-fixture-matrix.mjs`).
- [TODO] No coverage provider or numeric threshold is currently configured.

## 6) Evidence

- `.editorconfig`
- `eslint.config.mjs`
- `package.json`
- `CONTRIBUTING.md`
- `tests/loaders-matrix.test.js`
