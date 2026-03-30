"""State Manager — persistent server-side UI state in exports/.app_state.json."""

import json
from pathlib import Path
from fastapi import APIRouter

STATE_FILE = Path("/app/exports/.app_state.json")

router = APIRouter(prefix="/api/state", tags=["state"])

DEFAULTS = {
    "active_db": None,
    "selected_table": None,
    "column_visibility": {},
    "column_widths": {},
    "search": {"text": "", "regex": False, "table": "", "column": ""},
    "wal_virtual_merge": False,
    "theme": "system",
    "page_size": 50,
    "sidebar_width": 260,
    "detail_height": 220,
}


def _load() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            merged = {**DEFAULTS, **data}
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULTS)


def _save(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


@router.get("")
async def get_state():
    return _load()


@router.put("")
async def update_state(body: dict):
    state = _load()
    state.update(body)
    _save(state)
    return state


@router.delete("")
async def reset_state():
    state = dict(DEFAULTS)
    _save(state)
    return state
