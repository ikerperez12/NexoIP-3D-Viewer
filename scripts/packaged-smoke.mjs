import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const APP_PATH = path.resolve('release', 'win-unpacked', 'NexoIP 3D Viewer.exe');
const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');
const DIAGNOSTICS_DIRECTORY = path.resolve('test-results');
const TIMEOUT_MS = 25_000;
const REQUIRED_LOCALES = ['en-GB.pak', 'en-US.pak', 'es-419.pak', 'es.pak'];
const EXPECTED_BRIDGE = [
  'consumeStartupModel',
  'getModelUrl',
  'getScanStatus',
  'getTree',
  'listModels',
  'onModelOpened',
  'registerDropped',
  'revealModel',
  'scan',
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // The process may already have exited normally.
  }
}

async function poll(read, label, child, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label}: application exited with code ${child.exitCode}.`);
    }

    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }

    await delay(150);
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`${label} timed out.${detail}`);
}

class CdpClient {
  #socket;
  #nextId = 0;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', ({ data }) => {
      try {
        const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
        const message = JSON.parse(text);
        if (!Number.isInteger(message.id)) return;

        const pending = this.#pending.get(message.id);
        if (!pending) return;

        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message || JSON.stringify(message.error)}`));
        } else {
          pending.resolve(message.result);
        }
      } catch (error) {
        this.#rejectAll(error);
      }
    });
    socket.addEventListener('error', () => this.#rejectAll(new Error('The CDP WebSocket failed.')));
    socket.addEventListener('close', () => this.#rejectAll(new Error('The CDP WebSocket closed unexpectedly.')));
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}: CDP socket is not open.`));
    }

    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);

      this.#pending.set(id, { method, resolve, reject, timer });
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });

    if (response.exceptionDetails) {
      throw new Error(`Runtime.evaluate failed: ${response.exceptionDetails.text || 'unknown exception'}`);
    }

    return response.result?.value;
  }

  close() {
    this.#rejectAll(new Error('CDP client closed.'));
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.close(1000, 'done');
  }

  #rejectAll(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

async function openWebSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket open timed out.')), 10_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP WebSocket could not be opened.'));
    }, { once: true });
  });
  return socket;
}

async function main() {
  assert(process.platform === 'win32', 'This packaged smoke check targets Windows x64.');
  assert(fs.existsSync(APP_PATH), `Missing packaged executable: ${APP_PATH}`);
  assert(fs.existsSync(FIXTURE_PATH), `Missing model fixture: ${FIXTURE_PATH}`);
  for (const locale of REQUIRED_LOCALES) {
    assert(fs.existsSync(path.join(path.dirname(APP_PATH), 'locales', locale)),
      `Missing packaged locale: ${locale}`);
  }

  const port = await reserveLoopbackPort();
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexoip-smoke-'));
  const electronLogPath = path.join(profileDirectory, 'electron-debug.log');
  const processLogs = [];
  const child = spawn(APP_PATH, [
    FIXTURE_PATH,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDirectory}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--lang=en-US',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-logging=file',
    `--log-file=${electronLogPath}`,
  ], {
    cwd: path.dirname(APP_PATH),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => processLogs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => processLogs.push(chunk.toString()));
  child.on('exit', (code, signal) => processLogs.push(`\n[process exited: code=${code}, signal=${signal}]\n`));

  let cdp;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    const target = await poll(async () => {
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) return null;
      const targets = await response.json();
      return targets.find((candidate) => candidate.type === 'page'
        && candidate.url?.startsWith('nexoip://app/')
        && candidate.webSocketDebuggerUrl);
    }, 'Waiting for packaged renderer target', child);

    cdp = new CdpClient(await openWebSocket(target.webSocketDebuggerUrl));
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const state = await poll(async () => {
      const result = await cdp.evaluate(`(() => {
        const normalized = (value) => value
          ?.normalize('NFD')
          .replace(/\\p{Diacritic}/gu, '')
          .trim()
          .toLowerCase();
        const polygonsLabel = [...document.querySelectorAll('span')]
          .find((element) => normalized(element.textContent) === 'poligonos');
        return {
          title: document.title,
          main: Boolean(document.querySelector('main[aria-label="NexoIP 3D Viewer"]')),
          bridge: Object.keys(globalThis.nexoip ?? {}).sort(),
          modelLoaded: [...document.querySelectorAll('button')]
            .some((button) => button.textContent?.includes('nexoip-sample.stl')),
          polygons: polygonsLabel?.parentElement?.querySelector('p')?.textContent?.trim() ?? null,
          runtimeUrls: performance.getEntriesByType('resource').map(({ name }) => name),
        };
      })()`);
      return result?.main && result.modelLoaded && result.polygons === '6' ? result : null;
    }, 'Waiting for packaged fixture to render', child);

    assert(state.title === 'NexoIP 3D Viewer', `Unexpected window title: ${state.title}`);
    assert(JSON.stringify(state.bridge) === JSON.stringify(EXPECTED_BRIDGE),
      `Unexpected preload bridge: ${JSON.stringify(state.bridge)}`);
    assert(state.runtimeUrls.every((url) => url.startsWith('nexoip://')
      || url.startsWith('blob:')
      || url.startsWith('data:')),
    `Unexpected runtime resource URL: ${state.runtimeUrls.join(', ')}`);

    const screenshotPath = process.env.NEXOIP_SMOKE_SCREENSHOT;
    if (screenshotPath) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const absoluteScreenshotPath = path.resolve(screenshotPath);
      fs.mkdirSync(path.dirname(absoluteScreenshotPath), { recursive: true });
      fs.writeFileSync(absoluteScreenshotPath, Buffer.from(data, 'base64'));
    }

    console.log('Packaged smoke passed: renderer, preload bridge, STL geometry and local-only resources verified.');
  } catch (error) {
    fs.mkdirSync(DIAGNOSTICS_DIRECTORY, { recursive: true });
    const electronLog = fs.existsSync(electronLogPath)
      ? fs.readFileSync(electronLogPath, 'utf8')
      : '(no Electron debug log was created)';
    const diagnostic = [
      error instanceof Error ? error.stack || error.message : String(error),
      '\nElectron output:\n',
      processLogs.join(''),
      '\nElectron debug log:\n',
      electronLog,
    ].join('');
    fs.writeFileSync(path.join(DIAGNOSTICS_DIRECTORY, 'packaged-smoke.log'), diagnostic, 'utf8');
    throw new Error(diagnostic, { cause: error });
  } finally {
    cdp?.close();
    stopProcessTree(child);
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Chromium can retain a profile handle briefly after its process tree exits.
    }
  }
}

await main();
