from dataclasses import dataclass


@dataclass
class Event:
    topic: str
    payload: dict[str, str]
