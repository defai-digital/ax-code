from .models import User
from .repository import Repository
from .validators import validate_email, validate_name


class UserService:
    def __init__(self, repo: Repository) -> None:
        self._repo = repo

    def register(self, user_id: int, name: str, email: str) -> User:
        if not validate_name(name) or not validate_email(email):
            raise ValueError("invalid user")
        user = User(user_id=user_id, name=name, email=email)
        self._repo.add_user(user)
        return user
