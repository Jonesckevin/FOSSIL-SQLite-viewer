"""Export API endpoints — list, create, download, delete exports."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services import export_manager
from services.db_manager import db_manager

router = APIRouter(prefix="/api/exports", tags=["Export"])

EXPORT_DIR = Path("/app/exports")


class ExportRequest(BaseModel):
    table: str
    format: str = "csv"  # csv | json | sql


@router.get("")
def list_exports():
    return {"exports": export_manager.list_exports()}


@router.post("")
def create_export(req: ExportRequest):
    if not db_manager.db_name:
        raise HTTPException(400, "No database open")

    if req.format not in ('csv', 'json', 'sql'):
        raise HTTPException(400, f"Unsupported format: {req.format}")

    safe_table = req.table.replace('"', '""')

    # Fetch all rows
    try:
        rows = db_manager.execute(f'SELECT * FROM "{safe_table}"')
    except Exception as e:
        raise HTTPException(400, str(e))

    if req.format == 'csv':
        filename = export_manager.export_table_csv(rows, req.table)
    elif req.format == 'json':
        filename = export_manager.export_table_json(rows, req.table)
    else:
        # Need column info for SQL
        cols = db_manager.execute(f'PRAGMA table_info("{safe_table}")')
        filename = export_manager.export_table_sql(rows, req.table, cols)

    return {"filename": filename}


@router.get("/download/{filename:path}")
def download_export(filename: str):
    # Prevent path traversal
    safe = Path(filename)
    if '..' in safe.parts:
        raise HTTPException(400, "Invalid filename")

    filepath = EXPORT_DIR / safe
    if not filepath.exists():
        raise HTTPException(404, "File not found")

    return FileResponse(
        filepath,
        filename=safe.name,
        media_type="application/octet-stream",
    )


@router.delete("/{filename:path}")
def delete_export(filename: str):
    if not export_manager.delete_export(filename):
        raise HTTPException(404, "File not found or cannot be deleted")
    return {"deleted": filename}
