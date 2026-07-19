"""Desktop-only FastAPI protections and local UI hosting."""

from __future__ import annotations

import hashlib
import hmac
import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse


DESKTOP_TOKEN_HEADER = "x-myailibrary-desktop-token"


def configure_desktop_app(app: FastAPI) -> threading.Event:
    """Attach desktop middleware and routes after the regular API is registered."""
    expected_token = os.environ["MYAI_DESKTOP_TOKEN"]
    ui_dir_value = os.getenv("MYAI_UI_DIR", "").strip()
    ui_dir = Path(ui_dir_value).resolve() if ui_dir_value else None
    shutdown_event = threading.Event()

    @app.middleware("http")
    async def require_desktop_token(request: Request, call_next):
        supplied = request.headers.get(DESKTOP_TOKEN_HEADER, "")
        if not hmac.compare_digest(supplied, expected_token):
            return JSONResponse(status_code=401, content={"detail": "Desktop session token required"})

        response = await call_next(request)
        if ui_dir and request.method == "GET":
            response.headers.setdefault(
                "Content-Security-Policy",
                "; ".join(
                    (
                        "default-src 'self'",
                        "script-src 'self'",
                        "style-src 'self' 'unsafe-inline'",
                        "font-src 'self' data:",
                        "img-src 'self' data: blob: https:",
                        "media-src 'self' data: blob:",
                        "worker-src 'self' blob:",
                        "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://securetoken.googleapis.com",
                        "frame-src 'self' blob:",
                        "object-src 'none'",
                        "base-uri 'self'",
                        "frame-ancestors 'none'",
                    )
                ),
            )
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    @app.get("/desktop/health", include_in_schema=False)
    def desktop_health():
        data_dir = Path(os.environ["MYAI_DATA_DIR"])
        return {
            "status": "ok",
            "mode": "desktop",
            "data_dir_hash": hashlib.sha256(str(data_dir).encode("utf-8")).hexdigest()[:12],
        }

    @app.post("/desktop/shutdown", include_in_schema=False)
    def desktop_shutdown():
        shutdown_event.set()
        return {"status": "shutting-down"}

    if ui_dir:
        index_file = ui_dir / "index.html"
        if not index_file.is_file():
            raise RuntimeError(f"Desktop UI index not found: {index_file}")

        @app.get("/{full_path:path}", include_in_schema=False)
        def desktop_ui(full_path: str):
            requested = (ui_dir / full_path).resolve()
            try:
                requested.relative_to(ui_dir)
            except ValueError as exc:
                raise HTTPException(status_code=404, detail="Not found") from exc

            if full_path and requested.is_file():
                return FileResponse(requested)
            if full_path and "." in Path(full_path).name:
                raise HTTPException(status_code=404, detail="Asset not found")
            return FileResponse(index_file)

    return shutdown_event
