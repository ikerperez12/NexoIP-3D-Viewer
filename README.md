# 🧊 NexoIP 3D Viewer

> **Visor 3D Nativo y Escáner Masivo de Modelos para Windows**  
> Una aplicación de escritorio ligera, ultrarrápida y profesional para buscar, examinar e inspeccionar cualquier archivo 3D en tu ordenador (`.GLB`, `.GLTF`, `.OBJ`, `.STL`, `.FBX`, `.PLY`, `.DAE`).

[![Licencia: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![Plataforma: Windows](https://img.shields.io/badge/Platform-Windows%20x64-blue.svg)](https://microsoft.com)
[![Estado: Open Source](https://img.shields.io/badge/Status-Production%20Ready-emerald.svg)]()

---

## 🌟 Características Destacadas

- 📁 **Escáner Masivo & Árbol de Carpetas**: Busca automáticamente en todos tus discos y carpetas localizando archivos 3D y agrupándolos bajo su estructura real de directorios.
- ⚡ **Visor Nativo Ultrarrápido**: Carga instantánea de formatos `.GLB`, `.GLTF`, `.OBJ`, `.STL`, `.FBX`, `.PLY` y `.DAE` con centrado y escalado automático.
- 💡 **Sistema de Focos Pro & Fondo Negro Absoluto**: Triple foco de luz de estudio (`SpotLight`) con sombras soft y reflejos especulares sobre fondo `#000000`.
- 🎨 **Paletas de Iluminación Variadas**: 7 presets visuales (Cyberpunk Neón, Atardecer Dorado, Esmeralda Matrix, Fuego & Hielo, Estudio Blanco / Clay, Estudio Neutro, Noche Profunda).
- ◀ ▶ **Navegación Rápida & Atajos de Teclado**: Navega entre objetos 3D con los botones de la barra superior o las flechas del teclado `←` / `→`.
- 📊 **Inspector de Propiedades 3D**: Métricas geométricas en tiempo real (polígonos, vértices, mallas, materiales), dimensiones $X \times Y \times Z$ en metros, ocultamiento individual de nodos y exportador a GLB/STL/OBJ.
- 🎬 **Controlador de Animaciones**: Reproducción, barra scrubber y velocidad ajustable para modelos esqueléticos animados (GLB, FBX).
- 📤 **Arrastrar y Soltar (Drag & Drop)**: Arrastra cualquier modelo 3D desde el Explorador de Windows directamente a la ventana de la app.

---

## 📥 Descargas Ejecutables (.EXE)

Los ejecutables listos para usar se encuentran en la carpeta `release/`:

- 🚀 **`NexoIP 3D Viewer 1.0.0.exe`**: Versión **Portable** (No requiere instalación, haz doble clic y listo).
- 📦 **`NexoIP 3D Viewer Setup 1.0.0.exe`**: Instalador de Windows con asistente de instalación.

---

## 🛠️ Instalación y Compilación desde el Código Fuente

Si deseas contribuir o modificar el código fuente:

### Requisitos Previos
- **Node.js**: v18.0.0 o superior
- **npm**: v9.0.0 o superior

### Pasos de Instalación
```bash
# 1. Clonar el repositorio
git clone https://github.com/nexoip/nexoip-3d-viewer.git
cd nexoip-3d-viewer

# 2. Instalar dependencias
npm install

# 3. Iniciar en modo desarrollo
npm run electron

# 4. Compilar los ejecutables .exe para Windows
npm run dist
```

---

## 🔒 Auditoría de Seguridad & Privacidad

- 🚫 **Sin Telemetría ni Rastreo**: La aplicación funciona 100% en local sin enviar datos al exterior.
- 🔑 **Sin Tokens ni Claves Hardcodeadas**: Repositorio limpio y auditado para Open Source.
- 🔒 **Servidor Embebido Seguro**: Comunicación restringida exclusivamente a la red local (`localhost`).

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT** - consulta el archivo [LICENSE](LICENSE) para más detalles.
