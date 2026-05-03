"""Tiny in-memory store for suite inputs / matrices / results.

Keeps things simple for v0.1; swap for SQLite/Redis later.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Any
from uuid import uuid4

from .models import SuiteResult, TestMatrix, TestSuiteInput


@dataclass
class _Store:
    suites: dict[str, dict[str, Any]] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    def create_suite(self, payload: TestSuiteInput) -> str:
        sid = uuid4().hex[:8]
        with self._lock:
            self.suites[sid] = {
                "input": payload,
                "matrix": None,
                "result": None,
                "events": [],
                "status": "draft",
            }
        return sid

    def set_matrix(self, sid: str, matrix: TestMatrix) -> None:
        with self._lock:
            self.suites[sid]["matrix"] = matrix
            self.suites[sid]["status"] = "matrix_ready"

    def set_result(self, sid: str, result: SuiteResult) -> None:
        with self._lock:
            self.suites[sid]["result"] = result
            self.suites[sid]["status"] = "completed"

    def append_event(self, sid: str, event: dict[str, Any]) -> None:
        with self._lock:
            self.suites[sid]["events"].append(event)

    def set_status(self, sid: str, status: str) -> None:
        with self._lock:
            self.suites[sid]["status"] = status

    def get(self, sid: str) -> dict[str, Any] | None:
        return self.suites.get(sid)


store = _Store()
