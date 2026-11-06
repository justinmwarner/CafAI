import { describe, expect, it } from 'vitest';
import { altitudeRange, altitudeText, varietyList, varietyText } from './beanDetails.ts';

describe('varieties (D278)', () => {
  it("reads Decaid's list as one line, and nothing else", () => {
    expect(varietyText(['Castillo', ' Caturra '])).toBe('Castillo, Caturra');
    expect(varietyText('Gesha')).toBe('Gesha');
    expect(varietyText([])).toBeNull();
    expect(varietyText([' ', 3])).toBeNull();
    expect(varietyText(null)).toBeNull();
  });

  it('writes the names apart for Decaid', () => {
    expect(varietyList('Castillo, Caturra')).toEqual(['Castillo', 'Caturra']);
    expect(varietyList('Bourbon / Typica & SL28 and SL34')).toEqual(['Bourbon', 'Typica', 'SL28', 'SL34']);
    expect(varietyList('Pink Bourbon')).toEqual(['Pink Bourbon']);
    expect(varietyList('')).toBeNull();
    expect(varietyList(null)).toBeNull();
  });
});

describe('altitude (D278)', () => {
  it("reads Decaid's range in metres", () => {
    expect(altitudeText([1800, 2200])).toBe('1,800-2,200 m');
    expect(altitudeText([1950, 1950])).toBe('1,950 m');
    expect(altitudeText([1950])).toBe('1,950 m');
    expect(altitudeText([])).toBeNull();
    expect(altitudeText('1950')).toBeNull();
  });

  it("reads the bag's words as a range of whole metres", () => {
    expect(altitudeRange('1,950 masl')).toEqual([1950, 1950]);
    expect(altitudeRange('1800 - 2000m')).toEqual([1800, 2000]);
    expect(altitudeRange('1.900 msnm')).toEqual([1900, 1900]);
    expect(altitudeRange('1\u202f950 m')).toEqual([1950, 1950]);
    expect(altitudeRange('2,100-1,900 MASL')).toEqual([1900, 2100]);
    expect(altitudeRange('6,000 ft')).toEqual([1829, 1829]);
    expect(altitudeRange("5,500-6,200'")).toEqual([1676, 1890]);
  });

  it('leaves out what is no altitude in metres', () => {
    expect(altitudeRange('high')).toBeNull();
    expect(altitudeRange('1,700, 1,800 or 1,900 m')).toBeNull();
    expect(altitudeRange('19500 m')).toBeNull();
    expect(altitudeRange('')).toBeNull();
    expect(altitudeRange(null)).toBeNull();
  });
});
