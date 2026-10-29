"""Shared paths and settings for the Orbit Atlas pipeline."""
from pathlib import Path
import datetime as dt

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "src" / "data"
MAPPINGS = Path(__file__).resolve().parent / "mappings"

# Day 0 of the integer launch/decay day scale (Sputnik 1 launch).
EPOCH = dt.date(1957, 10, 4)
NO_DECAY_DAY = 99999  # sentinel for "still in orbit"

TOP_OPERATORS = 15      # operator_group: top-N operators, rest -> "Other"
TOP_COUNTRIES = 12      # palette priority for countries

# Display-space compression: r = 1 + K * sqrt(alt_km / R_EARTH_KM)
R_EARTH_KM = 6378.137
K_SCALE = 0.30


def snapshot_time():
    """UTC datetime of the data snapshot = when the GP file (or else SATCAT) was downloaded."""
    f = RAW / "gp_active.json"
    if not f.exists():
        f = RAW / "satcat.csv"
    return dt.datetime.fromtimestamp(f.stat().st_mtime, tz=dt.timezone.utc).replace(microsecond=0)
