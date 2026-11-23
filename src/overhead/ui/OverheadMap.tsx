/**
 * Overhead's map (the brief, section 3): MapLibre through react-map-gl, on
 * OpenFreeMap's dark style (or MapTiler's with a key), its attribution always
 * shown. Home is a ringed dot; each aircraft an arrow turned to its track,
 * coloured by its bucket, with a short faded trail; a notable aircraft wears
 * a ring of its own. The highlighted aircraft gets a great circle from the
 * airport it came from (an arrival) or to the one it is going to (a
 * departure); the view widens to show home and that airport, then eases back
 * to the neighbourhood.
 *
 * It never takes a touch (`interactive={false}`): a tap anywhere ends the
 * screensaver. Without WebGL 2 (MapLibre 6 needs it, DECISIONS O7) it gives
 * way to a plain backdrop and the board carries on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Map, { Layer, Source, type MapRef } from 'react-map-gl/maplibre';
import { destinationPoint, greatCircleLine, type LatLon } from '../domain/geo.ts';
import type { Palette } from '../../ui/palette.ts';
import { ensureMaplibreWorker } from './maplibreSetup.ts';
import type { MapViewProps, PlaneKind } from './OverheadScreen.tsx';

/** The neighbourhood view: this far from home on every side, nm. */
export const LOCAL_NM = 7;
/** How long the view stays widened to the highlighted aircraft's airport. */
export const WIDE_VIEW_MS = 4_000;

const PLANE_ICON = 'overhead-plane';

