import { useEffect, useRef, useState } from 'react';
import polyline from '@mapbox/polyline';
import maplibregl from 'maplibre-gl';

const FALLBACK_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const DEFAULT_API_BASE = 'https://maps.grab.com/api/v1';
const SINGAPORE_CENTER = [103.8198, 1.3521];
const SINGAPORE_ZOOM = 11;
const ROUTE_SOURCE_ID = 'cityflow-routes';
const ROUTE_SOLID_LAYER_ID = 'cityflow-routes-solid-layer';
const ROUTE_DASHED_LAYER_ID = 'cityflow-routes-dashed-layer';
const DISRUPTIONS_SOURCE_ID = 'cityflow-live-disruptions';
const DISRUPTIONS_LAYER_ID = 'cityflow-live-disruptions-layer';
const MODE_TO_ROUTE_ID = {
  fastest: 'fastest',
  safer: 'context-aware',
  distribute: 'distributed',
};
const ROUTE_ID_TO_MODE = {
  fastest: 'fastest',
  'context-aware': 'safer',
  distributed: 'distribute',
};
const ROUTE_UI_CONTENT = {
  fastest: {
    name: 'Fastest',
    badge: 'Live GrabMaps fastest route',
    reason: 'Live GrabMaps route with best ETA.',
  },
  'context-aware': {
    name: 'Safer at Night',
    badge: 'Lighting-aware',
    reason: 'Uses lighting and incident signals for night travel.',
  },
  distributed: {
    name: 'Distribute Traffic',
    badge: 'Network-aware',
    reason: 'Compares the fastest corridor with an alternate routed corridor to show how demand can be distributed.',
  },
};
const LOADING_STAGES = [
  'Fetching live route...',
  'Checking lighting coverage...',
  'Checking incidents...',
  'Scoring route options...',
];
const presetLocations = [
  { id: 'jurong-east', label: 'Jurong East', lng: 103.7423, lat: 1.3331 },
  { id: 'marina-bay-sands', label: 'Marina Bay Sands', lng: 103.8607, lat: 1.2834 },
  { id: 'changi-airport', label: 'Changi Airport', lng: 103.9915, lat: 1.3644 },
  { id: 'orchard-road', label: 'Orchard Road', lng: 103.8326, lat: 1.3048 },
  { id: 'tanjong-pagar', label: 'Tanjong Pagar', lng: 103.8467, lat: 1.2764 },
  { id: 'woodlands', label: 'Woodlands', lng: 103.7868, lat: 1.4360 },
  { id: 'tampines', label: 'Tampines', lng: 103.9451, lat: 1.3526 },
  { id: 'one-north', label: 'One-North', lng: 103.7873, lat: 1.2996 },
];
const defaultOriginId = 'jurong-east';
const defaultDestinationId = 'marina-bay-sands';
const TRAFFIC_INCIDENTS_LOG_LABEL = 'trafficIncidents.json';
const ROAD_WORKS_LOG_LABEL = 'roadWorks.json';
const FLOOD_ALERTS_LOG_LABEL = 'floodAlerts.json';

const baseRouteOptions = [
  {
    id: 'fastest',
    label: 'Fastest',
    title: 'Fastest Route',
    durationSeconds: 24 * 60,
    distanceMeters: 17.8 * 1000,
    passesIncident: false,
    safetyScore: '72 / 100',
    flowScore: '91 / 100',
    impactTone: 'high',
    decisionScore: {
      congestionImpact: 'high',
    },
    explanation: 'Best individual ETA, but likely to attract the most drivers and increase corridor pressure.',
    color: '#1666ff',
    lineStyle: 'solid',
    lineWidth: 6,
    lineOpacity: 0.96,
    isReal: false,
    coordinates: [
      [103.7005, 1.3326],
      [103.734, 1.3344],
      [103.7765, 1.3228],
      [103.8198, 1.3187],
      [103.8584, 1.3148],
      [103.8958, 1.3054],
    ],
  },
  {
    id: 'context-aware',
    label: 'Safer at Night',
    title: 'Safer at Night',
    durationSeconds: 28 * 60,
    distanceMeters: 18.9 * 1000,
    passesIncident: false,
    safetyScore: '93 / 100',
    flowScore: '74 / 100',
    impactTone: 'moderate',
    decisionScore: {
      disruptionRisk: 'low',
    },
    explanation: 'Slightly longer, but prioritises reliability and avoids disruption-heavy segments.',
    color: '#4ade80',
    lineStyle: 'solid',
    lineWidth: 5,
    lineOpacity: 0.82,
    isReal: false,
    coordinates: [
      [103.7005, 1.3326],
      [103.7261, 1.3488],
      [103.7559, 1.3634],
      [103.7924, 1.3605],
      [103.8343, 1.3472],
      [103.8732, 1.3256],
      [103.8958, 1.3054],
    ],
  },
  {
    id: 'distributed',
    label: 'Distribute Traffic',
    title: 'Distribute Traffic',
    durationSeconds: 26 * 60,
    distanceMeters: 18.3 * 1000,
    passesIncident: false,
    safetyScore: '84 / 100',
    flowScore: '94 / 100',
    impactTone: 'balanced',
    decisionScore: {
      networkFlow: 'optimal',
    },
    explanation: 'Distributes demand away from the fastest corridor to improve city-wide traffic flow.',
    color: '#f28a1a',
    lineStyle: 'dashed',
    lineWidth: 6,
    lineOpacity: 0.92,
    isReal: false,
    coordinates: [
      [103.7005, 1.3326],
      [103.7247, 1.3299],
      [103.7596, 1.3372],
      [103.7928, 1.3418],
      [103.8266, 1.3362],
      [103.8629, 1.3221],
      [103.8958, 1.3054],
    ],
  },
];

function buildGrabMapsRequest(grabMapsApiKey, grabMapsStyleUrl) {
  if (!grabMapsApiKey || !grabMapsStyleUrl) {
    return null;
  }

  let styleOrigin;

  try {
    styleOrigin = new URL(grabMapsStyleUrl).origin;
  } catch {
    styleOrigin = null;
  }

  return (url) => {
    const shouldAttachAuth =
      url.startsWith('https://maps.grab.com/') ||
      url.startsWith('https://api.grabmaps.com/') ||
      (styleOrigin ? url.startsWith(styleOrigin) : false);

    if (!shouldAttachAuth) {
      return { url };
    }

    return {
      url,
      headers: {
        Authorization: `Bearer ${grabMapsApiKey}`,
      },
    };
  };
}

function parseLocalJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.log(`${label} data shape`, raw);
    console.warn(`Failed to parse ${label}.`, error);
    return null;
  }
}

function extractCoordinateValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];

    if (value !== undefined && value !== null && value !== '') {
      const numericValue = Number(value);

      if (!Number.isNaN(numericValue)) {
        return numericValue;
      }
    }
  }

  return null;
}

