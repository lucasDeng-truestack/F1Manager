import { describe, expect, it } from 'vitest';
import { createProgressAggregator, PROGRESS_THROTTLE_MS } from './whisperProgress';

const T = PROGRESS_THROTTLE_MS;

describe('createProgressAggregator', () => {
  it('aggregates by bytes across files, not by averaging percentages', () => {
    const agg = createProgressAggregator();
    expect(agg.push({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 }, 0)).toEqual({ file: 'a.onnx', progress: 50 });
    // second file is 900 bytes; 50 + 0 of 1000 = 5% -> held at 50 (never goes backwards)
    expect(agg.push({ status: 'progress', file: 'b.onnx', loaded: 0, total: 900 }, T)).toBeNull();
    // 50 + 650 of 1000 = 70% (an average of the two percentages would say 61)
    expect(agg.push({ status: 'progress', file: 'b.onnx', loaded: 650, total: 900 }, 2 * T)).toEqual({ file: 'b.onnx', progress: 70 });
  });

  it('uses progress_total file sizes so a small first file does not read as 100%', () => {
    const agg = createProgressAggregator();
    const files = { 'config.json': { loaded: 0, total: 10 }, 'encoder_model.onnx': { loaded: 0, total: 990 } };
    expect(agg.push({ status: 'progress_total', files }, 0)).toBeNull();
    expect(agg.push({ status: 'progress', file: 'config.json', loaded: 10, total: 10 }, 0)).toEqual({ file: 'config.json', progress: 1 });
  });

  it('throttles intermediate updates but always posts 100', () => {
    const agg = createProgressAggregator();
    expect(agg.push({ status: 'progress', file: 'a', loaded: 10, total: 100 }, 0)).not.toBeNull();
    expect(agg.push({ status: 'progress', file: 'a', loaded: 20, total: 100 }, T - 1)).toBeNull();
    expect(agg.push({ status: 'progress', file: 'a', loaded: 30, total: 100 }, T)).toEqual({ file: 'a', progress: 30 });
    expect(agg.push({ status: 'progress', file: 'a', loaded: 100, total: 100 }, T + 1)).toEqual({ file: 'a', progress: 100 });
    expect(agg.push({ status: 'progress', file: 'a', loaded: 100, total: 100 }, 10 * T)).toBeNull(); // unchanged
  });

  it('done completes a known file and ignores unknown ones', () => {
    const agg = createProgressAggregator();
    agg.push({ status: 'progress', file: 'a', loaded: 10, total: 100 }, 0);
    expect(agg.push({ status: 'done', file: 'zzz' }, T)).toBeNull();
    expect(agg.push({ status: 'done', file: 'a' }, T)).toEqual({ file: 'a', progress: 100 });
  });

  it('ignores other statuses and malformed byte counts', () => {
    const agg = createProgressAggregator();
    expect(agg.push({ status: 'initiate', file: 'a' }, 0)).toBeNull();
    expect(agg.push({ status: 'download', file: 'a' }, 0)).toBeNull();
    expect(agg.push({ status: 'ready' }, 0)).toBeNull();
    expect(agg.push({ status: 'progress', file: 'a', loaded: Number.NaN, total: 100 }, 0)).toBeNull();
    expect(agg.push({ status: 'progress', file: 'a', loaded: 5, total: 0 }, 0)).toBeNull(); // 0 total -> stays 0, never posted
  });

  it('clamps loaded to total and reset starts from zero', () => {
    const agg = createProgressAggregator();
    expect(agg.push({ status: 'progress', file: 'a', loaded: 500, total: 100 }, 0)).toEqual({ file: 'a', progress: 100 });
    agg.reset();
    expect(agg.push({ status: 'progress', file: 'b', loaded: 25, total: 100 }, 0)).toEqual({ file: 'b', progress: 25 });
  });
});
