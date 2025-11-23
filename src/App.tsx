import { useState, useEffect, useRef } from 'react';
import {
  Upload, Map as MapIcon, Navigation,
  Truck, Settings,
  Download, Layers
} from 'lucide-react';

declare global {
  interface Window {
    L: any;
  }
}

interface IPoint {
  id?: string | number;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  cluster?: number;
  order?: number;
}

// --- UTILITY: GEOMETRY & MATH ---

// Haversine Formula: Calculates distance in meters between two Lat/Lon points
const getDistanceMeters = (pt1: { lat: number; lon: number }, pt2: { lat: number; lon: number }) => {
  const R = 6371e3; // Earth radius in meters
  const dLat = (pt2.lat - pt1.lat) * (Math.PI / 180);
  const dLon = (pt2.lon - pt1.lon) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pt1.lat * (Math.PI / 180)) *
    Math.cos(pt2.lat * (Math.PI / 180)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// --- COMPONENT: LEAFLET MAP (REAL WORLD MAP) ---



const LeafletMap = ({ points, clusters }: { points: IPoint[], clusters: IPoint[][] }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // 1. Robust Script Loading
  useEffect(() => {
    // Check if Leaflet is already available globally
    // @ts-ignore
    if (window.L && window.L.map) {
      setLeafletLoaded(true);
      return;
    }

    const scriptId = 'leaflet-js-script';
    const cssId = 'leaflet-css-link';

    // Prevent duplicate injection
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => {
        // Double check it loaded correctly
        if (window.L && window.L.map) {
          setLeafletLoaded(true);
        }
      };
      document.body.appendChild(script);
    } else {
      // Script tag exists but maybe not loaded yet, poll for it
      const interval = setInterval(() => {
        if (window.L && window.L.map) {
          setLeafletLoaded(true);
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  // 2. Initialize & Update Map
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current || !window.L) return;

    const L = window.L;

    // Safely initialize map
    if (!mapInstance.current) {
      try {
        mapInstance.current = L.map(mapContainerRef.current).setView([0, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(mapInstance.current);
      } catch (err) {
        console.error("Map init error:", err);
      }
    }

    const map = mapInstance.current;
    if (!map) return;

    // Clear existing layers (except tiles) to redraw
    map.eachLayer((layer: any) => {
      if (!layer._url) map.removeLayer(layer);
    });

    if (!points.length) return;

    const bounds = L.latLngBounds();
    const clusterColors = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777'];

    // Draw Routes (Polylines)
    if (clusters && clusters.length > 0) {
      clusters.forEach((route, idx) => {
        if (!route || route.length < 2) return;
        const latlngs = route.map(p => [p.lat, p.lon]);
        const color = clusterColors[idx % clusterColors.length];

        L.polyline(latlngs, {
          color: color,
          weight: 4,
          dashArray: '10, 10',
          opacity: 0.6,
          lineCap: 'round'
        }).addTo(map);
      });
    }

    // Draw Markers
    points.forEach((p: IPoint) => {
      const color = p.cluster !== undefined ? clusterColors[p.cluster % clusterColors.length] : '#64748b';

      const marker = L.circleMarker([p.lat, p.lon], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map);

      const popupContent = `
        <div style="font-family: system-ui; min-width: 150px;">
          <strong style="font-size: 14px;">${p.name}</strong><br/>
          <span style="color: #64748b; font-size: 12px;">${p.order ? `Stop #${p.order}` : 'Unsorted'}</span><br/>
          <hr style="margin: 8px 0; border: 0; border-top: 1px solid #eee;"/>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" 
             target="_blank" 
             style="display: inline-block; background: #2563EB; color: white; text-decoration: none; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
             Navigate Here
          </a>
        </div>
      `;
      marker.bindPopup(popupContent);

      bounds.extend([p.lat, p.lon]);
    });

    // Fit Bounds with padding
    if (points.length > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

  }, [leafletLoaded, points, clusters]);

  return (
    <div className="w-full h-full bg-slate-100 rounded-xl overflow-hidden relative shadow-inner border border-slate-200">
      <div ref={mapContainerRef} className="w-full h-full z-0" />
      {!leafletLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 z-10">
          <span className="text-slate-500 font-medium animate-pulse">Loading Map Engine...</span>
        </div>
      )}
    </div>
  );
};

// K-Means Clustering: Groups points into 'k' zones
const kMeans = (points: any[], k: number) => {
  if (points.length === 0) return [];
  if (k >= points.length) return points.map((p, i) => ({ ...p, cluster: i }));

  // 1. Initialize Centroids (pick random points initially)
  let centroids: { lat: number; lon: number }[] = points.slice(0, k).map(p => ({ lat: p.lat, lon: p.lon }));
  let clusteredPoints = [...points];
  let iterations = 0;

  while (iterations < 15) {
    // 2. Assign points to nearest centroid
    clusteredPoints = clusteredPoints.map(p => {
      let minDist = Infinity;
      let clusterIndex = 0;
      centroids.forEach((c, idx) => {
        const dist = getDistanceMeters(p, c);
        if (dist < minDist) {
          minDist = dist;
          clusterIndex = idx;
        }
      });
      return { ...p, cluster: clusterIndex };
    });

    // 3. Recalculate Centroids
    const newCentroids = Array(k).fill(null).map(() => ({ lat: 0, lon: 0, count: 0 }));
    clusteredPoints.forEach(p => {
      newCentroids[p.cluster].lat += p.lat;
      newCentroids[p.cluster].lon += p.lon;
      newCentroids[p.cluster].count++;
    });

    centroids = newCentroids.map((c, i) => {
      if (c.count === 0) return centroids[i];
      return { lat: c.lat / c.count, lon: c.lon / c.count };
    });
    iterations++;
  }
  return clusteredPoints;
};

// Nearest Neighbor Sorting: Orders points within a cluster
const sortStops = (points: IPoint[]) => {
  if (points.length <= 1) return points;

  // Find the "northernmost" point to start (or closest to a hypothetical depot)
  // For this demo, we start with the point with the max Latitude (top of map)
  let sortedLat = [...points].sort((a, b) => b.lat - a.lat);
  let startNode = sortedLat[0];

  let unvisited = points.filter(p => p.id !== startNode.id);
  let path = [startNode];
  let current = startNode;

  while (unvisited.length > 0) {
    let nearestIdx = -1;
    let minDist = Infinity;

    unvisited.forEach((pt, idx) => {
      const dist = getDistanceMeters(current, pt);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = idx;
      }
    });

    current = unvisited[nearestIdx];
    path.push(current);
    unvisited.splice(nearestIdx, 1);
  }

  return path;
};

// --- MAIN APP COMPONENT ---

export default function DeliveryApp() {
  const [points, setPoints] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);
  const [kValue, setKValue] = useState(2);
  const [view, setView] = useState('list'); // 'list' or 'map' for mobile toggle
  const [loading, setLoading] = useState(false);

  // Generate Sample Data for easy testing
  const loadSampleData = () => {
    const centerLat = 40.7128; // NYC Area
    const centerLon = -74.0060;
    const samples = Array.from({ length: 20 }).map((_, i) => ({
      id: `S-${i + 1}`,
      name: `Delivery #${i + 1}`,
      lat: centerLat + (Math.random() - 0.5) * 0.1,
      lon: centerLon + (Math.random() - 0.5) * 0.1,
      address: `Sample St ${i + 1}`
    }));
    setPoints(samples);
    setClusters([]);
  };

  const handleFileUpload = (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (!evt.target?.result) return;
      const text = evt.target.result;
      const lines = typeof text === 'string' ? text.split('\n') : [];
      const parsed: IPoint[] = [];

      // Skip header, parse lines
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length >= 3) {
          console.log(cols);
          const lat = parseFloat(cols[4]);
          const lon = parseFloat(cols[5]);
          if (!isNaN(lat) && !isNaN(lon)) {
            parsed.push({
              id: cols[0]?.trim() || i,
              name: cols[1]?.trim() || `Stop ${i}`,
              lat,
              lon,
              address: cols[4]?.trim() || ''
            });
          }
        }
      }
      setPoints(parsed);
      setClusters([]);
    };
    reader.readAsText(file);
  };

  const runOptimization = () => {
    if (points.length === 0) return;
    setLoading(true);

    // Small timeout to allow UI to show loading state
    setTimeout(() => {
      // 1. Cluster
      const clusteredPoints = kMeans(points, kValue);

      // 2. Separate into arrays
      const grouped: { [key: number]: any[] } = {};
      clusteredPoints.forEach(p => {
        if (!grouped[p.cluster]) grouped[p.cluster] = [];
        grouped[p.cluster].push(p);
      });

      // 3. Sort each group (TSP)
      const finalRoutes = Object.values(grouped).map(group => {
        const sorted = sortStops(group);
        // Add sequential order property for display
        return sorted.map((p, idx) => ({ ...p, order: idx + 1 }));
      });

      setClusters(finalRoutes);
      setLoading(false);
    }, 600);
  };

  // Deep Link Generators
  const getMapsLink = (lat: number, lon: number) => {
    // Universal Google Maps Intent
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  };

  const getFullRouteLink = (routePoints: IPoint[]) => {
    // Google Maps allows waypoints (limited to ~10-20 depending on browser/OS)
    // Format: origin=...&destination=...&waypoints=...
    if (routePoints.length < 2) return '#';
    console.log("routePoints@@", routePoints)
    const origin = `${routePoints[0].lat},${routePoints[0].lon}`;
    const destination = `${routePoints[routePoints.length - 1].lat},${routePoints[routePoints.length - 1].lon}`;

    // Slice middle points, take max 8 to be safe with URL limits
    const waypoints = routePoints.slice(1, -1)
      .map(p => `${p.lat},${p.lon}`).join('|');

    let deeplinkAPI = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}`;

    const waypoints2 = routePoints.slice(1, -1)
      .map(p => `${p.lat},${p.lon}`).join('/');

    let deeplinkUrl = `https://www.google.com/maps/dir/${origin}/${destination}/${waypoints2}`;

    return deeplinkUrl;
  };

  const clusterColors = ['border-blue-500', 'border-red-500', 'border-green-500', 'border-yellow-500', 'border-purple-500'];
  const clusterBg = ['bg-blue-50', 'bg-red-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50'];

  return (
    <div className="flex flex-col h-screen bg-slate-100 text-slate-800 font-sans">

      {/* --- HEADER --- */}
      <header className="bg-white border-b px-4 py-3 flex justify-between items-center shadow-sm z-20">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Truck size={20} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">RouteMaster</h1>
            <p className="text-[10px] text-slate-500 font-medium">GEOMETRIC OPTIMIZER</p>
          </div>
        </div>
        <div className="flex gap-2">
          {points.length === 0 && (
            <button onClick={loadSampleData} className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition">
              <Download size={14} /> Sample Data
            </button>
          )}
          <label className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-slate-800 rounded hover:bg-slate-700 cursor-pointer transition shadow-md">
            <Upload size={14} />
            <span className="hidden sm:inline">Upload CSV</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      {/* --- MAIN WORKSPACE --- */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* LEFT PANEL: LIST & CONTROLS */}
        <div className={`
          absolute inset-0 z-10 bg-white flex flex-col transition-transform duration-300 transform
          md:relative md:w-96 md:translate-x-0 md:border-r md:shadow-xl
          ${view === 'map' ? '-translate-x-full' : 'translate-x-0'}
        `}>

          {/* Controls Area */}
          <div className="p-4 border-b bg-slate-50 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase">Drivers / Zones</label>
              <span className="bg-white border px-2 py-0.5 rounded text-sm font-mono">{kValue}</span>
            </div>
            <input
              type="range" min="1" max="6" step="1"
              value={kValue}
              onChange={(e) => setKValue(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />

            <button
              onClick={runOptimization}
              disabled={points.length === 0}
              className={`w-full py-3 rounded-lg font-bold shadow-lg flex items-center justify-center gap-2 transition
                 ${points.length === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}`}
            >
              {loading ? 'Calculating...' : (
                <> <Layers size={18} /> Optimize Routes </>
              )}
            </button>
          </div>

          {/* Scrollable List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-6 pb-20">
            {clusters.length === 0 ? (
              <div className="text-center py-10 px-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 text-blue-200 mb-4">
                  <Settings size={32} />
                </div>
                <h3 className="text-slate-900 font-medium">Ready to Optimize</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Import your CSV ({points.length} points loaded) and click Optimize to generate deep links.
                </p>
              </div>
            ) : (
              clusters.map((route, cIdx) => (
                <div key={cIdx} className={`border rounded-xl overflow-hidden bg-white shadow-sm mb-4 ${clusterColors[cIdx % clusterColors.length]}`}>
                  {/* Route Header */}
                  <div className={`px-4 py-3 border-b flex justify-between items-center ${clusterBg[cIdx % clusterBg.length]}`}>
                    <div>
                      <h3 className="font-bold text-slate-800">Route {String.fromCharCode(65 + cIdx)}</h3>
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{route.length} Stops</span>
                    </div>
                    <a
                      href={getFullRouteLink(route)}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 bg-white hover:bg-blue-50 text-blue-600 rounded-full shadow-sm border transition tooltip-trigger"
                      title="View Full Path on Maps"
                    >
                      <MapIcon size={16} />
                    </a>
                  </div>

                  {/* Stops List */}
                  <div className="divide-y divide-slate-100">
                    {route.map((stop: IPoint, sIdx: number) => (
                      <div key={stop.id} className="p-3 flex items-center gap-3 hover:bg-slate-50 transition group">
                        {/* Order Badge */}
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-sm font-bold shadow-sm">
                          {sIdx + 1}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{stop.name}</p>
                          <p className="text-[11px] text-slate-500 truncate font-mono">{stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}</p>
                        </div>

                        {/* Navigate Button (The Deep Link) */}
                        <a
                          href={getMapsLink(stop.lat, stop.lon)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 w-10 h-10 bg-blue-100 hover:bg-blue-600 hover:text-white text-blue-700 rounded-full flex items-center justify-center transition shadow-sm"
                        >
                          <Navigation size={18} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT PANEL: MAP (Hidden on mobile by default) */}
        <div className="flex-1 bg-slate-100 p-2 md:p-4 relative">
          <LeafletMap points={clusters.flat().length ? clusters.flat() : points} clusters={clusters} />

          {/* Mobile Floating View Toggle */}
          <button
            onClick={() => setView(view === 'list' ? 'map' : 'list')}
            className="md:hidden absolute bottom-6 right-6 bg-slate-900 text-white p-4 rounded-full shadow-xl flex items-center gap-2 z-50 active:scale-90 transition"
          >
            {view === 'list' ? <MapIcon size={20} /> : <Settings size={20} />}
            <span className="font-bold text-sm">{view === 'list' ? 'Show Map' : 'Show List'}</span>
          </button>
        </div>

      </div>

      {/* Footer Info */}
      <div className="bg-white border-t px-4 py-2 text-xs text-slate-400 flex justify-between">
        <span>Deep Link Routing System</span>
        <span>Optimized for Mobile</span>
      </div>
    </div>
  );
}