"""FastAPI entry point.

Routes:

  GET  /                         → static UI
  POST /api/suites               → create suite from JSON payload
  POST /api/suites/upload        → create suite from a YAML/JSON file upload
  GET  /api/suites/{sid}         → get suite state (input + matrix + result)
  POST /api/suites/{sid}/matrix  → generate the 3-way matrix
  POST /api/suites/{sid}/run     → execute the suite (sync; SSE for progress)
  GET  /api/suites/{sid}/events  → SSE stream of progress events
  GET  /api/example              → load the bundled example
  GET  /api/config               → expose runtime mode (offline?, model names)
"""
from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .matrix import generate_3way_matrix
from .models import AgentSpec, SandboxSchema, TestSuiteInput
from .parsing import parse_inputs
from .runner import run_suite
from .store import store


app = FastAPI(title="AI Agent Testing Framework")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "examples"

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


# ---------------------------------------------------------------------------
# Config endpoint
# ---------------------------------------------------------------------------


@app.get("/api/config")
def get_config():
    return {
        "offline_mode": settings.offline_mode,
        "tester_model": settings.tester_model,
        "judge_model": settings.judge_model,
        "target_agent_model": settings.target_agent_model,
        "max_llm_calls_per_test": settings.max_llm_calls_per_test,
        "mcts": {
            "max_iterations": settings.mcts_max_iterations,
            "max_depth": settings.mcts_max_depth,
            "branching": settings.mcts_branching,
            "ucb_c": settings.mcts_ucb_c,
            "near_miss_bonus": settings.mcts_near_miss_bonus,
        },
    }


# ---------------------------------------------------------------------------
# Suite lifecycle
# ---------------------------------------------------------------------------


@app.post("/api/suites")
def create_suite(payload: TestSuiteInput):
    sid = store.create_suite(payload)
    return {"suite_id": sid}


@app.post("/api/suites/upload")
async def upload_suite(file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8")
    try:
        if file.filename and file.filename.endswith((".yaml", ".yml")):
            data = yaml.safe_load(raw)
        else:
            data = json.loads(raw)
    except Exception as e:
        raise HTTPException(400, f"could not parse file: {e}")
    try:
        payload = TestSuiteInput.model_validate(data)
    except Exception as e:
        raise HTTPException(400, f"invalid suite payload: {e}")
    sid = store.create_suite(payload)
    return {"suite_id": sid}


@app.get("/api/suites/{sid}")
def get_suite(sid: str):
    suite = store.get(sid)
    if suite is None:
        raise HTTPException(404, "suite not found")
    return {
        "suite_id": sid,
        "status": suite["status"],
        "input": suite["input"],
        "matrix": suite["matrix"],
        "result": suite["result"],
    }


class MatrixOptions(BaseModel):
    max_rows: int = 30
    seed: int = 1234


@app.post("/api/suites/{sid}/matrix")
def build_matrix(sid: str, opts: MatrixOptions = MatrixOptions()):
    suite = store.get(sid)
    if suite is None:
        raise HTTPException(404, "suite not found")
    variables = parse_inputs(suite["input"])
    matrix = generate_3way_matrix(
        variables, max_rows=opts.max_rows, seed=opts.seed
    )
    store.set_matrix(sid, matrix)
    return {"variables": variables, "matrix": matrix}


@app.post("/api/suites/{sid}/run")
def run_suite_endpoint(sid: str):
    suite = store.get(sid)
    if suite is None:
        raise HTTPException(404, "suite not found")
    if suite["matrix"] is None:
        raise HTTPException(400, "matrix has not been built; POST /matrix first")
    if suite["status"] == "running":
        raise HTTPException(409, "suite is already running")

    store.set_status(sid, "running")

    def _progress(kind: str, payload: dict[str, Any]):
        store.append_event(sid, {"kind": kind, "payload": payload})

    def _go():
        try:
            result = run_suite(
                agent_spec=suite["input"].agent_spec,
                matrix=suite["matrix"],
                progress=_progress,
            )
            store.set_result(sid, result)
            store.append_event(sid, {"kind": "done", "payload": result.summary})
        except Exception as e:
            store.append_event(sid, {"kind": "error", "payload": {"error": str(e)}})
            store.set_status(sid, "error")

    threading.Thread(target=_go, daemon=True).start()
    return {"status": "started"}


@app.get("/api/suites/{sid}/events")
async def suite_events(sid: str):
    suite = store.get(sid)
    if suite is None:
        raise HTTPException(404, "suite not found")

    async def stream():
        cursor = 0
        while True:
            events = store.get(sid)["events"]
            while cursor < len(events):
                ev = events[cursor]
                cursor += 1
                yield f"data: {json.dumps(ev, default=str)}\n\n"
                if ev.get("kind") in {"done", "error"}:
                    return
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/api/example")
def get_example():
    path = EXAMPLES_DIR / "customer_support_suite.json"
    if not path.exists():
        raise HTTPException(404, "example missing")
    return json.loads(path.read_text())


# ---------------------------------------------------------------------------
# Convenience: smoke endpoint
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {"ok": True, "offline_mode": settings.offline_mode}
