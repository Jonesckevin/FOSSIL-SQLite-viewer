"""Query Router — paginated data, search, BLOB retrieval."""

import re
import sqlite3
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Response

from services.db_manager import db_manager

router = APIRouter(prefix="/api/tables", tags=["query"])


@router.get("/{name}/rows")
async def get_rows(
    name: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=5000),
    sort_col: Optional[str] = None,
    sort_dir: str = Query("ASC", pattern="^(ASC|DESC)$"),
    search: Optional[str] = None,
    search_col: Optional[str] = None,
    regex: bool = False,
):
    if not db_manager.connected:
        raise HTTPException(400, "No database open")

    safe_table = name.replace('"', '""')

    # Get columns for validation
    cols_info = db_manager.execute(f'PRAGMA table_info("{safe_table}")')
    if not cols_info:
        raise HTTPException(404, f"Table not found: {name}")
    col_names = [c["name"] for c in cols_info]

    # Validate sort column
    if sort_col and sort_col not in col_names:
        sort_col = None

    # Check if table has rowid (not WITHOUT ROWID)
    has_rowid = True
    try:
        db_manager.execute(f'SELECT rowid FROM "{safe_table}" LIMIT 1')
    except Exception:
        has_rowid = False

    rowid_expr = "rowid" if has_rowid else "NULL"

    # Build query
    if search and not regex:
        # String search — use LIKE on specific column or all
        if search_col and search_col in col_names:
            safe_col = search_col.replace('"', '""')
            where = f' WHERE "{safe_col}" LIKE ?'
            params = [f"%{search}%"]
        else:
            clauses = [f'CAST("{c.replace(chr(34), chr(34)+chr(34))}" AS TEXT) LIKE ?' for c in col_names]
            where = f" WHERE ({' OR '.join(clauses)})"
            params = [f"%{search}%"] * len(col_names)
    elif search and regex:
        # Regex search — fetch all, filter in Python
        where = ""
        params = []
    else:
        where = ""
        params = []

    # Count total
    count_sql = f'SELECT COUNT(*) AS c FROM "{safe_table}"{where}'
    total = db_manager.execute(count_sql, tuple(params))[0]["c"]

    # Order
    order = ""
    if sort_col:
        safe_sort = sort_col.replace('"', '""')
        order = f' ORDER BY "{safe_sort}" {sort_dir}'
    elif has_rowid:
        order = " ORDER BY rowid ASC"

    if regex and search:
        # Fetch all rows then filter with regex in Python
        sql = f'SELECT {rowid_expr} AS _rowid, * FROM "{safe_table}"{order}'
        try:
            pattern = re.compile(search, re.IGNORECASE)
        except re.error:
            raise HTTPException(400, "Invalid regex pattern")

        rows_raw = db_manager.execute(sql)
        filtered = []
        for row in rows_raw:
            for cn in col_names:
                if search_col and cn != search_col:
                    continue
                val = row.get(cn)
                if val is not None and pattern.search(str(val)):
                    filtered.append(row)
                    break

        total = len(filtered)
        rows = filtered[offset:offset + limit]
    else:
        sql = f'SELECT {rowid_expr} AS _rowid, * FROM "{safe_table}"{where}{order} LIMIT ? OFFSET ?'
        params.extend([limit, offset])
        rows = db_manager.execute(sql, tuple(params))

    # Detect BLOBs — mark them with metadata
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
        "columns": col_names,
        "rows": processed,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_rowid": has_rowid,
    }


@router.get("/{name}/rows/{rowid:int}/blob/{column}")
async def get_blob(name: str, rowid: int, column: str):
    if not db_manager.connected:
        raise HTTPException(400, "No database open")

    safe_table = name.replace('"', '""')
    safe_col = column.replace('"', '""')

    cols_info = db_manager.execute(f'PRAGMA table_info("{safe_table}")')
    col_names = [c["name"] for c in cols_info]
    if column not in col_names:
        raise HTTPException(404, f"Column not found: {column}")

    try:
        rows = db_manager.execute(
            f'SELECT "{safe_col}" FROM "{safe_table}" WHERE rowid = ?', (rowid,)
        )
    except Exception:
        raise HTTPException(400, "Cannot retrieve BLOB (table may be WITHOUT ROWID)")

    if not rows:
        raise HTTPException(404, "Row not found")

    data = rows[0][column]
    if not isinstance(data, (bytes, bytearray)):
        raise HTTPException(400, "Value is not a BLOB")

    # Detect content type
    from services.blob_detector import detect_blob_type
    detected = detect_blob_type(data)
    content_type = detected.get("mime", "application/octet-stream")

    return Response(content=bytes(data), media_type=content_type)
