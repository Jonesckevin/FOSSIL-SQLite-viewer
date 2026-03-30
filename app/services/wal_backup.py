"""WAL Backup — preserve WAL file before SQLite checkpoints it."""

import shutil
from datetime import datetime, timezone
from pathlib import Path

WAL_BACKUP_DIR = Path("/app/exports/wal_backups")


def backup_wal(db_path: Path) -> dict:
    """If a WAL file exists adjacent to db_path, copy it to wal_backups/."""
    wal_path = db_path.with_suffix(db_path.suffix + "-wal")
    if not wal_path.exists():
        return {"backed_up": False, "reason": "no WAL file"}

    WAL_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    dest = WAL_BACKUP_DIR / f"{db_path.stem}_{ts}.wal"

    shutil.copy2(str(wal_path), str(dest))
    return {
        "backed_up": True,
        "source": str(wal_path),
        "backup": str(dest),
        "size": dest.stat().st_size,
    }
