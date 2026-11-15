import { describe, expect, it } from 'vitest';
import { findSecretMatches } from '../lib/secret-patterns';

describe('secret patterns (SEC-HI-08)', () => {
  it('finds long-term and temporary access key IDs', () => {
    expect(findSecretMatches(`id=AKIA${'A'.repeat(16)}`)).toEqual(['AKIA[0-9A-Z]{16}']);
    expect(findSecretMatches(`id=ASIA${'7'.repeat(16)}`)).toEqual(['ASIA[0-9A-Z]{16}']);
  });

  it('finds the secret key field name in any case', () => {
    expect(findSecretMatches('AWS_SECRET_ACCESS_KEY=x')).toHaveLength(1);
  });

  it('ignores clean text and near misses', () => {
    expect(findSecretMatches('console.log("AKIA short")')).toEqual([]);
    expect(findSecretMatches(`akia${'a'.repeat(16)}`)).toEqual([]);
  });
});
