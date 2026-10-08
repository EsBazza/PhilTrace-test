# Design Document: 3-Page Frontend, High-Performance Map & Codebase Cleanup

**Date:** 2026-10-09  
**Status:** Approved  
**Platform:** Next.js (App Router), Tailwind CSS, Mapbox GL, Prisma, Supabase PostgreSQL, Vercel

---

## 1. Executive Summary

This project overhauls the frontend of MapaTunAI / PhilTrace into a streamlined, high-performance 3-page civic transparency platform designed for instant load times, seamless Vercel deployment, and strict citizen location verification:
1. **Home / Landing Page (`/`)**: Project background, transparency metrics, and core calls-to-action.
2. **Interactive Map (`/map`)**: The primary user experience. Features lightweight cluster rendering (<50ms initial load), simplified fast borders, an integrated **"Near Me"** 20km radius radar in the top pill dashboard, and a strict 20km geolocation requirement for citizen review submissions.
3. **Contractors Page (`/contractors`)**: Streamlined contractor leaderboard and inspection panel with complete removal of heavy Sigma.js/Cytoscape network graphs and charts.

All unused routes, obsolete scripts, redundant datasets, and conflicting cache scripts are cleaned up to guarantee Vercel deployment readiness and optimal bundle size.

---

## 2. Architecture & Page Specification

### 2.1 The Exactly 3 Core Pages

#### Page 1: Landing / Home Page (`/`)
* **Purpose**: Public introduction to the platform, civic transparency mission, and summary statistics across all Philippine infrastructure projects.
* **Key Components**:
  * Dual-image hero presentation (`bg1.png` and `bg2.png` backdrop overlays).
  * National Infrastructure KPI metrics (Total Tracked Contracts, Total Budget Value, Community Verified Ground Proof).
  * Direct CTAs: *"Explore Interactive Map →"* (links to `/map`) and *"Inspect Contractors →"* (links to `/contractors`).
* **Performance Optimization**:
  * Optimize `/api/stats` endpoint with server-side in-memory caching and ISR cache headers (`s-maxage=3600, stale-while-revalidate=86400`). Replaces the 10.2-second full table scan with an instant sub-15ms response.

