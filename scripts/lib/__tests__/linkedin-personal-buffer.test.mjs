import { describe, it, expect, afterEach } from 'vitest';
import { validateBufferChannel } from '../buffer-publishing.mjs';

const approved = {
  id: '6adc3c32778b240e2fa9f0bc',
  service: 'linkedin',
  type: 'profile',
  name: 'miroslav-dajč-034a4540a',
  externalLink: 'https://www.linkedin.com/in/miroslav-daj%C4%8D-034a4540a',
  isDisconnected: false,
  isLocked: false,
};

afterEach(() => { delete process.env.DAJC_LINKEDIN_TARGET; });

describe('temporary LinkedIn personal identity', () => {
  it('is forbidden by default, allowed only when explicitly selected', () => {
    expect(() => validateBufferChannel('linkedin', approved)).toThrow();
    process.env.DAJC_LINKEDIN_TARGET = 'personal';
    expect(validateBufferChannel('linkedin', approved)).toBe(true);
  });
  it('never accepts a different profile, locked or disconnected account', () => {
    process.env.DAJC_LINKEDIN_TARGET = 'personal';
    expect(() => validateBufferChannel('linkedin', { ...approved, id: '6adc3c32778b240e2fa9f0bd' })).toThrow();
    expect(() => validateBufferChannel('linkedin', { ...approved, externalLink: 'https://www.linkedin.com/in/other' })).toThrow();
    expect(() => validateBufferChannel('linkedin', { ...approved, isDisconnected: true })).toThrow();
    expect(() => validateBufferChannel('linkedin', { ...approved, isLocked: true })).toThrow();
  });
});
