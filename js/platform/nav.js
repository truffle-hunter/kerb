// Hand-off to the driver's own navigation app (charter: Kerb never replaces it).
export function navUrl(app, [lon, lat], label = '') {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  switch (app) {
    case 'apple': return `https://maps.apple.com/?daddr=${ll}&dirflg=d`;
    case 'waze': return `https://waze.com/ul?ll=${ll}&navigate=yes`;
    case 'geo': return `geo:${ll}?q=${ll}(${encodeURIComponent(label)})`;
    default: return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  }
}
