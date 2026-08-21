# Technology Stack

## 1) Runtime Summary

| Area | Value | Evidence |
| --- | --- | --- |
| Primary language | JavaScript and JSX, using ECMAScript modules except for the CommonJS preload | `package.json:10`, `src/main.jsx:1`, `electron/preload.cjs:1` |
| Desktop runtime | Electron 43.4.1 on Windows x64 | `package.json`, Electron build configuration |
| Development runtime | Node.js 24.12.0 or newer and npm 11 or newer | `package.json:21`, `README.md:90` |
| Package manager | npm with lockfile v3, exact versions and engine enforcement | `package-lock.json:4`, `.npmrc:1`, `.npmrc:2` |
| Module/build system | Electron main process, Vite 8 renderer build and electron-builder 26 packaging | `package.json:11`, `package.json:27`, `package.json:55`, `package.json:56` |

## 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
| --- | --- | --- | --- |
| Electron | 43.4.1 | Bundled desktop runtime; installed as development tooling but shipped by electron-builder | `package.json`, Electron build configuration |
| React / React DOM | 18.3.1 | Renderer component and state model | `package.json:45`, `package.json:46`, `src/main.jsx:1` |
| Three.js | 0.165.0 | WebGL scene, cameras, loaders, controls and exporters | `package.json:47`, `src/components/Viewport3D.jsx:2`, `src/utils/loaders.js:1` |
| Lucide React | 0.395.0 | UI icon components | `package.json:44`, `src/App.jsx:7` |
| Fontsource Inter / JetBrains Mono | 5.3.0 | Offline bundled UI fonts | `package.json:42`, `package.json:43`, `src/index.css:1` |

All direct dependency versions are exact. The application sets `private: true` to prevent accidental npm publication; this does not change the MIT source licence.

## 3) Development Toolchain

| Tool | Purpose | Evidence |
| --- | --- | --- |
| Vite 8.2.1 | Renderer development server and production build | `package.json:64`, `vite.config.mjs:1` |
| Tailwind CSS 4.3.3 | Locally compiled renderer styles | `package.json:62`, `vite.config.mjs:3` |
| ESLint 10.8.1 | JavaScript, React and Electron lint gate | `package.json:58`, `eslint.config.mjs:1` |
| Vitest 4.1.10 | Node-environment unit and integration tests | `package.json:66`, `vite.config.mjs:36` |
| Playwright 1.62.1 | Packaged executable smoke wrapper | `package.json:51`, `playwright.config.mjs:1` |
| electron-builder 26.15.3 | Windows directory, NSIS and portable packages | `package.json:56`, `package.json:72` |
| `@electron/fuses` 2.1.3 | Verifies hardened Electron fuse state | `package.json:49`, `scripts/verify-fuses.mjs:1` |

## 4) Key Commands

```powershell
npm ci
npm run dev
npm run check
npm run test:smoke:ci
npm run dist:win
npm run test:release-artifacts
```

`npm run check` composes lint, Vitest, the production renderer build and an npm audit at high severity. Packaged checks are deliberately separate because they build and launch Windows executables.

## 5) Environment and Config

- Runtime configuration is compiled into `package.json`, `vite.config.mjs`, `electron/security.js` and `electron/startup-policy.js`.
- `ELECTRON_RENDERER_URL` is development-only and is rejected unless it is exactly `http://127.0.0.1:3000/` (`electron/main.js:263`, `electron/security.js:185`).
- Stable release signing expects protected-environment values `CSC_LINK`, `CSC_KEY_PASSWORD` and `NEXOIP_SIGNING_SUBJECT` (`.github/workflows/release.yml:110`, `.github/workflows/release.yml:154`). They are not runtime application settings.
- The distributed target is Windows 10/11 x64. No container or server deployment exists (`README.md:90`, `package.json:95`).
- There is no `.env` template because the packaged application has no runtime credentials or remote service configuration.

## 6) Evidence

- `package.json`
- `package-lock.json`
- `.npmrc`
- `vite.config.mjs`
- `eslint.config.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
