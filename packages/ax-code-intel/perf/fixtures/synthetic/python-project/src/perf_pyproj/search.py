from .models import User
from .repository import Repository


def search_users(repo: Repository, name: str) -> list[User]:
    return [u for u in repo._users.values() if name in u.name]
