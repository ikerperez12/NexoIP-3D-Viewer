# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/) and uses [Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

### Changed

- Added decoded-resource budgets, cancellable scans and loads, adaptive camera clipping, recoverable WebGL context loss, and deterministic GPU resource disposal.
- Added keyboard camera controls, APG tabs, focus restoration, scan/search announcements, compact-layout panel behaviour, and Windows forced-colour support.
- Improved glTF with local Draco, Meshopt, and KTX2 runtimes; OBJ with multiple MTL libraries; STL colours; and PLY point-cloud handling.
- GLB export now uses the clean imported object, includes hidden source nodes, and preserves animation clips.

### Security

- Production binaries reject debugging and sandbox-bypass startup flags before creating a window.
- Model assets are served from identity-verified open handles with safe MIME types and no check-then-reopen race.
- Release publication now requires protected-main provenance, manual `production-signing` approval, timestamped publisher signatures, an Electron runtime inventory, SBOM, checksums, and attestations.

### Tests

- Added real parser fixtures for glTF, OBJ/MTL, STL, and PLY; animated GLB round-trip coverage; scan cancellation and registry bounds; protocol HEAD cleanup; startup-policy negatives; a no-CDP packaged self-test; and isolated NSIS install/uninstall plus portable-artifact smoke coverage.

## [1.0.0] - 2026-08-13 (alpha technical preview)

This release was reclassified as a prerelease while format fidelity, resource limits, accessibility, packaged testing and Windows signing are hardened. It is not the stable product target.

### Added

- Offline-first Windows viewer for GLB, glTF, OBJ, STL, FBX, PLY, and DAE.
- Opt-in folder library and direct drag-and-drop registration.
- Geometry, hierarchy, material, and animation inspection.
- Lighting, render, camera, export, and snapshot tools.
- Automated checks, security scanning, SBOM, checksums, and release provenance.
- Packaged third-party notices for bundled fonts, renderer libraries, and Draco.

### Security

- Replaced the embedded HTTP server with a sandboxed Electron capability bridge.
- Removed automatic disk scanning, open CORS, arbitrary path reads, and shell command execution.
- Added opaque model IDs, path containment, symlink checks, strict navigation controls, a local CSP, and hardened Electron fuses.
- Added a release gate that verifies all nine Electron 43 fuses before packaged tests or publication.
- Updated the runtime and build dependencies to versions with no known npm audit findings at release time.

[Unreleased]: https://github.com/ikerperez12/NexoIP-3D-Viewer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/tag/v1.0.0
