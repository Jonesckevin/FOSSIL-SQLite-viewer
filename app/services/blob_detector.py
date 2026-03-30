"""BLOB Detector — magic byte detection for common formats."""

SIGNATURES = [
    (b'\xff\xd8\xff', "image/jpeg", ".jpg", "JPEG Image"),
    (b'\x89PNG\r\n\x1a\n', "image/png", ".png", "PNG Image"),
    (b'GIF87a', "image/gif", ".gif", "GIF Image (87a)"),
    (b'GIF89a', "image/gif", ".gif", "GIF Image (89a)"),
    (b'II\x2a\x00', "image/tiff", ".tiff", "TIFF Image (LE)"),
    (b'MM\x00\x2a', "image/tiff", ".tiff", "TIFF Image (BE)"),
    (b'RIFF', "image/webp", ".webp", "WebP Image"),  # Needs further check
    (b'%PDF', "application/pdf", ".pdf", "PDF Document"),
    (b'PK\x03\x04', "application/zip", ".zip", "ZIP Archive"),
    (b'\x1f\x8b', "application/gzip", ".gz", "GZIP Archive"),
    (b'SQLite format 3', "application/x-sqlite3", ".sqlite", "SQLite Database"),
    (b'bplist', "application/x-bplist", ".plist", "Binary Plist"),
    (b'<?xml', "application/xml", ".xml", "XML Document"),
    (b'ID3', "audio/mpeg", ".mp3", "MP3 Audio (ID3)"),
    (b'\xff\xfb', "audio/mpeg", ".mp3", "MP3 Audio"),
    (b'\xff\xf3', "audio/mpeg", ".mp3", "MP3 Audio"),
    (b'\x00\x00\x00\x1cftyp', "video/mp4", ".mp4", "MP4 Video"),
    (b'\x00\x00\x00\x20ftyp', "video/mp4", ".mp4", "MP4 Video"),
    (b'\x7fELF', "application/x-elf", ".elf", "ELF Executable"),
    (b'MZ', "application/x-dosexec", ".exe", "PE Executable"),
]


def detect_blob_type(data: bytes) -> dict:
    if not data:
        return {"mime": "application/octet-stream", "ext": ".bin", "description": "Empty BLOB"}

    for sig, mime, ext, desc in SIGNATURES:
        if data[:len(sig)] == sig:
            # Extra check for RIFF/WebP
            if sig == b'RIFF' and len(data) >= 12:
                if data[8:12] == b'WEBP':
                    return {"mime": "image/webp", "ext": ".webp", "description": "WebP Image"}
                elif data[8:12] == b'WAVE':
                    return {"mime": "audio/wav", "ext": ".wav", "description": "WAV Audio"}
                elif data[8:12] == b'AVI ':
                    return {"mime": "video/avi", "ext": ".avi", "description": "AVI Video"}
                return {"mime": "application/octet-stream", "ext": ".riff", "description": "RIFF Container"}
            return {"mime": mime, "ext": ext, "description": desc}

    # Check for text
    try:
        data[:1024].decode('utf-8')
        return {"mime": "text/plain", "ext": ".txt", "description": "UTF-8 Text"}
    except (UnicodeDecodeError, ValueError):
        pass

    return {"mime": "application/octet-stream", "ext": ".bin", "description": "Unknown Binary"}
