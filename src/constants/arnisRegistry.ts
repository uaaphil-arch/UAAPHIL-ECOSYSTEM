export const CANONICAL_DIVISIONS = [
  'Junior Male',
  'Junior Female',
  'Mixed Junior',
  "Men's",
  "Women's",
  'Mixed Senior'
] as const;

export type CanonicalDivision = typeof CANONICAL_DIVISIONS[number];

export const INDIVIDUAL_DIVISIONS: CanonicalDivision[] = [
  'Junior Male',
  'Junior Female',
  "Men's",
  "Women's"
];

export const TEAM_DIVISIONS: CanonicalDivision[] = [
  'Junior Male',
  'Junior Female',
  'Mixed Junior',
  "Men's",
  "Women's",
  'Mixed Senior'
];

/**
 * Automatically derives the database gender ('M' | 'F' | 'MIXED') from the selected Division.
 * Per Section 8.3.1 of the Master Workflow, standalone Gender dropdowns are banned in the UI.
 */
export function deriveGenderFromDivision(division: CanonicalDivision): 'M' | 'F' | 'MIXED' {
  switch (division) {
    case 'Junior Male':
    case "Men's":
      return 'M';
    case 'Junior Female':
    case "Women's":
      return 'F';
    case 'Mixed Junior':
    case 'Mixed Senior':
      return 'MIXED';
  }
}

export interface WeightClassConfig {
  id?: string;
  name: string;
  min_weight: number | null;
  max_weight: number | null;
  requires_weigh_in: boolean;
}

export interface AnyoCategoryItem {
  id: string;
  name: string;
  type: 'INDIVIDUAL' | 'TEAM';
}

export interface FullContactCategoryItem {
  id: string;
  name: string;
  tallyModel: 'UAAPHIL_LIVE_STICK' | 'BALISONG_POINT_SYSTEM';
}

export interface CalculationModeItem {
  id: 'OLYMPIC_TRIM' | 'ARITHMETIC_MEAN' | 'STANDARD_MEAN';
  name: string;
  description: string;
}

export const ARNIS_EVENT_REGISTRY = {
  sport: 'ARNIS',
  disciplines: {
    ANYO: {
      competitionType: 'ANYO',
      engine: 'LEADERBOARD',
      categories: [
        { id: 'anyo_solo_baston', name: 'Anyo Solo Baston', type: 'INDIVIDUAL' },
        { id: 'anyo_doble_baston', name: 'Anyo Doble Baston', type: 'INDIVIDUAL' },
        { id: 'anyo_espada_y_daga', name: 'Anyo Espada y Daga', type: 'INDIVIDUAL' },
        { id: 'anyo_solo_espada', name: 'Anyo Solo Espada', type: 'INDIVIDUAL' },
        { id: 'team_solo_baston', name: 'Team Solo Baston', type: 'TEAM' },
        { id: 'team_doble_baston', name: 'Team Doble Baston', type: 'TEAM' },
        { id: 'team_espada_y_daga', name: 'Team Espada y Daga', type: 'TEAM' },
        { id: 'team_espada', name: 'Team Espada', type: 'TEAM' }
      ] as AnyoCategoryItem[]
    },
    FULL_CONTACT: {
      competitionType: 'FULL_CONTACT',
      engine: 'BRACKET_BOUT',
      categories: [
        { id: 'fc_uaaphil_rules', name: 'Full Contact UAAPHIL Rules', tallyModel: 'UAAPHIL_LIVE_STICK' },
        { id: 'fc_live_stick', name: 'Full Contact Live Stick Rules', tallyModel: 'UAAPHIL_LIVE_STICK' },
        { id: 'fc_balisong', name: 'Full Contact Balisong Rules', tallyModel: 'BALISONG_POINT_SYSTEM' },
        { id: 'fc_point_system', name: 'Full Contact Point System Rules', tallyModel: 'BALISONG_POINT_SYSTEM' }
      ] as FullContactCategoryItem[]
    }
  },
  divisions: CANONICAL_DIVISIONS,
  levels: ['NONE', 'NOVICE', 'INTERMEDIATE', 'ADVANCED', 'ELITE'] as const,
  anyoCalculationModes: [
    {
      id: 'OLYMPIC_TRIM',
      name: 'Olympic Trim',
      description: 'Drops highest and lowest judge scores, then calculates mean'
    },
    {
      id: 'ARITHMETIC_MEAN',
      name: 'Arithmetic Mean',
      description: 'Standard arithmetic average of all judge scores'
    },
    {
      id: 'STANDARD_MEAN',
      name: 'Standard Mean (No Trim)',
      description: 'Sum of all scores divided by total judges without discarding outliers'
    }
  ] as CalculationModeItem[],
  fullContactBracketModels: [
    { id: 'SINGLE_ELIMINATION_TWO_BRONZE', name: 'Option B: 2 Bronze Medals (Standard Semi Losers)' },
    { id: 'SINGLE_ELIMINATION_BRONZE_BOUT', name: 'Option A: Battle for Bronze (Node 0 Decider)' }
  ]
} as const;

/**
 * Determines whether a tournament event category is eligible for Individual Athlete Self-Registration.
 * - Anyo Individual categories (type === 'INDIVIDUAL') are self-registerable.
 * - Anyo Team categories (type === 'TEAM') and all Full Contact combat categories are Club-Managed
 *   and must be submitted via Coach Event Lineups.
 * - Unknown / unrecognized categories fail closed and return false.
 */
export function isIndividualSelfRegistrationEvent(event: { category: string }): boolean {
  if (!event || !event.category) return false;

  const normalizedCategory = event.category.trim().toLowerCase();

  // Check ANYO categories in registry
  const anyoCategory = ARNIS_EVENT_REGISTRY.disciplines.ANYO.categories.find(
    (c) => c.name.trim().toLowerCase() === normalizedCategory || c.id.trim().toLowerCase() === normalizedCategory
  );

  if (anyoCategory) {
    return anyoCategory.type === 'INDIVIDUAL';
  }

  // Full Contact categories are Club-Managed
  const isFullContact = ARNIS_EVENT_REGISTRY.disciplines.FULL_CONTACT.categories.some(
    (c) => c.name.trim().toLowerCase() === normalizedCategory || c.id.trim().toLowerCase() === normalizedCategory
  );

  if (isFullContact) {
    return false;
  }

  // Fail closed on unknown/unrecognized category
  return false;
}
