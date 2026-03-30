"""Decode Router — timestamp, Base64, hex decoding endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel
from services.timestamp_decoder import decode_timestamp, decode_base64, decode_hex

router = APIRouter(prefix="/api/decode", tags=["decode"])


class TimestampRequest(BaseModel):
    value: float


class StringRequest(BaseModel):
    value: str


@router.post("/timestamp")
async def decode_ts(body: TimestampRequest):
    results = decode_timestamp(body.value)
    return {"results": results}


@router.post("/base64")
async def decode_b64(body: StringRequest):
    return decode_base64(body.value)


@router.post("/hex")
async def decode_hx(body: StringRequest):
    return decode_hex(body.value)
