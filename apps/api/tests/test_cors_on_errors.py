"""Regression: unhandled 500s must still carry CORS headers.

Starlette's CORSMiddleware only decorates responses that flow back through it;
an unhandled exception is caught by the outermost ServerErrorMiddleware and the
resulting 500 skips CORS, reaching the browser with no Access-Control-Allow-
Origin header. The browser then can't read the body and reports the generic
"Failed to fetch" — which once masked a schema-drift 500 on /api/auth/login as a
phantom network error. app.main re-attaches CORS headers on 500 to prevent that.

DB-free: exercises the exception handler wiring, not any endpoint.
"""
from __future__ import annotations

from starlette.testclient import TestClient

from app.main import _cors_headers_for, app

# Present in the dev-default CORS allowlist (see app/config.Settings).
ALLOWED_ORIGIN = "http://localhost:3000"
DISALLOWED_ORIGIN = "https://evil.example"


def test_cors_headers_helper_matches_only_allowed_origins():
    assert _cors_headers_for(ALLOWED_ORIGIN)["Access-Control-Allow-Origin"] == ALLOWED_ORIGIN
    assert _cors_headers_for(ALLOWED_ORIGIN)["Access-Control-Allow-Credentials"] == "true"
    assert _cors_headers_for(DISALLOWED_ORIGIN) == {}
    assert _cors_headers_for(None) == {}


def test_unhandled_500_carries_cors_header_for_allowed_origin():
    @app.get("/_test_boom")
    def _boom():  # pragma: no cover - body raises before returning
        raise RuntimeError("simulated unhandled error")

    added_route = app.router.routes[-1]
    try:
        # raise_server_exceptions=False mimics a real client receiving the 500
        # over the wire rather than re-raising it in-process.
        client = TestClient(app, raise_server_exceptions=False)

        allowed = client.get("/_test_boom", headers={"Origin": ALLOWED_ORIGIN})
        assert allowed.status_code == 500
        assert allowed.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN
        assert allowed.headers.get("access-control-allow-credentials") == "true"

        # A disallowed origin must not receive a permissive CORS header.
        disallowed = client.get("/_test_boom", headers={"Origin": DISALLOWED_ORIGIN})
        assert disallowed.status_code == 500
        assert disallowed.headers.get("access-control-allow-origin") is None
    finally:
        app.router.routes.remove(added_route)
