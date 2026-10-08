'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { formatCurrency } from '@/lib/format';
import DrillDownPanel from './components/DrillDownPanel';
import ProjectSidebar from './components/ProjectSidebar';
import { useMapInstance } from './hooks/useMapInstance';
import { useLocationHierarchy } from './hooks/useLocationHierarchy';
import { useDrillDown } from './hooks/useDrillDown';

// ─── Main Map Content ───────────────────────────────────────
function MapContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Basemap state
  const [basemap, setBasemap] = useState<'satellite' | 'dark' | 'streets'>('satellite');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Core hooks
  const { mapRef, isMapLoaded, currentZoom, flyTo, fitBounds } = useMapInstance(mapContainerRef, basemap);
  const { sortedRegions, centroids, getProvinces, getCities } = useLocationHierarchy();

  const drillDown = useDrillDown(centroids, flyTo, fitBounds);

  // Detailed boundary layers for deep zoom
  const [municitiesGeoJson, setMunicitiesGeoJson] = useState<any>(null);
  const [barangaysGeoJson, setBarangaysGeoJson] = useState<any>(null);

  // Sidebar projects
  const [sidebarProjects, setSidebarProjects] = useState<any[]>([]);

  // GeoJSON source ref for updating data
  const clusterSourceRef = useRef<string>('supercluster-source');
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef<number>(0);

  // Total projects count for UI badge
  const [totalPoints, setTotalPoints] = useState<number>(248220);
  const isReady = isMapLoaded;

  // ─── Load URL params ──────────────────────────────────────
  useEffect(() => {
    const r = searchParams.get('region');
    const p = searchParams.get('province');
    const m = searchParams.get('city') || searchParams.get('municipality');
    const projId = searchParams.get('project') || searchParams.get('projectId');
    if (r) drillDown.setRegion(r);
    if (p) drillDown.setProvince(p);
    if (m) drillDown.setMunicipality(m);
    if (projId) setSelectedProjectId(projId);
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

  // ─── Load municipality borders on-demand when drilling into a province ───
  useEffect(() => {
    if (!drillDown.province) {
      setMunicitiesGeoJson(null);
      return;
    }
    if (!municitiesGeoJson) {
      fetch('/geo/municities.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setMunicitiesGeoJson(d))
        .catch(console.error);
    }
  }, [drillDown.province]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Unregister any stale / broken service workers causing Cache.put errors ───
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) reg.unregister();
        }).catch(() => {});
      }
      if ('caches' in window) {
        window.caches.keys().then((keys) => {
          for (const key of keys) window.caches.delete(key);
        }).catch(() => {});
      }
    }
  }, []);

  // ─── Render clusters directly from Server Spatial Supercluster (248,220 projects) ──
  const renderClusters = useCallback(async (customBounds?: [[number, number], [number, number]], customZoom?: number) => {
    const map = mapRef.current;
    if (!map) return;

    let sw_lat: number, sw_lng: number, ne_lat: number, ne_lng: number, zoom: number;

    if (customBounds && customBounds.length === 2) {
      [[sw_lng, sw_lat], [ne_lng, ne_lat]] = customBounds;
      zoom = customZoom !== undefined ? customZoom : Math.floor(map.getZoom());
    } else {
      const bounds = map.getBounds();
      if (!bounds) return;
      sw_lat = bounds.getSouth();
      sw_lng = bounds.getWest();
      ne_lat = bounds.getNorth();
      ne_lng = bounds.getEast();
      zoom = Math.floor(map.getZoom());
    }

    const params = new URLSearchParams({
      sw_lat: sw_lat.toFixed(5),
      sw_lng: sw_lng.toFixed(5),
      ne_lat: ne_lat.toFixed(5),
      ne_lng: ne_lng.toFixed(5),
      zoom: zoom.toString(),
    });

    const reqId = ++requestSeqRef.current;

    try {
      const res = await fetch(`/api/map/spatial?${params.toString()}`);
      if (reqId !== requestSeqRef.current) return;
      if (!res.ok) return;
      const geojson = await res.json();
      if (reqId !== requestSeqRef.current) return;

      if (geojson?.features) {
        setTotalPoints(248220);
        const updateData = () => {
          const source = map.getSource(clusterSourceRef.current) as mapboxgl.GeoJSONSource | undefined;
          if (source) {
            source.setData(geojson);
          }
        };

        if (map.isStyleLoaded() && map.getSource(clusterSourceRef.current)) {
          updateData();
        } else {
          map.once('style.load', updateData);
        }
      }
    } catch (err: any) {
      console.error('Error fetching server spatial clusters:', err);
    }
  }, [mapRef]);

  // ─── Trigger render from PostgreSQL when drill-down or anomaly filter changes ─
  useEffect(() => {
    if (!isMapLoaded) return;
    renderClusters();
  }, [isMapLoaded, drillDown.region, drillDown.province, drillDown.filterAnomaly, renderClusters]);

  // ─── Setup ALL Mapbox layers + event handlers centrally ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;

    const setupLayers = () => {
      if (!map.isStyleLoaded()) {
        map.once('style.load', setupLayers);
        return;
      }

      // ── 1. BOUNDARY & MASK LAYERS (for drill-down focus) ────
      if (!map.getSource('selected-mask-source')) {
        map.addSource('selected-mask-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'selected-boundary-mask',
          type: 'fill',
          source: 'selected-mask-source',
          paint: {
            'fill-color': '#020617',
            'fill-opacity': 0.62,
          },
        });
      }

      if (!map.getSource('selected-boundary-source')) {
        map.addSource('selected-boundary-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Glowing outer blur line
        map.addLayer({
          id: 'selected-boundary-glow',
          type: 'line',
          source: 'selected-boundary-source',
          paint: {
            'line-color': '#38bdf8',
            'line-width': 6,
            'line-blur': 3,
            'line-opacity': 0.75,
          },
        });

        // Sharp vibrant neon inner line
        map.addLayer({
          id: 'selected-boundary-line',
          type: 'line',
          source: 'selected-boundary-source',
          paint: {
            'line-color': '#00f0ff',
            'line-width': 2.5,
            'line-opacity': 0.95,
          },
        });
      }

      // ── 2. PROVINCE BORDERS LAYER (No choropleth — pure ultra-crisp borders) ──
      if (!map.getSource('province-source')) {
        map.addSource('province-source', {
          type: 'geojson',
          data: '/geo/provinces_lowres.json',
        });

        map.addLayer({
          id: 'province-borders-layer',
          type: 'line',
          source: 'province-source',
          paint: {
            'line-color': '#cbd5e1',
            'line-width': 0.75,
            'line-opacity': 0.4,
          },
        });
      }

      // ── 3. REGION BORDERS LAYER (Vibrant sky/cyan outline) ──
      if (!map.getSource('region-source')) {
        map.addSource('region-source', {
          type: 'geojson',
          data: '/geo/regions_lowres.json',
        });

        map.addLayer({
          id: 'region-borders-layer',
          type: 'line',
          source: 'region-source',
          paint: {
            'line-color': '#38bdf8',
            'line-width': 1.5,
            'line-opacity': 0.65,
          },
        });
      }

      // ── 4. CLUSTER & PIN SOURCE AND LAYERS (248,220 DPWH Projects) ──
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

        // 2. Cluster glassmorphic core circle
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
              ['==', ['coalesce', ['get', 'k'], 0], 2], '#ef4444', // RED
              ['==', ['coalesce', ['get', 'k'], 0], 1], '#eab308', // YELLOW
              '#10b981', // GREEN
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
              ['==', ['coalesce', ['get', 'k'], 0], 2], '#ef4444', // RED
              ['==', ['coalesce', ['get', 'k'], 0], 1], '#eab308', // YELLOW
              '#10b981', // GREEN
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

        // Click on cluster → smooth animated explosion / zoom-in
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

        // Click on unclustered pin → take user to full page detail dossier
        map.on('click', 'unclustered-point', (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point'] });
          const projId = features[0]?.properties?.i || features[0]?.properties?.id;
          if (projId) {
            router.push(`/projects/${encodeURIComponent(projId)}`);
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
  }, [isMapLoaded, mapRef, renderClusters, router]);

  // ─── Municipality & Barangay Borders on deep drill-down ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;

    if (map.getLayer('municipality-borders-layer')) map.removeLayer('municipality-borders-layer');
    if (map.getSource('municities-source')) map.removeSource('municities-source');

    if (municitiesGeoJson && map.isStyleLoaded()) {
      map.addSource('municities-source', {
        type: 'geojson',
        data: municitiesGeoJson,
      });

      map.addLayer({
        id: 'municipality-borders-layer',
        type: 'line',
        source: 'municities-source',
        paint: {
          'line-color': '#94a3b8',
          'line-width': 0.6,
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            7.0, 0,
            8.5, 0.35,
            10.0, 0.7
          ]
        },
      });
    }

    if (map.getLayer('barangay-borders-layer')) map.removeLayer('barangay-borders-layer');
    if (map.getSource('barangays-source')) map.removeSource('barangays-source');

    if (barangaysGeoJson && map.isStyleLoaded()) {
      map.addSource('barangays-source', {
        type: 'geojson',
        data: barangaysGeoJson
      });
      map.addLayer({
        id: 'barangay-borders-layer',
        type: 'line',
        source: 'barangays-source',
        paint: {
          'line-color': '#38bdf8',
          'line-width': 1,
          'line-opacity': 0.6
        }
      });
    }
  }, [isMapLoaded, municitiesGeoJson, barangaysGeoJson, mapRef]);

  // ─── Update Boundary Outline & Inverted Dark Mask ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;

    // Determine currently selected boundary level
    let boundaryType: string | null = null;
    let boundaryName: string = '';
    let cityFile: string = '';

    if (drillDown.barangay) {
      boundaryType = 'barangay';
      boundaryName = drillDown.barangay;
    } else if (drillDown.municipality) {
      boundaryType = 'city';
      boundaryName = drillDown.municipality;
      cityFile = drillDown.cityFile || '';
    } else if (drillDown.province) {
      boundaryType = 'province';
      boundaryName = drillDown.province;
    } else if (drillDown.region) {
      boundaryType = 'region';
      boundaryName = drillDown.region;
    }

    const clearBoundary = () => {
      const boundarySource = map.getSource('selected-boundary-source') as mapboxgl.GeoJSONSource | undefined;
      const maskSource = map.getSource('selected-mask-source') as mapboxgl.GeoJSONSource | undefined;
      if (boundarySource) boundarySource.setData({ type: 'FeatureCollection', features: [] });
      if (maskSource) maskSource.setData({ type: 'FeatureCollection', features: [] });
    };

    if (!boundaryType) {
      clearBoundary();
      return;
    }

    const params = new URLSearchParams({
      type: boundaryType,
      name: boundaryName,
    });
    if (cityFile) params.set('cityFile', cityFile);
    if (drillDown.municipality) params.set('municipality', drillDown.municipality);
    if (drillDown.province) params.set('province', drillDown.province);

    fetch(`/api/locations/boundary?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;

        const updateBoundaryData = () => {
          const bSource = map.getSource('selected-boundary-source') as mapboxgl.GeoJSONSource | undefined;
          const mSource = map.getSource('selected-mask-source') as mapboxgl.GeoJSONSource | undefined;
          if (bSource && data.boundary) {
            bSource.setData({
              type: 'FeatureCollection',
              features: [data.boundary],
            });
          }
          if (mSource && data.mask) {
            mSource.setData({
              type: 'FeatureCollection',
              features: [data.mask],
            });
          }
        };

        if (map.isStyleLoaded() && map.getSource('selected-boundary-source')) {
          updateBoundaryData();
        } else {
          map.once('style.load', updateBoundaryData);
        }

        if (data.bounds && Array.isArray(data.bounds) && data.bounds.length === 2) {
          const [[minX, minY], [maxX, maxY]] = data.bounds;
          if (!(minX === 116 && minY === 4 && maxX === 127 && maxY === 21)) {
            fitBounds(data.bounds);
            const targetZoom = boundaryType === 'barangay' ? 14 : boundaryType === 'city' ? 11 : boundaryType === 'province' ? 9 : 7;
            renderClusters(data.bounds, targetZoom);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load boundary and mask:', err);
      });
  }, [
    isMapLoaded,
    mapRef,
    drillDown.region,
    drillDown.province,
    drillDown.municipality,
    drillDown.cityFile,
    drillDown.barangay,
    fitBounds,
    renderClusters,
  ]);

  // ─── Update sidebar when municipality/barangay changes ────
  useEffect(() => {
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
  }, [drillDown.region, drillDown.province, drillDown.municipality, drillDown.barangay]);

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
      />

      {/* Project Sidebar */}
      {(drillDown.municipality || drillDown.barangay) && sidebarProjects.length > 0 && (
        <ProjectSidebar
          title={drillDown.barangay || drillDown.municipality}
          projects={sidebarProjects}
          onSelectProject={(id) => router.push(`/projects/${encodeURIComponent(id)}`)}
          onClose={() => {
            drillDown.setMunicipality('');
            drillDown.setBarangay('');
          }}
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
