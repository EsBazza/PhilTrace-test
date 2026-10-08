import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import Supercluster from 'supercluster';

// Global singleton in Node.js server memory
let superclusterInstance: any = null;
let allMetadata: any = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;
const spatialCache = new Map<string, any>();

async function getSupercluster() {
  if (superclusterInstance) {
    return { index: superclusterInstance, metadata: allMetadata };
  }

  if (isInitializing && initPromise) {
    await initPromise;
    return { index: superclusterInstance, metadata: allMetadata };
  }

  isInitializing = true;
  initPromise = (async () => {
    try {
      console.log('[Server Supercluster] Loading clusters from disk into server memory...');
      const geoDir = path.join(process.cwd(), 'public', 'geo');
      const initialPath = path.join(geoDir, 'initial_clusters.json');
      const nationwidePath = path.join(geoDir, 'nationwide_initial_clusters.json');
      
      let filePath = nationwidePath;
      if (fs.existsSync(initialPath)) {
        filePath = initialPath;
      } else if (fs.existsSync(nationwidePath)) {
        filePath = nationwidePath;
      } else {
        throw new Error('No cluster seed file found in public/geo/');
      }

      const fileData = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(fileData);

      allMetadata = json.metadata || {};
      const features = json.features || [];

      console.log(`[Server Supercluster] Indexing ${features.length} features with Supercluster from ${path.basename(filePath)}...`);

      const index = new (Supercluster as any)({
        radius: 60,
        maxZoom: 15,
        minZoom: 0,
        map: (props: any) => {
          // 2 = Red (overpaid/stalled), 1 = Yellow (overdue/never started), 0 = Green (clean)
          const k = props.k !== undefined ? props.k : 0;
          const isRed = k === 2;
          const isYellow = k === 1;
          return {
            totalProjects: 1,
            totalBudget: (props.b || 0) * 1000,
            flaggedCount: (isRed || isYellow) ? 1 : 0,
            redCount: isRed ? 1 : 0,
            yellowCount: isYellow ? 1 : 0,
          };
        },
        reduce: (accumulated: any, props: any) => {
          accumulated.totalProjects += props.totalProjects;
          accumulated.totalBudget += props.totalBudget;
          accumulated.flaggedCount += props.flaggedCount;
          accumulated.redCount += props.redCount;
          accumulated.yellowCount += props.yellowCount;
        },
      });

      index.load(features);
      superclusterInstance = index;
      console.log(`[Server Supercluster] ${features.length} clusters indexed and ready in server memory.`);
    } catch (err) {
      console.error('[Server Supercluster] Initialization failed:', err);
    } finally {
      isInitializing = false;
    }
  })();

  await initPromise;
  return { index: superclusterInstance, metadata: allMetadata };
}

// Warm up Supercluster in background
setTimeout(() => {
  getSupercluster().catch(console.error);
}, 50);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sw_lat = parseFloat(searchParams.get('sw_lat') ?? '4.0');
    const sw_lng = parseFloat(searchParams.get('sw_lng') ?? '114.0');
    const ne_lat = parseFloat(searchParams.get('ne_lat') ?? '22.0');
    const ne_lng = parseFloat(searchParams.get('ne_lng') ?? '128.5');
    const zoom = Math.floor(parseFloat(searchParams.get('zoom') ?? '6'));

    const clusterIdParam = searchParams.get('cluster_id');

    if (clusterIdParam) {
      const clusterId = parseInt(clusterIdParam, 10);
      const { index } = await getSupercluster();
      if (!index) return Response.json({ expansionZoom: zoom + 2 });
      try {
        const expansionZoom = index.getClusterExpansionZoom(clusterId);
        return Response.json({ expansionZoom });
      } catch {
        return Response.json({ expansionZoom: zoom + 2 });
      }
    }

    const cacheKey = `${sw_lat.toFixed(3)}_${sw_lng.toFixed(3)}_${ne_lat.toFixed(3)}_${ne_lng.toFixed(3)}_${zoom}`;
    if (spatialCache.has(cacheKey)) {
      return Response.json(spatialCache.get(cacheKey), {
        headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' },
      });
    }

    const { index } = await getSupercluster();

    if (!index) {
      return Response.json({ type: 'FeatureCollection', features: [] }, { status: 500 });
    }

    const bbox: [number, number, number, number] = [
      Math.max(sw_lng, -180),
      Math.max(sw_lat, -85),
      Math.min(ne_lng, 180),
      Math.min(ne_lat, 85),
    ];

    const rawClusters = index.getClusters(bbox, zoom);

    // If a cluster has 50 projects or fewer, unpack and spread them into individual pins!
    const processedFeatures: any[] = [];
    const coordCounts = new Map<string, number>();

    for (const item of rawClusters) {
      if (item.properties?.cluster && (item.properties.point_count <= 50)) {
        try {
          const leaves = index.getLeaves(item.id, 50, 0);
          for (const leaf of leaves) {
            let [lng, lat] = leaf.geometry.coordinates;

            // Disperse co-located points so they don't overlap
            const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
            const count = coordCounts.get(key) || 0;
            coordCounts.set(key, count + 1);

            if (count > 0) {
              const angle = count * 2.39996; // Golden angle
              const radius = 0.00022 * Math.sqrt(count);
              lng = Number((lng + (radius / Math.cos((lat * Math.PI) / 180)) * Math.cos(angle)).toFixed(6));
              lat = Number((lat + radius * Math.sin(angle)).toFixed(6));
            }

            processedFeatures.push({
              ...leaf,
              geometry: {
                type: 'Point',
                coordinates: [lng, lat],
              },
            });
          }
        } catch {
          processedFeatures.push(item);
        }
      } else {
        processedFeatures.push(item);
      }
    }

    const responseGeojson = {
      type: 'FeatureCollection',
      features: processedFeatures,
    };
    spatialCache.set(cacheKey, responseGeojson);

    return Response.json(responseGeojson, {
      headers: {
        'Cache-Control': 'public, max-age=120, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error serving server clusters:', error);
    return Response.json({ error: 'Failed to get spatial clusters' }, { status: 500 });
  }
}
