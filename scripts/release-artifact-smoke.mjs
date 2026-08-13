import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..');
const RELEASE_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'release');
const FIXTURE_PATH = path.join(REPOSITORY_DIRECTORY, 'tests', 'fixtures', 'nexoip-sample.stl');
const DIAGNOSTICS_DIRECTORY = path.join(REPOSITORY_DIRECTORY, 'test-results');
const TEMPORARY_ROOT_PREFIX = 'nexoip-release-artifact-smoke-';
const SELF_TEST_TIMEOUT_MS = 25_000;
const INSTALLER_TIMEOUT_MS = 90_000;
const UNINSTALLER_TIMEOUT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const MAX_CAPTURED_OUTPUT_BYTES = 128 * 1024;
const POLL_INTERVAL_MS = 100;
const ELECTRON_BUILDER_UUID_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3';

const diagnosticEvents = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logDiagnostic(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  diagnosticEvents.push(line);
  console.log(line);
}

function listReleaseExecutables() {
  if (!fs.existsSync(RELEASE_DIRECTORY)) return '(release directory is missing)';
  return fs.readdirSync(RELEASE_DIRECTORY)
    .filter((entry) => entry.toLowerCase().endsWith('.exe'))
    .sort()
    .join(', ') || '(no .exe files found)';
}

function readReleaseMetadata() {
  const packagePath = path.join(REPOSITORY_DIRECTORY, 'package.json');
  const packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const build = packageMetadata.build;

  assert(typeof packageMetadata.version === 'string' && packageMetadata.version.length > 0,
    'package.json must declare a package version.');
  assert(typeof packageMetadata.name === 'string' && packageMetadata.name.length > 0,
    'package.json must declare a package name.');
  assert(/^[a-z0-9._-]+$/i.test(packageMetadata.name),
    'package.json name must be safe for the NSIS updater-cache guard.');
  assert(typeof build?.appId === 'string' && build.appId.length > 0,
    'package.json must declare build.appId for the NSIS installation guard.');
  assert(typeof build?.productName === 'string' && build.productName.length > 0,
    'package.json must declare build.productName.');
  assert(typeof build?.nsis?.artifactName === 'string' && typeof build?.portable?.artifactName === 'string',
    'package.json must declare explicit NSIS and portable artifact names.');

  const installerArtifact = build.nsis.artifactName
    .replace('${version}', packageMetadata.version)
    .replace('${arch}', 'x64')
    .replace('${ext}', 'exe');
  const portableArtifact = build.portable.artifactName
    .replace('${version}', packageMetadata.version)
    .replace('${arch}', 'x64')
    .replace('${ext}', 'exe');
  const productFilename = build.win?.executableName || build.executableName || build.productName;
  const shortcutName = build.nsis.shortcutName || build.productName;
  const localAppData = process.env.LOCALAPPDATA;
  assert(typeof localAppData === 'string' && path.isAbsolute(localAppData),
    'LOCALAPPDATA is required for the NSIS updater-cache guard.');

  for (const [label, value] of Object.entries({ installerArtifact, portableArtifact, productFilename, shortcutName })) {
    assert(typeof value === 'string' && value.length > 0 && !/[\\/]/.test(value),
      `Unsafe ${label} derived from package.json.`);
  }

  return {
    appId: build.appId,
    installerPath: path.join(RELEASE_DIRECTORY, installerArtifact),
    portablePath: path.join(RELEASE_DIRECTORY, portableArtifact),
    productFilename,
    shortcutName,
    nsisGuid: build.nsis.guid,
    updaterCachePath: path.join(localAppData, `${packageMetadata.name.toLowerCase()}-updater`),
  };
}

function assertRegularFile(filePath, label) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    throw new Error(`Missing ${label}: ${filePath}. Available release executables: ${listReleaseExecutables()}`);
  }
  assert(stats.isFile(), `${label} is not a regular file: ${filePath}`);
}

