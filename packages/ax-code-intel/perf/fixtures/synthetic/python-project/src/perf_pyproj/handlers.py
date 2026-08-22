from .events import Event
from .logging import get_logger


def handle_event(event: Event) -> None:
    logger = get_logger("handlers")
    logger.info("event %s", event.topic)
