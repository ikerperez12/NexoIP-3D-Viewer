# Architecture and security boundaries

NexoIP 3D Viewer is a local desktop application. Its design intentionally avoids an embedded HTTP API and treats the renderer as untrusted.

```text
Windows file picker / dropped File
               │ explicit user approval
               ▼
Electron main process ── validates and indexes ──► in-memory model registry
               │                                      │
               │ narrow, validated IPC                │ opaque model ID
               ▼                                      ▼
Sandboxed preload bridge                      nexoip:// asset handler
               │                                      │ allowlisted file
               └──────────────────► renderer ◄────────┘
                                  no Node.js
                                  no local paths
```

## Trust boundaries

### Renderer

The React renderer has `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. It cannot read the filesystem or invoke arbitrary Electron APIs. Navigation, new windows, permissions, and webviews are denied.

### Preload bridge

`electron/preload.cjs` exposes a frozen `window.nexoip` object with a small capability set. Inputs are type-checked and bounded before IPC. Dropped files are converted to native paths with Electron's `webUtils.getPathForFile`; paths never become renderer-visible values.

### Main process and registry

`electron/file-scanner.js` indexes only user-approved directories or explicitly dropped files. Supported model formats and sidecar extensions are allowlisted. Selected roots have no arbitrary depth, directory, entry, or model-count cap: discovery remains cancellable and progressive instead. Every candidate is constrained to the approved canonical root, must be a regular non-link file within the per-file size policy, and must pass a bounded format-specific structural preflight before it enters the catalog. Renderer DTOs contain opaque IDs and display metadata, not absolute paths. The first prechecked discovery publishes immediately; later dense discoveries coalesce into metadata-only notifications no more often than every 200 ms, with a final state notification at scan completion. The renderer then reads revisioned, cursor-paginated catalog and tree-child snapshots, never a full library transfer. Opening a catalog entry still performs the format loader's full parse and fidelity checks.

### Asset protocol

`nexoip://app/` serves packaged UI files and approved model assets. Every model request uses an opaque ID. Sidecars must resolve beneath the model directory and match an allowlisted extension. Traversal and symlink escapes are rejected after canonical path resolution.

## Data lifecycle

The catalog exists in memory for the current application session. NexoIP 3D Viewer does not upload, synchronize, or persist a list of user files. Closing the app discards the catalog.

## Build hardening

- Exact dependency versions and a committed npm lockfile.
- Restrictive Content Security Policy with no remote asset hosts.
- Electron-builder's integrated fuses disable `RunAsNode`, `NODE_OPTIONS`, inspect CLI arguments, and extra `file://` privileges, then require an ASAR with integrity metadata.
- CI pins third-party actions to immutable commit SHAs.
- Releases include a CycloneDX SBOM, SHA-256 checksums, and GitHub build provenance.

## Residual risks

3D parsers process complex, potentially hostile input. Keep Electron and Three.js current, open only assets you trust, and report crashes or parser anomalies privately. Windows binaries are not yet Authenticode-signed; verify checksums and provenance before execution.
