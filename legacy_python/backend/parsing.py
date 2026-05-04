"""Phase 1: parse raw inputs into a unified TestVariables schema.

We extract:
  * Personas / Objectives -> categorical factors
  * Discrete state fields -> categorical factors with an extra Invalid/Null level
  * Continuous state fields -> 4 BVA buckets
  * String DB fields -> schema-driven probes + optional ONE batched LLM call across
    all string fields for domain-realistic edge cases.

Improvements vs spec:
  * Tool params marked `enum` are properly enumerated (not bucketed).
  * Continuous bucket values are tagged with their *role*
  * Continuous / string levels use role tags where helpful for the matrix UI.
"""
from __future__ import annotations

import json
import re
import textwrap
from typing import Any, Iterable

from .config import settings
from .llm import llm
from .models import (
    AgentSpec,
    Factor,
    StateField,
    TestSuiteInput,
    TestVariables,
    ToolSpec,
)

# Matches matrix truncation so the most informative levels survive clipping.
MAX_DB_STRING_FACTOR_LEVELS = 6


# --- Boundary Value Analysis bucket recipe -----------------------------------


def _bva_buckets(min_v: float | None, max_v: float | None) -> list[Any]:
    """Return 4 boundary-value buckets for a numeric range.

    We deliberately include an *invalid* low value (one tick below min) to surface
    underflow handling bugs.
    """
    lo = -1.0 if min_v is None else float(min_v) - 1.0
    typ = 50.5 if max_v is None or min_v is None else (float(min_v) + float(max_v)) / 2
    hi = 999_999.99 if max_v is None else float(max_v) + 1.0
    return [
        {"value": lo, "role": "underflow"},
        {"value": 0.0, "role": "zero_or_empty"},
        {"value": typ, "role": "typical"},
        {"value": hi, "role": "overflow"},
    ]


def _enum_levels(values: list[Any]) -> list[Any]:
    """Enum factor: include all values plus an explicit invalid sentinel."""
    return list(values) + [{"value": None, "role": "invalid_or_null"}]


# --- String DB helpers -------------------------------------------------------

_ROLE_RANK: dict[str, int] = {
    # Lower sorts earlier — matrix keeps only MAX_DB_STRING_FACTOR_LEVELS.
    "invalid_or_null": 0,
    "empty": 1,
    "explicit_example": 2,
    "format_valid": 2,
    "typical_placeholder": 3,
    "format_invalid": 4,
    "format_edge": 4,
    "pattern_violation": 5,
    "injection_candidate": 6,
    "length_over_max": 7,
    "unicode_edge": 8,
    "length_below_min": 9,
    "length_min": 10,
    "length_max": 10,
}


def _string_level_tuple(level: dict[str, Any]) -> tuple[int, str]:
    role = str(level.get("role", "other"))
    base = role.split(":", 1)[0] if ":" in role else role
    return (_ROLE_RANK.get(base, _ROLE_RANK.get(role, 40)), role)


def _clamp_str(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "\u2026"


def _dedupe_levels(levels: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, str]] = set()
    out: list[dict[str, Any]] = []
    for lvl in levels:
        val = lvl.get("value")
        role = str(lvl.get("role", ""))
        key = (_hashable_value(val), role)
        if key in seen:
            continue
        seen.add(key)
        out.append(lvl)
    return out


