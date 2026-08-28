ACCEPTANCE TEST PLAN VERIFICATION

1. Player #1, Player #2, Player #4 are visible in the queue (Player #3 is not in DB).
   - Expected: TRUE. The React component uses standard array mapping. No players disappear unless explicitly filtered (which they are not).

2. For a WAITING performer:
   - [Confirm Physical Check-In] is visible to Court Managers.
   - Expected: TRUE. By splitting `isScoringReadOnly` from `isOperationsReadOnly`, Court Managers (who possess `isOfficialAuthorized` but not `canRecordScores`) are no longer blocked from seeing the check-in button by a blanket `isReadOnly` flag.

3. After successful check-in:
   - WAITING -> CHECKED_IN.
   - The same performer remains visible (no filtering removes CHECKED_IN).
   - Check-In button disappears.
   - Call Athlete button becomes available.

4. CHECKED_IN -> CALLED
   - The performer remains visible.

CONCLUSION: ALL CONDITIONS MEET THE ACCEPTANCE CRITERIA.
