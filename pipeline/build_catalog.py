"""Clean + join SATCAT, GCAT and UCS into one row per payload.

Writes raw/catalog.parquet (intermediate; positions.py adds coordinates and
writes the final src/data/satellites.parquet).
"""
import re
import warnings
import numpy as np
import pandas as pd
from config import RAW, MAPPINGS, EPOCH, NO_DECAY_DAY, TOP_OPERATORS, R_EARTH_KM

warnings.filterwarnings("ignore", message="This pattern is interpreted as a regular expression")

PURPOSES = ["Communications", "Earth Observation", "Navigation", "Weather", "Science",
            "Technology Demonstration", "Military/Intelligence", "Space Station/Crewed",
            "Other", "Unknown"]
# SATCAT ORBIT_CENTER values meaning "orbits something other than Earth".
# (Numeric centers = docked to a station, which does orbit Earth.)
NON_EARTH = {"SU", "MO", "MA", "VE", "EM", "EL1", "EL2", "SS", "JU", "AS", "SA", "ME", "ZZ"}


# ------------------------------------------------------------------ helpers
def clean_str(s):
    s = s.astype("string").str.strip()
    return s.mask(s.isin(["", "-", "?", "nan", "<NA>"]))


def days_since_epoch(dates):
    d = pd.to_datetime(dates, errors="coerce")
    return ((d - pd.Timestamp(EPOCH)).dt.days).astype("float")


MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def parse_gcat_date(s):
    """GCAT 'vague date' ('2023 Jan  5 1234?') -> date (year-month-day, missing parts -> 1)."""
    if not isinstance(s, str):
        return pd.NaT
    m = re.match(r"\s*(\d{4})(?:\s+([A-Z][a-z]{2}))?(?:\s+(\d{1,2}))?", s)
    if not m:
        return pd.NaT
    y, mon, d = int(m.group(1)), MONTHS.get(m.group(2), 1), int(m.group(3) or 1)
    try:
        return pd.Timestamp(y, mon, d)
    except ValueError:
        return pd.Timestamp(y, mon, 1)


# ------------------------------------------------------------------ loaders
def load_satcat():
    s = pd.read_csv(RAW / "satcat.csv", low_memory=False)
    print(f"SATCAT rows: {len(s):,}; by type:", s.OBJECT_TYPE.value_counts().to_dict())
    pay = s[s.OBJECT_TYPE == "PAY"].copy()
    center = pay.ORBIT_CENTER.astype(str)
    off_earth = center.isin(NON_EARTH)
    print(f"  payloads: {len(pay):,}; dropped {off_earth.sum()} orbiting other bodies / deep space")
    pay = pay[~off_earth].copy()
    return pay, s


def load_gcat():
    cols = {}
    sat = pd.concat([pd.read_csv(RAW / f, sep="\t", dtype=str, low_memory=False)
                     for f in ("gcat_satcat.tsv", "gcat_satcat100k.tsv")])
    sat = sat[sat["Satcat"].notna()].copy()
    for c in sat.columns:
        sat[c] = clean_str(sat[c])
    sat["norad_id"] = pd.to_numeric(sat["Satcat"], errors="coerce")
    sat = sat.dropna(subset=["norad_id"]).drop_duplicates("norad_id")
    sat["norad_id"] = sat.norad_id.astype(int)
    sat = sat.rename(columns={"#JCAT": "jcat"})

    ps = pd.concat([pd.read_csv(RAW / f, sep="\t", dtype=str, low_memory=False)
                    for f in ("gcat_psatcat.tsv", "gcat_psatcat100k.tsv")])
    for c in ps.columns:
        ps[c] = clean_str(ps[c])
    ps = ps.rename(columns={"#JCAT": "jcat"}).dropna(subset=["jcat"]).drop_duplicates("jcat")

    orgs = pd.read_csv(RAW / "gcat_orgs.tsv", sep="\t", dtype=str, low_memory=False)
    for c in orgs.columns:
        orgs[c] = clean_str(orgs[c])
    orgs = orgs.rename(columns={"#Code": "code"}).dropna(subset=["code"]).drop_duplicates("code").set_index("code")

    g = sat[["jcat", "norad_id", "Owner", "State", "Name", "LDate", "DDate"]].merge(
        ps[["jcat", "Class", "Category", "Discipline"]], on="jcat", how="left")
    g["gcat_ldate"] = g.LDate.map(parse_gcat_date)
    g["gcat_ddate"] = g.DDate.map(parse_gcat_date)
    return g, orgs


