# 3D format-matrix fixture attribution

This directory contains compact source-format fixtures for loader tests. The
authored OBJ, MTL, DAE, and malformed fixtures are NexoIP test data and are
covered by the repository MIT license. The entries below identify every
external binary or image copied here, with its immutable upstream revision.

| Fixture path | Upstream and pinned revision | License and attribution |
| --- | --- | --- |
| `gltf-simple-texture/*` | [KhronosGroup/glTF-Sample-Assets `Models/SimpleTexture/glTF`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf/Models/SimpleTexture/glTF) | CC0-1.0. Copyright 2017, Public; Marco Hutter (javagl) for everything. |
| `meshopt-ext/triangle.gltf` | Authored NexoIP fixture encoded with [meshoptimizer 1.2.0](https://github.com/zeux/meshoptimizer/releases/tag/v1.2.0). Its embedded buffer was round-tripped through the official encoder and decoder before committing. | NexoIP test data under the repository MIT license. meshoptimizer is MIT, Copyright 2016-2026 Arseny Kapoulkine. |
| `draco-required/*` | [KhronosGroup/glTF-Sample-Assets `Models/Box/glTF-Draco`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf/Models/Box/glTF-Draco) | Unmodified upstream files. [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Copyright 2017, Cesium for everything. |
| `obj-multimtl/*.png`, `dae-up-axis/*.png` | [KhronosGroup/glTF-Sample-Assets `Models/SimpleTexture/glTF/testTexture.png`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf/Models/SimpleTexture/glTF/testTexture.png) | CC0-1.0. Copyright 2017, Public; Marco Hutter (javagl) for everything. |
| `fbx-static/lantern-pole.fbx` | [KhronosGroup/glTF-Sample-Models `sourceModels/Lantern/SM_LanternPole.fbx`](https://github.com/KhronosGroup/glTF-Sample-Models/blob/d7a3cc8e51d7c573771ae77a57f16b0662a905c6/sourceModels/Lantern/SM_LanternPole.fbx) | CC0-1.0. Microsoft waived copyright and related or neighboring rights to the extent possible under law. |
| `ktx2-required/basis-texture.ktx2` | [KhronosGroup/KTX-Software test resource](https://github.com/KhronosGroup/KTX-Software/blob/31145d1beb8fe09e4e75005c9a31ecdf3df2bb75/tests/resources/ktx2/ktx_document_uastc_rdo_4_zstd_5.ktx2) | Unmodified upstream KTX2 fixture, SHA-256 `15913638d6d882c41bde2021443d1f0a83de29adb294dcb835fd4618baf19780`. Apache-2.0; the [upstream README](https://github.com/KhronosGroup/KTX-Software/blob/31145d1beb8fe09e4e75005c9a31ecdf3df2bb75/README.md) carries `SPDX-License-Identifier: Apache-2.0`. |
| `ktx2-required/geometry.bin` | Copy of the pinned `SimpleTexture.bin` above. | CC0-1.0. Copyright 2017, Public; Marco Hutter (javagl) for everything. |

`glTF-Sample-Assets` is the official Khronos sample-asset repository. The
archived `glTF-Sample-Models` source fixture is retained only because its
Lantern source FBX is a compact, expressly CC0 static FBX. Provenance was
verified on 2026-08-13 against the pinned commits above.

`SHA256SUMS.txt` records the exact bytes reviewed in this repository. It makes
later fixture drift detectable; it does not replace the upstream licence and
revision links above.
