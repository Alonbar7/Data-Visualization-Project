"""Compute 3D positions for every satellite and write src/data/satellites.parquet.

* satellites with current CelesTrak GP elements -> SGP4 propagated to the snapshot
  time ("sgp4"), plus compact elements exported to src/data/gp_active.json
* everything else (decayed / no elements)       -> illustrative placement on the
  orbital shell ("approx"), deterministic per NORAD id

Display space: Earth radius = 1. Longitude/latitude follow three-globe's convention
(see to_display), so the JS side only multiplies by the globe radius.
"""
import json
import numpy as np
import pandas as pd
from sgp4 import omm
from sgp4.api import Satrec, SatrecArray, jday
from config import RAW, OUT, R_EARTH_KM, K_SCALE, NO_DECAY_DAY, snapshot_time

OMM_FIELDS = ["NORAD_CAT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE",
              "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT",
              "ELEMENT_SET_NO", "REV_AT_EPOCH"]
WGS84_A, WGS84_F = 6378.137, 1 / 298.257223563


def display_radius(alt_km):
    """Compressed display radius so both LEO and GEO fit: r = 1 + K * sqrt(alt / R_earth)."""
    return 1.0 + K_SCALE * np.sqrt(np.maximum(alt_km, 0) / R_EARTH_KM)


def to_display(lat_deg, lon_deg, alt_km):
    r = display_radius(alt_km)
    phi, theta = np.radians(90 - lat_deg), np.radians(90 - lon_deg)  # three-globe polar2Cartesian
    return r * np.sin(phi) * np.cos(theta), r * np.cos(phi), r * np.sin(phi) * np.sin(theta)


def gmst(jd, fr):
    t = ((jd - 2451545.0) + fr) / 36525.0
    g = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t**2 - 6.2e-6 * t**3
    return np.radians((g / 240.0) % 360.0)


def teme_to_geodetic(r, when):
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second)
    th = gmst(jd, fr)
    c, s = np.cos(th), np.sin(th)
    x, y, z = c * r[:, 0] + s * r[:, 1], -s * r[:, 0] + c * r[:, 1], r[:, 2]
    lon = np.degrees(np.arctan2(y, x))
    e2 = WGS84_F * (2 - WGS84_F)
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1 - e2))
    for _ in range(5):
        n = WGS84_A / np.sqrt(1 - e2 * np.sin(lat) ** 2)
        alt = p / np.cos(lat) - n
        lat = np.arctan2(z, p * (1 - e2 * n / (n + alt)))
    n = WGS84_A / np.sqrt(1 - e2 * np.sin(lat) ** 2)
    alt = p / np.cos(lat) - n
    return np.degrees(lat), lon, alt


def propagate_gp(gp, when):
    """Return DataFrame(norad_id, lat, lon, alt_km) for OMM records that propagate cleanly."""
    sats, ids = [], []
    for rec in gp:
        try:
            s = Satrec()
            omm.initialize(s, rec)
            sats.append(s)
            ids.append(int(rec["NORAD_CAT_ID"]))
        except Exception:
            continue
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second)
    e, r, _ = SatrecArray(sats).sgp4(np.array([jd]), np.array([fr]))
    ok = (e[:, 0] == 0) & np.isfinite(r[:, 0, :]).all(axis=1)
    lat, lon, alt = teme_to_geodetic(r[ok, 0, :], when)
    good = (alt > 100) & (alt < 100000)
    out = pd.DataFrame({"norad_id": np.array(ids)[ok][good], "lat": lat[good], "lon": lon[good], "alt_km": alt[good]})
    print(f"  SGP4: {len(sats):,} OMM records, {ok.sum():,} propagated without error, {good.sum():,} plausible")
    return out.drop_duplicates("norad_id")


