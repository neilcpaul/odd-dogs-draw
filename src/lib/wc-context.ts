// Per-team and per-venue match-context overrides used ONLY by the Monte
// Carlo simulation. These never touch stored Elo or Power Index.
//
// Defaults are neutral (0 / false) so the simulation behaves exactly as
// before until the user fills values in.

import { useSyncExternalStore } from "react";

export interface TeamContext {
  restDays: number;       // days since this team's last match
  travelKm: number;       // km travelled to this venue since last match
  altitudeTeam: boolean;  // acclimatised to altitude
  highPress: boolean;     // style relies on high pressing
  starsMissing: number;   // 0..3 elite players unavailable
}

export interface VenueContext {
  altitude: number;       // metres above sea level
  harshHeat: boolean;     // kickoff in harsh heat
}

export const NEUTRAL_TEAM_CTX: TeamContext = {
  restDays: 0,
  travelKm: 0,
  altitudeTeam: false,
  highPress: false,
  starsMissing: 0,
};

export const NEUTRAL_VENUE_CTX: VenueContext = {
  altitude: 0,
  harshHeat: false,
};

export interface ContextState {
  teams: Record<string, TeamContext>;
  venues: Record<string, VenueContext>;
}

const KEY = "odd-dogs-wc-2026-context-v1";

function loadInitial(): ContextState {
  if (typeof localStorage === "undefined") return { teams: {}, venues: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { teams: {}, venues: {} };
    const p = JSON.parse(raw);
    return { teams: p.teams ?? {}, venues: p.venues ?? {} };
  } catch {
    return { teams: {}, venues: {} };
  }
}

let state: ContextState = { teams: {}, venues: {} };
const listeners = new Set<() => void>();

function emit() {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  listeners.forEach((l) => l());
}

export function loadContextFromStorage(): void {
  state = loadInitial();
  emit();
}

export function getContextState(): ContextState {
  return state;
}

export function useContextState(): ContextState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => state,
  );
}

export function getTeamContext(team: string): TeamContext {
  return { ...NEUTRAL_TEAM_CTX, ...(state.teams[team] ?? {}) };
}

export function getVenueContext(venue: string): VenueContext {
  return { ...NEUTRAL_VENUE_CTX, ...(state.venues[venue] ?? {}) };
}

export function setTeamContext(team: string, patch: Partial<TeamContext>) {
  const cur = getTeamContext(team);
  state = {
    ...state,
    teams: { ...state.teams, [team]: { ...cur, ...patch } },
  };
  emit();
}

export function setVenueContext(venue: string, patch: Partial<VenueContext>) {
  const cur = getVenueContext(venue);
  state = {
    ...state,
    venues: { ...state.venues, [venue]: { ...cur, ...patch } },
  };
  emit();
}

export function resetAllContext() {
  state = { teams: {}, venues: {} };
  emit();
}

// ---------- context delta math (Elo-equivalent points, team A's POV) ----------
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export interface ContextDeltaBreakdown {
  rest: number;
  travel: number;
  altitude: number;
  heat: number;
  absence: number;
  total: number;
}

export function contextDelta(
  teamA: string,
  teamB: string,
  venue: string,
  s: ContextState = state,
): ContextDeltaBreakdown {
  const A = { ...NEUTRAL_TEAM_CTX, ...(s.teams[teamA] ?? {}) };
  const B = { ...NEUTRAL_TEAM_CTX, ...(s.teams[teamB] ?? {}) };
  const V = { ...NEUTRAL_VENUE_CTX, ...(s.venues[venue] ?? {}) };

  const rest = clamp((A.restDays - B.restDays) * 6, -40, 40);
  const travel = clamp((B.travelKm - A.travelKm) * 0.015, -30, 30);
  const altitude = V.altitude > 1500
    ? ((A.altitudeTeam ? 25 : 0) - (B.altitudeTeam ? 25 : 0))
    : 0;
  const heat = V.harshHeat
    ? ((B.highPress ? 18 : 0) - (A.highPress ? 18 : 0))
    : 0;
  const absence = (B.starsMissing - A.starsMissing) * 22;
  const total = rest + travel + altitude + heat + absence;
  return { rest, travel, altitude, heat, absence, total };
}

// Referee variance: fresh random value in [-25, +25] Elo, added to supremacy
// of EVERY simulated match each run. Pure noise — no directional bias.
export const REF_VARIANCE_RANGE = 25;
export function refereeNoise(): number {
  return (Math.random() * 2 - 1) * REF_VARIANCE_RANGE;
}