export function supportsWebgl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** A plane seen from above, nose up, white on clear, for MapLibre to tint (an SDF icon). */
function planeImage(): ImageData | null {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  // Fuselage, wings and tail, drawn about the centre.
  ctx.moveTo(32, 4);
  ctx.lineTo(36, 14);
  ctx.lineTo(36, 26);
  ctx.lineTo(60, 38);
  ctx.lineTo(60, 43);
  ctx.lineTo(36, 36);
  ctx.lineTo(35, 50);
  ctx.lineTo(43, 56);
  ctx.lineTo(43, 60);
  ctx.lineTo(32, 57);
  ctx.lineTo(21, 60);
  ctx.lineTo(21, 56);
  ctx.lineTo(29, 50);
  ctx.lineTo(28, 36);
  ctx.lineTo(4, 43);
  ctx.lineTo(4, 38);
  ctx.lineTo(28, 26);
  ctx.lineTo(28, 14);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function colorFor(kind: PlaneKind, palette: Palette): string {
  if (kind === 'now') return palette.accent;
  if (kind === 'soon') return palette.info;
  if (kind === 'passed') return palette.inkMuted;
  return palette.ink;
}

/** [[west, south], [east, north]] around the points. */
function boundsOf(points: readonly LatLon[]): [[number, number], [number, number]] {
  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** The neighbourhood: LOCAL_NM around home, widened to take in any notable aircraft (the brief: its own icon on the map). */
function localBounds(home: LatLon, include: readonly LatLon[] = []) {
  return boundsOf([...[0, 90, 180, 270].map((bearing) => destinationPoint(home, LOCAL_NM, bearing)), ...include]);
}

export function OverheadMap({ home, planes, highlight, style, palette, reducedMotion }: MapViewProps) {
  const [webgl] = useState(supportsWebgl2);
  const [failed, setFailed] = useState(false);
  const ref = useRef<MapRef | null>(null);
  const [loaded, setLoaded] = useState(false);
  if (webgl) ensureMaplibreWorker();

  const data = useMemo(() => {
    const trails = {
      type: 'FeatureCollection' as const,
      features: planes
        .filter((plane) => plane.trail.length >= 2)
        .map((plane) => ({ type: 'Feature' as const, properties: { color: colorFor(plane.kind, palette) }, geometry: { type: 'LineString' as const, coordinates: plane.trail } })),
    };
    const points = {
      type: 'FeatureCollection' as const,
      features: planes.map((plane) => ({
        type: 'Feature' as const,
        properties: {
          color: colorFor(plane.kind, palette),
          track: plane.trackDeg ?? 0,
          kind: plane.kind,
          notable: plane.notable ? 1 : 0,
          lead: plane.hex === highlight?.hex ? 1 : 0,
        },
        geometry: { type: 'Point' as const, coordinates: [plane.lon, plane.lat] },
      })),
    };
    let route: Array<[number, number]> = [];
    const far = highlight?.far;
    if (highlight && far && far.lat !== null && far.lon !== null) {
      const farPoint = { lat: far.lat, lon: far.lon };
      const plane = { lat: highlight.lat, lon: highlight.lon };
      route = highlight.direction === 'departure' ? greatCircleLine(plane, farPoint) : greatCircleLine(farPoint, plane);
    }
    const routeLine = { type: 'FeatureCollection' as const, features: route.length >= 2 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: route } }] : [] };
    const homePoint = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [home.lon, home.lat] } }] };
    return { trails, points, routeLine, homePoint };
  }, [planes, highlight, home, palette]);

  // The view: widened to home and the highlighted aircraft's airport, then back to the neighbourhood.
  const farKey = highlight?.far && highlight.far.lat !== null ? `${highlight.hex}:${highlight.far.icao}` : null;
  const farLat = highlight?.far?.lat ?? null;
  const farLon = highlight?.far?.lon ?? null;
  // By value: every answer brings a new home object for the same place.
  const homeLat = home.lat;
  const homeLon = home.lon;
  // The view takes in notable aircraft where they are when one comes or goes, not as each moves.
  const notableKey = planes
    .filter((plane) => plane.notable)
    .map((plane) => plane.hex)
    .sort()
    .join(',');
  const notableAt = useRef<LatLon[]>([]);
  notableAt.current = planes.filter((plane) => plane.notable).map((plane) => ({ lat: plane.lat, lon: plane.lon }));
  useEffect(() => {
    const map = ref.current;
    if (!map || !loaded) return;
    const duration = reducedMotion ? 0 : 1600;
    const here = { lat: homeLat, lon: homeLon };
    const local = () => map.fitBounds(localBounds(here, notableAt.current), { padding: 40, duration });
    if (farKey === null || farLat === null || farLon === null) {
      local();
      return;
    }
    map.fitBounds(boundsOf([here, { lat: farLat, lon: farLon }]), { padding: 60, duration, maxZoom: 11 });
    const back = setTimeout(local, WIDE_VIEW_MS);
    return () => clearTimeout(back);
  }, [farKey, farLat, farLon, homeLat, homeLon, loaded, reducedMotion, notableKey]);

  if (!webgl || failed) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', p: '16px', color: palette.inkMuted, fontSize: 15 }}>
        {webgl ? 'The map could not load.' : 'This tablet cannot draw the map (it needs WebGL 2).'}
      </Box>
    );
  }

  return (
    <Map
      ref={ref}
      mapLib={maplibregl}
      initialViewState={{ bounds: localBounds(home), fitBoundsOptions: { padding: 24 } }}
      mapStyle={style.url}
      interactive={false}
      attributionControl={{ compact: false, ...(style.attribution ? { customAttribution: style.attribution } : {}) }}
      style={{ width: '100%', height: '100%' }}
      onLoad={(event) => {
        const image = planeImage();
        if (image && !event.target.hasImage(PLANE_ICON)) event.target.addImage(PLANE_ICON, image, { sdf: true, pixelRatio: 2 });
        setLoaded(true);
      }}
      onError={(event) => {
        // A tile or two failing is normal on a shaky network; a map that never started is not.
        if (!event.target.loaded() && !event.target.isStyleLoaded()) setFailed(true);
      }}
    >
      <Source id="overhead-route" type="geojson" data={data.routeLine}>
        <Layer id="overhead-route" type="line" paint={{ 'line-color': palette.accent, 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [2, 1.5] }} />
      </Source>
      <Source id="overhead-trails" type="geojson" data={data.trails}>
        <Layer id="overhead-trails" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.35 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
      </Source>
      <Source id="overhead-home" type="geojson" data={data.homePoint}>
        <Layer id="overhead-home-ring" type="circle" paint={{ 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': palette.ink, 'circle-stroke-width': 2.5 }} />
        <Layer id="overhead-home-dot" type="circle" paint={{ 'circle-radius': 5, 'circle-color': palette.ink }} />
      </Source>
      <Source id="overhead-planes" type="geojson" data={data.points}>
        <Layer id="overhead-lead-halo" type="circle" filter={['==', ['get', 'lead'], 1]} paint={{ 'circle-radius': 26, 'circle-color': ['get', 'color'], 'circle-opacity': 0.18 }} />
        <Layer id="overhead-notable-ring" type="circle" filter={['==', ['get', 'notable'], 1]} paint={{ 'circle-radius': 20, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': palette.error, 'circle-stroke-width': 3 }} />
        {loaded ? (
          <Layer
            id="overhead-planes"
            type="symbol"
            layout={{
              'icon-image': PLANE_ICON,
              'icon-size': ['case', ['==', ['get', 'lead'], 1], 1.25, ['==', ['get', 'kind'], 'other'], 0.7, 0.95],
              'icon-rotate': ['get', 'track'],
              'icon-rotation-alignment': 'map',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            }}
            paint={{ 'icon-color': ['case', ['==', ['get', 'notable'], 1], palette.error, ['get', 'color']], 'icon-opacity': ['case', ['==', ['get', 'kind'], 'other'], 0.55, 1] }}
          />
        ) : null}
      </Source>
    </Map>
  );
}
