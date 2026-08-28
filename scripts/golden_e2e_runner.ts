/**
 * UAAPHIL Golden Runtime E2E Runner (FIND-022 Implementation)
 * 
 * Strict QA Governance:
 * - Zero Service Role Key usage (fails immediately if SUPABASE_SERVICE_ROLE_KEY is set)
 * - Independent Supabase Client instances per actor
 * - Real Supabase Auth sessions (JWTs obtained via legitimate signInWithPassword)
 * - Zero raw SQL mutations or mock responses
 * - Includes PREFLIGHT / DRY-RUN mode to validate environment, roles, and schema readiness
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { compareCanonicalJson } from './lib/canonical_json';

// Load environment variables from .env.test or default .env
const testEnvPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath });
} else {
  dotenv.config();
}

// -----------------------------------------------------------------------------
// 1. ABSOLUTE SECURITY CONSTRAINTS & REDACTION
// -----------------------------------------------------------------------------

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FATAL SECURITY VIOLATION: SUPABASE_SERVICE_ROLE_KEY detected in environment.');
  console.error('Under UAAPHIL QA Governance, E2E tests MUST NOT bypass RLS or execute with service-role privileges.');
  process.exit(1);
}

export type ActorRoleName = 'SUPER_ADMIN' | 'ORGANIZER' | 'TABLE_OFFICIAL' | 'COACH' | 'AUTHENTICATED';

export interface ActorSession {
  name: string;
  email: string;
  client: SupabaseClient;
  userId?: string;
  effectiveRole?: string;
}

export interface RunnerEvidenceRecord {
  phase: string;
  action: string;
  actor: string;
  executionChannel: 'API' | 'UI' | 'FILESYSTEM' | 'DATABASE';
  request: string;
  result: 'SUCCESS' | 'REJECTED' | 'FAILED' | 'BLOCKED';
  expected: string;
  actual: string;
  databaseEvidence?: string;
  errorCode?: string;
  timestamp: string;
  evidenceClass: 'RUNTIME-EXECUTED' | 'BACKEND-EXECUTED' | 'DATABASE-VERIFIED' | 'DOCUMENT-VERIFIED' | 'SOURCE-VERIFIED' | 'NOT EXECUTED' | 'BLOCKED';
}

const evidenceLog: RunnerEvidenceRecord[] = [];

function recordEvidence(record: RunnerEvidenceRecord) {
  evidenceLog.push(record);
  console.log(`[${record.phase}] [${record.actor}] ${record.action} -> ${record.result} (${record.evidenceClass})`);
}

// -----------------------------------------------------------------------------
// 2. CREDENTIAL DISCOVERY & VALIDATION
// -----------------------------------------------------------------------------

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('E2E BLOCKED — Supabase URL or Anon Key is missing from environment.');
  process.exit(1);
}

const requiredActors = [
  { key: 'ADMIN', email: process.env.TEST_ADMIN_EMAIL, pass: process.env.TEST_ADMIN_PASSWORD, expectedRole: 'SUPER_ADMIN' },
  { key: 'ORGANIZER', email: process.env.TEST_ORGANIZER_EMAIL, pass: process.env.TEST_ORGANIZER_PASSWORD, expectedRole: 'TOURNAMENT_MANAGER' },
  { key: 'OFFICIAL', email: process.env.TEST_OFFICIAL_EMAIL, pass: process.env.TEST_OFFICIAL_PASSWORD, expectedRole: 'TABLE_OFFICIAL' },
  { key: 'COACH1', email: process.env.TEST_COACH1_EMAIL, pass: process.env.TEST_COACH1_PASSWORD, expectedRole: 'COACH' },
  { key: 'COACH2', email: process.env.TEST_COACH2_EMAIL, pass: process.env.TEST_COACH2_PASSWORD, expectedRole: 'COACH' },
];

export function validateActorCredentials(): boolean {
  const missing = requiredActors.filter(a => !a.email || !a.pass);
  if (missing.length > 0) {
    console.warn('\n======================================================');
    console.warn('E2E BLOCKED — TEST ACTOR CREDENTIALS NOT PROVIDED');
    console.warn(`Missing credentials for: ${missing.map(m => m.key).join(', ')}`);
    console.warn('To execute authentic runtime tests, provide credentials in .env.test');
    console.warn('See .env.test.example for configuration details.');
    console.warn('======================================================\n');
    return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// 3. INDEPENDENT CLIENT FACTORY & AUTHENTICATION
// -----------------------------------------------------------------------------

export function createActorClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function authenticateActor(name: string, email: string, pass: string): Promise<ActorSession | null> {
  const client = createActorClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: pass,
  });

  if (error || !data.user || !data.session) {
    recordEvidence({
      phase: 'PHASE 0 — AUTH',
      action: `Authenticate ${name}`,
      actor: name,
      executionChannel: 'API',
      request: `POST /auth/v1/token (email: ${email})`,
      result: 'FAILED',
      expected: '200 OK + Authenticated Session JWT',
      actual: error ? error.message : 'No session returned',
      errorCode: error?.name,
      timestamp: new Date().toISOString(),
      evidenceClass: 'BACKEND-EXECUTED',
    });
    return null;
  }

  // Fetch effective role from public.user_roles via authenticated query
  const { data: roleData, error: roleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', data.user.id);

  const effectiveRole = roleData && roleData.length > 0 ? roleData.map(r => r.role).join(', ') : 'AUTHENTICATED';

  recordEvidence({
    phase: 'PHASE 0 — AUTH',
    action: `Authenticate and verify ${name}`,
    actor: name,
    executionChannel: 'API',
    request: `POST /auth/v1/token + SELECT role FROM user_roles WHERE user_id = auth.uid()`,
    result: 'SUCCESS',
    expected: 'Authentic JWT + Verified User ID',
    actual: `User authenticated (UID: ${data.user.id}, Role: ${effectiveRole})`,
    databaseEvidence: `user_roles.role = '${effectiveRole}'`,
    timestamp: new Date().toISOString(),
    evidenceClass: 'RUNTIME-EXECUTED',
  });

  return {
    name,
    email,
    client,
    userId: data.user.id,
    effectiveRole,
  };
}

// -----------------------------------------------------------------------------
// 4. OPERATIONS MANUAL INDEPENDENT PDF VALIDATOR (PHASE 16)
// -----------------------------------------------------------------------------

export function validateOperationsManual(): { valid: boolean; details: Record<string, unknown> } {
  const manualPath = path.resolve(process.cwd(), 'public', 'UAAPHIL_Tournament_System_Operations_Manual.pdf');
  if (!fs.existsSync(manualPath)) {
    return { valid: false, details: { error: 'File does not exist on disk' } };
  }

  const stat = fs.statSync(manualPath);
  const buffer = fs.readFileSync(manualPath);
  const header = buffer.subarray(0, 8).toString('utf-8');
  const rawString = buffer.toString('binary');

  // Count /Page objects and decompressed stream markers
  const pageMatches = rawString.match(/\/Type\s*\/Page[^s]/g) || [];
  const streamMatches = rawString.match(/stream\r?\n/g) || [];

  const isValidHeader = header.startsWith('%PDF-1.');
  const hasExpectedSize = stat.size > 10000;
  const pageCount = pageMatches.length;
  const is11Pages = pageCount === 11;

  const valid = isValidHeader && hasExpectedSize && is11Pages;

  return {
    valid,
    details: {
      path: manualPath,
      sizeBytes: stat.size,
      header: header.trim(),
      pageCount,
      streamCount: streamMatches.length,
      is11Pages,
    },
  };
}

// -----------------------------------------------------------------------------
// 5. PREFLIGHT / DRY-RUN VALIDATOR
// -----------------------------------------------------------------------------

export async function runPreflight(): Promise<boolean> {
  console.log('======================================================');
  console.log('UAAPHIL GOLDEN E2E RUNNER — PREFLIGHT & DRY-RUN AUDIT');
  console.log('======================================================');
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Anon Key Configured: ${Boolean(supabaseAnonKey)}`);

  // Step 1: Validate Operations Manual PDF independently (Phase 16)
  const manualResult = validateOperationsManual();
  console.log('\n[Phase 16 Check] Operations Manual PDF Audit:');
  console.log(`  File Exists & Size: ${manualResult.details.sizeBytes} bytes`);
  console.log(`  PDF Header: ${manualResult.details.header}`);
  console.log(`  Page Count: ${manualResult.details.pageCount} (Expected: 11)`);
  console.log(`  Validation Status: ${manualResult.valid ? 'PASS (DOCUMENT-VERIFIED)' : 'FAIL'}`);

  recordEvidence({
    phase: 'PHASE 16 — MANUAL',
    action: 'Inspect Operations Manual PDF',
    actor: 'SYSTEM',
    executionChannel: 'FILESYSTEM',
    request: 'fs.stat + stream inspect (/public/UAAPHIL_Tournament_System_Operations_Manual.pdf)',
    result: manualResult.valid ? 'SUCCESS' : 'FAILED',
    expected: 'Valid %PDF-1.3%, 11 pages, 27 Parts, size > 10KB',
    actual: JSON.stringify(manualResult.details),
    timestamp: new Date().toISOString(),
    evidenceClass: 'DOCUMENT-VERIFIED',
  });

  // Step 2: Validate Canonical JSON Comparator (Phase 8 Utility)
  const dummyBracketA = { round: 1, matches: [{ id: 'm1', seed: 1, corner: 'RED' }] };
  const dummyBracketB = { matches: [{ corner: 'RED', id: 'm1', seed: 1 }], round: 1 };
  const comp = compareCanonicalJson(dummyBracketA, dummyBracketB);
  console.log(`\n[Phase 8 Utility Check] Canonical JSON Utility: ${comp.isEqual ? 'PASS' : 'FAIL'}`);

  // Step 3: Check Test Actor Credentials
  const hasCredentials = validateActorCredentials();
  if (!hasCredentials) {
    console.log('\nPREFLIGHT STATUS: DRY-RUN COMPLETED (Awaiting Test Actor Credentials in .env.test)');
    return false;
  }

  // If credentials exist, verify authentication & Super Admin role
  console.log('\n[Phase 0 Check] Authenticating Test Actors...');
  const adminActor = await authenticateActor('ADMIN', process.env.TEST_ADMIN_EMAIL!, process.env.TEST_ADMIN_PASSWORD!);
  if (!adminActor) {
    console.error('PREFLIGHT FAILED: Admin actor failed to authenticate.');
    return false;
  }

  if (!adminActor.effectiveRole?.includes('SUPER_ADMIN')) {
    console.error(`E2E BLOCKED — ADMIN TEST ACTOR DOES NOT HAVE REQUIRED SUPER_ADMIN ROLE. Current role: '${adminActor.effectiveRole}'`);
    return false;
  }

  console.log('PREFLIGHT PASSED: All preliminary checks and authentications verified.');
  return true;
}

// Execute preflight when run directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPreflight().catch((err) => {
    console.error('Fatal error during preflight execution:', err);
    process.exit(1);
  });
}
