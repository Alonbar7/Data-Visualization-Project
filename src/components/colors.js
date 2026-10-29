// Palettes come from meta.json (written by the Python pipeline) so that every page
// uses exactly the same colours for the same country / operator / purpose.
export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function makeColors(meta) {
  const {purpose, country, operator_group, orbit_class} = meta.palettes;
  const other = country.Other;
  return {
    purpose: (k) => purpose[k] ?? purpose.Other,
    country: (k) => country[k] ?? other,
    operator: (k) => operator_group[k] ?? operator_group.Other,
    orbit: (k) => orbit_class[k] ?? orbit_class.Unknown,
    palettes: meta.palettes
  };
}

// colour modes offered on the globe: key -> {label, accessor on satellite record, legend entries}
export function colorModes(meta, colors) {
  const legendOf = (pal, order) => (order ?? Object.keys(pal)).map((k) => ({label: k, color: pal[k]}));
  return {
    purpose: {label: "Purpose", of: (s) => colors.purpose(s.purpose), legend: legendOf(meta.palettes.purpose)},
    country: {label: "Country", of: (s) => colors.country(s.country), legend: legendOf(meta.palettes.country)},
    orbit: {label: "Orbit class", of: (s) => colors.orbit(s.orbit_class),
            legend: legendOf(meta.palettes.orbit_class, ["LEO", "MEO", "GEO", "HEO", "Unknown"])}
  };
}
