// Number / date helpers shared by every page. Day 0 = 1957-10-04 (Sputnik 1 launch).
export const EPOCH_MS = Date.UTC(1957, 9, 4);
const DAY = 86400000;

export const dayToDate = (d) => new Date(EPOCH_MS + d * DAY);
export const dateToDay = (date) => Math.round((date.getTime() - EPOCH_MS) / DAY);
export const isoDate = (d) => dayToDate(d).toISOString().slice(0, 10);
export const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
export const fmtPct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const fmtKm = (km) => (km == null || Number.isNaN(km) ? "–" : `${Math.round(km).toLocaleString("en-US")} km`);
export const fmtDeg = (d) => (d == null || Number.isNaN(d) ? "–" : `${d.toFixed(1)}°`);
export const fmtDate = (s) => (s ? s : "–");
