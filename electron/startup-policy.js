const UNSAFE_PACKAGED_SWITCHES = new Set([
  'allow-file-access-from-files',
  'allow-insecure-localhost',
  'allow-running-insecure-content',
  'allow-universal-access-from-files',
  'disable-blink-features',
  'disable-field-trial-config',
  'disable-features',
  'disable-gpu-driver-bug-workarounds',
  'disable-gpu-sandbox',
  'disable-namespace-sandbox',
  'disable-sandbox',
  'disable-seccomp-filter-sandbox',
  'disable-setuid-sandbox',
  'disable-site-isolation-for-policy',
  'disable-site-isolation-trials',
  'disable-web-security',
  'enable-blink-features',
  'enable-experimental-web-platform-features',
  'enable-features',
  'ignore-certificate-errors',
  'ignore-certificate-errors-spki-list',
  'in-process-gpu',
  'js-flags',
  'load-extension',
  'no-sandbox',
  'no-zygote',
  'node-options',
  'remote-debugging-address',
  'remote-debugging-pipe',
  'remote-debugging-port',
  'single-process',
  'unsafely-treat-insecure-origin-as-secure',
]);

const UNSAFE_PACKAGED_SWITCH_PREFIXES = [
  'inspect',
  'debug',
  'force-fieldtrial',
  'force-variation-',
  'origin-trial-',
  'remote-debugging-',
  'variations-',
];

const SELF_TEST_SWITCH = 'nexoip-self-test';
const SELF_TEST_DIGEST_SWITCH = 'nexoip-self-test-token-sha256';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function getSwitchName(argument) {
  if (typeof argument !== 'string') return null;

  let prefixLength;
  if (argument.startsWith('--')) {
    prefixLength = 2;
  } else if (argument.startsWith('-') || argument.startsWith('/')) {
    prefixLength = 1;
  } else {
    return null;
  }

  const rawName = argument.slice(prefixLength).split(/[=:]/, 1)[0].trim().toLowerCase();
  return rawName || null;
}

export function findUnsafePackagedArguments(argumentsList) {
  if (!Array.isArray(argumentsList)) return ['invalid-arguments'];

  return argumentsList.filter((argument) => {
    const name = getSwitchName(argument);
    if (!name) return false;

    return UNSAFE_PACKAGED_SWITCHES.has(name)
      || UNSAFE_PACKAGED_SWITCH_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix));
  });
}

function findSingleSwitchValue(argumentsList, switchName) {
  const prefix = `--${switchName}=`;
  const values = argumentsList
    .filter((argument) => typeof argument === 'string' && argument.toLowerCase().startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));

  return values.length === 1 && values[0].length > 0 ? values[0] : null;
}

export function getPackagedSelfTestRequest(argumentsList) {
  if (!Array.isArray(argumentsList)) return null;

  const configPath = findSingleSwitchValue(argumentsList, SELF_TEST_SWITCH);
  const tokenDigest = findSingleSwitchValue(argumentsList, SELF_TEST_DIGEST_SWITCH);
  if (!configPath && !tokenDigest) return null;
  if (!configPath || !tokenDigest || !SHA256_PATTERN.test(tokenDigest)) {
    return { valid: false, reason: 'Invalid packaged self-test request.' };
  }

  return { valid: true, configPath, tokenDigest };
}

export const PACKAGED_SELF_TEST_SWITCHES = Object.freeze({
  SELF_TEST_SWITCH,
  SELF_TEST_DIGEST_SWITCH,
});
