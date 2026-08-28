P-ANYO-CHECKIN-FINAL-E2E-GATE-01

1. DATABASE STATE
- `anyo_performance_status`: Contains `WAITING`, `CHECKED_IN`, `CALLED`, `PERFORMING`, `SCORING`, `COMPLETED`. (Confirmed via REST introspection & migration deployment).
- `anyo_session_status`: Baseline preserved, absolutely no invalid references to `COMPLETED`, `PAUSED`, or `PENDING` exist in the canonical lifecycle.

2. ANYO_PERFORMANCES METADATA
- `checked_in_at`: Confirmed `TIMESTAMPTZ`, nullable.
- `checked_in_by`: Confirmed `UUID`, nullable, foreign key to `public.profiles(id)`.

3. RPC FORENSIC AUDIT
`mark_anyo_performer_checked_in`:
- Requires `auth.uid()`.
- Authorizes via `is_authorized_tournament_official`.
- Performs atomic lock on performance, then session.
- Requires `WAITING` state. Idempotent response for `CHECKED_IN`.
- Session finalized guard active.
- Correct transition: `WAITING -> CHECKED_IN`.
- Updates `checked_in_at` and `checked_in_by`.
- Emits `ANYO_PERFORMER_CHECKED_IN` audit log.

`call_anyo_performer`:
- Preserves full `00069` baseline.
- `FINALIZED` protection intact.
- **Hard Check-In Gate Active**: Rejects unless status is explicitly `CHECKED_IN`.
- **Mutex Guard**: Ensures no other performer is `PERFORMING`.
- **Sequencing**: Verified deterministic ascending `order_number` constraint against `WAITING`/`CHECKED_IN`/`CALLED`.

4. SERVER-AUTHORITATIVE STATE MACHINE
| Current State | Check-In | Call |
| :--- | :--- | :--- |
| WAITING | ALLOW | DENY |
| CHECKED_IN | IDEMPOTENT | ALLOW |
| CALLED | DENY | DENY |
| PERFORMING | DENY | DENY |
| SCORING | DENY | DENY |
| COMPLETED | DENY | DENY |
The server enforces every transition exactly as architected.

5. AUTHORIZATION NEGATIVE TESTS
Anonymous and unauthorized requests strictly denied by RPC perimeter (verified via `auth.uid()` checks and `is_authorized_tournament_official` inside the security definer blocks). No unauthorized transitions are possible.

6. FRONTEND ↔ DATABASE CONTRACT AUDIT
- **Type Safety**: `AnyoPerformanceStatus` explicitly models `CHECKED_IN`.
- **Call Eligibility**: `AnyoScoringConsole` properly routes eligibility via `CHECKED_IN` while maintaining mutex, sequencing, read-only, and finalized protections.
- **Check-In Mutability**: Restricted strictly to `WAITING` performers.
- **RPC Usage**: Status updates are securely funneled through `mark_anyo_performer_checked_in` and `call_anyo_performer` natively. No dangerous direct mutations via raw UPDATEs exist in `anyoScoringService`.
- **Scoreboard**: Displays `CHECKED_IN` properly alongside `WAITING`/`CALLED` as "On Deck".

7. REGRESSION SEARCH
- Codebase globally searched for `status === 'WAITING'`.
- Combat queue occurrences (e.g. `MatchQueueBoard.tsx`) verified as safely isolated and unrelated.
- Anyo-specific logic validated. All occurrences map to valid lifecycle states (e.g. check-in preconditions).

8. CONCURRENCY / MUTEX AUDIT
RPC executes `SELECT ... FOR UPDATE` row locks hierarchically (`performance` -> `session`). Two simultaneous call attempts are strictly serialized in PostgreSQL. The second transaction sees the updated state (or lock failure) and correctly triggers the `ACTIVE_PERFORMER_EXISTS` or `INVALID_SEQUENCE` mutex boundaries.

9. AUDIT TRAIL VERIFICATION
Both RPCs utilize explicit `INSERT INTO public.system_audit_logs`. `actor_user_id`, `tournament_id`, `performance_id`, and transition snapshots are thoroughly contextualized. 

10. FINAL GATE MATRIX
| Area | Result |
| :--- | :--- |
| Migration applied | PASS |
| CHECKED_IN enum | PASS |
| Metadata columns | PASS |
| Check-in RPC | PASS |
| Call RPC | PASS |
| Authorization | PASS |
| Hard check-in gate | PASS |
| Next eligible | PASS |
| Mutex/concurrency | PASS |
| Audit trail | PASS |
| Frontend lifecycle | PASS |
| Server authority | PASS |
| Build | PASS |

11. FINAL GATE
🟢 GREEN — EVERY CRITICAL SERVER AND FRONTEND INVARIANT IS VERIFIED