function normalizeDisruptionCoordinates(item) {
  const lat = extractCoordinateValue(item, ['lat', 'latitude', 'Latitude', 'LATITUDE', 'y', 'Y']);
  const lng = extractCoordinateValue(item, ['lng', 'lon', 'longitude', 'Longitude', 'LONGITUDE', 'x', 'X']);

  if (lat === null || lng === null) {
    return null;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

function classifyRoadworkStatus(item) {
  const now = new Date();
  const startDate = item?.StartDate ? new Date(item.StartDate) : null;
  const endDate = item?.EndDate ? new Date(item.EndDate) : null;
  const hasValidStart = startDate instanceof Date && !Number.isNaN(startDate.getTime());
  const hasValidEnd = endDate instanceof Date && !Number.isNaN(endDate.getTime());

  if (hasValidStart && startDate > now) {
    return 'planned';
  }

  if (hasValidStart && hasValidEnd && startDate <= now && endDate >= now) {
    return 'current';
  }

  return 'roadwork';
}

function normalizeTrafficIncidents(data) {
  const entries = Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : [];

  if (!entries.length) {
    console.log(`${TRAFFIC_INCIDENTS_LOG_LABEL} data shape`, data);
  }

  let loggedMissingCoordinates = false;

  return entries
    .map((item, index) => {
      const coordinates = normalizeDisruptionCoordinates(item);

      if (!coordinates) {
        if (!loggedMissingCoordinates) {
          console.log(`${TRAFFIC_INCIDENTS_LOG_LABEL} data shape`, item);
          loggedMissingCoordinates = true;
        }
        return null;
      }

      const rawType = String(item?.Type || item?.type || 'incident').toLowerCase();
      const isRoadwork = rawType.includes('roadwork');

      return {
        id: `traffic-incident-${index}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
        type: isRoadwork ? 'roadwork' : 'incident',
        label: item?.Message || item?.message || item?.RoadName || item?.Type || 'Traffic incident',
        status: isRoadwork ? 'current' : 'live',
      };
    })
    .filter(Boolean);
}

function normalizeRoadWorks(data) {
  const entries = Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : [];

  if (!entries.length) {
    console.log(`${ROAD_WORKS_LOG_LABEL} data shape`, data);
  }

  let loggedMissingCoordinates = false;

  return entries
    .map((item, index) => {
      const coordinates = normalizeDisruptionCoordinates(item);

      if (!coordinates) {
        if (!loggedMissingCoordinates) {
          console.log(`${ROAD_WORKS_LOG_LABEL} data shape`, item);
          loggedMissingCoordinates = true;
        }
        return null;
      }

      return {
        id: `roadwork-${index}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
        type: 'roadwork',
        label: item?.RoadName ? `${item.RoadName} roadworks` : item?.EventID || 'Roadworks',
        status: classifyRoadworkStatus(item),
      };
    })
    .filter(Boolean);
}

function hasActiveFloodAlerts(data) {
  const entries = Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : [];

  if (!entries.length) {
    console.log(`${FLOOD_ALERTS_LOG_LABEL} data shape`, data);
    return false;
  }

  const now = new Date();

  return entries.some((item) => {
    const isFloodEvent = String(item?.event || '').toLowerCase().includes('flood');
    const isAlert = String(item?.msgType || '').toLowerCase() === 'alert';
    const isActual = !item?.status || String(item.status).toLowerCase() === 'actual';
    const expiresAt = item?.expires ? new Date(item.expires) : null;
    const hasValidExpiry = expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime());

    return isFloodEvent && isAlert && isActual && (!hasValidExpiry || expiresAt >= now);
  });
}

async function buildDatasetContext() {
  const [streetLampsModule, floodAlertsModule, trafficIncidentsModule, roadWorksModule] = await Promise.all([
    import('./data/streetLamps.geojson?raw'),
    import('./data/PubFloodAlerts.json?raw'),
    import('./data/TrafficIncidents.json?raw'),
    import('./data/RoadWorks.json?raw'),
  ]);
  const streetLampsRaw = streetLampsModule.default;
  const floodAlertsRaw = floodAlertsModule.default;
  const trafficIncidentsRaw = trafficIncidentsModule.default;
  const roadWorksRaw = roadWorksModule.default;
  const streetLampsData = parseLocalJson(streetLampsRaw, 'streetLamps.geojson');
  const floodAlertsData = parseLocalJson(floodAlertsRaw, FLOOD_ALERTS_LOG_LABEL);
  const trafficIncidentsData = parseLocalJson(trafficIncidentsRaw, TRAFFIC_INCIDENTS_LOG_LABEL);
  const roadWorksData = parseLocalJson(roadWorksRaw, ROAD_WORKS_LOG_LABEL);
  const streetLampCoordinates = (streetLampsData?.features || [])
    .map((feature) => feature?.geometry?.coordinates)
    .filter((coordinates) => Array.isArray(coordinates) && coordinates.length >= 2)
    .map(([lng, lat]) => [Number(lng), Number(lat)])
    .filter(([lng, lat]) => !Number.isNaN(lng) && !Number.isNaN(lat));
  const disruptionPoints = [
    ...normalizeTrafficIncidents(trafficIncidentsData),
    ...normalizeRoadWorks(roadWorksData),
  ];

  return {
    streetLampCoordinates,
    disruptionPoints,
    floodActive: hasActiveFloodAlerts(floodAlertsData),
  };
}

function getDisruptionMarkerColor(point) {
  if (point.type === 'incident') {
    return '#d83a3a';
  }

  if (point.status === 'planned') {
    return '#e7c53d';
  }

  return '#f28a1a';
}

function getSelectedModeColor(selectedMode) {
  if (selectedMode === 'safer') {
    return '#4ade80';
  }

  if (selectedMode === 'distribute') {
    return '#f28a1a';
  }

  return '#1666ff';
}

function getVisibleRoutesForMode(grabRoutes, selectedMode, safestRouteId) {
  const fastestRoute = grabRoutes.find((route) => route.id === 'grab-0');
  const safetyRoute = grabRoutes.find((route) => route.id === safestRouteId);

  if (selectedMode === 'distribute') {
    return grabRoutes
      .filter((route) => route.id === 'grab-0' || route.id === 'grab-1' || route.id === 'grab-alt')
      .map((route) => ({
        ...route,
        color: route.id === 'grab-0' ? '#1666ff' : '#f28a1a',
      lineStyle: 'solid',
      lineOpacity: 0.9,
      lineWidth: 6,
      }));
  }

  if (selectedMode === 'safer') {
    if (!fastestRoute) {
      return [];
    }

    if (!safetyRoute || safetyRoute.id === fastestRoute.id) {
      return [
        {
          ...fastestRoute,
          color: '#4ade80',
          lineStyle: 'solid',
          lineOpacity: 0.95,
          lineWidth: 6,
        },
      ];
    }

    return [
      {
        ...fastestRoute,
        color: '#1666ff',
        lineStyle: 'solid',
        lineOpacity: 0.32,
        lineWidth: 5,
      },
      {
        ...safetyRoute,
        color: '#4ade80',
        lineStyle: 'solid',
        lineOpacity: 0.95,
        lineWidth: 6,
      },
    ];
  }

  if (!fastestRoute) {
    return [];
  }

  return [
    {
      ...fastestRoute,
      color: getSelectedModeColor(selectedMode),
      lineStyle: 'solid',
      lineOpacity: 0.96,
      lineWidth: 6,
    },
  ];
}

function buildRouteFeatureCollection(routes, selectedRouteId, selectedMode, safestRouteId) {
  const visibleRoutes = getVisibleRoutesForMode(routes, selectedMode, safestRouteId);

  return {
    type: 'FeatureCollection',
    features: visibleRoutes
      .filter((route) => Array.isArray(route.coordinates) && route.coordinates.length > 1)
      .map((route) => ({
        type: 'Feature',
        properties: {
          id: route.id,
          color: route.color,
          isSelected:
            selectedMode === 'distribute'
              ? route.id === 'grab-0'
                ? 1
                : 0
              : selectedMode === 'safer'
                ? route.id === safestRouteId
                  ? 1
                  : 0
                : route.id === 'grab-0'
                  ? 1
                  : 0,
          lineStyle: route.lineStyle || 'solid',
          lineWidth: route.lineWidth || 4.5,
          lineOpacity: route.lineOpacity || 0.82,
        },
        geometry: {
          type: 'LineString',
          coordinates: route.coordinates,
        },
      })),
  };
}

function buildDisruptionFeatureCollection(disruptionPoints) {
  return {
    type: 'FeatureCollection',
    features: disruptionPoints.map((point) => ({
      type: 'Feature',
      properties: {
        type: point.type,
        status: point.status,
        label: point.label,
        markerColor: getDisruptionMarkerColor(point),
      },
      geometry: {
        type: 'Point',
        coordinates: [point.lng, point.lat],
      },
    })),
  };
}

function addRouteLayer(map, routes, selectedRouteId, selectedMode, safestRouteId) {
  if (map.getSource(ROUTE_SOURCE_ID)) {
    return;
  }

  map.addSource(ROUTE_SOURCE_ID, {
    type: 'geojson',
    data: buildRouteFeatureCollection(routes, selectedRouteId, selectedMode, safestRouteId),
  });

  map.addLayer({
    id: ROUTE_SOLID_LAYER_ID,
    type: 'line',
    source: ROUTE_SOURCE_ID,
    filter: ['!=', ['get', 'lineStyle'], 'dashed'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['+', ['get', 'lineWidth'], ['case', ['==', ['get', 'isSelected'], 1], 1.4, 0]],
      'line-opacity': ['case', ['==', ['get', 'isSelected'], 1], 0.99, ['get', 'lineOpacity']],
      'line-blur': 0.2,
    },
  });

  map.addLayer({
    id: ROUTE_DASHED_LAYER_ID,
    type: 'line',
    source: ROUTE_SOURCE_ID,
    filter: ['==', ['get', 'lineStyle'], 'dashed'],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      'line-dasharray': [2.2, 1.8],
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['+', ['get', 'lineWidth'], ['case', ['==', ['get', 'isSelected'], 1], 1, 0]],
      'line-opacity': ['case', ['==', ['get', 'isSelected'], 1], 0.98, ['get', 'lineOpacity']],
    },
  });
}

