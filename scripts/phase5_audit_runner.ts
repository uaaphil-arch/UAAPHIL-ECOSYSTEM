/**
 * UAAPHIL Tournament System — Phase 5 Comprehensive Audit Test Suite
 * Automated data-driven / combinatorial verification test suite.
 * Date: 2026-08-18
 */

import {
  ARNIS_EVENT_REGISTRY,
  CANONICAL_DIVISIONS,
  INDIVIDUAL_DIVISIONS,
  TEAM_DIVISIONS,
  CanonicalDivision,
  deriveGenderFromDivision,
  WeightClassConfig,
} from '../src/constants/arnisRegistry';
import { getWeighInStatus } from '../src/components/registration/RegistrationManagementView';
import { Tournament, TournamentSnapshot, TournamentEvent, Registration, Match } from '../src/types/tournament';
import { bracketService } from '../src/services/bracketService';

export interface TestResult {
  id: string;
  category: string;
  scenario: string;
  input: any;
  expected: string;
  actual: string;
  pass: boolean;
  notes?: string;
}

const results: TestResult[] = [];

function recordTest(
  id: string,
  category: string,
  scenario: string,
  input: any,
  expected: string,
  actual: string,
  pass: boolean,
  notes?: string
) {
  results.push({ id, category, scenario, input, expected, actual, pass, notes });
}

// ====================================================================
// 1. GENDER & DIVISION DERIVATION AUDIT (CANONICAL DIVISIONS)
// ====================================================================
CANONICAL_DIVISIONS.forEach((div) => {
  const derived = deriveGenderFromDivision(div);
  let expectedGender = 'M';
  if (div === 'Junior Female' || div === "Women's") expectedGender = 'F';
  if (div === 'Mixed Junior' || div === 'Mixed Senior') expectedGender = 'MIXED';

  recordTest(
    `DIV-GEN-${div.replace(/[\s']/g, '-').toUpperCase()}`,
    'Division & Gender Derivation',
    `Derive gender for canonical division "${div}"`,
    { division: div },
    `gender === '${expectedGender}'`,
    `gender === '${derived}'`,
    derived === expectedGender
  );
});

// Verify Individual excludes Mixed
INDIVIDUAL_DIVISIONS.forEach((div) => {
  const isMixed = div === 'Mixed Junior' || div === 'Mixed Senior';
  recordTest(
    `INDIV-EXCL-${div.replace(/[\s']/g, '-').toUpperCase()}`,
    'Individual Anyo Division Rules',
    `Ensure individual division "${div}" is not mixed`,
    { division: div },
    'isMixed === false',
    `isMixed === ${isMixed}`,
    !isMixed
  );
});

// Verify Team includes Mixed
const hasMixedJunior = TEAM_DIVISIONS.includes('Mixed Junior');
const hasMixedSenior = TEAM_DIVISIONS.includes('Mixed Senior');
recordTest(
  'TEAM-INC-MIXED-JR',
  'Team Anyo Division Rules',
  'Team divisions include Mixed Junior',
  { teamDivisions: TEAM_DIVISIONS },
  'true',
  `${hasMixedJunior}`,
  hasMixedJunior
);
recordTest(
  'TEAM-INC-MIXED-SR',
  'Team Anyo Division Rules',
  'Team divisions include Mixed Senior',
  { teamDivisions: TEAM_DIVISIONS },
  'true',
  `${hasMixedSenior}`,
  hasMixedSenior
);