function isPathInside(parentDirectory, candidatePath) {
  const relative = path.relative(parentDirectory, candidatePath);
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertTemporaryChild(temporaryRoot, candidatePath, label) {
  const resolvedRoot = path.resolve(temporaryRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  assert(isPathInside(resolvedRoot, resolvedCandidate), `${label} must stay inside the temporary smoke-test root.`);
  return resolvedCandidate;
}

function assertOwnedTemporaryDirectory(temporaryRoot, temporaryBase) {
  const resolvedRoot = path.resolve(temporaryRoot);
  const resolvedBase = fs.realpathSync(temporaryBase);
  assert(path.dirname(resolvedRoot) === resolvedBase, 'Refusing to clean a temporary directory with an unexpected parent.');
  assert(path.basename(resolvedRoot).startsWith(TEMPORARY_ROOT_PREFIX), 'Refusing to clean a directory without the smoke-test prefix.');
  const stats = fs.lstatSync(resolvedRoot);
  assert(stats.isDirectory() && !stats.isSymbolicLink(), 'Refusing to clean a non-directory or symbolic-link temporary root.');
}

async function removeOwnedTemporaryDirectory(temporaryRoot, temporaryBase) {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    if (!fs.existsSync(temporaryRoot)) return;
    assertOwnedTemporaryDirectory(temporaryRoot, temporaryBase);
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      if (!fs.existsSync(temporaryRoot)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`Temporary smoke-test directory was not removed: ${temporaryRoot}`);
}

function appendCapturedOutput(output, chunk) {
  const text = Buffer.from(chunk).toString('utf8');
  const capturedBytes = output.reduce((total, entry) => total + Buffer.byteLength(entry), 0);
  const remainingBytes = MAX_CAPTURED_OUTPUT_BYTES - capturedBytes;
  if (remainingBytes <= 0) return;
  output.push(text.slice(0, remainingBytes));
}

function startProcess(executable, argumentsList, { cwd, env, label }) {
  const output = [];
  logDiagnostic(`${label}: ${JSON.stringify([executable, ...argumentsList])}`);
  const child = spawn(executable, argumentsList, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => appendCapturedOutput(output, chunk));
  child.stderr.on('data', (chunk) => appendCapturedOutput(output, chunk));

  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, completion, output, label };
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    // A process that has already exited does not need further cleanup.
  }
}

async function waitForProcess(launched, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      launched.completion,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${launched.label} timed out after ${timeoutMs} ms.`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    stopProcessTree(launched.child);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runProcess(executable, argumentsList, options) {
  const launched = startProcess(executable, argumentsList, options);
  try {
    const result = await waitForProcess(launched, options.timeoutMs);
    logDiagnostic(`${options.label}: exited with code=${result.code}, signal=${result.signal}.`);
    return { ...result, output: launched.output.join('') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.label} failed: ${message}\nProcess output:\n${launched.output.join('')}`, { cause: error });
  } finally {
    stopProcessTree(launched.child);
  }
}

