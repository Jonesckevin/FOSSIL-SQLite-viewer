"""WAL API endpoints — header, frames, records, summary, transactions, export."""

import csv
import io
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse

from services.wal_parser import WalParser
from services.db_manager import db_manager

router = APIRouter(prefix="/api/wal", tags=["WAL"])

UPLOAD_DIR = Path("/app/upload")
EXPORT_DIR = Path("/app/exports")

# Cached parser for the active WAL
_parser: Optional[WalParser] = None
_parser_wal_path: Optional[str] = None


def _get_parser(force: bool = False) -> WalParser:
    global _parser, _parser_wal_path

    db_name = db_manager.db_name
    if not db_name:
        raise HTTPException(400, "No database open")

    db_path = UPLOAD_DIR / db_name
    wal_path = db_path.parent / (db_path.name + "-wal")

    if not wal_path.exists():
        raise HTTPException(404, "No WAL file found")

    if wal_path.stat().st_size == 0:
        raise HTTPException(404, "WAL file is empty (database may have been checkpointed)")

    wal_key = str(wal_path)
    if not force and _parser and _parser_wal_path == wal_key:
        return _parser

    parser = WalParser(wal_path, db_path)
    parser.parse()
    _parser = parser
    _parser_wal_path = wal_key
    return parser


@router.get("/status")
def wal_status():
    db_name = db_manager.db_name
    if not db_name:
        return {"exists": False}

    db_path = UPLOAD_DIR / db_name
    wal_path = db_path.parent / (db_path.name + "-wal")
    exists = wal_path.exists()

    return {
        "exists": exists,
        "wal_size": wal_path.stat().st_size if exists else 0,
        "wal_name": wal_path.name if exists else None,
    }


@router.get("/header")
def wal_header():
    parser = _get_parser()
    return parser.get_header()


@router.get("/frames")
def wal_frames(
    status: Optional[str] = Query(None),
    table: Optional[str] = Query(None),
    page_type: Optional[int] = Query(None),
    page_num: Optional[int] = Query(None),
):
    parser = _get_parser()
    frames = parser.get_frames(status=status, table=table,
                               page_type=page_type, page_num=page_num)
    return {"frames": frames, "total": len(frames)}


@router.get("/frames/{index}")
def wal_frame_detail(index: int):
    parser = _get_parser()
    if index < 0 or index >= len(parser.frames):
        raise HTTPException(404, "Frame not found")
    return parser.frames[index]


@router.get("/records")
def wal_records(
    filter_type: str = Query("all"),
    table: Optional[str] = Query(None),
):
    parser = _get_parser()
    records = parser.get_records(filter_type=filter_type)
    if table:
        records = [r for r in records if r['table_name'] == table]
    return {"records": records, "total": len(records)}


@router.get("/summary")
def wal_summary():
    parser = _get_parser()
    return parser.get_summary()


@router.get("/transactions")
def wal_transactions():
    parser = _get_parser()
    return {"transactions": parser.get_transactions()}


@router.post("/reload")
def wal_reload():
    """Force re-parse of the WAL file."""
    parser = _get_parser(force=True)
    return {"frames": len(parser.frames)}


@router.post("/load")
async def wal_load(file: UploadFile = File(...)):
    """Upload a standalone WAL file for analysis."""
    if not file.filename:
        raise HTTPException(400, "No file uploaded")

    # Validate filename
    safe_name = Path(file.filename).name
    if not safe_name:
        raise HTTPException(400, "Invalid filename")

    wal_dest = UPLOAD_DIR / safe_name
    content = await file.read()
    wal_dest.write_bytes(content)

    # Parse without a DB reference
    parser = WalParser(wal_dest)
    parser.parse()

    global _parser, _parser_wal_path
    _parser = parser
    _parser_wal_path = str(wal_dest)

    return {
        "name": safe_name,
        "size": len(content),
        "frames": len(parser.frames),
    }


@router.get("/export/frames-csv")
def export_frames_csv():
    parser = _get_parser()
    frames = parser.get_frames()

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        'index', 'page_number', 'page_type_name', 'cell_count',
        'commit_size', 'is_commit', 'status', 'table_name', 'salt1', 'salt2'
    ])
    writer.writeheader()
    for f in frames:
        writer.writerow({k: f.get(k, '') for k in writer.fieldnames})

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wal_frames.csv"}
    )


@router.get("/export/records-csv")
def export_records_csv(filter_type: str = Query("all")):
    parser = _get_parser()
    records = parser.get_records(filter_type=filter_type)

    if not records:
        raise HTTPException(404, "No records to export")

    # Find max value count for column headers
    max_cols = max((len(r.get('values', [])) for r in records), default=0)

    output = io.StringIO()
    base_fields = ['frame_index', 'page_number', 'table_name', 'rowid',
                   'diff', 'status', 'payload_size']
    val_fields = [f'col_{i}' for i in range(max_cols)]

    writer = csv.writer(output)
    writer.writerow(base_fields + val_fields)

    for r in records:
        base = [r.get(f, '') for f in base_fields]
        vals = r.get('values', [])
        # Pad values to max_cols
        vals_str = []
        for v in vals:
            if isinstance(v, dict) and v.get('__blob__'):
                vals_str.append(f"[BLOB {v['size']}B]")
            else:
                vals_str.append(str(v) if v is not None else '')
        vals_str.extend([''] * (max_cols - len(vals_str)))
        writer.writerow(base + vals_str)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wal_records.csv"}
    )