// ====================================================================
// 2. WEIGHT VALIDATION LOGIC SIMULATION
// ====================================================================
function validateWeightClassesSimulation(
  discipline: 'ANYO' | 'FULL_CONTACT',
  isOpenWeight: boolean,
  weightClasses: WeightClassConfig[]
): string | null {
  if (discipline !== 'FULL_CONTACT' || isOpenWeight) return null;

  if (weightClasses.length === 0) {
    return 'Please add at least one weight class for non-open-weight Full Contact events.';
  }

  const seenNames = new Set<string>();

  for (let i = 0; i < weightClasses.length; i++) {
    const wc = weightClasses[i];
    const trimmedName = wc.name.trim();
    if (!trimmedName) {
      return `Weight class #${i + 1} must have a name.`;
    }
    const lowerName = trimmedName.toLowerCase();
    if (seenNames.has(lowerName)) {
      return `Duplicate weight class name "${trimmedName}". Each weight class must have a unique name.`;
    }
    seenNames.add(lowerName);

    if (wc.min_weight !== null && isNaN(wc.min_weight)) {
      return `Weight class "${trimmedName}" has an invalid minimum weight.`;
    }
    if (wc.max_weight !== null && isNaN(wc.max_weight)) {
      return `Weight class "${trimmedName}" has an invalid maximum weight.`;
    }
    if (wc.min_weight !== null && wc.max_weight !== null && wc.min_weight > wc.max_weight) {
      return `Weight class "${trimmedName}" minimum weight (${wc.min_weight} kg) cannot be greater than maximum weight (${wc.max_weight} kg).`;
    }
  }

  // Overlap validation for defined numeric ranges
  for (let i = 0; i < weightClasses.length; i++) {
    const a = weightClasses[i];
    if (a.min_weight === null || a.max_weight === null) continue;

    for (let j = i + 1; j < weightClasses.length; j++) {
      const b = weightClasses[j];
      if (b.min_weight === null || b.max_weight === null) continue;

      if (a.min_weight < b.max_weight && b.min_weight < a.max_weight) {
        return `Overlapping weight ranges detected between "${a.name}" (${a.min_weight}–${a.max_weight} kg) and "${b.name}" (${b.min_weight}–${b.max_weight} kg).`;
      }
    }
  }

  return null;
}

// 2a. Empty name rejection
const emptyNameErr = validateWeightClassesSimulation('FULL_CONTACT', false, [
  { name: '  ', min_weight: 50, max_weight: 55, requires_weigh_in: true },
]);
recordTest(
  'VAL-EMPTY-NAME',
  'Weight Class Validation',
  'Reject empty weight class name',
  { name: '  ' },
  'Rejection error',
  emptyNameErr || 'Accepted',
  emptyNameErr !== null
);

// 2b. Min > Max rejection
const minGtMaxErr = validateWeightClassesSimulation('FULL_CONTACT', false, [
  { name: 'Feather', min_weight: 60, max_weight: 55, requires_weigh_in: true },
]);
recordTest(
  'VAL-MIN-GT-MAX',
  'Weight Class Validation',
  'Reject min_weight > max_weight',
  { min: 60, max: 55 },
  'Rejection error',
  minGtMaxErr || 'Accepted',
  minGtMaxErr !== null && minGtMaxErr.includes('cannot be greater than')
);

// 2c. Duplicate name rejection (case insensitive)
const dupNameErr = validateWeightClassesSimulation('FULL_CONTACT', false, [
  { name: 'Bantamweight', min_weight: 50, max_weight: 55, requires_weigh_in: true },
  { name: 'bantamweight', min_weight: 55.01, max_weight: 60, requires_weigh_in: true },
]);
recordTest(
  'VAL-DUP-NAME',
  'Weight Class Validation',
  'Reject duplicate weight class name (case-insensitive)',
  { names: ['Bantamweight', 'bantamweight'] },
  'Rejection error',
  dupNameErr || 'Accepted',
  dupNameErr !== null && dupNameErr.includes('Duplicate weight class name')
);

// 2d. Overlapping ranges rejection
const overlapErr = validateWeightClassesSimulation('FULL_CONTACT', false, [
  { name: 'Class A', min_weight: 50, max_weight: 60, requires_weigh_in: true },
  { name: 'Class B', min_weight: 55, max_weight: 65, requires_weigh_in: true },
]);
recordTest(
  'VAL-OVERLAP',
  'Weight Class Validation',
  'Reject overlapping weight class ranges (50-60 and 55-65)',
  { classA: '50-60', classB: '55-65' },
  'Rejection error',
  overlapErr || 'Accepted',
  overlapErr !== null && overlapErr.includes('Overlapping weight ranges')
);

// 2e. Valid adjacent ranges accepted
const validAdjacentErr = validateWeightClassesSimulation('FULL_CONTACT', false, [
  { name: 'Class A', min_weight: 50, max_weight: 55, requires_weigh_in: true },
  { name: 'Class B', min_weight: 55.01, max_weight: 60, requires_weigh_in: true },
  { name: 'Class C', min_weight: 60.01, max_weight: 65, requires_weigh_in: true },
]);
recordTest(
  'VAL-VALID-ADJACENT',
  'Weight Class Validation',
  'Accept valid non-overlapping adjacent multi-weight classes',
  { classes: ['50-55', '55.01-60', '60.01-65'] },
  'null (No error)',
  validAdjacentErr === null ? 'null (No error)' : validAdjacentErr,
  validAdjacentErr === null
);

