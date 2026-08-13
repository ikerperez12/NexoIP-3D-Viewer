import { chromium, expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const APP_PATH = path.resolve('release', 'win-unpacked', 'NexoIP 3D Viewer.exe');
const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForCdp(port, processLogs) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return endpoint;
    } catch {
      // The packaged process needs a moment to create its Chromium endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Packaged app did not expose its test CDP endpoint.\n${processLogs.join('')}`);
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // The process may already have closed normally.
  }
}

test('packaged app opens a local model and keeps its primary controls usable', async ({ browserName: _browserName }, testInfo) => {
  test.skip(process.platform !== 'win32', 'Official packages currently target Windows x64.');
  expect(fs.existsSync(APP_PATH), `Missing packaged executable: ${APP_PATH}`).toBe(true);

  const port = await reservePort();
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexoip-e2e-'));
  const processLogs = [];
  const appProcess = spawn(APP_PATH, [
    FIXTURE_PATH,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    '--disable-background-networking',
    '--disable-component-update',
  ], {
    cwd: path.dirname(APP_PATH),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  appProcess.stdout.on('data', (chunk) => processLogs.push(chunk.toString()));
  appProcess.stderr.on('data', (chunk) => processLogs.push(chunk.toString()));

  let browser;
  try {
    const endpoint = await waitForCdp(port, processLogs);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    await expect.poll(() => context.pages().some((candidate) => candidate.url().startsWith('nexoip://'))).toBe(true);
    const appPage = context.pages().find((candidate) => candidate.url().startsWith('nexoip://'));
    const pageErrors = [];
    const consoleErrors = [];
    appPage.on('pageerror', (error) => pageErrors.push(error.message));
    appPage.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await appPage.waitForLoadState('domcontentloaded');
    await expect(appPage).toHaveTitle('NexoIP 3D Viewer');
    await expect(appPage.locator('main[aria-label="NexoIP 3D Viewer"]')).toBeVisible();
    await expect(appPage.getByRole('complementary', { name: 'Biblioteca de modelos locales' })).toBeVisible();
    await expect(appPage.getByRole('complementary', { name: 'Propiedades del modelo' })).toBeVisible();

    const bridgeMethods = await appPage.evaluate(() => Object.keys(window.nexoip || {}).sort());
    expect(bridgeMethods).toEqual([
      'consumeStartupModel', 'getModelUrl', 'getScanStatus', 'getTree', 'listModels', 'onModelOpened',
      'registerDropped', 'revealModel', 'scan',
    ]);

    const blobWorkerResult = await appPage.evaluate(() => new Promise((resolve, reject) => {
      const workerUrl = URL.createObjectURL(new Blob(['postMessage("ready")'], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      const timeout = setTimeout(() => reject(new Error('Blob worker timed out.')), 5_000);
      worker.addEventListener('message', (event) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve(event.data);
      }, { once: true });
      worker.addEventListener('error', (event) => {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        reject(new Error(event.message || 'Blob worker failed.'));
      }, { once: true });
    }));
    expect(blobWorkerResult).toBe('ready');

    const initialFit = await appPage.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    expect(initialFit.width).toBeGreaterThanOrEqual(1200);
    expect(initialFit.height).toBeGreaterThanOrEqual(780);
    expect(initialFit).toMatchObject({ canScrollX: false, canScrollY: false });

    const clippedAtLaunch = await appPage.evaluate(() => {
      const elements = document.querySelectorAll('header button, header select, aside');
      return [...elements].filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight;
      }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40));
    });
    expect(clippedAtLaunch).toEqual([]);

    const orthoButton = appPage.getByRole('button', { name: 'Usar cámara ortográfica' });
    await orthoButton.click();
    await expect(appPage.getByRole('button', { name: 'Usar cámara perspectiva' })).toHaveAttribute('aria-pressed', 'true');
    await appPage.getByRole('button', { name: 'Usar cámara perspectiva' }).click();
    await expect(appPage.getByRole('button', { name: 'Usar cámara ortográfica' })).toHaveAttribute('aria-pressed', 'false');

    const gridButton = appPage.getByRole('button', { name: 'Mostrar u ocultar rejilla' });
    await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
    await gridButton.click();
    await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
    await gridButton.click();

    await appPage.getByRole('button', { name: 'Malla' }).click();
    await expect(appPage.getByRole('button', { name: 'Malla' })).toHaveAttribute('aria-pressed', 'true');
    await appPage.getByRole('button', { name: 'PBR' }).click();
    await appPage.getByLabel('Iluminación y fondo de la escena').selectOption('cyberpunk');
    await expect(appPage.getByLabel('Iluminación y fondo de la escena')).toHaveValue('cyberpunk');
    await appPage.getByLabel('Iluminación y fondo de la escena').selectOption('studio_pro');

    await appPage.getByRole('button', { name: 'Cerrar biblioteca de modelos', exact: true }).click();
    await expect(appPage.getByRole('complementary', { name: 'Biblioteca de modelos locales' })).toBeHidden();
    await appPage.getByRole('button', { name: 'Abrir biblioteca de modelos' }).click();
    await expect(appPage.getByRole('complementary', { name: 'Biblioteca de modelos locales' })).toBeVisible();

    await expect.poll(async () => {
      if (await appPage.getByRole('button', { name: 'stl nexoip-sample.stl', exact: true }).isVisible().catch(() => false)) return 'loaded';
      const alert = appPage.locator('[role="alert"]').last();
      return await alert.isVisible().catch(() => false) ? `error: ${await alert.textContent()}` : 'pending';
    }, { message: 'The file chooser should register the selected local model.' }).toBe('loaded');
    await expect(appPage.getByRole('button', { name: 'stl nexoip-sample.stl', exact: true })).toBeVisible();
    const polygonsCard = appPage.getByText('Polígonos').locator('..');
    await expect(polygonsCard).toContainText('6');
    await expect(appPage.getByText('Dimensiones 3D')).toBeVisible();

    const runtimeUrls = await appPage.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
    expect(runtimeUrls.every((url) => url.startsWith('nexoip://') || url.startsWith('blob:') || url.startsWith('data:'))).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    const screenshotPath = process.env.CI
      ? testInfo.outputPath('packaged-app.png')
      : path.resolve('.github', 'assets', 'nexoip-3d-viewer.png');
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await appPage.waitForTimeout(3_600);
    await appPage.screenshot({ path: screenshotPath, type: 'png' });

    await appPage.setViewportSize({ width: 900, height: 600 });
    await expect.poll(() => appPage.evaluate(() => window.innerWidth)).toBe(900);
    const minimumFit = await appPage.evaluate(() => {
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Herramientas de visualización"]');
      const elements = document.querySelectorAll('header button, header select, aside');
      const clipped = [...elements].filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight;
      }).map((element) => element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40));
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        toolbarOverflow: toolbar.scrollWidth > toolbar.clientWidth,
        clipped,
      };
    });
    expect(minimumFit.width).toBeGreaterThanOrEqual(860);
    expect(minimumFit.height).toBeGreaterThanOrEqual(540);
    expect(minimumFit).toMatchObject({ canScrollX: false, canScrollY: false, toolbarOverflow: false, clipped: [] });
  } finally {
    await browser?.close().catch(() => undefined);
    stopProcessTree(appProcess);
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can retain a Chromium profile handle briefly after the process tree exits.
    }
  }
});
