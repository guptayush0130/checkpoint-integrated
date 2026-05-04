/**
 * Phase 2 of the test pipeline — greedy maximum-coverage 3-way combinatorial
 * matrix generation.
 *
 * Strict port of `legacy_python/backend/matrix.py`. The randomized greedy
 * approximation of IPOG-F is good enough for v1; tighter algorithms (proper
 * IPOG-F, all-pairs reduction) wait for Phase 5.
 */
import { randomUUID } from 'node:crypto';
import {
  Factor,
  FactorLevel,
  TestConfiguration,
  TestMatrix,
  TestVariables
} from './engine_types';

const MAX_LEVELS_PER_FACTOR = 6;

class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32 — fine for a deterministic test-case generator
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
}

function truncateLevels(factors: Factor[]): Factor[] {
  return factors.map((f) =>
    f.levels.length > MAX_LEVELS_PER_FACTOR
      ? { ...f, levels: f.levels.slice(0, MAX_LEVELS_PER_FACTOR) }
      : f
  );
}

function levelKey(level: FactorLevel): string {
  if (level && typeof level === 'object' && 'value' in level) {
    return `o:${JSON.stringify(level)}`;
  }
  return `s:${JSON.stringify(level)}`;
}

/** Triplet representation: stable string for set membership. */
function tripletKey(
  fa: string,
  la: FactorLevel,
  fb: string,
  lb: FactorLevel,
  fc: string,
  lc: FactorLevel
): string {
  return `${fa}=${levelKey(la)}|${fb}=${levelKey(lb)}|${fc}=${levelKey(lc)}`;
}

function* triples(n: number): Generator<[number, number, number]> {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        yield [i, j, k];
      }
    }
  }
}

function allTriplets(factors: Factor[]): Set<string> {
  const out = new Set<string>();
  for (const [i, j, k] of triples(factors.length)) {
    for (const la of factors[i].levels) {
      for (const lb of factors[j].levels) {
        for (const lc of factors[k].levels) {
          out.add(tripletKey(factors[i].name, la, factors[j].name, lb, factors[k].name, lc));
        }
      }
    }
  }
  return out;
}

function coverageOf(
  assignment: Record<string, FactorLevel>,
  factors: Factor[]
): Set<string> {
  const out = new Set<string>();
  const names = factors.map((f) => f.name);
  for (const [i, j, k] of triples(names.length)) {
    out.add(
      tripletKey(
        names[i],
        assignment[names[i]],
        names[j],
        assignment[names[j]],
        names[k],
        assignment[names[k]]
      )
    );
  }
  return out;
}

function randomAssignment(
  factors: Factor[],
  rng: SeededRandom
): Record<string, FactorLevel> {
  const out: Record<string, FactorLevel> = {};
  for (const f of factors) {
    out[f.name] = rng.pick(f.levels);
  }
  return out;
}

export interface MatrixOptions {
  maxRows?: number;
  candidatesPerIter?: number;
  seed?: number;
}

export function generate3WayMatrix(
  variables: TestVariables,
  opts: MatrixOptions = {}
): TestMatrix {
  const maxRows = opts.maxRows ?? 30;
  const candidatesPerIter = opts.candidatesPerIter ?? 40;
  const seed = opts.seed ?? 1234;

  const rng = new SeededRandom(seed);
  const factors = truncateLevels(variables.factors);

  // Less than 3 factors → just enumerate the cartesian product up to maxRows.
  if (factors.length < 3) {
    const rows: TestConfiguration[] = [];
    const buf: FactorLevel[] = new Array(factors.length);
    function* product(idx: number): Generator<FactorLevel[]> {
      if (idx === factors.length) {
        yield buf.slice();
        return;
      }
      for (const lvl of factors[idx].levels) {
        buf[idx] = lvl;
        yield* product(idx + 1);
      }
    }
    for (const combo of product(0)) {
      const assignments: Record<string, FactorLevel> = {};
      factors.forEach((f, i) => (assignments[f.name] = combo[i]));
      rows.push({ id: randomUUID().slice(0, 8), assignments, coveredTriplets: 0 });
      if (rows.length >= maxRows) break;
    }
    return { factors, rows, totalTriplets: 0, coveragePercent: 100.0 };
  }

  const remaining = allTriplets(factors);
  const total = remaining.size;
  const rows: TestConfiguration[] = [];

  while (remaining.size > 0 && rows.length < maxRows) {
    let bestAssignment: Record<string, FactorLevel> | null = null;
    let bestNew = -1;
    for (let i = 0; i < candidatesPerIter; i++) {
      const candidate = randomAssignment(factors, rng);
      const cov = coverageOf(candidate, factors);
      let newCount = 0;
      for (const k of cov) if (remaining.has(k)) newCount++;
      if (newCount > bestNew) {
        bestNew = newCount;
        bestAssignment = candidate;
      }
    }
    if (!bestAssignment || bestNew <= 0) break;

    const cov = coverageOf(bestAssignment, factors);
    let covered = 0;
    for (const k of cov) {
      if (remaining.delete(k)) covered++;
    }
    rows.push({
      id: randomUUID().slice(0, 8),
      assignments: bestAssignment,
      coveredTriplets: covered
    });
  }

  const coveragePct = total === 0 ? 0 : (100 * (total - remaining.size)) / total;
  return {
    factors,
    rows,
    totalTriplets: total,
    coveragePercent: Math.round(coveragePct * 100) / 100
  };
}

// ---------------------------------------------------------------------------
// row helpers used downstream
// ---------------------------------------------------------------------------

export function assignmentPersona(assignment: Record<string, FactorLevel>): string {
  const v = assignment['persona'];
  return typeof v === 'string' ? v : 'Generic User';
}

export function assignmentObjective(assignment: Record<string, FactorLevel>): string {
  const v = assignment['objective'];
  return typeof v === 'string' ? v : 'find any failure mode';
}

export function assignmentToolHints(
  assignment: Record<string, FactorLevel>,
  factors: Factor[]
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of factors) {
    if (f.kind === 'tool_param' && f.name in assignment) {
      out[f.source || f.name] = unwrapLevel(assignment[f.name]);
    }
  }
  return out;
}

function unwrapLevel(level: FactorLevel): any {
  if (level && typeof level === 'object' && 'value' in level) return level.value;
  return level;
}