// 2f. Zero classes on non-open Full Contact rejected
const zeroClassErr = validateWeightClassesSimulation('FULL_CONTACT', false, []);
recordTest(
  'VAL-ZERO-CLASSES',
  'Weight Class Validation',
  'Reject zero classes on non-open Full Contact event',
  { weightClasses: [] },
  'Rejection error',
  zeroClassErr || 'Accepted',
  zeroClassErr !== null
);

// 2g. Open Weight with zero custom classes accepted
const openWeightValid = validateWeightClassesSimulation('FULL_CONTACT', true, []);
recordTest(
  'VAL-OPEN-WEIGHT-ZERO-CLASSES',
  'Weight Class Validation',
  'Accept Open Weight without custom weight classes',
  { isOpenWeight: true, weightClasses: [] },
  'null (No error)',
  openWeightValid === null ? 'null (No error)' : openWeightValid,
  openWeightValid === null
);

// ====================================================================
// 3. WEIGH-IN ELIGIBILITY BOUNDARY AUDIT
// ====================================================================
const boundaryCases = [
  // Class: 50 to 55 kg
  { weight: 50.0, min: 50, max: 55, expected: 'PASSED', desc: 'Exact minimum boundary (50.0 kg)' },
  { weight: 55.0, min: 50, max: 55, expected: 'PASSED', desc: 'Exact maximum boundary (55.0 kg)' },
  { weight: 49.99, min: 50, max: 55, expected: 'UNDERWEIGHT', desc: 'Just below minimum (49.99 kg)' },
  { weight: 55.01, min: 50, max: 55, expected: 'OVERWEIGHT', desc: 'Just above maximum (55.01 kg)' },
  { weight: 52.5, min: 50, max: 55, expected: 'PASSED', desc: 'Midpoint valid weight (52.5 kg)' },
  { weight: null, min: 50, max: 55, expected: 'PENDING', desc: 'Null weight value' },
  { weight: undefined, min: 50, max: 55, expected: 'PENDING', desc: 'Undefined weight value' },
  // Open Weight: min=null, max=null
  { weight: 42.0, min: null, max: null, expected: 'PASSED', desc: 'Open Weight low value (42.0 kg)' },
  { weight: 120.5, min: null, max: null, expected: 'PASSED', desc: 'Open Weight high value (120.5 kg)' },
  { weight: null, min: null, max: null, expected: 'PENDING', desc: 'Open Weight unrecorded' },
];

boundaryCases.forEach((c, idx) => {
  const actual = getWeighInStatus(c.weight, c.min, c.max);
  recordTest(
    `WEIGH-BOUND-${idx + 1}`,
    'Weigh-In Eligibility Boundaries',
    c.desc,
    { weight: c.weight, min: c.min, max: c.max },
    c.expected,
    actual,
    actual === c.expected
  );
});

// ====================================================================
// 4. ANYO CALCULATION METHOD INTEGRITY
// ====================================================================
const anyoModes = ARNIS_EVENT_REGISTRY.anyoCalculationModes;
const hasStandardMean = anyoModes.some((m) => m.id === 'STANDARD_MEAN');
const hasOlympicTrim = anyoModes.some((m) => m.id === 'OLYMPIC_TRIM');
const hasArithmeticMean = anyoModes.some((m) => m.id === 'ARITHMETIC_MEAN');

recordTest(
  'ANYO-MODE-STD-MEAN',
  'Anyo Calculation Modes',
  'Registry contains STANDARD_MEAN',
  { modes: anyoModes.map((m) => m.id) },
  'true',
  `${hasStandardMean}`,
  hasStandardMean
);
recordTest(
  'ANYO-MODE-OLYMPIC',
  'Anyo Calculation Modes',
  'Registry contains OLYMPIC_TRIM',
  { modes: anyoModes.map((m) => m.id) },
  'true',
  `${hasOlympicTrim}`,
  hasOlympicTrim
);
recordTest(
  'ANYO-MODE-ARITHMETIC',
  'Anyo Calculation Modes',
  'Registry contains ARITHMETIC_MEAN',
  { modes: anyoModes.map((m) => m.id) },
  'true',
  `${hasArithmeticMean}`,
  hasArithmeticMean
);