async function waitForFile(filePath, launched, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    if (launched.child.exitCode !== null || launched.child.signalCode !== null) {
      throw new Error(`${label} exited before producing ${filePath}.`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} timed out waiting for ${filePath}.`);
}

async function waitForAbsence(filePath, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(filePath)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} did not remove ${filePath}.`);
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

function createSmokeEnvironment(temporaryDirectory) {
  return {
    ...process.env,
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
  };
}

async function runCapabilitySelfTest({ executablePath, artifactLabel, profileDirectory, temporaryDirectory }) {
  fs.mkdirSync(profileDirectory, { recursive: true });
  const capability = createSelfTestCapability(profileDirectory);
  const launched = startProcess(executablePath, [
    `--nexoip-self-test=${capability.configPath}`,
    `--nexoip-self-test-token-sha256=${capability.tokenDigest}`,
    `--user-data-dir=${profileDirectory}`,
  ], {
    cwd: path.dirname(executablePath),
    env: createSmokeEnvironment(temporaryDirectory),
    label: `${artifactLabel} capability self-test without CDP`,
  });

  try {
    await waitForFile(capability.resultPath, launched, SELF_TEST_TIMEOUT_MS, `${artifactLabel} capability self-test`);
    const processResult = await waitForProcess(launched, SELF_TEST_TIMEOUT_MS);
    assert(processResult.code === 0,
      `${artifactLabel} capability self-test exited with code ${processResult.code} (signal ${processResult.signal}).`);
    assertRegularFile(capability.resultPath, `${artifactLabel} self-test report`);

    const report = JSON.parse(fs.readFileSync(capability.resultPath, 'utf8'));
    assert(report.status === 'passed', `${artifactLabel} capability self-test failed: ${report.error || JSON.stringify(report)}`);
    assert(report.checks?.localRenderer?.url === 'nexoip://app/', `${artifactLabel} did not load the local renderer origin.`);
    assert(report.checks?.localRenderer?.title === 'NexoIP 3D Viewer', `${artifactLabel} renderer title was unexpected.`);
    assert(report.checks?.fixture?.name === path.basename(FIXTURE_PATH), `${artifactLabel} did not register the self-test fixture.`);
    assert(report.checks?.fixture?.bytesRead > 0, `${artifactLabel} did not read the fixture through the capability boundary.`);
    assert(report.checks?.preloadContract?.available === true,
      `${artifactLabel} self-test did not expose the expected preload bridge.`);
    assert(Number.isSafeInteger(report.checks?.preloadContract?.modelBytes)
      && report.checks.preloadContract.modelBytes > 0
      && report.checks.preloadContract.modelBytes === report.checks.fixture.size,
    `${artifactLabel} self-test did not read the complete approved model through the bridge.`);
    assert(report.checks?.preloadContract?.noDebuggingTransport === true,
      `${artifactLabel} self-test did not confirm its no-CDP transport policy.`);
    assert(Array.isArray(report.checks?.bundledRuntimes) && report.checks.bundledRuntimes.length === 4,
      `${artifactLabel} self-test did not report packaged Draco/Basis runtimes.`);
    assert(report.checks.bundledRuntimes.every((runtime) => runtime?.status === 200
      && Number.isSafeInteger(runtime.bytes) && runtime.bytes > 0),
    `${artifactLabel} self-test reported a missing or empty packaged Draco/Basis runtime.`);
    logDiagnostic(`${artifactLabel}: capability self-test passed without CDP.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${artifactLabel} capability self-test failed: ${message}\nProcess output:\n${launched.output.join('')}`, { cause: error });
  } finally {
    stopProcessTree(launched.child);
  }
}

function uuidToBytes(uuid) {
  assert(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(uuid), `Invalid UUID: ${uuid}`);
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

function uuidV5(name, namespace) {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hexadecimal = hash.subarray(0, 16).toString('hex');
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}

function getNsisUninstallRegistryKey(metadata) {
  const guid = metadata.nsisGuid || uuidV5(metadata.appId, ELECTRON_BUILDER_UUID_NAMESPACE);
  assert(/^[a-f\d-]{36}$/i.test(guid), 'NSIS guid must be a UUID.');
  return `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
}

function registryKeyExists(rootKey, registryPath) {
  const result = spawnSync('reg.exe', ['query', `${rootKey}\\${registryPath}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Unable to inspect ${rootKey}\\${registryPath}: ${result.stderr || result.stdout || `reg.exe exited ${result.status}`}`);
}

function assertNoExistingNsisInstallation(metadata) {
  const registryPath = getNsisUninstallRegistryKey(metadata);
  const existingRoots = ['HKCU', 'HKLM'].filter((rootKey) => registryKeyExists(rootKey, registryPath));
  assert(existingRoots.length === 0,
    `Refusing to run the NSIS smoke test because an existing NexoIP installation was found in ${existingRoots.join(', ')}. Uninstall it first; this guard prevents the artifact installer from replacing a real installation.`);
  return registryPath;
}

async function waitForNsisInstallationRemoval(registryPath) {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  let remainingRoots = [];
  while (Date.now() < deadline) {
    remainingRoots = ['HKCU', 'HKLM'].filter((rootKey) => registryKeyExists(rootKey, registryPath));
    if (remainingRoots.length === 0) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`NSIS uninstall cleanup left registry entries in ${remainingRoots.join(', ')}.`);
}

function getShortcutPaths(shortcutName) {
  const userProfile = process.env.USERPROFILE;
  const appData = process.env.APPDATA;
  assert(typeof userProfile === 'string' && userProfile.length > 0, 'USERPROFILE is required for the NSIS shortcut safety guard.');
  assert(typeof appData === 'string' && appData.length > 0, 'APPDATA is required for the NSIS shortcut safety guard.');
  return [
    path.join(userProfile, 'Desktop', `${shortcutName}.lnk`),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${shortcutName}.lnk`),
  ];
}

function assertNoExistingShortcuts(shortcutPaths) {
  const existing = shortcutPaths.filter((shortcutPath) => fs.existsSync(shortcutPath));
  assert(existing.length === 0,
    `Refusing to run the NSIS smoke test because its shortcuts already exist: ${existing.join(', ')}. This guard prevents changes to user-managed shortcuts.`);
}

