"""Download raw sources into raw/ (cached; re-run with --force to refresh)."""
import argparse
import sys
import requests
import pandas as pd
from config import RAW

UA = {"User-Agent": "orbit-atlas-student-project/1.0 (university data visualization)"}

SOURCES = {
    "satcat.csv": "https://celestrak.org/pub/satcat.csv",
    "gp_active.json": "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
    "gcat_satcat.tsv": "https://planet4589.org/space/gcat/tsv/cat/satcat.tsv",
    "gcat_psatcat.tsv": "https://planet4589.org/space/gcat/tsv/cat/psatcat.tsv",
    "gcat_satcat100k.tsv": "https://planet4589.org/space/gcat/tsv/cat/satcat100k.tsv",
    "gcat_psatcat100k.tsv": "https://planet4589.org/space/gcat/tsv/cat/psatcat100k.tsv",
    "gcat_orgs.tsv": "https://planet4589.org/space/gcat/tsv/tables/orgs.tsv",
    "ucs.xlsx": "https://www.ucs.org/media/11492",
}


def download(name, url, force):
    dest = RAW / name
    if dest.exists() and not force:
        print(f"[cached] {name}")
        return dest
    print(f"[fetch ] {name} <- {url}")
    r = requests.get(url, headers=UA, timeout=180, allow_redirects=True)
    r.raise_for_status()
    dest.write_bytes(r.content)
    print(f"         {len(r.content)/1e6:.1f} MB")
    return dest


def describe(name, df):
    print(f"  {name}: {len(df):,} rows x {len(df.columns)} cols")
    print("   columns:", list(df.columns))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download everything")
    args = ap.parse_args()
    RAW.mkdir(exist_ok=True)
    for name, url in SOURCES.items():
        try:
            download(name, url, args.force)
        except requests.HTTPError as e:
            # CelesTrak returns 403 if the same GROUP was fetched in the last 2 h.
            if e.response is not None and e.response.status_code == 403 and name == "gp_active.json":
                print(f"  SKIPPED {name}: rate-limited ({e.response.text.strip()[:120]!r}). Retry in >2 h.")
                continue
            print(f"FAILED {name}: {e}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"FAILED {name}: {e}", file=sys.stderr)
            sys.exit(1)

    print("\n== Schema check ==")
    describe("satcat.csv", pd.read_csv(RAW / "satcat.csv", low_memory=False))
    if (RAW / "gp_active.json").exists():
        describe("gp_active.json", pd.read_json(RAW / "gp_active.json"))
    for n in ("gcat_satcat.tsv", "gcat_psatcat.tsv", "gcat_satcat100k.tsv", "gcat_psatcat100k.tsv", "gcat_orgs.tsv"):
        df = pd.read_csv(RAW / n, sep="\t", dtype=str, low_memory=False)
        describe(n, df)
    xl = pd.read_excel(RAW / "ucs.xlsx", sheet_name=None)
    for sheet, df in xl.items():
        describe(f"ucs.xlsx[{sheet}]", df)


if __name__ == "__main__":
    main()
