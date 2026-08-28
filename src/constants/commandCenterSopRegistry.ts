import { OperationalStationId } from '../types/commandCenter';
import { AppRole } from '../types/roles';

export type SopCategory =
  | 'PRE_OPENING'
  | 'NETWORK_TELEMETRY'
  | 'CONCURRENCY_LOCK'
  | 'SECURITY_AUTH'
  | 'OFFICIAL_STAFFING'
  | 'INCIDENT_EMERGENCY'
  | 'CLOSURE_SEAL';

export interface SopStep {
  stepNumber: number;
  title: string;
  instruction: string;
  warning?: string;
  expectedOutcome?: string;
}

export interface SopItem {
  id: string;
  code: string;
  title: string;
  category: SopCategory;
  stationIds: OperationalStationId[];
  relevantRoles: AppRole[];
  summary: string;
  errorCode?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  steps: SopStep[];
  warnings: string[];
  escalationAuthority: string;
  relatedRpcOrService?: string;
}

export const COMMAND_CENTER_SOPS: SopItem[] = [
  {
    id: 'sop-pre-01',
    code: 'SOP-PRE-01',
    title: 'Pre-Opening Tournament Readiness Checklist',
    category: 'PRE_OPENING',
    stationIds: ['DIRECTOR_HUB', 'TECH_AUDIT', 'COURT_OPERATIONS', 'REGISTRATION_WEIGHIN'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: '15-point mandatory operational verification sequence prior to admitting athletes and starting arena bouts.',
    severity: 'HIGH',
    warnings: [
      'Do NOT dispatch or start matches if any pre-opening checkpoint fails or remains unverified.',
      'Locked snapshot immutability (INV-03) must be strictly verified before bout dispatch.'
    ],
    escalationAuthority: 'Tournament Director / Technical Lead',
    relatedRpcOrService: 'tournamentService.getTournament / getActiveSnapshot',
    steps: [
      {
        stepNumber: 1,
        title: 'Verify Selected Tournament',
        instruction: 'Confirm the active tournament ID and official arena title in the top navigation bar match the scheduled event.',
        expectedOutcome: 'Tournament context displays correct event title.'
      },
      {
        stepNumber: 2,
        title: 'Verify Authoritative Tournament Context',
        instruction: 'Ensure the tournament status is ACTIVE or ONGOING in PostgreSQL, not DRAFT or ARCHIVED.',
        expectedOutcome: 'Status badge displays ACTIVE.'
      },
      {
        stepNumber: 3,
        title: 'Verify Locked Snapshot (INV-03)',
        instruction: 'Confirm the snapshot version badge shows SNAPSHOT ACTIVE and is_locked === true. Verify weight classes and rules are frozen.',
        expectedOutcome: 'Snapshot is locked and immutable.'
      },
      {
        stepNumber: 4,
        title: 'Verify Command Center Initialization',
        instruction: 'Open all 6 Command Center station tabs and confirm telemetry metrics initialize without console or network errors.',
        expectedOutcome: 'All 6 station consoles load successfully.'
      },
      {
        stepNumber: 5,
        title: 'Verify Network & Telemetry Pulse',
        instruction: 'Check the Operational Diagnostic Bar. Confirm status is LIVE TELEMETRY (green pulse) and lastSyncedAt is within 30 seconds.',
        expectedOutcome: 'Online network status with active heartbeat.'
      },
      {
        stepNumber: 6,
        title: 'Verify Operational Rings / Courts',
        instruction: 'Confirm all scheduled arena rings (e.g. Ring 1, Ring 2) appear as ACTIVE ring cards in Court Operations.',
        expectedOutcome: 'All active courts registered and visible.'
      },
      {
        stepNumber: 7,
        title: 'Verify Table Official Staffing',
        instruction: 'Verify that every active operational ring has at least one active TABLE_OFFICIAL assigned via Event Officials modal.',
        expectedOutcome: 'Zero official coverage alerts on active rings.'
      },
      {
        stepNumber: 8,
        title: 'Verify Athlete Check-In',
        instruction: 'Confirm in Registration / Weigh-In station that scheduled athletes are marked CHECKED_IN and eligible.',
        expectedOutcome: 'Roster status verified.'
      },
      {
        stepNumber: 9,
        title: 'Verify Weigh-In Completion',
        instruction: 'Verify weigh-in clearance passes for all weight-dependent Full Contact divisions in the scale master queue.',
        expectedOutcome: 'Zero unverified weigh-in disqualifications.'
      },
      {
        stepNumber: 10,
        title: 'Verify Approved Lineup Readiness',
        instruction: 'Ensure team club line-ups are approved and no eligibility protests are pending before bracket assignment.',
        expectedOutcome: 'Approved rosters ready for bouting.'
      },
      {
        stepNumber: 11,
        title: 'Verify Initial Match Queue',
        instruction: 'Inspect the On-Deck Queue. Confirm opening round matches are in READY status with valid red and blue athletes assigned.',
        expectedOutcome: 'Opening round feeder matches prepared.'
      },
      {
        stepNumber: 12,
        title: 'Verify Scoring Console Readiness',
        instruction: 'Confirm Table Officials can authenticate into their designated court scoring consoles (Full Contact / Anyo).',
        expectedOutcome: 'Scoring tables connected and ready.'
      },
      {
        stepNumber: 13,
        title: 'Verify Incident Recovery Availability',
        instruction: 'Confirm the Incident Recovery station is online and venue-wide emergency banner is currently clear.',
        expectedOutcome: 'Incident ledger ready to record logs.'
      },
      {
        stepNumber: 14,
        title: 'Verify Technical Reconciliation Readiness',
        instruction: 'Run preflight assignment reconciliation in Tech Audit Station to verify clean database foreign keys and zero orphaned records.',
        expectedOutcome: 'Zero orphaned assignment warnings.'
      },
      {
        stepNumber: 15,
        title: 'Verify Closure Authority Readiness',
        instruction: 'Confirm the Tournament Director, Chief Referee, and Head Table Official are identified for end-of-day SHA-256 sealing.',
        expectedOutcome: 'Three authorized signatories confirmed.'
      }
    ]
  },
  {
    id: 'sop-rt-01',
    code: 'SOP-RT-01',
    title: 'Network Interruption & Manual Refresh Procedure',
    category: 'NETWORK_TELEMETRY',
    stationIds: ['DIRECTOR_HUB', 'COURT_OPERATIONS', 'SCORING_DESK', 'TECH_AUDIT'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Standard operating procedure when network connectivity degrades or the Command Center enters a SYNCING/OFFLINE state.',
    severity: 'HIGH',
    warnings: [
      'Zero Offline Auto-Replay (INV-01): The system enforces synchronous server-side mutations. Mutation buttons disable automatically when disconnected.',
      'NEVER attempt to record unofficial paper scores without informing the Technical Lead and Tournament Director.'
    ],
    escalationAuthority: 'Technical Lead / Venue IT Coordinator',
    relatedRpcOrService: 'useNetworkStatus / courtOperationsService.fetchTournamentTelemetry',
    steps: [
      {
        stepNumber: 1,
        title: 'Identify Diagnostic State',
        instruction: 'Check the top diagnostic bar. If the status shifts to SYNCING (amber spinning icon) or OFFLINE (red WifiOff badge), network delivery has been interrupted.',
        expectedOutcome: 'Degraded network state recognized.'
      },
      {
        stepNumber: 2,
        title: 'Cease Local Mutation Attempts',
        instruction: 'Do not repeatedly click action buttons while offline. The application disables mutation triggers to prevent split-brain states.',
        expectedOutcome: 'Zero orphaned local actions.'
      },
      {
        stepNumber: 3,
        title: 'Inform Technical Lead',
        instruction: 'Notify the on-site Technical Lead if offline status persists for more than 30 seconds across multiple rings.',
        expectedOutcome: 'Technical Lead aware of venue connectivity issue.'
      },
      {
        stepNumber: 4,
        title: 'Await Reconnection Heartbeat',
        instruction: 'Allow the browser network stack to restore connection to Supabase. Reconnection will trigger an automatic background refetch.',
        expectedOutcome: 'Diagnostic bar shifts back toward green.'
      },
      {
        stepNumber: 5,
        title: 'Execute Authoritative Manual Refresh',
        instruction: 'Click the Refresh icon (RefreshCw) located on the Command Center header toolbar or station tab.',
        expectedOutcome: 'Synchronous read of PostgreSQL telemetry completes.'
      },
      {
        stepNumber: 6,
        title: 'Confirm Telemetry Synchronization',
        instruction: 'Verify that the Telemetry Sync timestamp updates to the current time and active bout states match the arena floor before resuming dispatch.',
        expectedOutcome: 'Fresh, authoritative state displayed.'
      }
    ]
  },
  {
    id: 'sop-rec-40902',
    code: 'SOP-REC-40902',
    title: 'Active-Bout Lock Recovery (SQLSTATE 40902)',
    category: 'CONCURRENCY_LOCK',
    stationIds: ['COURT_OPERATIONS', 'SCORING_DESK', 'DIRECTOR_HUB', 'TECH_AUDIT'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Recovery workflow when an action is blocked by the fail-closed active-bout safety barrier (SQLSTATE 40902 / BOUT_IN_PROGRESS_LOCK).',
    errorCode: '40902 (BOUT_IN_PROGRESS_LOCK)',
    severity: 'CRITICAL',
    warnings: [
      '40902 is a safety boundary, NOT an application defect. It prevents destructive race conditions and mid-bout staffing swaps.',
      'NEVER attempt to force or bypass an active-bout lock. The server transaction rolls back atomically with zero partial data mutations.'
    ],
    escalationAuthority: 'Court Operations Lead / Chief Referee',
    relatedRpcOrService: 'batch_rotate_officials / end_official_shift / assign_match_to_court',
    steps: [
      {
        stepNumber: 1,
        title: 'Identify Active Bout on Target Ring',
        instruction: 'Inspect the target court ring card. Confirm whether a match is currently in LIVE status with an ongoing round or judge scoring active.',
        expectedOutcome: 'Active match identified on ring card.'
      },
      {
        stepNumber: 2,
        title: 'Do Not Attempt Force Bypasses',
        instruction: 'Acknowledge the 40902 diagnostic modal. The database transaction has safely rolled back without corrupting table assignments.',
        expectedOutcome: 'Zero partial state mutations.'
      },
      {
        stepNumber: 3,
        title: 'Allow Bout Conclusion or Follow Emergency Protocol',
        instruction: 'Allow the ongoing bout to conclude normally with score finalization, OR if an emergency stoppage occurs, use the official Emergency Stoppage workflow in Incident Recovery.',
        expectedOutcome: 'Bout reaches COMPLETED or CANCELLED status.'
      },
      {
        stepNumber: 4,
        title: 'Verify Ring Reverts to Available / Vacant',
        instruction: 'Confirm the ring status transitions from LIVE to VACANT/IDLE on the court operations board.',
        expectedOutcome: 'Ring ready for subsequent operations.'
      },
      {
        stepNumber: 5,
        title: 'Safely Retry Blocked Mutation',
        instruction: 'Re-open the dispatch modal or shift rotation modal and execute the desired action. The operation will now succeed cleanly.',
        expectedOutcome: 'Operation completes successfully in database.'
      }
    ]
  },
  {
    id: 'sop-sec-01',
    code: 'SOP-SEC-01',
    title: 'Authorization Failure & Escalation Protocol',
    category: 'SECURITY_AUTH',
    stationIds: ['TECH_AUDIT', 'DIRECTOR_HUB', 'COURT_OPERATIONS', 'SCORING_DESK'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Standard escalation procedure when an operator encounters server-side authorization failures (40100, 40300, 42501).',
    errorCode: '40100 / 40300 / 42501',
    severity: 'HIGH',
    warnings: [
      'Client-side UI visibility does NOT grant database authority. All mutating actions are verified server-side via auth.uid() and public.user_roles.',
      'This SOP reference drawer CANNOT grant, escalate, or modify user permissions.'
    ],
    escalationAuthority: 'Super Administrator / System Governance Officer',
    relatedRpcOrService: 'roleService / SuperAdminRoleManagement',
    steps: [
      {
        stepNumber: 1,
        title: 'Diagnose Error Code',
        instruction: 'Identify the exact SQLSTATE code: 40100 (No active auth session), 40300 (Forbidden/Role missing), 42501 (Database RLS policy rejection).',
        expectedOutcome: 'Specific security boundary classified.'
      },
      {
        stepNumber: 2,
        title: 'Verify User Authentication Session',
        instruction: 'Check user profile badge in the header. If unauthenticated, click Sign In with Google to establish a valid Supabase JWT session.',
        expectedOutcome: 'Valid user UUID loaded.'
      },
      {
        stepNumber: 3,
        title: 'Verify Assigned System Role',
        instruction: 'Verify if the user has the required permanent role (SUPER_ADMIN, ADMIN, ORGANIZER, or COACH) in public.user_roles.',
        expectedOutcome: 'System role verified.'
      },
      {
        stepNumber: 4,
        title: 'Verify Court-Scoped Assignment (TABLE_OFFICIAL)',
        instruction: 'If a Table Official is blocked on a specific ring, verify in Tech Audit whether their active event_assignment matches that specific court ID (INV-05).',
        expectedOutcome: 'Court scoping alignment verified.'
      },
      {
        stepNumber: 5,
        title: 'Escalate to Super Administrator',
        instruction: 'If legitimate authority is missing, contact the Super Admin to grant appropriate roles via the SuperAdminRoleManagement panel.',
        expectedOutcome: 'Role granted in PostgreSQL database.'
      },
      {
        stepNumber: 6,
        title: 'Refresh Profile and Re-attempt',
        instruction: 'Click Refresh Profile in the user dropdown menu, then re-attempt the authorized action.',
        expectedOutcome: 'Action authorized and completed.'
      }
    ]
  },
  {
    id: 'sop-rot-01',
    code: 'SOP-ROT-01',
    title: 'Official Shift Rotation & Replacement Protocol',
    category: 'OFFICIAL_STAFFING',
    stationIds: ['COURT_OPERATIONS', 'TECH_AUDIT', 'DIRECTOR_HUB'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Procedures for scheduled table official shift rotations, mid-session replacements, and soft-closing staffing history.',
    severity: 'MEDIUM',
    warnings: [
      'Official rotations must NEVER be performed while a bout is LIVE (INV-08).',
      'Historical assignments in event_assignments must remain non-destructive (soft-close with revoked_at timestamp).'
    ],
    escalationAuthority: 'Court Operations Lead / Head Table Official',
    relatedRpcOrService: 'batch_rotate_officials / end_official_shift / EventOfficialAssignmentModal',
    steps: [
      {
        stepNumber: 1,
        title: 'Confirm Ring is Vacant (Not LIVE)',
        instruction: 'Check the ring telemetry card. Ensure no active match is currently being scored on that ring before initiating a rotation.',
        expectedOutcome: 'Ring confirmed in VACANT or ASSIGNED status.'
      },
      {
        stepNumber: 2,
        title: 'Open Officials & Shifts Management',
        instruction: 'Click the Officials & Shifts button in the Command Center header toolbar to open the rotation interface.',
        expectedOutcome: 'EventOfficialAssignmentModal displays active roster.'
      },
      {
        stepNumber: 3,
        title: 'Select Outgoing and Incoming Officials',
        instruction: 'Select the outgoing official to conclude and choose the certified replacement official from the available roster pool.',
        expectedOutcome: 'Rotation pair configured.'
      },
      {
        stepNumber: 4,
        title: 'Execute Batch Rotation RPC',
        instruction: 'Click Confirm Rotation. The batch_rotate_officials RPC atomically soft-closes the outgoing shift and grants court authority to the incoming official.',
        expectedOutcome: 'Atomic database swap completes.'
      },
      {
        stepNumber: 5,
        title: 'Verify Historical Shift Retention',
        instruction: 'Inspect the Shift History table in Tech Audit. Confirm the outgoing assignment recorded a valid revoked_at timestamp without record deletion.',
        expectedOutcome: 'Non-destructive shift history preserved (INV-09).'
      },
      {
        stepNumber: 6,
        title: 'Confirm Incoming Official Console Access',
        instruction: 'Have the incoming official verify that the live scoring console displays their designated ring assignment.',
        expectedOutcome: 'New official active on scoring table.'
      }
    ]
  },
  {
    id: 'sop-inc-01',
    code: 'SOP-INC-01',
    title: 'Incident Logging & Emergency Recovery Protocol',
    category: 'INCIDENT_EMERGENCY',
    stationIds: ['INCIDENT_RECOVERY', 'DIRECTOR_HUB', 'COURT_OPERATIONS', 'SCORING_DESK'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Standard operating procedures for logging medical timeouts, equipment failures, scoring protests, and venue outages in the immutable incident ledger.',
    severity: 'CRITICAL',
    warnings: [
      'All emergency actions and dispute resolutions must be logged with specific incident details in public.system_audit_logs.',
      'Do NOT clear venue alerts without an authoritative resolution record.'
    ],
    escalationAuthority: 'Tournament Director / Chief Medical Officer / Head Referee',
    relatedRpcOrService: 'log_tournament_incident / get_tournament_incident_logs / IncidentRecoveryQueue',
    steps: [
      {
        stepNumber: 1,
        title: 'Medical Timeout Protocol',
        instruction: 'Immediate Action: Referee pauses bout clock in accordance with referee authority. Attending Physician enters ring. Navigate to Incident Recovery -> Log Medical Timeout. Record athlete name, injury summary, and medical evaluation details in accordance with official UAAPHIL competition and medical clearance procedures.',
        warning: 'Match may only resume upon formal medical clearance by the Attending Physician and official referee authorization.',
        expectedOutcome: 'Medical incident logged in audit trail.'
      },
      {
        stepNumber: 2,
        title: 'Equipment Malfunction Protocol',
        instruction: 'Immediate Action: Pause bout. Log Equipment Failure incident in Incident Recovery. Mark ring as under maintenance if hardware must be replaced.',
        expectedOutcome: 'Gear replaced and scale/sensor verified.'
      },
      {
        stepNumber: 3,
        title: 'Scoring Dispute / Protest Protocol',
        instruction: 'Immediate Action: Official Coach files formal protest form within 15 minutes of bout conclusion. Open Scoring & Arbitration Queue -> Hold Bout in Arbitration. Convene Arbitration Committee.',
        expectedOutcome: 'Scorecards locked; formal arbitration ruling recorded.'
      },
      {
        stepNumber: 4,
        title: 'Venue Outage / Environmental Interruption',
        instruction: 'Immediate Action: Tournament Director triggers Venue-Wide Emergency Alert in Incident Recovery. All ring queues are automatically held. Announce pause to arena.',
        expectedOutcome: 'Venue emergency banner broadcast across all stations.'
      },
      {
        stepNumber: 5,
        title: 'Log Authoritative Resolution',
        instruction: 'When the incident is resolved, execute the official Emergency Resolution workflow in Incident Recovery with resolution notes.',
        expectedOutcome: 'Resolution recorded; ring operations resume safely.'
      }
    ]
  },
  {
    id: 'sop-cls-01',
    code: 'SOP-CLS-01',
    title: 'Tournament Closure & SHA-256 Seal Preflight',
    category: 'CLOSURE_SEAL',
    stationIds: ['DIRECTOR_HUB', 'TECH_AUDIT'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Preflight verification and irreversible finalization workflow to compute the cryptographic SHA-256 tournament seal and lock historical records.',
    severity: 'CRITICAL',
    warnings: [
      'Tournament finalization is PERMANENT and IRREVERSIBLE. Once sealed, no matches, scores, or rankings can be modified.',
      'All 6 preflight gates must evaluate to PASSED before the finalization button activates.'
    ],
    escalationAuthority: 'Tournament Director & UAAPHIL Executive Board',
    relatedRpcOrService: 'finalize_tournament / ensure_tournament_closure_seals / TournamentClosureModal',
    steps: [
      {
        stepNumber: 1,
        title: 'Gate 1: Verify Snapshot Locked',
        instruction: 'Confirm the tournament snapshot version is locked and immutable.',
        expectedOutcome: 'isLocked === true'
      },
      {
        stepNumber: 2,
        title: 'Gate 2: Zero Uncompleted Matches',
        instruction: 'Verify all scheduled bracket matches across all divisions are marked COMPLETED or BYE.',
        expectedOutcome: 'uncompletedMatches === 0'
      },
      {
        stepNumber: 3,
        title: 'Gate 3: Zero In-Progress / LIVE Bouts',
        instruction: 'Ensure zero active bouts remain on any ring floor.',
        expectedOutcome: 'inProgressMatches === 0'
      },
      {
        stepNumber: 4,
        title: 'Gate 4: Zero Unresolved Winners',
        instruction: 'Confirm every single concluded match has an authoritative winning athlete recorded.',
        expectedOutcome: 'unresolvedWinners === 0'
      },
      {
        stepNumber: 5,
        title: 'Gate 5: Zero Uncompleted Anyo Evaluations',
        instruction: 'Ensure all Anyo performance scorecards have all judge scores submitted and final rankings computed.',
        expectedOutcome: 'uncompletedAnyo === 0'
      },
      {
        stepNumber: 6,
        title: 'Gate 6: Zero Unresolved Weigh-Ins',
        instruction: 'Confirm all athlete weigh-in checks are closed and verified.',
        expectedOutcome: 'unresolvedWeighIns === 0'
      },
      {
        stepNumber: 7,
        title: 'Collect 3 Required Signatories',
        instruction: 'In TournamentClosureModal, enter the full names and titles of the 3 required official signatories: Tournament Director, Chief Referee, and Head Table Official.',
        expectedOutcome: 'Signatory names recorded.'
      },
      {
        stepNumber: 8,
        title: 'Execute Finalization & SHA-256 Sealing',
        instruction: 'Confirm irreversible closure checkbox and click Finalize & Seal Tournament. The finalize_tournament RPC computes the SHA-256 seal digest and marks the tournament COMPLETED.',
        expectedOutcome: 'Permanent cryptographic seal stored in public.tournament_closure_seals.'
      }
    ]
  },
  {
    id: 'tech-rec-01',
    code: 'TECH-REC-01',
    title: 'Realtime Connection Recovery & Manual Resubscription Guidance',
    category: 'NETWORK_TELEMETRY',
    stationIds: ['TECH_AUDIT', 'DIRECTOR_HUB', 'COURT_OPERATIONS'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Informational technical recovery guidance for recognizing degraded WebSocket connection states, preserving fail-closed behavior, and performing safe manual telemetry sync.',
    severity: 'HIGH',
    warnings: [
      'Do NOT create offline mutation queues or background retry loops (INV-01).',
      'Do NOT attempt to force-write stale client state into PostgreSQL (INV-02).',
      'Do NOT attempt to bypass server-side authorization or protected competition state (INV-04).'
    ],
    escalationAuthority: 'Technical Lead / UAAPHIL Platform Support',
    relatedRpcOrService: 'TechAuditStation.onRefreshTelemetry / courtOperationsService',
    steps: [
      {
        stepNumber: 1,
        title: 'Recognize Degraded Technical State',
        instruction: 'Observe the Supabase Realtime Channel card in Station 05 (Tech Audit) or the Operational Diagnostic Bar. Check if the status shows RECONNECTING or DISCONNECTED, or if the telemetry pulse is red/stale (>30s).',
        expectedOutcome: 'Degraded connection state identified without performing mutations.'
      },
      {
        stepNumber: 2,
        title: 'Confirm Current Diagnostic & Telemetry Indicators',
        instruction: 'Inspect the lastSyncedAt timestamp and active table subscriptions. Verify whether other stations on the venue LAN are experiencing similar WebSocket disconnection.',
        expectedOutcome: 'Diagnostic baseline recorded.'
      },
      {
        stepNumber: 3,
        title: 'Preserve Fail-Closed Operational Barrier (INV-01)',
        instruction: 'Ensure all scoring desks and court operators pause match action while disconnected. Do not attempt to trigger match starts, score updates, or bracket advancements while offline.',
        expectedOutcome: 'Zero offline data corruption; no unsynchronized state generated.'
      },
      {
        stepNumber: 4,
        title: 'Execute Safe Manual Telemetry & Log Sync',
        instruction: 'Click "Sync Telemetry & Logs" in the Tech Audit Station header. If the network interface is operational, this re-fetches authoritative audit logs and telemetry directly from PostgreSQL without mutating any state.',
        expectedOutcome: 'Authoritative telemetry reloaded if connection is restored.'
      },
      {
        stepNumber: 5,
        title: 'Context Refresh (If Required)',
        instruction: 'If the browser tab lost WebSocket synchronization due to device sleep or prolonged network drop, execute a clean browser refresh (F5 / Cmd+R). The application will re-authenticate with Google and re-establish the Supabase Realtime channel.',
        expectedOutcome: 'Fresh Realtime channel subscription initialized with server authority.'
      },
      {
        stepNumber: 6,
        title: 'Escalate Persistent Failures',
        instruction: 'If the Realtime channel remains DISCONNECTED for more than 2 minutes after manual refresh and local network verification, escalate immediately to the Technical Lead to inspect venue routing and backend availability.',
        expectedOutcome: 'Formal technical incident logged; ring operations paused in an orderly manner.'
      }
    ]
  },
  {
    id: 'tech-rec-02',
    code: 'TECH-REC-02',
    title: 'Connection Loss & Read-Only Health Diagnostic Procedure',
    category: 'NETWORK_TELEMETRY',
    stationIds: ['TECH_AUDIT', 'DIRECTOR_HUB'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Non-mutating diagnostic protocol to differentiate local client network interruptions from server/channel degradation while preserving fail-closed invariants.',
    severity: 'MEDIUM',
    warnings: [
      'Preserve INV-01 (Zero Offline Auto-Replay), INV-02 (PostgreSQL Single Source of Truth), and INV-04 (Strict Server-Side RBAC).',
      'Do NOT execute direct SQL commands or attempt database mutations outside authorized application workflows.'
    ],
    escalationAuthority: 'Technical Lead / Network Administrator',
    relatedRpcOrService: 'useNetworkStatus / courtOperationsService.fetchTournamentAuditLogs',
    steps: [
      {
        stepNumber: 1,
        title: 'Confirm Local Client Network Availability',
        instruction: 'Verify local physical Ethernet/Wi-Fi link status on the station device. Confirm whether external HTTPS endpoints and DNS resolution are functioning normally.',
        expectedOutcome: 'Local device network interface verified.'
      },
      {
        stepNumber: 2,
        title: 'Review Station 05 Telemetry Indicators',
        instruction: 'Review the Realtime Channel card, Snapshot Integrity card (INV-01/INV-03), and Security Boundary card (INV-04) in the Tech Audit Station.',
        expectedOutcome: 'Current client diagnostic status determined.'
      },
      {
        stepNumber: 3,
        title: 'Differentiate Client vs. Infrastructure Condition',
        instruction: 'Check if multiple court station devices are offline simultaneously. If only one device is offline, inspect device Wi-Fi/cable. If all devices show DISCONNECTED, inspect venue gateway and Supabase project status.',
        expectedOutcome: 'Scope of connection failure isolated (single-client vs. venue-wide).'
      },
      {
        stepNumber: 4,
        title: 'Inspect Read-Only System Audit Logs',
        instruction: 'Review the System Audit Trail at the bottom of Tech Audit Station to verify the last recorded server actions, error logs, or assignment rotations before disconnection.',
        expectedOutcome: 'Pre-failure state and audit continuity confirmed.'
      },
      {
        stepNumber: 5,
        title: 'Maintain Fail-Closed Ring Floor Safety',
        instruction: 'Confirm all court consoles have disabled action buttons. Verify table officials are not attempting manual scoring workarounds until connectivity is formally restored.',
        expectedOutcome: 'No phantom scores or conflicting match outcomes created.'
      },
      {
        stepNumber: 6,
        title: 'Escalate via Established Authority Chain',
        instruction: 'If connection loss persists beyond 3 minutes, notify the Tournament Director and Technical Lead to initiate venue contingency protocols.',
        expectedOutcome: 'Tournament leadership briefed with authoritative diagnostic findings.'
      }
    ]
  },
  {
    id: 'tech-rec-03',
    code: 'TECH-REC-03',
    title: 'Read-Only Diagnostic Interpretation & Escalation Guide',
    category: 'SECURITY_AUTH',
    stationIds: ['TECH_AUDIT', 'DIRECTOR_HUB'],
    relevantRoles: ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'],
    summary: 'Concise technical reference for interpreting actual application diagnostic states, mutation blocking rules, and escalation criteria.',
    severity: 'INFO',
    warnings: [
      'Diagnostic states are read-only indicators. Do not attempt client-side overrides to force disabled buttons active.',
      'Server-side RBAC and RLS policies are the sole authority for mutation permissions (INV-04).'
    ],
    escalationAuthority: 'Technical Lead / Super Admin',
    relatedRpcOrService: 'TechAuditStation / formatRpcError',
    steps: [
      {
        stepNumber: 1,
        title: 'Interpret CHANNEL_ACTIVE / LIVE TELEMETRY (Normal)',
        instruction: 'Indicator: Green pulsing badge, lastSyncedAt < 30s. Meaning: WebSocket connected; telemetry streams in real-time; mutations permitted for authorized roles. Action: Normal tournament operations proceed.',
        expectedOutcome: 'Normal operation confirmed.'
      },
      {
        stepNumber: 2,
        title: 'Interpret RECONNECTING (Transient Network Stutter)',
        instruction: 'Indicator: Amber badge, WebSocket reconnecting in background. Meaning: Temporary packet loss or handshake renegotiation. Action: Wait 5-10 seconds for automatic reconnect; do NOT submit duplicate clicks or rapid retries.',
        expectedOutcome: 'Connection safely recovers without duplicate requests.'
      },
      {
        stepNumber: 3,
        title: 'Interpret DISCONNECTED (Offline / Blocked)',
        instruction: 'Indicator: Red badge, action buttons disabled. Meaning: Network lost or backend unreachable; fail-closed active (INV-01). Action: Check local Wi-Fi/LAN, wait for link restoration, then use "Sync Telemetry & Logs" or browser refresh. Do not queue offline mutations.',
        expectedOutcome: 'Mutations safely blocked until connection verified.'
      },
      {
        stepNumber: 4,
        title: 'Interpret SQLSTATE 40902 (Active-Bout Lock Collision)',
        instruction: 'Indicator: Concurrency violation error on match activation. Meaning: Another bout is currently LIVE on the selected court (INV-08). Action: Navigate to Court Operations; verify current ring state; finish or reassign previous match before dispatching new bout.',
        expectedOutcome: 'Single live match per court invariant (INV-05/INV-08) preserved.'
      },
      {
        stepNumber: 5,
        title: 'Interpret SECURITY_DEFINER / 42501 / Unauthorized',
        instruction: 'Indicator: Permission denied error from PostgreSQL RLS or RPC. Meaning: User account lacks required system role (e.g. TABLE_OFFICIAL, ORGANIZER, SUPER_ADMIN) (INV-04). Action: Direct operator to Super Admin Role Management for role assignment; do NOT attempt frontend bypass.',
        expectedOutcome: 'RBAC boundary maintained; unauthorized action rejected.'
      },
      {
        stepNumber: 6,
        title: 'Interpret Shift Reconciliation Result (P7-03D)',
        instruction: 'Indicator: Deactivated lingering shift count displayed. Meaning: RPC reconcile_event_assignments cleanly deactivated orphan shifts from past events without touching active bouts. Action: Verify active court official count in Court Operations.',
        expectedOutcome: 'Clean official roster without active match disturbance.'
      }
    ]
  }
];
