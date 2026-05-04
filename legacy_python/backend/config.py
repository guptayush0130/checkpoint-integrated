"""Runtime configuration. Reads from environment variables (and an optional .env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:
    pass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _bool_from_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "").strip()
    openai_base_url: str = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()

    tester_model: str = os.environ.get("TESTER_MODEL", "gpt-4o-mini")
    judge_model: str = os.environ.get("JUDGE_MODEL", "gpt-4o-mini")
    target_agent_model: str = os.environ.get("TARGET_AGENT_MODEL", "gpt-4o-mini")

    max_llm_calls_per_test: int = _int("MAX_LLM_CALLS_PER_TEST", 60)
    max_concurrent_tests: int = _int("MAX_CONCURRENT_TESTS", 2)

    mcts_max_iterations: int = _int("MCTS_MAX_ITERATIONS", 20)
    mcts_max_depth: int = _int("MCTS_MAX_DEPTH", 6)
    mcts_branching: int = _int("MCTS_BRANCHING", 3)
    mcts_ucb_c: float = _float("MCTS_UCB_C", 1.41)
    mcts_near_miss_bonus: float = _float("MCTS_NEAR_MISS_BONUS", 0.35)

    # Phase 1 — optional batched LLM call when parsing DB string factors
    parse_db_string_with_llm: bool = _bool_from_env("PARSE_DB_STRING_WITH_LLM", True)
    parse_db_string_model: str = os.environ.get("PARSE_DB_STRING_MODEL", "").strip()

    @property
    def offline_mode(self) -> bool:
        return not self.openai_api_key


settings = Settings()
