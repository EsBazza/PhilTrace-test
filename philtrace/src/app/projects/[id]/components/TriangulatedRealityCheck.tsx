'use client';

import { ShieldAlert, CheckCircle2, AlertTriangle, Eye, HardHat, FileText, Satellite } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { ProjectDetailData } from '@/hooks/use-projects';

interface TriangulatedCheckProps {
  project: ProjectDetailData;
  onNavigateTab: (tabId: string) => void;
}

export default function TriangulatedRealityCheck({ project, onNavigateTab }: TriangulatedCheckProps) {
  const disbursementPct = project.budgetPHP > 0 ? Math.round((project.amountPaid / project.budgetPHP) * 100) : 0;
  const progressPct = Math.round(project.progress || 0);
  const gapPct = disbursementPct - progressPct;

  const reviews = project.reviews || [];
  const reviewCount = reviews.length;
  const avgRating = project.avgRating || 0;

  // Workforce presence count
  const activeWorkerVotes = reviews.filter((r) => r.workersActive === true).length;
  const abandonedVotes = reviews.filter((r) => r.workersActive === false).length;

  // High risk verdict determination
  const hasHighGap = gapPct >= 30;
  const isStalled = project.flagStalled;
  const isOverdue = project.flagOverdue;
  const isOverpaid = project.flagOverpaid;

  const isSevere = (project.riskScore || 0) >= 60 || isOverpaid || hasHighGap;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 shadow-2xl">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Eye className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-white">
              Triangulated Reality Check
            </h3>
            <p className="text-[11px] text-slate-400">
              Cross-verifying official claims against satellite time-series & ground-level witnesses
            </p>
          </div>
        </div>

        {/* Verdict Badge */}
        <div className="flex items-center gap-2">
          {isSevere ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-950/80 px-3 py-1 text-xs font-black text-rose-300 animate-pulse">
              <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
              HIGH ANOMALY DISCREPANCY
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-3 py-1 text-xs font-black text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              PLAUSIBLE PROGRESS RECORD
            </span>
          )}
        </div>
      </div>

      {/* 3 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800/80">
        
        {/* Pillar 1: Government Claim */}
        <div className="p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                Signal 1 · DPWH Claims
              </span>
              <FileText className="h-4 w-4 text-cyan-500/60" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">{progressPct}%</span>
              <span className="text-xs text-slate-400 font-medium">Physical Completion</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Paid out <strong className="text-cyan-300">{formatCurrency(project.amountPaid)}</strong> ({disbursementPct}% of total budget) under official DPWH contract records.
            </p>
          </div>

          <div className="rounded-lg bg-slate-950/70 p-2.5 border border-slate-800 text-[11px]">
            <span className="text-slate-400">Status: </span>
            <span className="font-bold text-white">{project.status}</span>
            {hasHighGap && (
              <span className="block mt-1 font-semibold text-amber-400">
                ⚠️ Payout leads physical work by {gapPct}%
              </span>
            )}
          </div>
        </div>

        {/* Pillar 2: Satellite Evidence */}
        <div className="p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#ffb241]">
                Signal 2 · Satellite Proof
              </span>
              <Satellite className="h-4 w-4 text-[#ffb241]/80" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">ESRI Wayback</span>
              <span className="text-xs text-slate-400 font-medium">Time-Series</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Visual coordinate alignment at <strong className="font-mono text-slate-200">{project.gpsLat.toFixed(3)}, {project.gpsLng.toFixed(3)}</strong>. Compare pre-construction vs present terrain.
            </p>
          </div>

          <button
            onClick={() => onNavigateTab('satellite')}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#ffb241]/10 border border-[#ffb241]/30 py-2 text-xs font-bold text-[#ffb241] hover:bg-[#ffb241]/20 transition"
          >
            <span>Inspect Satellite Slider</span>
            <span>&rarr;</span>
          </button>
        </div>

        {/* Pillar 3: Citizen Ground Truth */}
        <div className="p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                Signal 3 · Citizen Reports
              </span>
              <HardHat className="h-4 w-4 text-emerald-500/60" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">
                {reviewCount > 0 ? `${avgRating.toFixed(1)} ★` : 'No Reports'}
              </span>
              <span className="text-xs text-slate-400 font-medium">
                ({reviewCount} verified whistleblower{reviewCount === 1 ? '' : 's'})
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {reviewCount > 0 ? (
                <>
                  Workforce activity: <strong className="text-white">{activeWorkerVotes} active</strong> vs{' '}
                  <strong className="text-rose-400">{abandonedVotes} abandoned</strong> reports from nearby citizens.
                </>
              ) : (
                'No community members have filed an OTP-verified on-ground report yet.'
              )}
            </p>
          </div>

          <button
            onClick={() => onNavigateTab('community')}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
          >
            <span>{reviewCount > 0 ? 'Read Ground Reports' : 'Be First to Report'}</span>
            <span>&rarr;</span>
          </button>
        </div>

      </div>

      {/* Summary Footer Verdict */}
      <div className={`px-5 py-3 border-t text-xs font-medium flex flex-wrap items-center justify-between gap-2 ${
        isSevere 
          ? 'bg-rose-950/30 border-rose-900/60 text-rose-300' 
          : 'bg-slate-950/50 border-slate-800 text-slate-300'
      }`}>
        <div className="flex items-center gap-2">
          <AlertTriangle className={`h-4 w-4 shrink-0 ${isSevere ? 'text-rose-400' : 'text-slate-400'}`} />
          <span>
            {isSevere
              ? 'Forensic Warning: Financial disbursement and milestones reveal severe discrepancies compared against physical signals.'
              : 'Official milestones and recorded citizen signals currently exhibit normal alignment.'}
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          Risk Index: <strong className="text-white">{project.riskScore || 0}/100</strong>
        </span>
      </div>
    </div>
  );
}