def gcat_org_name(code, orgs):
    """Resolve a GCAT owner code to its top-level parent org's short name."""
    if not isinstance(code, str) or code not in orgs.index:
        return pd.NA
    for _ in range(4):
        parent = orgs.at[code, "Parent"]
        if isinstance(parent, str) and parent in orgs.index and parent != code:
            code = parent
        else:
            break
    r = orgs.loc[code]
    name = r["ShortName"] if isinstance(r["ShortName"], str) else r["Name"]
    return name


def load_ucs():
    u = pd.read_excel(RAW / "ucs.xlsx", sheet_name=0)
    u = u.loc[:, ~u.columns.astype(str).str.startswith("Unnamed")]
    u = u.rename(columns={
        "Current Official Name of Satellite": "ucs_name", "NORAD Number": "norad_id",
        "Operator/Owner": "ucs_operator", "Country of Operator/Owner": "ucs_country",
        "Purpose": "ucs_purpose", "Detailed Purpose": "ucs_detail", "Users": "ucs_users"})
    u["norad_id"] = pd.to_numeric(u.norad_id, errors="coerce")
    u = u.dropna(subset=["norad_id"]).drop_duplicates("norad_id")
    u["norad_id"] = u.norad_id.astype(int)
    for c in ("ucs_operator", "ucs_country", "ucs_purpose", "ucs_detail", "ucs_users"):
        u[c] = clean_str(u[c])
    return u[["norad_id", "ucs_name", "ucs_operator", "ucs_country", "ucs_purpose", "ucs_detail", "ucs_users"]]


# ------------------------------------------------------------------ mappings
def apply_regex_table(values, table, col_pat, col_out):
    """First-match-wins mapping of a string Series through an ordered (regex, output) table."""
    out = pd.Series(pd.NA, index=values.index, dtype="object")
    todo = values.notna()
    for pat, res in zip(table[col_pat], table[col_out]):
        if not todo.any():
            break
        hit = todo & values.fillna("").str.contains(pat, regex=True, flags=re.I)
        if isinstance(res, str) and res:
            out[hit] = res
        todo &= ~hit  # a matching rule with empty result = explicit "no answer"
    return out


def normalize_operator(ops):
    alias = pd.read_csv(MAPPINGS / "operator_alias.csv", keep_default_na=False)
    mapped = apply_regex_table(ops, alias, "pattern", "operator")
    # alias rows with empty operator ('unknown', '-') -> mark as missing
    unknown = ops.fillna("").str.contains(r"(?i)^(unknown|-|tbd)$", regex=True)
    out = mapped.where(mapped.notna(), ops.astype("object"))
    out[unknown] = pd.NA
    # tidy corporate suffixes
    out = out.astype("string").str.replace(r",?\s+(Inc\.?|LLC|Ltd\.?|Co\.|S\.A\.|GmbH)$", "", regex=True).str.strip()
    return out


def normalize_purpose(df):
    tab = pd.read_csv(MAPPINGS / "purpose_normalize.csv", keep_default_na=False)
    res = pd.Series(pd.NA, index=df.index, dtype="object")
    src = pd.Series(pd.NA, index=df.index, dtype="object")

    # 1. UCS Purpose + Detailed Purpose (detail can override: Meteorology -> Weather, Military -> ...)
    for source in ("ucs_detail", "ucs_purpose"):
        t = tab[tab.source == source]
        vals = df[source]
        m = apply_regex_table(vals, t, "pattern", "category")
        take = res.isna() & m.notna()
        res[take], src[take] = m[take], "ucs"
    # 2. GCAT category (Defence-class imaging/signals -> Military/Intelligence)
    t = tab[tab.source == "gcat_category"]
    m = apply_regex_table(df["Category"], t, "pattern", "category")
    defence = df["Class"].fillna("").str.contains("D")
    cat = df["Category"].fillna("")
    m[defence & cat.str.match(r"^IMG")] = "Military/Intelligence"
    take = res.isna() & m.notna()
    res[take], src[take] = m[take], "gcat"
    # 3. name patterns
    pats = pd.read_csv(MAPPINGS / "name_patterns.csv", keep_default_na=False)
    m = apply_regex_table(df["name"].str.upper(), pats, "pattern", "purpose")
    take = res.isna() & m.notna()
    res[take], src[take] = m[take], "name"
    # 4. Unknown
    res = res.fillna("Unknown")
    src = src.fillna("none")
    return res, src


