"""Database Manager — singleton managing the active SQLite connection (read-only)."""

import os
import sqlite3
import threading
from pathlib import Path
from typing import Optional

UPLOAD_DIR = Path("/app/upload")


class _DBManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self._db_name: Optional[str] = None
        self._db_path: Optional[Path] = None

    # ── connection ──────────────────────────────────────────

    def open(self, db_name: str) -> dict:
        path = UPLOAD_DIR / db_name
        if not path.exists():
            raise FileNotFoundError(f"Database not found: {db_name}")
        # Resolve path to avoid traversal
        path = path.resolve()
        if not str(path).startswith(str(UPLOAD_DIR.resolve())):
            raise ValueError("Invalid database path")

        with self._lock:
            self._close_unlocked()
            uri = f"file:{path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only = ON")
            self._conn = conn
            self._db_name = db_name
            self._db_path = path
        return self.stats()

    def _close_unlocked(self):
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
            self._db_name = None
            self._db_path = None

    def close(self):
        with self._lock:
            self._close_unlocked()

    @property
    def connected(self) -> bool:
        return self._conn is not None

    @property
    def db_name(self) -> Optional[str]:
        return self._db_name

    @property
    def db_path(self) -> Optional[Path]:
        return self._db_path

    # ── queries ─────────────────────────────────────────────

    def execute(self, sql: str, params: tuple = ()) -> list[dict]:
        if not self._conn:
            raise RuntimeError("No database open")
        with self._lock:
            cur = self._conn.execute(sql, params)
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    def execute_raw(self, sql: str, params: tuple = ()):
        """Return cursor for streaming / pagination."""
        if not self._conn:
            raise RuntimeError("No database open")
        return self._conn.execute(sql, params)

    # ── metadata ────────────────────────────────────────────

    def stats(self) -> dict:
        if not self._conn:
            return {"connected": False}

        tables = self.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        table_names = [t["name"] for t in tables]

        total_rows = 0
        for tn in table_names:
            safe = tn.replace('"', '""')
            try:
                r = self.execute(f'SELECT COUNT(*) AS c FROM "{safe}"')
                total_rows += r[0]["c"]
            except Exception:
                pass

        file_size = self._db_path.stat().st_size if self._db_path else 0
        page_size = self.execute("PRAGMA page_size")[0]["page_size"]
        journal = self.execute("PRAGMA journal_mode")[0]["journal_mode"]

        wal_path = self._db_path.with_suffix(self._db_path.suffix + "-wal") if self._db_path else None
        wal_exists = wal_path.exists() if wal_path else False
        wal_size = wal_path.stat().st_size if wal_exists else 0

        return {
            "connected": True,
            "db_name": self._db_name,
            "table_count": len(table_names),
            "total_rows": total_rows,
            "file_size": file_size,
            "page_size": page_size,
            "journal_mode": journal,
            "wal_exists": wal_exists,
            "wal_size": wal_size,
        }

    def list_databases(self) -> list[str]:
        if not UPLOAD_DIR.exists():
            return []
        exts = {".db", ".sqlite", ".sqlite3", ".sqlitedb", ".db3", ".s3db", ""}
        result = []
        for f in sorted(UPLOAD_DIR.iterdir()):
            if f.is_file() and f.suffix.lower() in exts and not f.name.startswith("."):
                result.append(f.name)
        return result


db_manager = _DBManager()
