# NexoIP 3D Viewer

[English](../README.md) · [Descargas](https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/latest) · [Seguridad](../SECURITY.md)

NexoIP 3D Viewer es una aplicación de escritorio privada y offline-first para buscar, abrir e inspeccionar modelos 3D locales en Windows. Admite `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.ply` y `.dae`.

## Funciones principales

- Biblioteca local limitada a las carpetas que seleccionas expresamente.
- Apertura directa mediante arrastrar y soltar.
- Modos PBR, alambre, normales y matcap; cámara perspectiva u ortográfica.
- Siete configuraciones de iluminación de estudio sobre fondo negro real.
- Inspector de geometría, dimensiones, jerarquía, materiales y animaciones.
- Selector, reproducción, avance manual y velocidad de animaciones funcionales.
- Exportación a GLB, STL y OBJ, además de capturas PNG.
- Fuentes y decodificador Draco incluidos: no depende de Google Fonts, Tailwind CDN ni gstatic.
- Navegación por teclado, foco visible, etiquetas accesibles y reducción de movimiento.

## Descargar

Usa la [última release de GitHub](https://github.com/ikerperez12/NexoIP-3D-Viewer/releases/latest):

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

Requisitos: Windows 10/11 x64, Node.js 22.12 o posterior y npm 10 o posterior.

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
```

`npm run test:e2e` empaqueta la aplicación, comprueba todos los fuses de Electron y ejecuta una prueba real del visor sobre Windows.

Los binarios se generan en `release/`, pero no se versionan en Git. Las distribuciones oficiales se publican únicamente como assets de una GitHub Release.

## Límites conocidos

- Solo se distribuye oficialmente para Windows x64.
- Los recursos vinculados que admita cada cargador deben estar junto al modelo aprobado y usar una extensión auxiliar permitida.
- Las dimensiones se muestran en unidades propias del modelo (`u`), porque los formatos de origen no siempre definen una escala real.
- Un archivo excesivamente grande o malformado puede rechazarse para proteger memoria y estabilidad.
- Los ejecutables todavía no están firmados digitalmente.

Licencia [MIT](../LICENSE). Los componentes incluidos conservan sus licencias y atribuciones en [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt). Copyright © 2026 Iker Perez / NexoIP.