#### Page 2: Interactive Map (`/map`)
* **Purpose**: Primary interactive interface for exploring all 248,000+ DPWH infrastructure projects across the Philippines.
* **Top Pill Dashboard ([`DrillDownPanel.tsx`](file:///src/app/map/components/DrillDownPanel.tsx))**:
  * **Location Selector**: Region, Province, Municipality/City breadcrumb dropdowns.
  * **"📍 Near Me" Button**: Replaces the former `Overdue`, `Overpaid`, `Active`, `Completed` filter pills.
* **Mapbox GL Integration**:
  * Fullscreen map supporting satellite, dark, and street basemaps.
  * Native WebGL rendering with Mapbox GL native clustering.
  * Built-in slide-out [Project Inspection Drawer](file:///src/components/project-inspection-drawer.tsx) showing satellite before/after comparisons, DPWH contract details, and verified citizen reviews without navigating away from the map.

#### Page 3: Contractors Registry (`/contractors`)
* **Purpose**: Accountability leaderboard and registry for DPWH public works contractors.
* **Key Features**:
  * Search by contractor name or keyword.
  * Sorting by Total Value (PHP), Total Won Contracts, Overdue/Delayed Flags, and Average Progress %.
  * Risk filter pills: `All`, `Clean ✓`, `Pending ⚠️`, and `High Risk ✕`.
  * Sticky Contractor Inspection Panel detailing cumulative awards, completion rates, and delay flags.
  * Clicking "View Won Projects" navigates directly to `/map` filtered by that contractor.
* **Graph & Sigma Removal**:
  * Completely remove `SigmaNetwork`, Cytoscape canvas, Graphology layouts, Recharts, and WebGL bipartite renderers. Contractors page renders purely as responsive, lightning-fast DOM cards and detail panels.

---

## 3. Map Performance, Clustering & Simplified Borders

### 3.1 Tiered Lightweight Clustering
* **Tier 1 (Zoom 0–8 / National View)**:
  * Directly load the pre-computed `nationwide_initial_clusters.json` (~86 KB) on map initialization.
  * Renders instant provincial cluster bubbles with total project counts and budget values across the Philippines in under 30ms.
* **Tier 2 (Zoom >= 9 / Deep Drill-down)**:
  * When drilled into a specific province or municipality, fetch the bounding box or location slice via `/api/map/spatial` or `/api/map/clusters`.
  * Leverage Mapbox GL’s built-in GPU clustering (`cluster: true`, `clusterRadius: 50`) for smooth 60 FPS panning.

### 3.2 Simplified, Fast Borders
* Use lightweight low-resolution boundary GeoJSON (`provinces_lowres.json` ~900 KB) instead of 7MB+ high-resolution multi-polygons.
* When a region or province is selected, render a sharp, elegant border stroke (`#38bdf8`, line-width: 2) directly in Mapbox GL without heavy inverted polygon mask calculations.

### 3.3 Cache & Unhandled Rejection Fix
* In [src/app/layout.tsx](file:///src/app/layout.tsx), remove the conflicting inline script that executes `caches.delete(...)` on every page load.
* Configure Mapbox GL tile loading to prevent unhandled promise rejections on aborted tile fetches during fast panning/zooming.

---

## 4. "Near Me" (20km) Geolocation & Review Restriction

### 4.1 Geolocation & Radar UI
1. Citizen clicks **"📍 Near Me"** in the top dashboard pill.
2. The browser requests geolocation via `navigator.geolocation.getCurrentPosition`.
3. The map smoothly animates (`flyTo`) to the user’s latitude and longitude at Zoom 12.
4. Renders a 20km circular radius polygon overlay on the map.
5. Loads and highlights all projects located within that 20km circle.

### 4.2 Strict 20km Review Permission
* **Citizen Reviews Restricted to Local Radius**:
  * **Within 20km**: The project drawer displays a green *"Verified Local Resident"* badge, and the review button opens [review-modal.tsx](file:///src/components/review-modal.tsx) allowing photo upload and rating submission.
  * **Outside 20km**: The project details, satellite imagery, and past citizen reviews remain fully viewable in read-only mode, but review submission is disabled with a notice: *"Review submission is restricted to residents within 20km of the project site."*
* **Server-Side Verification**:
  * In `/api/reviews` (POST), compute Haversine distance between the submitted user coordinates and the project's `gpsLat`/`gpsLng`. If distance > 20.0 km, return HTTP 403 Forbidden to prevent API spoofing.

---

## 5. Codebase Cleanup & Vercel Readiness

### 5.1 Route Cleanup
* **Delete Unused Routes**:
  * `src/app/nearby/` (consolidated into `/map` Near Me pill).
  * `src/app/regions/` (consolidated into `/map` location drill-down).
  * `src/app/search/` (consolidated into header and contractor search).

### 5.2 Dependency Cleanup (`package.json`)
* Uninstall heavy, unused graph and chart packages:
  * `@react-sigma/core`, `react-sigma`, `sigma`
  * `cytoscape`, `react-cytoscapejs`, `@types/cytoscape`, `@types/react-cytoscapejs`
  * `graphology`, `graphology-layout`, `graphology-layout-forceatlas2`
  * `recharts` (if not used outside removed graphs)

### 5.3 Static Asset & File Cleanup
* Remove massive, obsolete datasets from `public/geo/` that are no longer needed (such as `all_projects.json` 65MB, `spatial_province_polygons.json` 13MB) or replace them with optimized references.
* Clean up unneeded test scripts in `scripts/`.
* Verify `npm run build` runs cleanly with zero lint or TypeScript errors and satisfies Vercel serverless deployment constraints.

---

## 6. Testing & Quality Checklist

1. **Build Integrity**: `npm run build` succeeds cleanly with all route types valid.
2. **Performance**: `/api/stats` responds in <50ms; `/map` initial clusters render in <100ms.
3. **No Console Errors**: Zero `Cache.put` errors on rapid pan/zoom.
4. **Near Me & Review Restriction**:
   * Near Me triggers geolocation, zooms to coordinates, and draws 20km radar.
   * Review submission is enabled for projects <20km.
   * Review submission is locked for projects >20km.
5. **Contractors Page**: Loads without any graph libraries, searches and filters accurately.
