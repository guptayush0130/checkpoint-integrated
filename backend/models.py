"""Pydantic models for the testing framework."""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Phase 1 — Inputs
# ---------------------------------------------------------------------------


class ToolParameter(BaseModel):
    name: str
    type: str
    description: str | None = None
    enum: list[Any] | None = None
    required: bool = False


class ToolSpec(BaseModel):
    name: str
    description: str | None = None
    parameters: list[ToolParameter] = Field(default_factory=list)


class AgentSpec(BaseModel):
    """Mirrors the relevant subset of the Google ADK / OpenAI tool spec."""

    name: str = "TargetAgent"
    system_prompt: str = ""
    tools: list[ToolSpec] = Field(default_factory=list)


class StateField(BaseModel):
    """A single key in the sandbox state schema."""

    name: str
    type: Literal["enum", "boolean", "integer", "float", "string"]
    values: list[Any] | None = None  # for enum
    min: float | None = None
    max: float | None = None
    # String fields (ignored for non-string types)
    description: str | None = None
    examples: list[str] | None = None
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = Field(
        default=None,
        description="Hint regex for valid values; drives a generic violation probe.",
    )
    value_format: str | None = Field(
        default=None,
        description='Semantic hint, e.g. "email", "url", "phone", "uuid", "free_text".',
    )


class SandboxSchema(BaseModel):
    fields: list[StateField] = Field(default_factory=list)


class TestSuiteInput(BaseModel):
    agent_spec: AgentSpec
    personas: list[str]
    objectives: list[str]
    sandbox_schema: SandboxSchema


# ---------------------------------------------------------------------------
# Phase 1 (parsing output) — TestVariables
# ---------------------------------------------------------------------------


class Factor(BaseModel):
    """A single dimension of the combinatorial space."""

    name: str
    kind: Literal["persona", "objective", "db_var", "tool_param"]
    levels: list[Any]
    source: str | None = None  # e.g. "tool:refund.amount"
    description: str | None = None


class TestVariables(BaseModel):
    factors: list[Factor]

    def factor(self, name: str) -> Factor:
        for f in self.factors:
            if f.name == name:
                return f
        raise KeyError(name)


# ---------------------------------------------------------------------------
# Phase 2 — Combinatorial matrix
# ---------------------------------------------------------------------------


class TestConfiguration(BaseModel):
    """One row of the matrix M — a complete test setup."""

    id: str = Field(default_factory=lambda: uuid4().hex[:8])
    assignments: dict[str, Any]  # factor_name -> level
    covered_triplets: int = 0


class TestMatrix(BaseModel):
    factors: list[Factor]
    rows: list[TestConfiguration]
    total_triplets: int
    coverage_percent: float


# ---------------------------------------------------------------------------
# Phase 3 / 5 — Sandbox
# ---------------------------------------------------------------------------


class ToolCall(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: Any | None = None


class TurnResult(BaseModel):
    agent_response: str
    tools_called: list[ToolCall] = Field(default_factory=list)
    turn_count: int


class ConversationTurn(BaseModel):
    role: Literal["tester", "agent", "system"]
    content: str
    tool_calls: list[ToolCall] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Phase 4 — MCTS
# ---------------------------------------------------------------------------


class Verdict(str, Enum):
    SUCCESS = "agent_success"     # agent withstood the attack: reward 0
    FAILURE = "agent_failure"     # tester succeeded: reward 1
    NEAR_MISS = "near_miss"       # agent almost gave in: reward 0.5
    NEUTRAL = "neutral"           # ongoing
    TIMEOUT = "timeout"           # depth exceeded with no resolution


class Evaluation(BaseModel):
    verdict: Verdict
    reward: float
    rationale: str = ""
    signals: dict[str, Any] = Field(default_factory=dict)


class MCTSNode(BaseModel):
    node_id: str = Field(default_factory=lambda: uuid4().hex[:10])
    parent_id: str | None = None
    snapshot_id: str | None = None
    text_prompt: str = ""           # the tester's prompt that produced this state
    agent_response: str = ""        # response observed (post-execution)
    tool_calls: list[ToolCall] = Field(default_factory=list)
    visits: int = 0
    value: float = 0.0
    children: list["MCTSNode"] = Field(default_factory=list)
    is_terminal: bool = False
    evaluation: Evaluation | None = None
    depth: int = 0


MCTSNode.model_rebuild()


# ---------------------------------------------------------------------------
# Test run results
# ---------------------------------------------------------------------------


class TestCaseResult(BaseModel):
    test_id: str
    assignments: dict[str, Any]
    iterations: int
    best_reward: float
    failure_found: bool
    near_miss_found: bool
    failing_path: list[ConversationTurn] = Field(default_factory=list)
    tree: MCTSNode
    cost_estimate_usd: float = 0.0
    llm_calls: int = 0


class SuiteResult(BaseModel):
    suite_id: str
    cases: list[TestCaseResult]
    summary: dict[str, Any] = Field(default_factory=dict)