function clearRouteLayer(map) {
  if (map.getLayer(ROUTE_DASHED_LAYER_ID)) {
    map.removeLayer(ROUTE_DASHED_LAYER_ID);
  }

  if (map.getLayer(ROUTE_SOLID_LAYER_ID)) {
    map.removeLayer(ROUTE_SOLID_LAYER_ID);
  }

  if (map.getSource(ROUTE_SOURCE_ID)) {
    map.removeSource(ROUTE_SOURCE_ID);
  }
}

function addDisruptionsLayer(map, disruptionPoints) {
  if (map.getSource(DISRUPTIONS_SOURCE_ID)) {
    return;
  }

  map.addSource(DISRUPTIONS_SOURCE_ID, {
    type: 'geojson',
    data: buildDisruptionFeatureCollection(disruptionPoints),
  });

  map.addLayer({
    id: DISRUPTIONS_LAYER_ID,
    type: 'circle',
    source: DISRUPTIONS_SOURCE_ID,
    paint: {
      'circle-radius': 5,
      'circle-color': ['get', 'markerColor'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  });
}

function updateDisruptionsLayer(map, disruptionPoints) {
  if (!map.getSource(DISRUPTIONS_SOURCE_ID)) {
    addDisruptionsLayer(map, disruptionPoints);
    return;
  }

  map.getSource(DISRUPTIONS_SOURCE_ID)?.setData(buildDisruptionFeatureCollection(disruptionPoints));
}

function updateRouteLayer(map, routes, selectedRouteId, selectedMode, safestRouteId) {
  clearRouteLayer(map);
  addRouteLayer(map, routes, selectedRouteId, selectedMode, safestRouteId);
}

function updateWaypointMarkers(map, markerRefs, origin, destination) {
  if (!map) {
    return;
  }

  if (origin) {
    if (!markerRefs.current.start) {
      markerRefs.current.start = new maplibregl.Marker({
        element: createWaypointMarkerElement('start'),
        anchor: 'bottom',
      });
    }

    markerRefs.current.start.setLngLat([origin.lng, origin.lat]).addTo(map);
  }

  if (destination) {
    if (!markerRefs.current.end) {
      markerRefs.current.end = new maplibregl.Marker({
        element: createWaypointMarkerElement('end'),
        anchor: 'bottom',
      });
    }

    markerRefs.current.end.setLngLat([destination.lng, destination.lat]).addTo(map);
  }
}

function decodePolyline(polyline) {
  const coordinates = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < polyline.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLatitude = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    latitude += deltaLatitude;

    shift = 0;
    result = 0;

    do {
      byte = polyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLongitude = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    longitude += deltaLongitude;

    coordinates.push([longitude / 1e5, latitude / 1e5]);
  }

  return coordinates;
}

function normalizeCoordinatePair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) {
    return null;
  }

  const first = Number(pair[0]);
  const second = Number(pair[1]);

  if (Number.isNaN(first) || Number.isNaN(second)) {
    return null;
  }

  let lng = first;
  let lat = second;

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
      lng = second;
      lat = first;
    } else {
      return null;
    }
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return [lng, lat];
}

function isLikelySingaporeCoordinate([lng, lat]) {
  return lng >= 103 && lng <= 104.2 && lat >= 1 && lat <= 1.6;
}

function inspectRouteGeometry(geometry) {
  console.log('route.geometry', geometry);
  console.log('route.geometry typeof', typeof geometry);

  if (typeof geometry === 'string') {
    console.log('route.geometry preview', geometry.slice(0, 200));
    return;
  }

  if (Array.isArray(geometry)) {
    console.log('route.geometry preview', geometry.slice(0, 3));
    return;
  }

  if (geometry && typeof geometry === 'object') {
    if (Array.isArray(geometry.coordinates)) {
      console.log('route.geometry preview', geometry.coordinates.slice(0, 3));
    } else {
      const preview = Object.fromEntries(Object.entries(geometry).slice(0, 5));
      console.log('route.geometry preview', preview);
    }
  }
}

function decodeGrabMapsPolyline(geometryString, precision) {
  return polyline.decode(geometryString, precision).map(([lat, lng]) => [lng, lat]);
}

function normalizeRouteCoordinates(rawCoordinates) {
  return rawCoordinates.map(normalizeCoordinatePair).filter(Boolean);
}

function hasValidSingaporeRoute(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length > 20 &&
    isLikelySingaporeCoordinate(coordinates[0]) &&
    isLikelySingaporeCoordinate(coordinates[coordinates.length - 1]) &&
    coordinates.every(isLikelySingaporeCoordinate)
  );
}

