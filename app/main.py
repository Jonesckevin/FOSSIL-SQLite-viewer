from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pathlib import Path
import os

app = FastAPI(title="FOSSIL", version="1.0")

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "upload"
EXPORTS_DIR = BASE_DIR / "exports"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
(EXPORTS_DIR / "wal_backups").mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

from routers import database, tables, query, export, wal, decode, sql_query
from services.state_manager import router as state_router

app.include_router(database.router)
app.include_router(tables.router)
app.include_router(query.router)
app.include_router(export.router)
app.include_router(wal.router)
app.include_router(decode.router)
app.include_router(sql_query.router)
app.include_router(state_router)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
