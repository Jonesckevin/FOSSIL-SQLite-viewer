"""SQL Query Router — execute read-only SQL, manage saved queries."""

import json
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db_manager import db_manager

router = APIRouter(prefix="/api/sql", tags=["SQL Query"])

SAVED_QUERIES_FILE = Path("/app/exports/saved_queries.json")

# ── Validation ──────────────────────────────────────────────

# Statements that are allowed (read-only)
_ALLOWED_RE = re.compile(
    r"^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b", re.IGNORECASE
)

# Statements / keywords that are forbidden
_FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|REINDEX|VACUUM|GRANT|REVOKE)\b",
    re.IGNORECASE,
)


def _validate_sql(sql: str) -> str:
    """Validate that SQL is read-only. Returns cleaned SQL."""
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        raise HTTPException(400, "Empty query")

    if not _ALLOWED_RE.match(cleaned):
        raise HTTPException(
            400, "Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed"
        )

    if _FORBIDDEN_RE.search(cleaned):
        raise HTTPException(
            400, "Query contains forbidden write operations"
        )

    return cleaned


# ── Execute endpoint ────────────────────────────────────────

class ExecuteRequest(BaseModel):
    sql: str
    limit: int = 500


@router.post("/execute")
def execute_sql(req: ExecuteRequest):
    if not db_manager.connected:
        raise HTTPException(400, "No database open")

    sql = _validate_sql(req.sql)

    # Enforce row limit for safety — but not for PRAGMA/EXPLAIN
    limit = min(req.limit, 5000)
    has_limit = re.search(r"\bLIMIT\s+\d+", sql, re.IGNORECASE)
    is_pragma = re.match(r"^\s*(PRAGMA|EXPLAIN)\b", sql, re.IGNORECASE)

    try:
        if has_limit or is_pragma:
            rows = db_manager.execute(sql)
        else:
            rows = db_manager.execute(f"{sql} LIMIT ?", (limit,))
    except sqlite3.OperationalError as e:
        raise HTTPException(400, f"SQL error: {e}")
    except Exception as e:
        raise HTTPException(400, f"Query failed: {e}")

    # Process rows — handle BLOBs
    columns = list(rows[0].keys()) if rows else []
    processed = []
    for row in rows:
        pr = {}
        for k, v in row.items():
            if isinstance(v, (bytes, bytearray)):
                pr[k] = {"__blob__": True, "size": len(v)}
            else:
                pr[k] = v
        processed.append(pr)

    return {
        "columns": columns,
        "rows": processed,
        "total": len(processed),
        "truncated": not has_limit and len(processed) >= limit,
    }


# ── Saved queries ──────────────────────────────────────────

class SaveQueryRequest(BaseModel):
    name: str
    sql: str
    description: Optional[str] = ""


def _load_saved() -> list[dict]:
    if not SAVED_QUERIES_FILE.exists():
        return []
    try:
        return json.loads(SAVED_QUERIES_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_all(queries: list[dict]):
    SAVED_QUERIES_FILE.write_text(
        json.dumps(queries, indent=2, default=str), encoding="utf-8"
    )


@router.get("/saved")
def list_saved_queries():
    return {"queries": _load_saved()}


@router.post("/saved")
def save_query(req: SaveQueryRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Query name is required")

    queries = _load_saved()

    # Check for duplicate name
    for q in queries:
        if q["name"] == name:
            # Update existing
            q["sql"] = req.sql
            q["description"] = req.description or ""
            _save_all(queries)
            return {"saved": q}

    new_query = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "sql": req.sql,
        "description": req.description or "",
    }
    queries.append(new_query)
    _save_all(queries)
    return {"saved": new_query}


@router.delete("/saved/{query_id}")
def delete_saved_query(query_id: str):
    queries = _load_saved()
    filtered = [q for q in queries if q["id"] != query_id]
    if len(filtered) == len(queries):
        raise HTTPException(404, "Query not found")
    _save_all(filtered)
    return {"deleted": query_id}


@router.get("/saved/export")
def export_saved_queries():
    from fastapi.responses import Response

    queries = _load_saved()
    content = json.dumps(queries, indent=2, default=str)
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": "attachment; filename=saved_queries.json"
        },
    )
