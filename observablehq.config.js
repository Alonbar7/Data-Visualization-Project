// Orbit Atlas – Observable Framework configuration.
// `base` must match the GitHub repository name (project pages are served from /<repo>/).
const BASE = "/Data-Visualization-Project/";

export default {
  root: "src",
  title: "Orbit Atlas",
  base: BASE,
  theme: "dark",
  style: "style.css",
  sidebar: false,
  toc: false,
  pager: false,
  search: false,
  header: `<nav class="topnav" aria-label="Main">
    <a class="brand" href="./"><span class="brand-dot"></span>Orbit Atlas</a>
    <a data-nav="globe" href="./">Globe</a>
    <a data-nav="stats" href="stats">Statistics</a>
    <a data-nav="about" href="about">About</a>
  </nav>`,
  head: `<meta name="theme-color" content="#000000">
  <script type="module">
    // mark the current page in the top navigation
    addEventListener("DOMContentLoaded", () => {
      const p = location.pathname.replace(/\\/$/, "").split("/").pop();
      const key = p === "stats" || p === "about" ? p : "globe";
      document.querySelector(\`.topnav [data-nav="\${key}"]\`)?.setAttribute("aria-current", "page");
    });
  </script>`,
  footer: `Data from GCAT (J. McDowell, planet4589.org/space/gcat) · CelesTrak · UCS Satellite Database`
};