def _dedupe_same_value_pick_best(levels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """When several roles share identical `value`, keep the strongest-ranked level."""
    best: dict[Any, dict[str, Any]] = {}
    for lvl in levels:
        key = _hashable_value(lvl.get("value"))
        prev = best.get(key)
        if prev is None or _string_level_tuple(lvl) < _string_level_tuple(prev):
            best[key] = lvl
    return list(best.values())


def _hashable_value(v: Any) -> Any:
    if isinstance(v, dict):
        return tuple(sorted((k, _hashable_value(val)) for k, val in v.items()))
    if isinstance(v, list):
        return tuple(_hashable_value(x) for x in v)
    return v


def _infer_value_format(field: StateField) -> str | None:
    if field.value_format:
        return field.value_format.strip().lower() or None
    n = field.name.lower()
    if "email" in n:
        return "email"
    if "url" in n or "uri" in n or "website" in n:
        return "url"
    if "phone" in n or "tel" in n or "mobile" in n:
        return "phone"
    if "uuid" in n:
        return "uuid"
    return None


def _format_probe_levels(fmt: str) -> list[dict[str, Any]]:
    f = fmt.strip().lower()
    if f == "email":
        return [
            {"value": "jane.customer@example.com", "role": "format_valid"},
            {"value": "not_an_email_address", "role": "format_invalid"},
            {"value": "user@", "role": "format_edge"},
            {"value": "user..dup@example.com", "role": "format_invalid"},
        ]
    if f in {"url", "uri"}:
        return [
            {"value": "https://example.com/path?x=1", "role": "format_valid"},
            {"value": "ht!tp://broken .com/foo", "role": "format_invalid"},
            {"value": "javascript:alert(1)", "role": "format_edge"},
        ]
    if f == "phone":
        return [
            {"value": "+14155552671", "role": "format_valid"},
            {"value": "CALL-ME-NOW", "role": "format_invalid"},
            {"value": "+1 (415) 555-2671 ext 9999", "role": "format_edge"},
        ]
    if f == "uuid":
        return [
            {"value": "550e8400-e29b-41d4-a716-446655440000", "role": "format_valid"},
            {"value": "not-a-uuid-string", "role": "format_invalid"},
            {"value": "550e8400-e29b-41d4-a716-44665544000g", "role": "format_edge"},
        ]
    return []


def _typical_placeholder(field: StateField) -> str:
    parts = [p for p in re.split(r"[_\s]+", field.name.strip()) if p]
    slug = "".join(parts).lower()
    inferred = _infer_value_format(field)
    if inferred == "email":
        return "qa_user@example.com"
    fmt_levels = _format_probe_levels(inferred or "")
    if fmt_levels:
        v = fmt_levels[0].get("value")
        if isinstance(v, str):
            return v
    if slug.endswith("id") or "ticket" in slug or "order" in slug:
        stem = "".join(parts[:2]) if parts else "ref"
        return f"{stem.upper()[:12]}-00042"
    if slug.endswith("name") or slug == "fullname" or "customername" in slug:
        return "Jane Customer"
    return f"sample_{field.name}".replace(" ", "_")


def _length_probe_levels(field: StateField, typical: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    mn = field.min_length
    mx = field.max_length
    if mn is not None and mn >= 0:
        if mn == 0:
            out.append({"value": "", "role": "length_min"})
        else:
            out.append({"value": "a" * mn, "role": "length_min"})
        if mn > 0:
            under = mn - 1
            out.append({"value": "x" * under, "role": "length_below_min"})
    if mx is not None and mx >= 0:
        if mx >= 0:
            body = typical if typical else "x"
            rep = body * (mx // max(len(body), 1) + 2)
            out.append({"value": _clamp_str(rep, mx), "role": "length_max"})
            if mx < 8192:
                over = mx + min(128, mx + 1)
                bigger = typical + ("X" * (over - len(typical)))
                out.append({"value": _clamp_str(bigger, over), "role": "length_over_max"})
    return out


def _generic_string_edge_levels(typical: str) -> list[dict[str, Any]]:
    return [
        {"value": typical, "role": "typical_placeholder"},
        {"value": "line1\r\nline2\t\u00a0", "role": "unicode_edge"},
        {"value": "Robert'); DROP TABLE students;--", "role": "injection_candidate"},
    ]


def _heuristic_db_string_levels(field: StateField) -> list[dict[str, Any]]:
    """Schema-driven probes that do not require an LLM."""
    fmt = _infer_value_format(field)
    typical = ""
    raw_examples = []
    if field.examples:
        for ex in field.examples:
            if isinstance(ex, str) and ex.strip():
                raw_examples.append(ex.strip())
    typical = raw_examples[0] if raw_examples else _typical_placeholder(field)

    fmt_levels: list[dict[str, Any]] = []
    if fmt:
        fmt_levels = _format_probe_levels(fmt)
        if fmt_levels and not raw_examples:
            tv = fmt_levels[0]["value"]
            if isinstance(tv, str):
                typical = tv

    levels: list[dict[str, Any]] = [
        {"value": "", "role": "empty"},
        {"value": None, "role": "invalid_or_null"},
    ]
    for ex in raw_examples[:2]:
        levels.append({"value": ex, "role": "explicit_example"})

    if fmt_levels:
        levels.extend(fmt_levels)
    elif field.pattern:
        # Without a declared format, still stress validation / regex handling.
        levels.append({"value": typical, "role": "typical_placeholder"})
        levels.append({"value": "!@#\u0007___", "role": "pattern_violation"})
        levels.append({"value": "<![CDATA[invalid]]>", "role": "pattern_violation"})
    levels.extend(_length_probe_levels(field, typical))
    levels.extend(_generic_string_edge_levels(typical))

    return _sort_cap_string_levels(levels)


def _sort_cap_string_levels(levels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collapsed = _dedupe_same_value_pick_best(_dedupe_levels(levels))
    collapsed.sort(key=_string_level_tuple)
    return collapsed[:MAX_DB_STRING_FACTOR_LEVELS]


def _normalize_string_level(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, dict) and "value" in raw:
        role_raw = raw.get("role")
        role = (
            str(role_raw).strip().lower().replace(" ", "_") if role_raw else "llm_suggested"
        )
        val = raw.get("value")
        rk = role[:60]
        # Stable prefix keeps LLM levels from crowding out heuristics arbitrarily.
        if not rk.startswith("llm"):
            rk = f"llm_{rk}"
        return {"value": val, "role": rk[:64]}
    if isinstance(raw, str):
        return {"value": raw, "role": "llm_suggested"}
    return None


def _sanitize_llm_levels(
    proposed: Iterable[Any],
) -> list[dict[str, Any]]:
    ok: list[dict[str, Any]] = []
    for item in proposed:
        lvl = _normalize_string_level(item)
        if lvl is None:
            continue
        # Avoid duplicating our mandatory sentinels; heuristic pass already has them.
        if lvl["value"] == "":
            continue
        if lvl["value"] is None and lvl["role"] in {"invalid_or_null", "null"}:
            continue
        ok.append({"value": lvl["value"], "role": lvl["role"][:80]})
    return _sort_cap_string_levels(ok)


def _field_specs_for_llm(fields: list[StateField]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for f in fields:
        specs.append(
            {
                "name": f.name,
                "description": f.description or "",
                "value_format": f.value_format,
                "examples": list(f.examples or []),
                "min_length": f.min_length,
                "max_length": f.max_length,
                "pattern": f.pattern,
            }
        )
    return specs


def _agent_context_block(agent_spec: AgentSpec, *, max_prompt_chars: int = 2800) -> str:
    tool_lines = [f"{t.name}: {(t.description or '').strip()}" for t in agent_spec.tools[:24]]
    tools = "\n".join(f"- {line}" for line in tool_lines) or "(none)"
    prompt = textwrap.shorten(agent_spec.system_prompt or "", width=max_prompt_chars, placeholder="…")
    return f"Target agent system prompt (truncated):\n{prompt}\n\nTools (truncated list):\n{tools}"


def _llm_db_string_levels(
    fields: list[StateField], agent_spec: AgentSpec
) -> dict[str, list[Any]]:
    """One batched call: domain-specific string levels per field."""
    if not fields:
        return {}

    model = settings.parse_db_string_model or settings.tester_model
    specs = _field_specs_for_llm(fields)
    user_obj = {
        "fields": specs,
        "guidance": (
            "For each field, propose 2-5 string values suitable for initializing sandbox DB state. "
            "Include a mix of plausible valid values, near-miss invalids, and realistic edge cases. "
            "Do not include empty string or null (handled separately). "
            "Keep each string under 800 characters."
        ),
    }
    user = json.dumps(user_obj, ensure_ascii=False)
    system = (
        "You generate SANDBOX STRING FACTOR LEVELS for automated testing.\n"
        "Return STRICT JSON only, no markdown:\n"
        '{"levels_by_field": { "<field_name>": [ {"value": str|null, "role": "snake_case"}, ... ] }}\n'
        "Keys in levels_by_field MUST match the input field names exactly."
    )
    messages = [
        {"role": "user", "content": _agent_context_block(agent_spec) + "\n\n" + user}
    ]
    payload = llm.chat_json(
        model=model,
        system=system,
        messages=messages,
        temperature=0.35,
        max_tokens=1200,
    )
    raw_map = payload.get("levels_by_field") or {}
    if not isinstance(raw_map, dict):
        return {}

    out: dict[str, list[Any]] = {}
    for f in fields:
        raw = raw_map.get(f.name)
        if not isinstance(raw, list):
            continue
        cleaned = _sanitize_llm_levels(raw)
        if cleaned:
            out[f.name] = cleaned
    return out


def _merge_db_string_levels(
    field: StateField, llm_extra: list[Any] | None
) -> list[Any]:
    base = _heuristic_db_string_levels(field)
    if not llm_extra:
        return base
    merged = list(base) + list(llm_extra)
    return _sort_cap_string_levels(merged)


# --- Field/parameter -> Factor ----------------------------------------------


def _factor_from_state_field(
    field: StateField,
    *,
    db_string_llm_levels: dict[str, list[Any]] | None = None,
) -> Factor:
    if field.type == "enum":
        levels = _enum_levels(field.values or [])
    elif field.type == "boolean":
        levels = _enum_levels([True, False])
    elif field.type in {"integer", "float"}:
        levels = _bva_buckets(field.min, field.max)
    elif field.type == "string":
        if field.values:
            levels = _enum_levels([str(v) for v in field.values])
        else:
            extra = (db_string_llm_levels or {}).get(field.name)
            levels = _merge_db_string_levels(field, extra)
    else:
        # Forward-compatible fallback if Literal is expanded without updating this parser.
        levels = [{"value": "", "role": "empty"}, {"value": None, "role": "invalid_or_null"}]
    return Factor(name=f"db.{field.name}", kind="db_var", levels=levels, source=field.name)


def _factors_from_tools(tools: list[ToolSpec]) -> list[Factor]:
    out: list[Factor] = []
    for tool in tools:
        for p in tool.parameters:
            name = f"tool.{tool.name}.{p.name}"
            if p.enum:
                levels = _enum_levels(p.enum)
            elif p.type in {"integer", "float", "number"}:
                levels = _bva_buckets(None, None)
            elif p.type == "boolean":
                levels = _enum_levels([True, False])
            else:
                levels = [
                    {"value": "", "role": "empty"},
                    {"value": "valid_example", "role": "typical"},
                    {"value": "'; DROP TABLE users;--", "role": "injection"},
                    {"value": None, "role": "invalid_or_null"},
                ]
            out.append(
                Factor(
                    name=name,
                    kind="tool_param",
                    levels=levels,
                    source=f"{tool.name}.{p.name}",
                    description=p.description,
                )
            )
    return out


def parse_inputs(payload: TestSuiteInput) -> TestVariables:
    factors: list[Factor] = []

    factors.append(
        Factor(name="persona", kind="persona", levels=list(payload.personas))
    )
    factors.append(
        Factor(name="objective", kind="objective", levels=list(payload.objectives))
    )

    string_fields = [f for f in payload.sandbox_schema.fields if f.type == "string"]
    db_string_llm: dict[str, list[Any]] = {}
    if settings.parse_db_string_with_llm and string_fields:
        db_string_llm = _llm_db_string_levels(string_fields, payload.agent_spec)

    factors.extend(
        _factor_from_state_field(f, db_string_llm_levels=db_string_llm)
        for f in payload.sandbox_schema.fields
    )
    factors.extend(_factors_from_tools(payload.agent_spec.tools))

    return TestVariables(factors=factors)


# --- Convenience for level rendering in the UI -------------------------------


def level_label(level: Any) -> str:
    if isinstance(level, dict) and "role" in level:
        return f"{level.get('value')!r} ({level['role']})"
    return repr(level)


def level_value(level: Any) -> Any:
    if isinstance(level, dict) and "value" in level:
        return level["value"]
    return level
