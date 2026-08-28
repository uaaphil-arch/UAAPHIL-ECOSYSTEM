import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

export async function generateManualPdf(): Promise<{
  filePath: string;
  size: number;
  pageCount: number;
}> {
  const publicDir = path.resolve('public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const outputPath = path.join(publicDir, 'UAAPHIL_Tournament_System_Operations_Manual.pdf');

  return new Promise((resolve, reject) => {
    // Total predetermined pages = 11 (Cover + 10 content pages)
    const TOTAL_PAGES = 11;
    let currentPage = 0;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 32, bottom: 15, left: 40, right: 40 },
      autoFirstPage: false,
    });

    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    // Color Palette
    const NAVY = '#0f172a';
    const BLUE = '#1d4ed8';
    const SLATE_DARK = '#1e293b';
    const TEXT_MUTED = '#475569';
    const BORDER_COLOR = '#cbd5e1';

    // Helpers
    function newSectionPage(title: string, sub?: string) {
      currentPage++;
      doc.addPage();

      // Header bar
      doc.rect(40, 28, 515, 3).fill(BLUE);
      doc.fillColor(NAVY).fontSize(12.5).font('Helvetica-Bold').text(title, 40, 36, { width: 515, lineBreak: false });
      if (sub) {
        doc.fillColor(TEXT_MUTED).fontSize(8).font('Helvetica').text(sub, 40, 50, { width: 515, lineBreak: false });
      }
      doc.y = sub ? 64 : 52;
    }

    function renderFooter() {
      doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica')
        .text(`UAAPHIL Tournament System — Operations Manual v1.0   |   Page ${currentPage} of ${TOTAL_PAGES}`, 40, 805, {
          width: 515,
          align: 'center',
          lineBreak: false,
        });
    }

    function sectionTitle(title: string) {
      doc.moveDown(0.4);
      doc.fillColor(BLUE).fontSize(9.5).font('Helvetica-Bold').text(title, 40, doc.y, { width: 515, lineBreak: false });
      doc.rect(40, doc.y + 2, 515, 0.75).fill(BORDER_COLOR);
      doc.y += 5;
    }

    function paragraph(text: string) {
      doc.fillColor(SLATE_DARK).fontSize(7.8).font('Helvetica').lineGap(1.2).text(text, 40, doc.y, { width: 515 });
      doc.y += 2.5;
    }

    function bullet(label: string, desc: string) {
      doc.fillColor(NAVY).fontSize(7.8).font('Helvetica-Bold').text(`•  ${label}: `, 40, doc.y, { continued: true });
      doc.fillColor(SLATE_DARK).font('Helvetica').text(desc, { width: 515 });
      doc.y += 2;
    }

    function calloutBox(title: string, content: string, type: 'info' | 'warning' | 'success' = 'info') {
      const bg = type === 'warning' ? '#fffbeb' : type === 'success' ? '#f0fdf4' : '#eff6ff';
      const border = type === 'warning' ? '#d97706' : type === 'success' ? '#16a34a' : '#2563eb';
      const titleColor = type === 'warning' ? '#92400e' : type === 'success' ? '#166534' : '#1e40af';

      const boxY = doc.y + 2;
      doc.rect(40, boxY, 515, 34).fill(bg);
      doc.rect(40, boxY, 3.5, 34).fill(border);

      doc.fillColor(titleColor).fontSize(7.8).font('Helvetica-Bold').text(title, 48, boxY + 4, { width: 495, lineBreak: false });
      doc.fillColor(SLATE_DARK).fontSize(7.2).font('Helvetica').lineGap(1.1).text(content, 48, boxY + 14, { width: 495 });
      doc.y = boxY + 38;
    }

    function drawTable(headers: string[], rows: string[][], widths: number[]) {
      const startX = 40;
      let curY = doc.y + 3;
      const totalWidth = widths.reduce((a, b) => a + b, 0);

      // Header
      doc.rect(startX, curY, totalWidth, 13).fill(NAVY);
      let colX = startX;
      headers.forEach((h, i) => {
        doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text(h, colX + 3, curY + 3, { width: widths[i] - 6, lineBreak: false });
        colX += widths[i];
      });
      curY += 13;

      // Rows
      rows.forEach((row, rIdx) => {
        const rowBg = rIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(startX, curY, totalWidth, 12).fill(rowBg);
        colX = startX;
        row.forEach((cell, cIdx) => {
          doc.fillColor(SLATE_DARK).fontSize(6.8).font('Helvetica').text(cell, colX + 3, curY + 2.5, { width: widths[cIdx] - 6, lineBreak: false });
          colX += widths[cIdx];
        });
        curY += 12;
      });

      doc.y = curY + 3;
    }

    // ==========================================
    // PAGE 1: COVER PAGE
    // ==========================================
    currentPage = 1;
    doc.addPage();
    doc.rect(0, 0, 595, 842).fill('#0b132b');
    doc.rect(35, 35, 525, 772).stroke('#1c2d5a');

    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('UAAPHIL TOURNAMENT SYSTEM', 55, 140);
    doc.fillColor('#60a5fa').fontSize(13).font('Helvetica-Bold').text('OFFICIAL OPERATIONS & WORKFLOW MANUAL', 55, 170);
    doc.fillColor('#94a3b8').fontSize(8.5).font('Helvetica').text('Comprehensive Operator Blueprint, Security Architecture & Operational Procedures', 55, 188);

    doc.rect(55, 215, 485, 2).fill('#3b82f6');

    doc.fillColor('#e2e8f0').fontSize(9.5).font('Helvetica-Bold').text('GOVERNED OPERATIONAL ROLES & DOMAINS:', 55, 245);
    const coverRoles = [
      '• SUPER ADMIN: System configuration, Super Admin bootstrap & global RBAC control',
      '• ORGANIZER: Tournament creation, snapshot lifecycle, event & court operations',
      '• COACH: Club roster management, player lineups & reserve substitutions',
      '• COURT MANAGER: Arena match queue dispatch, court scheduling & station controls',
      '• TABLE OFFICIAL: Live match scoring, round confirmations & result finalization',
      '• ATHLETE / PLAYER: Public bracket views, match schedules & weigh-in verification',
    ];
    let ry = 265;
    coverRoles.forEach(r => {
      doc.fillColor('#cbd5e1').fontSize(8).font('Helvetica').text(r, 65, ry);
      ry += 15;
    });

    doc.rect(55, 385, 485, 95).fill('#132042');
    doc.rect(55, 385, 3.5, 95).fill('#38bdf8');
    doc.fillColor('#38bdf8').fontSize(8.5).font('Helvetica-Bold').text('DOCUMENT CONTROL & GOVERNANCE COMPLIANCE', 65, 395);
    doc.fillColor('#e2e8f0').fontSize(7.5).font('Helvetica').lineGap(1.5)
      .text('Document Version: 1.0 (Official Release)\n' +
            'Date of Publication: August 20, 2026\n' +
            'Authority: AI Development Constitution & Reconciled Migrations P01-P36\n' +
            'Source Baseline: Verified Production Code, PostgreSQL Engine Schemas & RLS Invariants\n' +
            'Status: Authoritative Operator Manual (Zero Code Modifications)', 65, 410, { width: 465 });

    doc.fillColor('#64748b').fontSize(7.5).font('Helvetica')
      .text('NOTICE: This manual documents the verified current implementation. It must be updated whenever a governed system change modifies an operational workflow.', 55, 750, { width: 485, align: 'center' });

    // ==========================================
    // PAGE 2: PART 1 & 2 (SYSTEM OVERVIEW & RBAC)
    // ==========================================
    newSectionPage('PART 1 & 2 — SYSTEM OVERVIEW & RBAC ARCHITECTURE', 'Foundational Principles, Subsystem Topology & Two-Tier Authorization');

    sectionTitle('1. System Purpose & Modular Topology');
    paragraph('The UAAPHIL Tournament System is an enterprise tournament operations platform specifically designed for Arnis and martial arts competitions. It automates tournament lifecycle states, deterministic bracketing, live arena dispatching, real-time scoring, and aggregate medal rankings while enforcing strict data integrity.');
    bullet('Competition Configuration', 'Defines standard global rules, scoring parameters, and weight division templates.');
    bullet('Tournament Snapshot Engine', 'Freezes competition rules into an immutable Snapshot Version 1 upon tournament initialization.');
    bullet('Club & Coach Rosters', 'Maintains club affiliations and enforces coach-only registration for verified player members.');
    bullet('Court Dispatch & Live Scoring', 'Dispatches matches to arena stations with strict database concurrency controls.');

    sectionTitle('2. Two-Tier Role-Based Access Control (RBAC)');
    paragraph('The system enforces a dual-tier authorization model: Tier 1 covers Global System Roles (public.user_roles) and Tier 2 covers Event Operational Roles (public.event_assignments).');
    drawTable(
      ['Role', 'Tier', 'Authoritative Source', 'Permitted Operational Scope'],
      [
        ['SUPER_ADMIN', 'Global', 'public.user_roles', 'Full platform control, global role assignments, system health override.'],
        ['ADMIN', 'Global', 'public.user_roles', 'General administration, tournament auditing & oversight.'],
        ['ORGANIZER', 'Global/Tourn', 'public.user_roles / owner', 'Tournament provisioning, event definition, court setup, lifecycle transitions.'],
        ['COACH', 'Club-Scoped', 'public.club_coaches', 'Club roster management, player event lineups & reserve submissions.'],
        ['COURT_MGR', 'Event-Scoped', 'public.event_assignments', 'Match queue dispatch, station launch, court scheduling for assigned event.'],
        ['TABLE_OFFICIAL', 'Court-Scoped', 'public.event_assignments', 'Live digital scorecard operation, round scoring & outcome confirmations.'],
      ],
      [80, 55, 120, 260]
    );

    calloutBox('SECURITY ENFORCEMENT PRINCIPLE', 
      'UI button states are convenience indicators. Every privileged action is strictly validated server-side within PostgreSQL SECURITY DEFINER RPCs and RLS policies.', 'info');
    renderFooter();

    // ==========================================
    // PAGE 3: PART 3 & 4 (AUTHENTICATION & TOURNAMENT CREATION)
    // ==========================================
    newSectionPage('PART 3 & 4 — AUTHENTICATION & TOURNAMENT CREATION', 'Session Security, Account Governance & Tournament Provisioning');

    sectionTitle('3. Authentication & Session Governance');
    bullet('1. User Login & Token Verification', 'Authenticates against Supabase Auth; validates cryptographic JWT on every request.');
    bullet('2. Profile & Role Hydration', 'Hydrates user profiles and loads active roles from user_roles and event_assignments.');
    bullet('3. Account Status Gating', 'Profiles with status INACTIVE, SUSPENDED, or DEACTIVATED are blocked at RPC entry (ERRCODE 40300).');
    bullet('4. Search-Path Security', 'All database procedures explicitly declare SET search_path = public, auth, pg_temp.');

    sectionTitle('4. Tournament Creation Procedure');
    bullet('Step 1: Open Console', 'Navigate to Tournament Management Console and click "+ New Tournament".');
    bullet('Step 2: Enter Metadata', 'Input Title, Venue, Start Date, End Date, and Primary Discipline/Rule Package.');
    bullet('Step 3: Provision Tournament', 'Click "Create Tournament". The system executes RPC create_tournament_with_snapshot.');
    bullet('Step 4: Verify Initial State', 'Ensure the tournament status is initialized to DRAFT and Snapshot Version 1 is generated.');

    calloutBox('TOURNAMENT SNAPSHOT RULE', 
      'Snapshot Version 1 captures all selected categories and rules at creation time. Subsequent edits to global competition settings will never alter or corrupt existing tournament snapshots.', 'success');
    renderFooter();

    // ==========================================
    // PAGE 4: PART 5, 6 & 7 (SNAPSHOTS, EVENTS & COURTS)
    // ==========================================
    newSectionPage('PART 5, 6 & 7 — SNAPSHOTS, EVENTS & COURTS', 'Configuration Freeze, Division Setup & Arena Provisioning');

    sectionTitle('5. Snapshot Integrity & Freezing');
    paragraph('The tournament snapshot is the single source of truth for the entire competition lifecycle. Athlete registrations, bracket seeding, and official match scorecards all query the frozen snapshot rather than live global templates.');

    sectionTitle('6. Event Configuration & UI Clarification');
    bullet('Step 1: Open Event Config', 'Click "Configure Events" on the tournament card to open the event configuration modal.');
    bullet('Step 2: Define Divisions', 'Select Category (Anyo / Combat), Gender, Division, and Weight Class, then save.');
    bullet('Step 3: Verify Counter', 'Confirm the button updates from "Configure Events (0)" to "Configure Events (N)".');

    calloutBox('OPERATOR CLARIFICATION: "Configure Events (0)"', 
      'The label "Configure Events (0)" indicates that zero events are currently configured. It does NOT mean the button is disabled. Clicking the button opens the configuration panel to add events.', 'warning');

    sectionTitle('7. Tournament Courts Provisioning');
    bullet('Minimum Court Invariant', 'At least 1 active court is required to lock registrations and begin the tournament.');
    bullet('Adding Arena Courts', 'Under "Tournament Courts", input Court Name (e.g. Court 1) and Identifier (e.g. C1), then click "Add Court".');
    bullet('Court Availability', 'Courts default to is_active = TRUE. Inactive courts cannot receive match dispatches.');
    renderFooter();

    // ==========================================
    // PAGE 5: PART 8 & 9 (ORGANIZER & COACH WORKFLOWS)
    // ==========================================
    newSectionPage('PART 8 & 9 — ORGANIZER & COACH WORKFLOWS', 'Step-by-Step Execution Protocols for Organizers and Coaches');

    sectionTitle('8. Complete Organizer Operational Protocol');
    paragraph('1. Provision Tournament  ->  2. Verify Snapshot V1  ->  3. Configure Events (N >= 1)  ->  4. Add Courts (N >= 1)  ->  5. Assign Event Officials  ->  6. Open Registrations  ->  7. Monitor Rosters  ->  8. Close Registrations  ->  9. Generate Brackets  ->  10. Lock & Start Tournament.');

    sectionTitle('9. Coach Team Registration Protocol');
    bullet('Step 1: Access Team Portal', 'Log in with COACH role and navigate to the affiliated Club Management view.');
    bullet('Step 2: Browse Tournament Events', 'Select active tournament and choose a configured division event.');
    bullet('Step 3: Designate LINEUP Athletes', 'Select eligible active PLAYER members for primary bracket seeding.');
    bullet('Step 4: Designate RESERVE Athletes', 'Select standby athletes eligible for pre-competition substitution.');
    bullet('Step 5: Submit Lineup', 'Dispatches RPC coach_set_event_lineup. Validates club authority and disjoint arrays.');
    bullet('Step 6: Pre-Lock Substitution', 'Coaches may execute swap_event_lineup_reserve before the tournament transitions to ONGOING.');

    calloutBox('COACH ROSTER BOUNDARY', 
      'Coaches can only register athletes with an active PLAYER role and an approved membership in their authorized club. Direct API requests attempting to register external athletes are rejected server-side.', 'info');
    renderFooter();

    // ==========================================
    // PAGE 6: PART 10 & 11 (ATHLETE ROSTERS & COURT OPS)
    // ==========================================
    newSectionPage('PART 10 & 11 — ATHLETE ROSTERS & COURT OPS', 'Player Governance, Arena Dispatching & Station Invariants');

    sectionTitle('10. Athlete Roster Governance');
    bullet('Account Integrity', 'Athletes must hold an active profile and PLAYER role in public.user_roles.');
    bullet('Club Membership', 'Athletes must have an approved membership in public.club_memberships for the coach\'s club.');
    bullet('Unique Registration Invariant', 'An athlete can only hold one registration record per event (UNIQUE(event_id, user_id)).');

    sectionTitle('11. Court Manager Dispatch Operations');
    bullet('1. Open Court Center', 'Navigate to Court Operations Center for the assigned event.');
    bullet('2. Inspect Match Queue', 'View scheduled matches organized by round and bracket progression.');
    bullet('3. Dispatch to Court', 'Assign ready match to active court station (locks court and match rows FOR UPDATE).');
    bullet('4. Launch Live Match', 'Transition match to LIVE. The database asserts that exactly 0 other matches are live on that court.');

    calloutBox('CRITICAL INVARIANT: ONE LIVE MATCH PER COURT', 
      'The database strictly prevents multiple matches from being LIVE on the same court simultaneously. Attempts to launch a second live match are blocked with SQL exception 23505 (CONFLICT).', 'warning');
    renderFooter();

    // ==========================================
    // PAGE 7: PART 12, 13 & 14 (SCORING, BRACKETING & SCHEDULING)
    // ==========================================
    newSectionPage('PART 12, 13 & 14 — SCORING, BRACKETING & SCHEDULING', 'Digital Scorecards, Bracket Engines & Queue Management');

    sectionTitle('12. Table Official Live Scoring');
    bullet('Station Authentication', 'Log in at assigned court (requires active event_assignment on court_id).');
    bullet('Score Entry', 'Record Anyo criteria (Technical, Artistic, Synchronization) or Combat points/penalties in real time.');
    bullet('Result Finalization', 'Execute finalize_match_score, recording winner_registration_id and advancing bracket.');

    sectionTitle('13. Bracket Generation Engine');
    bullet('Seeding Invariant', 'Exclusively seeds approved LINEUP registrations; RESERVE and WITHDRAWN entries are excluded.');
    bullet('Power-of-2 Sizing', 'Automatically expands bracket sizes (2, 4, 8, 16, 32, 64) with deterministic BYE distribution.');
    bullet('Bronze Match Automation', 'Automatically creates 3rd-place consolation matches when configured in tournament rules.');

    sectionTitle('14. Match Queue & Scheduling Controls');
    paragraph('Matches follow an orderly progression: PENDING  ->  CALLING  ->  WARMUP  ->  READY  ->  LIVE  ->  COMPLETED. Non-live matches can be reassigned between courts; completed matches are permanently immutable.');
    renderFooter();

    // ==========================================
    // PAGE 8: PART 15, 16 & 17 (LIFECYCLE, REPORTS & MEDALS)
    // ==========================================
    newSectionPage('PART 15, 16 & 17 — LIFECYCLE, REPORTS & MEDALS', 'State Transitions, Automated Tally & Certified Documentation');

    sectionTitle('15 & 16. Master Tournament Lifecycle');
    paragraph('DRAFT  ->  REGISTRATION_OPEN  ->  REGISTRATION_CLOSED  ->  BRACKET_GENERATION  ->  READY  ->  ONGOING  ->  COMPLETED  ->  ARCHIVED');
    drawTable(
      ['Lifecycle State', 'Permitted Operations', 'Restricted Operations', 'Responsible Role'],
      [
        ['DRAFT', 'Configure events, courts, snapshot rules', 'Athlete registration, bracket generation', 'Organizer, Admin'],
        ['REGISTRATION_OPEN', 'Coach roster lineup & reserve submission', 'Bracket generation, match dispatch', 'Coaches, Organizer'],
        ['REGISTRATION_CLOSED', 'Weigh-in verification, roster reviews', 'New athlete registrations', 'Organizer, Admin'],
        ['BRACKET_GENERATION', 'Generate & preview event brackets', 'Lineup changes, live scoring', 'Organizer'],
        ['READY / ONGOING', 'Court dispatch, live scoring, scoreboard', 'Roster modifications, bracket rebuilds', 'Court Mgr, Table Official'],
        ['COMPLETED / ARCHIVED', 'View medal tally, print certificates', 'Match modifications, score edits', 'Organizer, All Users'],
      ],
      [85, 140, 155, 135]
    );

    sectionTitle('17. Reports, Medal Tally & Certificates');
    bullet('Aggregate Medal Tally', 'Automated Gold, Silver, and Bronze calculations grouped by club and division.');
    bullet('Weigh-In Verification', 'Printable physical weigh-in sheets with official signature lines and tolerance checks.');
    bullet('Official Certificates', 'Automated generation of Participation, Podium Placement, and Officiating Certificates.');
    renderFooter();

    // ==========================================
    // PAGE 9: PART 18, 19 & 20 (POST-TOURNAMENT & TROUBLESHOOTING)
    // ==========================================
    newSectionPage('PART 18, 19 & 20 — POST-TOURNAMENT & TROUBLESHOOTING', 'Archival Integrity, Security Ledgers & Operator Diagnostic Trees');

    sectionTitle('18 & 19. Archival Integrity & Security Ledgers');
    bullet('Append-Only Audit Logs', 'All administrative and scoring actions are recorded in public.system_audit_logs.');
    bullet('Data Immutability', 'Completed tournaments are locked against retroactive modifications.');

    sectionTitle('20. Operator Troubleshooting Diagnostic Tree');
    bullet('Symptom: "Configure Events (0) looks disabled"', 'Action: Click button to open Event Configuration Modal and add events.');
    bullet('Symptom: "Open Registrations is disabled"', 'Action: Ensure at least one (1) event is configured under the snapshot.');
    bullet('Symptom: "Cannot Lock and Begin Tournament"', 'Action: Ensure at least one (1) active court exists in Tournament Courts.');
    bullet('Symptom: "Coach cannot see athlete in list"', 'Action: Verify athlete holds PLAYER role and an ACTIVE club membership.');
    bullet('Symptom: "Match cannot go LIVE"', 'Action: Verify court is active and no other match is currently LIVE on that court.');
    renderFooter();

    // ==========================================
    // PAGE 10: PART 21, 22 & 23 (OPERATIONAL CHECKLISTS)
    // ==========================================
    newSectionPage('PART 21, 22 & 23 — OPERATIONAL CHECKLISTS', 'Printable Pre-Tournament, Live Arena & Closeout Verification Lists');

    sectionTitle('21. Pre-Tournament Readiness Checklist');
    paragraph('[  ] Tournament created and Snapshot Version 1 verified.\n' +
              '[  ] Competition disciplines, divisions, and weight classes configured.\n' +
              '[  ] At least one (1) competition event created under snapshot.\n' +
              '[  ] At least one (1) active court configured with unique identifier.\n' +
              '[  ] Court Managers and Table Officials assigned to respective events and courts.\n' +
              '[  ] Coach rosters reviewed and athlete memberships confirmed ACTIVE.\n' +
              '[  ] Registrations closed and athlete weigh-in weights verified.\n' +
              '[  ] Brackets generated, verified for BYE symmetry, and locked.');

    sectionTitle('22. Live Arena Operations Checklist');
    paragraph('[  ] Court stations online with digital scoreboards calibrated.\n' +
              '[  ] Match queue loaded with verified corner assignments (Red/Blue).\n' +
              '[  ] Table officials logged in at respective assigned courts.\n' +
              '[  ] Single live match invariant maintained across all active courts.\n' +
              '[  ] Scores confirmed and submitted upon completion of each contest.');

    sectionTitle('23. Post-Tournament Closeout Checklist');
    paragraph('[  ] All event brackets verified 100% completed.\n' +
              '[  ] Official medal tally verified and published.\n' +
              '[  ] Match scores and judge logs archived in audit ledger.\n' +
              '[  ] Official certificates generated and distributed.\n' +
              '[  ] Tournament transitioned to COMPLETED / ARCHIVED status.');
    renderFooter();

    // ==========================================
    // PAGE 11: PART 24, 25, 26 & 27 (AUDITS, MASTER FLOW & CONTROL)
    // ==========================================
    newSectionPage('PART 24-27 — AUDITS, MASTER FLOW & DOCUMENT CONTROL', 'Verified Findings Summary, End-to-End Workflow & Governance Sign-Off');

    sectionTitle('24. Summary of Verified Audits (FIND-009 to FIND-015)');
    bullet('FIND-009.2 / 009.5 (Snapshot Sync)', 'VERIFIED. Resolved snapshot configuration freeze and UI hydration synchronization.');
    bullet('FIND-010 / 011 (Configure Events UX)', 'VERIFIED. Confirmed button is interactive; added clear informational subtitles.');
    bullet('FIND-012 (Tournament Courts Audit)', 'VERIFIED. Confirmed Court persistence, active status gating, and locking prerequisite.');
    bullet('FIND-013 (Role Management Audit)', 'VERIFIED. Confirmed two-tier RBAC security, Super Admin exclusivity, and event isolation.');
    bullet('FIND-014 (Court Scheduling Audit)', 'VERIFIED. Confirmed double-booking protection and ONE LIVE MATCH PER COURT invariant.');
    bullet('FIND-015 (Coach Registration Audit)', 'VERIFIED. Confirmed club-scoped roster authority and database-level eligibility validation.');

    sectionTitle('25 & 26. Master System End-to-End Workflow');
    paragraph('SUPER ADMIN  ->  Global System Setup  ->  ORGANIZER  ->  Tournament Creation  ->  Snapshot V1 Freeze  ->  Event Setup (N>=1)  ->  Court Setup (N>=1)  ->  Official Assignments  ->  COACHES  ->  Athlete Lineup Submissions  ->  Registration Close  ->  Weigh-In  ->  Bracket Generation  ->  COURT MANAGER  ->  Match Queue Dispatch  ->  Station Launch  ->  TABLE OFFICIAL  ->  Live Scorecard  ->  Match Finalization  ->  Medal Tally  ->  Reports & Certificates  ->  COMPLETED / ARCHIVED');

    sectionTitle('27. Document Control & Compliance Metadata');
    paragraph('Document Version: 1.0 (Official Release)  |  Publication Date: August 20, 2026\n' +
              'Governing Specification: UAAPHIL Tournament System Constitution & AI Development Guidelines\n' +
              'Runtime Baseline: Node.js 22 LTS, Vite 6, React 19, Tailwind CSS v4, PostgreSQL 16');
    renderFooter();

    doc.end();

    writeStream.on('finish', () => {
      const stats = fs.statSync(outputPath);
      const distPublic = path.resolve('dist');
      if (fs.existsSync(distPublic)) {
        fs.copyFileSync(outputPath, path.join(distPublic, 'UAAPHIL_Tournament_System_Operations_Manual.pdf'));
      }
      resolve({
        filePath: outputPath,
        size: stats.size,
        pageCount: currentPage,
      });
    });

    writeStream.on('error', err => {
      reject(err);
    });
  });
}

// Direct execution when run as script
if (process.argv[1] && process.argv[1].endsWith('generate_manual_pdf.ts')) {
  generateManualPdf()
    .then(res => {
      console.log(`SUCCESS: PDF Generated at ${res.filePath}`);
      console.log(`Size: ${res.size} bytes`);
      console.log(`Page Count: ${res.pageCount}`);
    })
    .catch(err => {
      console.error('ERROR Generating PDF:', err);
      process.exit(1);
    });
}
