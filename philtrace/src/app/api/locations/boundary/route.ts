import fs from 'fs';
import path from 'path';

// World ring covering entire globe for inverted mask
const WORLD_RING: [number, number][] = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90],
];

function getBBox(geometry: any) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function traverse(coords: any) {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const c of coords) traverse(c);
    }
  }
  traverse(geometry.coordinates);
  return [
    [+minLng.toFixed(5), +minLat.toFixed(5)],
    [+maxLng.toFixed(5), +maxLat.toFixed(5)],
  ] as [[number, number], [number, number]];
}

function createInvertedMask(geometry: any) {
  let holes: [number, number][][] = [];
  if (geometry.type === 'Polygon') {
    holes = [geometry.coordinates[0]];
  } else if (geometry.type === 'MultiPolygon') {
    holes = geometry.coordinates.map((poly: any) => poly[0]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [WORLD_RING, ...holes],
    },
  };
}

// In-memory cache for parsed static boundary datasets and responses
let cachedRegionsData: any = null;
let cachedProvincesData: any = null;
let cachedMunicitiesData: any = null;
const regionIndex = new Map<string, any>();
const provinceIndex = new Map<string, any>();
const muniIndex = new Map<string, any>();
const boundaryResponseCache = new Map<string, any>();

function normLocation(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/^city of\s+/i, '')
    .replace(/\s+city$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

const REGION_ALIASES: Record<string, string[]> = {
  '100000000': ['region i', 'region 1', 'ilocos region', 'ilocos', 'region i (ilocos region)', 'ilocos region (region i)'],
  '200000000': ['region ii', 'region 2', 'cagayan valley', 'cagayan', 'region ii (cagayan valley)', 'cagayan valley (region ii)'],
  '300000000': ['region iii', 'region 3', 'central luzon', 'region iii (central luzon)', 'central luzon (region iii)'],
  '400000000': ['region iv-a', 'region iv a', 'region 4a', 'calabarzon', 'region iv-a (calabarzon)', 'calabarzon (region iv-a)'],
  '1700000000': ['region iv-b', 'region iv b', 'region 4b', 'mimaropa', 'mimaropa region', 'region iv-b (mimaropa)', 'mimaropa (region iv-b)'],
  '500000000': ['region v', 'region 5', 'bicol region', 'bicol', 'region v (bicol region)', 'bicol region (region v)'],
  '600000000': ['region vi', 'region 6', 'western visayas', 'region vi (western visayas)', 'western visayas (region vi)'],
  '700000000': ['region vii', 'region 7', 'central visayas', 'region vii (central visayas)', 'central visayas (region vii)'],
  '800000000': ['region viii', 'region 8', 'eastern visayas', 'region viii (eastern visayas)', 'eastern visayas (region viii)'],
  '900000000': ['region ix', 'region 9', 'zamboanga peninsula', 'zamboanga', 'region ix (zamboanga peninsula)', 'zamboanga peninsula (region ix)'],
  '1000000000': ['region x', 'region 10', 'northern mindanao', 'region x (northern mindanao)', 'northern mindanao (region x)'],
  '1100000000': ['region xi', 'region 11', 'davao region', 'davao', 'region xi (davao region)', 'davao region (region xi)'],
  '1200000000': ['region xii', 'region 12', 'soccsksargen', 'region xii (soccsksargen)', 'soccsksargen (region xii)'],
  '1600000000': ['region xiii', 'region 13', 'caraga', 'region xiii (caraga)', 'caraga (region xiii)'],
  '1300000000': ['ncr', 'national capital region', 'national capital region (ncr)', 'metro manila', 'metropolitan manila'],
  '1400000000': ['car', 'cordillera', 'cordillera administrative region', 'cordillera administrative region (car)'],
  '1900000000': ['barmm', 'armm', 'bangsamoro', 'muslim mindanao', 'autonomous region of muslim mindanao (armm)', 'bangsamoro autonomous region in muslim mindanao (barmm)'],
};

function ensureBoundariesLoaded() {
  const geoDir = path.join(process.cwd(), 'public', 'geo');
  if (!cachedRegionsData) {
    const p = path.join(geoDir, 'regions.json');
    if (fs.existsSync(p)) {
      cachedRegionsData = JSON.parse(fs.readFileSync(p, 'utf8'));
      const byPsgc = new Map<string, any>();
      for (const f of cachedRegionsData.features || []) {
        const psgc = String(f.properties?.adm1_psgc);
        byPsgc.set(psgc, f);
        const name = (f.properties?.region_name || f.properties?.name || '').toLowerCase().trim();
        const norm = normLocation(name);
        regionIndex.set(name, f);
        regionIndex.set(norm, f);
      }
      for (const [psgc, aliases] of Object.entries(REGION_ALIASES)) {
        const feat = byPsgc.get(psgc);
        if (feat) {
          for (const a of aliases) {
            regionIndex.set(normLocation(a), feat);
            regionIndex.set(a.toLowerCase().trim(), feat);
          }
        }
      }
    }
  }

  if (!cachedProvincesData) {
    const p = path.join(geoDir, 'provinces.json');
    if (fs.existsSync(p)) {
      cachedProvincesData = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const f of cachedProvincesData.features || []) {
        const name = (f.properties?.province_name || f.properties?.name || '').toLowerCase().trim();
        const norm = normLocation(name);
        provinceIndex.set(name, f);
        provinceIndex.set(norm, f);
        if (f.properties?.adm2_en) {
          provinceIndex.set(normLocation(f.properties.adm2_en), f);
        }
      }
    }
  }

  if (!cachedMunicitiesData) {
    const p = path.join(geoDir, 'municities.json');
    if (fs.existsSync(p)) {
      cachedMunicitiesData = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const f of cachedMunicitiesData.features || []) {
        const rawName = (f.properties?.name || f.properties?.adm3_en || f.properties?.city_name || '').toLowerCase().trim();
        const norm = normLocation(rawName);
        const provPsgc = f.properties?.adm2_psgc || f.properties?.provincePsgc;
        if (provPsgc) {
          muniIndex.set(`${provPsgc}_${norm}`, f);
          muniIndex.set(`${provPsgc}_${rawName}`, f);
        }
        if (!muniIndex.has(rawName)) {
          muniIndex.set(rawName, f);
        }
        if (!muniIndex.has(norm)) {
          muniIndex.set(norm, f);
        }
      }
    }
  }
}

