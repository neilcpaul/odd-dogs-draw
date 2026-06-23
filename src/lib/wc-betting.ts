import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const STARTING_BANKROLL = 1000;
export const MIN_STAKE = 10;
export const MAX_ODDS = 25;
export const HOUSE_MARGIN = 1.0; // 1.0 = fair odds

const IDENTITY_KEY = "oracle-betting-player-v1";

export interface Player {
  name: string;
  balance: number;
  best_win: number;
  is_guest: boolean;
}

export interface Bet {
  id: string;
  player_name: string;
  fixture_id: string;
  bet_type: "result" | "score";
  selection: string;
  stake: number;
  locked_odds: number;
  status: "pending" | "won" | "lost";
  payout: number;
  placed_at: string;
  settled_at: string | null;
}

export function priceToOdds(prob: number): number {
  if (prob <= 0) return MAX_ODDS;
  const raw = HOUSE_MARGIN / prob;
  return Math.min(MAX_ODDS, Math.max(1.01, Math.round(raw * 100) / 100));
}

// ----- Identity (localStorage) -----
export function getIdentity(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(IDENTITY_KEY);
}
export function setIdentity(name: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(IDENTITY_KEY, name);
  identityListeners.forEach((l) => l());
}
const identityListeners = new Set<() => void>();
export function useIdentity(): [string | null, (n: string) => void] {
  const [name, setName] = useState<string | null>(() => getIdentity());
  useEffect(() => {
    const l = () => setName(getIdentity());
    identityListeners.add(l);
    return () => {
      identityListeners.delete(l);
    };
  }, []);
  return [name, setIdentity];
}

// ----- Realtime store -----
let players: Player[] = [];
let bets: Bet[] = [];
const playerListeners = new Set<() => void>();
const betListeners = new Set<() => void>();
let initialized = false;

function emitPlayers() {
  playerListeners.forEach((l) => l());
}
function emitBets() {
  betListeners.forEach((l) => l());
}

async function refetchPlayers() {
  const { data } = await supabase
    .from("betting_players")
    .select("name,balance,best_win,is_guest")
    .order("balance", { ascending: false });
  if (data) {
    players = data.map((p) => ({
      name: p.name,
      balance: Number(p.balance),
      best_win: Number(p.best_win),
      is_guest: p.is_guest,
    }));
    emitPlayers();
  }
}
async function refetchBets() {
  const { data } = await supabase
    .from("bets")
    .select("*")
    .order("placed_at", { ascending: false });
  if (data) {
    bets = data.map((b) => ({
      ...b,
      stake: Number(b.stake),
      locked_odds: Number(b.locked_odds),
      payout: Number(b.payout),
    })) as Bet[];
    emitBets();
  }
}

export function initBetting() {
  if (initialized) return;
  initialized = true;
  refetchPlayers();
  refetchBets();
  supabase
    .channel("betting-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "betting_players" },
      () => refetchPlayers(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bets" },
      () => refetchBets(),
    )
    .subscribe();
}

export function usePlayers(): Player[] {
  const [, setT] = useState(0);
  useEffect(() => {
    const l = () => setT((t) => t + 1);
    playerListeners.add(l);
    return () => {
      playerListeners.delete(l);
    };
  }, []);
  return players;
}
export function useBets(): Bet[] {
  const [, setT] = useState(0);
  useEffect(() => {
    const l = () => setT((t) => t + 1);
    betListeners.add(l);
    return () => {
      betListeners.delete(l);
    };
  }, []);
  return bets;
}
export function usePlayer(name: string | null): Player | null {
  const all = usePlayers();
  if (!name) return null;
  return all.find((p) => p.name === name) ?? null;
}

// ----- Mutations -----
export async function ensurePlayer(name: string, isGuest: boolean): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const { error } = await supabase
    .from("betting_players")
    .upsert(
      { name: trimmed, balance: STARTING_BANKROLL, is_guest: isGuest },
      { onConflict: "name", ignoreDuplicates: true },
    );
  if (error) {
    console.error("ensurePlayer", error);
    return false;
  }
  await refetchPlayers();
  return true;
}

export async function placeBet(args: {
  playerName: string;
  fixtureId: string;
  betType: "result" | "score";
  selection: string;
  stake: number;
  lockedOdds: number;
}): Promise<{ ok: boolean; error?: string }> {
  const player = players.find((p) => p.name === args.playerName);
  if (!player) return { ok: false, error: "Player not found" };
  if (args.stake < MIN_STAKE) return { ok: false, error: `Minimum stake is ${MIN_STAKE}` };
  if (args.stake > player.balance) return { ok: false, error: "Not enough coins" };

  // Atomic-ish: deduct only if balance still covers it (no race-proof CAS, but good enough here)
  const { error: updErr } = await supabase
    .from("betting_players")
    .update({ balance: player.balance - args.stake })
    .eq("name", args.playerName)
    .eq("balance", player.balance);
  if (updErr) return { ok: false, error: updErr.message };

  const { error: insErr } = await supabase.from("bets").insert({
    player_name: args.playerName,
    fixture_id: args.fixtureId,
    bet_type: args.betType,
    selection: args.selection,
    stake: args.stake,
    locked_odds: args.lockedOdds,
  });
  if (insErr) {
    // refund
    await supabase
      .from("betting_players")
      .update({ balance: player.balance })
      .eq("name", args.playerName);
    return { ok: false, error: insErr.message };
  }
  await Promise.all([refetchPlayers(), refetchBets()]);
  return { ok: true };
}

/** Settle a single bet exactly once (race-safe via WHERE status='pending'). */
export async function settleBet(
  bet: Bet,
  won: boolean,
): Promise<{ settled: boolean; payout: number; player?: Player }> {
  const payout = won ? Math.round(bet.stake * bet.locked_odds * 100) / 100 : 0;
  const { data, error } = await supabase
    .from("bets")
    .update({
      status: won ? "won" : "lost",
      payout,
      settled_at: new Date().toISOString(),
    })
    .eq("id", bet.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error || !data) return { settled: false, payout: 0 };

  if (won && payout > 0) {
    // Add payout to balance; bump best_win if applicable
    const { data: pl } = await supabase
      .from("betting_players")
      .select("balance,best_win")
      .eq("name", bet.player_name)
      .maybeSingle();
    if (pl) {
      const newBalance = Number(pl.balance) + payout;
      const newBest = Math.max(Number(pl.best_win), payout);
      await supabase
        .from("betting_players")
        .update({ balance: newBalance, best_win: newBest })
        .eq("name", bet.player_name);
    }
  }
  await Promise.all([refetchPlayers(), refetchBets()]);
  return {
    settled: true,
    payout,
    player: players.find((p) => p.name === bet.player_name),
  };
}

export function useRefetchAll() {
  return useCallback(async () => {
    await Promise.all([refetchPlayers(), refetchBets()]);
  }, []);
}
