'use client';

import { useMemo, useState, useEffect } from 'react';

interface CityItem {
  id: string;
  name: string;
  file?: string;
}

interface ProvinceItem {
  id: string;
  name: string;
  cities: CityItem[];
}

interface RegionItem {
  id: string;
  name: string;
  provinces: ProvinceItem[];
}

interface BarangayItem {
  name: string;
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  zoom?: number;
}

interface DrillDownPanelProps {
  currentZoom: number;
  totalPoints: number;
  isReady: boolean;
  sortedRegions: RegionItem[];
  region: string;
  province: string;
  municipality: string;
  barangay: string;
  filterAnomaly?: string;
  setRegion: (v: string) => void;
  setProvince: (v: string) => void;
  setMunicipality: (v: string, file?: string) => void;
  setBarangay: (v: string, bounds?: [[number, number], [number, number]]) => void;
  setFilterAnomaly?: (v: string) => void;
  navigateTo: (level: 'root' | 'region' | 'province' | 'municipality') => void;
  basemap: string;
  setBasemap: (v: 'satellite' | 'dark' | 'streets') => void;
  getProvinces: (regionName: string) => ProvinceItem[];
  getCities: (regionName: string, provinceName: string) => CityItem[];
  isNearMeActive?: boolean;
  isLocating?: boolean;
  onNearMeToggle?: () => void;
  loadingBorders?: boolean;
  loadingProjects?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export default function DrillDownPanel({
  currentZoom,
  totalPoints,
  isReady,
  sortedRegions,
  region,
  province,
  municipality,
  barangay,
  filterAnomaly,
  setRegion,
  setProvince,
  setMunicipality,
  setBarangay,
  setFilterAnomaly,
  navigateTo,
  basemap,
  setBasemap,
  getProvinces,
  getCities,
  isNearMeActive = false,
  isLocating = false,
  onNearMeToggle,
  loadingBorders = false,
  loadingProjects = false,
  errorMessage = null,
  onRetry,
}: DrillDownPanelProps) {
  const currentProvinces = useMemo(() => getProvinces(region), [region, getProvinces]);
  const currentCities = useMemo(() => getCities(region, province), [region, province, getCities]);

  const [barangays, setBarangays] = useState<BarangayItem[]>([]);
  const [loadingBarangays, setLoadingBarangays] = useState(false);

  useEffect(() => {
    if (!municipality) {
      setBarangays([]);
      return;
    }

    const city = currentCities.find((c) => c.name.toLowerCase() === municipality.toLowerCase());
    setLoadingBarangays(true);

    const params = new URLSearchParams({
      municipality,
    });
    if (province) params.set('province', province);
    if (city?.file) params.set('cityFile', city.file);

    fetch(`/api/locations/barangays?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.barangays && Array.isArray(data.barangays)) {
          setBarangays(data.barangays);
        } else {
          setBarangays([]);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingBarangays(false));
  }, [municipality, province, currentCities]);

  const formatCount = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString();
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-11/12 max-w-5xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-3 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-2xl flex flex-col gap-3 text-xs">
      {/* Top Row: Breadcrumbs & Stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Breadcrumb Pills */}
        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
          <button
            onClick={() => navigateTo('root')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100/80 text-blue-800 hover:bg-blue-200 transition"
          >
            🇵🇭 Philippines
          </button>
          
          {region && (
            <>
              <span className="text-gray-400 dark:text-gray-500">/</span>
              <button
                onClick={() => navigateTo('region')}
                className="px-2.5 py-1 rounded-full bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                {region.replace(/\s*\(.*\)/, '').slice(0, 25)}
              </button>
            </>
          )}
          
          {province && (
            <>
              <span className="text-gray-400 dark:text-gray-500">/</span>
              <button
                onClick={() => navigateTo('province')}
                className="px-2.5 py-1 rounded-full bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                {province}
              </button>
            </>
          )}

          {municipality && (
            <>
              <span className="text-gray-400 dark:text-gray-500">/</span>
              <button
                onClick={() => navigateTo('municipality')}
                className="px-2.5 py-1 rounded-full bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                {municipality}
              </button>
            </>
          )}

          {barangay && (
            <>
              <span className="text-gray-400 dark:text-gray-500">/</span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100/80 text-emerald-800">
                {barangay}
              </span>
            </>
          )}
        </div>

        {/* Global Info */}
        <div className="flex items-center gap-2">
          {isReady ? (
            <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/50 px-2 py-1 rounded-lg">
              {formatCount(totalPoints)} Projects
            </span>
          ) : (
            <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/50 px-2 py-1 rounded-lg">
              <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="font-semibold text-blue-700 dark:text-blue-400">Loading...</span>
            </div>
          )}

          {/* Loading borders status */}
          {loadingBorders && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 font-bold text-[11px] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
              Loading borders...
            </span>
          )}

          {/* Loading projects / clusters status */}
          {loadingProjects && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-bold text-[11px] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              Syncing projects...
            </span>
          )}

          {/* Active Error / Retry Button */}
          {errorMessage && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-[11px] hover:bg-rose-100 dark:hover:bg-rose-900/60 transition shadow-sm"
              title="Click to retry loading map data"
            >
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span>⚠️ {errorMessage}</span>
              <span className="underline ml-1">Retry ↻</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Row: Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Drill-down Selectors inline */}
        <div className="flex items-center gap-2 flex-1">
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Regions</option>
            {sortedRegions.map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>

          {region && (
            <select
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Provinces</option>
              {currentProvinces.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          )}

          {province && (
            <select
              value={municipality}
              onChange={(e) => {
                const val = e.target.value;
                const cityItem = currentCities.find((c) => c.name === val);
                setMunicipality(val, cityItem?.file);
              }}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Cities / Muni</option>
              {currentCities.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}

          {(municipality || province) && barangays.length > 0 && (
            <select
              value={barangay}
              onChange={(e) => {
                const val = e.target.value;
                const bObj = barangays.find((b) => b.name === val);
                setBarangay(val, bObj?.bounds);
              }}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Barangays</option>
              {barangays.map((b) => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Near Me Button (replaces risk filters) */}
        <div className="flex items-center gap-1.5 border-l border-gray-300 dark:border-slate-600 pl-3">
          <button
            type="button"
            onClick={onNearMeToggle}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-bold text-xs transition shadow-sm ${
              isNearMeActive
                ? 'bg-blue-600 text-white shadow-blue-500/20 ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-slate-900'
                : 'bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
            }`}
            title="Locate projects within 20km of your GPS position"
          >
            {isLocating ? (
              <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isNearMeActive ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-200 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
              </span>
            ) : (
              <span>📍</span>
            )}
            <span>Near Me</span>
            {isNearMeActive && (
              <span className="text-[10px] bg-blue-700/90 px-1.5 py-0.5 rounded-full font-semibold">20km</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