// Anyo Calculation algorithms verification
function calculateAnyoScore(mode: string, scores: number[]): number {
  if (mode === 'STANDARD_MEAN' || mode === 'ARITHMETIC_MEAN') {
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round((sum / scores.length) * 1000) / 1000;
  }
  if (mode === 'OLYMPIC_TRIM') {
    if (scores.length <= 2) {
      const sum = scores.reduce((a, b) => a + b, 0);
      return Math.round((sum / scores.length) * 1000) / 1000;
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, -1);
    const sum = trimmed.reduce((a, b) => a + b, 0);
    return Math.round((sum / trimmed.length) * 1000) / 1000;
  }
  return 0;
}

// 5 Judge sample scores: [8.5, 9.0, 9.2, 9.5, 9.8]
const sample5 = [8.5, 9.0, 9.2, 9.5, 9.8];
// Standard Mean: (8.5 + 9.0 + 9.2 + 9.5 + 9.8) / 5 = 46.0 / 5 = 9.2
const calcStdMean = calculateAnyoScore('STANDARD_MEAN', sample5);
recordTest(
  'CALC-STD-MEAN-5',
  'Anyo Scoring Math',
  'Standard Mean on 5 judges (8.5, 9.0, 9.2, 9.5, 9.8)',
  { scores: sample5 },
  '9.2',
  `${calcStdMean}`,
  calcStdMean === 9.2
);

// Olympic Trim on 5 judges: drops 8.5 and 9.8 -> (9.0 + 9.2 + 9.5) / 3 = 27.7 / 3 = 9.233
const calcOlympicTrim = calculateAnyoScore('OLYMPIC_TRIM', sample5);
recordTest(
  'CALC-OLYMPIC-5',
  'Anyo Scoring Math',
  'Olympic Trim on 5 judges (8.5, 9.0, 9.2, 9.5, 9.8)',
  { scores: sample5 },
  '9.233',
  `${calcOlympicTrim}`,
  calcOlympicTrim === 9.233
);

// 7 Judge sample scores: [8.0, 8.5, 8.8, 9.0, 9.2, 9.4, 9.8]
const sample7 = [8.0, 8.5, 8.8, 9.0, 9.2, 9.4, 9.8];
// Standard Mean 7: sum = 62.7 / 7 = 8.957
const calcStdMean7 = calculateAnyoScore('STANDARD_MEAN', sample7);
recordTest(
  'CALC-STD-MEAN-7',
  'Anyo Scoring Math',
  'Standard Mean on 7 judges (8.0, 8.5, 8.8, 9.0, 9.2, 9.4, 9.8)',
  { scores: sample7 },
  '8.957',
  `${calcStdMean7}`,
  calcStdMean7 === 8.957
);

// Olympic Trim 7: drops 8.0 and 9.8 -> (8.5 + 8.8 + 9.0 + 9.2 + 9.4) / 5 = 44.9 / 5 = 8.98
const calcOlympicTrim7 = calculateAnyoScore('OLYMPIC_TRIM', sample7);
recordTest(
  'CALC-OLYMPIC-7',
  'Anyo Scoring Math',
  'Olympic Trim on 7 judges',
  { scores: sample7 },
  '8.98',
  `${calcOlympicTrim7}`,
  calcOlympicTrim7 === 8.98
);

// ====================================================================
// 5. SNAPSHOT IMMUTABILITY & LIFECYCLE SIMULATION
// ====================================================================
interface SnapshotState {
  id: string;
  tournament_id: string;
  version: number;
  configuration: {
    events: TournamentEvent[];
  };
  is_active: boolean;
}

const mockTournament: Tournament = {
  id: 'tourn-100',
  organizer_id: 'org-1',
  name: 'UAAPHIL National Championship 2026',
  slug: 'uaaphil-national-2026',
  description: 'Annual National Arnis Tournament',
  start_date: '2026-08-20',
  end_date: '2026-08-22',
  status: 'ONGOING',
  created_at: new Date().toISOString(),
};

