// Globe page: wires data -> 3D engine -> controls (date range, highlight, colour mode, tooltip, live motion).
import {createGlobe} from "./globe.js";
import {h, rangeSlider, combobox} from "./controls.js";
import {makeColors, colorModes, hexToRgb} from "./colors.js";
import {fmtInt, fmtKm, fmtDeg, isoDate} from "./format.js";

export function createAtlas({meta, table, textures, loadGp}) {
  const n = table.numRows;
  const num = (name) => table.getChild(name).toArray();
  const str = (name) => { const v = table.getChild(name); return Array.from({length: n}, (_, i) => v.get(i)); };

  // ---- columns -> typed arrays, once
  const px = num("x"), py = num("y"), pz = num("z");
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { positions[3 * i] = px[i]; positions[3 * i + 1] = py[i]; positions[3 * i + 2] = pz[i]; }
  const launch = num("launch_day"), decay = num("decay_day");
  const S = {
    id: num("norad_id"), name: str("name"), country: str("country"), operator: str("operator"),
    purpose: str("purpose"), detail: str("detailed_purpose"), orbit: str("orbit_class"), status: str("status"),
    src: str("position_source"), ld: str("launch_date"), dd: str("decay_date"),
    alt: num("alt_km"), inc: num("inclination"), peri: num("perigee_km"), apo: num("apogee_km"), intl: str("intl_designator")
  };
  const rec = (i) => ({purpose: S.purpose[i], country: S.country[i], orbit_class: S.orbit[i]});

  const colors = makeColors(meta);
  const modes = colorModes(meta, colors);
  const colorBuffers = {};
  const colorsFor = (mode) => colorBuffers[mode] ??= (() => {
    const buf = new Float32Array(n * 3), cache = new Map();
    for (let i = 0; i < n; i++) {
      const hex = modes[mode].of(rec(i));
      let rgb = cache.get(hex); if (!rgb) cache.set(hex, rgb = hexToRgb(hex));
      buf.set(rgb, 3 * i);
    }
    return buf;
  })();

  // ---- state
  const maxDay = meta.snapshot_day;
  const st = {start: 0, end: maxDay, country: null, operator: null, mode: "purpose", live: false, playing: false};
  let flags = null; // Uint8Array(n) when a highlight is active

  // ---- DOM
  const stage = h("div", {class: "stage"});
  const loading = h("div", {class: "loading"}, "Loading satellites…");
  const counter = h("div", {class: "counter"});
  const labels = h("div", {class: "range-labels"});
  const tooltip = h("div", {class: "panel tooltip"});
  const legend = h("div", {class: "panel legend"});
  const hint = h("div", {class: "hint"}, "Drag to rotate · scroll to zoom · hover a dot for details");

  const slider = rangeSlider({min: 0, max: maxDay, start: 0, end: maxDay, onInput: ({start, end}) => { st.start = start; st.end = end; update(); }});
  const playBtn = h("button", {class: "btn", type: "button", title: "Animate the end date from 1957 to today"}, "▶ Play history");
  const resetBtn = h("button", {class: "btn", type: "button"}, "Reset");

  const tally = (key) => { const m = new Map(); for (let i = 0; i < n; i++) m.set(S[key][i], (m.get(S[key][i]) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  const countryBox = combobox({placeholder: "Country", allLabel: "All countries",
    options: tally("country").map(([value, count]) => ({value, count})), onChange: (v) => { st.country = v; recomputeHighlight(); }});
  const operatorBox = combobox({placeholder: "Company / operator", allLabel: "All companies / operators",
    options: tally("operator").map(([value, count]) => ({value, count})), onChange: (v) => { st.operator = v; recomputeHighlight(); }});

  const modeBtns = Object.entries(modes).map(([key, m]) =>
    h("button", {type: "button", "aria-pressed": key === st.mode, onClick: () => setMode(key)}, m.label));
  const modeSeg = h("div", {class: "seg", role: "group", "aria-label": "Colour dots by"}, modeBtns);

  const liveInput = h("input", {type: "checkbox"});
  const liveLabel = h("label", {class: "toggle", title: "Animate satellites with current orbital elements (SGP4 in the browser)"}, liveInput, "Live motion");
  const liveClock = h("div", {class: "note", style: "font-size:12px;color:var(--muted)"});
  const speedSel = h("select", {"aria-label": "Simulation speed"}, ...[[10, "10×"], [60, "60×"], [300, "300×"]].map(([v, t]) => h("option", {value: v, selected: v === 60}, t)));
  const rotInput = h("input", {type: "checkbox", checked: true});
  const rotLabel = h("label", {class: "toggle"}, rotInput, "Auto-rotate");

  const controls = h("div", {class: "panel controls"},
    counter,
    h("div", {}, h("h3", {}, "Launch window"), slider.el, labels,
      h("div", {class: "row", style: "margin-top:8px"}, playBtn, resetBtn)),
    h("div", {}, h("h3", {}, "Highlight"),
      h("div", {style: "display:flex;flex-direction:column;gap:8px"}, countryBox.el, operatorBox.el)),
    h("div", {}, h("h3", {}, "Colour by"), modeSeg),
    h("div", {class: "row"}, rotLabel, liveLabel, speedSel),
    liveClock);

  const root = h("div", {class: "atlas"}, stage, controls, legend, tooltip, hint, loading);

  // ---- 3D
  let g = null, raf = 0, disposed = false;
  function mount() {
    g = createGlobe(stage, {positions, colors: colorsFor(st.mode), launch, decay, textures, snapshot: new Date(meta.snapshot_time)});
    const resize = () => g.resize(root.clientWidth, root.clientHeight);
    resize();
    const ro = new ResizeObserver(resize); ro.observe(root);
    cleanup.push(() => ro.disconnect());
    update(); drawLegend();
    requestAnimationFrame(() => loading.remove());
    wirePointer();
  }
  const cleanup = [];

  // ---- derived values
  const isVisible = (i) => launch[i] >= st.start && launch[i] <= st.end && decay[i] > st.end;
  const isShown = (i) => isVisible(i) && (!flags || flags[i] === 1);

  function update() {
    g?.setRange(st.start, st.end);
    let vis = 0, hl = 0;
    for (let i = 0; i < n; i++) if (isVisible(i)) { vis++; if (flags && flags[i]) hl++; }
    const full = st.start === 0;
    counter.replaceChildren(
      h("div", {}, fmtInt(vis)),
      h("small", {}, full
        ? `satellites in orbit on ${isoDate(st.end)}`
        : `launched ${isoDate(st.start)} → ${isoDate(st.end)} and still in orbit on ${isoDate(st.end)}`),
      ...(flags ? [h("small", {class: "hl"}, `${fmtInt(hl)} highlighted`)] : []));
    labels.replaceChildren(h("span", {}, "from ", h("b", {}, isoDate(st.start))), h("span", {}, "to ", h("b", {}, isoDate(st.end))));
    hideTip();
  }

  function recomputeHighlight() {
    if (!st.country && !st.operator) flags = null;
    else {
      flags = new Uint8Array(n);
      for (let i = 0; i < n; i++)
        flags[i] = (!st.country || S.country[i] === st.country) && (!st.operator || S.operator[i] === st.operator) ? 1 : 0;
    }
    g?.setHighlight(flags);
    update();
  }

  function setMode(key) {
    st.mode = key;
    modeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(modes)[i] === key)));
    g?.setColors(colorsFor(key));
    drawLegend();
  }

  function drawLegend() {
    legend.replaceChildren(h("h3", {}, modes[st.mode].label),
      ...modes[st.mode].legend.map((e) => h("div", {class: "item", style: `color:${e.color}`},
        h("span", {class: "dot", style: `background:${e.color}`}), h("span", {style: "color:var(--theme-foreground)"}, e.label))));
  }

  // ---- play history
  let lastT = 0;
  function playLoop(t) {
    if (!st.playing || disposed) return;
    const dt = Math.min(t - lastT, 50); lastT = t;
    const rate = maxDay / 32000; // ≈ 32 s from 1957 to today
    const end = Math.min(maxDay, slider.value.end + dt * rate);
    slider.set(slider.value.start, end);
    if (end >= maxDay) { stop(); return; }
    raf = requestAnimationFrame(playLoop);
  }
  function stop() { st.playing = false; playBtn.textContent = "▶ Play history"; cancelAnimationFrame(raf); }
  playBtn.addEventListener("click", () => {
    if (st.playing) return stop();
    st.playing = true; playBtn.textContent = "❚❚ Pause";
    if (slider.value.end >= maxDay) slider.set(slider.value.start, slider.value.start);
    lastT = performance.now(); raf = requestAnimationFrame(playLoop);
  });
  resetBtn.addEventListener("click", () => {
    stop(); slider.set(0, maxDay); countryBox.set(null); operatorBox.set(null);
    st.country = st.operator = null; recomputeHighlight();
  });
  rotInput.addEventListener("change", () => g?.setAutoRotate(rotInput.checked));

  // ---- tooltip (CPU picking: respects the date filter and highlight, ignores dots behind the Earth)
  let pending = null, tipIdx = -1;
  function hideTip() { tooltip.style.display = "none"; tipIdx = -1; }
  function showTip(i, x, y) {
    if (i !== tipIdx) {
      tipIdx = i;
      const row = (k, v) => [h("dt", {}, k), h("dd", {}, v)];
      const live = S.src[i] === "sgp4";
      tooltip.replaceChildren(
        h("div", {class: "t-name"}, S.name[i]),
        h("div", {class: "t-sub"}, `NORAD ${S.id[i]} · ${S.intl[i] ?? ""}`),
        h("dl", {},
          ...row("Country", S.country[i]), ...row("Operator", S.operator[i]),
          ...row("Purpose", S.detail[i] ? `${S.purpose[i]} (${S.detail[i]})` : S.purpose[i]),
          ...row("Launched", S.ld[i] ?? "–"), ...row("Decayed", S.dd[i] ?? "still in orbit"),
          ...row("Orbit", `${S.orbit[i]} · ${fmtKm(S.alt[i])} alt`), ...row("Inclination", fmtDeg(S.inc[i])),
          ...row("Status", S.status[i]),
          ...row("Position", h("span", {class: live ? "live" : "approx"}, live ? "● current (SGP4)" : "○ approximate (illustrative)"))));
    }
    tooltip.style.display = "block";
    const w = root.clientWidth, hh = root.clientHeight, tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(x + 16, w - tw - 8)}px`;
    tooltip.style.top = `${Math.min(Math.max(y - th / 2, 8), hh - th - 8)}px`;
  }
  function wirePointer() {
    const el = stage;
    let down = false;
    el.addEventListener("pointerdown", () => { down = true; hideTip(); });
    addEventListener("pointerup", () => { down = false; });
    el.addEventListener("pointerleave", () => { hideTip(); g.setAutoRotate(rotInput.checked); });
    el.addEventListener("pointermove", (e) => {
      if (down || !g) return;
      const r = el.getBoundingClientRect(); pending = [e.clientX - r.left, e.clientY - r.top];
      if (el._raf) return;
      el._raf = requestAnimationFrame(() => {
        el._raf = 0;
        const [x, y] = pending;
        const i = g.pick(x, y, isShown, 9);
        if (i >= 0) { showTip(i, x, y); g.setAutoRotate(false); el.style.cursor = "pointer"; }
        else { hideTip(); g.setAutoRotate(rotInput.checked); el.style.cursor = ""; }
      });
    });
  }

  // ---- live motion (satellite.js, only for satellites that have current GP elements)
  let live = null, liveTimer = 0;
  async function startLive() {
    liveClock.textContent = "Loading orbital elements…";
    if (!live) {
      let gp, sat;
      try { [gp, sat] = await Promise.all([loadGp(), import("satellite.js")]); }
      catch (e) { liveClock.textContent = "Orbital elements unavailable."; liveInput.checked = false; return; }
      const index = new Map(S.id.map((id, i) => [Number(id), i]));
      const f = Object.fromEntries(gp.fields.map((k, j) => [k, j]));
      const items = [];
      for (const row of gp.rows) {
        const obj = Object.fromEntries(gp.fields.map((k, j) => [k, row[j]]));
        const i = index.get(Number(obj.NORAD_CAT_ID));
        if (i == null) continue;
        try { items.push({i, rec: sat.json2satrec(obj)}); } catch { /* skip bad element set */ }
      }
      live = {sat, items, base: Float32Array.from(positions)};
    }
    if (!live.items.length) {
      liveClock.textContent = "No current orbital elements in this snapshot."; liveInput.checked = false; st.live = false; return;
    }
    liveClock.textContent = "";
    const t0 = performance.now(), simT0 = new Date(meta.snapshot_time).getTime();
    let busy = 0;
    const {sat, items} = live;
    const {k_scale: K, r_earth_km: Re} = meta.display;
    const step = () => {
      if (!st.live || disposed) return;
      const t = performance.now();
      const speed = +speedSel.value;
      const date = new Date(simT0 + (t - t0) * speed);
      const gm = sat.gstime(date), cg = Math.cos(gm), sg = Math.sin(gm);
      const out = g.positionArray;
      for (const {i, rec: r} of items) {
        const p = sat.propagate(r, date)?.position;
        if (!p || typeof p.x !== "number" || Number.isNaN(p.x)) continue;
        const x = cg * p.x + sg * p.y, y = -sg * p.x + cg * p.y, z = p.z;
        const rr = Math.hypot(x, y, z), lat = Math.asin(z / rr), lon = Math.atan2(y, x);
        const alt = rr - Re * (1 - Math.sin(lat) ** 2 / 298.257);
        const rad = (1 + K * Math.sqrt(Math.max(alt, 0) / Re)) * 100;
        const phi = Math.PI / 2 - lat, th = Math.PI / 2 - lon;
        out[3 * i] = rad * Math.sin(phi) * Math.cos(th); out[3 * i + 1] = rad * Math.cos(phi); out[3 * i + 2] = rad * Math.sin(phi) * Math.sin(th);
      }
      g.points.geometry.attributes.position.needsUpdate = true;
      liveClock.textContent = `Simulated time (UTC): ${date.toISOString().slice(0, 19).replace("T", " ")}`;
      busy = performance.now() - t;
      liveTimer = setTimeout(step, Math.max(150, busy * 2)); // adapt to device speed
    };
    step();
  }
  function stopLive() {
    clearTimeout(liveTimer);
    if (live && g) g.setPositions(live.base);
    liveClock.textContent = "";
  }
  liveInput.addEventListener("change", () => {
    st.live = liveInput.checked;
    if (st.live) startLive(); else stopLive();
  });

  queueMicrotask(mount);
  return {
    element: root,
    dispose() {
      disposed = true; stop(); clearTimeout(liveTimer);
      cleanup.forEach((f) => f()); g?.dispose();
    }
  };
}
