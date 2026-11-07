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

  it('keeps whole names when the line is too long, never half of one', () => {
    const names = ['Bourbon', 'Typica', 'Caturra', 'Catuaí', 'Mundo Novo', 'Pacamara', 'Maragogipe', 'Catimor', 'Kent'];
    const line = varietyText(names, 80);
    expect(line).toBe('Bourbon, Typica, Caturra, Catuaí, Mundo Novo, Pacamara, Maragogipe, Catimor');
    expect(varietyText(names, 20)).toBe('Bourbon, Typica');
    expect(varietyText('Bourbon, Typica, Caturra', 20)).toBe('Bourbon, Typica');
    // A single name longer than the line is cut, as any detail is.
    expect(varietyText(['A'.repeat(90)], 80)).toBe('A'.repeat(80));
  });

  it('writes the names apart for Decaid where the text lists them', () => {
    expect(varietyList('Castillo, Caturra')).toEqual(['Castillo', 'Caturra']);
    expect(varietyList('Bourbon; Typica,SL28')).toEqual(['Bourbon', 'Typica', 'SL28']);
    expect(varietyList('Pink Bourbon')).toEqual(['Pink Bourbon']);
    expect(varietyList('')).toBeNull();
    expect(varietyList(' , ')).toBeNull();
    expect(varietyList(null)).toBeNull();
  });

  it('never splits one variety in two', () => {
    expect(varietyList('Red & Yellow Catuaí')).toEqual(['Red & Yellow Catuaí']);
    expect(varietyList('SL28/34')).toEqual(['SL28/34']);
    expect(varietyList('Catuaí (Red, Yellow), Bourbon')).toEqual(['Catuaí (Red, Yellow)', 'Bourbon']);
    expect(varietyList('Red and Yellow Bourbon')).toEqual(['Red and Yellow Bourbon']);
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
    expect(altitudeRange('1\u2009950 m')).toEqual([1950, 1950]);
    expect(altitudeRange('2,100-1,900 MASL')).toEqual([1900, 2100]);
    expect(altitudeRange('1,600 to 1,900 metres')).toEqual([1600, 1900]);
    expect(altitudeRange('1,950 m.a.s.l.')).toEqual([1950, 1950]);
    expect(altitudeRange('1950')).toEqual([1950, 1950]);
    expect(altitudeRange('6,000 ft')).toEqual([1829, 1829]);
    expect(altitudeRange("5,500-6,200'")).toEqual([1676, 1890]);
  });

  it('reads feet written right after the number, and the curly foot mark', () => {
    expect(altitudeRange('2,500ft')).toEqual([762, 762]);
    expect(altitudeRange('1,200-1,800ft')).toEqual([366, 549]);
    expect(altitudeRange('3,000’')).toEqual([914, 914]);
    expect(altitudeRange('3,000′')).toEqual([914, 914]);
  });

  it('takes the metres when the bag gives both, and leaves out numbers that are no altitude', () => {
    expect(altitudeRange('1,950 m (6,400 ft)')).toEqual([1950, 1950]);
    expect(altitudeRange('6,400 ft / 1,950 m')).toEqual([1950, 1950]);
    expect(altitudeRange('1,900 m (lot 7)')).toEqual([1900, 1900]);
  });

  it('leaves out what is no altitude in metres', () => {
    expect(altitudeRange('high')).toBeNull();
    expect(altitudeRange('1,700, 1,800 or 1,900 m')).toBeNull();
    expect(altitudeRange('19500 m')).toBeNull();
    expect(altitudeRange('Lot 7, 1,900 m')).toBeNull();
    expect(altitudeRange('')).toBeNull();
    expect(altitudeRange(null)).toBeNull();
  });
});
