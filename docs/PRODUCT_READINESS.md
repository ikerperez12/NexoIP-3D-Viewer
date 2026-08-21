# Product readiness

NexoIP 3D Viewer is currently an **alpha technical preview**. Version `v1.0.0` is useful for evaluation, but it is not the stable product target and must not be presented as a fully supported release.

This document is the release contract for the first stable version. A green build is necessary, but it is not sufficient: every gate below needs reproducible evidence from the exact commit and Windows binaries being published.

## Current support matrix

| Format | Alpha status | Stable-release requirement |
| --- | --- | --- |
| GLB / glTF | The packaged matrix loads an animated GLB, external-buffer/textured glTF, and required Meshopt, Draco and KTX2/Basis glTF fixtures through the private protocol. | Broader static/animated, multi-scene, embedded-resource and malformed corpus; fidelity and export round trips for each supported feature. |
| OBJ | Packaged multi-MTL/local-PNG fixture; missing material has a unit negative test. | Broader MTL/map option coverage and an explicit user-facing recovery flow for absent material files. |
| STL | Packaged ASCII fixture plus binary-colour unit fixture. | Binary-colour packaged fixture, malformed corpus and deterministic-statistics regression. |
| FBX | Packaged compact static redistributable fixture. | Animation, embedded texture and supported local texture fixtures in the packaged matrix. |
| PLY | Packaged authored coloured mesh with normals; in-memory point-cloud coverage. | Packaged point-cloud and malformed fixtures. |
| DAE | Packaged centimetre-scale, Z-up, textured and matrix-animated fixture. | Broader unit/up-axis and supported local-texture corpus. |

Export remains alpha. GLB now exports the clean imported clone rather than viewport material/camera mutations, includes hidden source nodes, and preserves animation clips in a round-trip unit test. STL and OBJ intentionally preserve geometry only; cross-format export fidelity still needs its own curated regression corpus.

## Stable release gates

### 1. Security and privacy

- The Electron renderer remains sandboxed, context-isolated and without Node.js integration.
- IPC validates sender, top frame, origin, types, sizes and identifiers. No filesystem path is exposed to renderer code.
- Navigation, pop-ups, webviews, permissions, remote subresources and production debugging switches are denied.
- Asset reads are allowlisted, size-bounded, contained after canonicalisation and served without a check-then-reopen race.
- Folder indexing is opt-in, cancellable and root-contained. Every compatible model that can be indexed within the per-asset safety policy is discovered under the folders the user explicitly selects; no automatic disk scan, telemetry, analytics, account or network service is introduced.
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

Current evidence: on the development Windows host, the unpacked executable plus freshly built NSIS and portable artifacts all load the same ten representative scenarios across every advertised extension, including Draco, Meshopt and KTX2/Basis, through the local renderer and opaque-ID model protocol. The guarded NSIS smoke installs, self-tests and uninstalls in a unique temporary directory; the portable smoke uses the same capability contract. Both leave no NexoIP process or smoke root behind. The packaged self-test also exercises targeted keyboard, semantic and no-global-overflow invariants at 900x600 and 200% browser zoom; this is not a complete WCAG conformance audit. Clean-profile Windows 10/11, assistive-technology and constrained-GPU evidence remains open for stable.

## Explicit non-goals for the first stable release

- Editing or repairing source 3D assets.
- Claiming lossless conversion between formats with different feature sets.
- Inferring real-world units when the source format does not define them.
- Running untrusted models with an assurance equivalent to a dedicated malware sandbox.
- Supporting platforms or architectures not listed in the release notes.
