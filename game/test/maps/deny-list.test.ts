// Table cases for the hybrid deny-list matcher (ADR-WH-6, SD-WH-2, SEC-WH-02, SEC-WH-03,
// BR-WH-51). Shared by maps and bot-ai content tests.
import { describe, expect, it } from 'vitest';
import { DENY_LIST, denyHits, tokens } from '../support/deny-list';

describe('deny-list matcher', () => {
  it.each([
    ['Dust', 'dust'],
    ['Dust 2', 'dust'],
    ['de_dust2', 'dust'],
    ['Long A', 'longa'],
    ['long-a', 'longa'],
    ['CT spawn', 'ctspawn'],
    ['CTSpawn', 'ctspawn'],
    ['ct_spawn2', 'ctspawn'],
    ['B site', 'bsite'],
    ['westCatwalk', 'catwalk'],
    ['oldcatwalks', 'catwalk'],
    ['cs_assault', 'assault'],
    ['MidDoors', 'middoors'],
    ['the tunnels', 'tunnels'],
  ])('SEC-WH-03: rejects %j (hits %s)', (s, entry) => {
    expect(denyHits(s)).toContain(entry);
  });

  it.each([
    'Industrial Warehouse',
    'industrial-warehouse',
    'west-spawn',
    'take-cover',
    'west-containers',
    'West Container Rows',
    'south-bay',
    'nw-bay',
    'east-gantry',
    'along a wall',
    'bay-s--28-31',
  ])('SEC-WH-02: accepts %j', (s) => {
    expect(denyHits(s)).toEqual([]);
  });

  it.each(['dustyard', 'tspawnzone'])(
    'R-WH-2: %j is a pinned known pass (one token containing a short entry)',
    (s) => {
      expect(denyHits(s)).toEqual([]);
    },
  );

  it('tokenises on separators, camel case and trailing digits', () => {
    expect(tokens('westCatwalk2 B-site')).toEqual(['west', 'catwalk', 'b', 'site']);
    expect(tokens('de_dust2')).toEqual(['de', 'dust']);
    expect(tokens('CTSpawn')).toEqual(['ct', 'spawn']);
    expect(tokens('bay-s--28-31')).toEqual(['bay', 's']);
    expect(tokens('')).toEqual([]);
  });

  it('the list is frozen and includes assault', () => {
    expect(Object.isFrozen(DENY_LIST)).toBe(true);
    expect(DENY_LIST).toContain('assault');
  });
});
