# Contributing

Thanks for helping improve NexoIP 3D Viewer.

## Before opening a pull request

1. Discuss large features in an issue first. Report security problems privately as described in [SECURITY.md](SECURITY.md), and follow the [Code of Conduct](CODE_OF_CONDUCT.md) in every project space.
2. Use Node.js 24.12 or newer on Windows and install the exact lockfile with `npm ci`.
3. Keep the application offline-first. Do not add telemetry, remote fonts, CDN assets, embedded servers, arbitrary filesystem access, or renderer-visible paths.
4. Keep IPC capabilities narrow and validate again in the main process; preload validation is not a trust boundary by itself.
5. Add or update tests for behavior and security boundaries.

## Development

```powershell
npm ci
npm run dev
```

Before committing:

```powershell
npm run check
```

Run the package-level gate that matches the change:

| Change area | Required gate |
| --- | --- |
| Renderer/UI only | `npm run check` |
| Electron main process, preload, protocol, scanner, loader, or catalog | `npm run test:smoke:ci` and `npm run test:e2e` |
| Installer, portable artifact, signing, release workflow, or packaged resources | `npm run dist:win` and `npm run test:release-artifacts` |

These are alpha regression gates, not a substitute for the stable Windows, assistive-technology, GPU, and signing evidence in [Product readiness](docs/PRODUCT_READINESS.md).

Use focused commits with [Conventional Commit](https://www.conventionalcommits.org/) prefixes such as `feat:`, `fix:`, `docs:`, or `test:`. Do not commit `release/`, `dist/`, credentials, certificates, `.env` files, local models, or machine-specific paths.

## Pull-request checklist

- The change has one clear purpose and documents user-visible behavior.
- Lint, unit tests, production build, and dependency audit pass.
- New filesystem or IPC inputs are bounded, allowlisted, and covered by negative tests.
- Keyboard and screen-reader behavior remain usable; motion respects the user's preference.
- No outbound network dependency or sensitive local data was introduced.
- Screenshots are included for visible UI changes.

By contributing, you agree that your work is licensed under the project's [MIT License](LICENSE).