def approx_positions(df):
    """Deterministic illustrative placement on the satellite's orbital shell."""
    lat, lon, alt = np.empty(len(df)), np.empty(len(df)), np.empty(len(df))
    for i, (nid, peri, apo, inc) in enumerate(zip(df.norad_id, df.perigee_km, df.apogee_km, df.inclination)):
        rng = np.random.default_rng(int(nid))
        a = np.nanmean([peri, apo]) if not (np.isnan(peri) and np.isnan(apo)) else 600.0
        inc = 60.0 if np.isnan(inc) else min(inc, 180 - inc) if inc > 90 else inc
        u = rng.uniform(0, 2 * np.pi)  # orbital phase -> latitude bounded by inclination
        lat[i] = np.degrees(np.arcsin(np.sin(np.radians(inc)) * np.sin(u)))
        lon[i] = rng.uniform(-180, 180)
        alt[i] = a
    return pd.DataFrame({"norad_id": df.norad_id.values, "lat": lat, "lon": lon, "alt_km": alt})


def main():
    cat = pd.read_parquet(RAW / "catalog.parquet")
    when = snapshot_time()
    print(f"Snapshot time: {when.isoformat()}")

    gp_file = RAW / "gp_active.json"
    sgp = pd.DataFrame(columns=["norad_id", "lat", "lon", "alt_km"])
    gp_export = None
    if gp_file.exists():
        gp = json.loads(gp_file.read_text())
        sgp = propagate_gp(gp, when)
        # keep elements only for satellites in our catalog and still in orbit
        live = set(cat.loc[cat.decay_day == NO_DECAY_DAY, "norad_id"]) & set(sgp.norad_id)
        rows = [[rec.get(f) for f in OMM_FIELDS] for rec in gp if int(rec["NORAD_CAT_ID"]) in live]
        gp_export = {"snapshot": when.isoformat(), "fields": OMM_FIELDS, "rows": rows}
    else:
        print("  WARNING: raw/gp_active.json missing -> all positions are 'approx', live motion disabled")
        gp_export = {"snapshot": when.isoformat(), "fields": OMM_FIELDS, "rows": []}

    sgp["position_source"] = "sgp4"
    rest = cat[~cat.norad_id.isin(sgp.norad_id)]
    app = approx_positions(rest)
    app["position_source"] = "approx"
    pos = pd.concat([sgp, app], ignore_index=True)

    df = cat.merge(pos, on="norad_id", how="left")
    x, y, z = to_display(*(df[c].to_numpy(dtype="float64") for c in ("lat", "lon", "alt_km")))
    df["x"], df["y"], df["z"] = x.astype("float32"), y.astype("float32"), z.astype("float32")
    for c in ("lat", "lon", "alt_km"):
        df[c] = df[c].round(3).astype("float32")
    df["norad_id"] = df.norad_id.astype("int32")
    for c in ("perigee_km", "apogee_km", "inclination", "period_min"):
        df[c] = df[c].astype("float32")
    for c in ("country_code", "country", "operator", "operator_group", "purpose", "orbit_class",
              "status", "position_source", "name", "detailed_purpose"):
        df[c] = df[c].astype("string")
    df["launch_date"] = df.launch_date.dt.strftime("%Y-%m-%d")
    df["decay_date"] = df.decay_date.dt.strftime("%Y-%m-%d")
    df = df.drop(columns=["operator_source", "purpose_source", "launch_site", "owner_kind"])

    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "satellites.parquet", index=False, compression="snappy")
    print(f"Wrote satellites.parquet: {len(df):,} rows; position_source: "
          f"{df.position_source.value_counts().to_dict()}")
    inorb = df[df.decay_day == NO_DECAY_DAY]
    print(f"  in-orbit sats with sgp4 positions: {(inorb.position_source == 'sgp4').sum():,}/{len(inorb):,}")
    if gp_export:
        (OUT / "gp_active.json").write_text(json.dumps(gp_export, separators=(",", ":")))
        print(f"Wrote gp_active.json: {len(gp_export['rows']):,} elements")


if __name__ == "__main__":
    main()
