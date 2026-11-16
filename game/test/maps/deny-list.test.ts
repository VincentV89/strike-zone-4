// Table cases for the hybrid deny-list matcher (ADR-WH-6). Shared by maps and bot-ai content tests.
import { describe, expect, it } from 'vitest';
import { DENY_LIST, denyHits, tokens } from '../support/deny-list';

describe('hybrid deny-list matcher', () => {
  it.each([
    'Industrial Warehouse',
    'industrial-warehouse',
    'west-spawn',
    'along a wall',
    'take-cover',
  ])('passes %s', (s) => {
    expect(denyHits(s)).toEqual([]);
  });

  it.each([
    ['Dust', 'dust'],
    ['westCatwalk', 'catwalk'],
    ['oldcatwalks', 'catwalk'],
    ['cs_assault', 'assault'],
    ['long-a', 'longa'],
    ['ct_spawn2', 'ctspawn'],
  ])('flags %s', (s, entry) => {
    expect(denyHits(s)).toContain(entry);
  });

  it('known passes: short entries are not substring-matched (R-WH-2)', () => {
    expect(denyHits('dustyard')).toEqual([]);
    expect(denyHits('tspawnzone')).toEqual([]);
  });

  it('tokenises camel case and strips trailing digits', () => {
    expect(tokens('westCatwalk2 B-site')).toEqual(['west', 'catwalk', 'b', 'site']);
    expect(DENY_LIST).toContain('assault');
  });
});
