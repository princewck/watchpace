"""Validate a parent-selected endpoint; there is intentionally no default gateway."""

from urllib.parse import urlsplit


def validate_origin(value):
    if not isinstance(value, str) or any(c.isspace() for c in value):
        raise ValueError("Copy the complete HTTPS endpoint from the phone setup page")
    u = urlsplit(value)
    if (
        u.scheme != "https"
        or not u.hostname
        or u.username
        or u.password
        or u.path not in ("", "/")
        or u.query
        or u.fragment
        or (u.port is not None and not 1 <= u.port <= 65535)
    ):
        raise ValueError(
            "An HTTPS origin without credentials, query or path is required"
        )
    return value.rstrip("/")
