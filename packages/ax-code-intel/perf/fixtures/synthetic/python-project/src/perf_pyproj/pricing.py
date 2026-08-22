from .utils import clamp


def compute_total(base: float, tax_rate: float) -> float:
    taxed = base * (1.0 + tax_rate)
    return clamp(taxed, 0.0, 1_000_000.0)