function assertNoExistingUpdaterCache(updaterCachePath) {
  assert(!fs.existsSync(updaterCachePath),
    `Refusing to run the NSIS smoke test because its updater cache already exists: ${updaterCachePath}. This guard prevents the test from changing a real installation cache.`);
}

function assertOwnedUpdaterCache({ updaterCachePath, installerPath }) {
  const localAppData = fs.realpathSync(process.env.LOCALAPPDATA);
  const resolvedCachePath = path.resolve(updaterCachePath);
  assert(isPathInside(localAppData, resolvedCachePath), 'NSIS updater cache must stay under LOCALAPPDATA.');
  assert(path.basename(resolvedCachePath).endsWith('-updater'), 'NSIS updater cache name is unexpected.');
  assertRegularFile(path.join(resolvedCachePath, 'installer.exe'), 'NSIS updater-cache installer');
  const cacheEntries = fs.readdirSync(resolvedCachePath).sort();
  assert(cacheEntries.length === 1 && cacheEntries[0] === 'installer.exe',
    `NSIS updater cache has unexpected contents: ${cacheEntries.join(', ')}`);
  const installedHash = createHash('sha256').update(fs.readFileSync(path.join(resolvedCachePath, 'installer.exe'))).digest('hex');
  const artifactHash = createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
  assert(installedHash === artifactHash, 'NSIS updater cache does not contain the installer artifact under test.');
}

