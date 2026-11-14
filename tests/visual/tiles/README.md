# Map tiles for the visual tests

The 15 map tiles the visual tests' fixtures show, at `z/x/y.png`, so their maps are real maps
without reaching the network (#338). `tests/visual/helpers.ts`'s `mockApis` serves them in
place of production's CARTO tiles and the location picker's OpenStreetMap ones.

They are OpenStreetMap's standard tiles, **© OpenStreetMap contributors**. The map data is
available under the Open Database License (ODbL); see
[openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) for the current terms.
They were captured once, one tile at a time, for these tests only, and are never served to
anyone. A new one is saved by hand, from a browser, when a fixture's map moves (the test that
needs it names it): there's no script, since OpenStreetMap's tile servers are for people
browsing the map, and its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
turns away tools that don't identify themselves. Production's own maps keep their attribution in
the map's credit (the ⓘ button), which every baseline with a map shows.

The standard layer has no 512 px tiles, so where the phone (3×) asks CARTO for `@2x` tiles,
the baselines show these 256 px ones scaled up: a softer map than a retina phone gets.
