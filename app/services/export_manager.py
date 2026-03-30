"""Export Manager — handles CSV/JSON/SQL export of tables and query results."""

import csv
import io
import json
import os
from datetime import datetime
from pathlib import Path

EXPORT_DIR = Path("/app/exports")


def list_exports() -> list[dict]:
    """List all files in the exports directory."""
    exports = []
    for f in sorted(EXPORT_DIR.iterdir()):
        if f.is_file() and f.name != '.app_state.json':
            stat = f.stat()
            exports.append({
                'name': f.name,
                'size': stat.st_size,
                'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    # Also list wal_backups
    wal_dir = EXPORT_DIR / 'wal_backups'
    if wal_dir.is_dir():
        for f in sorted(wal_dir.iterdir()):
            if f.is_file():
                stat = f.stat()
                exports.append({
                    'name': f'wal_backups/{f.name}',
                    'size': stat.st_size,
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
    return exports


def export_table_csv(rows: list[dict], table_name: str) -> str:
    """Export rows as CSV. Returns filename."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{table_name}_{ts}.csv"
    filepath = EXPORT_DIR / filename

    if not rows:
        filepath.write_text('')
        return filename

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()

    for row in rows:
        clean = {}
        for k, v in row.items():
            if isinstance(v, dict) and v.get('__blob__'):
                clean[k] = f"[BLOB {v['size']}B]"
            elif isinstance(v, (bytes, bytearray)):
                clean[k] = f"[BLOB {len(v)}B]"
            else:
                clean[k] = v
        writer.writerow(clean)

    filepath.write_text(output.getvalue(), encoding='utf-8')
    return filename


def export_table_json(rows: list[dict], table_name: str) -> str:
    """Export rows as JSON. Returns filename."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{table_name}_{ts}.json"
    filepath = EXPORT_DIR / filename

    clean_rows = []
    for row in rows:
        clean = {}
        for k, v in row.items():
            if isinstance(v, dict) and v.get('__blob__'):
                clean[k] = f"[BLOB {v['size']}B]"
            elif isinstance(v, (bytes, bytearray)):
                clean[k] = f"[BLOB {len(v)}B]"
            else:
                clean[k] = v
        clean_rows.append(clean)

    filepath.write_text(json.dumps(clean_rows, indent=2, default=str), encoding='utf-8')
    return filename


def export_table_sql(rows: list[dict], table_name: str, columns: list[dict]) -> str:
    """Export rows as SQL INSERT statements. Returns filename."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{table_name}_{ts}.sql"
    filepath = EXPORT_DIR / filename

    safe_table = table_name.replace('"', '""')
    col_names = [c['name'] for c in columns]
    col_list = ', '.join(f'"{c.replace(chr(34), chr(34)+chr(34))}"' for c in col_names)

    lines = [f'-- Export of "{safe_table}" at {datetime.now().isoformat()}', '']

    for row in rows:
        vals = []
        for cn in col_names:
            v = row.get(cn)
            if v is None:
                vals.append('NULL')
            elif isinstance(v, dict) and v.get('__blob__'):
                vals.append('NULL /* BLOB */')
            elif isinstance(v, (int, float)):
                vals.append(str(v))
            else:
                safe_v = str(v).replace("'", "''")
                vals.append(f"'{safe_v}'")
        val_list = ', '.join(vals)
        lines.append(f'INSERT INTO "{safe_table}" ({col_list}) VALUES ({val_list});')

    filepath.write_text('\n'.join(lines), encoding='utf-8')
    return filename


def delete_export(filename: str) -> bool:
    """Delete an export file. Returns True if deleted."""
    # Prevent path traversal
    safe = Path(filename)
    if '..' in safe.parts:
        return False
    filepath = EXPORT_DIR / safe
    if filepath.exists() and filepath.is_file():
        filepath.unlink()
        return True
    return False