function extractRouteCoordinates(geometry) {
  inspectRouteGeometry(geometry);

  if (!geometry) {
    return { coordinates: [], renderable: false };
  }

  const polylineGeometry =
    typeof geometry === 'string'
      ? geometry
      : typeof geometry?.polyline === 'string'
        ? geometry.polyline
        : typeof geometry?.points === 'string'
          ? geometry.points
          : null;

  if (polylineGeometry) {
    console.log('RAW geometry:', polylineGeometry);

    try {
      const decoded = polyline.decode(polylineGeometry, 6);
      console.log('Decoded with precision 6');
      console.log('decoded points', decoded.slice(0, 5));

      const coords = decoded.map(([lat, lng]) => [lng, lat]);
      const validCoords = coords.filter(([lng, lat]) => lng > 100 && lng < 110 && lat > 0 && lat < 5);

      console.log('map coords', coords.slice(0, 5));
      console.log('Valid coords count:', validCoords.length);

      if (validCoords.length > 5) {
        console.log('drawing REAL GrabMaps route with', validCoords.length, 'points');
        return {
          coordinates: validCoords,
          renderable: hasValidSingaporeRoute(validCoords),
        };
      }
    } catch (error) {
      console.warn('Failed to decode GrabMaps polyline6 geometry', error);
    }

    console.log('RAW geometry', polylineGeometry);
    return { coordinates: [], renderable: false };
  }

  const rawCoordinates = Array.isArray(geometry)
    ? geometry
    : Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : [];
  const normalizedCoordinates = normalizeRouteCoordinates(rawCoordinates);
  const validCoords = normalizedCoordinates.filter(([lng, lat]) => lng > 100 && lng < 110 && lat > 0 && lat < 5);

  console.log('map coords', validCoords.slice(0, 5));
  console.log('Valid coords count:', validCoords.length);

  if (hasValidSingaporeRoute(validCoords)) {
    console.log('drawing REAL GrabMaps route with', validCoords.length, 'points');
    return {
      coordinates: validCoords,
      renderable: true,
    };
  }

  console.log('RAW geometry', geometry);
  return { coordinates: [], renderable: false };
}

function fitMapToRoute(map, coordinates) {
  if (!map || !Array.isArray(coordinates) || coordinates.length < 2) {
    return;
  }

  const bounds = new maplibregl.LngLatBounds(coordinates[0], coordinates[0]);

  coordinates.slice(1).forEach((coordinate) => {
    bounds.extend(coordinate);
  });

  map.fitBounds(bounds, {
    padding: 80,
    duration: 700,
    maxZoom: 15,
  });
}

function createDistributedRouteCoordinates(baseCoordinates) {
  if (!Array.isArray(baseCoordinates) || baseCoordinates.length < 2) {
    return [];
  }

  return baseCoordinates.map((coordinate, index, coordinates) => {
    if (index === 0 || index === coordinates.length - 1) {
      return coordinate;
    }

    const previous = coordinates[index - 1];
    const next = coordinates[index + 1];
    const dx = next[0] - previous[0];
    const dy = next[1] - previous[1];
    const magnitude = Math.hypot(dx, dy) || 1;
    const offsetFactor = Math.sin((index / (coordinates.length - 1)) * Math.PI);
    const offsetAmount = 0.004 + offsetFactor * 0.0035;
    const offsetLng = (-dy / magnitude) * offsetAmount;
    const offsetLat = (dx / magnitude) * offsetAmount;

    return [coordinate[0] + offsetLng, coordinate[1] + offsetLat];
  });
}

function createWaypointMarkerElement(kind) {
  const element = document.createElement('div');
  element.className = `waypoint-marker ${kind}`;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function formatDistance(distanceMeters) {
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatDuration(durationSeconds) {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}

function normalizeSearchPlace(place) {
  const location = place.location || {};
  const lat = Number(
    location.lat || location.latitude || place.lat || place.latitude || place.geometry?.coordinates?.[1],
  );
  const lng = Number(
    location.lng || location.longitude || location.lon || place.lng || place.longitude || place.geometry?.coordinates?.[0],
  );

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }

  return {
    id: place.id || place.poiID || place.poi_id || place.place_id || `${lng}-${lat}`,
    label: place.name || place.title || place.address || 'Unknown place',
    address: place.address || place.formatted_address || '',
    lat,
    lng,
  };
}

function extractSearchPlaces(responseJson) {
  if (Array.isArray(responseJson?.places)) {
    return responseJson.places.map(normalizeSearchPlace).filter(Boolean);
  }

  if (Array.isArray(responseJson?.features)) {
    return responseJson.features
      .map((feature) =>
        normalizeSearchPlace({
          id: feature.properties?.id || feature.id,
          name: feature.properties?.name || feature.properties?.text,
          address: feature.properties?.address || feature.properties?.place_name,
          geometry: feature.geometry,
        }),
      )
      .filter(Boolean);
  }

  return [];
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

function normalizeScore(value, min, max, invert = false) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (max === min) {
    return 100;
  }

  const normalized = ((value - min) / (max - min)) * 100;
  const score = invert ? 100 - normalized : normalized;
  return Math.round(clamp(score, 0, 100));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function approximateDistanceKm(a, b) {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(b[1] - a[1]);
  const deltaLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function pointToSegmentDistanceKm(point, segmentStart, segmentEnd) {
  const avgLat = toRadians((segmentStart[1] + segmentEnd[1] + point[1]) / 3);
  const toCartesian = ([lng, lat]) => ({
    x: toRadians(lng) * 6371 * Math.cos(avgLat),
    y: toRadians(lat) * 6371,
  });

  const p = toCartesian(point);
  const a = toCartesian(segmentStart);
  const b = toCartesian(segmentEnd);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLengthSquared = abx * abx + aby * aby;

  if (abLengthSquared === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / abLengthSquared, 0, 1);
  const projectionX = a.x + t * abx;
  const projectionY = a.y + t * aby;

  return Math.sqrt((p.x - projectionX) ** 2 + (p.y - projectionY) ** 2);
}

function summarizeDisruptionsNearRoute(routeCoordinates, disruptionPoints) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    return {
      incidentsNearRoute: 0,
      roadworksNearRoute: 0,
      disruptionCount: 0,
    };
  }

  const thresholdKm = 0.2;
  let incidentsNearRoute = 0;
  let roadworksNearRoute = 0;

  for (const point of disruptionPoints) {
    const disruptionCoordinate = [point.lng, point.lat];
    let isNearRoute = false;

    for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
      if (pointToSegmentDistanceKm(disruptionCoordinate, routeCoordinates[index], routeCoordinates[index + 1]) <= thresholdKm) {
        isNearRoute = true;
        break;
      }
    }

    if (isNearRoute) {
      if (point.type === 'incident') {
        incidentsNearRoute += 1;
      } else if (point.type === 'roadwork') {
        roadworksNearRoute += 1;
      }
    }
  }

  return {
    incidentsNearRoute,
    roadworksNearRoute,
    disruptionCount: incidentsNearRoute + roadworksNearRoute,
  };
}

function getRouteSafetySignal(routeCoordinates, datasetContext) {
  const lightingCount = countStreetLampsNearRoute(routeCoordinates || [], datasetContext.streetLampCoordinates);
  const disruptionSummary = summarizeDisruptionsNearRoute(routeCoordinates || [], datasetContext.disruptionPoints);

  return {
    lightingCount,
    incidentsNearRoute: disruptionSummary.incidentsNearRoute,
    safetyValue: lightingCount * 2 - disruptionSummary.incidentsNearRoute * 25,
  };
}

function countStreetLampsNearRoute(routeCoordinates, streetLampCoordinates) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
    return 0;
  }

  const thresholdKm = 0.1;
  let lightingCount = 0;

  for (const lampCoordinate of streetLampCoordinates) {
    let isNearRoute = false;

    for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
      if (pointToSegmentDistanceKm(lampCoordinate, routeCoordinates[index], routeCoordinates[index + 1]) <= thresholdKm) {
        isNearRoute = true;
        break;
      }
    }

    if (isNearRoute) {
      lightingCount += 1;
    }
  }

  return lightingCount;
}

