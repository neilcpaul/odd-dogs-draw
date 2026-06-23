import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { nextUpcoming, useAppState, effectiveTeams } from "@/lib/wc-store";
import { computeTeamPower } from "@/lib/wc-power";
import { TEAMS } from "@/lib/wc-data";

const HOSTS = new Set(["United States", "Canada", "Mexico"]);
const HOST_ADJ = 80;
export const MAX_GOALS = 7;

export function hostAdj(team: string): number {
  return HOSTS.has(team) ? HOST_ADJ : 0;
}

export function poissonPmf(lambda: number): number[] {
  const out = new Array(MAX_GOALS + 1).fill(0);
  out[0] = Math.exp(-lambda);
  for (let i = 1; i <= MAX_GOALS; i++) out[i] = (out[i - 1] * lambda) / i;
  return out;
}

export interface Prediction {
  homeWin: number;
  draw: number;
  awayWin: number;
  scoreHome: number;
  scoreAway: number;
  /** Full goal grid: grid[i][j] = P(home=i, away=j). */
  grid: number[][];
}

export function predict(eloA: number, eloB: number, hostDiff: number): Prediction {
  const supremacy = (eloA - eloB + hostDiff) / 200;
  const lambdaA = Math.max(0.2, 1.35 + supremacy / 2);
  const lambdaB = Math.max(0.2, 1.35 - supremacy / 2);
  const a = poissonPmf(lambdaA);
  const b = poissonPmf(lambdaB);
  const grid: number[][] = Array.from({ length: MAX_GOALS + 1 }, () =>
    new Array(MAX_GOALS + 1).fill(0),
  );
  let homeWin = 0,
    draw = 0,
    awayWin = 0;
  let bestProb = -1,
    bestI = 0,
    bestJ = 0;
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = a[i] * b[j];
      grid[i][j] = p;
      total += p;
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (p > bestProb) {
        bestProb = p;
        bestI = i;
        bestJ = j;
      }
    }
  }
  // Renormalize (tail mass beyond MAX_GOALS)
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) grid[i][j] /= total;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
    scoreHome: bestI,
    scoreAway: bestJ,
    grid,
  };
}

