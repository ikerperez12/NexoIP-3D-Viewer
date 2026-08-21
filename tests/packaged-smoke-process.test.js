import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import {
  observeChildTermination,
  waitForObservedTermination,
} from '../scripts/packaged-smoke.mjs';

function createChild({ exitCode = null, signalCode = null } = {}) {
  const child = new EventEmitter();
  child.exitCode = exitCode;
  child.signalCode = signalCode;
  return child;
}

test('packaged smoke observes a child that exited before the report watcher starts', async () => {
  const child = createChild({ exitCode: 0 });
  const observer = observeChildTermination(child);

  await expect(waitForObservedTermination(observer, 1, 'self-test'))
    .resolves.toEqual({ kind: 'exit', code: 0, signal: null });
});

test('packaged smoke observes a child exit after registration without waiting for a watchdog', async () => {
  const child = createChild();
  const observer = observeChildTermination(child);

  child.exitCode = 0;
  child.emit('exit', 0, null);

  await expect(waitForObservedTermination(observer, 1, 'self-test'))
    .resolves.toEqual({ kind: 'exit', code: 0, signal: null });
});

test('packaged smoke still fails closed when a child does not terminate', async () => {
  const child = createChild();
  const observer = observeChildTermination(child);

  await expect(waitForObservedTermination(observer, 1, 'self-test'))
    .rejects.toThrow('self-test timed out after 1 ms.');
});