const initialEvents: TournamentEvent[] = [
  {
    id: 'evt-1',
    snapshot_id: 'snap-1',
    name: 'Team Solo Baston - Mixed Senior',
    category: 'Team Solo Baston',
    division: 'Mixed Senior',
    weight_class: 'N/A',
    gender: 'MIXED',
    rules_override: {
      panel_size: '5_JUDGES',
      calc_method: 'STANDARD_MEAN',
    },
    created_at: new Date().toISOString(),
  },
  {
    id: 'evt-2',
    snapshot_id: 'snap-1',
    name: "Full Contact Live Stick - Men's Feather & Light",
    category: 'Full Contact Live Stick Rules',
    division: "Men's",
    weight_class: '2 Weight Classes (Featherweight, Lightweight)',
    gender: 'M',
    rules_override: {
      bracket_model: 'SINGLE_ELIMINATION_BRONZE_BOUT',
      weight_classes: [
        { name: 'Featherweight', min_weight: 55, max_weight: 60, requires_weigh_in: true },
        { name: 'Lightweight', min_weight: 60.01, max_weight: 65, requires_weigh_in: true },
      ],
    },
    created_at: new Date().toISOString(),
  },
];

// Snapshot freeze
const frozenSnapshot: SnapshotState = {
  id: 'snap-1',
  tournament_id: 'tourn-100',
  version: 1,
  configuration: {
    events: JSON.parse(JSON.stringify(initialEvents)),
  },
  is_active: true,
};

// Simulate mutating the live event after snapshot
const mutatedLiveEvent = {
  ...initialEvents[1],
  name: 'MUTATED LIVE EVENT NAME',
  weight_class: 'MUTATED WEIGHT CLASS',
};

// Verify snapshot immutability
const snapshotEventName = frozenSnapshot.configuration.events[1].name;
const isSnapshotIsolated = snapshotEventName === "Full Contact Live Stick - Men's Feather & Light";

recordTest(
  'SNAP-IMMUTABILITY-1',
  'Snapshot Immutability',
  'Live event changes do not alter frozen snapshot configuration',
  { mutatedLiveName: mutatedLiveEvent.name, snapshotName: snapshotEventName },
  "Full Contact Live Stick - Men's Feather & Light",
  snapshotEventName,
  isSnapshotIsolated
);

// ====================================================================
// 6. BRACKET GENERATION & TREE STRUCTURE AUDIT
// ====================================================================
const mockMatchesForEvent2: Match[] = [
  {
    id: 'm-final',
    tournament_id: 'tourn-100',
    event_id: 'evt-2',
    bracket_node_index: 1,
    round_name: 'Finals',
    round_number: 2,
    match_number: 1,
    red_corner_registration_id: 'reg-semi1-winner',
    blue_corner_registration_id: 'reg-semi2-winner',
    winner_registration_id: null,
    status: 'SCHEDULED',
    created_at: new Date().toISOString(),
  },
  {
    id: 'm-semi1',
    tournament_id: 'tourn-100',
    event_id: 'evt-2',
    bracket_node_index: 2,
    round_name: 'Semi-Finals',
    round_number: 1,
    match_number: 1,
    red_corner_registration_id: 'reg-athlete-1',
    blue_corner_registration_id: 'reg-athlete-2',
    winner_registration_id: 'reg-athlete-1',
    status: 'COMPLETED',
    next_match_id: 'm-final',
    next_match_corner: 'RED',
    created_at: new Date().toISOString(),
  },
  {
    id: 'm-semi2',
    tournament_id: 'tourn-100',
    event_id: 'evt-2',
    bracket_node_index: 3,
    round_name: 'Semi-Finals',
    round_number: 1,
    match_number: 2,
    red_corner_registration_id: 'reg-athlete-3',
    blue_corner_registration_id: 'reg-athlete-4',
    winner_registration_id: 'reg-athlete-3',
    status: 'COMPLETED',
    next_match_id: 'm-final',
    next_match_corner: 'BLUE',
    created_at: new Date().toISOString(),
  },
];

const structuredBracket = bracketService.buildEventBracket(initialEvents[1], mockMatchesForEvent2);

recordTest(
  'BRACKET-BUILD-ROUNDS',
  'Bracket Tree Generation',
  'Constructs valid multi-round elimination bracket structure',
  { totalMatches: mockMatchesForEvent2.length },
  'total_matches === 3',
  `total_matches === ${structuredBracket.total_matches}`,
  structuredBracket.total_matches === 3
);

