"""Tables Router — table listing, schema, row counts."""

from fastapi import APIRouter, HTTPException
from services.db_manager import db_manager

router = APIRouter(prefix="/api/tables", tags=["tables"])


@router.get("")
async def list_tables():
    if not db_manager.connected:
        raise HTTPException(400, "No database open")

    tables = db_manager.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    result = []
    for t in tables:
        name = t["name"]
        safe = name.replace('"', '""')
        try:
            cnt = db_manager.execute(f'SELECT COUNT(*) AS c FROM "{safe}"')
            row_count = cnt[0]["c"]
        except Exception:
            row_count = -1

        cols = db_manager.execute(f'PRAGMA table_info("{safe}")')
        result.append({
            "name": name,
            "row_count": row_count,
            "column_count": len(cols),
        })

    return {"tables": result}


@router.get("/{name}/schema")
async def table_schema(name: str):
    if not db_manager.connected:
        raise HTTPException(400, "No database open")

    safe = name.replace('"', '""')
    cols = db_manager.execute(f'PRAGMA table_info("{safe}")')
    if not cols:
        raise HTTPException(404, f"Table not found: {name}")

    indexes = db_manager.execute(f'PRAGMA index_list("{safe}")')
    index_details = []
    for idx in indexes:
        idx_cols = db_manager.execute(f'PRAGMA index_info("{idx["name"]}")')
        index_details.append({
            "name": idx["name"],
            "unique": bool(idx["unique"]),
            "columns": [c["name"] for c in idx_cols],
        })

    # Get CREATE TABLE statement
    create_sql = db_manager.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)
    )

    return {
        "name": name,
        "columns": [
            {
                "cid": c["cid"],
                "name": c["name"],
                "type": c["type"],
                "notnull": bool(c["notnull"]),
                "default": c["dflt_value"],
                "pk": bool(c["pk"]),
            }
            for c in cols
        ],
        "indexes": index_details,
        "sql": create_sql[0]["sql"] if create_sql else "",
    }