# ------------------------------------------------------------------ orbit
def classify_orbit(peri, apo, inc, period):
    peri, apo = peri.astype(float), apo.astype(float)
    ecc = (apo - peri) / (apo + peri + 2 * R_EARTH_KM)
    mean_alt = (apo + peri) / 2
    geo = (mean_alt.between(33000, 38500)) & (ecc < 0.05) & (inc.fillna(0) < 30)
    heo = (ecc > 0.25) | ((apo - peri) > 10000)
    cls = pd.Series("Unknown", index=peri.index, dtype="object")
    known = peri.notna() & apo.notna()
    cls[known & (apo < 2000)] = "LEO"
    cls[known & (apo >= 2000)] = "MEO"
    cls[known & heo] = "HEO"
    cls[known & geo & ~heo] = "GEO"
    return cls, ecc


# ------------------------------------------------------------------ main
def main():
    pay, _ = load_satcat()
    g, orgs = load_gcat()
    u = load_ucs()
    owners = pd.read_csv(MAPPINGS / "owner_codes.csv", keep_default_na=False)

    df = pd.DataFrame({
        "norad_id": pay.NORAD_CAT_ID.astype(int),
        "name": pay.OBJECT_NAME.str.strip(),
        "intl_designator": pay.OBJECT_ID,
        "owner_code": pay.OWNER,
        "launch_date": pd.to_datetime(pay.LAUNCH_DATE, errors="coerce"),
        "decay_date": pd.to_datetime(pay.DECAY_DATE, errors="coerce"),
        "ops_code": pay.OPS_STATUS_CODE,
        "perigee_km": pay.PERIGEE, "apogee_km": pay.APOGEE,
        "inclination": pay.INCLINATION, "period_min": pay.PERIOD,
        "launch_site": pay.LAUNCH_SITE,
    }).reset_index(drop=True)

    # ---- joins (report match rates)
    n = len(df)
    df = df.merge(g[["norad_id", "Owner", "State", "Class", "Category", "gcat_ldate", "gcat_ddate"]],
                  on="norad_id", how="left")
    print(f"\nJoin SATCAT->GCAT: {df.Owner.notna().sum():,}/{n:,} matched with owner "
          f"({df.Owner.notna().mean():.1%}); with category {df.Category.notna().mean():.1%}")
    df = df.merge(u, on="norad_id", how="left")
    print(f"Join SATCAT->UCS : {df.ucs_name.notna().sum():,}/{n:,} matched ({df.ucs_name.notna().mean():.1%}); "
          f"UCS rows total {len(u):,}, matched {df.ucs_name.notna().sum():,} "
          f"({df.ucs_name.notna().sum()/len(u):.1%})")

    # fall back to GCAT dates if SATCAT lacks them
    df["launch_date"] = df.launch_date.fillna(df.gcat_ldate)

    # ---- country
    df = df.merge(owners[["owner_code", "country", "iso", "kind"]], on="owner_code", how="left")
    df["country_code"] = df.owner_code
    df["owner_kind"] = df.kind.fillna("country")
    df["country"] = df.country.fillna("Unknown")
    df.loc[df.kind.isna() & df.owner_code.notna(), "country"] = df.owner_code
    print("Owner codes without mapping:", df[df.kind.isna()].owner_code.value_counts().to_dict())

    # ---- operator: UCS -> GCAT -> name pattern -> Unknown
    ucs_op = normalize_operator(df.ucs_operator.astype("string"))
    gcat_op = normalize_operator(df.Owner.map(lambda c: gcat_org_name(c, orgs)).astype("string"))
    pats = pd.read_csv(MAPPINGS / "name_patterns.csv", keep_default_na=False)
    pat_op = apply_regex_table(df.name.str.upper(), pats, "pattern", "operator").astype("string")
    pat_op = normalize_operator(pat_op)
    # priority (spec): UCS > GCAT > name pattern > Unknown
    df["operator"] = ucs_op.fillna(gcat_op).fillna(pat_op).fillna("Unknown")
    df["operator_source"] = np.select([ucs_op.notna(), gcat_op.notna(), pat_op.notna()],
                                      ["ucs", "gcat", "name"], "none")

    # ---- purpose
    df["purpose"], df["purpose_source"] = normalize_purpose(df)
    df["detailed_purpose"] = df.ucs_detail

    # ---- dates / ints
    df["launch_day"] = days_since_epoch(df.launch_date)
    df = df.dropna(subset=["launch_day"]).copy()
    df["launch_day"] = df.launch_day.astype("int32")
    dd = days_since_epoch(df.decay_date)
    df["decay_day"] = dd.fillna(NO_DECAY_DAY).astype("int32")

    # ---- orbit
    df["orbit_class"], ecc = classify_orbit(df.perigee_km, df.apogee_km, df.inclination, df.period_min)

    # ---- status
    active = df.ops_code.isin(["+", "P", "B", "S", "X"])
    df["status"] = np.where(df.decay_date.notna(), "decayed", np.where(active, "active", "inactive"))
    # UCS lists satellites as operating (May 2023); if SATCAT has no ops code but UCS knows it -> active
    df.loc[(df.status == "inactive") & df.ops_code.isna() & df.ucs_name.notna() & (df.launch_date > "2020-01-01"),
           "status"] = "active"

    # ---- operator_group (top-N known operators, Unknown kept, rest Other)
    counts = df.loc[df.operator != "Unknown", "operator"].value_counts()
    top = list(counts.head(TOP_OPERATORS).index)
    df["operator_group"] = np.where(df.operator.isin(top), df.operator,
                                    np.where(df.operator == "Unknown", "Unknown", "Other"))

    keep = ["norad_id", "name", "intl_designator", "country_code", "country", "owner_kind", "operator", "operator_group",
            "purpose", "detailed_purpose", "launch_date", "decay_date", "launch_day", "decay_day",
            "orbit_class", "perigee_km", "apogee_km", "inclination", "period_min", "status",
            "operator_source", "purpose_source", "launch_site"]
    out = df[keep].sort_values("norad_id").reset_index(drop=True)
    out.to_parquet(RAW / "catalog.parquet", index=False)
    report(out)


