from .auth import hash_token


def auth_middleware(headers: dict[str, str]) -> str | None:
    token = headers.get("authorization")
    return hash_token(token) if token else None
