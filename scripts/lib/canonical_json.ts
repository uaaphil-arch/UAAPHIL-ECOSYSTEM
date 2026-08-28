/**
 * UAAPHIL Golden Runtime E2E - Canonical JSON Serialization & Comparison Utility
 * 
 * Provides deterministic, key-sorted, whitespace-normalized JSON serialization
 * and semantic tree comparison for tournament brackets, snapshots, and match trees.
 * 
 * Complies with strict QA Governance:
 * - Sorts object keys recursively
 * - Filters only explicitly proven non-semantic fields (e.g. dynamic timestamps)
 *   when specified by comparator options.
 * - Never alters bracket topology or node indices.
 */

export interface SemanticComparisonOptions {
  ignoreFields?: string[];
  normalizeUuids?: boolean;
}

/**
 * Recursively sorts all keys in an object to produce a deterministic representation.
 */
export function canonicalizeValue(val: unknown, options: SemanticComparisonOptions = {}): unknown {
  const ignoreSet = new Set(options.ignoreFields || []);

  if (val === null || typeof val !== 'object') {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => canonicalizeValue(item, options));
  }

  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    if (ignoreSet.has(key)) {
      continue;
    }
    result[key] = canonicalizeValue(obj[key], options);
  }

  return result;
}

/**
 * Returns a canonical, formatted JSON string with deterministically ordered keys.
 */
export function toCanonicalJson(val: unknown, options: SemanticComparisonOptions = {}): string {
  const canonicalObj = canonicalizeValue(val, options);
  return JSON.stringify(canonicalObj, null, 2);
}

/**
 * Compares two data structures semantically.
 * Returns an object with `isEqual`, canonical strings, and differences if unequal.
 */
export function compareCanonicalJson(
  actual: unknown,
  expected: unknown,
  options: SemanticComparisonOptions = {}
): {
  isEqual: boolean;
  actualCanonical: string;
  expectedCanonical: string;
  diffSummary?: string;
} {
  const actualCanonical = toCanonicalJson(actual, options);
  const expectedCanonical = toCanonicalJson(expected, options);

  const isEqual = actualCanonical === expectedCanonical;

  return {
    isEqual,
    actualCanonical,
    expectedCanonical,
    diffSummary: isEqual ? undefined : `Semantic difference detected in canonical representation.`,
  };
}
