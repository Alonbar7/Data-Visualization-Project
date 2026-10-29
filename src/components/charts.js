// Chart builders for the statistics page. Colours come from meta.json palettes (same as the globe).
import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import {h} from "./controls.js";
import {fmtInt, fmtPct} from "./format.js";

const SPECIAL = ["Other", "Unknown"];

/** Rank entities (descending by `score`), keep top N, map the rest to "Other"; Unknown stays separate. */
export function topEntities(rows, key, score, n) {
  const totals = d3.rollup(rows, (v) => d3.sum(v, score), (d) => d[key]);
  const named = [...totals].filter(([k]) => !SPECIAL.includes(k)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keep = new Set(named.slice(0, n));
  const order = [...named.slice(0, n)];
  if (totals.has("Other") || named.length > n) order.push("Other");
  if (totals.has("Unknown")) order.push("Unknown");
  return {keep, order, map: (k) => (keep.has(k) ? k : k === "Unknown" ? "Unknown" : "Other")};
}

export function yearlyChart({yearly, palette, metric, colorBy, topN, isolated, onIsolate, width}) {
  const key = colorBy === "country" ? "country" : "operator_group";
  const field = metric === "launched" ? "launched" : "in_orbit";
  const lastYear = d3.max(yearly, (d) => d.year);
  const rankScore = metric === "launched" ? (d) => d.launched : (d) => (d.year === lastYear ? d.in_orbit : 0);
  const {order, map} = topEntities(yearly, key, rankScore, topN);

  const agg = d3.rollups(yearly, (v) => d3.sum(v, (d) => d[field]), (d) => d.year, (d) => map(d[key]))
    .flatMap(([year, es]) => es.map(([entity, count]) => ({year, entity, count})))
    .filter((d) => d.count > 0);
  const byYear = d3.rollup(agg, (v) => v.sort((a, b) => order.indexOf(a.entity) - order.indexOf(b.entity)), (d) => d.year);
  const shown = isolated && order.includes(isolated) ? agg.filter((d) => d.entity === isolated) : agg;
  const totals = [...d3.rollup(shown, (v) => d3.sum(v, (d) => d.count), (d) => d.year)].map(([year, total]) => ({year, total}));
  const mid = lastYear - (lastYear - 1957) * 0.45;
  const left = totals.filter((d) => d.year <= mid), right = totals.filter((d) => d.year > mid);
  const color = (e) => palette[e] ?? palette.Other;
  const label = metric === "launched" ? "launched" : "in orbit at year end";
  const tipText = (year) => {
    const rows = (byYear.get(year) ?? []).filter((d) => !isolated || d.entity === isolated);
    const tot = d3.sum(rows, (d) => d.count);
    return `${year} — ${fmtInt(tot)} ${label}\n` + rows.slice().sort((a, b) => b.count - a.count).slice(0, 10)
      .map((d) => `${d.entity}: ${fmtInt(d.count)} (${fmtPct(d.count / tot, 0)})`).join("\n");
  };

  const chart = Plot.plot({
    width, height: 440, marginLeft: 56, marginBottom: 36, style: {background: "transparent", color: "#e6edf7", fontSize: "12px"},
    x: {label: null, tickFormat: "d", interval: 1, ticks: d3.range(1960, lastYear + 1, 5)},
    y: {label: `Satellites ${label}`, grid: true, tickFormat: "s"},
    color: {domain: order, range: order.map(color)},
    marks: [
      Plot.barY(shown, {x: "year", y: "count", fill: "entity", order: (d) => order.indexOf(d.entity), insetLeft: 0.5, insetRight: 0.5,
        title: (d) => `${d.entity}\n${d.year}: ${fmtInt(d.count)}`}),
      Plot.ruleY([0]),
      Plot.ruleX(totals, Plot.pointerX({x: "year", stroke: "#ffb454", strokeOpacity: 0.7})),
      ...[[left, "top-left"], [right, "top-right"]].map(([data, anchor]) =>
        Plot.tip(data, Plot.pointerX({x: "year", y: "total", title: (d) => tipText(d.year), anchor, lineHeight: 1.25,
          fill: "#070d18", stroke: "#4cc9f0", fillOpacity: 0.96})))
    ]
  });

  const legend = h("div", {class: "chart-legend", role: "group", "aria-label": "Legend – click to isolate"},
    order.map((e) => h("button", {type: "button", class: isolated && isolated !== e ? "off" : "", title: "Click to isolate",
      onClick: () => onIsolate(isolated === e ? null : e)},
      h("span", {class: "sw", style: `background:${color(e)}`}), e)));
  return h("div", {}, chart, legend);
}

/** Donut with hover, centre total, top-N + Other. rows: [{name, value}] */
export function donut({rows, colorOf, topN, size = 380, label}) {
  const sorted = rows.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const named = sorted.filter((d) => !SPECIAL.includes(d.name));
  const head = named.slice(0, topN);
  const rest = d3.sum([...named.slice(topN), ...sorted.filter((d) => d.name === "Other")], (d) => d.value);
  const slices = [...head, ...(rest ? [{name: "Other", value: rest}] : []), ...sorted.filter((d) => d.name === "Unknown")];
  const total = d3.sum(slices, (d) => d.value);
  const R = size / 2, arc = d3.arc().innerRadius(R * 0.62).outerRadius(R - 4).padAngle(0.008).cornerRadius(3);
  const arcHover = d3.arc().innerRadius(R * 0.6).outerRadius(R).padAngle(0.008).cornerRadius(3);
  const pie = d3.pie().value((d) => d.value).sort(null)(slices);

  const svg = d3.create("svg").attr("viewBox", [-R, -R, size, size]).attr("width", size).attr("height", size).attr("role", "img")
    .attr("aria-label", `${label}: ${fmtInt(total)} satellites`);
  const centerBig = svg.append("text").attr("class", "donut-center").attr("text-anchor", "middle").attr("dy", "-0.1em")
    .attr("font-size", 38).attr("font-weight", 700).attr("fill", "#fff").text(fmtInt(total));
  const centerSub = svg.append("text").attr("class", "donut-center").attr("text-anchor", "middle").attr("dy", "1.8em")
    .attr("font-size", 13).attr("fill", "#8ea2bd").text("satellites");
  const tip = h("div", {class: "panel", style: "position:fixed;pointer-events:none;display:none;padding:8px 10px;font-size:12.5px;z-index:50"});
  const reset = () => { centerBig.text(fmtInt(total)); centerSub.text("satellites"); };

  svg.selectAll("path").data(pie).join("path").attr("d", arc).attr("fill", (d) => colorOf(d.data.name)).attr("stroke", "#000")
    .style("cursor", "pointer").style("transition", "opacity .15s")
    .on("pointerenter", function (e, d) {
      svg.selectAll("path").attr("opacity", 0.35); d3.select(this).attr("opacity", 1).attr("d", arcHover);
      centerBig.text(fmtInt(d.data.value)); centerSub.text(`${d.data.name} · ${fmtPct(d.data.value / total)}`);
      tip.style.display = "block";
    })
    .on("pointermove", (e, d) => {
      tip.innerHTML = `<b>${d.data.name}</b><br>${fmtInt(d.data.value)} satellites · ${fmtPct(d.data.value / total)}`;
      tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`;
    })
    .on("pointerleave", function () {
      svg.selectAll("path").attr("opacity", 1).attr("d", arc); tip.style.display = "none"; reset();
    });

  const legend = h("div", {class: "chart-legend", style: "flex-direction:column;gap:3px"},
    slices.map((s) => h("div", {style: "display:flex;gap:8px;align-items:center;font-size:13px"},
      h("span", {class: "sw", style: `background:${colorOf(s.name)}`}), h("span", {style: "min-width:190px"}, s.name),
      h("span", {style: "color:var(--muted);font-variant-numeric:tabular-nums"}, `${fmtInt(s.value)} · ${fmtPct(s.value / total)}`))));
  return h("div", {class: "donut-wrap"}, svg.node(), legend, tip);
}
