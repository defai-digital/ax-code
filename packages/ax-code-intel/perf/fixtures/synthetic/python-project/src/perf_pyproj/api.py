from .events import Event
from .handlers import handle_event


def post_event(topic: str, payload: dict[str, str]) -> None:
    handle_event(Event(topic=topic, payload=payload))
