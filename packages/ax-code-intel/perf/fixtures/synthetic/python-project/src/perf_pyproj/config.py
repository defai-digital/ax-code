from dataclasses import dataclass


@dataclass
class Settings:
    debug: bool = False
    workers: int = 4
