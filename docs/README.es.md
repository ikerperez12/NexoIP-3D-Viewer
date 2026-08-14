# NexoIP 3D Viewer

[English](../README.md) · [Alpha v1.0.0](https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/tag/v1.0.0) · [Seguridad](../SECURITY.md)

> [!WARNING]
> **Vista previa técnica alpha.** `v1.0.0` sirve para evaluación, pero todavía no es la versión estable objetivo. Consulta los [criterios públicos de preparación](PRODUCT_READINESS.md) antes de depender de ella.

NexoIP 3D Viewer es una aplicación de escritorio privada y offline-first para buscar, abrir e inspeccionar modelos 3D locales en Windows. Admite `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.ply` y `.dae`.

## Funciones principales

- Biblioteca local limitada a las carpetas que seleccionas expresamente.
- Apertura directa mediante arrastrar y soltar.
- Modos PBR, alambre, normales, rayos X y plano; cámara perspectiva u ortográfica.
- Seis configuraciones de iluminación, incluido un estudio sobre fondo negro real.
- Inspector de geometría, dimensiones, jerarquía, materiales y animaciones.
- Selector, reproducción, avance manual y velocidad de animaciones funcionales.
- Exportación a GLB, STL y OBJ, además de capturas PNG.
- Fuentes y decodificador Draco incluidos: no depende de Google Fonts, Tailwind CDN ni gstatic.
- Navegación por teclado, foco visible, etiquetas accesibles y reducción de movimiento.

## Descargar

La compilación existente está en la [vista previa alpha `v1.0.0`](https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/tag/v1.0.0):

- `*-setup.exe`: instalador por usuario.
- `*-portable.exe`: ejecutable independiente.
- `SHA256SUMS.txt`: hashes para comprobar la integridad.
- `*.cdx.json`: inventario CycloneDX de dependencias.
- `THIRD_PARTY_NOTICES.txt`: licencias y atribuciones de los componentes incluidos.

Los binarios actuales no tienen firma Authenticode y Windows puede mostrar SmartScreen. Comprueba siempre el SHA-256 antes de ejecutarlos:

```powershell
Get-FileHash .\NexoIP-3D-Viewer-1.0.0-windows-x64-portable.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

## Privacidad real

La aplicación no incluye telemetría, cuentas, analítica, comprobaciones remotas ni servidor HTTP. Tampoco escanea automáticamente el equipo. Un diálogo nativo permite seleccionar las carpetas que quieres indexar y arrastrar un archivo autoriza únicamente ese modelo.

La interfaz se ejecuta aislada y sin acceso a Node.js ni a rutas del sistema. El proceso principal valida todas las operaciones, devuelve identificadores opacos y solo sirve modelos ya autorizados. Se bloquean navegación externa, ventanas emergentes, permisos y `webview`.

Consulta [SECURITY.md](../SECURITY.md) y [la arquitectura](ARCHITECTURE.md) para más detalles.

## Compilar desde el código

Requisitos: Windows 10/11 x64, Node.js 24.12 o posterior y npm 11 o posterior.

```powershell
git clone https://github.com/ikerperez12/NexoIP-3D-Viewer.git
Set-Location NexoIP-3D-Viewer
npm ci
npm run check
npm run dev
```

Para generar instalador y portable:

```powershell
npm run dist:win
npm run test:release-artifacts
```

`npm run test:release-artifacts` se niega a ejecutarse si detecta una instalación previa de NexoIP, instala NSIS de forma silenciosa en directorios temporales únicos dentro del perfil anfitrión protegido, ejecuta el contrato seguro, elimina el estado que ha creado y valida el portable. No sustituye una prueba posterior sobre perfiles Windows limpios.

`npm run test:e2e` y `npm run test:smoke:ci` comprueban todos los fuses de Electron, demuestran que el ejecutable distribuido rechaza transportes de depuración, inician el paquete real sin CDP, ejercitan el bridge preload y el protocolo privado de modelos `nexoip://`, y verifican los cuatro runtimes Draco/Basis incluidos. El self-test empaquetado recoge además evidencia dirigida con ventana 900x600 y zoom del navegador al 200%: acciones esenciales visibles, ausencia de desbordamiento global y alternativas de cámara por teclado. Es una regresión concreta, no una declaración de conformidad WCAG.

Las pruebas unitarias usan un corpus redistribuible fijado por SHA-256 para glTF con recursos externos, `EXT_meshopt_compression` obligatorio, OBJ con varias bibliotecas MTL y texturas, DAE con escala/ejes/textura/animación, FBX estático, cableado Draco/KTX2, STL y PLY. La procedencia de cada fixture está documentada junto al corpus; la decodificación Draco/KTX2 dentro del paquete real y la matriz completa de siete formatos siguen pendientes para la versión estable.

Los binarios se generan en `release/`, pero no se versionan en Git. Las distribuciones oficiales se publican únicamente como assets de una GitHub Release.

## Límites conocidos

- Solo se distribuye oficialmente para Windows x64.
- `v1.0.0` es una vista previa alpha; todavía no existe una release estable soportada.
- La matriz unitaria ya cubre FBX estático, DAE animado/texturizado, Meshopt real y OBJ multi-MTL con texturas; la matriz completa dentro de la aplicación empaquetada, incluida decodificación Draco/KTX2, sigue pendiente.
- Los recursos vinculados que admita cada cargador deben estar junto al modelo aprobado y usar una extensión auxiliar permitida.
- Las dimensiones se muestran en unidades propias del modelo (`u`), porque los formatos de origen no siempre definen una escala real.
- Un archivo excesivamente grande o malformado puede rechazarse para proteger memoria y estabilidad.
- Los ejecutables todavía no están firmados digitalmente.

Licencia [MIT](../LICENSE). Los componentes incluidos conservan sus licencias y atribuciones en [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt). Copyright © 2026 Iker Perez / NexoIP.
