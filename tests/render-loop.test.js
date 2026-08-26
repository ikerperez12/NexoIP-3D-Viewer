import { describe, expect, it, vi } from 'vitest';
import { createDemandRenderScheduler } from '../src/utils/render-loop.js';

function createFrameHarness(onFrame = () => false, onError = undefined) {
  let nextId = 1;
  const pending = new Map();
  const requestFrame = vi.fn((callback) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, callback);
    return id;
  });
  const cancelFrame = vi.fn((id) => pending.delete(id));
  const scheduler = createDemandRenderScheduler({ requestFrame, cancelFrame, onFrame, onError });
  const flush = (timestamp) => {
    const entry = pending.entries().next().value;
    if (!entry) throw new Error('No frame is pending.');
    const [id, callback] = entry;
    pending.delete(id);
    callback(timestamp);
  };
  return { scheduler, requestFrame, cancelFrame, pending, flush };
}

describe('demand render scheduler', () => {
  it('coalesces mutations and settles after one idle frame', () => {
    const onFrame = vi.fn(() => false);
    const harness = createFrameHarness(onFrame);

    expect(harness.scheduler.invalidate()).toBe(true);
    expect(harness.scheduler.invalidate()).toBe(false);
    expect(harness.requestFrame).toHaveBeenCalledOnce();

    harness.flush(1000);

    expect(onFrame).toHaveBeenCalledWith({ timestamp: 1000, deltaSeconds: 0 });
    expect(harness.pending.size).toBe(0);
    expect(harness.scheduler.isIdle()).toBe(true);
  });

  it('keeps frames only while motion is active and resets idle timing', () => {
    const onFrame = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    const harness = createFrameHarness(onFrame);

    harness.scheduler.invalidate();
    harness.flush(1000);
    harness.flush(1016);
    harness.flush(2016);

    expect(onFrame.mock.calls[1][0].deltaSeconds).toBeCloseTo(0.016, 5);
    expect(onFrame.mock.calls[2][0].deltaSeconds).toBe(0.1);
    expect(harness.scheduler.isIdle()).toBe(true);

    harness.scheduler.invalidate();
    harness.flush(5000);
    expect(onFrame.mock.calls[3][0].deltaSeconds).toBe(0);
  });

  it('honors an invalidation emitted during a frame without duplicating it', () => {
    let scheduler;
    const onFrame = vi.fn(() => {
      if (onFrame.mock.calls.length === 1) scheduler.invalidate();
      return false;
    });
    const harness = createFrameHarness(onFrame);
    scheduler = harness.scheduler;

    scheduler.invalidate();
    harness.flush(1000);
    expect(harness.pending.size).toBe(1);

    harness.flush(1016);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame.mock.calls[1][0].deltaSeconds).toBeCloseTo(0.016, 5);
    expect(harness.scheduler.isIdle()).toBe(true);
  });

  it('cancels work while suspended and renders once after resuming', () => {
    const harness = createFrameHarness();
    harness.scheduler.invalidate();

    harness.scheduler.setSuspended(true);
    expect(harness.cancelFrame).toHaveBeenCalledOnce();
    expect(harness.pending.size).toBe(0);

    harness.scheduler.invalidate();
    expect(harness.pending.size).toBe(0);

    harness.scheduler.setSuspended(false);
    expect(harness.pending.size).toBe(1);
    harness.flush(100);
    expect(harness.scheduler.isIdle()).toBe(true);
  });

  it('contains frame failures and stops scheduling until invalidated again', () => {
    const failure = new Error('GPU render failed');
    const onError = vi.fn();
    const harness = createFrameHarness(() => { throw failure; }, onError);

    harness.scheduler.invalidate();
    expect(() => harness.flush(100)).not.toThrow();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(harness.scheduler.isIdle()).toBe(true);
  });

  it('disposes idempotently and never accepts later invalidations', () => {
    const harness = createFrameHarness();
    harness.scheduler.invalidate();
    harness.scheduler.dispose();
    harness.scheduler.dispose();

    expect(harness.cancelFrame).toHaveBeenCalledOnce();
    expect(harness.scheduler.invalidate()).toBe(false);
    expect(harness.pending.size).toBe(0);
  });
});
