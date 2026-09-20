"""Scan API routes for SecureScan Pro X."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.dependencies import get_orchestrator, require_auth
from app.services.auth import User
from app.services.scan.engine import InMemoryScanEngine, ScanEngine

router = APIRouter(prefix="/scans", tags=["Scans"])

_scan_engine: ScanEngine | None = None


def _get_scan_engine() -> ScanEngine:
    global _scan_engine
    if _scan_engine is None:
        _scan_engine = InMemoryScanEngine()
    return _scan_engine


class PortScanRequest(BaseModel):
    target: str = Field(..., description="IP address or hostname to scan")
    ports: list[int] | None = Field(None, description="Specific ports to scan")
    timeout: float = Field(3.0, ge=0.5, le=30.0)


class HeaderCheckRequest(BaseModel):
    url: str = Field(..., description="URL to check headers for")


class PasswordCheckRequest(BaseModel):
    demo_mode: bool = Field(True, description="Run in demo mode with sample passwords")


class SSLCheckRequest(BaseModel):
    hostname: str = Field(..., description="Hostname to check SSL")
    port: int = Field(443, ge=1, le=65535)


class FullScanRequest(BaseModel):
    target: str = Field(..., description="Target to scan")
    scan_types: list[str] | None = Field(
        None,
        description="Scan types: port_scan, header_check, ssl_check",
    )


def _result_to_dict(result: object) -> dict:
    if hasattr(result, "__dict__"):
        d = {}
        for k, v in result.__dict__.items():
            if k.startswith("_"):
                continue
            if isinstance(v, list):
                v = [_result_to_dict(item) if hasattr(item, "__dict__") else item for item in v]
            elif isinstance(v, dict):
                v = {kk: _result_to_dict(vv) if hasattr(vv, "__dict__") else vv for kk, vv in v.items()}
            elif hasattr(v, "value"):
                v = v.value
            d[k] = v
        return d
    return {"value": str(result)}


@router.post("/port-scan")
async def run_port_scan(
    request: PortScanRequest,
    user: User = Depends(require_auth),
) -> dict:
    engine = _get_scan_engine()
    result = await engine.run_port_scan(
        target=request.target,
        ports=request.ports,
        timeout=request.timeout,
    )
    return _result_to_dict(result)


@router.post("/header-check")
async def run_header_check(
    request: HeaderCheckRequest,
    user: User = Depends(require_auth),
) -> dict:
    engine = _get_scan_engine()
    result = await engine.run_header_check(url=request.url)
    return _result_to_dict(result)


@router.post("/password-check")
async def run_password_check(
    request: PasswordCheckRequest,
    user: User = Depends(require_auth),
) -> dict:
    engine = _get_scan_engine()
    result = await engine.run_password_check(demo_mode=request.demo_mode)
    return _result_to_dict(result)


@router.post("/ssl-check")
async def run_ssl_check(
    request: SSLCheckRequest,
    user: User = Depends(require_auth),
) -> dict:
    engine = _get_scan_engine()
    result = await engine.run_ssl_check(hostname=request.hostname, port=request.port)
    return _result_to_dict(result)


@router.post("/full-scan")
async def run_full_scan(
    request: FullScanRequest,
    user: User = Depends(require_auth),
) -> dict:
    engine = _get_scan_engine()
    results = await engine.run_full_scan(
        target=request.target,
        scan_types=request.scan_types,
    )
    return {k: _result_to_dict(v) for k, v in results.items()}


@router.get("/history")
async def get_scan_history(
    user: User = Depends(require_auth),
) -> list[dict]:
    engine = _get_scan_engine()
    history = engine.get_scan_history()
    return [_result_to_dict(r) for r in history]
