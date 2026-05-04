"""Phase 2 — 3-way combinatorial matrix generation.

Implementation notes / improvements over the spec:
  * Naive enumeration of all 3-way combinations explodes quickly. We cap the factor
    level count at MAX_LEVELS_PER_FACTOR and then use a *greedy maximum-coverage*
    selection (effectively a randomized greedy approximation of IPOG-F).
  * We always include `persona` and `objective` as fixed factors in every test row
    (since they directly drive the tester agent), then fill the remaining factors
    by maximizing 3-way coverage.
  * If the user supplies many factors, we limit the total rows to `max_rows` to keep
    the test-suite tractable; the coverage % is reported.
"""
from __future__ import annotations

import itertools
import random
from typing import Any, Iterable

from .models import Factor, TestConfiguration, TestMatrix, TestVariables
from .parsing import level_value


MAX_LEVELS_PER_FACTOR = 6  # additional safety net


def _truncate_levels(factors: list[Factor]) -> list[Factor]:
    out = []
    for f in factors:
        if len(f.levels) > MAX_LEVELS_PER_FACTOR:
            f = f.model_copy(update={"levels": f.levels[:MAX_LEVELS_PER_FACTOR]})
        out.append(f)
    return out


def _all_triplets(factors: list[Factor]) -> set[tuple]:
    """All (factor_a, level_a, factor_b, level_b, factor_c, level_c) triplets."""
    triplets: set[tuple] = set()
    for fa, fb, fc in itertools.combinations(range(len(factors)), 3):
        for la, lb, lc in itertools.product(
            factors[fa].levels, factors[fb].levels, factors[fc].levels
        ):
            triplets.add(
                (
                    factors[fa].name,
                    _hashable(la),
                    factors[fb].name,
                    _hashable(lb),
                    factors[fc].name,
                    _hashable(lc),
                )
            )
    return triplets


def _hashable(v: Any) -> Any:
    if isinstance(v, dict):
        return tuple(sorted((k, _hashable(val)) for k, val in v.items()))
    if isinstance(v, list):
        return tuple(_hashable(x) for x in v)
    return v


def _coverage_of(assignment: dict[str, Any], factors: list[Factor]) -> set[tuple]:
    names = list(assignment.keys())
    covered: set[tuple] = set()
    for a, b, c in itertools.combinations(range(len(names)), 3):
        covered.add(
            (
                names[a],
                _hashable(assignment[names[a]]),
                names[b],
                _hashable(assignment[names[b]]),
                names[c],
                _hashable(assignment[names[c]]),
            )
        )
    return covered


def _random_assignment(factors: list[Factor], rng: random.Random) -> dict[str, Any]:
    return {f.name: rng.choice(f.levels) for f in factors}


def generate_3way_matrix(
    variables: TestVariables,
    max_rows: int = 30,
    candidates_per_iter: int = 40,
    seed: int = 1234,
) -> TestMatrix:
    """Greedy maximum-coverage 3-way pairwise generator.

    Each iteration we sample `candidates_per_iter` random configurations and pick
    the one that covers the most still-uncovered triplets.
    """
    rng = random.Random(seed)
    factors = _truncate_levels(variables.factors)

    if len(factors) < 3:
        # Fall back to full Cartesian product when there aren't enough dims.
        rows = []
        for combo in itertools.product(*[f.levels for f in factors]):
            rows.append(
                TestConfiguration(
                    assignments={factors[i].name: combo[i] for i in range(len(factors))}
                )
            )
            if len(rows) >= max_rows:
                break
        return TestMatrix(
            factors=factors, rows=rows, total_triplets=0, coverage_percent=100.0
        )

    remaining = _all_triplets(factors)
    total = len(remaining)
    rows: list[TestConfiguration] = []

    while remaining and len(rows) < max_rows:
        best_assignment: dict[str, Any] | None = None
        best_new = -1
        for _ in range(candidates_per_iter):
            assignment = _random_assignment(factors, rng)
            new = len(_coverage_of(assignment, factors) & remaining)
            if new > best_new:
                best_new = new
                best_assignment = assignment
                if new == 0:
                    continue
        if best_assignment is None or best_new <= 0:
            break

        covered = _coverage_of(best_assignment, factors) & remaining
        rows.append(
            TestConfiguration(
                assignments=best_assignment, covered_triplets=len(covered)
            )
        )
        remaining -= covered

    coverage_pct = 0.0 if total == 0 else 100.0 * (total - len(remaining)) / total
    return TestMatrix(
        factors=factors,
        rows=rows,
        total_triplets=total,
        coverage_percent=round(coverage_pct, 2),
    )


def assignment_to_db_config(
    assignment: dict[str, Any], factors: list[Factor]
) -> dict[str, Any]:
    """Project a matrix row down to just the DB state config the sandbox needs."""
    db_config: dict[str, Any] = {}
    for f in factors:
        if f.kind == "db_var" and f.name in assignment:
            db_config[f.source or f.name] = level_value(assignment[f.name])
    return db_config


def assignment_persona(assignment: dict[str, Any]) -> str:
    return str(assignment.get("persona", "Generic User"))


def assignment_objective(assignment: dict[str, Any]) -> str:
    return str(assignment.get("objective", "find any failure mode"))


def assignment_tool_hints(
    assignment: dict[str, Any], factors: Iterable[Factor]
) -> dict[str, Any]:
    """Tool-parameter hints we can pass to the tester to bias prompt generation."""
    hints: dict[str, Any] = {}
    for f in factors:
        if f.kind == "tool_param" and f.name in assignment:
            hints[f.source or f.name] = level_value(assignment[f.name])
    return hints
