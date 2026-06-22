## Plan

Build an Elo-driven Monte Carlo simulator (N = 10 000) and use it to power the "% chance of advancing" figure in the Live Rankings tab. Add title odds alongside. Leave Elo, Power Index, bracket display, group standings, and existing math untouched.

### New file: `src/lib/wc-simulation.ts`

A self-contained simulator. No edits to `wc-power.ts`, `wc-probability.ts`, or `wc-data.ts`.

Public API:
```ts
export interface TeamSimProbs {
  qualify: number; r16: number; qf: number; sf: number; final: number; win: number;
}
export function simulateTournament(N?: number): Record<string, TeamSimProbs>;
```

Internals:
- **Inputs**: pull current live Elo from `computeTeamPower()` (one call), played results from `effectiveScore(m.id)` for every match in `ALL_MATCHES`. Hold Elo FIXED for the whole sim.
- **Host set**: `{"United States", "Canada", "Mexico"}`, `hostAdj = +80` applied to the host side in `supremacy`.
- **One match sim**:
  ```
  supremacy = (eloA - eloB + hostAdjDiff) / 200
  lambdaA = max(0.2, 1.35 + supremacy/2)
  lambdaB = max(0.2, 1.35 - supremacy/2)
  goalsA = poisson(lambdaA); goalsB = poisson(lambdaB)
  ```
  Knockout tiebreak when level: `P(A) = 1 / (1 + 10^((eloB - eloA - hostAdj)/400))`.
- **Per sim run**:
  1. For every group match: if `effectiveScore` exists, use it; else simulate.
  2. Build group table (pts → GD → GF → higher Elo), take 1st and 2nd.
  3. Collect 12 third-place records `{team, group, pts, gd, gf, elo}`, sort, take top 8.
  4. Slot the 32 qualifiers into a duplicated `R32_STRUCTURE` (winners / runners-up / best-3rd cluster — same greedy "first eligible 3rd in cluster" rule the bracket UI already uses). For played knockout matches whose slots are filled in `state.knockoutSlots` AND have a `effectiveScore`, use the actual winner instead of simulating, so confirmed knockouts cascade.
  5. Simulate R32 → R16 → QF → SF → Final pairings (slot ordering = `R32_STRUCTURE` row order; standard binary bracket pairing into R16 / QF / SF / Final). Record furthest stage reached per team.
- Output `% of N` for each milestone: qualify (reach R32), r16, qf, sf, final, win.

Fast Poisson: incremental probability scan against `Math.random()`. Lambdas are small (≤ ~3) so this is cheap. Total cost ≈ 10 000 × ~88 matches ≈ <1 M Poisson draws — well under 1 s in the browser.

### Wire into Live Rankings tab (`src/routes/index.tsx` → `PowerIndexTab`)

- Add a `useSimProbs()` hook (local) that:
  - reads `useAppState()` + `useLiveState()` so it re-renders on result changes
  - runs `simulateTournament()` debounced (300 ms after the last state change) inside `useEffect`
  - returns the cached result map plus a `loading` flag for the first compute
- Replace the existing `Adv %` column value with `sim[team].qualify * 100` (formatted "%", "—" while loading). Keep the column header as "Adv %" but update its tooltip to "Chance of qualifying from the group (Monte Carlo, 10 000 sims, live Elo)".
- Add a new rightmost column "Title %" showing `sim[team].win * 100` with a tooltip "Chance of winning the tournament".
- Header tweak: small caption under the existing "Live Elo seeded…" line reading "Adv % and Title % from 10 000-run Elo simulation, updates on every result."

### Recompute / debounce behavior

- Subscribing to `useAppState`/`useLiveState` re-fires the effect on any state change.
- A single `setTimeout(..., 300)` per change collapses keystroke storms; only the final state triggers `simulateTournament`. Previous result stays visible during the gap.

### Out of scope (do not touch)

- `wc-power.ts` Elo/Power Index
- `wc-probability.ts` (existing static priceMatch, knockoutAdvanceProbability — left in place; bracket page still uses them)
- Bracket tab, group probabilities, scoreboard, standings

### Files touched

- `src/lib/wc-simulation.ts` — new
- `src/routes/index.tsx` — `PowerIndexTab` rendering only (column data + 1 new column + tooltip text)
