import fs from 'node:fs';
import { expect, test } from 'vitest';

const lockfile = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const notices = fs.readFileSync(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');

const expectedRuntimePackages = {
  '@fontsource/inter': { version: '5.3.0', license: 'OFL-1.1', notice: 'Inter - SIL Open Font License 1.1' },
  '@fontsource/jetbrains-mono': { version: '5.3.0', license: 'OFL-1.1', notice: 'JetBrains Mono - SIL Open Font License 1.1' },
  'js-tokens': { version: '4.0.0', license: 'MIT', notice: 'js-tokens 4.0.0 - MIT License' },
  'loose-envify': { version: '1.4.0', license: 'MIT', notice: 'loose-envify 1.4.0 - MIT License' },
  'lucide-react': { version: '0.395.0', license: 'ISC', notice: 'Lucide React 0.395.0 - ISC License' },
  react: { version: '18.3.1', license: 'MIT', notice: 'React and React DOM 18.3.1 - MIT License' },
  'react-dom': { version: '18.3.1', license: 'MIT', notice: 'React and React DOM 18.3.1 - MIT License' },
  scheduler: { version: '0.23.2', license: 'MIT', notice: 'React scheduler 0.23.2 - MIT License' },
  three: { version: '0.165.0', license: 'MIT', notice: 'Three.js 0.165.0 - MIT License' },
};

function runtimePackagesFromLockfile() {
  return Object.fromEntries(
    Object.entries(lockfile.packages)
      .filter(([location, metadata]) => (
        location.startsWith('node_modules/')
        && metadata.dev !== true
        && metadata.link !== true
      ))
      .map(([location, metadata]) => [
        location.slice('node_modules/'.length),
        { version: metadata.version, license: metadata.license },
      ]),
  );
}

test('third-party notices cover every production package pinned in the lockfile', () => {
  const runtimePackages = runtimePackagesFromLockfile();

  expect(Object.keys(runtimePackages).sort()).toEqual(Object.keys(expectedRuntimePackages).sort());

  for (const [packageName, expected] of Object.entries(expectedRuntimePackages)) {
    expect(runtimePackages[packageName]).toEqual({
      version: expected.version,
      license: expected.license,
    });
    expect(notices).toContain(expected.notice);
  }
});

test('third-party notices include the full redistributed license families', () => {
  expect(notices).toContain('MIT License (React, React DOM, scheduler, loose-envify, js-tokens,');
  expect(notices).toContain('ISC License (Lucide)');
  expect(notices).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
  expect(notices).toContain('Apache License\nVersion 2.0, January 2004');
});
