import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { scanner } from './scanner.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Iniciar un primer escaneo en segundo plano al arrancar el servidor
setTimeout(() => {
  scanner.scanDirectories().catch(err => console.error('Error en escaneo inicial:', err));
}, 1000);

// Generar modelos 3D de demostración locales para probar inmediatamente
function ensureDemoModels() {
  const demoDir = path.join(process.cwd(), 'demo_models');
  if (!fs.existsSync(demoDir)) {
    fs.mkdirSync(demoDir, { recursive: true });
  }

  // Generar un cubo STL de muestra
  const stlPath = path.join(demoDir, 'cubo_demostracion.stl');
  if (!fs.existsSync(stlPath)) {
    const stlContent = `solid cube
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 10 10 0
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 10 10 0
      vertex 0 10 0
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 10
      vertex 10 10 10
      vertex 10 0 10
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 10
      vertex 0 10 10
      vertex 10 10 10
    endloop
  endfacet
endsolid cube`;
    fs.writeFileSync(stlPath, stlContent);
  }

  // Generar un pirámide OBJ de muestra
  const objPath = path.join(demoDir, 'piramide_demostracion.obj');
  if (!fs.existsSync(objPath)) {
    const objContent = `# Pirámide 3D de Muestra para NexoIP 3D Viewer
v 0.0 15.0 0.0
v -10.0 0.0 10.0
v 10.0 0.0 10.0
v 10.0 0.0 -10.0
v -10.0 0.0 -10.0
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2
f 2 5 4 3
`;
    fs.writeFileSync(objPath, objContent);
  }
}

ensureDemoModels();

// API: Obtener lista plana de archivos 3D
app.get('/api/files', (req, res) => {
  const { query, extension, sortBy, order } = req.query;
  const files = scanner.getFiles({ query, extension, sortBy, order });
  res.json({ success: true, count: files.length, files });
});

// API: Obtener árbol jerárquico de carpetas con archivos 3D
app.get('/api/tree', (req, res) => {
  res.json({ success: true, tree: scanner.getTree() });
});

// API: Iniciar escaneo masivo
app.post('/api/scan', async (req, res) => {
  const { directories } = req.body || {};
  const result = await scanner.scanDirectories(directories);
  res.json({ success: true, result });
});

// API: Estado del escaneo
app.get('/api/scan-status', (req, res) => {
  res.json({ success: true, status: scanner.getStatus() });
});

// API: Servir archivo 3D desde disco local
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'Parámetro path requerido' });
  }

  const normalizedPath = path.normalize(filePath);

  if (!fs.existsSync(normalizedPath)) {
    return res.status(404).json({ error: 'El archivo no existe en el disco' });
  }

  const ext = path.extname(normalizedPath).toLowerCase();
  const mimeTypes = {
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.obj': 'text/plain',
    '.stl': 'application/octet-stream',
    '.fbx': 'application/octet-stream',
    '.ply': 'application/octet-stream',
    '.dae': 'model/vnd.collada+xml'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const stream = fs.createReadStream(normalizedPath);
  stream.on('error', () => {
    res.status(500).end('Error al leer el archivo');
  });
  stream.pipe(res);
});

// API: Abrir archivo/carpeta en el Explorador de Windows
app.post('/api/open-in-explorer', (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Ruta no válida' });
  }

  const normPath = path.normalize(filePath);
  const command = process.platform === 'win32'
    ? `explorer.exe /select,"${normPath}"`
    : `open "${path.dirname(normPath)}"`;

  exec(command, (err) => {
    if (err) {
      return res.status(500).json({ error: 'No se pudo abrir el explorador de archivos' });
    }
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`[NexoIP 3D Viewer Server] Servidor activo en http://localhost:${PORT}`);
});
