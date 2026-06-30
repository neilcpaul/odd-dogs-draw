// Openfootball score-milestone + goal-scorer enrichment, keyed by internal match id.
// Strictly additive: never overrides worldcup26.ir or stored scores.

import { useSyncExternalStore } from "react";

export interface OFGoal {
  name: string;
  minute: string; // e.g. "54", "90+3", "107"
}

export interface ParsedOFScore {
  halfTimeHome?: number; halfTimeAway?: number;
  fullTimeHome?: number; fullTimeAway?: number;
  extraTimeHome?: number; extraTimeAway?: number;
  penaltiesHome?: number; penaltiesAway?: number;
  finalScoreHome: number; finalScoreAway: number;
  wentToExtraTime: boolean;
  wentToPenalties: boolean;
  isComplete: boolean;
  winner: "home" | "away" | null;
}

export interface OFEnrichment extends ParsedOFScore {
  matchId: string;
  homeGoals: OFGoal[];
  awayGoals: OFGoal[];
}

interface MatchScoreObj {
  ht?: [number, number];
  ft?: [number, number];
  et?: [number, number];
  p?: [number, number];
}

// Parse the openfootball score object (or legacy flat score1/score2 fields).
// Resilient: never throws on missing/malformed input.
export function parseOpenfootballScore(match: unknown): ParsedOFScore {
  const empty: ParsedOFScore = {
    finalScoreHome: 0, finalScoreAway: 0,
    wentToExtraTime: false, wentToPenalties: false,
    isComplete: false, winner: null,
  };
  try {
    const m = (match ?? {}) as { score?: MatchScoreObj; score1?: unknown; score2?: unknown };
    let score: MatchScoreObj | undefined = m.score;
    if (!score && (typeof m.score1 === "number" || typeof m.score2 === "number")) {
      score = { ft: [Number(m.score1 ?? 0), Number(m.score2 ?? 0)] };
    }
    if (!score) return empty;

    const isComplete = Array.isArray(score.ft);
    const wentToExtraTime = Array.isArray(score.et);
    const wentToPenalties = Array.isArray(score.p);
    const displayScore = score.et ?? score.ft;

    let winner: "home" | "away" | null = null;
    if (wentToPenalties && score.p) {
      winner = score.p[0] > score.p[1] ? "home" : "away";
    } else if (wentToExtraTime && score.et && score.et[0] !== score.et[1]) {
      winner = score.et[0] > score.et[1] ? "home" : "away";
    } else if (score.ft && score.ft[0] !== score.ft[1]) {
      winner = score.ft[0] > score.ft[1] ? "home" : "away";
    }

    return {
      halfTimeHome: score.ht?.[0], halfTimeAway: score.ht?.[1],
      fullTimeHome: score.ft?.[0], fullTimeAway: score.ft?.[1],
      extraTimeHome: score.et?.[0], extraTimeAway: score.et?.[1],
      penaltiesHome: score.p?.[0], penaltiesAway: score.p?.[1],
      finalScoreHome: displayScore?.[0] ?? 0,
      finalScoreAway: displayScore?.[1] ?? 0,
      wentToExtraTime, wentToPenalties, isComplete, winner,
    };
  } catch {
    return empty;
  }
}

export function parseOpenfootballGoals(raw: unknown): OFGoal[] {
  if (!Array.isArray(raw)) return [];
  const out: OFGoal[] = [];
  for (const g of raw) {
    try {
      const name = String((g as { name?: unknown }).name ?? "").trim();
      const minute = String((g as { minute?: unknown }).minute ?? "").trim();
      if (name) out.push({ name, minute });
    } catch { /* skip */ }
  }
  return out;
}

// Goals beyond regulation time (minute > 90 after parsing the leading number).
export function isExtraTimeMinute(minute: string): boolean {
  const head = minute.split("+")[0];
  const n = parseInt(head, 10);
  return Number.isFinite(n) && n > 90;
}

let state: Record<string, OFEnrichment> = {};
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }

export function setOFEnrichments(updates: OFEnrichment[]): void {
  if (updates.length === 0) return;
  const next = { ...state };
  let changed = false;
  for (const u of updates) {
    const prev = next[u.matchId];
    if (!prev || JSON.stringify(prev) !== JSON.stringify(u)) {
      next[u.matchId] = u;
      changed = true;
    }
  }
  if (!changed) return;
  state = next;
  emit();
}

export function getOFEnrichment(matchId: string): OFEnrichment | undefined {
  return state[matchId];
}

export function useOFEnrichment(matchId: string): OFEnrichment | undefined {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state[matchId],
    () => state[matchId],
  );
}
