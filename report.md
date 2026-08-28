P-ANYO-CHECKIN-UI-RUNTIME-FORENSIC-GATE-02

1. EXECUTIVE VERDICT
🔴 RED — RUNTIME BUG IDENTIFIED. The missing Check-In and Call Athlete controls are caused by a frontend property-passing defect (over-broad read-only mode). Player/Performance #3 disappears NOT due to a frontend defect, but because the test database is literally missing a record for `order_number: 3` (the array jumps from 2 to 4).

2. EXACT ROOT CAUSES
A. Missing Check-In Control: `CourtControlDashboard` assigns `isReadOnly={!canRecordScores}`. Court Managers lack `canRecordScores` (they only have `isOfficialAuthorized`), placing them in blanket read-only mode in `AnyoScoringConsole`. This hides the operational Check-In control despite the backend RPC specifically authorizing Court Managers.
B. Player #3 Disappearance: The Supabase query accurately returns exactly what is in the `anyo_performances` table (`order_number`s 1, 2, and 4). Player #3 is completely absent from the database. It is NOT removed by any frontend `.filter()` or `.map()` logic.
C. Realtime/Cache: `useAnyoRealtimeSync` accurately refreshes the query array. Updates to existing performances are processed via array reconciliation and do not delete performers.

3. PLAYER #3 TRACE
Database -> `anyoScoringService.getSessionPerformances` -> React state `performances`.
The database response was introspected: `[ { order_number: 1 }, { order_number: 2 }, { order_number: 4 } ]`.
Since the array renders `#{perf.order_number}`, it renders `#1`, `#2`, and `#4`. Player #3 never arrives from Supabase because it does not exist in the database. Classification: SERVICE/QUERY OR TEST DATA ARTIFACT (Not a frontend bug).

4. CHECK-IN BUTTON TRACE
File: `src/components/competition/anyo/AnyoStagedPerformerWorkspace.tsx`
Condition: `!isCheckedIn && performance.status === 'WAITING' && !isReadOnly`
Defect: `isReadOnly` is driven strictly by `!canRecordScores` (Table Official status). Court Managers correctly lack this flag, making `isReadOnly=true` and hiding the button.

5. CHECKED_IN STATE TRACE
Checked-in state correctly renders via `isPerformanceCheckedIn` and the authoritative state `performance.status === 'CHECKED_IN'`.

6. REALTIME/CACHE FINDINGS
`useAnyoRealtimeSync` properly issues `onRefresh()` resulting in an explicit `GET` to the database, which avoids local state race conditions.

7. EXACT FILES REQUIRING CHANGES
- `src/components/competition/CourtControlDashboard.tsx`
- `src/components/competition/AnyoScoringConsole.tsx`

8. MINIMAL FIX PLAN
A. Update `CourtControlDashboard.tsx` to pass `isOperationsReadOnly={!isOfficialAuthorized}` to `AnyoScoringConsole`.
B. Update `AnyoScoringConsoleProps` to accept `isOperationsReadOnly`.
C. In `AnyoScoringConsole.tsx`, derive `const operationsReadOnly = isOperationsReadOnly ?? isReadOnly`.
D. Update `handleCheckIn`, `handleCallPerformer`, and the `canCallActive` derivation to check `!operationsReadOnly`.
E. Pass `isReadOnly={operationsReadOnly}` into `AnyoStagedPerformerWorkspace`.
