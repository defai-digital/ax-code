from .models import User


def user_to_dict(user: User) -> dict[str, object]:
    return {"user_id": user.user_id, "name": user.name, "email": user.email}
