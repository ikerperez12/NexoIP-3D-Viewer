# Security policy

## Supported versions

Security fixes are provided for the latest published release and the current `main` branch.

| Version | Supported |
| --- | --- |
| Latest 1.x | Yes |
| Older releases | No |

## Report a vulnerability privately

Please use [GitHub Private Vulnerability Reporting](https://github.com/ikerperez12/NexoIP-3D-Viewer/security/advisories/new). Do not open a public issue, discussion, or pull request containing exploit details or sensitive paths.

Include:

- affected version and Windows version;
- clear reproduction steps or a minimal proof of concept;
- expected impact and any mitigations already tested;
- whether the issue is already public.

You should receive an acknowledgement within seven days. We will validate the report, coordinate a fix and disclosure timeline, and credit you if requested. Please avoid accessing data that is not yours, persistence, destructive testing, denial of service, or social engineering.

## Security design

- No telemetry, analytics, accounts, remote APIs, or embedded HTTP server.
- Folder indexing is opt-in through a native dialog; dropped files are explicitly approved.
- Sandboxed renderer with context isolation and no Node.js integration.
- Narrow preload API, validated IPC, opaque model IDs, and no filesystem paths exposed to UI code.
- Local asset protocol with extension, size, containment, and symlink checks.
- Remote navigation, pop-ups, webviews, and permission requests are denied.
- Bundled fonts and Draco decoder; the application has no runtime CDN dependency.

The full boundary model is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Release verification

Each release includes SHA-256 checksums, a CycloneDX SBOM, and GitHub build provenance. Current Windows executables are not Authenticode-signed, so verify these materials before running them. Checksums establish integrity, not publisher identity.
