const LOCAL_PATH_PATTERN = /(?:file:\/\/\/?|[A-Za-z]:[\\/]|\\\\)[^"'<>|\r\n]*?(?=\s*:\s|\s*$)/g;
const MAX_USER_ERROR_LENGTH = 320;

function removeControlCharacters(value) {
  return [...value].filter((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint >= 0x20 && codePoint !== 0x7f;
  }).join('');
}

/**
 * Keep renderer-facing diagnostics useful without exposing a local path or
 * allowing an oversized parser error to take over the application shell.
 */
export function getUserErrorMessage(error, fallback) {
  const rawMessage = error instanceof Error && error.message ? error.message : fallback;
  const message = removeControlCharacters(
    String(rawMessage || fallback || 'Se produjo un error inesperado.')
      .replace(LOCAL_PATH_PATTERN, '[ruta local]'),
  ).trim();

  if (!message) return fallback;
  if (message.length <= MAX_USER_ERROR_LENGTH) return message;
  return `${message.slice(0, MAX_USER_ERROR_LENGTH - 1).trimEnd()}…`;
}
