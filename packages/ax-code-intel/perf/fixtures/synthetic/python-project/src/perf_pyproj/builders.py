from .models import User


def build_user(user_id: int, name: str, email: str) -> User:
    return User(user_id=user_id, name=name, email=email)