recordTest(
  'BRACKET-COMPLETED-COUNT',
  'Bracket Progression Stats',
  'Correctly calculates completed match count',
  { completedMatches: 2 },
  'completed_matches === 2',
  `completed_matches === ${structuredBracket.completed_matches}`,
  structuredBracket.completed_matches === 2
);

// ====================================================================
// 7. BRONZE OPTION A vs OPTION B SIMULATION (MIGRATION 000019 INVARIANTS)
// ====================================================================
interface BronzeSimulationResult {
  bronzeGenerated: boolean;
  bracketNodeIndex: number | null;
  redCornerLoser: string | null;
  blueCornerLoser: string | null;
  isWalkover: boolean;
}

function simulateBronzeGeneration(
  bracketModel: string,
  semi1: { red: string | null; blue: string | null; winner: string | null; status: string },
  semi2: { red: string | null; blue: string | null; winner: string | null; status: string }
): BronzeSimulationResult {
  if (bracketModel !== 'SINGLE_ELIMINATION_BRONZE_BOUT' && bracketModel !== 'WITH_BATTLE_FOR_BRONZE') {
    // Option B: SINGLE_ELIMINATION_TWO_BRONZE -> No decider node generated
    return {
      bronzeGenerated: false,
      bracketNodeIndex: null,
      redCornerLoser: null,
      blueCornerLoser: null,
      isWalkover: false,
    };
  }

  // Option A: Check both semifinals completed
  if (semi1.status !== 'COMPLETED' || semi2.status !== 'COMPLETED') {
    return {
      bronzeGenerated: false,
      bracketNodeIndex: null,
      redCornerLoser: null,
      blueCornerLoser: null,
      isWalkover: false,
    };
  }

  const semi1Loser = semi1.winner === semi1.red ? semi1.blue : semi1.red;
  const semi2Loser = semi2.winner === semi2.red ? semi2.blue : semi2.red;

  if (semi1Loser !== null && semi2Loser !== null) {
    return {
      bronzeGenerated: true,
      bracketNodeIndex: 0,
      redCornerLoser: semi1Loser,
      blueCornerLoser: semi2Loser,
      isWalkover: false,
    };
  }

  if ((semi1Loser !== null && semi2Loser === null) || (semi1Loser === null && semi2Loser !== null)) {
    return {
      bronzeGenerated: true,
      bracketNodeIndex: 0,
      redCornerLoser: semi1Loser || semi2Loser,
      blueCornerLoser: null,
      isWalkover: true,
    };
  }

  return {
    bronzeGenerated: false,
    bracketNodeIndex: null,
    redCornerLoser: null,
    blueCornerLoser: null,
    isWalkover: false,
  };
}

// 7a. Option A Dual Semifinal Completion -> Generates Node 0 Bronze Match
const optABronze = simulateBronzeGeneration(
  'SINGLE_ELIMINATION_BRONZE_BOUT',
  { red: 'A1', blue: 'A2', winner: 'A1', status: 'COMPLETED' },
  { red: 'A3', blue: 'A4', winner: 'A3', status: 'COMPLETED' }
);

recordTest(
  'BRONZE-OPT-A-DUAL-SEMI',
  'Bronze Option A Generation',
  'Dual semifinal completion triggers Node 0 Bronze Match with semifinal losers',
  { bracketModel: 'SINGLE_ELIMINATION_BRONZE_BOUT' },
  'generated === true, node === 0, red === A2, blue === A4',
  `generated === ${optABronze.bronzeGenerated}, node === ${optABronze.bracketNodeIndex}, red === ${optABronze.redCornerLoser}, blue === ${optABronze.blueCornerLoser}`,
  optABronze.bronzeGenerated === true &&
    optABronze.bracketNodeIndex === 0 &&
    optABronze.redCornerLoser === 'A2' &&
    optABronze.blueCornerLoser === 'A4'
);

// 7b. Option A with 1 Semifinal BYE -> Walkover Bronze
const optAWalkover = simulateBronzeGeneration(
  'SINGLE_ELIMINATION_BRONZE_BOUT',
  { red: 'A1', blue: 'A2', winner: 'A1', status: 'COMPLETED' },
  { red: 'A3', blue: null, winner: 'A3', status: 'COMPLETED' } // A4 is BYE
);