function deriveRoutePresentation(routes, datasetContext) {
  const routeMetrics = routes.map((route) => {
    const durationSeconds = route.durationSeconds || 0;
    const distanceMeters = route.distanceMeters || 0;
    const lightingCount = countStreetLampsNearRoute(route.coordinates || [], datasetContext.streetLampCoordinates);
    const disruptionSummary = summarizeDisruptionsNearRoute(route.coordinates || [], datasetContext.disruptionPoints);
    const congestionFactor = distanceMeters > 0 ? durationSeconds / distanceMeters : Number.POSITIVE_INFINITY;

    console.log(`${route.label} lightingCount`, lightingCount);

    return {
      ...route,
      durationSeconds,
      distanceMeters,
      lightingCount,
      ...disruptionSummary,
      congestionFactor,
    };
  });

  const durations = routeMetrics.map((route) => route.durationSeconds);
  const lightingCounts = routeMetrics.map((route) => route.lightingCount);

  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const minLightingCount = Math.min(...lightingCounts);
  const maxLightingCount = Math.max(...lightingCounts);
  const fastestDuration = Math.min(...durations);

  return routeMetrics.map((route) => {
    const etaMinutes = Math.max(1, Math.round(route.durationSeconds / 60));
    const distanceKm = Math.round(route.distanceMeters / 100) / 10;
    const efficiencyScore = normalizeScore(route.durationSeconds, minDuration, maxDuration, true);
    const lightingScore = normalizeScore(route.lightingCount, minLightingCount, maxLightingCount, false);
    const congestionScore = fastestDuration > 0 ? route.durationSeconds / fastestDuration : 1;
    const baseFlowScore = clamp(Math.round(100 - (congestionScore - 1) * 100), 0, 100);
    const flowScore = route.id === 'fastest' ? Math.round(baseFlowScore * 0.55) : baseFlowScore;

    const weights =
      route.id === 'fastest'
        ? { efficiency: 0.75, flow: 0.15, lighting: 0.1 }
        : route.id === 'context-aware'
          ? { efficiency: 0.2, flow: 0.25, lighting: 0.55 }
          : { efficiency: 0.3, flow: 0.45, lighting: 0.25 };

    const floodAdjustment =
      datasetContext.floodActive && route.id === 'fastest'
        ? -4
        : datasetContext.floodActive && route.id === 'context-aware'
          ? -6
        : datasetContext.floodActive && route.id === 'distributed'
            ? clamp(Math.round((1.25 - congestionScore) * 20), 0, 6)
            : 0;
    const disruptionPenaltyPerPoint = route.id === 'fastest' ? 3 : route.id === 'context-aware' ? 8 : 5;
    const impactScore = clamp(
      Math.round(
        efficiencyScore * weights.efficiency +
          flowScore * weights.flow +
          lightingScore * weights.lighting -
          route.disruptionCount * disruptionPenaltyPerPoint +
          floodAdjustment,
      ),
      0,
      100,
    );

    const lightingCoverage = lightingScore >= 75 ? 'High' : lightingScore >= 40 ? 'Medium' : 'Low';
    const congestionLevel = congestionScore > 1.4 ? 'High' : congestionScore > 1.2 ? 'Medium' : 'Low';
    const disruptionLevel = route.disruptionCount >= 4 ? 'High' : route.disruptionCount >= 2 ? 'Medium' : 'Low';
    const impactTone = congestionLevel === 'High' ? 'high' : congestionLevel === 'Medium' ? 'moderate' : 'balanced';

    let systemImpact = 'Moderate network tradeoff';
    let systemExplanation = 'Balanced scores across efficiency, flow, and lighting support consistent routing outcomes.';

    if (route.id === 'fastest') {
      systemImpact = 'High corridor attraction';
      systemExplanation = 'Fastest route, but may concentrate demand and expose users to more disruption.';
      if (datasetContext.floodActive) {
        systemExplanation = 'Flood alerts increase variability across routes; the fastest corridor may become less predictable under disruption.';
      }
    } else if (route.id === 'context-aware') {
      systemImpact = 'Lower night-time exposure';
      systemExplanation = 'Uses street lighting and incident proximity as night-time visibility and disruption proxies.';

      if (datasetContext.floodActive) {
        systemImpact = 'Flood-aware stability';
        systemExplanation = 'Flood alerts increase variability across routes; this option prioritises stability.';
      }
    } else if (route.id === 'distributed') {
      systemImpact = datasetContext.floodActive ? 'Flood-aware distribution' : 'Best network distribution';
      systemExplanation = 'Balances ETA with disruption avoidance and network-wide traffic distribution.';

      if (datasetContext.floodActive) {
        systemExplanation = 'Flood alerts increase variability across routes; this option spreads demand to reduce pressure on the most exposed corridor.';
      }
    }

    return {
      ...route,
      eta: `${etaMinutes} min`,
      distance: `${distanceKm.toFixed(1)} km`,
      etaMinutes,
      distanceKm,
      efficiencyScore,
      flowScore,
      lightingScore,
      impactScore,
      congestionScore: Number(congestionScore.toFixed(2)),
      congestionLevel,
      incidentsNearby: route.incidentsNearRoute,
      roadworksNearby: route.roadworksNearRoute,
      disruptionCount: route.disruptionCount,
      disruptionLevel,
      systemImpact,
      systemExplanation,
      lightingCoverage,
      impactTone,
    };
  });
}

function buildRouteData(routes, datasetContext) {
  const presentedRoutes = deriveRoutePresentation(routes, datasetContext);
  const highestImpactScore = presentedRoutes.length
    ? Math.max(...presentedRoutes.map((route) => route.impactScore))
    : 0;

  return {
    routes: presentedRoutes,
    highestImpactScore,
    byMode: presentedRoutes.reduce((accumulator, route) => {
      const mode = ROUTE_ID_TO_MODE[route.id];

      if (mode) {
        accumulator[mode] = {
          coords: route.coordinates || [],
          eta: route.eta,
          distance: route.distance,
          lightingCount: route.lightingCount,
          incidentCount: route.incidentsNearby,
          congestionScore: route.congestionScore,
          precomputedScores: {
            fastest: route.id === 'fastest' ? route.impactScore : null,
            safer: route.id === 'context-aware' ? route.impactScore : null,
            distribute: route.id === 'distributed' ? route.impactScore : null,
          },
        };
      }

      return accumulator;
    }, {}),
  };
}

