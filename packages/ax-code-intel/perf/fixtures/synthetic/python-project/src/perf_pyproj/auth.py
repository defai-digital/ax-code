import hashlib

from .utils import slugify


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_subject(name: str) -> str:
    return slugify(name)
