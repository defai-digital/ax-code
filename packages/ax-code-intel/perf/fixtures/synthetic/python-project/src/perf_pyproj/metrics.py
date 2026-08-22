def counter_inc(counts: dict[str, int], key: str) -> None:
    counts[key] = counts.get(key, 0) + 1
