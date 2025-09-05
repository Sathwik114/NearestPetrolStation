export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistance(meters) {
  if (meters == null || Number.isNaN(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function sortStationsByDistance(stations) {
  return [...stations].sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
}





