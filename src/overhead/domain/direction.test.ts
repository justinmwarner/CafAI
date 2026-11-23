import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RouteEnd, RouteInfo } from '../shared/payload.ts';
import { chooseLeg, directionFor, endLabel, NO_ROUTE, parseRoute, placeName, routeIsOld } from './direction.ts';
import { airlineFor, operatorName, splitCallsign, titleWords, typeNameFor } from './words.ts';

/** An airport as hexdb answered for it (fixtures/overhead/hexdb-airport-*.json). */
function airport(icao: string): RouteEnd {
  const body = JSON.parse(readFileSync(new URL(`../../../fixtures/overhead/hexdb-airport-${icao}.json`, import.meta.url), 'utf8'));
  return { icao: body.icao, iata: body.iata, name: body.airport, lat: body.latitude, lon: body.longitude };
}
const route = (origin: RouteEnd, destination: RouteEnd): RouteInfo => ({ raw: `${origin.icao}-${destination.icao}`, origin, destination, updatedAt: null });

describe('direction, told from the home airport', () => {
  it('an arrival comes from somewhere', () => {
    expect(directionFor(route(airport('KDEN'), airport('KORD')), 'KORD')).toMatchObject({ kind: 'arrival', text: 'From Denver (DEN)', far: { icao: 'KDEN' } });
  });

  it('a departure goes somewhere', () => {
    expect(directionFor(route(airport('KORD'), airport('KDEN')), 'KORD')).toMatchObject({ kind: 'departure', text: 'To Denver (DEN)', far: { icao: 'KDEN' } });
  });

  it('a flight through shows both ends', () => {
    expect(directionFor(route(airport('KLAX'), airport('KIAH')), 'KORD').text).toBe('Los Angeles (LAX) → George Bush Intercontinental (IAH)');
    expect(directionFor(route(airport('OMAA'), airport('EGLL')), 'kord').text).toBe('Abu Dhabi (AUH) → Heathrow (LHR)');
  });

  it('no route says so', () => {
    expect(directionFor(null, 'KORD')).toEqual({ kind: 'unknown', text: NO_ROUTE, far: null });
    expect(NO_ROUTE).toBe('Route not published');
  });

  it('a home airport other than O’Hare', () => {
    expect(directionFor(route(airport('KMDW'), airport('KDEN')), 'KMDW').text).toBe('To Denver (DEN)');
  });

  it('an airport hexdb does not know shows its code', () => {
    const pwk: RouteEnd = { icao: 'KPWK', iata: null, name: null, lat: null, lon: null };
    expect(directionFor(route(pwk, airport('KORD')), 'KORD').text).toBe('From KPWK');
    expect(endLabel({ icao: 'XYZ1', iata: null, name: 'Somewhere Field Airport', lat: null, lon: null })).toBe('Somewhere Field');
  });
});

describe('hexdb routes', () => {
  it('parses codes joined by dashes', () => {
    expect(parseRoute('EIDW-EGLL')).toEqual(['EIDW', 'EGLL']);
    expect(parseRoute('KORD-KDCA-KORD')).toEqual(['KORD', 'KDCA', 'KORD']);
    expect(parseRoute('KORD')).toBeNull();
    expect(parseRoute('KORD-<b>')).toBeNull();
  });

  it('picks the leg of a round trip by where the aircraft is heading (AAL1002 KORD-KDCA-KORD)', () => {
    const codes = ['KORD', 'KDCA', 'KORD'];
    expect(chooseLeg(codes, 'KORD', true)).toEqual(['KDCA', 'KORD']);
    expect(chooseLeg(codes, 'KORD', false)).toEqual(['KORD', 'KDCA']);
    expect(chooseLeg(codes, 'KORD', null)).toEqual(['KORD', 'KDCA']);
    // Away from home (AAL874's KCLT-KMDT-KCLT): the leg it points at, else the first; never an airport to itself.
    expect(chooseLeg(['KCLT', 'KMDT', 'KCLT'], 'KORD', null)).toEqual(['KCLT', 'KMDT']);
    expect(chooseLeg(['KCLT', 'KMDT', 'KCLT'], 'KORD', null, (icao) => (icao === 'KCLT' ? 10 : 150))).toEqual(['KMDT', 'KCLT']);
    expect(chooseLeg(['KCLT', 'KMDT', 'KCLT'], 'KORD', null, (icao) => (icao === 'KMDT' ? 5 : 170))).toEqual(['KCLT', 'KMDT']);
    expect(chooseLeg(['KSFO', 'KORD'], 'KORD', false)).toEqual(['KSFO', 'KORD']);
  });

  it('calls a route older than a year possibly out of date (most of hexdb’s are, DISCOVERY section 6)', () => {
    const now = Date.parse('2026-11-23T00:00:00Z');
    expect(routeIsOld({ updatedAt: 1545595432 * 1000 }, now)).toBe(true);
    expect(routeIsOld({ updatedAt: Date.parse('2026-05-18T00:00:00Z') }, now)).toBe(false);
    expect(routeIsOld({ updatedAt: null }, now)).toBe(false);
  });

  it('names a place from the airport’s name', () => {
    expect(placeName("Chicago O'Hare International Airport")).toBe("Chicago O'Hare");
    expect(placeName('Dublin Airport')).toBe('Dublin');
    expect(placeName('Los Cabos International Airport')).toBe('Los Cabos');
    expect(placeName('Airport')).toBe('Airport');
    expect(placeName('Minneapolis-Saint Paul International Airport (Wold-Chamberlain Field)')).toBe('Minneapolis-Saint Paul');
    expect(placeName('Aspen-Pitkin County Airport (Sardy Field)')).toBe('Aspen-Pitkin');
  });
});

describe('plain words', () => {
  it('names the airline from the callsign’s prefix', () => {
    expect(airlineFor('UAL2428', 'UMB BANK NA TRUSTEE')).toBe('United');
    expect(airlineFor('SKW553U', 'SKYWEST AIRLINES INC')).toBe('SkyWest');
    expect(splitCallsign('SKW553U')).toEqual({ prefix: 'SKW', number: '553U' });
  });

  it('falls back to the operator, but never a bank holding the title', () => {
    expect(airlineFor('N442PP', 'WILCO HELICOPTERS INC')).toBe('Wilco Helicopters');
    expect(airlineFor('ZZZ123', 'United Express')).toBe('United Express');
    expect(airlineFor('N17427', 'UMB BANK NA TRUSTEE')).toBeNull();
    expect(operatorName('WILMINGTON TRUST CO TRUSTEE')).toBeNull();
    expect(operatorName('SKY CHAIR LLC, IRB HOLDING CORP')).toBe('SKY Chair LLC, IRB Holding');
    expect(airlineFor(null, null)).toBeNull();
  });

  it('says the type in words when the data has it', () => {
    expect(typeNameFor({ desc: 'BOEING 737 MAX 9', manufacturer: null, model: null })).toBe('Boeing 737 MAX 9');
    expect(typeNameFor({ desc: 'EMBRAER ERJ-170-200 (long wing)', manufacturer: null, model: null })).toBe('Embraer ERJ-170-200 (long wing)');
    expect(typeNameFor({ desc: 'BOMBARDIER Regional Jet CRJ-700', manufacturer: null, model: null })).toBe('Bombardier Regional Jet CRJ-700');
    expect(typeNameFor({ desc: null, manufacturer: 'Boeing', model: '787 9' })).toBe('Boeing 787 9');
    expect(typeNameFor({ desc: null, manufacturer: null, model: null })).toBeNull();
    expect(titleWords('GULFSTREAM G650')).toBe('Gulfstream G650');
  });
});
