"""WAL Parser — Pure binary WAL parser with full B-tree depth.

Parses WAL file using mmap, extracts frames, classifies them,
parses B-tree pages (interior/leaf/overflow), and reconstructs records.
"""

import mmap
import struct
from pathlib import Path
from typing import Optional, BinaryIO

# ── WAL header constants ────────────────────────────────────────────
WAL_MAGIC_BE = 0x377F0682
WAL_MAGIC_LE = 0x377F0683
WAL_HEADER_SIZE = 32
FRAME_HEADER_SIZE = 24


class WalHeader:
    __slots__ = ('magic', 'format_version', 'page_size', 'checkpoint_seq',
                 'salt1', 'salt2', 'checksum1', 'checksum2', 'big_endian')

    def __init__(self, data: bytes):
        magic = struct.unpack('>I', data[0:4])[0]
        if magic == WAL_MAGIC_BE:
            self.big_endian = True
        elif magic == WAL_MAGIC_LE:
            self.big_endian = False
        else:
            raise ValueError(f"Invalid WAL magic: 0x{magic:08x}")

        fmt = '>' if self.big_endian else '<'
        self.magic = magic
        self.format_version = struct.unpack(f'{fmt}I', data[4:8])[0]
        self.page_size = struct.unpack(f'{fmt}I', data[8:12])[0]
        self.checkpoint_seq = struct.unpack(f'{fmt}I', data[12:16])[0]
        self.salt1 = struct.unpack(f'{fmt}I', data[16:20])[0]
        self.salt2 = struct.unpack(f'{fmt}I', data[20:24])[0]
        self.checksum1 = struct.unpack(f'{fmt}I', data[24:28])[0]
        self.checksum2 = struct.unpack(f'{fmt}I', data[28:32])[0]

    def to_dict(self):
        return {
            'magic': f'0x{self.magic:08x}',
            'format_version': self.format_version,
            'page_size': self.page_size,
            'checkpoint_seq': self.checkpoint_seq,
            'salt1': self.salt1,
            'salt2': self.salt2,
            'checksum1': self.checksum1,
            'checksum2': self.checksum2,
            'endianness': 'big' if self.big_endian else 'little',
        }


class FrameHeader:
    __slots__ = ('page_number', 'commit_size', 'salt1', 'salt2',
                 'checksum1', 'checksum2', 'offset', 'frame_index')

    def __init__(self, data: bytes, big_endian: bool, offset: int, index: int):
        fmt = '>' if big_endian else '<'
        self.page_number = struct.unpack(f'{fmt}I', data[0:4])[0]
        self.commit_size = struct.unpack(f'{fmt}I', data[4:8])[0]
        self.salt1 = struct.unpack(f'{fmt}I', data[8:12])[0]
        self.salt2 = struct.unpack(f'{fmt}I', data[12:16])[0]
        self.checksum1 = struct.unpack(f'{fmt}I', data[16:20])[0]
        self.checksum2 = struct.unpack(f'{fmt}I', data[20:24])[0]
        self.offset = offset
        self.frame_index = index


# ── B-tree page types ────────────────────────────────────────────────
PAGE_INTERIOR_INDEX = 2
PAGE_INTERIOR_TABLE = 5
PAGE_LEAF_INDEX = 10
PAGE_LEAF_TABLE = 13

PAGE_TYPE_NAMES = {
    PAGE_INTERIOR_INDEX: "Interior Index",
    PAGE_INTERIOR_TABLE: "Interior Table",
    PAGE_LEAF_INDEX: "Leaf Index",
    PAGE_LEAF_TABLE: "Leaf Table",
}


def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    """Read SQLite varint. Returns (value, bytes_consumed)."""
    result = 0
    for i in range(9):
        if offset + i >= len(data):
            return result, i
        b = data[offset + i]
        if i < 8:
            result = (result << 7) | (b & 0x7F)
            if b < 0x80:
                return result, i + 1
        else:
            result = (result << 8) | b
            return result, 9
    return result, 9


def _serial_type_size(st: int) -> int:
    """Return byte size of a serial type value."""
    if st == 0: return 0  # NULL
    if st == 1: return 1  # int8
    if st == 2: return 2  # int16
    if st == 3: return 3  # int24
    if st == 4: return 4  # int32
    if st == 5: return 6  # int48
    if st == 6: return 8  # int64
    if st == 7: return 8  # float64
    if st == 8: return 0  # 0
    if st == 9: return 0  # 1
    if st >= 12 and st % 2 == 0: return (st - 12) // 2  # BLOB
    if st >= 13 and st % 2 == 1: return (st - 13) // 2  # TEXT
    return 0


