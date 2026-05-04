"""Abstract Sandbox interface — Phase 3 of the spec."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..models import ConversationTurn, TurnResult


class Sandbox(ABC):
    @abstractmethod
    def initialize(self, db_config: dict[str, Any]) -> str:
        """Reset environment and apply DB config. Returns a session id."""

    @abstractmethod
    def execute_turn(self, session_id: str, text_prompt: str) -> TurnResult:
        """Send one tester message; returns the agent's response and any tool calls."""

    @abstractmethod
    def get_state(self, session_id: str) -> dict[str, Any]:
        """Return the current sandbox state (DB + flags + verdict heuristics)."""

    @abstractmethod
    def get_history(self, session_id: str) -> list[ConversationTurn]:
        """Full conversation transcript so far."""

    @abstractmethod
    def create_snapshot(self, session_id: str) -> str:
        """Persist a snapshot of state + memory; returns a snapshot id."""

    @abstractmethod
    def restore_snapshot(self, session_id: str, snapshot_id: str) -> bool:
        """Roll the session back to the given snapshot. Returns success."""