async function fetchGrabRouteResponse({ coordinates, grabMapsApiKey }) {
  const params = new URLSearchParams();
  coordinates.forEach((coordinate) => {
    params.append('coordinates', `${coordinate.lng},${coordinate.lat}`);
  });
  params.set('profile', 'driving');
  params.set('overview', 'full');

  const routeUrl = `https://maps.grab.com/api/v1/maps/eta/v1/direction?${params.toString()}`;
  const response = await fetch(routeUrl, {
    headers: {
      Authorization: `Bearer ${grabMapsApiKey}`,
    },
  });
  const responseText = await response.text();
  let responseJson;

  try {
    responseJson = JSON.parse(responseText);
  } catch {
    responseJson = { raw: responseText };
  }

  return {
    routeUrl,
    response,
    responseJson,
  };
}

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const waypointMarkersRef = useRef({ start: null, end: null });
  const grabRoutesRef = useRef([]);
  const selectedModeRef = useRef('fastest');
  const datasetContextRef = useRef(null);
  const [originQuery, setOriginQuery] = useState(presetLocations.find((location) => location.id === defaultOriginId)?.label || '');
  const [destinationQuery, setDestinationQuery] = useState(
    presetLocations.find((location) => location.id === defaultDestinationId)?.label || '',
  );
  const [selectedOrigin, setSelectedOrigin] = useState(
    presetLocations.find((location) => location.id === defaultOriginId) || presetLocations[0],
  );
  const [selectedDestination, setSelectedDestination] = useState(
    presetLocations.find((location) => location.id === defaultDestinationId) || presetLocations[1],
  );
  const [originSuggestions, setOriginSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [activeField, setActiveField] = useState(null);
  const [selectedMode, setSelectedMode] = useState('fastest');
  const [showRoutes, setShowRoutes] = useState(false);
  const [routeData, setRouteData] = useState({ routes: [], highestImpactScore: 0, byMode: {} });
  const [grabRoutes, setGrabRoutes] = useState([]);
  const [activeDisruptions, setActiveDisruptions] = useState([]);
  const [alternativeRouteNotice, setAlternativeRouteNotice] = useState('');
  const [floodActive, setFloodActive] = useState(false);
  const [safestRouteId, setSafestRouteId] = useState('grab-0');
  const [requestError, setRequestError] = useState('');
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const [resolvedStyle, setResolvedStyle] = useState(FALLBACK_STYLE_URL);
  const grabMapsApiKey = import.meta.env.VITE_GRABMAPS_API_KEY?.trim();
  const grabMapsStyleUrl = import.meta.env.VITE_GRABMAPS_STYLE_URL?.trim();
  const grabMapsApiBase = import.meta.env.VITE_GRABMAPS_API_BASE?.trim() || DEFAULT_API_BASE;
  const presentedRoutes = routeData.routes;
  const selectedRouteId = MODE_TO_ROUTE_ID[selectedMode];
  const highestImpactScore = routeData.highestImpactScore;

  function handleModeSelect(mode) {
    console.log('Clicked mode:', mode);
    setSelectedMode(mode);
  }

  useEffect(() => {
    console.log('Selected mode:', selectedMode);
  }, [selectedMode]);

  useEffect(() => {
    if (!isLoadingRoute) {
      return undefined;
    }

    setLoadingStageIndex(0);

    const intervalId = window.setInterval(() => {
      setLoadingStageIndex((currentIndex) => Math.min(currentIndex + 1, LOADING_STAGES.length - 1));
    }, 700);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoadingRoute]);

  useEffect(() => {
    if (!grabMapsApiKey) {
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      if (originQuery.trim().length < 2) {
        setOriginSuggestions([]);
        return;
      }

      try {
        const searchUrl = new URL(`${grabMapsApiBase.replace(/\/$/, '')}/maps/poi/v1/search`);
        searchUrl.searchParams.append('keyword', originQuery.trim());
        searchUrl.searchParams.append('country', 'SGP');
        searchUrl.searchParams.append('limit', '5');
        const response = await fetch(searchUrl.toString(), {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${grabMapsApiKey}`,
          },
        });
        const responseJson = await response.json();
        setOriginSuggestions(extractSearchPlaces(responseJson));
      } catch (error) {
        if (error.name !== 'AbortError') {
          setOriginSuggestions([]);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [grabMapsApiBase, grabMapsApiKey, originQuery]);

  useEffect(() => {
    if (!grabMapsApiKey) {
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      if (destinationQuery.trim().length < 2) {
        setDestinationSuggestions([]);
        return;
      }

      try {
        const searchUrl = new URL(`${grabMapsApiBase.replace(/\/$/, '')}/maps/poi/v1/search`);
        searchUrl.searchParams.append('keyword', destinationQuery.trim());
        searchUrl.searchParams.append('country', 'SGP');
        searchUrl.searchParams.append('limit', '5');
        const response = await fetch(searchUrl.toString(), {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${grabMapsApiKey}`,
          },
        });
        const responseJson = await response.json();
        setDestinationSuggestions(extractSearchPlaces(responseJson));
      } catch (error) {
        if (error.name !== 'AbortError') {
          setDestinationSuggestions([]);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [destinationQuery, grabMapsApiBase, grabMapsApiKey]);

  useEffect(() => {
    grabRoutesRef.current = grabRoutes;
    selectedModeRef.current = selectedMode;
  }, [grabRoutes, selectedMode]);

  useEffect(() => {
    let isCancelled = false;

    async function resolveMapStyle() {
      if (!grabMapsApiKey || !grabMapsStyleUrl) {
        setResolvedStyle(FALLBACK_STYLE_URL);
        return;
      }

      try {
        const response = await fetch(grabMapsStyleUrl, {
          headers: {
            Authorization: `Bearer ${grabMapsApiKey}`,
          },
        });

        if (response.status !== 200) {
          console.warn(`GrabMaps style unavailable (${response.status}). Falling back to public MapLibre style.`);

          if (!isCancelled) {
            setResolvedStyle(FALLBACK_STYLE_URL);
          }

          return;
        }

        const styleJson = await response.json();

        if (!isCancelled) {
          setResolvedStyle(styleJson);
        }
      } catch (error) {
        console.warn('GrabMaps style request failed. Falling back to public MapLibre style.', error);

        if (!isCancelled) {
          setResolvedStyle(FALLBACK_STYLE_URL);
        }
      }
    }

    resolveMapStyle();

    return () => {
      isCancelled = true;
    };
  }, [grabMapsApiKey, grabMapsStyleUrl]);

  useEffect(() => {
    if (!mapContainerRef.current) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: resolvedStyle,
      center: SINGAPORE_CENTER,
      zoom: SINGAPORE_ZOOM,
      transformRequest: buildGrabMapsRequest(grabMapsApiKey, grabMapsStyleUrl),
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      addRouteLayer(
        map,
        grabRoutesRef.current,
        MODE_TO_ROUTE_ID[selectedModeRef.current],
        selectedModeRef.current,
        safestRouteId,
      );
      addDisruptionsLayer(map, activeDisruptions);
      updateWaypointMarkers(map, waypointMarkersRef, selectedOrigin, selectedDestination);
      map.resize();
    });

    map.on('styledata', () => {
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        addRouteLayer(
          map,
          grabRoutesRef.current,
          MODE_TO_ROUTE_ID[selectedModeRef.current],
          selectedModeRef.current,
          safestRouteId,
        );
      }
      if (!map.getSource(DISRUPTIONS_SOURCE_ID)) {
        addDisruptionsLayer(map, activeDisruptions);
      }
      updateWaypointMarkers(map, waypointMarkersRef, selectedOrigin, selectedDestination);
    });

    return () => {
      waypointMarkersRef.current.start?.remove();
      waypointMarkersRef.current.end?.remove();
      waypointMarkersRef.current = { start: null, end: null };
      mapRef.current = null;
      map.remove();
    };
  }, [activeDisruptions, grabMapsApiKey, grabMapsStyleUrl, resolvedStyle, safestRouteId]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
      return;
    }

    const map = mapRef.current;

    if (!map.getSource(ROUTE_SOURCE_ID)) {
      addRouteLayer(map, grabRoutes, selectedRouteId, selectedMode, safestRouteId);
    }

    updateRouteLayer(map, grabRoutes, selectedRouteId, selectedMode, safestRouteId);
  }, [grabRoutes, selectedMode, selectedRouteId, safestRouteId]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
      return;
    }

    updateDisruptionsLayer(mapRef.current, activeDisruptions);
  }, [activeDisruptions]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    updateWaypointMarkers(mapRef.current, waypointMarkersRef, selectedOrigin, selectedDestination);
  }, [selectedDestination, selectedOrigin]);

  const handleCompareRoutes = async () => {
    setShowRoutes(true);
    setIsLoadingRoute(true);
    setLoadingStageIndex(0);
    setRequestError('');
    setAlternativeRouteNotice('');

    try {
      if (!grabMapsApiKey) {
        throw new Error('Missing VITE_GRABMAPS_API_KEY in .env.');
      }

      if (!selectedOrigin || !selectedDestination) {
        throw new Error('Select an origin and destination from GrabMaps suggestions.');
      }

      const initialCoordinates = [
        { lng: selectedOrigin.lng, lat: selectedOrigin.lat },
        { lng: selectedDestination.lng, lat: selectedDestination.lat },
      ];
      const params = new URLSearchParams();
      params.append('coordinates', `${selectedOrigin.lng},${selectedOrigin.lat}`);
      params.append('coordinates', `${selectedDestination.lng},${selectedDestination.lat}`);
      params.set('profile', 'driving');
      params.set('overview', 'full');
      params.set('alternatives', '2');
      const routeUrl = `https://maps.grab.com/api/v1/maps/eta/v1/direction?${params.toString()}`;

      console.log('Calling route API');
      console.log('full route URL', routeUrl);

      const initialResponse = await fetch(routeUrl, {
        headers: {
          Authorization: `Bearer ${grabMapsApiKey}`,
        },
      });

      console.log('route response status', initialResponse.status);

      const initialResponseText = await initialResponse.text();
      let responseJson;

      try {
        responseJson = JSON.parse(initialResponseText);
      } catch {
        responseJson = { raw: initialResponseText };
      }

      console.log('route response JSON', responseJson);

      if (!initialResponse.ok) {
        throw new Error(responseJson?.message || 'GrabMaps routing request failed.');
      }

      const returnedRoutes = Array.isArray(responseJson?.routes) ? responseJson.routes.slice(0, 3) : [];
      const realRoute = returnedRoutes[0];

      if (!realRoute) {
        throw new Error('No route was returned by GrabMaps.');
      }

      console.log('route.distance', realRoute.distance);
      console.log('route.duration', realRoute.duration);
      console.log('route.geometry preview', typeof realRoute.geometry === 'string' ? realRoute.geometry.slice(0, 80) : realRoute.geometry);
      console.log('route.legs?.[0]', realRoute.legs?.[0]);
      console.log('route.steps', realRoute.steps || realRoute.legs?.[0]?.steps);
      const decodedGrabRoutes = returnedRoutes
        .map((route, index) => {
          const { coordinates, renderable } = extractRouteCoordinates(route.geometry);

          if (!renderable || coordinates.length < 2) {
            return null;
          }

          return {
            id: `grab-${index}`,
            durationSeconds: route.duration || 0,
            distanceMeters: route.distance || 0,
            coordinates,
            isReal: true,
            color: index === 0 ? '#1666ff' : index === 1 ? '#f28a1a' : '#4ade80',
            lineStyle: 'solid',
            lineWidth: 6,
            lineOpacity: index === 0 ? 0.96 : 0.88,
          };
        })
        .filter(Boolean);

      let distributedAlternativeRoute = decodedGrabRoutes.find((route) => route.id === 'grab-1') || null;

      if (!distributedAlternativeRoute) {
        try {
          const midpoint = { lng: 103.8198, lat: 1.3521 };
          const fallbackResponse = await fetchGrabRouteResponse({
            coordinates: [initialCoordinates[0], midpoint, initialCoordinates[1]],
            grabMapsApiKey,
          });
          const fallbackRoute = Array.isArray(fallbackResponse.responseJson?.routes)
            ? fallbackResponse.responseJson.routes[0]
            : null;

          if (fallbackResponse.response.ok && fallbackRoute?.geometry) {
            const { coordinates, renderable } = extractRouteCoordinates(fallbackRoute.geometry);

            if (renderable && coordinates.length > 1) {
              distributedAlternativeRoute = {
                id: 'grab-alt',
                durationSeconds: fallbackRoute.duration || 0,
                distanceMeters: fallbackRoute.distance || 0,
                coordinates,
                isReal: true,
                color: '#f28a1a',
                lineStyle: 'solid',
                lineWidth: 6,
                lineOpacity: 0.88,
              };
            }
          }
        } catch (error) {
          console.warn('Alternative route unavailable for this trip', error);
        }
      }

      const mapGrabRoutes = distributedAlternativeRoute
        ? [decodedGrabRoutes[0], distributedAlternativeRoute, ...decodedGrabRoutes.filter((route) => route.id !== 'grab-0' && route.id !== 'grab-1')]
        : decodedGrabRoutes.filter((route) => route.id === 'grab-0');

      if (!decodedGrabRoutes.length) {
        setRequestError('Route geometry could not be rendered');
      } else {
        setRequestError('');
      }

      if (!datasetContextRef.current) {
        datasetContextRef.current = await buildDatasetContext();
      }

      const datasetContext = datasetContextRef.current;
      console.log('Heavy computation triggered on Compare Routes only');

      const fastestGrabRoute = decodedGrabRoutes[0];
      const safestGrabRoute =
        decodedGrabRoutes.length > 1
          ? [...decodedGrabRoutes]
              .map((route) => ({
                ...route,
                ...getRouteSafetySignal(route.coordinates, datasetContext),
              }))
              .sort((a, b) => {
                if (b.lightingCount !== a.lightingCount) {
                  return b.lightingCount - a.lightingCount;
                }

                if (a.incidentsNearRoute !== b.incidentsNearRoute) {
                  return a.incidentsNearRoute - b.incidentsNearRoute;
                }

                return b.safetyValue - a.safetyValue;
              })[0]
          : fastestGrabRoute;

      const firstAlternativeRoute = distributedAlternativeRoute;
      setGrabRoutes(mapGrabRoutes.filter(Boolean));
      setAlternativeRouteNotice(firstAlternativeRoute ? '' : 'Alternative route unavailable for this trip');
      setActiveDisruptions(datasetContext.disruptionPoints);
      setFloodActive(datasetContext.floodActive);
      setSafestRouteId(safestGrabRoute?.id || 'grab-0');

      const updatedRouteOptions = baseRouteOptions.map((route) =>
          route.id === 'fastest'
            ? {
                ...route,
                durationSeconds: fastestGrabRoute?.durationSeconds || 0,
                distanceMeters: fastestGrabRoute?.distanceMeters || 0,
                explanation: 'This route is calculated using live GrabMaps data',
                coordinates: fastestGrabRoute?.coordinates || [],
                isReal: true,
              }
            : route.id === 'context-aware'
              ? {
                  ...route,
                  durationSeconds: safestGrabRoute?.durationSeconds || 0,
                  distanceMeters: safestGrabRoute?.distanceMeters || 0,
                  coordinates: safestGrabRoute?.coordinates || [],
                  isReal: Boolean(safestGrabRoute),
                }
            : route.id === 'distributed'
              ? {
                  ...route,
                  durationSeconds: firstAlternativeRoute?.durationSeconds || fastestGrabRoute?.durationSeconds || 0,
                  distanceMeters: firstAlternativeRoute?.distanceMeters || fastestGrabRoute?.distanceMeters || 0,
                  coordinates: firstAlternativeRoute?.coordinates || fastestGrabRoute?.coordinates || [],
                  isReal: Boolean(firstAlternativeRoute),
                  explanation: firstAlternativeRoute ? 'GrabMaps alternative route' : 'No viable alternative returned for this trip',
                }
            : route,
      );
      console.log('Heavy computation run once');
      setRouteData(buildRouteData(updatedRouteOptions, datasetContext));
      console.log('Final route drawn:', fastestGrabRoute?.coordinates?.length || 0, 'points');
      if (fastestGrabRoute?.coordinates?.length && mapRef.current) {
        fitMapToRoute(mapRef.current, fastestGrabRoute.coordinates);
      }
      setSelectedMode('fastest');

    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unable to load the live GrabMaps route.');
    } finally {
      setIsLoadingRoute(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="panel">
        <div className="hero">
          <div>
            <h1>CityFlow</h1>
            <p className="hero-copy">Choose routes by speed, night safety, and city flow.</p>
          </div>
        </div>

        <div className="input-grid">
          <label className="location-field">
            <span>Pickup</span>
            <input
              type="text"
              aria-label="Origin"
              value={originQuery}
              onFocus={() => setActiveField('origin')}
              onChange={(event) => {
                setOriginQuery(event.target.value);
                setActiveField('origin');
              }}
              placeholder="Search pickup..."
            />
            {activeField === 'origin' && originSuggestions.length > 0 ? (
              <div className="suggestion-list">
                {originSuggestions.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    className="suggestion-item"
                    onClick={() => {
                      setSelectedOrigin(location);
                      setOriginQuery(location.label);
                      setOriginSuggestions([]);
                      setActiveField(null);
                    }}
                  >
                    <strong>{location.label}</strong>
                    <span>{location.address || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          <label className="location-field">
            <span>Destination</span>
            <input
              type="text"
              aria-label="Destination"
              value={destinationQuery}
              onFocus={() => setActiveField('destination')}
              onChange={(event) => {
                setDestinationQuery(event.target.value);
                setActiveField('destination');
              }}
              placeholder="Search destination..."
            />
            {activeField === 'destination' && destinationSuggestions.length > 0 ? (
              <div className="suggestion-list">
                {destinationSuggestions.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    className="suggestion-item"
                    onClick={() => {
                      setSelectedDestination(location);
                      setDestinationQuery(location.label);
                      setDestinationSuggestions([]);
                      setActiveField(null);
                    }}
                  >
                    <strong>{location.label}</strong>
                    <span>{location.address || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              console.log('Compare Routes clicked');
              handleCompareRoutes();
            }}
            disabled={isLoadingRoute}
          >
            {isLoadingRoute ? 'Loading routes...' : 'Compare routes'}
          </button>
        </div>

        <p className="trip-summary">
          Routing from <strong>{selectedOrigin.label}</strong> to <strong>{selectedDestination.label}</strong>
        </p>

        {isLoadingRoute ? (
          <div className="loading-panel" role="status" aria-live="polite">
            <div className="loading-panel-top">
              <div className="loading-spinner" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <p className="loading-title">Calculating routes with GrabMaps...</p>
                <p className="loading-stage">{LOADING_STAGES[loadingStageIndex]}</p>
              </div>
            </div>
            <div className="loading-stage-list" aria-label="Route analysis progress">
              {LOADING_STAGES.map((stage, index) => (
                <span
                  key={stage}
                  className={
                    index < loadingStageIndex
                      ? 'loading-chip complete'
                      : index === loadingStageIndex
                        ? 'loading-chip active'
                        : 'loading-chip'
                  }
                >
                  {stage}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {floodActive ? (
          <p className="flood-banner">Flood alerts active: routing adjusted for disruption risk</p>
        ) : null}

        {requestError ? <p className="request-error">{requestError}</p> : null}
        {showRoutes && selectedMode === 'distribute' && alternativeRouteNotice ? (
          <p className="trip-summary">{alternativeRouteNotice}</p>
        ) : null}

        <div className="route-legend" aria-label="Route legend">
          <div className="legend-item">
            <span className="legend-swatch" style={{ '--legend-color': '#1666ff' }} />
            <span>Blue = Fastest</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ '--legend-color': '#4ade80' }} />
            <span>Green = Safer at Night</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ '--legend-color': '#f28a1a' }} />
            <span>Orange = Distribute Traffic</span>
          </div>
          <div className="legend-item disruption-legend">
            <span className="legend-swatch disruption incident" />
            <span>Red dots = Incidents</span>
          </div>
        </div>

        <div ref={mapContainerRef} className="map-container" aria-label="Map" />

        {showRoutes ? (
          <section className="route-panel" aria-label="Route comparison">
            <div className="route-panel-header">
              <div>
                <h2>Route Modes</h2>
              </div>
              <div className="toggle-group" role="tablist" aria-label="Route modes">
                <button
                  type="button"
                  className={selectedMode === 'fastest' ? 'mode-pill active' : 'mode-pill'}
                  onClick={() => handleModeSelect('fastest')}
                >
                  Fastest
                </button>
                <button
                  type="button"
                  className={selectedMode === 'safer' ? 'mode-pill active' : 'mode-pill'}
                  onClick={() => handleModeSelect('safer')}
                >
                  Safer at Night
                </button>
                <button
                  type="button"
                  className={selectedMode === 'distribute' ? 'mode-pill active' : 'mode-pill'}
                  onClick={() => handleModeSelect('distribute')}
                >
                  Distribute Traffic
                </button>
              </div>
            </div>

            <div className="route-grid">
              {presentedRoutes.map((route) => {
                const isSelected = ROUTE_ID_TO_MODE[route.id] === selectedMode;
                const isSystemRecommended = route.id === selectedRouteId || route.impactScore === highestImpactScore;
                const routeContent =
                  route.id === 'distributed' && grabRoutes.length <= 1
                    ? {
                        ...ROUTE_UI_CONTENT[route.id],
                        reason: 'No viable alternative returned for this trip',
                      }
                    : ROUTE_UI_CONTENT[route.id];

                return (
                  <article
                    key={route.id}
                    className={`${isSelected ? 'route-card selected' : 'route-card'}${route.isReal ? ' live-route' : ''}`}
                  >
                    <div className="route-card-top">
                      <div className="route-card-heading">
                        <p className="route-kicker">{routeContent.name}</p>
                        <h3>{routeContent.name}</h3>
                      </div>
                      <div className="route-card-tags">
                        <span className={`impact-badge ${route.impactTone}`}>{routeContent.badge}</span>
                        {(isSelected || isSystemRecommended) ? <span className="route-badge">Recommended</span> : null}
                      </div>
                    </div>

                    <div className="card-summary">
                      <div className="summary-item">
                        <span>ETA</span>
                        <strong>{route.eta}</strong>
                      </div>
                      <div className="summary-item">
                        <span>Distance</span>
                        <strong>{route.distance}</strong>
                      </div>
                      <div className="summary-item score">
                        <span>Final Score</span>
                        <strong>{route.impactScore}</strong>
                      </div>
                    </div>

                    <p className="route-explainer">{routeContent.reason}</p>

                    <div className="mini-metrics" aria-label="Route signals">
                      <span className="mini-chip">Lighting: {route.lightingCoverage}</span>
                      <span className="mini-chip">Incidents: {route.incidentsNearby}</span>
                      <span className="mini-chip">Congestion: {route.congestionLevel}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <p className="model-explainer">
          Signals used: GrabMaps routing, street lighting, traffic incidents, flood alerts, congestion ratio.
        </p>
      </div>
    </div>
  );
}

export default App;
