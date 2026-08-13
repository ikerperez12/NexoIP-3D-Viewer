# Contributing

Thanks for helping improve NexoIP 3D Viewer.

## Before opening a pull request

1. Discuss large features in an issue first. Report security problems privately as described in [SECURITY.md](SECURITY.md).
2. Use Node.js 22.12 or newer on Windows and install the exact lockfile with `npm ci`.
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

Use focused commits with [Conventional Commit](https://www.conventionalcommits.org/) prefixes such as `feat:`, `fix:`, `docs:`, or `test:`. Do not commit `release/`, `dist/`, credentials, certificates, `.env` files, local models, or machine-specific paths.

## Pull-request checklist

- The change has one clear purpose and documents user-visible behavior.
- Lint, unit tests, production build, and dependency audit pass.
- New filesystem or IPC inputs are bounded, allowlisted, and covered by negative tests.
- Keyboard and screen-reader behavior remain usable; motion respects the user's preference.
- No outbound network dependency or sensitive local data was introduced.
- Screenshots are included for visible UI changes.

By contributing, you agree that your work is licensed under the project's [MIT License](LICENSE).
