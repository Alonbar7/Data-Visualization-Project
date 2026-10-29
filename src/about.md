---
title: About
toc: false
---

# About Orbit Atlas

<div class="about-body">

Orbit Atlas shows every satellite humanity has put into Earth orbit since Sputnik 1 (4 October 1957): who owns it, what it is for, and how the population has grown. It is a static site – all filtering and drawing happens in your browser. The data were prepared offline by a Python pipeline in this repository and committed as small files.

```js
const meta = await FileAttachment("data/meta.json").json();
const fmt = (n) => n.toLocaleString("en-US");
```

**Snapshot date: ${meta.snapshot_date}.** The catalog was downloaded on that day; satellites launched or decayed afterwards are not included.

## Data sources

```js
display(html`<table>
  <thead><tr><th>Source</th><th>Used for</th><th>Retrieved</th></tr></thead>
  <tbody>
    <tr><td><a href="https://celestrak.org/satcat/">CelesTrak SATCAT</a></td><td>The backbone: every cataloged object – name, owner country, launch and decay dates, orbit.</td><td>${meta.sources[0].retrieved}</td></tr>
    <tr><td><a href="https://celestrak.org/NORAD/elements/">CelesTrak GP (OMM)</a></td><td>Current orbital elements of active satellites, used to compute accurate positions with SGP4 and for the optional “Live motion”.</td><td>${meta.sources[1].retrieved ?? "not available"}</td></tr>
    <tr><td><a href="https://planet4589.org/space/gcat/">GCAT</a> (J. McDowell)</td><td>Richer metadata: owning organisation, mission category and class. Independent cross-check of SATCAT.</td><td>${meta.sources[2].retrieved}</td></tr>
    <tr><td><a href="https://www.ucs.org/resources/satellite-database">UCS Satellite Database</a></td><td>Purpose, detailed purpose and operator for ${fmt(7551)} satellites. <b>Frozen:</b> current only through 1 May 2023.</td><td>${meta.sources[3].retrieved}</td></tr>
  </tbody></table>`);
```

Required citations:

- Data from GCAT (J. McDowell, planet4589.org/space/gcat), licensed CC-BY.
- T.S. Kelso, CelesTrak – SATCAT and GP element sets (celestrak.org).
- Union of Concerned Scientists, *UCS Satellite Database*, version of 1 May 2023.

## What is counted

Only **payloads** (real satellites) in orbit around Earth are shown, including those that have since decayed, so the history works. Rocket bodies and debris are not shown. Probes in solar, lunar or planetary orbit are excluded. A satellite counts as **in orbit** on a date if it was launched on or before that date and has no decay date on or before it – the same rule drives the date slider on the globe. “In orbit” therefore includes dead satellites that have not yet re-entered; the *status* field in the tooltip separates active from inactive.

## How operator and purpose were assigned

Each field is filled from the best source available, in this priority order:

| | 1st | 2nd | 3rd | otherwise |
|---|---|---|---|---|
| **Operator** | UCS “Operator/Owner” | GCAT owning organisation | name pattern (e.g. <code>STARLINK</code> → SpaceX) | Unknown |
| **Purpose** | UCS “Purpose” + “Detailed Purpose” | GCAT mission category | name pattern | Unknown |

Purposes are normalised into ten categories (Communications, Earth Observation, Navigation, Weather, Science, Technology Demonstration, Military/Intelligence, Space Station/Crewed, Other, Unknown). Multi-purpose UCS entries use the first listed purpose. Operator names are normalised through an alias table (e.g. “Spacex”, “Space Exploration Technologies” → SpaceX). The 15 largest operators form the *operator groups* used in charts; the rest are “Other”. The mapping tables are plain CSV files in <code>pipeline/mappings/</code>.

### Coverage

```js
const rows = [["All satellites", meta.coverage.all], ["In orbit today", meta.coverage.in_orbit],
  ["Launched 2023 or later", meta.coverage.launched_2023_plus], ["In orbit and launched 2023 or later", meta.coverage.in_orbit_launched_2023_plus]];
const bar = (p) => html`<div style="display:flex;gap:8px;align-items:center"><div class="cov-bar"><i style="width:${p}%"></i></div>${p.toFixed(1)}%</div>`;
display(html`<table>
  <thead><tr><th>Subset</th><th>Satellites</th><th>Operator known</th><th>Purpose known</th></tr></thead>
  <tbody>${rows.map(([name, c]) => html`<tr><td>${name}</td><td>${fmt(c.n)}</td><td>${bar(c.operator_known_pct)}</td><td>${bar(c.purpose_known_pct)}</td></tr>`)}</tbody></table>`);
```

## Limitations

- **Positions:** ${fmt(meta.totals.sgp4_positions)} of ${fmt(meta.totals.payloads)} satellites have a current position computed from CelesTrak orbital elements with SGP4 at the snapshot time (shown as “current” in the tooltip). **All other positions – every decayed satellite and every satellite without current elements – are illustrative, not real past positions.** They are placed on the satellite’s orbital shell: altitude is the mean of perigee and apogee, latitude is constrained by the inclination, and longitude and orbital phase come from a seeded random number generator (seed = NORAD id), so the picture is reproducible.
- **Altitude is compressed** for display. The radius on screen is <code>r = 1 + ${meta.display.k_scale}·√(altitude / Earth radius)</code>, so the dense low-Earth-orbit cloud and the geostationary ring (about 36,000 km) fit in one view. Distances on screen are not to scale.
- **UCS is frozen at May 2023.** Satellites launched later rely on GCAT and name patterns; those are good for the big constellations (Starlink, OneWeb, Kuiper, …) but weaker for small or new operators. Check the coverage figures above.
- **Name-pattern heuristics** can be wrong. For example <code>USA ###</code> and <code>COSMOS ####</code> are treated as military/intelligence although a few are civil. GCAT owners are sometimes the manufacturer or launch agency rather than the operator.
- **Country = registered owner** in SATCAT (e.g. Starlink is “United States”). Multinational organisations such as ESA, Intelsat (ITSO) and Eutelsat keep their own label instead of being split among member states. Soviet and Russian satellites are grouped as “Russia / USSR”.
- **Orbit class** (LEO < 2,000 km; MEO; GEO ≈ 35,786 km with low inclination; HEO for highly elliptical orbits) is derived from SATCAT perigee, apogee and inclination.
- Dates are launch and decay dates as reported by SATCAT (UTC). Where SATCAT lacks a date, GCAT’s “vague” date is used, keeping year-month-day.

## Source code

The Python pipeline (<code>pipeline/</code>), the mapping tables and this site are in the project repository; the README explains how to refresh the snapshot.

</div>