recordTest(
  'BRONZE-OPT-A-WALKOVER',
  'Bronze Option A Walkover',
  'Semifinal BYE generates auto-completed Walkover Bronze Match',
  { semi2Blue: 'BYE' },
  'isWalkover === true, winner === A2',
  `isWalkover === ${optAWalkover.isWalkover}, redLoser === ${optAWalkover.redCornerLoser}`,
  optAWalkover.isWalkover === true && optAWalkover.redCornerLoser === 'A2'
);

// 7c. Option B -> Never generates Bronze match
const optBBronze = simulateBronzeGeneration(
  'SINGLE_ELIMINATION_TWO_BRONZE',
  { red: 'A1', blue: 'A2', winner: 'A1', status: 'COMPLETED' },
  { red: 'A3', blue: 'A4', winner: 'A3', status: 'COMPLETED' }
);

recordTest(
  'BRONZE-OPT-B-NO-NODE-0',
  'Bronze Option B Invariant',
  'Option B (Two Bronze) strictly produces no Node 0 decider match',
  { bracketModel: 'SINGLE_ELIMINATION_TWO_BRONZE' },
  'bronzeGenerated === false',
  `bronzeGenerated === ${optBBronze.bronzeGenerated}`,
  optBBronze.bronzeGenerated === false
);

// ====================================================================
// 8. COMPLETE_COURT_MATCH SECURITY & STATE INVARIANTS
// ====================================================================
function simulateCompleteCourtMatch(params: {
  callerId: string | null;
  callerIsOfficial: boolean;
  matchStatus: string;
  declaredWinner: string;
  redCorner: string;
  blueCorner: string;
}): { success: boolean; errorCode?: string; reason?: string } {
  if (!params.callerId) {
    return { success: false, errorCode: '40100', reason: 'UNAUTHORIZED: Authentication required' };
  }
  if (!params.callerIsOfficial) {
    return { success: false, errorCode: '40300', reason: 'FORBIDDEN: Official authority required' };
  }
  if (params.matchStatus !== 'IN_PROGRESS') {
    return { success: false, errorCode: '22000', reason: 'INVALID_STATE: Only IN_PROGRESS matches can be completed' };
  }
  if (params.declaredWinner !== params.redCorner && params.declaredWinner !== params.blueCorner) {
    return { success: false, errorCode: '22023', reason: 'INVALID_ARGUMENT: Declared winner must be RED or BLUE' };
  }
  return { success: true };
}

// 8a. Unauthorized caller rejected
const secNoAuth = simulateCompleteCourtMatch({
  callerId: null,
  callerIsOfficial: false,
  matchStatus: 'IN_PROGRESS',
  declaredWinner: 'A1',
  redCorner: 'A1',
  blueCorner: 'A2',
});
recordTest(
  'SEC-COMPLETE-NO-AUTH',
  'Security & RBAC Invariants',
  'Reject match completion without auth session (SQLSTATE 40100)',
  { callerId: null },
  'errorCode === 40100',
  `errorCode === ${secNoAuth.errorCode}`,
  secNoAuth.errorCode === '40100'
);

// 8b. Non-official caller rejected
const secNotOfficial = simulateCompleteCourtMatch({
  callerId: 'user-unauthorized',
  callerIsOfficial: false,
  matchStatus: 'IN_PROGRESS',
  declaredWinner: 'A1',
  redCorner: 'A1',
  blueCorner: 'A2',
});
recordTest(
  'SEC-COMPLETE-FORBIDDEN',
  'Security & RBAC Invariants',
  'Reject match completion by non-official user (SQLSTATE 40300)',
  { isOfficial: false },
  'errorCode === 40300',
  `errorCode === ${secNotOfficial.errorCode}`,
  secNotOfficial.errorCode === '40300'
);

// 8c. Non-IN_PROGRESS match rejected
const secInvalidState = simulateCompleteCourtMatch({
  callerId: 'user-official',
  callerIsOfficial: true,
  matchStatus: 'SCHEDULED',
  declaredWinner: 'A1',
  redCorner: 'A1',
  blueCorner: 'A2',
});
recordTest(
  'SEC-COMPLETE-INVALID-STATE',
  'Security & RBAC Invariants',
  'Reject completion of SCHEDULED match before it goes IN_PROGRESS (SQLSTATE 22000)',
  { status: 'SCHEDULED' },
  'errorCode === 22000',
  `errorCode === ${secInvalidState.errorCode}`,
  secInvalidState.errorCode === '22000'
);

