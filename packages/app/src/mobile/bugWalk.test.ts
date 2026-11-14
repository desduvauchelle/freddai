import { expect, it } from 'vitest';
import { deviceLabel, formatElapsed, MISSING_GRACE_MS, phaseLabel, pollingFinished, progressPercent } from './bugWalk';

it('labels every phase and includes the failure reason', () => {
  expect(phaseLabel({ phase: 'transcribing' })).toBe('Transcribing…');
  expect(phaseLabel({ phase: 'analyzing' })).toBe('Analysing…');
  expect(phaseLabel({ phase: 'framing' })).toBe('Picking frames…');
  expect(phaseLabel({ phase: 'launching' })).toBe('Opening thread…');
  expect(phaseLabel({ phase: 'done' })).toBe('Done');
  expect(phaseLabel({ phase: 'error', reason: 'no audio' })).toBe('Failed: no audio');
  expect(phaseLabel({ phase: 'missing' })).toContain("hasn't picked this up");
});
it('stops polling on done/error, and on missing only after five minutes', () => {
  expect(pollingFinished({ phase: 'done' }, 0)).toBe(true);
  expect(pollingFinished({ phase: 'error' }, 0)).toBe(true);
  expect(pollingFinished({ phase: 'missing' }, 1000)).toBe(false);
  expect(pollingFinished({ phase: 'missing' }, MISSING_GRACE_MS)).toBe(true);
  expect(pollingFinished({ phase: 'analyzing' }, 1e9)).toBe(false);
});
it('computes progress and clock text', () => {
  expect(progressPercent(50, 200)).toBe(25);
  expect(progressPercent(5, 0)).toBe(0);
  expect(progressPercent(500, 200)).toBe(100);
  expect(formatElapsed(65)).toBe('1:05');
});
it('detects iPad including desktop-class Safari', () => {
  expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 17)', 5)).toBe('iPad');
  expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)).toBe('iPad');
  expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 0)).toBe('iPhone');
  expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17)', 5)).toBe('iPhone');
});
