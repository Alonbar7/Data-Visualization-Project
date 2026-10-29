"""Yearly counts, breakdowns and meta.json (palettes, sources, coverage) from satellites.parquet."""
import datetime as dt
import json
import pandas as pd
from config import RAW, OUT, EPOCH, NO_DECAY_DAY, K_SCALE, R_EARTH_KM, snapshot_time

COLORS = ["#4cc9f0", "#f72585", "#ffd166", "#80ed99", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171",
          "#60a5fa", "#e879f9", "#a3e635", "#fbbf24", "#38bdf8", "#fb7185", "#c4b5fd", "#34d399"]
OTHER, UNKNOWN = "#6b7280", "#475569"
PURPOSE_COLORS = {"Communications": "#4cc9f0", "Earth Observation": "#80ed99", "Navigation": "#ffd166",
                  "Weather": "#a78bfa", "Science": "#f472b6", "Technology Demonstration": "#fb923c",
                  "Military/Intelligence": "#ef4444", "Space Station/Crewed": "#ffffff",
                  "Other": "#94a3b8", "Unknown": UNKNOWN}
ORBIT_COLORS = {"LEO": "#4cc9f0", "MEO": "#ffd166", "GEO": "#f472b6", "HEO": "#a3e635", "Unknown": UNKNOWN}
KEYS = ["country", "operator_group", "purpose"]

SOURCES = [
    {"id": "satcat", "name": "CelesTrak SATCAT", "url": "https://celestrak.org/satcat/",
     "file": "satcat.csv", "license": "Public; space-track.org / CelesTrak data",
     "citation": "T.S. Kelso, CelesTrak SATCAT (celestrak.org/satcat)."},
    {"id": "gp", "name": "CelesTrak GP (OMM) – active satellites", "url": "https://celestrak.org/NORAD/documentation/gp-data-formats.php",
     "file": "gp_active.json", "license": "Public",
     "citation": "T.S. Kelso, CelesTrak current GP element sets (celestrak.org/NORAD/elements)."},
    {"id": "gcat", "name": "GCAT – General Catalog of Artificial Space Objects", "url": "https://planet4589.org/space/gcat/",
     "file": "gcat_satcat.tsv", "license": "CC-BY 4.0",
     "citation": "Data from GCAT (J. McDowell, planet4589.org/space/gcat)."},
    {"id": "ucs", "name": "UCS Satellite Database (frozen 1 May 2023)", "url": "https://www.ucs.org/resources/satellite-database",
     "file": "ucs.xlsx", "license": "Union of Concerned Scientists, free for non-commercial use with attribution",
     "citation": "Union of Concerned Scientists, UCS Satellite Database, current through 1 May 2023."},
]


def yearly(df, snap_year, snap_day):
    df = df.copy()
    ly = (pd.Timestamp(EPOCH) + pd.to_timedelta(df.launch_day, unit="D")).dt.year
    decayed = df.decay_day != NO_DECAY_DAY
    dy = (pd.Timestamp(EPOCH) + pd.to_timedelta(df.decay_day.where(decayed, 0), unit="D")).dt.year
    df["launch_year"], df["decay_year"] = ly, dy.where(decayed)
    years = range(1957, snap_year + 1)
    launched = df.groupby(KEYS + ["launch_year"]).size().unstack(fill_value=0).reindex(columns=years, fill_value=0)
    gone = (df[decayed].groupby(KEYS + ["decay_year"]).size().unstack(fill_value=0)
            .reindex(columns=years, fill_value=0).reindex(launched.index, fill_value=0))
    in_orbit = (launched - gone).cumsum(axis=1)
    out = pd.concat({"launched": launched.stack(), "in_orbit_end_of_year": in_orbit.stack()}, axis=1).reset_index()
    out = out.rename(columns={"level_3": "year", "launch_year": "year"})
    out = out[(out.launched > 0) | (out.in_orbit_end_of_year > 0)]
    out["year"] = out.year.astype("int16")
    for c in ("launched", "in_orbit_end_of_year"):
        out[c] = out[c].astype("int32")
    return out.sort_values(["year"] + KEYS).reset_index(drop=True)