def _decode_serial_value(st: int, data: bytes) -> object:
    """Decode a value given its serial type and raw bytes."""
    if st == 0: return None
    if st == 1: return struct.unpack('>b', data[:1])[0]
    if st == 2: return struct.unpack('>h', data[:2])[0]
    if st == 3: return int.from_bytes(data[:3], 'big', signed=True)
    if st == 4: return struct.unpack('>i', data[:4])[0]
    if st == 5: return int.from_bytes(data[:6], 'big', signed=True)
    if st == 6: return struct.unpack('>q', data[:8])[0]
    if st == 7: return struct.unpack('>d', data[:8])[0]
    if st == 8: return 0
    if st == 9: return 1
    if st >= 12 and st % 2 == 0:
        size = (st - 12) // 2
        return bytes(data[:size])
    if st >= 13 and st % 2 == 1:
        size = (st - 13) // 2
        try:
            return data[:size].decode('utf-8')
        except UnicodeDecodeError:
            return data[:size].decode('latin-1')
    return None


def _parse_record(data: bytes, offset: int) -> list:
    """Parse a SQLite record payload into a list of values."""
    if offset >= len(data):
        return []

    header_size, consumed = _read_varint(data, offset)
    if header_size == 0:
        return []

    header_end = offset + header_size
    pos = offset + consumed

    serial_types = []
    while pos < header_end and pos < len(data):
        st, c = _read_varint(data, pos)
        serial_types.append(st)
        pos += c

    # Decode values
    values = []
    data_pos = header_end
    for st in serial_types:
        size = _serial_type_size(st)
        if data_pos + size > len(data):
            values.append(None)
            data_pos += size
            continue
        val = _decode_serial_value(st, data[data_pos:data_pos + size])
        # Convert bytes to hex representation for JSON serialization
        if isinstance(val, bytes):
            val = {"__blob__": True, "size": len(val), "hex_preview": val[:32].hex()}
        values.append(val)
        data_pos += size

    return values