/** Compute prediction for a fixture given current live Elo map. */
export function predictForFixture(
  home: string,
  away: string,
  eloMap: Record<string, number>,
): Prediction {
  const eloA = eloMap[home] ?? TEAMS[home]?.startElo ?? 1500;
  const eloB = eloMap[away] ?? TEAMS[away]?.startElo ?? 1500;
  const hostDiff = hostAdj(home) - hostAdj(away);
  return predict(eloA, eloB, hostDiff);
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

// Decorative sparkles — positioned absolutely inside the contained panel.
// Animate opacity/transform ONLY (no position/size). Staggered durations & delays.
const SPARKLES: Array<{
  top: string;
  left: string;
  size: number;
  color: string;
  duration: string;
  delay: string;
}> = [
  { top: "8%",  left: "4%",   size: 10, color: "#fef3c7", duration: "2.6s", delay: "0s" },
  { top: "12%", left: "38%",  size: 8,  color: "#a5f3fc", duration: "3.4s", delay: "0.8s" },
  { top: "6%",  left: "72%",  size: 11, color: "#ffffff", duration: "2.9s", delay: "1.6s" },
  { top: "18%", left: "94%",  size: 7,  color: "#fde68a", duration: "3.8s", delay: "0.3s" },
  { top: "84%", left: "6%",   size: 9,  color: "#cffafe", duration: "3.2s", delay: "2.1s" },
  { top: "92%", left: "48%",  size: 7,  color: "#ffffff", duration: "2.7s", delay: "1.2s" },
  { top: "88%", left: "90%",  size: 10, color: "#fde68a", duration: "3.6s", delay: "0.5s" },
  { top: "50%", left: "98%",  size: 8,  color: "#a5f3fc", duration: "4.0s", delay: "2.4s" },
];

function SparkleLayer() {
  return (
    <div
      aria-hidden
      className="oracle-sparkles"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {SPARKLES.map((s, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          width={s.size}
          height={s.size}
          style={{
            position: "absolute",
            top: s.top,
            left: s.left,
            color: s.color,
            opacity: 0.15,
            animation: `oracle-twinkle ${s.duration} ease-in-out ${s.delay} infinite`,
            filter: `drop-shadow(0 0 4px ${s.color})`,
          }}
        >
          {/* 4-point star */}
          <path
            d="M12 1.5 L13.6 10.4 L22.5 12 L13.6 13.6 L12 22.5 L10.4 13.6 L1.5 12 L10.4 10.4 Z"
            fill="currentColor"
          />
        </svg>
      ))}
    </div>
  );
}

export function PredictionBoard() {
  useAppState(); // reactive on score changes
  const fixtures = nextUpcoming(3);

  const eloMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of computeTeamPower()) map[t.team] = t.liveElo;
    return map;
  }, [fixtures.length, fixtures.map((f) => f.id).join(",")]);

  if (fixtures.length === 0) return null;

  return (
    <div
      className="prediction-board relative my-4 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-950/40 via-slate-950/60 to-cyan-950/30 p-4 overflow-hidden"
      style={{ contain: "layout paint", minHeight: 220 }}
    >
      <SparkleLayer />
      <div className="relative flex items-center justify-between mb-3 flex-wrap gap-2 z-10">
        <h3 className="text-base font-bold text-cyan-100 tracking-wide">
          🔮💅 The Oracle Says… 💅🔮
        </h3>
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cyan-300/90 font-bold">
          <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Live Model
        </span>
      </div>

      <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3 z-10">
        {fixtures.map((m) => {
          const { home, away } = effectiveTeams(m);
          if (!home || !away) return null;
          const p = predictForFixture(home, away, eloMap);

          const favProb = Math.max(p.homeWin, p.awayWin);
          const gap = Math.abs(p.homeWin - p.awayWin);
          let tag: string;
          if (favProb >= 0.65) tag = "ONE-SIDED";
          else if (gap <= 0.12) tag = "TOO CLOSE TO CALL";
          else tag = `EDGE: ${p.homeWin > p.awayWin ? home : away}`;

          const eloA = eloMap[home] ?? TEAMS[home]?.startElo ?? 1500;
          const eloB = eloMap[away] ?? TEAMS[away]?.startElo ?? 1500;
          const lowerEloIsHome = eloA < eloB;
          const upsetProb = lowerEloIsHome ? p.homeWin : p.awayWin;
          const upset = upsetProb >= 0.33;

          const tHome = TEAMS[home];
          const tAway = TEAMS[away];
          const colorA = tHome?.teamColor ?? "#22d3ee";
          const colorB = tAway?.teamColor ?? "#a78bfa";

          return (
            <div
              key={m.id}
              className="rounded-lg border border-cyan-300/15 bg-slate-950/60 p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-cyan-200/70 font-bold">
                <span>{m.stage === "group" ? `Group ${m.group}` : m.stage}</span>
                <span>{formatKickoff(m.date)}</span>
              </div>

              <div className="flex items-center justify-between gap-2 text-sm">
                <Link
                  to="/team/$team"
                  params={{ team: home }}
                  className="flex items-center gap-1.5 font-semibold text-foreground hover:text-cyan-300 transition min-w-0"
                >
                  <span className="text-base leading-none">{tHome?.flag ?? "🏳️"}</span>
                  <span className="truncate">{home}</span>
                </Link>
                <span className="text-cyan-300/80 font-mono text-base font-bold tabular-nums whitespace-nowrap">
                  {p.scoreHome}–{p.scoreAway}
                </span>
                <Link
                  to="/team/$team"
                  params={{ team: away }}
                  className="flex items-center gap-1.5 font-semibold text-foreground hover:text-cyan-300 transition min-w-0 justify-end"
                >
                  <span className="truncate text-right">{away}</span>
                  <span className="text-base leading-none">{tAway?.flag ?? "🏳️"}</span>
                </Link>
              </div>

              <div className="relative h-2 rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${p.homeWin * 100}%`, background: colorA }}
                  title={`${home} ${(p.homeWin * 100).toFixed(0)}%`}
                />
                <div
                  style={{ width: `${p.draw * 100}%`, background: "#475569" }}
                  title={`Draw ${(p.draw * 100).toFixed(0)}%`}
                />
                <div
                  style={{ width: `${p.awayWin * 100}%`, background: colorB }}
                  title={`${away} ${(p.awayWin * 100).toFixed(0)}%`}
                />
              </div>
              <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground font-mono">
                <span>{(p.homeWin * 100).toFixed(0)}%</span>
                <span>D {(p.draw * 100).toFixed(0)}%</span>
                <span>{(p.awayWin * 100).toFixed(0)}%</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-0.5">
                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-cyan-400/10 text-cyan-200 border border-cyan-400/30">
                  {tag}
                </span>
                {upset && (
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-400/10 text-amber-200 border border-amber-400/40">
                    ⚡ Upset Watch
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
