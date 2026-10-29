// Small dependency-free UI widgets for the globe page.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

/** Dual-handle range slider. Calls onInput({start, end}) continuously while dragging. */
export function rangeSlider({min, max, start, end, onInput}) {
  const a = h("input", {type: "range", min, max, step: 1, value: start, "aria-label": "Range start"});
  const b = h("input", {type: "range", min, max, step: 1, value: end, "aria-label": "Range end"});
  const fill = h("div", {class: "fill"});
  const el = h("div", {class: "range"}, h("div", {class: "track"}), fill, a, b);
  const span = max - min || 1;
  const state = {start, end};
  function draw() {
    fill.style.left = `${((state.start - min) / span) * 100}%`;
    fill.style.right = `${100 - ((state.end - min) / span) * 100}%`;
    a.value = state.start; b.value = state.end;
    // when both thumbs overlap on the right half, the start thumb must stay grabbable
    a.style.zIndex = state.start > min + span / 2 ? 3 : 1;
    b.style.zIndex = 2;
  }
  a.addEventListener("input", () => {
    state.start = Math.min(+a.value, state.end); draw(); onInput({...state});
  });
  b.addEventListener("input", () => {
    state.end = Math.max(+b.value, state.start); draw(); onInput({...state});
  });
  draw();
  return {
    el,
    get value() { return {...state}; },
    set(s, e, silent = false) {
      state.start = s; state.end = e; draw(); if (!silent) onInput({...state});
    }
  };
}

/** Searchable single-select dropdown. options: [{value, label?, count?}]; value null = "All". */
export function combobox({placeholder, allLabel, options, onChange}) {
  const input = h("input", {type: "text", placeholder: allLabel, autocomplete: "off", spellcheck: "false", "aria-label": placeholder});
  const clear = h("button", {class: "clear", type: "button", title: "Show all", hidden: true}, "×");
  const list = h("ul", {role: "listbox", hidden: true});
  const el = h("div", {class: "combo"}, input, clear, list);
  let current = null, open = false, active = 0, shown = [];

  function render() {
    const q = input.value.trim().toLowerCase();
    const filtered = q && q !== (current ?? "").toLowerCase()
      ? options.filter((o) => o.value.toLowerCase().includes(q)) : options;
    shown = [{value: null, label: allLabel}, ...filtered.slice(0, 120)];
    active = Math.min(active, shown.length - 1);
    list.replaceChildren(...shown.map((o, i) => h("li", {role: "option", "aria-selected": i === active ? "true" : "false",
      onMousedown: (e) => { e.preventDefault(); choose(o.value); }},
      h("span", {}, o.label ?? o.value), h("span", {}, o.count != null ? o.count.toLocaleString("en-US") : ""))));
    list.hidden = !open;
  }
  function choose(v, silent = false) {
    current = v; input.value = v ?? ""; clear.hidden = v == null; open = false; list.hidden = true;
    input.blur();
    if (!silent) onChange(v);
  }
  input.addEventListener("focus", () => { open = true; input.select(); render(); });
  input.addEventListener("blur", () => { open = false; list.hidden = true; input.value = current ?? ""; });
  input.addEventListener("input", () => { open = true; active = 1; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(active + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Enter") { choose(shown[active]?.value ?? null); }
    else if (e.key === "Escape") { input.blur(); }
  });
  clear.addEventListener("click", () => choose(null));
  return {el, get value() { return current; }, set: (v) => choose(v, true)};
}
