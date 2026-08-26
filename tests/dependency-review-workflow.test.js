import fs from 'node:fs';
import { expect, test } from 'vitest';

const workflow = fs.readFileSync(new URL('../.github/workflows/dependency-review.yml', import.meta.url), 'utf8');

test('dependency review runs only for pull requests with a read-only, SHA-pinned action', () => {
  expect(workflow).toContain('on:\n  pull_request:');
  expect(workflow).toContain('permissions:\n  contents: read');
  expect(workflow).toContain('actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0');
  expect(workflow).toContain('fail-on-severity: high');
  expect(workflow).toContain('fail-on-scopes: runtime');
  expect(workflow).not.toContain('pull_request_target');
  expect(workflow).not.toMatch(/\b(?:write|id-token):/);
});
