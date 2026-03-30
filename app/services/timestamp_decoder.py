"""Timestamp Decoder — multi-format timestamp auto-detection and decoding."""

import base64
import binascii
from datetime import datetime, timezone, timedelta

# Epoch references
UNIX_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
WEBKIT_EPOCH = datetime(1601, 1, 1, tzinfo=timezone.utc)
COCOA_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)

# Reasonable date range: 1970-01-01 to 2100-01-01
MIN_DT = datetime(1970, 1, 1, tzinfo=timezone.utc)
MAX_DT = datetime(2100, 1, 1, tzinfo=timezone.utc)


def _in_range(dt: datetime) -> bool:
    return MIN_DT <= dt <= MAX_DT


def decode_timestamp(value) -> list[dict]:
    """Decode a numeric value into all plausible timestamp formats."""
    results = []

    try:
        v = float(value)
    except (ValueError, TypeError):
        return results

    # Unix Epoch — seconds
    try:
        dt = UNIX_EPOCH + timedelta(seconds=v)
        if _in_range(dt):
            results.append({
                "format": "Unix Epoch (seconds)",
                "value": dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "iso": dt.isoformat(),
            })
    except (OverflowError, OSError, ValueError):
        pass

    # Unix Epoch — milliseconds
    try:
        dt = UNIX_EPOCH + timedelta(milliseconds=v)
        if _in_range(dt):
            results.append({
                "format": "Unix Epoch (milliseconds)",
                "value": dt.strftime("%Y-%m-%d %H:%M:%S.%f UTC"),
                "iso": dt.isoformat(),
            })
    except (OverflowError, OSError, ValueError):
        pass

    # WebKit/Chrome — microseconds since 1601-01-01
    try:
        dt = WEBKIT_EPOCH + timedelta(microseconds=v)
        if _in_range(dt):
            results.append({
                "format": "WebKit/Chrome (µs since 1601-01-01)",
                "value": dt.strftime("%Y-%m-%d %H:%M:%S.%f UTC"),
                "iso": dt.isoformat(),
            })
    except (OverflowError, OSError, ValueError):
        pass

    # Windows FILETIME — 100ns since 1601-01-01
    try:
        dt = WEBKIT_EPOCH + timedelta(microseconds=v / 10)
        if _in_range(dt):
            results.append({
                "format": "Windows FILETIME (100ns since 1601-01-01)",
                "value": dt.strftime("%Y-%m-%d %H:%M:%S.%f UTC"),
                "iso": dt.isoformat(),
            })
    except (OverflowError, OSError, ValueError):
        pass

    # Mac/Cocoa — seconds since 2001-01-01
    try:
        dt = COCOA_EPOCH + timedelta(seconds=v)
        if _in_range(dt):
            results.append({
                "format": "Mac/Cocoa (seconds since 2001-01-01)",
                "value": dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "iso": dt.isoformat(),
            })
    except (OverflowError, OSError, ValueError):
        pass

    # GPS Time — seconds since 1980-01-06
    try:
        dt = GPS_EPOCH + timedelta(seconds=v)
        if _in_range(dt):
            results.append({
                "format": "GPS Time (seconds since 1980-01-06)",
                "value": dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "iso": dt.isoformat(),
            })
    except (OverflowError, OSError, ValueError):
        pass

    return results


def decode_base64(value: str) -> dict:
    """Decode a Base64-encoded string."""
    try:
        decoded = base64.b64decode(value)
        try:
            text = decoded.decode('utf-8')
            return {"success": True, "text": text, "hex": decoded.hex(), "size": len(decoded)}
        except UnicodeDecodeError:
            return {"success": True, "text": None, "hex": decoded.hex(), "size": len(decoded)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def decode_hex(value: str) -> dict:
    """Decode a hex-encoded string."""
    clean = value.replace(' ', '').replace('\n', '').replace('0x', '')
    try:
        decoded = binascii.unhexlify(clean)
        try:
            text = decoded.decode('utf-8')
            return {"success": True, "text": text, "size": len(decoded)}
        except UnicodeDecodeError:
            return {"success": True, "text": None, "hex": clean, "size": len(decoded)}
    except Exception as e:
        return {"success": False, "error": str(e)}
