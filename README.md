# Orbit Atlas

An interactive 3D atlas of every satellite humanity has put into Earth orbit since 1957 – who owns it, what it is for, and how the population has grown. University data-visualization project.

* **Globe** – ~28,000 satellites on a 3D Earth, a dual-handle launch-window slider that updates in real time, country / operator highlighting, colour modes, hover tooltips, optional live motion.
* **Statistics** – satellites per year (stacked by country or company) and a donut breakdown (company / country / purpose).
* **About** – sources, citations, methods, coverage and limitations (rendered from `src/data/meta.json`).

## Architecture

```
pipeline/   Python – runs LOCALLY ONLY, never deployed
  fetch.py → build_catalog.py → positions.py → aggregates.py
raw/        downloaded sources (gitignored)
src/data/   processed outputs – COMMITTED (a few MB in total)
src/        Observable Framework site (pages, components, style)
.github/    workflow: `npm ci && npm run build`, deploy dist/ to GitHub Pages
```

Python never runs in CI and CI never downloads data: GitHub Actions only builds the static site from the committed files in `src/data/`. (No `*.ext.py` data loader files exist under `src/`, so Framework never tries to run Python.)

## Setup

```bash
# Python pipeline (only needed to refresh the data)
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipeline/requirements.txt

# Website (Node 18+; CI uses Node 22)
npm install
```

## Running the pipeline

Run from inside `pipeline/`, in this order:

```bash
cd pipeline
python fetch.py          # download raw sources into raw/ (cached; --force re-downloads) and print schemas
python build_catalog.py  # clean + join SATCAT / GCAT / UCS -> raw/catalog.parquet, prints the coverage report
python positions.py      # SGP4 + approximate positions -> src/data/satellites.parquet, gp_active.json
python aggregates.py     # yearly.parquet, breakdowns.parquet, meta.json
```

Outputs in `src/data/`: `satellites.parquet`, `gp_active.json`, `yearly.parquet`, `breakdowns.parquet`, `meta.json`.

**Refreshing the snapshot:** `python fetch.py --force`, then run the other three scripts and commit `src/data/`. Be polite to the servers: downloads are cached in `raw/`, and CelesTrak only serves a given GP group once every 2 hours (a repeat request returns HTTP 403 – `fetch.py` reports it and carries on; the UCS file never changes, so there is no reason to re-download it). The snapshot date is the download time of the GP file.

To improve operator/purpose coverage, edit the hand-made tables in `pipeline/mappings/` (first matching row wins) and re-run `build_catalog.py`, which prints the top "Unknown" name stems:

| file | purpose |
|---|---|
| `owner_codes.csv` | SATCAT owner code → country name, ISO code (multinational codes keep their own label) |
| `name_patterns.csv` | regex on satellite name → operator and/or purpose |
| `purpose_normalize.csv` | UCS / GCAT purpose strings → ten normalised categories |
| `operator_alias.csv` | spelling variants / GCAT organisation names → one canonical operator name |

## Running the site

```bash
npm run dev     # live preview at http://127.0.0.1:3000
npm run build   # static site into dist/
```

## Deploying to GitHub Pages

