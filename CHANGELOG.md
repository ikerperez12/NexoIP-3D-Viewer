# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/) and uses [Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

## [1.0.0] - 2026-08-13

### Added

- Offline-first Windows viewer for GLB, glTF, OBJ, STL, FBX, PLY, and DAE.
- Opt-in folder library and direct drag-and-drop registration.
- Geometry, hierarchy, material, and animation inspection.
- Lighting, render, camera, export, and snapshot tools.
- Automated checks, security scanning, SBOM, checksums, and release provenance.

### Security

- Replaced the embedded HTTP server with a sandboxed Electron capability bridge.
- Removed automatic disk scanning, open CORS, arbitrary path reads, and shell command execution.
- Added opaque model IDs, path containment, symlink checks, strict navigation controls, a local CSP, and hardened Electron fuses.
- Updated the runtime and build dependencies to versions with no known npm audit findings at release time.

[Unreleased]: https://github.com/ikerperez12/NexoIP-3D-Viewer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/tag/v1.0.0
