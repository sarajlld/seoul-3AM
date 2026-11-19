"""
새벽 세 시, 서울 — 데이터 빌드 스크립트

원본 CSV 두 개를 읽어서 웹에서 쓰는 data/places.geojson 을 만든다.

  raw/stores.csv     : 소상공인시장진흥공단 상가(상권)정보 (서울)
  raw/emergency.csv  : 서울시 응급실 위치 정보 (서울 열린데이터광장, cp949)
  raw/rest.csv       : 서울시 휴게음식점 인허가 정보 (서울 열린데이터광장, cp949)
                       → 편의점 이름·폐업 여부를 바로잡는 데 사용

실행:
  pip install pandas
  python scripts/build_data.py
"""
import json
import unicodedata
from pathlib import Path

import re

import pandas as pd
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
STORES = ROOT / "raw" / "stores.csv"
EMERGENCY = ROOT / "raw" / "emergency.csv"
LICENSE = ROOT / "raw" / "rest.csv"
OUT = ROOT / "data" / "places.geojson"
META = ROOT / "data" / "meta.json"
TOTAL_STORES = 0

# 상가정보 소분류명 → 우리 카테고리
CATEGORY = {
    "약국": "pharmacy",
    "편의점": "convenience",
    "PC방": "pc",
    "목욕탕/사우나": "sauna",
    "만화방": "comic",
}

# 24시간일 가능성이 높은 대형 편의점 브랜드 (상호명에 포함되는지로 판단)
BRANDS = ["CU", "씨유", "GS25", "지에스25", "세븐일레븐", "세븐", "7-ELEVEN",
          "7ELEVEN", "이마트24", "이마트이십사", "EMART24", "미니스톱"]


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).upper().replace(" ", "")


def is_brand(name: str) -> bool:
    n = norm(name)
    return any(b in n for b in BRANDS)


def feature(lng, lat, props):
    return {"type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(lng), 6), round(float(lat), 6)]},
            "properties": props}


def addr_key(a):
    """'서울특별시 노원구 공릉로 232, 105호 (공릉동)' → '서울특별시노원구공릉로232'"""
    if not isinstance(a, str):
        return None
    a = re.sub(r"\(.*?\)", "", a.split(",")[0])
    a = a.replace("지하 ", "")
    return a.replace(" ", "") or None


def clean_name(n):
    n = unicodedata.normalize("NFKC", n)
    for a, b in [("(주)코리아세븐", "세븐일레븐"), ("지에스(GS)25", "GS25 "), ("지에스25", "GS25 "),
                 ("씨유(CU)", "CU "), ("씨유", "CU "), ("CU", "CU "), (" 코리아", "")]:
        n = n.replace(a, b)
    return re.sub(r"\s+", " ", n).strip()


def load_license():
    """휴게음식점 인허가 정보 중 '편의점'만. 영업 중인 곳 / 폐업한 주소를 돌려준다."""
    if not LICENSE.exists():
        return {}, set()
    df = pd.read_csv(LICENSE, encoding="cp949", encoding_errors="replace", dtype=str, low_memory=False)
    df = df[df["업태구분명"] == "편의점"]
    t5179 = Transformer.from_crs(5179, 4326, always_xy=True)   # X좌표/Y좌표
    t2097 = Transformer.from_crs(2097, 4326, always_xy=True)   # 좌표정보(X)/(Y)
    open_by_key, closed = {}, set()
    for r in df.itertuples(index=False):
        key = addr_key(r.도로명주소)
        if not key:
            continue
        if r.영업상태명 != "영업/정상":
            closed.add(key)
            continue
        try:
            if isinstance(r.X좌표, str) and r.X좌표.strip():
                lng, lat = t5179.transform(float(r.X좌표), float(r.Y좌표))
            else:
                lng, lat = t2097.transform(float(getattr(r, "_19")), float(getattr(r, "_20")))
        except Exception:
            continue
        open_by_key.setdefault(key, []).append({"name": clean_name(r.사업장명), "addr": r.도로명주소.split(",")[0], "lng": lng, "lat": lat})
    return open_by_key, closed


def load_stores():
    cols = ["상호명", "지점명", "상권업종소분류명", "도로명주소", "경도", "위도"]
    # 2번째 줄은 영문 컬럼명이라 건너뛴다
    df = pd.read_csv(STORES, skiprows=[1], dtype=str, usecols=cols)
    global TOTAL_STORES
    TOTAL_STORES = len(df)   # 서울 전체 상가 수 (영수증의 '잠든 서울 %' 계산용)
    df = df[df["상권업종소분류명"].isin(CATEGORY)].dropna(subset=["경도", "위도"])
    lic_open, lic_closed = load_license()
    out, seen_keys = [], set()
    stats = {"renamed": 0, "dropped_closed": 0, "added_from_license": 0}
    for r in df.itertuples(index=False):
        name = r.상호명 + (" " + r.지점명 if isinstance(r.지점명, str) else "")
        cat = CATEGORY[r.상권업종소분류명]
        addr = r.도로명주소 if isinstance(r.도로명주소, str) else ""
        props = {"name": name, "cat": cat, "addr": addr}
        if cat == "convenience":
            key = addr_key(addr)
            seen_keys.add(key)
            if key in lic_open:
                props["verified"] = True                 # 인허가에서 '영업 중' 확인
                if len(lic_open[key]) == 1:              # 같은 주소에 1곳뿐이면 최신 이름으로
                    props["name"] = lic_open[key][0]["name"]; stats["renamed"] += 1
            elif key in lic_closed:
                stats["dropped_closed"] += 1             # 인허가에서 '폐업' → 지도에서 뺀다
                continue
            props["name"] = clean_name(props["name"])
            if not is_brand(props["name"]):
                props["cat"] = "shop"                    # 브랜드가 아닌 매점·소매점: 영업시간 확인 불가
        out.append(feature(r.경도, r.위도, props))
    # 상가정보에 없는 새 편의점은 인허가 정보에서 추가
    for key, items in lic_open.items():
        if key in seen_keys:
            continue
        for it in items:
            out.append(feature(it["lng"], it["lat"], {
                "name": it["name"], "cat": "convenience" if is_brand(it["name"]) else "shop",
                "addr": it["addr"], "verified": True}))
            stats["added_from_license"] += 1
    # 같은 주소 + 같은 이름이 두 번 들어간 경우 하나만 남김
    uniq, keys = [], set()
    for f in out:
        p = f["properties"]
        k = (addr_key(p["addr"]), p["name"].replace(" ", "")) if p["cat"] in ("convenience", "shop") else None
        if k and k in keys:
            stats["duplicates_removed"] = stats.get("duplicates_removed", 0) + 1
            continue
        if k:
            keys.add(k)
        uniq.append(f)
    print("편의점 보정:", stats)
    return uniq


def load_emergency():
    df = pd.read_csv(EMERGENCY, encoding="cp949")
    df = df[df["응급실운영여부"].astype(str) == "1"]
    out = []
    for r in df.itertuples(index=False):
        out.append(feature(r.병원경도, r.병원위도, {
            "name": r.기관명,
            "cat": "er",
            "addr": r.주소,
            "level": r.응급의료기관코드명,
            "tel": r.응급실전화,
        }))
    return out


def main():
    feats = load_stores() + load_emergency()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    META.write_text(json.dumps({"total_stores": TOTAL_STORES}), encoding="utf-8")
    counts = {}
    for f in feats:
        counts[f["properties"]["cat"]] = counts.get(f["properties"]["cat"], 0) + 1
    print(f"saved {len(feats)} places → {OUT}")
    print(counts)


if __name__ == "__main__":
    main()
