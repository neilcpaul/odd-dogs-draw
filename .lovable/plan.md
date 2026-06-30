## Root cause

`src/components/MatchDetailModal.tsx` calls `useOFEnrichment(matchId ?? "")` **after** an early return:

```tsx
const match = matchId ? ALL_MATCHES.find(...) : undefined;
if (!match) {
  return <Dialog open={false} onOpenChange={onClose}><DialogContent /></Dialog>;
}
// ...lots of non-hook logic...
const of = useOFEnrichment(matchId ?? "");   // ← hook AFTER conditional return
```

When `matchId` is null the component renders with 5 hooks (useAppState, useLiveMatch, useState, useEffect, plus internal). When `matchId` is set it renders with 6 (adds `useOFEnrichment`). React throws #310 the moment the user opens a match after the modal has rendered closed.

Audit of other recently changed files (`wc-openfootball.ts`, `wc-api.ts`, `wc-store.ts`) shows no other Rules-of-Hooks violations — `useOFEnrichment` itself calls `useSyncExternalStore` unconditionally at the top of its body, so it's safe as long as the call site is unconditional.

## Fix (structural only — no logic, data, or visual change)

In `src/components/MatchDetailModal.tsx`, reorder the body of `MatchDetailModal` so every hook runs before any early return:

1. Keep the existing hook calls at the top in their current order:
   - `useAppState()`
   - `useLiveMatch(matchId ?? "")`
   - `useState` for the 30s tick
   - `useEffect` for the live interval (the existing `if (!live …) return;` guard inside the effect already handles the closed/non-live case — leave it)
2. **Move** `const of = useOFEnrichment(matchId ?? "");` up to sit alongside the other hooks, before the `if (!match) return …` early return.
3. Leave the early return (`if (!match) return <Dialog open={false} …/>`) exactly where it is — it now sits after all hooks.
4. Leave every downstream calculation (`e`, `stored`, `score`, scorer lines, milestones, sweepstakes block) and all JSX untouched.

No other files change. No props, behaviour, styles, or rendered output change — only the call order inside the function body.

## Verification

- Re-read MatchDetailModal.tsx and confirm: all of `useAppState`, `useLiveMatch`, `useState`, `useEffect`, `useOFEnrichment` appear before any `return`, none are inside `if`/ternary/callback.
- Open and close a match in the preview; #310 should no longer fire and the modal should look identical.
