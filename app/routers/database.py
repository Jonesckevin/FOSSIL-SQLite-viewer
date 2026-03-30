"""Database Router — list, upload, open, delete databases."""

import os
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException

from services.db_manager import db_manager, UPLOAD_DIR
from services.wal_backup import backup_wal

router = APIRouter(prefix="/api/databases", tags=["databases"])


@router.get("")
async def list_databases():
    return {"databases": db_manager.list_databases()}


@router.post("/upload")
async def upload_database(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    safe_name = Path(file.filename).name
    if not safe_name or safe_name.startswith("."):
        raise HTTPException(400, "Invalid filename")

    dest = UPLOAD_DIR / safe_name
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    return {"name": safe_name, "size": dest.stat().st_size}


@router.delete("/{name}")
async def delete_database(name: str):
    safe_name = Path(name).name
    path = (UPLOAD_DIR / safe_name).resolve()
    if not str(path).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(400, "Invalid path")
    if not path.exists():
        raise HTTPException(404, "Database not found")

    if db_manager.db_name == safe_name:
        db_manager.close()

    path.unlink()
    # Remove WAL and SHM files if they exist
    for ext in ["-wal", "-shm"]:
        sidecar = path.with_suffix(path.suffix + ext)
        if sidecar.exists():
            sidecar.unlink()

    return {"deleted": safe_name}


@router.post("/{name}/open")
async def open_database(name: str):
    safe_name = Path(name).name
    path = (UPLOAD_DIR / safe_name).resolve()
    if not str(path).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(400, "Invalid path")
    if not path.exists():
        raise HTTPException(404, "Database not found")

    # Backup WAL before opening
    wal_info = backup_wal(path)

    try:
        stats = db_manager.open(safe_name)
    except Exception as e:
        raise HTTPException(500, f"Failed to open database: {e}")

    stats["wal_backup"] = wal_info
    return stats


@router.get("/stats")
async def get_stats():
    if not db_manager.connected:
        return {"connected": False}
    return db_manager.stats()


@router.post("/close")
async def close_database():
    db_manager.close()
    return {"closed": True}
