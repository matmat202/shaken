# Shaken

**<https://matmat202.github.io/shaken/>**

Every earthquake of magnitude 2.5 or more in the past day, week or month, on a world map,
straight from the US Geological Survey's live feed. The page shows how many there were, how
many reached M5 and M6, and the biggest.

Then the question people actually ask: **what shook near me?** Type a town, use your
location, or tap anywhere on the map, and pick a radius from 100 to 2,500 km. The list
shows the biggest (or the latest) quakes inside the circle, with how far away each one was.
When nothing is in range, it tells you how far away the nearest one was. The link keeps your
choice, so `?near=Tokyo, Japan&p=month` opens on it.

A month is too short for most places: within 500 km, more than half the world's people get
nothing M2.5+ in a typical month. **Since 1900** asks the USGS catalogue instead and lists
the 200 biggest (or latest) quakes ever recorded inside the circle, with counts at M2.5, M5
and M6 (`?p=ever&near=Palo Alto, California, United States`). With no town picked, it shows
the world's biggest since 1900.

After a big quake, the next question is **will there be more?** Quakes that USGS has issued
an aftershock forecast for get an **Aftershock forecast** button. Press it to see USGS's
chance of at least one aftershock of M5, M6 and M7 or more, and of one bigger than the
quake itself, over the forecast's current window (a day, a week, a month or a year from when
it was issued). It also shows the most likely number of M3+ aftershocks, with a 95% range.
USGS forecasts every US quake of about M4 or more, and a few large ones elsewhere (about
140 a year).

## Where the data comes from

- **Earthquakes:** the [USGS real-time GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
  of M2.5+ events over the past 30 days (public domain). It is fetched fresh every time the
  page opens; nothing is cached here. Magnitudes and locations get revised as seismologists
  review them, and small quakes far from any seismometer are never recorded at all. The
  coverage below M4 is much better in the US than elsewhere.
- **Since 1900:** the [USGS ComCat catalogue](https://earthquake.usgs.gov/fdsnws/event/1/),
  queried live for your place and radius. The older the quake and the farther it was from the
  US, the more likely it is that small ones were never recorded.
- **Aftershock forecasts:** USGS's [Operational Aftershock Forecasts](https://earthquake.usgs.gov/data/oaf/)
  (the `oaf` product in each event's detail), asked for only when you press the button.
- **Towns:** [GeoNames](https://www.geonames.org/) (CC BY 4.0), every place of 15,000 or
  more people, with its state or province.
- **Coastlines:** [Natural Earth](https://www.naturalearthdata.com/) 1:110m (public domain).

Distances are great-circle distances from the town's centre to the quake's epicentre.
"Damage likely" tags are USGS's PAGER alert levels (yellow, orange or red). Green means no
damage is expected, so it gets no tag. If you share your location, it stays in your browser.

Not affiliated with USGS. Built by Claude.
