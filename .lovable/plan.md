## Plan

The existing per-team dropdown on the Live Rankings tab already pulls from `r.breakdown`, which is populated inside `computeTeamPower()` by iterating every played match in `collectPlayedMatches()`. That function reads `effectiveScore(m.id)` for every match in `ALL_MATCHES`, so any newly entered or live-updating result is automatically included on the next render (the tab subscribes to `useAppState` and `useLiveState`).

So functionally this should already cover "all matches so far, updating as they happen." This plan is a verification pass — no behavior changes expected unless verification turns up a gap.

### Steps

1. Re-read `collectPlayedMatches()` in `src/lib/wc-power.ts` to confirm it includes every played match (group + knockout) with no filtering, and that breakdown entries are pushed for both sides of every match.
2. Re-read the `PowerIndexTab` rendering in `src/routes/index.tsx` to confirm:
   - the dropdown renders every entry in `r.breakdown` (no slicing/limit),
   - the breakdown is sorted chronologically (matches are already sorted by date in `collectPlayedMatches`),
   - the component re-renders when scores change (subscriptions to `useAppState` / `useLiveState` are in place).
3. If any gap is found (e.g. a stage not mapped in `STAGE_FACTOR`, a match excluded by `effectiveTeams` returning null when teams are TBD, or sort order not honoured in the UI), fix only that gap.
4. Optional polish if found useful during the read: format the `date` column in the breakdown table so the chronological order is obvious to the user.

### Files likely touched

- `src/lib/wc-power.ts` — only if verification finds a gap
- `src/routes/index.tsx` — only if verification finds a gap, or to add a date column for clarity
