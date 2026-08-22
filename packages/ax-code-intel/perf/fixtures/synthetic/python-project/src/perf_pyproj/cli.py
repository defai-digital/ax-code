from .repository import Repository
from .service import UserService


def main() -> None:
    service = UserService(Repository())
    user = service.register(1, "ada", "ada@example.com")
    print(user.name)
