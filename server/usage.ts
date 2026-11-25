import { localDate, readJson, type AuxCost } from './store.js';
import type { SessionMeta } from './sessions.js';

export const AUX_PROJECT = 'claudiopiloto (resúmenes y novedades)';

export interface UsageReport {
  days: { date: string; byProject: Record<string, number>; total: number }[];
  byProject: { project: string; costUSD: number; tokens: number; sessions: number }[];
  byModel: { model: string; costUSD: number; tokens: number }[];
  totals: { today: number; last7: number; last30: number; allTime: number; tokens30: number };
  estimatedShare: number;
}

/**
 * Spread each session's real cost (from its last cost-state) over its days and models,
 * in proportion to a price-like weight. Sessions without a cost-state get an estimate
 * from the average cost per weight unit of the sessions that have one.
 */
export function buildUsage(sessions: SessionMeta[], numDays = 30): UsageReport {
  let knownCost = 0;
  let knownWeight = 0;
  for (const s of sessions) {
    const w = s.buckets.reduce((a, b) => a + b.weight, 0);
    if (s.costUSD != null && w > 0) {
      knownCost += s.costUSD;
      knownWeight += w;
    }
  }
  const rate = knownWeight > 0 ? knownCost / knownWeight : 0;

  const today = localDate(Date.now());
  const dates: string[] = [];
  for (let i = numDays - 1; i >= 0; i--) dates.push(localDate(Date.now() - i * 86400_000));
  const inWindow = new Set(dates);
  const last7 = new Set(dates.slice(-7));

  const days = new Map(dates.map((d) => [d, { date: d, byProject: {} as Record<string, number>, total: 0 }]));
  const byProject = new Map<string, { project: string; costUSD: number; tokens: number; sessions: number }>();
  const byModel = new Map<string, { model: string; costUSD: number; tokens: number }>();
  const totals = { today: 0, last7: 0, last30: 0, allTime: 0, tokens30: 0 };
  let estimated = 0;

  const add = (date: string, project: string, model: string, cost: number, tokens: number) => {
    totals.allTime += cost;
    if (!inWindow.has(date)) return;
    totals.last30 += cost;
    totals.tokens30 += tokens;
    if (last7.has(date)) totals.last7 += cost;
    if (date === today) totals.today += cost;
    const day = days.get(date)!;
    day.byProject[project] = (day.byProject[project] ?? 0) + cost;
    day.total += cost;
    const p = byProject.get(project) ?? { project, costUSD: 0, tokens: 0, sessions: 0 };
    p.costUSD += cost;
    p.tokens += tokens;
    byProject.set(project, p);
    const m = byModel.get(model) ?? { model, costUSD: 0, tokens: 0 };
    m.costUSD += cost;
    m.tokens += tokens;
    byModel.set(model, m);
  };

  for (const s of sessions) {
    const w = s.buckets.reduce((a, b) => a + b.weight, 0);
    let touched = false;
    for (const b of s.buckets) {
      const cost = s.costUSD != null && w > 0 ? (s.costUSD * b.weight) / w : b.weight * rate;
      if (s.costUSD == null && inWindow.has(b.date)) estimated += cost;
      add(b.date, s.project, b.model, cost, b.tokens);
      if (inWindow.has(b.date)) touched = true;
    }
    if (touched) byProject.get(s.project)!.sessions++;
  }

  for (const a of readJson<AuxCost[]>('aux-costs.json', [])) add(a.date, AUX_PROJECT, 'aux', a.costUSD, 0);

  return {
    days: [...days.values()],
    byProject: [...byProject.values()].sort((a, b) => b.costUSD - a.costUSD),
    byModel: [...byModel.values()].sort((a, b) => b.costUSD - a.costUSD),
    totals,
    estimatedShare: totals.last30 > 0 ? estimated / totals.last30 : 0,
  };
}
