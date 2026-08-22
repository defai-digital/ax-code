from .repository import Repository


def count_users(repo: Repository) -> int:
    return len(repo._users)
