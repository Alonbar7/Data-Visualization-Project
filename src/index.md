---
title: Orbit Atlas
toc: false
footer: false
---

```js
import {createAtlas} from "./components/atlas.js";

const meta = await FileAttachment("data/meta.json").json();
const table = await FileAttachment("data/satellites.parquet").parquet();
const textures = {
  day: await FileAttachment("assets/earth-day.jpg").url(),
  night: await FileAttachment("assets/earth-night.jpg").url()
};
const gpFile = FileAttachment("data/gp_active.json");

const atlas = createAtlas({meta, table, textures, loadGp: () => gpFile.json()});
invalidation.then(() => atlas.dispose());
display(atlas.element);
```
