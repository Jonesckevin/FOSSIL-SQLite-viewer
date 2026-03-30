FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .

# Download Bootstrap CSS/JS and Icons locally for offline use
RUN mkdir -p /app/static/vendor && \
    curl -fsSL -o /app/static/vendor/bootstrap.min.css \
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" && \
    curl -fsSL -o /app/static/vendor/bootstrap.bundle.min.js \
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" && \
    curl -fsSL -o /app/static/vendor/bootstrap-icons.min.css \
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" && \
    mkdir -p /app/static/vendor/fonts && \
    curl -fsSL -o /app/static/vendor/fonts/bootstrap-icons.woff2 \
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2" && \
    curl -fsSL -o /app/static/vendor/fonts/bootstrap-icons.woff \
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff"

RUN mkdir -p /app/upload /app/exports/wal_backups

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--loop", "asyncio"]
