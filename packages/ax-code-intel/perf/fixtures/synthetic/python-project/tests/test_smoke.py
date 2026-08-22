from perf_pyproj.repository import Repository
from perf_pyproj.service import UserService


def test_register() -> None:
    service = UserService(Repository())
    user = service.register(1, "ada", "ada@example.com")
    assert user.name == "ada"