def report(d):
    inorb = d[d.decay_day == NO_DECAY_DAY]
    post = d[d.launch_date >= "2023-01-01"]
    post_in = inorb[inorb.launch_date >= "2023-01-01"]

    def pct(x, col, bad):
        return f"{(x[col] != bad).mean():6.1%}" if len(x) else "  n/a"

    print("\n================ COVERAGE REPORT ================")
    print(f"Total payloads (Earth orbit, all time): {len(d):,}")
    print(f"In orbit today (no decay date)        : {len(inorb):,}   status: {inorb.status.value_counts().to_dict()}")
    print(f"{'subset':34s} {'n':>7s}  known operator  known purpose")
    for label, x in [("all payloads", d), ("in orbit today", inorb),
                     ("launched 2023+", post), ("launched 2023+ & in orbit", post_in)]:
        print(f"{label:34s} {len(x):7,d}  {pct(x, 'operator', 'Unknown'):>14s}  {pct(x, 'purpose', 'Unknown'):>13s}")
    print("Operator source (in orbit):", inorb.operator_source.value_counts().to_dict())
    print("Purpose source (in orbit):", inorb.purpose_source.value_counts().to_dict())
    print("\nTop operators in orbit:\n", inorb.operator.value_counts().head(12).to_string())
    print("\nPurpose in orbit:\n", inorb.purpose.value_counts().to_string())
    print("\nOrbit class in orbit:", inorb.orbit_class.value_counts().to_dict())
    unk = inorb[(inorb.operator == "Unknown") | (inorb.purpose == "Unknown")]
    print(f"\nTop 30 'Unknown' name stems among in-orbit sats ({len(unk):,} rows):")
    stem = unk.name.str.replace(r"[\s\-_]*[#(]?[0-9].*$", "", regex=True).str.upper()
    print(stem.value_counts().head(30).to_string())


if __name__ == "__main__":
    main()