function removeOwnedUpdaterCache(metadata) {
  if (!fs.existsSync(metadata.updaterCachePath)) return;
  assertOwnedUpdaterCache(metadata);
  fs.rmSync(metadata.updaterCachePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  assert(!fs.existsSync(metadata.updaterCachePath), `NSIS updater cache was not removed: ${metadata.updaterCachePath}`);
}

function assertShortcutsRemoved(shortcutPaths) {
  const remaining = shortcutPaths.filter((shortcutPath) => fs.existsSync(shortcutPath));
  assert(remaining.length === 0, `NSIS uninstall cleanup left shortcuts behind: ${remaining.join(', ')}.`);
}

async function uninstallTemporaryNsis({ uninstallerPath, installDirectory, uninstallerTemporaryDirectory, registryPath, shortcutPaths }) {
  const uninstallation = await runProcess(uninstallerPath, ['/S', '/currentuser'], {
    cwd: installDirectory,
    env: createSmokeEnvironment(uninstallerTemporaryDirectory),
    label: 'NSIS silent uninstall from the temporary directory',
    timeoutMs: UNINSTALLER_TIMEOUT_MS,
  });
  assert(uninstallation.code === 0,
    `NSIS silent uninstall exited with code ${uninstallation.code} (signal ${uninstallation.signal}). Output:\n${uninstallation.output}`);
  await waitForAbsence(installDirectory, CLEANUP_TIMEOUT_MS, 'NSIS uninstall cleanup');
  await waitForNsisInstallationRemoval(registryPath);
  assertShortcutsRemoved(shortcutPaths);
  logDiagnostic('NSIS uninstall removed its temporary installation, registry entry, and shortcuts.');
}

async function main() {
  assert(process.platform === 'win32', 'This release-artifact smoke check targets Windows x64.');
  const metadata = readReleaseMetadata();
  assertRegularFile(metadata.installerPath, 'NSIS installer artifact');
  assertRegularFile(metadata.portablePath, 'portable artifact');
  assertRegularFile(FIXTURE_PATH, 'self-test fixture');

  const registryPath = assertNoExistingNsisInstallation(metadata);
  const shortcutPaths = getShortcutPaths(metadata.shortcutName);
  assertNoExistingShortcuts(shortcutPaths);
  assertNoExistingUpdaterCache(metadata.updaterCachePath);

  const temporaryBase = fs.realpathSync(os.tmpdir());
  const temporaryRoot = fs.mkdtempSync(path.join(temporaryBase, TEMPORARY_ROOT_PREFIX));
  const installDirectory = assertTemporaryChild(temporaryRoot, path.join(temporaryRoot, 'installed-app'), 'NSIS installation directory');
  const installerTemporaryDirectory = assertTemporaryChild(temporaryRoot, path.join(temporaryRoot, 'installer-temp'), 'installer temporary directory');
  const uninstallerTemporaryDirectory = assertTemporaryChild(temporaryRoot, path.join(temporaryRoot, 'uninstaller-temp'), 'uninstaller temporary directory');
  const installedProfileDirectory = assertTemporaryChild(installerTemporaryDirectory, path.join(installerTemporaryDirectory, 'profile'), 'installed self-test profile');
  const portableTemporaryDirectory = assertTemporaryChild(temporaryRoot, path.join(temporaryRoot, 'portable-temp'), 'portable temporary directory');
  const portableProfileDirectory = assertTemporaryChild(portableTemporaryDirectory, path.join(portableTemporaryDirectory, 'profile'), 'portable self-test profile');

  fs.mkdirSync(installerTemporaryDirectory, { recursive: true });
  fs.mkdirSync(uninstallerTemporaryDirectory, { recursive: true });
  fs.mkdirSync(portableTemporaryDirectory, { recursive: true });

  let primaryError;
  let uninstallerPath;
  let nsisInstallationNeedsCleanup = false;
  let updaterCacheNeedsCleanup = false;
  try {
    const installation = await runProcess(metadata.installerPath, ['/S', `/D=${installDirectory}`], {
      cwd: path.dirname(metadata.installerPath),
      env: createSmokeEnvironment(installerTemporaryDirectory),
      label: 'NSIS silent installation into the temporary directory',
      timeoutMs: INSTALLER_TIMEOUT_MS,
    });
    assert(installation.code === 0,
      `NSIS silent installation exited with code ${installation.code} (signal ${installation.signal}). Output:\n${installation.output}`);

    const installedExecutable = assertTemporaryChild(installDirectory,
      path.join(installDirectory, `${metadata.productFilename}.exe`), 'installed application executable');
    uninstallerPath = assertTemporaryChild(installDirectory,
      path.join(installDirectory, `Uninstall ${metadata.productFilename}.exe`), 'NSIS uninstaller executable');
    assertRegularFile(uninstallerPath, 'NSIS uninstaller executable');
    nsisInstallationNeedsCleanup = true;
    assertRegularFile(installedExecutable, 'installed application executable');
    assertOwnedUpdaterCache(metadata);
    updaterCacheNeedsCleanup = true;
    logDiagnostic(`NSIS installer produced ${installedExecutable}.`);

    await runCapabilitySelfTest({
      executablePath: installedExecutable,
      artifactLabel: 'Installed NSIS application',
      profileDirectory: installedProfileDirectory,
      temporaryDirectory: installerTemporaryDirectory,
    });

    await uninstallTemporaryNsis({
      uninstallerPath,
      installDirectory,
      uninstallerTemporaryDirectory,
      registryPath,
      shortcutPaths,
    });
    nsisInstallationNeedsCleanup = false;

    await runCapabilitySelfTest({
      executablePath: metadata.portablePath,
      artifactLabel: 'Portable application',
      profileDirectory: portableProfileDirectory,
      temporaryDirectory: portableTemporaryDirectory,
    });
    logDiagnostic('Portable artifact completed the same capability self-test without CDP.');
  } catch (error) {
    primaryError = error;
  }

  const cleanupFailures = [];
  if (nsisInstallationNeedsCleanup && uninstallerPath) {
    try {
      await uninstallTemporaryNsis({
        uninstallerPath,
        installDirectory,
        uninstallerTemporaryDirectory,
        registryPath,
        shortcutPaths,
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (updaterCacheNeedsCleanup) {
    try {
      removeOwnedUpdaterCache(metadata);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await removeOwnedTemporaryDirectory(temporaryRoot, temporaryBase);
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    const cleanupError = new AggregateError(cleanupFailures, 'Release artifact smoke cleanup failed.');
    try {
      if (!primaryError) throw cleanupError;
      logDiagnostic(`${cleanupError.message} The primary test failure is preserved.`);
    } catch (error) {
      if (!primaryError) primaryError = error;
    }
  }

  if (primaryError) throw primaryError;

  console.log('Release artifact smoke passed: NSIS install/self-test/uninstall cleanup and portable self-test completed without CDP.');
}

try {
  await main();
} catch (error) {
  fs.mkdirSync(DIAGNOSTICS_DIRECTORY, { recursive: true });
  const diagnosticPath = path.join(DIAGNOSTICS_DIRECTORY, 'release-artifact-smoke.log');
  const message = error instanceof Error ? error.stack || error.message : String(error);
  fs.writeFileSync(diagnosticPath, `${diagnosticEvents.join('\n')}\n\n${message}\n`, 'utf8');
  console.error(`Release artifact smoke failed. Diagnostics: ${diagnosticPath}`);
  throw error;
}