// Warm up boundary indices immediately on server start
setTimeout(() => {
  try {
    ensureBoundariesLoaded();
  } catch {}
}, 10);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const name = searchParams.get('name') || '';
    const file = (searchParams.get('file') || '').replace(/[\/\\]/g, '');
    const cityFile = (searchParams.get('cityFile') || '').replace(/[\/\\]/g, '');
    const municipality = (searchParams.get('municipality') || '').trim();
    const province = (searchParams.get('province') || '').trim();

    const cacheKey = `${type}_${name}_${file}_${cityFile}_${municipality}_${province}`;
    if (boundaryResponseCache.has(cacheKey)) {
      return Response.json(boundaryResponseCache.get(cacheKey), {
        headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
      });
    }

    ensureBoundariesLoaded();
    const geoDir = path.join(process.cwd(), 'public', 'geo');
    let targetFilePath = '';
    let boundaryFeature: any = null;

    if (file) {
      const possibleDirs = ['raw_region', 'raw_province', 'raw_city', 'raw_barangay'];
      for (const d of possibleDirs) {
        const fp = path.join(geoDir, d, file);
        if (fs.existsSync(fp)) {
          targetFilePath = fp;
          break;
        }
      }
    } else if (type === 'region') {
      const nameLower = name.toLowerCase().trim();
      const norm = normLocation(name);
      boundaryFeature = regionIndex.get(norm) || regionIndex.get(nameLower);

      if (!boundaryFeature && cachedRegionsData?.features) {
        const d = cachedRegionsData;
        boundaryFeature = d.features.find((f: any) => {
          const regName = (f.properties?.region_name || f.properties?.name || '').toLowerCase().trim();
          return regName === nameLower ||
            regName.includes(nameLower) ||
            nameLower.includes(regName);
        });
      }
    } else if (type === 'province') {
      const nameLower = name.toLowerCase().trim();
      const norm = normLocation(name);
      boundaryFeature = provinceIndex.get(norm) || provinceIndex.get(nameLower);

      if (!boundaryFeature && cachedProvincesData?.features) {
        const d = cachedProvincesData;
        boundaryFeature = d.features.find((f: any) => {
          const provName = (f.properties?.province_name || f.properties?.name || '').toLowerCase().trim();
          return provName === nameLower ||
            provName.includes(nameLower) ||
            nameLower.includes(provName);
        });
      }
    } else if (type === 'city' || type === 'municipality') {
      const rawCityDir = path.join(geoDir, 'raw_city');

      // 1. If exact cityFile provided, load it FIRST (most accurate, 100% precision)
      if (cityFile && fs.existsSync(path.join(rawCityDir, cityFile))) {
        targetFilePath = path.join(rawCityDir, cityFile);
      }

      // 2. Resolve province PSGC if province parameter is provided
      const normTarget = normLocation(name);
      let targetProvPsgc: string | number | null = null;
      if (province) {
        const normProv = normLocation(province);
        const pFeat = provinceIndex.get(normProv);
        if (pFeat) {
          targetProvPsgc = pFeat.properties?.adm2_psgc;
        }
      }

      // 3. Match in raw_city directory using exact slug components
      if (!targetFilePath && fs.existsSync(rawCityDir)) {
        const files = fs.readdirSync(rawCityDir);
        const normProvSlug = province ? normLocation(province) : '';
        const normNameSlug = normLocation(name);

        // Priority A: Exact match where province slug and city slug both match
        let matched = files.find((f) => {
          const base = f.replace('.any.geo.json', '').replace('.geo.json', '');
          const parts = base.split('.');
          const cSlug = parts[parts.length - 1] || '';
          const pSlug = parts.length > 1 ? parts[parts.length - 2] : '';
          const cNorm = normLocation(cSlug);
          const pNorm = normLocation(pSlug);
          return normProvSlug && (pNorm === normProvSlug || pNorm.includes(normProvSlug) || normProvSlug.includes(pNorm)) && cNorm === normNameSlug;
        });

        // Priority B: City slug matches exactly
        if (!matched) {
          matched = files.find((f) => {
            const base = f.replace('.any.geo.json', '').replace('.geo.json', '');
            const parts = base.split('.');
            const cName = parts[parts.length - 1] || '';
            return normLocation(cName) === normNameSlug;
          });
        }

        if (matched) {
          targetFilePath = path.join(rawCityDir, matched);
        }
      }

      // 4. Fast indexed lookup in municities.json
      if (!targetFilePath) {
        if (targetProvPsgc) {
          boundaryFeature = muniIndex.get(`${targetProvPsgc}_${normTarget}`);
        }
        if (!boundaryFeature) {
          boundaryFeature = muniIndex.get(name.toLowerCase().trim()) || muniIndex.get(normTarget);
        }
      }
    } else if (type === 'barangay') {
      const lookupPath = path.join(geoDir, '2023', 'muni_lookup.json');
      let muniPsgc = '';
      const normBgyTarget = normLocation(name);

      if (fs.existsSync(lookupPath)) {
        const lookup = JSON.parse(fs.readFileSync(lookupPath, 'utf8'));
        const mKey = (municipality || cityFile || '').replace(/[\.\-]/g, ' ').toLowerCase().trim();
        if (lookup[mKey]) {
          muniPsgc = lookup[mKey].psgc;
        } else {
          for (const k of Object.keys(lookup)) {
            if (mKey && (mKey.includes(k) || k.includes(mKey))) {
              muniPsgc = lookup[k].psgc;
              break;
            }
          }
        }
      }

      // Try 2023 Faeldon barangays first
      if (muniPsgc) {
        const bgyCache = path.join(geoDir, '2023', 'municities', `${muniPsgc}.json`);
        let bgyData = null;
        if (fs.existsSync(bgyCache)) {
          bgyData = JSON.parse(fs.readFileSync(bgyCache, 'utf8'));
        } else {
          try {
            const res = await fetch(`https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson/municities/medres/bgysubmuns-municity-${muniPsgc}.0.01.json`);
            if (res.ok) {
              bgyData = await res.json();
              const dir = path.dirname(bgyCache);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(bgyCache, JSON.stringify(bgyData));
            }
          } catch {}
        }

        if (bgyData?.features) {
          const feat = bgyData.features.find((f: any) => {
            const bName = normLocation(f.properties?.adm4_en || f.properties?.name || '');
            return bName === normBgyTarget || bName.includes(normBgyTarget) || normBgyTarget.includes(bName);
          });
          if (feat) {
            boundaryFeature = feat;
          }
        }
      }

      // Fallback: raw_barangay directory
      if (!boundaryFeature) {
        const rawBgyDir = path.join(geoDir, 'raw_barangay');
        if (fs.existsSync(rawBgyDir)) {
          const muniSlug = (municipality || cityFile || '')
            .toLowerCase()
            .replace(/^city of\s+/i, '')
            .replace(/\s+city$/i, '')
            .replace(/[^a-z0-9]/g, '-');

          const files = fs.readdirSync(rawBgyDir);
          const matchedFile = files.find((f) => {
            const fLower = f.toLowerCase();
            const matchesMuni = !muniSlug || fLower.includes(muniSlug);
            const matchesBgy = fLower.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            return matchesMuni && matchesBgy;
          });

          if (matchedFile) {
            targetFilePath = path.join(rawBgyDir, matchedFile);
          }
        }
      }
    }

    if (!boundaryFeature && targetFilePath && fs.existsSync(targetFilePath)) {
      boundaryFeature = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
    }

    if (!boundaryFeature) {
      const emptyResult = {
        boundary: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
        mask: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD_RING] } },
        bounds: [[116, 4], [127, 21]],
        center: [121, 12],
      };
      boundaryResponseCache.set(cacheKey, emptyResult);
      return Response.json(emptyResult);
    }

    const bounds = getBBox(boundaryFeature.geometry);
    const center: [number, number] = [
      +((bounds[0][0] + bounds[1][0]) / 2).toFixed(5),
      +((bounds[0][1] + bounds[1][1]) / 2).toFixed(5),
    ];
    const mask = createInvertedMask(boundaryFeature.geometry);

    const result = {
      boundary: boundaryFeature,
      mask,
      bounds,
      center,
    };
    boundaryResponseCache.set(cacheKey, result);
    return Response.json(result, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Error serving boundary:', error);
    return Response.json({ error: 'Failed to fetch boundary' }, { status: 500 });
  }
}
