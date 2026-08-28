1. EXECUTIVE VERDICT
The fatal UI lifecycle deadlock blocking the Check-In and Call workflow has been repaired. The frontend was correctly patched to consume the server-authoritative `CHECKED_IN` state. The Call Athlete functionality is successfully restored without bypassing any underlying RPC validation rules.

2. FILES INSPECTED
- src/types/tournament.ts
- src/components/competition/AnyoScoringConsole.tsx
- src/components/competition/anyo/AnyoStagedPerformerWorkspace.tsx
- src/components/competition/AnyoPublicScoreboardModal.tsx
- src/services/anyoScoringService.ts
- src/components/tournament/BracketMatchNode.tsx
- src/components/court-operations/MatchQueueBoard.tsx
- src/components/court-operations/ScoringArbitrationQueue.tsx

3. FILES MODIFIED
- src/types/tournament.ts
- src/components/competition/AnyoScoringConsole.tsx
- src/components/competition/anyo/AnyoStagedPerformerWorkspace.tsx
- src/components/competition/AnyoPublicScoreboardModal.tsx

4. LIFECYCLE CORRECTIONS
- Added `CHECKED_IN` to `AnyoPerformanceStatus` in the frontend types.
- Updated the "Up Next" queue logic in `AnyoScoringConsole` (`nextEligiblePerformance` and `selectedPerformanceId`) to filter for `WAITING`, `CHECKED_IN`, or `CALLED` correctly rather than just `WAITING` or `CALLED`.
- Safely removed the legacy "Revoke Check-In" button because no backend mechanism exists to revoke a check-in in this migration, preventing broken idempotent RPC calls.

5. CALL-ELIGIBILITY CORRECTION
- Updated `canCallActive` condition in `AnyoScoringConsole.tsx` from `activePerformance.status === 'WAITING'` to `activePerformance.status === 'CHECKED_IN'`.
- Updated `AnyoStagedPerformerWorkspace.tsx` so the "Call Athlete to Court" button exclusively appears when the status is `CHECKED_IN`.
- Mutex, sequencer checks, read-only guards, and finalized session checks were strictly preserved.

6. CHECK-IN FLOW VERIFICATION
- The "Confirm Physical Check-In" button in `AnyoStagedPerformerWorkspace.tsx` was correctly hardened to only appear when `!isCheckedIn && performance.status === 'WAITING' && !isReadOnly`.
- Subsequent states (CALLED, PERFORMING, SCORING, COMPLETED) correctly deny new check-in operations.

7. PUBLIC SCOREBOARD VERIFICATION
- `AnyoPublicScoreboardModal.tsx` was updated to include `CHECKED_IN` in the `nextPerf` derivation queue.
- `CHECKED_IN` is correctly treated as "On Deck" while retaining the existing visual treatment.

8. SERVER-AUTHORITY VERIFICATION
- No client-side direct state modifications were introduced. The check-in and call operations correctly utilize `mark_anyo_performer_checked_in` and `call_anyo_performer` RPC endpoints.
- The UI properly functions as a read-only observability layer over the server-authoritative state transitions.

9. REGRESSION SEARCH
- Searched codebase for all occurrences of "WAITING".
- Found references in Combat match queue states (`MatchQueueBoard.tsx`, `ScoringArbitrationQueue.tsx`). Properly identified that these are part of a separate domain (`QueueItemState`) and excluded them from this repair to prevent expanding the scope.
- Confirmed all Anyo-specific invalid `WAITING` references have been eradicated.

10. TEST MATRIX
| State | Check-In UI | Call UI | Expected |
| :--- | :--- | :--- | :--- |
| WAITING | ALLOW | HIDDEN/DENY | Await physical check-in |
| CHECKED_IN | ALREADY CHECKED IN | ALLOW IF NEXT ELIGIBLE | Correct |
| CALLED | DENY | DENY | Already called |
| PERFORMING | DENY | DENY | Already active |
| SCORING | DENY | DENY | Scoring |
| COMPLETED | DENY | DENY | Terminal |

- Next Eligible Requirement: Intact
- Court Mutex: Intact
- Read-Only Mode: Intact
- Finalized Guard: Intact

11. BUILD RESULT
- `npm run build` executed.
- Build Passed cleanly without errors.

12. REMAINING BLOCKERS
None.

13. FINAL GATE
🟢 GREEN — FRONTEND CHECK-IN LIFECYCLE COMPATIBILITY VERIFIED
