# Implementation Plan: 3-Page Frontend, High-Performance Map Overhaul & Cleanup

## Phase 1: Dependencies & Configuration
1. In `package.json`, remove `@react-sigma/core`, `react-sigma`, `sigma`, `cytoscape`, `react-cytoscapejs`, `@types/cytoscape`, `@types/react-cytoscapejs`, `graphology`, `graphology-layout`, `graphology-layout-forceatlas2`, `recharts`.
2. In `prisma/schema.prisma`, add `binaryTargets = ["native", "rhel-openssl-3.0.x"]`.
3. In `src/lib/geo.ts`, update `MAX_REVIEW_RADIUS_KM = 20`.
4. Run `npm install` to synchronize `package-lock.json`.

## Phase 2: Static Asset & Dead Code Cleanup
1. Delete `public/geo/raw_barangay/` (41,743 files) and `public/geo/raw_city/` (1,644 files), `raw_province/`, `raw_region/`.
2. Delete root `dpwh_transparency_data.parquet` (24.3MB).
3. Delete `public/geo/all_projects.json` (65.4MB).
4. Delete dead components: `src/components/philippines-map.tsx`, `src/components/chatbot.tsx`, `src/components/contractors/sigma-network.tsx`.
5. Delete obsolete routes: `src/app/nearby/`, `src/app/regions/`, `src/app/search/`.
6. Delete dead API routes: `src/app/api/contractors/graph/`, `src/app/api/chat/`.

## Phase 3: Core Fixes (Cache.put error & 10.2s stats latency)
1. In `src/app/layout.tsx`: Remove the destructive `caches.delete(...)` loop.
2. In `src/app/api/stats/route.ts`: Implement in-memory cache for aggregate query so subsequent loads respond in <10ms.

## Phase 4: Header & Home Page Alignment
1. In `src/components/header.tsx`:
   - Keep only: **Home** (`/`), **Interactive Map** (`/map`), **Contractors** (`/contractors`).
   - Remove obsolete links to `/nearby`.
2. In `src/app/page.tsx`:
   - Remove footer/CTA references to `/nearby`. All project exploration points to `/map` and `/contractors`.

## Phase 5: Interactive Map Overhaul (`/map`)
1. In `src/app/map/components/DrillDownPanel.tsx`:
   - Remove `RISK_FILTERS` (`Overdue`, `Overpaid`, `Active`, `Completed`).
   - Add prominent **"📍 Near Me"** toggle button with active state & pulsating indicator.
2. In `src/app/map/page.tsx`:
   - Fast tiered loading: load `nationwide_initial_clusters.json` (86 KB) on startup for instant national bubbles.
   - Basic fast borders: load `provinces_lowres.json` (900 KB) with clean stroke `#38bdf8`.
   - "Near Me" integration:
     - On click, invoke browser geolocation.
     - Fly camera to user coordinates.
     - Render 20km radius circle polygon.
     - Fetch nearby projects within 20km via `/api/nearby`.
   - In-map Project Inspection Drawer:
     - Mount `ProjectInspectionDrawer`.
     - Pass down 20km eligibility flag based on user's GPS distance to project.
3. In `src/components/review-modal.tsx` and `src/app/api/reviews/route.ts`:
   - Enforce 20km radius check (both in modal UI and in API backend).

## Phase 6: Contractors Page Overhaul (`/contractors`)
1. In `src/app/contractors/page.tsx`:
   - Remove `SigmaNetwork` dynamic import, network view toggle pill, and WebGL container.
   - Remove `useContractorGraph()` query hook and derive summary statistics without network graph data.
   - Keep full card list, pagination, search, risk filters, and sticky contractor details inspector.

## Phase 7: Verification & Build Check
1. Run `npm run build` to confirm clean compilation and zero TypeScript/lint errors.
2. Test responsiveness and verify all features work seamlessly.
