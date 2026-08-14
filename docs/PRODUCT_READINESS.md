# Product readiness

NexoIP 3D Viewer is currently an **alpha technical preview**. Version `v1.0.0` is useful for evaluation, but it is not the stable product target and must not be presented as a fully supported release.

This document is the release contract for the first stable version. A green build is necessary, but it is not sufficient: every gate below needs reproducible evidence from the exact commit and Windows binaries being published.

## Current support matrix

| Format | Alpha status | Stable-release requirement |
| --- | --- | --- |
| GLB / glTF | External buffer/PNG glTF and animated GLB round-trip tested; required EXT Meshopt decodes from a pinned fixture; pinned Draco/KTX2 manifests, sidecars and bundled runtime paths are checked but not decoded in the packaged app | Static and animated scenes; local buffers and textures; real packaged Draco, Meshopt and KTX2 decoding; actionable failures for unsupported extensions; packaged fixtures for each path. |
| OBJ | Multiple adjacent MTL libraries and local PNG textures tested; missing-material fallback tested | MTL and local texture support, safe sidecar handling, and a documented fallback when material files are absent. |
| STL | ASCII packaged smoke plus binary colour unit fixture | ASCII and binary fixtures, preserved supported vertex colours, malformed-file handling, and deterministic statistics. |
| FBX | Compact redistributable static fixture parses in the loader matrix | Static, animation, embedded texture and supported local texture fixtures tested in the packaged app. |
| PLY | Meshes and point clouds tested in-memory, including authored normals and vertex colours | Packaged mesh and point-cloud fixtures plus malformed-file handling. |
| DAE | Redistributable centimetre-scale, Z-up, textured and matrix-animated fixture parses in the loader matrix | Unit/up-axis conversion, animation and supported local textures tested in the packaged app. |

Export remains alpha. GLB now exports the clean imported clone rather than viewport material/camera mutations, includes hidden source nodes, and preserves animation clips in a round-trip unit test. STL and OBJ intentionally preserve geometry only; a packaged cross-format matrix is still required for stable.

## Stable release gates

### 1. Security and privacy

- The Electron renderer remains sandboxed, context-isolated and without Node.js integration.
- IPC validates sender, top frame, origin, types, sizes and identifiers. No filesystem path is exposed to renderer code.
- Navigation, pop-ups, webviews, permissions, remote subresources and production debugging switches are denied.
- Asset reads are allowlisted, size-bounded, contained after canonicalisation and served without a check-then-reopen race.
- Folder indexing is opt-in, cancellable and bounded. No automatic disk scan, telemetry, analytics, account or network service is introduced.
- Exact dependencies and immutable GitHub Actions references pass dependency audit, CodeQL and secret scanning.
- The release SBOM identifies the Electron/Chromium runtime that is actually distributed, and both binaries and SBOM have build provenance.
- Every NexoIP-owned executable is Authenticode-signed with the expected publisher identity and a trusted timestamp. Runtime PE signatures are inventoried and verified against an explicit vendor policy. `NotSigned` on a project-owned executable is a hard release failure.
- Signing credentials are available only to a protected GitHub environment after an approved, protected tag is proven to reference the protected main branch.

### 2. Format correctness and resource safety

- Each advertised format has a small, redistributable positive fixture and malformed/unsupported negative fixtures.
- A decoded-resource budget covers node depth/count, vertices, triangles, materials, animations, textures and total texture pixels in addition to file bytes.
- Oversized, deeply nested, truncated and decompression-heavy inputs fail with a recoverable message rather than leaving stale content or an unusable shell.
- Loading and scanning can be cancelled. Switching models cannot commit an obsolete load.
- Camera clipping adapts to model bounds, including large-unit CAD-style assets.
- GPU resources, image bitmaps, helpers, mixers and temporary render targets return to a stable baseline after repeated model switches.
- WebGL context loss is handled with a visible recovery path.

### 3. Accessibility and Windows usability

- The complete primary workflow is operable with keyboard alone, including discrete orbit, pan and zoom alternatives to pointer dragging.
- Tabs follow the WAI-ARIA Authoring Practices keyboard and relationship pattern.
- Blocking states manage focus, make background controls inert and provide cancel/recovery choices.
- Closing a panel restores focus to its trigger; all controls have accessible names and minimum WCAG 2.2 AA target sizes.
- Text and component contrast pass WCAG 2.2 AA; reduced motion, Windows contrast themes and visible focus are supported.
- The application remains usable at 200% text/desktop scaling and at the minimum supported window size without hiding essential actions.
- Status, progress, search results and errors are announced once, with actionable and privacy-safe language.

### 4. Packaging and reproducibility

- A clean checkout using the committed lockfile passes lint, unit tests, production build, dependency audit and packaged smoke tests.
- Installer and portable artifacts are both exercised on clean Windows profiles; installer, launch, uninstall and portable cleanup are verified.
- Windows 10 and Windows 11 x64 are tested, including a software-rendering or constrained-GPU scenario.
- The packaged application runs offline and contains only the intended renderer, Electron boundary code, licences and notices.
- Checksums, SBOM, provenance and signature verification instructions match the exact uploaded files.
- The package advances to a fresh SemVer version; existing tags such as `v1.0.0` are never moved or reused.
- The new release tag exactly matches the package version and points to the reviewed commit on the protected main branch.

### 5. Evidence and release decision

- No open release-blocking (P0/P1) defect remains.
- Automated gates run against the release commit; manual checks record Windows version, GPU path and artifact hashes.
- Documentation matches observed behaviour and lists any accepted limitation without marketing overstatement.
- An independent final audit reviews the source diff, packaged contents, signatures, network behaviour, secrets and results.

Only after every gate is satisfied may the project remove the alpha warning and publish a stable GitHub Release.

Current evidence: the NSIS and portable smoke test passes on the development Windows host using unique temporary install/data directories on a guarded host profile, verifies the local renderer, capability bridge, model protocol and bundled decoder runtimes, and confirms cleanup of the state it creates. The packaged self-test also exercises targeted keyboard, semantic and no-global-overflow invariants at 900x600 and 200% browser zoom; this is not a complete WCAG conformance audit. Clean-profile Windows 10/11, assistive-technology and constrained-GPU evidence remains open for stable.

## Explicit non-goals for the first stable release

- Editing or repairing source 3D assets.
- Claiming lossless conversion between formats with different feature sets.
- Inferring real-world units when the source format does not define them.
- Running untrusted models with an assurance equivalent to a dedicated malware sandbox.
- Supporting platforms or architectures not listed in the release notes.
