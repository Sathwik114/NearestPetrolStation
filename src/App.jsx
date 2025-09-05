import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { formatDistance, haversineDistanceMeters, sortStationsByDistance } from './utils';
import { useDarkMode } from './hooks/useDarkMode';
import 'leaflet/dist/leaflet.css';

// Restore default Leaflet marker icons (blue) for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).toString(),
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).toString(),
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).toString(),
});

const DEFAULT_ZOOM = 18;
const RADIUS_METERS = 2000;

function MapFlyTo({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, DEFAULT_ZOOM, { animate: true });
  }, [center, map]);
  return null;
}

async function fetchStations(lat, lon, radiusMeters) {
  const overpassUrl = 'https://overpass-api.de/api/interpreter';
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="fuel"](around:${radiusMeters},${lat},${lon});
      way["amenity"="fuel"](around:${radiusMeters},${lat},${lon});
      relation["amenity"="fuel"](around:${radiusMeters},${lat},${lon});
    );
    out center tags;`;

  const res = await fetch(overpassUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!res.ok) throw new Error('Failed to fetch stations');
  const data = await res.json();

  const elements = data.elements ?? [];
  const stations = elements.map((el) => {
    const center = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
    const tags = el.tags ?? {};
    return {
      id: el.id,
      name: tags.name,
      brand: tags.brand,
      address: [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']]
        .filter(Boolean)
        .join(' '),
      lat: center.lat,
      lon: center.lon,
    };
  });
  return stations;
}

export default function App() {
  const [userLocation, setUserLocation] = useState(null);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStationId, setSelectedStationId] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [isLocating, setIsLocating] = useState(false);

  const mapRef = useRef(null);
  const { isDark, setIsDark } = useDarkMode();
  const userMarkerRef = useRef(null);
  const hasCenteredRef = useRef(false);

  const getCurrentLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation is not supported by your browser.');
      setLoading(false);
      return;
    }
    
    setIsLocating(true);
    setGeoError(null);
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const current = { lat: latitude, lon: longitude };
        setUserLocation(current);
        setGeoError(null);
        setIsLocating(false);
      },
      (err) => {
        console.error(err);
        let errorMsg = 'Unable to retrieve your location.';
        if (err.code === 1) errorMsg = 'Location access denied. Please allow location permission and try again.';
        else if (err.code === 2) errorMsg = 'Location unavailable. Please check your GPS/network connection.';
        else if (err.code === 3) errorMsg = 'Location request timed out. Please try again.';
        
        setGeoError(errorMsg);
        setLoading(false);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    setLoading(true);
    getCurrentLocation();
  }, [getCurrentLocation]);

  useEffect(() => {
    async function load() {
      if (!userLocation) return;
      try {
        setLoading(true);
        const rawStations = await fetchStations(userLocation.lat, userLocation.lon, RADIUS_METERS);
        const withDistances = rawStations.map((s) => ({
          ...s,
          distanceMeters: haversineDistanceMeters(userLocation.lat, userLocation.lon, s.lat, s.lon),
        }));
        setStations(sortStationsByDistance(withDistances));
        setError(null);
      } catch (e) {
        console.error(e);
        setError('Failed to load nearby petrol stations. Please try again later.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userLocation]);

  const center = useMemo(() => {
    return userLocation ? [userLocation.lat, userLocation.lon] : null;
  }, [userLocation]);

  // On first location fix, fly to user and open the popup
  useEffect(() => {
    if (center && mapRef.current && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      mapRef.current.flyTo(center, DEFAULT_ZOOM, { animate: true });
      // Slight delay to ensure marker is mounted before opening popup
      setTimeout(() => {
        if (userMarkerRef.current) {
          try { userMarkerRef.current.openPopup(); } catch {}
        }
      }, 100);
    }
  }, [center]);

  const onSelectStation = useCallback((id) => {
    setSelectedStationId(id);
    const station = stations.find((s) => s.id === id);
    if (station && mapRef.current) {
      mapRef.current.flyTo([station.lat, station.lon], 17, { animate: true });
    }
  }, [stations]);
  
  // Draw a neat straight blue line from user pointer to nearest station
  useEffect(() => {
    if (!userLocation || stations.length === 0) {
      setRouteCoords(null);
      return;
    }
    const nearest = stations[0];
    setRouteCoords([[userLocation.lat, userLocation.lon], [nearest.lat, nearest.lon]]);
  }, [stations, userLocation]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100 flex flex-col">
      <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4 flex items-center justify-between">
            <h1 className="text-xl sm:text-2xl font-semibold text-primary-700 dark:text-primary-300">Fuel Finder</h1>
            <div className="flex items-center gap-4">
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-300">Within {Math.round(RADIUS_METERS/1000)} km</div>
              <button
                onClick={() => setIsDark(!isDark)}
                className="px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 shadow-sm dark:bg-primary-500 dark:hover:bg-primary-600"
                aria-label="Toggle dark mode"
              >
                {isDark ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-rows-[1fr_auto] md:grid-rows-1 md:grid-cols-3 gap-0 md:gap-4 max-w-7xl mx-auto w-full p-0 md:p-4">
        <section className="md:col-span-2 bg-white dark:bg-gray-800 md:rounded-xl md:shadow-card overflow-hidden">
          <div className="h-[60vh] md:h-[calc(100vh-8rem)] sm:h-[50vh]">
            {center && !loading && (
              <MapContainer
                center={center}
                zoom={14}
                scrollWheelZoom
                className="h-full w-full"
                ref={(instance) => (mapRef.current = instance)}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url={isDark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
                />
                <MapFlyTo center={center} />

                <Marker position={center} ref={userMarkerRef}>
                  <Popup>You are here</Popup>
                </Marker>

                {stations.map((s) => (
                  <Marker
                    key={s.id}
                    position={[s.lat, s.lon]}
                    eventHandlers={{ click: () => setSelectedStationId(s.id) }}
                  >
                    <Popup>
                      <div className="space-y-1">
                        <div className="font-medium">{s.name || 'Petrol Station'}</div>
                        {s.brand && <div className="text-sm text-gray-600 dark:text-gray-300">Brand: {s.brand}</div>}
                        {s.address && <div className="text-sm text-gray-600 dark:text-gray-300">{s.address}</div>}
                        <div className="text-sm text-gray-700 dark:text-gray-300">{formatDistance(s.distanceMeters)}</div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
                {routeCoords && (
                  <Polyline
                    positions={routeCoords}
                    pathOptions={{ color: isDark ? '#60a5fa' : '#3b82f6', weight: 4, opacity: 0.95, lineCap: 'round' }}
                  />
                )}
              </MapContainer>
            )}

            {loading && (
              <div className="h-full w-full flex items-center justify-center">
                <div className="animate-pulse text-primary-700 dark:text-primary-300">
                  {isLocating ? 'Getting your location…' : 'Loading map and nearby stations…'}
                </div>
              </div>
            )}

            {error && !loading && (
              <div className="h-full w-full flex items-center justify-center p-6">
                <div className="bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 p-4 rounded-md shadow-sm">{error}</div>
              </div>
            )}

            {geoError && !loading && (
              <div className="h-full w-full flex items-center justify-center p-6">
                <div className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 p-4 rounded-md shadow-sm max-w-sm text-center">
                  <div className="mb-3">{geoError}</div>
                  <button
                    onClick={getCurrentLocation}
                    disabled={isLocating}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLocating ? 'Locating...' : 'Try Again'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="bg-white dark:bg-gray-800 md:rounded-xl md:shadow-card border-t md:border-0">
          <div className="p-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Nearby Stations</h2>
            <span className="text-sm text-gray-500 dark:text-gray-300">{stations.length}</span>
          </div>
          <div className="max-h-[40vh] md:max-h-[calc(100vh-8rem)] overflow-y-auto divide-y">
            {stations.map((s) => {
              const isSelected = s.id === selectedStationId;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelectStation(s.id)}
                  className={`w-full text-left p-4 hover:bg-primary-50 focus:bg-primary-50 dark:hover:bg-gray-700 transition ${isSelected ? 'bg-primary-50 dark:bg-gray-700' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{s.name || 'Petrol Station'}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        {s.brand ? `Brand: ${s.brand}` : s.address || '—'}
                      </div>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDistance(s.distanceMeters)}</div>
                  </div>
                </button>
              );
            })}
            {(!loading && stations.length === 0 && !error) && (
              <div className="p-4 text-gray-600 dark:text-gray-300">No stations found within {Math.round(RADIUS_METERS/1000)} km.</div>
            )}
          </div>
        </aside>
      </main>

      {/* Floating Locate Me button for mobile */}
      <button
        onClick={getCurrentLocation}
        disabled={isLocating}
        className="fixed bottom-20 right-4 md:hidden z-20 bg-primary-600 text-white p-3 rounded-full shadow-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Locate me"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      
    </div>
  );
}


