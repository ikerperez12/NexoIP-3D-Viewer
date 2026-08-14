import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_PATH = path.resolve('release', 'win-unpacked', 'NexoIP 3D Viewer.exe');
const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');
const DIAGNOSTICS_DIRECTORY = path.resolve('test-results');
const TIMEOUT_MS = 60_000;
const REQUIRED_LOCALES = ['en-GB.pak', 'en-US.pak', 'es-419.pak', 'es.pak'];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertAccessibilityResponsiveEvidence(report) {
  const evidence = report.checks?.accessibilityResponsive;
  assert(evidence?.scope?.claim === 'targeted packaged accessibility and responsive evidence',
    'Packaged self-test did not state its targeted accessibility evidence scope.');
  assert(typeof evidence?.scope?.limitations === 'string' && evidence.scope.limitations.includes('not a complete WCAG conformance'),
    'Packaged self-test did not record its accessibility evidence limitation.');
  assert(evidence?.viewport?.actualWindow?.width === 900 && evidence.viewport.actualWindow.height === 600,
    'Packaged self-test did not run the minimum 900x600 accessibility viewport.');
  assert(evidence.viewport.requestedZoomFactor === 2 && evidence.viewport.actualZoomFactor === 2,
    'Packaged self-test did not run at 200% zoom.');
  assert(evidence?.globalOverflow?.horizontal === false && evidence.globalOverflow.vertical === false
    && evidence.globalOverflow.toleranceCssPixels === 1
    && evidence.globalOverflow.allEssentialActionsInsideViewport === true,
  'Packaged accessibility viewport reported global overflow or a hidden essential action.');
  for (const action of ['openLocal', 'library', 'camera']) {
    const result = evidence?.essentialActions?.[action];
    assert(result?.visible === true && result.insideViewport === true && result.focusable === true,
      `Packaged accessibility self-test did not expose the ${action} action.`);
  }
  assert(evidence.essentialActions.openLocal.enabled === true && evidence.essentialActions.openLocal.controlsNativeFileInput === true,
    'Packaged local-open action was not enabled and connected to its native file input.');
  assert(evidence.essentialActions.library.toggles === true && evidence.essentialActions.camera.toggles === true
    && evidence.essentialActions.camera.menuInsideViewport === true && evidence.essentialActions.camera.menuScrollable === true
    && evidence.essentialActions.camera.menuOverflowYScrollable === true,
    'Packaged library or camera action was not operable.');
  assert(evidence?.semantics?.main === true && evidence.semantics.tabs?.valid === true
    && evidence.semantics.tabs.count >= 2 && evidence.semantics.tabs.arrowNavigation === true
    && evidence.semantics.dialog?.valid === true && evidence.semantics.liveRegions?.valid === true
    && evidence.semantics.liveRegions.count >= 1,
  'Packaged accessibility semantics were incomplete.');
  assert(evidence?.keyboard?.viewportFocused === true && evidence.keyboard.arrowsHandled === true
    && evidence.keyboard.arrowsMovedCamera === true && evidence.keyboard.shiftArrowsHandled === true
    && evidence.keyboard.shiftArrowsMovedCamera === true,
  'Packaged viewport keyboard controls did not move the camera for Arrow/Shift+Arrow.');
  assert(Number.isFinite(evidence?.restoredWindow?.width) && Number.isFinite(evidence?.restoredWindow?.height)
    && Number.isFinite(evidence?.restoredZoomFactor),
  'Packaged self-test did not record restored window state.');
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // The process may already have exited normally.
  }
}

function waitForExit(child, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function pollForFile(filePath, child, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    if (child.exitCode !== null) return;
    await delay(100);
  }
  throw new Error(`${label} timed out.`);
}

function createSelfTestCapability(profileDirectory) {
  const token = randomBytes(32).toString('hex');
  const tokenDigest = createHash('sha256').update(token).digest('hex');
  const nonce = randomBytes(16).toString('hex');
  const configPath = path.join(profileDirectory, `nexoip-packaged-self-test-${nonce}.json`);
  const resultPath = path.join(profileDirectory, `result-${nonce}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify({
    version: 1,
    token,
    fixturePath: FIXTURE_PATH,
    resultPath,
  })}\n`, { encoding: 'utf8', mode: 0o600 });
  return { configPath, resultPath, tokenDigest };
}

