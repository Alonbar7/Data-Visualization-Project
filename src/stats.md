---
title: Statistics
toc: false
---

# Statistics

```js
import {yearlyChart, donut} from "./components/charts.js";
import {fmtInt, fmtPct} from "./components/format.js";
import {makeColors} from "./components/colors.js";

const meta = await FileAttachment("data/meta.json").json();
const colors = makeColors(meta);
const yearly = Array.from(await FileAttachment("data/yearly.parquet").parquet(), (d) => ({
  year: d.year, country: d.country, operator_group: d.operator_group, purpose: d.purpose,
  launched: d.launched, in_orbit: d.in_orbit_end_of_year}));
const breakdowns = Array.from(await FileAttachment("data/breakdowns.parquet").parquet(), (d) => ({
  dimension: d.dimension, name: d.name, in_orbit: Number(d.in_orbit), all_time: Number(d.all_time)}));
```

```js
const inOrbitOps = breakdowns.filter((d) => d.dimension === "operator" && d.name !== "Unknown").sort((a, b) => b.in_orbit - a.in_orbit);
const top = inOrbitOps[0];
display(html`<div class="stat-row">
  <div class="stat"><div class="v">${fmtInt(meta.totals.payloads)}</div><div class="l">satellites launched since 1957 (Earth orbit)</div></div>
  <div class="stat"><div class="v">${fmtInt(meta.totals.in_orbit)}</div><div class="l">in orbit on ${meta.snapshot_date}</div></div>
  <div class="stat"><div class="v">${fmtPct(top.in_orbit / meta.totals.in_orbit, 0)}</div><div class="l">of them belong to ${top.name}, the largest operator</div></div>
  <div class="stat"><div class="v">${meta.totals.countries}</div><div class="l">countries have owned a satellite (+ ${meta.totals.organizations} international organisations)</div></div>
</div>`);
```

<div class="chart-card">

## Satellites through the years

<p class="note">Stacked bars per year. Hover a year for its breakdown; click a legend entry to isolate it. Colours match the globe.</p>

```js
const metric = view(Inputs.radio(new Map([["Launched per year", "launched"], ["In orbit at year end", "in_orbit"]]), {value: "launched", label: "Metric"}));
const colorBy = view(Inputs.radio(new Map([["Country", "country"], ["Company", "company"]]), {value: "country", label: "Color by"}));
const topN = view(Inputs.range([3, 14], {value: 8, step: 1, label: "Top N"}));
```

```js
const isolated = Mutable(null);
const setIsolated = (v) => (isolated.value = v);
```

```js
// changing what the colours mean clears any isolation
colorBy; metric; topN;
setIsolated(null);
```

```js
display(yearlyChart({
  yearly, metric, colorBy, topN, isolated, onIsolate: setIsolated, width,
  palette: colorBy === "country" ? meta.palettes.country : meta.palettes.operator_group
}));
```

</div>

<div class="chart-card">

## Who owns what

<p class="note">Share of satellites by company, country or purpose. Slices beyond the top N are grouped as “Other”.</p>

```js
const dim = view(Inputs.radio(new Map([["Company", "operator_group"], ["Country", "country"], ["Purpose", "purpose"]]), {value: "operator_group", label: "Break down by"}));
const scope = view(Inputs.radio(new Map([["In orbit today", "in_orbit"], ["All-time", "all_time"]]), {value: "in_orbit", label: "Count"}));
const pieN = view(Inputs.range([3, 14], {value: 8, step: 1, label: "Top N slices"}));
```

```js
const paletteFor = {operator_group: meta.palettes.operator_group, country: meta.palettes.country, purpose: meta.palettes.purpose}[dim];
display(donut({
  rows: breakdowns.filter((d) => d.dimension === dim).map((d) => ({name: d.name, value: d[scope]})),
  colorOf: (n) => paletteFor[n] ?? paletteFor.Other ?? "#6b7280",
  topN: pieN, label: `${scope === "in_orbit" ? "In orbit today" : "All-time"} by ${dim}`
}));
```

</div>
