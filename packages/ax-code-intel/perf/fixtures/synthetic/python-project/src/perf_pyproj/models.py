from dataclasses import dataclass, field


@dataclass
class User:
    user_id: int
    name: str
    email: str
    tags: list[str] = field(default_factory=list)


@dataclass
class Order:
    order_id: int
    user_id: int
    total: float
