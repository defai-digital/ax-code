def validate_email(email: str) -> bool:
    return "@" in email and "." in email


def validate_name(name: str) -> bool:
    return len(name.strip()) > 0
