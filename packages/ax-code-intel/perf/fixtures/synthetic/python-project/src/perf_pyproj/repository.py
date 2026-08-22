from .models import Order, User


class Repository:
    def __init__(self) -> None:
        self._users: dict[int, User] = {}
        self._orders: dict[int, Order] = {}

    def add_user(self, user: User) -> None:
        self._users[user.user_id] = user

    def get_user(self, user_id: int) -> User | None:
        return self._users.get(user_id)
