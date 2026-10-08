'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { formatCurrency } from '@/lib/format';
import { createGeoJSONCircle } from '@/lib/geo';
import DrillDownPanel from './components/DrillDownPanel';
import ProjectSidebar from './components/ProjectSidebar';
import ProjectInspectionDrawer from '@/components/project-inspection-drawer';
import { useMapInstance } from './hooks/useMapInstance';
import { useLocationHierarchy } from './hooks/useLocationHierarchy';
import { useDrillDown } from './hooks/useDrillDown';

// ─── Main Map Content ───────────────────────────────────────
function MapContent() {
  const searchParams = useSearchParams();
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Basemap state
  const [basemap, setBasemap] = useState<'satellite' | 'dark' | 'streets'>('satellite');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Near Me (20km) state
  const [isNearMeActive, setIsNearMeActive] = useState<boolean>(false);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const isNearMeActiveRef = useRef<boolean>(false);
  isNearMeActiveRef.current = isNearMeActive;

  // Cached nationwide initial clusters
  const nationwideClustersRef = useRef<any>(null);

  // Core hooks
  const { mapRef, isMapLoaded, currentZoom, flyTo, fitBounds } = useMapInstance(mapContainerRef, basemap);
  const { sortedRegions, centroids, getProvinces, getCities } = useLocationHierarchy();

  const drillDown = useDrillDown(centroids, flyTo, fitBounds);

  // Sidebar projects
  const [sidebarProjects, setSidebarProjects] = useState<any[]>([]);

  // GeoJSON source ref for updating data
  const clusterSourceRef = useRef<string>('supercluster-source');
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef<number>(0);

  // Total projects count for UI badge
  const [totalPoints, setTotalPoints] = useState<number>(248220);
  const [loadingBorders, setLoadingBorders] = useState<boolean>(true);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(true);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isReady = isMapLoaded;

  // ─── Load URL params ──────────────────────────────────────
  useEffect(() => {
    const r = searchParams.get('region');
    const p = searchParams.get('province');
    const m = searchParams.get('city') || searchParams.get('municipality');
    const projId = searchParams.get('project') || searchParams.get('projectId');
    const contractor = searchParams.get('contractor') || searchParams.get('q');
    if (r) drillDown.setRegion(r);
    if (p) drillDown.setProvince(p);
    if (m) drillDown.setMunicipality(m);
    if (projId) setSelectedProjectId(projId);
    else if (contractor) {
      fetch(`/api/projects?q=${encodeURIComponent(contractor)}&limit=1`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          const firstProj = data?.projects?.[0];
          if (firstProj?.id) {
            setSelectedProjectId(firstProj.id);
          }
        })
        .catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ─── Fly to selected project ──────────────────────────────
  useEffect(() => {
    if (!selectedProjectId || !isMapLoaded || !mapRef.current) return;
    fetch(`/api/projects/${selectedProjectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const p = data?.project || data;
        if (p?.gpsLat && p?.gpsLng) {
          flyTo([p.gpsLng, p.gpsLat], 15);
        }
      })
      .catch(console.error);
  }, [selectedProjectId, isMapLoaded, mapRef, flyTo]);

  // ─── Unregister any stale / broken service workers ───
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) reg.unregister();
        }).catch(() => {});
      }
    }
  }, []);

  // ─── Render clusters (Tiered High-Speed Cluster Loading) ─────────────────
  const renderClusters = useCallback(async (customBounds?: [[number, number], [number, number]], customZoom?: number) => {
    const map = mapRef.current;
    if (!map) return;

    if (isNearMeActiveRef.current) return;

    const currentMapZoom = map.getZoom ? map.getZoom() : 6;
    const zoom = customZoom !== undefined ? customZoom : Math.floor(currentMapZoom);
    const isDrilledDown = Boolean(drillDown.province || drillDown.municipality || drillDown.barangay);

    // Tier 1: National view (zoom < 9 and not drilled down) -> load nationwide initial clusters (~86 KB)
    if (zoom < 9 && !isDrilledDown) {
      const applyNationwideGradually = (data: any) => {
        setTotalPoints(248220);
        const source = map.getSource(clusterSourceRef.current) as mapboxgl.GeoJSONSource | undefined;
        if (!source) {
          setLoadingProjects(false);
          return;
        }

        const features = data.features || [];
        if (features.length <= 10) {
          source.setData(data);
          setLoadingProjects(false);
          return;
        }

        if (streamTimerRef.current) clearInterval(streamTimerRef.current);
        setLoadingProjects(true);

        // Gradually reveal clusters across 4 progressive waves spaced by 65ms
        const total = features.length;
        const steps = 4;
        let step = 0;

        streamTimerRef.current = setInterval(() => {
          step++;
          const count = Math.min(total, Math.ceil((step / steps) * total));
          source.setData({
            type: 'FeatureCollection',
            features: features.slice(0, count),
          });

          if (step >= steps) {
            if (streamTimerRef.current) clearInterval(streamTimerRef.current);
            streamTimerRef.current = null;
            setLoadingProjects(false);
          }
        }, 65);
      };

      if (nationwideClustersRef.current) {
        applyNationwideGradually(nationwideClustersRef.current);
        return;
      }

      setLoadingProjects(true);
      try {
        const res = await fetch('/geo/nationwide_initial_clusters.json');
        if (res.ok) {
          const data = await res.json();
          nationwideClustersRef.current = data;
          applyNationwideGradually(data);
        } else {
          setLoadingProjects(false);
        }
      } catch (err) {
        console.error('Failed to load nationwide initial clusters:', err);
        setLoadingProjects(false);
      }
      return;
    }

    // Tier 2: Zoomed in (zoom >= 9) or drilled down -> query /api/map/spatial
    let sw_lat: number, sw_lng: number, ne_lat: number, ne_lng: number;

    if (customBounds && customBounds.length === 2) {
      [[sw_lng, sw_lat], [ne_lng, ne_lat]] = customBounds;
    } else {
      const bounds = map.getBounds();
      if (!bounds) return;
      sw_lat = bounds.getSouth();
      sw_lng = bounds.getWest();
      ne_lat = bounds.getNorth();
      ne_lng = bounds.getEast();
    }

    const params = new URLSearchParams({
      sw_lat: sw_lat.toFixed(5),
      sw_lng: sw_lng.toFixed(5),
      ne_lat: ne_lat.toFixed(5),
      ne_lng: ne_lng.toFixed(5),
      zoom: zoom.toString(),
    });

    if (drillDown.region) params.set('region', drillDown.region);
    if (drillDown.province) params.set('province', drillDown.province);

    const reqId = ++requestSeqRef.current;
    setLoadingProjects(true);

    try {
      const res = await fetch(`/api/map/spatial?${params.toString()}`);
      if (reqId !== requestSeqRef.current) return;
      if (!res.ok) {
        setLoadingProjects(false);
        return;
      }
      const geojson = await res.json();
      if (reqId !== requestSeqRef.current) return;

      if (geojson?.features) {
        setTotalPoints(248220);
        const updateData = () => {
          const source = map.getSource(clusterSourceRef.current) as mapboxgl.GeoJSONSource | undefined;
          if (source) {
            source.setData(geojson);
          }
          setLoadingProjects(false);
        };

        if (map.isStyleLoaded() && map.getSource(clusterSourceRef.current)) {
          updateData();
        } else {
          map.once('style.load', updateData);
        }
      } else {
        setLoadingProjects(false);
      }
    } catch (err: any) {
      console.error('Error fetching server spatial clusters:', err);
      setLoadingProjects(false);
    }
  }, [mapRef, drillDown.province, drillDown.municipality, drillDown.barangay, drillDown.region]);

  // ─── Trigger render when drill-down or anomaly filter changes ─
  useEffect(() => {
    if (!isMapLoaded) return;
    renderClusters();
  }, [isMapLoaded, drillDown.region, drillDown.province, drillDown.filterAnomaly, renderClusters]);

  // ─── "Near Me" Flow (20km) ──────────────────────────────
  const handleNearMeToggle = useCallback(() => {
    if (isNearMeActive) {
      setIsNearMeActive(false);
      isNearMeActiveRef.current = false;
      const map = mapRef.current;
      if (map) {
        const circleSrc = map.getSource('near-me-circle-source') as mapboxgl.GeoJSONSource | undefined;
        if (circleSrc) circleSrc.setData({ type: 'FeatureCollection', features: [] });
        const userSrc = map.getSource('user-location-source') as mapboxgl.GeoJSONSource | undefined;
        if (userSrc) userSrc.setData({ type: 'FeatureCollection', features: [] });
      }
      setSidebarProjects([]);
      renderClusters();
      return;
    }

    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLocation({ lat, lng });
        setIsNearMeActive(true);
        isNearMeActiveRef.current = true;

        const map = mapRef.current;
        if (map) {
          map.flyTo({
            center: [lng, lat],
            zoom: 12,
            duration: 1500,
            essential: true,
          });

          // Render smooth 20km circle overlay (using Haversine circle geometry)
          const circleFeature = createGeoJSONCircle(lng, lat, 20);
          const circleSrc = map.getSource('near-me-circle-source') as mapboxgl.GeoJSONSource | undefined;
          if (circleSrc) {
            circleSrc.setData({
              type: 'FeatureCollection',
              features: [circleFeature],
            });
          }

          const userSrc = map.getSource('user-location-source') as mapboxgl.GeoJSONSource | undefined;
          if (userSrc) {
            userSrc.setData({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [lng, lat] },
                  properties: { title: 'Your Location' },
                },
              ],
            });
          }
        }

        // Query projects within 20km
        try {
          const res = await fetch(`/api/nearby?lat=${lat}&lng=${lng}&radius=20`);
          if (res.ok) {
            const data = await res.json();
            const projects = data.projects || [];
            setSidebarProjects(projects);

            if (map) {
              const features = projects.map((p: any) => ({
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [Number(p.gpsLng), Number(p.gpsLat)],
                },
                properties: {
                  id: p.id,
                  i: p.id,
                  name: p.name,
                  n: p.name,
                  category: p.category,
                  c: p.category,
                  budgetPHP: p.budgetPHP,
                  b: p.budgetPHP,
                  progress: p.progress,
                  g: p.progress,
                  flagOverdue: p.flagOverdue,
                  flagOverpaid: p.flagOverpaid,
                  flagStalled: p.flagStalled,
                  k: (p.flagOverpaid || p.flagStalled) ? 2 : (p.flagOverdue || p.flagNeverStarted) ? 1 : 0,
                },
              }));

              const clusterSrc = map.getSource(clusterSourceRef.current) as mapboxgl.GeoJSONSource | undefined;
              if (clusterSrc) {
                clusterSrc.setData({
                  type: 'FeatureCollection',
                  features,
                });
              }
            }
          }
        } catch (err) {
          console.error('Error fetching nearby projects:', err);
        }
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation failed:', err);
        alert(
          err.code === 1
            ? 'Location access was denied. Please enable location permissions to use Near Me.'
            : 'Failed to retrieve your location. Please check device GPS settings.'
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }, [isNearMeActive, mapRef, renderClusters]);

  // ─── Setup ALL Mapbox layers + event handlers centrally ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;

    const setupLayers = () => {
      if (!map.isStyleLoaded()) {
        map.once('style.load', setupLayers);
        return;
      }

      // ── 1. PROVINCE BORDERS LAYER (Fast clean lightweight boundary display) ──
      if (!map.getSource('province-source')) {
        setLoadingBorders(true);
        map.addSource('province-source', {
          type: 'geojson',
          data: '/geo/provinces_lowres.json',
        });

        map.addLayer({
          id: 'province-borders-layer',
          type: 'line',
          source: 'province-source',
          paint: {
            'line-color': '#38bdf8',
            'line-width': 1.5,
            'line-opacity': 0.75,
          },
        });

        const onData = (e: any) => {
          if (e.sourceId === 'province-source' && e.isSourceLoaded) {
            setLoadingBorders(false);
            map.off('sourcedata', onData);
          }
        };
        map.on('sourcedata', onData);
        setTimeout(() => setLoadingBorders(false), 500);
      } else {
        setLoadingBorders(false);
      }

      // ── 2. NEAR ME 20KM CIRCLE & USER PIN LAYERS ──
      if (!map.getSource('near-me-circle-source')) {
        map.addSource('near-me-circle-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'near-me-circle-fill',
          type: 'fill',
          source: 'near-me-circle-source',
          paint: {
            'fill-color': '#0284c7',
            'fill-opacity': 0.12,
          },
        });

        map.addLayer({
          id: 'near-me-circle-line',
          type: 'line',
          source: 'near-me-circle-source',
          paint: {
            'line-color': '#38bdf8',
            'line-width': 2,
            'line-opacity': 0.85,
            'line-dasharray': [2, 2],
          },
        });
      }

      if (!map.getSource('user-location-source')) {
        map.addSource('user-location-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'user-location-glow',
          type: 'circle',
          source: 'user-location-source',
          paint: {
            'circle-color': '#38bdf8',
            'circle-radius': 16,
            'circle-opacity': 0.35,
            'circle-blur': 0.5,
          },
        });

        map.addLayer({
          id: 'user-location-pin',
          type: 'circle',
          source: 'user-location-source',
          paint: {
            'circle-color': '#0284c7',
            'circle-radius': 7,
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          },
        });
      }

      // ── 3. CLUSTER & PIN SOURCE AND LAYERS (248,220 DPWH Projects) ──
      if (!map.getSource(clusterSourceRef.current)) {
        map.addSource(clusterSourceRef.current, {
          type: 'geojson',
          data: '/geo/nationwide_initial_clusters.json',
        });

        // 1. Cluster outer pulsing aura
        map.addLayer({
          id: 'clusters-glow',
          type: 'circle',
          source: clusterSourceRef.current,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'case',
              ['>', ['get', 'redCount'], 0], '#ef4444',
              ['>', ['get', 'yellowCount'], 0], '#eab308',
              '#10b981',
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              26,
              100, 32,
              1000, 40,
              5000, 50,
              20000, 60,
            ],
            'circle-opacity': 0.35,
            'circle-blur': 0.6,
          },
        });

        // 2. Cluster core circle
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: clusterSourceRef.current,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'case',
              ['>', ['get', 'redCount'], 0], '#ef4444',
              ['>', ['get', 'yellowCount'], 0], '#eab308',
              '#10b981',
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              18,
              100, 22,
              1000, 27,
              5000, 33,
              20000, 40,
            ],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.94,
          },
        });

        // 3. Cluster count typography
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: clusterSourceRef.current,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': [
              'step',
              ['get', 'point_count'],
              12,
              1000, 13,
              10000, 14,
            ],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0, 0, 0, 0.45)',
            'text-halo-width': 1.5,
          },
        });

        // 4. Pin neon pulse halo
        map.addLayer({
          id: 'unclustered-point-glow',
          type: 'circle',
          source: clusterSourceRef.current,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': [
              'case',
              ['==', ['coalesce', ['get', 'k'], 0], 2], '#ef4444',
              ['==', ['coalesce', ['get', 'k'], 0], 1], '#eab308',
              '#10b981',
            ],
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              6, 7,
              12, 14,
              16, 20,
            ],
            'circle-opacity': 0.42,
            'circle-blur': 0.45,
          },
        });

        // 5. Pin core jewel circle
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: clusterSourceRef.current,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': [
              'case',
              ['==', ['coalesce', ['get', 'k'], 0], 2], '#ef4444',
              ['==', ['coalesce', ['get', 'k'], 0], 1], '#eab308',
              '#10b981',
            ],
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, 4.5,
              9, 6.5,
              13, [
                'interpolate', ['linear'], ['coalesce', ['get', 'b'], ['/', ['coalesce', ['get', 'budgetPHP'], 0], 1000], 0],
                0, 7, 50000, 10, 500000, 14,
              ],
              17, [
                'interpolate', ['linear'], ['coalesce', ['get', 'b'], ['/', ['coalesce', ['get', 'budgetPHP'], 0], 1000], 0],
                0, 9, 50000, 13, 500000, 18,
              ],
            ],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.98,
          },
        });

        // ── EVENT HANDLERS ──────────────────────────────────
        // Click on cluster → zoom in
        map.on('click', 'clusters', async (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
          const feature = features[0];
          if (!feature) return;

          const coords = (feature.geometry as any)?.coordinates?.slice();
          const clusterId = feature.properties?.cluster_id;
          const currentZoom = map.getZoom();

          if (coords) {
            let targetZoom = Math.min(currentZoom + 2.5, 17);
            if (clusterId !== undefined) {
              try {
                const res = await fetch(`/api/map/spatial?cluster_id=${clusterId}&zoom=${Math.floor(currentZoom)}`);
                if (res.ok) {
                  const data = await res.json();
                  if (data?.expansionZoom) {
                    targetZoom = Math.min(Math.max(data.expansionZoom, currentZoom + 1.8), 17);
                  }
                }
              } catch {
                // fallback to default ease
              }
            }

            map.easeTo({
              center: coords,
              zoom: targetZoom,
              duration: 750,
              essential: true,
            });
          }
        });

        // Click on unclustered pin → open ProjectInspectionDrawer directly on map
        map.on('click', 'unclustered-point', (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point'] });
          const projId = features[0]?.properties?.i || features[0]?.properties?.id;
          if (projId) {
            setSelectedProjectId(projId);
          }
        });

        // ── HOVER TOOLTIPS ──────────────────────────────────
        const hoverPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 12,
        });

        map.on('mouseenter', 'unclustered-point', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const feature = e.features?.[0];
          if (!feature) return;

          const coords = (feature.geometry as any).coordinates.slice();
          const p = feature.properties || {};

          let badgeColor = '#10b981';
          let badgeText = 'Normal';
          if (p.k === 2 || p.fo || p.fs || p.flagOverpaid || p.flagStalled) {
            badgeColor = '#ef4444';
            badgeText = '🚨 Overpaid / Stalled';
          } else if (p.k === 1 || p.fd || p.fn || p.flagOverdue || p.flagNeverStarted) {
            badgeColor = '#eab308';
            badgeText = '🟡 Delayed / Overdue';
          }

          const budget = p.b !== undefined ? (p.b < 10000000 ? p.b * 1000 : p.b) : 0;
          const progress = Number(p.g ?? p.p ?? p.progress ?? 0);
          const category = p.c || p.cat || 'Infrastructure';
          const title = p.n || p.name || 'DPWH Infrastructure Project';

          hoverPopup
            .setLngLat(coords)
            .setHTML(`
              <div style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); border-radius: 10px; padding: 10px 13px; color: #fff; font-family: system-ui, sans-serif; min-width: 240px; font-size: 11px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">${category}</span>
                  <span style="font-size: 9px; font-weight: 700; color: ${badgeColor}; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px;">${badgeText}</span>
                </div>
                <div style="font-weight: 700; margin-top: 4px; line-height: 1.35; color: #f8fafc;">${title}</div>
                <div style="margin-top: 8px; display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 5px;">
                  <span style="color: #94a3b8;">Budget:</span>
                  <span style="color: #38bdf8; font-weight: bold;">${formatCurrency(budget)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 2px;">
                  <span style="color: #94a3b8;">Progress:</span>
                  <span style="color: #34d399; font-weight: bold;">${progress.toFixed(1)}%</span>
                </div>
                <div style="margin-top: 6px; font-size: 9px; color: #cbd5e1; text-align: right;">Click to inspect details &rarr;</div>
              </div>
            `)
            .addTo(map);
        });

        map.on('mouseleave', 'unclustered-point', () => {
          map.getCanvas().style.cursor = '';
          hoverPopup.remove();
        });

        const clusterPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
        });

        map.on('mouseenter', 'clusters', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const feature = e.features?.[0];
          if (!feature) return;

          const coords = (feature.geometry as any).coordinates.slice();
          const p = feature.properties || {};
          const count = p.totalProjects || p.point_count || 1;
          const budget = p.totalBudget || 0;
          const flagged = p.flaggedCount || 0;
          const anomalyPct = count > 0 ? ((flagged / count) * 100).toFixed(1) : '0';

          clusterPopup
            .setLngLat(coords)
            .setHTML(`
              <div style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); border-radius: 10px; padding: 9px 13px; color: #fff; font-family: system-ui, sans-serif; min-width: 180px; font-size: 11px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <div style="font-size: 9px; font-weight: 800; color: #38bdf8; text-transform: uppercase;">Infrastructure Cluster</div>
                <div style="font-size: 13px; font-weight: 800; color: #fff; margin-top: 3px;">${Number(count).toLocaleString()} Projects</div>
                ${budget > 0 ? `<div style="font-size: 10px; color: #94a3b8; margin-top: 3px;">Budget: <span style="color: #34d399; font-weight: 700;">${formatCurrency(budget)}</span></div>` : ''}
                ${flagged > 0 ? `<div style="font-size: 10px; color: #f87171; margin-top: 2px;">⚠️ ${flagged.toLocaleString()} flagged (${anomalyPct}%)</div>` : ''}
                <div style="margin-top: 5px; font-size: 9px; color: #cbd5e1;">Click to zoom &amp; expand &rarr;</div>
              </div>
            `)
            .addTo(map);
        });

        map.on('mouseleave', 'clusters', () => {
          map.getCanvas().style.cursor = '';
          clusterPopup.remove();
        });
      }

      // Initial clusters render
      renderClusters();
    };

    setupLayers();
    map.on('style.load', setupLayers);

    // Viewport change → re-render clusters smoothly
    const onMoveEnd = () => {
      if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = setTimeout(() => {
        renderClusters();
      }, 75);
    };

    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);

    return () => {
      map.off('style.load', setupLayers);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onMoveEnd);
      if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);
    };
  }, [isMapLoaded, mapRef, renderClusters]);

  // ─── Update sidebar when municipality/barangay changes ────
  useEffect(() => {
    if (isNearMeActive) return; // Keep nearby projects in sidebar when in Near Me mode

    if (!drillDown.municipality && !drillDown.barangay) {
      setSidebarProjects([]);
      return;
    }

    const params = new URLSearchParams();
    if (drillDown.region) params.set('region', drillDown.region);
    if (drillDown.province) params.set('province', drillDown.province);
    params.set('limit', '50');

    fetch(`/api/map/clusters?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.features) return;
        let points = data.features;
        if (drillDown.municipality) {
          const muniLower = drillDown.municipality.toLowerCase();
          points = points.filter((f: any) =>
            (f.properties?.name || f.properties?.n || '').toLowerCase().includes(muniLower)
          );
        }
        setSidebarProjects(points.slice(0, 30));
      })
      .catch(console.error);
  }, [drillDown.region, drillDown.province, drillDown.municipality, drillDown.barangay, isNearMeActive]);

  return (
    <div className="relative h-[calc(100vh-64px)] w-full overflow-hidden bg-slate-950">
      {/* Mapbox Container */}
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Drill-Down Panel */}
      <DrillDownPanel
        currentZoom={currentZoom}
        totalPoints={totalPoints}
        isReady={isReady}
        sortedRegions={sortedRegions}
        region={drillDown.region}
        province={drillDown.province}
        municipality={drillDown.municipality}
        barangay={drillDown.barangay}
        filterAnomaly={drillDown.filterAnomaly}
        setRegion={drillDown.setRegion}
        setProvince={drillDown.setProvince}
        setMunicipality={drillDown.setMunicipality}
        setBarangay={drillDown.setBarangay}
        setFilterAnomaly={drillDown.setFilterAnomaly}
        navigateTo={drillDown.navigateTo}
        basemap={basemap}
        setBasemap={setBasemap}
        getProvinces={getProvinces}
        getCities={getCities}
        isNearMeActive={isNearMeActive}
        isLocating={isLocating}
        onNearMeToggle={handleNearMeToggle}
        loadingBorders={loadingBorders}
        loadingProjects={loadingProjects}
      />

      {/* Project Sidebar */}
      {((drillDown.municipality || drillDown.barangay || isNearMeActive) && sidebarProjects.length > 0) && (
        <ProjectSidebar
          title={isNearMeActive ? 'Projects Near Me (20km)' : (drillDown.barangay || drillDown.municipality)}
          projects={sidebarProjects}
          onSelectProject={(id) => setSelectedProjectId(id)}
          onClose={() => {
            if (isNearMeActive) {
              handleNearMeToggle();
            } else {
              drillDown.setMunicipality('');
              drillDown.setBarangay('');
            }
          }}
        />
      )}

      {/* Project Inspection Drawer directly on map */}
      {selectedProjectId && (
        <ProjectInspectionDrawer
          projectId={selectedProjectId}
          onClose={() => setSelectedProjectId(null)}
          userLocation={userLocation}
        />
      )}
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-slate-950" />}>
      <MapContent />
    </Suspense>
  );
}