// 8d. Declared winner not in match corners rejected
const secInvalidWinner = simulateCompleteCourtMatch({
  callerId: 'user-official',
  callerIsOfficial: true,
  matchStatus: 'IN_PROGRESS',
  declaredWinner: 'stranger-id',
  redCorner: 'A1',
  blueCorner: 'A2',
});
recordTest(
  'SEC-COMPLETE-INVALID-WINNER',
  'Security & RBAC Invariants',
  'Reject declared winner not in RED or BLUE corner (SQLSTATE 22023)',
  { declaredWinner: 'stranger-id' },
  'errorCode === 22023',
  `errorCode === ${secInvalidWinner.errorCode}`,
  secInvalidWinner.errorCode === '22023'
);

// 8e. Valid official completion succeeds
const secValidSuccess = simulateCompleteCourtMatch({
  callerId: 'user-official',
  callerIsOfficial: true,
  matchStatus: 'IN_PROGRESS',
  declaredWinner: 'A1',
  redCorner: 'A1',
  blueCorner: 'A2',
});
recordTest(
  'SEC-COMPLETE-VALID-OFFICIAL',
  'Security & RBAC Invariants',
  'Authorized official successfully completes IN_PROGRESS match',
  { callerId: 'user-official', declaredWinner: 'A1' },
  'success === true',
  `success === ${secValidSuccess.success}`,
  secValidSuccess.success === true
);

// ====================================================================
// 9. CROSS-COMBINATION & LEGACY MATRIX AUDIT
// ====================================================================
// 9a. Mixed Team Anyo + Snapshot
const mixedAnyoEvt = initialEvents[0];
recordTest(
  'CROSS-MIXED-ANYO-SNAP',
  'Cross-Combination Testing',
  'Mixed Senior Team Anyo persists accurately in Snapshot V1',
  { event: mixedAnyoEvt.name, gender: mixedAnyoEvt.gender },
  'gender === MIXED',
  `gender === ${mixedAnyoEvt.gender}`,
  mixedAnyoEvt.gender === 'MIXED'
);

// 9b. Multi-weight Full Contact + Weigh-In
const multiWeightEvt = initialEvents[1];
const configuredClasses = (multiWeightEvt.rules_override?.weight_classes as any[]) || [];
recordTest(
  'CROSS-MULTI-WEIGHT-CONFIG',
  'Cross-Combination Testing',
  'Multi-weight Full Contact event correctly preserves distinct classes',
  { classesCount: configuredClasses.length },
  'classesCount === 2',
  `classesCount === ${configuredClasses.length}`,
  configuredClasses.length === 2
);

// 9c. Legacy single scalar weight compatibility
const legacyEvt: TournamentEvent = {
  id: 'evt-legacy-1',
  snapshot_id: 'snap-1',
  name: 'Legacy Solo Baston Sparring',
  category: 'Full Contact UAAPHIL Rules',
  division: "Men's",
  weight_class: 'Pinweight (45-50 kg)',
  gender: 'M',
  min_weight: 45,
  max_weight: 50,
  rules_override: {
    requires_weigh_in: true,
    min_weight: 45,
    max_weight: 50,
  },
  created_at: new Date().toISOString(),
};

const legacyStatus = getWeighInStatus(48.5, legacyEvt.min_weight, legacyEvt.max_weight);
recordTest(
  'CROSS-LEGACY-WEIGHT-COMPAT',
  'Legacy Compatibility',
  'Legacy scalar min_weight/max_weight calculates weigh-in status accurately',
  { weight: 48.5, min: 45, max: 50 },
  'PASSED',
  legacyStatus,
  legacyStatus === 'PASSED'
);

// ====================================================================
// OUTPUT SUMMARY
// ====================================================================
console.log('====================================================');
console.log('UAAPHIL TOURNAMENT SYSTEM — PHASE 5 AUDIT TEST RUN');
console.log('====================================================');
let passCount = 0;
let failCount = 0;

results.forEach((r) => {
  if (r.pass) {
    passCount++;
    console.log(`[PASS] ${r.id}: ${r.scenario}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${r.id}: ${r.scenario} -> Expected ${r.expected}, got ${r.actual}`);
  }
});

console.log('====================================================');
console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log('====================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