def breakdowns(df):
    inorb = df[df.decay_day == NO_DECAY_DAY]
    rows = []
    for dim, col in [("country", "country"), ("operator", "operator"), ("operator_group", "operator_group"),
                     ("purpose", "purpose"), ("orbit_class", "orbit_class")]:
        a = df.groupby(col).size().rename("all_time")
        b = inorb.groupby(col).size().rename("in_orbit")
        t = pd.concat([a, b], axis=1).fillna(0).astype(int).reset_index().rename(columns={col: "name"})
        t.insert(0, "dimension", dim)
        rows.append(t)
    return pd.concat(rows, ignore_index=True)


def palette(names, special=()):
    pal = {}
    for i, n in enumerate(names):
        pal[n] = COLORS[i % len(COLORS)]
    for n in special:
        pal[n] = UNKNOWN if n == "Unknown" else OTHER
    return pal


def main():
    df = pd.read_parquet(OUT / "satellites.parquet")
    snap = snapshot_time()
    snap_day = (snap.date() - EPOCH).days
    y = yearly(df, snap.year, snap_day)
    y.to_parquet(OUT / "yearly.parquet", index=False, compression="snappy")
    b = breakdowns(df)
    b.to_parquet(OUT / "breakdowns.parquet", index=False, compression="snappy")

    inorb = df[df.decay_day == NO_DECAY_DAY]
    # country palette: union of the top countries all-time and in orbit (so any top-N view is coloured)
    known_c = df[df.country != "Unknown"]
    kinds = pd.read_parquet(RAW / "catalog.parquet", columns=["country", "owner_kind"]).drop_duplicates("country").set_index("country").owner_kind
    top_c = list(dict.fromkeys(list(known_c.country.value_counts().head(10).index)
                               + list(known_c[known_c.decay_day == NO_DECAY_DAY].country.value_counts().head(10).index)))[:len(COLORS)]
    ops = [o for o in df.operator_group.value_counts().index if o not in ("Other", "Unknown")]
    post = inorb[inorb.launch_date >= "2023-01-01"]
    cov = lambda x: {"n": int(len(x)),
                     "operator_known_pct": round(float((x.operator != "Unknown").mean() * 100), 1),
                     "purpose_known_pct": round(float((x.purpose != "Unknown").mean() * 100), 1)} if len(x) else {}
    gp_file = RAW / "gp_active.json"
    meta = {
        "snapshot_date": snap.date().isoformat(), "snapshot_time": snap.isoformat(), "snapshot_day": snap_day,
        "epoch": EPOCH.isoformat(), "no_decay_day": NO_DECAY_DAY,
        "sources": [dict(s, retrieved=dt.datetime.fromtimestamp((RAW / s["file"]).stat().st_mtime, dt.timezone.utc).date().isoformat()
                         if (RAW / s["file"]).exists() else None) for s in SOURCES],
        "ucs_frozen": "2023-05-01",
        "display": {"k_scale": K_SCALE, "r_earth_km": R_EARTH_KM},
        "totals": {"payloads": int(len(df)), "in_orbit": int(len(inorb)),
                   "active": int((df.status == "active").sum()),
                   "countries": int((kinds.reindex(known_c.country.unique()) == "country").sum()),
                   "organizations": int((kinds.reindex(known_c.country.unique()) != "country").sum()),
                   "sgp4_positions": int((df.position_source == "sgp4").sum()),
                   "gp_available": gp_file.exists()},
        "coverage": {"all": cov(df), "in_orbit": cov(inorb), "launched_2023_plus": cov(df[df.launch_date >= "2023-01-01"]),
                     "in_orbit_launched_2023_plus": cov(post)},
        "palettes": {
            "purpose": PURPOSE_COLORS, "orbit_class": ORBIT_COLORS,
            "country": {**palette(top_c), "Other": OTHER, "Unknown": UNKNOWN},
            "operator_group": {**palette(ops), "Other": OTHER, "Unknown": UNKNOWN},
        },
        "purposes": list(PURPOSE_COLORS),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))

    print(f"yearly.parquet {len(y):,} rows; breakdowns.parquet {len(b):,} rows")
    print("Launched per year (recent):", y.groupby("year").launched.sum().tail(10).to_dict())
    print("In orbit end of year (recent):", y.groupby("year").in_orbit_end_of_year.sum().tail(6).to_dict())
    print("Top operators in orbit:", inorb.operator.value_counts().head(5).to_dict())
    print("Country palette:", list(meta["palettes"]["country"])[:12])


if __name__ == "__main__":
    main()
