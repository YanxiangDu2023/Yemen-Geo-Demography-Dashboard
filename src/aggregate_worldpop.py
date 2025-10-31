# src/aggregate_worldpop.py
import re
import json
from pathlib import Path
from collections import defaultdict

import geopandas as gpd
import pandas as pd
from rasterstats import zonal_stats

# Configuration
ADM_GEOJSON = Path("data/yemen_adm3.geojson")  
WORLDPOP_DIR = Path("data/worldpop")           
OUT_CSV = Path("data/adm3_population_timeseries.csv")
OUT_GEOJSON = Path("data/yemen_adm3_population.geojson")

# Target years — 2030 may be skipped if no raster file exists
YEARS = [2015, 2020, 2025, 2030]

# Six demographic age groups (5-year intervals)
BUCKETS = {
    "pre_school":   [(0, 4)],
    "school_age":   [(5, 9), (10, 14)],
    "university_age":[(15, 19), (20, 24)],
    "working_age":  [(25, 29), (30, 34), (35, 39), (40, 44), (45, 49), (50, 54), (55, 59)],
    "retirement_age":[(60, 64), (65, 69), (70, 74), (75, 79)],
    "eighty_plus":  [(80, 120)],  # upper bound = 120
}

# Parse year/age/sex from WorldPop raster file names.
# Supports patterns like:
#   yem_ppp_2015_1km_AgeSex_5_9_f.tif
#   yem_2015_5_9_m.tif
#   yem_f_05_2025_CN_1km_R2025A_UA_v1.tif
NAME_RE = re.compile(
    r"^yem_(?P<sex>[fm])_(?P<age>\d{2})_(?P<year>20\d{2})_.*\.tif$",
    re.IGNORECASE
)

def parse_tif_info(path: Path):
    """
    Parse the .tif filename and extract metadata: year, age_lo, age_hi, sex.
    Rules:
      - 00, 01 → merged into 0–4 (pre_school)
      - 05, 10, ..., 75 → [age, age+4]
      - 80, 85, 90 → treated as 80+ (upper bound set to 120)
    """
    m = NAME_RE.match(path.name)
    if not m:
        return None

    sex = m.group("sex").lower()      # 'f' or 'm'
    year = int(m.group("year"))
    age_lo = int(m.group("age"))

    # Infer age_hi
    if age_lo in (0, 1):
        age_hi = 4
        age_lo = 0     # merge both 0/1 into 0–4
    elif age_lo >= 80:
        age_hi = 120
        age_lo = 80
    else:
        age_hi = age_lo + 4

    return {"year": year, "age_lo": age_lo, "age_hi": age_hi, "sex": sex}


def band_to_bucket(age_lo, age_hi):
    """Map 5-year age bands into one of the 6 defined buckets."""
    for bucket, ranges in BUCKETS.items():
        for lo, hi in ranges:
            if age_lo >= lo and age_hi <= hi:
                return bucket
    return None


def main():
    # 1) Read ADM3 boundaries
    gdf = gpd.read_file(ADM_GEOJSON)
    if gdf.crs is None or gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")

    # Compute area (km²) for density calculation
    # Use equal-area projection (simplified EPSG:3395 in meters → convert to km²)
    area_gdf = gdf.to_crs(3395).copy()
    gdf["area_km2"] = area_gdf.geometry.area / 1_000_000.0

    # 2) Scan all .tif files and organize by (year, age bucket)
    files = sorted(WORLDPOP_DIR.glob("*.tif"))
    by_year_bucket = defaultdict(list)
    for fp in files:
        meta = parse_tif_info(fp)
        if not meta:
            # Skip if filename does not match pattern
            continue
        bucket = band_to_bucket(meta["age_lo"], meta["age_hi"])
        if not bucket:
            continue
        if meta["year"] not in YEARS:
            continue
        by_year_bucket[(meta["year"], bucket)].append(fp)

    # 3) For each (year, bucket) compute zonal population sums
    #    If multiple files (e.g., female + male), sum their results
    records = []
    id_col = None
    # Choose a valid primary key column (prefer P-code)
    for cand in ["ADM3_PCODE", "adm3_pcode", "ADM2_PCODE", "ADM3_EN", "adm3_en"]:
        if cand in gdf.columns:
            id_col = cand
            break
    if not id_col:
        raise ValueError("ADM3 geojson missing an identifier column (ADM3_PCODE/ADM3_EN)")

    # Time-series accumulator
    # ts[(adm_id, year)][bucket] = population value
    ts = defaultdict(lambda: defaultdict(float))

    for (year, bucket), paths in by_year_bucket.items():
        # Sum up zonal population values across all gender files
        summed = None
        for tif_path in paths:
            zs = zonal_stats(
                gdf, tif_path, stats=["sum"],
                all_touched=False,  # strict boundary; set True for inclusive mode
                nodata=-99999
            )
            vals = [row.get("sum") or 0.0 for row in zs]
            if summed is None:
                summed = vals
            else:
                summed = [a + b for a, b in zip(summed, vals)]

        # Save results to time-series dictionary
        for adm_id, val in zip(gdf[id_col].tolist(), summed):
            ts[(adm_id, year)][bucket] += float(val or 0.0)

    # 4) Flatten results into long-form CSV
    rows = []
    for adm_id in gdf[id_col].tolist():
        for year in YEARS:
            bucket_vals = {b: ts[(adm_id, year)].get(b, 0.0) for b in BUCKETS.keys()}
            total = sum(bucket_vals.values())
            rows.append({
                "adm3_id": adm_id,
                "year": year,
                **bucket_vals,
                "total": total
            })
    df = pd.DataFrame(rows)
    # Drop years with total = 0 (missing rasters)
    df = df[df["total"] > 0].copy()
    df.to_csv(OUT_CSV, index=False)
    print(f"✅ CSV written: {OUT_CSV.resolve()} (rows={len(df)})")

    # 5) Create GeoJSON for frontend visualization (latest year only)
    latest_year = df["year"].max()
    latest = df[df["year"] == latest_year].copy()
    latest = latest.rename(columns={"adm3_id": id_col})
    mg = gdf.merge(latest, on=id_col, how="left")
    # Compute population density (people per km²)
    mg["density"] = mg["total"] / mg["area_km2"].replace({0: pd.NA})
    mg.to_file(OUT_GEOJSON, driver="GeoJSON")
    print(f"✅ GEOJSON written: {OUT_GEOJSON.resolve()} (year={latest_year})")

    # 6) Save a lightweight JSON (for frontend click-based insight)
    light = {}
    for adm_id, sub in df.groupby("adm3_id"):
        light[adm_id] = sub.sort_values("year").to_dict(orient="records")
    Path("data/adm3_timeseries.json").write_text(json.dumps(light))
    print("✅ JSON written: data/adm3_timeseries.json")


if __name__ == "__main__":
    main()