1. Push to `main` of the GitHub repository.
2. In the repo go to **Settings → Pages → Source = GitHub Actions**.
3. `base` in [`observablehq.config.js`](observablehq.config.js) must equal `/<repo-name>/` (currently `/Data-Visualization-Project/`). Change it if the repository is renamed.
4. The workflow [`deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main` (and manually via *Run workflow*): checkout → Node 22 → `npm ci` → `npm run build` → upload `dist/` → `actions/deploy-pages`. `package-lock.json` is committed so builds are reproducible. (The build fetches a few npm modules – `parquet-wasm`, `apache-arrow` – from the jsDelivr CDN at build time; that is Framework's normal behaviour and not data.)

## Why globe.gl + a single `THREE.Points` (not deck.gl)

Both approaches can filter on the GPU. I chose **globe.gl / three.js** because it gives the day/night Earth, atmosphere glow and orbit controls out of the box, and a custom `ShaderMaterial` is small and fully under control:

* all satellites are **one** `THREE.Points` draw call with per-vertex attributes (`position`, `aColor`, `aLaunch`, `aDecay`, `aHL`);
* the vertex shader hides a point unless `launch_day ≥ start AND launch_day ≤ end AND decay_day > end` and dims/enlarges highlighted points – **dragging the slider only updates two uniforms**, no buffers are rebuilt;
* changing a highlight rewrites one float attribute; changing colour mode rewrites one colour attribute;
* hover uses CPU picking over the typed arrays (projection + Earth-occlusion test, ~28k points per animation frame), so tooltips respect the date filter and highlight and never pick dots hidden behind the Earth.

deck.gl's `GlobeView` + `DataFilterExtension` would work too, but its globe is a flat basemap texture with less control over lighting and atmosphere, and it adds a heavier dependency for a single layer.

Satellite positions are stored in Earth radii (Earth = 1) in three-globe's coordinate convention; the browser multiplies by the globe radius (100).

## Data definitions

* **Satellite** = SATCAT `OBJECT_TYPE == "PAY"` orbiting Earth (probes in solar/lunar/planetary orbit are dropped). Decayed satellites are kept so history works. Rocket bodies and debris are not included (no debris toggle).
* **Join key** = NORAD catalog number (`NORAD_CAT_ID` ↔ GCAT `Satcat` ↔ UCS `NORAD Number`). `build_catalog.py` prints the match rates.
* **In orbit** on a day = launched on/before it and no decay on/before it. `status`: `decayed` (has a decay date), `active` (SATCAT ops code `+ P B S X`), else `inactive`.
* **launch_day / decay_day** = integer days since 1957-10-04; `decay_day = 99999` means still in orbit.
* **Operator** priority: UCS → GCAT organisation → name pattern → `Unknown`. **operator_group** = the 15 largest known operators, `Unknown`, and `Other`.
* **Purpose** priority: UCS Purpose/Detailed Purpose → GCAT category → name pattern → `Unknown`; ten categories.
* **Country** = SATCAT owner code (registered owner); multinational codes (ESA, ITSO, EUTE, …) keep their own label.
* **Orbit class**: LEO (apogee < 2,000 km), MEO, GEO (mean altitude 33,000–38,500 km, near-circular, inclination < 30°), HEO (eccentricity > 0.25 or apogee − perigee > 10,000 km).
* **Display radius** `r = 1 + k·√(alt/R_earth)` with `k = K_SCALE` in [`pipeline/config.py`](pipeline/config.py) (also written to `meta.json`).

## Limitations

* **Positions:** satellites with current CelesTrak GP elements are propagated with SGP4 to the snapshot time (`position_source = sgp4`). Decayed satellites and those without current elements get **illustrative** positions on their orbital shell (mean altitude, latitude bounded by inclination, longitude/phase from a seeded RNG with seed = NORAD id; `position_source = approx`). Historical positions are *not* real past positions.
* **UCS is frozen at May 2023** (7,560 satellites). Later satellites depend on GCAT and name patterns, which are accurate for big constellations and weaker for small operators.
* **Name patterns are heuristics** (e.g. `USA ###` / `COSMOS ####` → military/intelligence; GCAT "owners" are sometimes manufacturers). Numbers on the Stats page are only as good as these mappings – see the coverage table on the About page.
* GCAT's standard catalog stops at catalog number 69,999; the "extended" 100k catalog is merged in so newer satellites also get GCAT metadata.
* SATCAT "in orbit" counts dead satellites that have not yet re-entered; use `status` to separate active ones.

## Credits

Data from GCAT (J. McDowell, planet4589.org/space/gcat, CC-BY) · CelesTrak (T.S. Kelso) · UCS Satellite Database (Union of Concerned Scientists, May 2023). Built with [Observable Framework](https://observablehq.com/framework/), [globe.gl](https://globe.gl), [three.js](https://threejs.org), [satellite.js](https://github.com/shashwatak/satellite-js) and [Observable Plot](https://observablehq.com/plot/); Python side uses pandas, pyarrow, sgp4. Earth textures from [three-globe](https://github.com/vasturiano/three-globe) examples.
