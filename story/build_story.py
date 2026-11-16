#!/usr/bin/env python3
"""data/ -> site/story/story.json: do people live near big earthquakes more than chance?

    python3 build_story.py        # BUILD_OUT=... writes elsewhere (publish.sh compares)

Inputs, all frozen in data/:
  m6-1973-2025.csv     every M6+ earthquake in USGS ComCat, 1973-01-01 to 2025-12-31
                       (fdsnws/event/1/query?format=csv&minmagnitude=6&eventtype=earthquake)
  cities15000.zip      GeoNames: "all cities with a population > 15000 or capitals"
  ne_110m_land.geojson Natural Earth land, for the share of LAND near a quake

The question: what share of the people in those towns live within R km of an epicentre?
And the control that could kill it: slide every quake east by k degrees of longitude (same
latitudes, same pattern, wrong places) and ask again. Slides of 20+ degrees are the placebo.
Land is a half-degree grid, south of 60S dropped, each cell weighted by cos(latitude).

No RNG: the slides are every 5 degrees, so the page recomputes the same counts from the rows.
Distances are capped at R, so binning quakes by whole degree keeps it to seconds per slide.
"""
import collections, csv, io, json, math, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.environ.get("BUILD_OUT", os.path.join(HERE, "site", "story", "story.json"))
R = 100          # km
STEP = 0.5       # land grid, degrees
SLIDE = 5        # degrees between slides
NEAR = 20        # slides closer than this to the real map are neighbours, not placebo
BIG = 1_000_000  # towns drawn on the map (all 15k+ towns are counted)


def quakes():
    rows = []
    for r in csv.DictReader(open(os.path.join(DATA, "m6-1973-2025.csv"), encoding="utf-8")):
        assert r["type"] == "earthquake" and float(r["mag"]) >= 6, r
        rows.append((float(r["latitude"]), float(r["longitude"]), float(r["mag"]), r["time"][:4]))
    return rows


def towns():
    out = []
    with zipfile.ZipFile(os.path.join(DATA, "cities15000.zip")) as z:
        for line in io.TextIOWrapper(z.open("cities15000.txt"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            out.append((float(f[4]), float(f[5]), int(f[14]), f[8], f[1]))
    return out


def land_grid():
    rings = []
    for ft in json.load(open(os.path.join(DATA, "ne_110m_land.geojson")))["features"]:
        g = ft["geometry"]
        for p in g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]:
            r = p[0]
            rings.append((min(x for x, _ in r), max(x for x, _ in r), min(y for _, y in r), max(y for _, y in r), r))

    def inside(lon, lat):
        c = False
        for x0, x1, y0, y1, ring in rings:
            if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                continue
            for i in range(len(ring)):
                xa, ya = ring[i]
                xb, yb = ring[i - 1]
                if (ya > lat) != (yb > lat) and lon < (xb - xa) * (lat - ya) / (yb - ya) + xa:
                    c = not c
        return c

    land_grid.inside = inside
    cells = []
    for i in range(int(180 / STEP)):
        lat = -90 + STEP * (i + 0.5)
        if lat <= -60:
            continue
        for j in range(int(360 / STEP)):
            lon = -180 + STEP * (j + 0.5)
            if inside(lon, lat):
                cells.append((lat, lon, math.cos(math.radians(lat))))
    return cells


def near_fn(qs):
    """(lat, lon) -> is any quake in qs within R km"""
    b = collections.defaultdict(list)
    for q in qs:
        b[(math.floor(q[0]), math.floor(q[1]))].append((math.radians(q[0]), math.radians(q[1])))
    dl = int(R / 111) + 1

    def near(lat, lon):
        la, lo = math.radians(lat), math.radians(lon)
        cl = math.cos(la)
        dlon = min(180, int(R / (111 * max(0.05, math.cos(math.radians(min(89, abs(lat) + dl)))))) + 1)
        h_max = math.sin(R / 6371 / 2) ** 2
        for i in range(math.floor(lat) - dl, math.floor(lat) + dl + 1):
            for j in range(math.floor(lon) - dlon, math.floor(lon) + dlon + 1):
                for A, B in b.get((i, (j + 180) % 360 - 180), ()):
                    if math.sin((A - la) / 2) ** 2 + cl * math.cos(A) * math.sin((B - lo) / 2) ** 2 <= h_max:
                        return True
        return False
    return near


def main():
    Q, T, G = quakes(), towns(), land_grid()
    area = sum(g[2] for g in G)
    rot, real_near = [], None
    for k in range(0, 360, SLIDE):
        near = near_fn([(a, (b + k + 180) % 360 - 180) for a, b, *_ in Q])
        hit = [near(t[0], t[1]) for t in T]
        if k == 0:
            real_near = hit
        land = sum(g[2] for g in G if near(g[0], g[1])) / area
        share = lambda skip: (sum(t[2] for t, h in zip(T, hit) if h and t[3] not in skip)
                              / sum(t[2] for t in T if t[3] not in skip))
        rot.append([k, round(land, 6), round(share(()), 6), round(share(("CN",)), 6), round(share(("JP",)), 6)])

    countries = collections.defaultdict(lambda: [0, 0])
    for t, h in zip(T, real_near):
        countries[t[3]][0] += t[2]
        countries[t[3]][1] += t[2] if h else 0
    big = sorted(((t[4], t[3], round(t[0], 2), round(t[1], 2), t[2], int(h)) for t, h in zip(T, real_near) if t[2] >= BIG),
                 key=lambda r: -r[4])

    # the numbers the page must reproduce from these rows (story.test.mjs compares)
    far = [r for r in rot if NEAR <= r[0] <= 360 - NEAR]
    med = lambda xs: sorted(xs)[len(xs) // 2]
    tot = sum(v[0] for v in countries.values())
    check = {
        "n_quakes": len(Q), "n_far": len(far), "n_big": len(big), "n_big_near": sum(b[5] for b in big),
        "p": sum(v[1] for v in countries.values()) / tot,
        "land": rot[0][1], "land_med": med([r[1] for r in far]),
        "p_med": med([r[2] for r in far]), "p_max": max(r[2] for r in far),
        "beaten": sum(r[2] >= rot[0][2] for r in far),
        "pCN": rot[0][3], "pCN_max": max(r[3] for r in far), "beatenCN": sum(r[3] >= rot[0][3] for r in far),
        "pJP": rot[0][4], "pJP_med": med([r[4] for r in far]), "beatenJP": sum(r[4] >= rot[0][4] for r in far),
    }
    D = {
        "source": "USGS ComCat M6+ 1973-2025 (public domain); GeoNames cities15000 (CC BY 4.0); Natural Earth 1:110m land",
        "R": R, "slide": SLIDE, "near": NEAR, "big": BIG, "years": [min(q[3] for q in Q), max(q[3] for q in Q)],
        "quakes": [[round(a, 1), round(b, 1), m] for a, b, m, _ in Q],
        "towns": big,
        "countries": {k: v for k, v in sorted(countries.items())},
        "rot": rot,
        "on_land": sum(land_grid.inside(b, a) for a, b, *_ in Q),  # epicentres on Natural Earth land
        "check": check,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(D, f, separators=(",", ":"), ensure_ascii=False)
    print(json.dumps(check, indent=1))


if __name__ == "__main__":
    main()
