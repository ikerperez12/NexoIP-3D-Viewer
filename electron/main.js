import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import http from 'node:http';
import { FileScanner } from './file-scanner.js';
import {
  DEV_RENDERER_URL,
  PACKAGED_APP_ORIGIN,
  getAppAssetPath,
  getModelRoute,
  isAllowedNavigationUrl,
  isAllowedRendererUrl,
  isOpaqueId,
  normalizeFilters,
  normalizeDevRendererUrl,
} from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nexoip',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

const scanner = new FileScanner();
const DIST_DIRECTORY = path.join(__dirname, '..', 'dist');
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');

let mainWindow = null;
let serverProcess = null;

function startBackendServer() {
  const req = http.get('http://127.0.0.1:3001/api/files', () => {
    console.log('[Electron] Servidor backend activo detectado.');
  });

  req.on('error', () => {
    console.log('[Electron] Iniciando servidor backend embebido...');
    const serverPath = path.join(__dirname, '../server/index.js');
    try {
      serverProcess = fork(serverPath, [], {
        stdio: 'inherit',
        env: { ...process.env, PORT: '3001' }
      });
    } catch (e) {
      console.error('[Electron] Error iniciando servidor backend embebido:', e);
    }
  });
}

function createErrorResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function handleNexoipProtocol(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return createErrorResponse(405, 'Method not allowed');
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return createErrorResponse(400, 'Invalid request');
  }

  if (requestUrl.protocol !== 'nexoip:' || requestUrl.hostname !== 'app' || requestUrl.port) {
    return createErrorResponse(403, 'Forbidden');
  }

  const modelRoute = getModelRoute(requestUrl.pathname);
  if (modelRoute) {
    const modelFile = await scanner.resolveModelAsset(modelRoute.id, modelRoute.assetPath);
    if (!modelFile) {
      return createErrorResponse(404, 'Model not found');
    }

    return net.fetch(pathToFileURL(modelFile).toString());
  }

  const appAsset = getAppAssetPath(DIST_DIRECTORY, requestUrl.pathname);
  if (!appAsset) {
    return createErrorResponse(404, 'Asset not found');
  }

  return net.fetch(pathToFileURL(appAsset).toString());
}

function isTrustedRenderer(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return false;
  }

  const frame = event.senderFrame;
  if (!frame || frame !== frame.top) {
    return false;
  }

  return isAllowedRendererUrl(frame.url, app.isPackaged);
}

function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!isTrustedRenderer(event)) {
      throw new Error('Unauthorized IPC request.');
    }

    try {
      return await handler(payload);
    } catch {
      throw new Error('The request could not be completed.');
    }
  });
}

function registerIpcHandlers() {
  registerIpcHandler('nexoip:list-models', (filters) => scanner.listModels(normalizeFilters(filters)));
  registerIpcHandler('nexoip:get-tree', () => scanner.getTree());
  registerIpcHandler('nexoip:get-scan-status', () => scanner.getStatus());

  registerIpcHandler('nexoip:scan', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecciona las carpetas que quieres indexar',
      buttonLabel: 'Indexar carpetas seleccionadas',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { cancelled: true, status: scanner.getStatus() };
    }

    const result = await scanner.scanDirectories(selection.filePaths);
    return { cancelled: false, ...result };
  });

  registerIpcHandler('nexoip:reveal-model', (id) => {
    if (!isOpaqueId(id)) {
      throw new Error('Invalid model identifier.');
    }

    const modelPath = scanner.getModelPath(id);
    if (!modelPath) {
      throw new Error('Unknown model identifier.');
    }

    shell.showItemInFolder(modelPath);
    return { revealed: true };
  });

  registerIpcHandler('nexoip:register-dropped', async (droppedFile) => {
    if (!droppedFile || typeof droppedFile !== 'object' || typeof droppedFile.path !== 'string') {
      throw new Error('Invalid dropped file.');
    }

    return scanner.registerDroppedPath(droppedFile.path);
  });
}

function configureSession() {
  const currentSession = session.defaultSession;

  currentSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  currentSession.setPermissionCheckHandler(() => false);

  if (app.isPackaged) {
    currentSession.webRequest.onHeadersReceived((details, callback) => {
      if (!details.url.startsWith(PACKAGED_APP_ORIGIN)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'",
          ],
          'Permissions-Policy': ['camera=(), geolocation=(), microphone=(), payment=(), usb=()'],
          'Referrer-Policy': ['no-referrer'],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });
  }
}

function hardenWindow(webContents) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedNavigationUrl(navigationUrl, app.isPackaged)) {
      event.preventDefault();
    }
  });

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

async function createWindow() {
  startBackendServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'NexoIP 3D Viewer',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  hardenWindow(mainWindow.webContents);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (app.isPackaged) {
    await mainWindow.loadURL(`${PACKAGED_APP_ORIGIN}/`);
    return;
  }

  await mainWindow.loadURL(normalizeDevRendererUrl(process.env.ELECTRON_RENDERER_URL || DEV_RENDERER_URL));
}

app.whenReady().then(async () => {
  protocol.handle('nexoip', handleNexoipProtocol);
  configureSession();
  registerIpcHandlers();
  await createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
