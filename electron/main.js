import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FileScanner } from './file-scanner.js';
import { createSecureModelResponse } from './protocol-response.js';
import {
  loadPackagedSelfTestConfig,
  runPackagedSelfTest,
  writePackagedSelfTestReport,
} from './packaged-self-test.js';
import {
  DEV_RENDERER_URL,
  PACKAGED_APP_ORIGIN,
  getAppAssetPath,
  getModelAssetMimeType,
  getModelRoute,
  isAllowedNavigationUrl,
  isAllowedRendererUrl,
  isOpaqueId,
  normalizeFilters,
  normalizeDevRendererUrl,
} from './security.js';
import { findUnsafePackagedArguments, getPackagedSelfTestRequest } from './startup-policy.js';

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
const startupArguments = process.argv.slice(app.isPackaged ? 1 : 2);
let pendingStartupPath = startupArguments.find((argument) => path.isAbsolute(argument)) || null;
const unsafeStartupArguments = app.isPackaged ? findUnsafePackagedArguments(startupArguments) : [];
const packagedSelfTestRequest = app.isPackaged ? getPackagedSelfTestRequest(startupArguments) : null;
const startupIsAllowed = unsafeStartupArguments.length === 0 && (!packagedSelfTestRequest || packagedSelfTestRequest.valid);

if (!startupIsAllowed) {
  const reason = unsafeStartupArguments.length > 0
    ? `Unsafe packaged startup argument rejected: ${unsafeStartupArguments.join(', ')}`
    : packagedSelfTestRequest.reason;
  process.stderr.write(`NexoIP 3D Viewer refused to start. ${reason}\n`);
  app.exit(78);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
}

async function openModelFromCommandLine(candidatePath) {
  if (!candidatePath || !path.isAbsolute(candidatePath)) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) {
    pendingStartupPath = candidatePath;
    return;
  }

  try {
    const model = await scanner.registerDroppedPath(candidatePath);
    mainWindow.webContents.send('nexoip:model-opened', model);
  } catch {
    // Invalid, missing, oversized, and unsupported arguments are ignored safely.
  }
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
    const modelAsset = await scanner.openModelAsset(modelRoute.id, modelRoute.assetPath);
    if (!modelAsset) {
      return createErrorResponse(404, 'Model not found');
    }

    return createSecureModelResponse(request.method, modelAsset, getModelAssetMimeType(modelAsset.path));
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
  registerIpcHandler('nexoip:cancel-scan', () => scanner.cancelScan());
  registerIpcHandler('nexoip:consume-startup-model', async () => {
    if (!pendingStartupPath) return null;
    const startupPath = pendingStartupPath;
    pendingStartupPath = null;
    return scanner.registerDroppedPath(startupPath);
  });

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
    return { cancelled: result.status === 'cancelled', ...result };
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
            "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:",
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

async function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'NexoIP 3D Viewer',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show,
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

async function runConfiguredPackagedSelfTest() {
  const config = await loadPackagedSelfTestConfig(packagedSelfTestRequest);
  const report = await runPackagedSelfTest({
    scanner,
    config,
    renderer: mainWindow.webContents,
    window: mainWindow,
  });
  await writePackagedSelfTestReport(config.resultPath, report);
  if (report.status !== 'passed') {
    throw new Error(report.error || 'The packaged self-test failed.');
  }
  process.stdout.write('NexoIP packaged self-test passed without a debugging transport.\n');
}

if (startupIsAllowed) {
  app.whenReady().then(async () => {
    try {
      protocol.handle('nexoip', handleNexoipProtocol);
      configureSession();
      registerIpcHandlers();
      await createWindow({ show: !packagedSelfTestRequest });
      if (packagedSelfTestRequest) {
        await runConfiguredPackagedSelfTest();
        app.quit();
      }
    } catch (error) {
      process.stderr.write(`NexoIP 3D Viewer failed to start safely: ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });

  app.on('second-instance', (_event, commandLine) => {
    const candidate = commandLine.find((argument, index) => index > 0 && path.isAbsolute(argument));
    if (candidate) void openModelFromCommandLine(candidate);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
