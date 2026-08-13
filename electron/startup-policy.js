const UNSAFE_PACKAGED_SWITCHES = new Set([
  'allow-insecure-localhost',
  'allow-running-insecure-content',
  'disable-gpu-sandbox',
  'disable-sandbox',
  'disable-site-isolation-trials',
  'disable-web-security',
  'ignore-certificate-errors',
  'in-process-gpu',
  'no-sandbox',
  'remote-debugging-address',
  'remote-debugging-pipe',
  'remote-debugging-port',
  'single-process',
]);

const UNSAFE_PACKAGED_SWITCH_PREFIXES = [
  'inspect',
  'debug',
  'remote-debugging-',
];

const SELF_TEST_SWITCH = 'nexoip-self-test';
const SELF_TEST_DIGEST_SWITCH = 'nexoip-self-test-token-sha256';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function getSwitchName(argument) {
  if (typeof argument !== 'string' || !argument.startsWith('--')) return null;
  const rawName = argument.slice(2).split('=', 1)[0].trim().toLowerCase();
  return rawName || null;
}

function hasUnsafeNodeInspectorValue(argument) {
  const [name, value = ''] = argument.slice(2).split(/=(.*)/s, 2);
  if (name.toLowerCase() !== 'js-flags' && name.toLowerCase() !== 'node-options') return false;
  return /(?:^|\s)--(?:inspect|inspect-brk|debug|debug-brk)(?:[=\s]|$)/i.test(value);
}

export function findUnsafePackagedArguments(argumentsList) {
  if (!Array.isArray(argumentsList)) return ['invalid-arguments'];

  return argumentsList.filter((argument) => {
    const name = getSwitchName(argument);
    if (!name) return false;

    return UNSAFE_PACKAGED_SWITCHES.has(name)
      || UNSAFE_PACKAGED_SWITCH_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix))
      || hasUnsafeNodeInspectorValue(argument);
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