class BTreePage:
    """Parse a single B-tree page from raw page data."""

    def __init__(self, page_data: bytes, page_number: int, page_size: int):
        self.page_number = page_number
        self.page_size = page_size
        self.raw = page_data

        # Page 1 has a 100-byte DB header
        self.header_offset = 100 if page_number == 1 else 0

        if len(page_data) < self.header_offset + 8:
            self.page_type = 0
            self.cells = []
            self.right_child = None
            return

        off = self.header_offset
        self.page_type = page_data[off]
        self.first_freeblock = struct.unpack('>H', page_data[off+1:off+3])[0]
        self.cell_count = struct.unpack('>H', page_data[off+3:off+5])[0]
        self.cell_content_offset = struct.unpack('>H', page_data[off+5:off+7])[0]
        self.fragmented_bytes = page_data[off+7]

        self.right_child = None
        if self.page_type in (PAGE_INTERIOR_INDEX, PAGE_INTERIOR_TABLE):
            if len(page_data) >= off + 12:
                self.right_child = struct.unpack('>I', page_data[off+8:off+12])[0]
            cell_ptr_start = off + 12
        else:
            cell_ptr_start = off + 8

        # Read cell pointer array
        self.cell_pointers = []
        for i in range(self.cell_count):
            ptr_off = cell_ptr_start + i * 2
            if ptr_off + 2 > len(page_data):
                break
            ptr = struct.unpack('>H', page_data[ptr_off:ptr_off+2])[0]
            self.cell_pointers.append(ptr)

        self.cells = []
        for ptr in self.cell_pointers:
            cell = self._parse_cell(ptr)
            if cell:
                self.cells.append(cell)

    def _parse_cell(self, ptr: int) -> Optional[dict]:
        """Parse a cell based on page type."""
        data = self.raw
        if ptr >= len(data):
            return None

        try:
            if self.page_type == PAGE_LEAF_TABLE:
                return self._parse_leaf_table_cell(data, ptr)
            elif self.page_type == PAGE_INTERIOR_TABLE:
                return self._parse_interior_table_cell(data, ptr)
            elif self.page_type == PAGE_LEAF_INDEX:
                return self._parse_leaf_index_cell(data, ptr)
            elif self.page_type == PAGE_INTERIOR_INDEX:
                return self._parse_interior_index_cell(data, ptr)
        except Exception:
            return None
        return None

    def _parse_leaf_table_cell(self, data: bytes, ptr: int) -> dict:
        payload_size, c1 = _read_varint(data, ptr)
        rowid, c2 = _read_varint(data, ptr + c1)

        header_start = ptr + c1 + c2
        # Max local payload: usable_size - 35
        usable = self.page_size
        max_local = usable - 35
        min_local = ((usable - 12) * 32 // 255) - 23

        local_size = payload_size
        overflow_page = 0
        if payload_size > max_local:
            local_size = min_local + ((payload_size - min_local) % (usable - 4))
            if local_size > max_local:
                local_size = min_local
            overflow_offset = header_start + local_size
            if overflow_offset + 4 <= len(data):
                overflow_page = struct.unpack('>I', data[overflow_offset:overflow_offset+4])[0]

        payload = data[header_start:header_start + min(local_size, len(data) - header_start)]
        values = _parse_record(payload, 0) if payload else []

        return {
            'type': 'leaf_table',
            'rowid': rowid,
            'payload_size': payload_size,
            'local_size': local_size,
            'overflow_page': overflow_page,
            'values': values,
        }

    def _parse_interior_table_cell(self, data: bytes, ptr: int) -> dict:
        if ptr + 4 > len(data):
            return None
        left_child = struct.unpack('>I', data[ptr:ptr+4])[0]
        rowid, c = _read_varint(data, ptr + 4)
        return {
            'type': 'interior_table',
            'left_child': left_child,
            'rowid': rowid,
        }

    def _parse_leaf_index_cell(self, data: bytes, ptr: int) -> dict:
        payload_size, c = _read_varint(data, ptr)
        header_start = ptr + c
        payload = data[header_start:header_start + min(payload_size, len(data) - header_start)]
        values = _parse_record(payload, 0) if payload else []
        return {
            'type': 'leaf_index',
            'payload_size': payload_size,
            'values': values,
        }

    def _parse_interior_index_cell(self, data: bytes, ptr: int) -> dict:
        if ptr + 4 > len(data):
            return None
        left_child = struct.unpack('>I', data[ptr:ptr+4])[0]
        payload_size, c = _read_varint(data, ptr + 4)
        header_start = ptr + 4 + c
        payload = data[header_start:header_start + min(payload_size, len(data) - header_start)]
        values = _parse_record(payload, 0) if payload else []
        return {
            'type': 'interior_index',
            'left_child': left_child,
            'payload_size': payload_size,
            'values': values,
        }


class WalParser:
    """Full WAL parser with B-tree page analysis and record extraction."""

    def __init__(self, wal_path: str | Path, db_path: Optional[str | Path] = None):
        self.wal_path = Path(wal_path)
        self.db_path = Path(db_path) if db_path else None
        self._mm: Optional[mmap.mmap] = None
        self._file: Optional[BinaryIO] = None
        self.header: Optional[WalHeader] = None
        self.frames: list[dict] = []
        self._page_table_map: dict[int, str] = {}  # page_num -> table_name

    def parse(self):
        """Parse the entire WAL file."""
        self._open()
        try:
            self._parse_header()
            self._parse_frames()
            self._classify_frames()
            if self.db_path and self.db_path.exists():
                self._build_page_table_map()
        finally:
            self._close()

    def _open(self):
        self._file = open(self.wal_path, 'rb')
        if self._file.seek(0, 2) == 0:
            self._file.close()
            self._file = None
            raise ValueError("WAL file is empty")
        self._file.seek(0)
        self._mm = mmap.mmap(self._file.fileno(), 0, access=mmap.ACCESS_READ)

    def _close(self):
        if self._mm:
            self._mm.close()
            self._mm = None
        if self._file:
            self._file.close()
            self._file = None

    def _parse_header(self):
        if len(self._mm) < WAL_HEADER_SIZE:
            raise ValueError("WAL file too small for header")
        self.header = WalHeader(self._mm[:WAL_HEADER_SIZE])

    def _parse_frames(self):
        page_size = self.header.page_size
        frame_size = FRAME_HEADER_SIZE + page_size
        offset = WAL_HEADER_SIZE
        index = 0

        while offset + frame_size <= len(self._mm):
            fh = FrameHeader(
                self._mm[offset:offset + FRAME_HEADER_SIZE],
                self.header.big_endian,
                offset,
                index
            )

            page_offset = offset + FRAME_HEADER_SIZE
            page_data = self._mm[page_offset:page_offset + page_size]

            # Parse B-tree page
            btree = BTreePage(page_data, fh.page_number, page_size)

            frame = {
                'index': index,
                'page_number': fh.page_number,
                'commit_size': fh.commit_size,
                'salt1': fh.salt1,
                'salt2': fh.salt2,
                'offset': offset,
                'page_type': btree.page_type,
                'page_type_name': PAGE_TYPE_NAMES.get(btree.page_type, f"Other ({btree.page_type})"),
                'cell_count': btree.cell_count,
                'right_child': btree.right_child,
                'cells': btree.cells,
                'is_commit': fh.commit_size > 0,
                'status': 'unknown',
                'table_name': None,
            }
            self.frames.append(frame)

            offset += frame_size
            index += 1

    def _classify_frames(self):
        """Classify frames as Saved, Unsaved, or Overwritten."""
        if not self.header or not self.frames:
            return

        wal_salt1 = self.header.salt1
        wal_salt2 = self.header.salt2

        # Track latest frame for each page number
        latest_for_page: dict[int, int] = {}
        for frame in self.frames:
            pn = frame['page_number']
            latest_for_page[pn] = frame['index']

        for frame in self.frames:
            salt_matches = (frame['salt1'] == wal_salt1 and frame['salt2'] == wal_salt2)
            is_latest = (latest_for_page.get(frame['page_number']) == frame['index'])

            if not salt_matches:
                frame['status'] = 'saved'  # From before last checkpoint
            elif is_latest:
                frame['status'] = 'unsaved'  # Current, not yet checkpointed
            else:
                frame['status'] = 'overwritten'  # Superseded by later frame

    def _build_page_table_map(self):
        """Map page numbers to table names using the DB's sqlite_master."""
        if not self.db_path:
            return

        import sqlite3
        try:
            conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row

            tables = conn.execute(
                "SELECT name, rootpage FROM sqlite_master WHERE type='table'"
            ).fetchall()

            for t in tables:
                root = t['rootpage']
                if root:
                    self._page_table_map[root] = t['name']

            conn.close()
        except Exception:
            pass

        # Assign table names to frames based on root pages
        for frame in self.frames:
            pn = frame['page_number']
            if pn in self._page_table_map:
                frame['table_name'] = self._page_table_map[pn]

    def get_header(self) -> dict:
        return self.header.to_dict() if self.header else {}

    def get_frames(self, status: str = None, table: str = None,
                   page_type: int = None, page_num: int = None) -> list[dict]:
        """Return frames with optional filtering."""
        result = []
        for f in self.frames:
            if status and f['status'] != status:
                continue
            if table and f['table_name'] != table:
                continue
            if page_type is not None and f['page_type'] != page_type:
                continue
            if page_num is not None and f['page_number'] != page_num:
                continue

            # Return frame without raw cells for listing
            result.append({
                'index': f['index'],
                'page_number': f['page_number'],
                'commit_size': f['commit_size'],
                'salt1': f['salt1'],
                'salt2': f['salt2'],
                'page_type': f['page_type'],
                'page_type_name': f['page_type_name'],
                'cell_count': f['cell_count'],
                'is_commit': f['is_commit'],
                'status': f['status'],
                'table_name': f['table_name'],
            })
        return result

    def get_records(self, filter_type: str = 'all') -> list[dict]:
        """Extract all records from WAL leaf table pages with DB comparison.

        filter_type: all | different | wal_only | wal_tables | same
        """
        records = []

        # Get DB records for comparison
        db_records = self._load_db_records() if self.db_path else {}

        for frame in self.frames:
            if frame['page_type'] != PAGE_LEAF_TABLE:
                continue

            table_name = frame['table_name'] or f"page_{frame['page_number']}"
            is_wal_only_table = table_name.startswith('page_')

            for cell in frame['cells']:
                if cell.get('type') != 'leaf_table':
                    continue

                rowid = cell.get('rowid')
                values = cell.get('values', [])

                # Determine diff status
                if is_wal_only_table:
                    diff = '★'  # WAL-only table
                elif table_name in db_records:
                    if rowid in db_records[table_name]:
                        db_vals = db_records[table_name][rowid]
                        diff = '✓' if self._values_match(values, db_vals) else '≠'
                    else:
                        diff = '∅'  # Not in DB
                else:
                    diff = '★'  # WAL-only table

                # Apply filter
                if filter_type == 'different' and diff != '≠':
                    continue
                if filter_type == 'wal_only' and diff not in ('∅', '★'):
                    continue
                if filter_type == 'wal_tables' and diff != '★':
                    continue
                if filter_type == 'same' and diff != '✓':
                    continue

                records.append({
                    'frame_index': frame['index'],
                    'page_number': frame['page_number'],
                    'table_name': table_name,
                    'rowid': rowid,
                    'values': values,
                    'diff': diff,
                    'status': frame['status'],
                    'payload_size': cell.get('payload_size', 0),
                    'has_overflow': cell.get('overflow_page', 0) > 0,
                })

        return records

    def _load_db_records(self) -> dict[str, dict[int, list]]:
        """Load current DB records for comparison."""
        result = {}
        if not self.db_path or not self.db_path.exists():
            return result

        import sqlite3
        try:
            conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()

            for (tname,) in tables:
                safe = tname.replace('"', '""')
                try:
                    cur = conn.execute(f'SELECT rowid, * FROM "{safe}"')
                    table_records = {}
                    for row in cur:
                        table_records[row[0]] = list(row[1:])
                    result[tname] = table_records
                except Exception:
                    pass

            conn.close()
        except Exception:
            pass
        return result

    def _values_match(self, wal_vals: list, db_vals: list) -> bool:
        """Compare WAL record values with DB record values."""
        if len(wal_vals) != len(db_vals):
            return False
        for wv, dv in zip(wal_vals, db_vals):
            # Normalize for comparison
            if isinstance(wv, dict) and wv.get('__blob__'):
                if not isinstance(dv, (bytes, bytearray)):
                    return False
                continue  # Can't compare BLOB content from WAL hex preview
            if isinstance(dv, (bytes, bytearray)):
                continue  # Skip BLOB comparison
            if wv != dv:
                return False
        return True

    def get_summary(self) -> dict:
        """Per-table summary statistics."""
        tables = {}
        for frame in self.frames:
            tn = frame['table_name'] or f"page_{frame['page_number']}"
            if tn not in tables:
                tables[tn] = {
                    'name': tn,
                    'frame_count': 0,
                    'record_count': 0,
                    'saved': 0, 'unsaved': 0, 'overwritten': 0,
                    'page_types': set(),
                }
            t = tables[tn]
            t['frame_count'] += 1
            t[frame['status']] += 1
            t['page_types'].add(frame['page_type_name'])
            if frame['page_type'] == PAGE_LEAF_TABLE:
                t['record_count'] += frame['cell_count']

        # Convert sets to lists for JSON
        for t in tables.values():
            t['page_types'] = list(t['page_types'])

        return {'tables': list(tables.values()), 'total_frames': len(self.frames)}

    def get_transactions(self) -> list[dict]:
        """Group frames by transaction (salt values + commit markers)."""
        transactions = []
        current_tx = {'frames': [], 'salt1': None, 'salt2': None}

        for frame in self.frames:
            if current_tx['salt1'] is None:
                current_tx['salt1'] = frame['salt1']
                current_tx['salt2'] = frame['salt2']

            if frame['salt1'] != current_tx['salt1'] or frame['salt2'] != current_tx['salt2']:
                if current_tx['frames']:
                    transactions.append(current_tx)
                current_tx = {
                    'frames': [],
                    'salt1': frame['salt1'],
                    'salt2': frame['salt2'],
                }

            current_tx['frames'].append(frame['index'])

            if frame['is_commit']:
                transactions.append(current_tx)
                current_tx = {'frames': [], 'salt1': None, 'salt2': None}

        if current_tx['frames']:
            transactions.append(current_tx)

        return [
            {
                'index': i,
                'frame_count': len(tx['frames']),
                'frame_range': [tx['frames'][0], tx['frames'][-1]] if tx['frames'] else [],
                'salt1': tx['salt1'],
                'salt2': tx['salt2'],
            }
            for i, tx in enumerate(transactions)
        ]
