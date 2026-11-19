# 새벽 세 시, 서울

「잠 못 드는 밤의 해부」 — 1막 방 안(타이머·질문) → 2막 꺼진 도시(지도·장소별 이야기) → 3막 생존 영수증.

새벽 3시, 서울에서 실제로 열려 있는 곳을 보여주는 인터랙티브 지도.

## 폴더 구조

```
seoul3am/
├── index.html            화면 구조 (시작 → 상황 선택 → 지도 → 마지막 영수증)
├── style.css             디자인 (색, 폰트, 영수증 스타일)
├── config.js             카카오 JavaScript 키 (확대 시 실시간 장소 검색)
├── app.js                동작 (지도, 불 꺼지는 애니메이션, 내 위치, 길찾기)
├── data/places.geojson   지도에 찍히는 장소 16,870곳 (build_data.py가 만듦)
├── data/seoul_boundary.geojson  서울 경계 (서울 밖을 검게 가리는 데 사용)
├── data/seoul_fade.geojson      경계를 부드럽게 흐리는 겹
├── data/meta.json        서울 전체 상가 수 ('잠든 서울 %' 계산용)
├── assets/fonts/Galmuri9.ttf   모든 글자에 쓰는 글꼴
├── assets/receipt.jpg    버튼·카드의 영수증 텍스처
├── assets/paper.jpg      지도 위 종이 질감
├── scripts/build_data.py 원본 CSV → places.geojson 변환
└── raw/                  원본 CSV를 여기에 넣기 (용량이 커서 zip에는 없음)
```

## 실행 방법

`index.html`을 더블클릭하면 안 됩니다 (데이터를 못 읽고, 내 위치도 막힘).
터미널에서 이 폴더로 이동한 다음:

```
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 을 연다.

## 데이터 다시 만들기

1. `raw/stores.csv` : 소상공인시장진흥공단 상가(상권)정보 (서울)
2. `raw/emergency.csv` : 서울시 응급실 위치 정보 (서울 열린데이터광장)
3. `raw/rest.csv` : 서울시 휴게음식점 인허가 정보 (서울 열린데이터광장) — 편의점 이름·폐업 보정
4. 실행:

```
pip install pandas pyproj
python3 scripts/build_data.py
```

## 바꾸기 쉬운 곳

- 지도 스타일: `app.js` 맨 위 `MAP_STYLE`
- 지도 색 (땅·물·길·글자): `app.js`의 `NIGHT`
- 1막 문장: `app.js`의 `STORY_TEXT`
- 망점·노이즈 세기: `style.css`의 `--halftone`, `--grain`
- 카테고리 색, 설명 문구: `app.js`의 `CATS`
- 상황별로 보여줄 카테고리: `app.js`의 `SITUATIONS`
- 전체 색, 폰트: `style.css` 맨 위 `:root`
- 종이 질감 세기: `style.css`의 `--paper-strength` (0 ~ 1)
- 영수증 점선: `style.css`의 `--dots`
- 글꼴: Galmuri9 (assets/fonts, 모든 글자), Libre Barcode 39 (바코드)

## 출처

- 데이터: 소상공인시장진흥공단 상가(상권)정보, 서울시 휴게음식점 인허가 정보, 서울시 응급실 위치 정보, 서울시 공공심야약국 지정현황
- 서울 경계: southkorea/seoul-maps (통계청 2013)
- 지도: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors
- 도보 경로: OSRM (routing.openstreetmap.de, FOSSGIS)

## 카카오 실시간 장소

지도를 많이 확대하면(줌 14.5 이상, '아플 때') 화면 안의 편의점·약국을 카카오에서 실시간으로 받아 보여준다.
공공데이터는 같은 주소(대학 캠퍼스 등)의 가게를 한 점에 모아서 위치가 틀리기 때문.
카카오 정책상 결과는 저장하지 않는다. `config.js`의 키는 카카오디벨로퍼스에 등록한 도메인에서만 작동한다.