async function assertDangerousArgumentsAreRejected(profileDirectory) {
  // Deliberate negative test: this proves the distributed executable rejects CDP
  // before it creates a BrowserWindow. It never connects to or uses the endpoint.
  const child = spawn(APP_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${profileDirectory}`,
  ], {
    cwd: path.dirname(APP_PATH),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    const result = await waitForExit(child, 10_000, 'Dangerous startup argument rejection');
    assert(result.code === 78, `Unsafe startup argument was not rejected with exit code 78 (got ${result.code}).`);
    assert(logs.join('').includes('Unsafe packaged startup argument rejected'),
      `Unsafe startup rejection did not produce diagnostics: ${logs.join('')}`);
  } finally {
    stopProcessTree(child);
  }
}

async function runPackagedSelfTest(profileDirectory) {
  const capability = createSelfTestCapability(profileDirectory);
  const processLogs = [];
  const child = spawn(APP_PATH, [
    `--nexoip-self-test=${capability.configPath}`,
    `--nexoip-self-test-token-sha256=${capability.tokenDigest}`,
    `--user-data-dir=${profileDirectory}`,
  ], {
    cwd: path.dirname(APP_PATH),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => processLogs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => processLogs.push(chunk.toString()));
  child.on('exit', (code, signal) => processLogs.push(`\n[process exited: code=${code}, signal=${signal}]\n`));

  try {
    await pollForFile(capability.resultPath, child, 'Waiting for packaged self-test result');
    const result = await waitForExit(child, TIMEOUT_MS, 'Packaged self-test process');
    assert(fs.existsSync(capability.resultPath), 'Packaged self-test did not produce a report.');

    const report = JSON.parse(fs.readFileSync(capability.resultPath, 'utf8'));
    assert(report.status === 'passed', `Packaged self-test failed: ${report.error || JSON.stringify(report)}`);
    assert(result.code === 0, `Packaged self-test exited with code ${result.code}.`);
    assert(report.checks?.localRenderer?.url === 'nexoip://app/', 'Packaged renderer did not load the local app origin.');
    assert(report.checks?.localRenderer?.title === 'NexoIP 3D Viewer', 'Packaged renderer title was unexpected.');
    assert(report.checks?.fixture?.name === path.basename(FIXTURE_PATH), 'Packaged fixture was not registered.');
    assert(report.checks?.fixture?.bytesRead > 0, 'Packaged fixture was not read through the secure asset handle.');
    assert(report.checks?.preloadContract?.available === true, 'Packaged preload bridge was not available.');
    assert(report.checks?.preloadContract?.modelBytes === report.checks?.fixture?.size,
      'Packaged model protocol did not return the complete approved fixture.');
    assert(Array.isArray(report.checks?.bundledRuntimes) && report.checks.bundledRuntimes.length === 4,
      'Packaged Draco/Basis runtime report was incomplete.');
    assert(report.checks.bundledRuntimes.every((runtime) => runtime.status === 200 && runtime.bytes > 0),
      `A packaged Draco/Basis runtime was unavailable: ${JSON.stringify(report.checks.bundledRuntimes)}`);
    assertAccessibilityResponsiveEvidence(report);
    assert(processLogs.join('').includes('without a debugging transport'),
      `Packaged self-test did not confirm its transport policy: ${processLogs.join('')}`);
  } catch (error) {
    fs.mkdirSync(DIAGNOSTICS_DIRECTORY, { recursive: true });
    if (fs.existsSync(capability.resultPath)) {
      fs.copyFileSync(capability.resultPath, path.join(DIAGNOSTICS_DIRECTORY, 'packaged-smoke-report.json'));
    }
    const diagnostic = [
      error instanceof Error ? error.stack || error.message : String(error),
      '\nPackaged process output:\n',
      processLogs.join(''),
    ].join('');
    fs.writeFileSync(path.join(DIAGNOSTICS_DIRECTORY, 'packaged-smoke.log'), diagnostic, 'utf8');
    throw new Error(diagnostic, { cause: error });
  } finally {
    stopProcessTree(child);
  }
}

async function main() {
  assert(process.platform === 'win32', 'This packaged smoke check targets Windows x64.');
  assert(fs.existsSync(APP_PATH), `Missing packaged executable: ${APP_PATH}`);
  assert(fs.existsSync(FIXTURE_PATH), `Missing model fixture: ${FIXTURE_PATH}`);
  for (const locale of REQUIRED_LOCALES) {
    assert(fs.existsSync(path.join(path.dirname(APP_PATH), 'locales', locale)),
      `Missing packaged locale: ${locale}`);
  }

  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexoip-smoke-'));
  try {
    await assertDangerousArgumentsAreRejected(profileDirectory);
    await runPackagedSelfTest(profileDirectory);
    console.log('Packaged smoke passed: unsafe flags rejected; local renderer, targeted accessibility/responsive evidence, and fixture self-test passed without CDP.');
  } finally {
    try {
      fs.rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Chromium can retain profile handles briefly after its process tree exits.
    }
  }
}

await main();
