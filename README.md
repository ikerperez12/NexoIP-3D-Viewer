# NexoIP 3D Viewer

<p align="center">
  <img src="public/icon.svg" width="112" alt="NexoIP 3D Viewer logo">
</p>

<p align="center">
  A private, offline-first desktop viewer for inspecting local 3D assets on Windows.
</p>

<p align="center">
  <a href="https://github.com/ikerperez12/NexoIP-3D-Viewer/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ikerperez12/NexoIP-3D-Viewer/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-c9913b.svg"></a>
  <img alt="Windows x64" src="https://img.shields.io/badge/platform-Windows%20x64-2563eb.svg">
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-16a34a.svg">
</p>

<p align="center">
  <a href="docs/README.es.md">Español</a> ·
  <a href="https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/latest">Download</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

![NexoIP 3D Viewer inspecting a local model](.github/assets/nexoip-3d-viewer.png)

## What it does

NexoIP 3D Viewer opens and inspects `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.ply`, and `.dae` files without uploading them or starting a local web server. Add only the folders you choose, browse the resulting private catalog, or drag a compatible file directly into the app.

- PBR, wireframe, normals, and matcap-inspired render modes.
- Perspective and orthographic cameras, standard views, grid, axes, auto-rotation, and camera reset.
- Seven studio-lighting presets on a true black background.
- Geometry, dimensions, hierarchy, materials, and animation inspection.
- Working animation selection, playback, seeking, and speed controls.
- GLB, STL, and OBJ export plus PNG snapshots.
- Keyboard navigation and accessible names, status announcements, focus states, and reduced-motion support.
- Local Draco decoder and bundled fonts: model viewing does not depend on a CDN.

## Download for Windows

Download the installer or portable build from the [latest GitHub Release](https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/latest):

| Asset | Use |
| --- | --- |
| `NexoIP-3D-Viewer-*-windows-x64-setup.exe` | Per-user installer with an uninstall entry |
| `NexoIP-3D-Viewer-*-windows-x64-portable.exe` | Standalone executable; no installation |
| `SHA256SUMS.txt` | Integrity hashes for release assets |
| `*.cdx.json` | CycloneDX software bill of materials |
| `THIRD_PARTY_NOTICES.txt` | Licenses and attribution for bundled components |

The current Windows binaries are not Authenticode-signed. Windows may therefore show a SmartScreen warning. Verify the SHA-256 checksum before running a download; source and GitHub Actions build provenance are attached to each release. Code signing is planned, but it requires a trusted signing certificate.

### Verify a download

```powershell
Get-FileHash .\NexoIP-3D-Viewer-1.0.0-windows-x64-portable.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The values must match exactly. Never run a binary whose checksum differs.

## Privacy and security model

The desktop app has no telemetry, analytics, accounts, update beacon, or embedded HTTP server. It does not scan a disk automatically. A native Windows dialog is the only way to approve library folders, while drag-and-drop approves just the dropped model.

The Electron renderer is sandboxed and receives no filesystem paths or Node.js access. A narrow preload bridge exposes validated operations, models are referenced through opaque IDs, and a private `nexoip://` protocol serves only approved model assets and safe sidecar files. Navigation, pop-ups, permissions, webviews, and arbitrary external URLs are denied.

See [the security policy](SECURITY.md) and [architecture notes](docs/ARCHITECTURE.md) for the threat model and reporting process.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Right drag | Pan |
| Mouse wheel | Zoom |
| `←` / `→` | Previous / next model |
| `R` | Reset camera |

## Build from source

Requirements: Windows 10/11 x64, Node.js 24.12 or newer, and npm 11 or newer.

```powershell
git clone https://github.com/ikerperez12/NexoIP-3D-Viewer.git
Set-Location NexoIP-3D-Viewer
npm ci
npm run check
npm run dev
```

Create local Windows packages with:

```powershell
npm run dist:win
```

Generated packages are written to `release/` and intentionally excluded from Git. Official binaries are published only as GitHub Release assets.

## Quality gates

Every pull request runs ESLint, unit tests, a production renderer build, dependency auditing, and CodeQL. Tagged releases rebuild from the lockfile on a GitHub-hosted Windows runner, generate checksums and an SBOM, and attach build provenance.

```powershell
npm run lint
npm test
npm run build
npm audit --audit-level=high
npm run test:e2e
```

`npm run test:e2e` runs the complete interactive packaged-app test on a Windows desktop. GitHub-hosted runners use `npm run test:smoke:ci`, which verifies every Electron 43 fuse, starts the real executable, loads a local STL through the preload bridge, checks its geometry, and rejects non-local runtime resources without relying on desktop automation.

## Known limitations

- Windows x64 is the only supported release target today.
- Linked resources supported by a format loader must live beside the approved model and use an allowlisted local sidecar format.
- Dimensions are reported in the model's own unit (`u`); source formats do not always define a real-world scale.
- Very large or malformed assets may be rejected to protect responsiveness and memory usage.
- Release binaries are currently unsigned; see the download warning above.

## Contributing and license

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Security problems belong in a private report, not a public issue.

Released under the [MIT License](LICENSE). Bundled components retain their licenses and attribution in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Copyright © 2026 Iker Perez / NexoIP.
