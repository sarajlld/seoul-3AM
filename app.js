/* ═════════════════════════════════════════════
   새벽 세 시, 서울 — 「잠 못 드는 밤의 해부」
   1막: 방 안 (타이머 + 타이핑 + 선택)
   2막: 꺼진 도시 (지도 + 장소마다 바뀌는 짧은 이야기)
   3막: 생존 영수증 (장소를 고르면 인쇄됨)
   ═════════════════════════════════════════════ */

/* ───────── 설정 ───────── */
const MAP_STYLE = "https://tiles.openfreemap.org/styles/fiord";   // OpenFreeMap (무료, 키 없음)
const SEOUL = [126.978, 37.5665];
const ROUTE_API = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";

// 지도 색: 익스페리멘털 믹스드 미디어 (흑백 복사기 + 일렉트릭 블루)
const NIGHT = {
  base:     "#101114",   // 땅 (먹색)
  water:    "#1546B8",   // 한강 (일렉트릭 블루)
  green:    "#141519",   // 공원·산
  building: "#1B1C21",   // 건물
  road:     "#2E2F36",   // 작은 길
  roadMain: "#5A5B63",   // 큰 길 (복사기 회색)
  label:    "#C9C9CF",   // 글자
  edge:     "#000000",   // 서울 바깥
};

// 카테고리: 이름, 색, 새벽 3시 상태(true 열림 / false 닫힘 / null 확인 불가), 설명
const CATS = {
  pharmacy:    { label: "약국",              color: "#D9D9DE", open: false,
                 note: "이 약국의 영업시간: 데이터에 없음<br>서울 공공심야약국 40곳도<br>22:00~01:00 운영 → 03:00엔 닫힘" },
  convenience: { label: "편의점",            color: "#9c9a94", open: true,
                 note: "대형 편의점 브랜드 · 대부분 24시간<br>(일부 점포는 아닐 수 있음)<br>안전상비의약품 구매 가능" },
  er:          { label: "응급실",            color: "#7B9BFF", open: true,
                 note: "응급실 24시간 운영<br>(일반 외래 진료는 닫힘)" },
  shop:        { label: "기타 편의점·소매점", color: "#6E6E75", open: null,
                 note: "영업시간 정보 없음<br>(브랜드 편의점이 아닌 소매점·매점)" },
  pc:          { label: "PC방",              color: "#5C86FF", open: true, note: "대부분 24시간 (확인 필요)" },
  sauna:       { label: "찜질방/사우나",      color: "#B8C6FF", open: true, note: "일부 24시간 찜질방 (확인 필요)" },
  comic:       { label: "만화방",            color: "#E8E8EC", open: true, note: "일부 24시간 (확인 필요)" },
};

const SITUATIONS = {
  sick:    { label: "아플 때",        cats: ["pharmacy", "er", "convenience"] },
  hungry:  { label: "배고플 때",      cats: ["convenience", "shop"] },
  nowhere: { label: "갈 곳이 없을 때", cats: ["pc", "sauna", "comic"] },
};

const STORY_TEXT = "서울의 불은 모두 꺼졌습니다.\n그런데 작은 일 하나가 당신을 깨어 있게 합니다.\n\n오늘 밤, 왜 깨어 있나요?";

/* ───────── 상태 ───────── */
let places = [], visible = [], situation = null, closingTimer = null;
let myPos = null, myMarker = null, selected = null;
let seoulBoundary = null, seoulFade = null, meta = { total_stores: 0 };

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gu = (f) => (f.properties.addr || "").split(" ")[1] || "서울";

/* ───────── 화면 전환 ───────── */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-on", s.id === id));
  $("mapview").hidden = id !== "mapview";
  if (id === "mapview") { map.resize(); $("mapview").classList.remove("is-revealed"); requestAnimationFrame(() => $("mapview").classList.add("is-revealed")); }
}
// 지금은 '아플 때'만 켜 둠. 다시 켜려면 여기에 "hungry", "nowhere"를 추가하면 됨
const ENABLED = new Set(["sick"]);
document.querySelectorAll("[data-sit]").forEach((b) => {
  const on = ENABLED.has(b.dataset.sit);
  b.onclick = () => { if (on) pickSituation(b.dataset.sit); };   // 꺼진 버튼은 눌러도 아무 일 없음
});

/* ═════════ 1막: 방 안 ═════════ */
async function playStory() {
  // 02:58:00 → 03:00:00 (약 3초 동안 빠르게)
  for (let s = 0; s <= 120; s += 2) {
    const t = 2 * 3600 + 58 * 60 + s;
    const hh = String(Math.floor(t / 3600)).padStart(2, "0");
    const mm = String(Math.floor(t / 60) % 60).padStart(2, "0");
    const ss = String(t % 60).padStart(2, "0");
    $("timer").textContent = `${hh}:${mm}:${ss}`;
    await sleep(45);
  }
  $("timer").classList.add("is-done");
  await sleep(500);
  // 한 글자씩 타이핑
  const el = $("story-text");
  for (const ch of STORY_TEXT) {
    el.textContent += ch;
    await sleep(ch === "\n" ? 260 : 55);
  }
  await sleep(300);
  $("choices").hidden = false;
}
playStory();

/* ═════════ 지도 ═════════ */
const map = new maplibregl.Map({
  container: "map", style: MAP_STYLE, center: SEOUL, zoom: 11, minZoom: 10,
  maxBounds: [[126.70, 37.39], [127.26, 37.74]],
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

const ready = Promise.all([
  new Promise((r) => map.on("load", r)),
  fetch("data/places.geojson").then((r) => r.json()).then((g) => { places = g.features; places.forEach((f, i) => { f.id = i; }); }),
  fetch("data/seoul_boundary.geojson").then((r) => r.json()).then((g) => { seoulBoundary = g; }),
  fetch("data/seoul_fade.geojson").then((r) => r.json()).then((g) => { seoulFade = g; }),
  fetch("data/meta.json").then((r) => r.json()).then((m) => { meta = m; }),
]);

ready.then(() => {
  retintMap();
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  map.addSource("outside-seoul", { type: "geojson",
    data: { type: "Feature", geometry: { type: "Polygon", coordinates: [world, seoulBoundary.geometry.coordinates[0]] } } });
  map.addLayer({ id: "outside-seoul", type: "fill", source: "outside-seoul",
    paint: { "fill-color": NIGHT.edge, "fill-opacity": 1 } });
  map.addSource("seoul-fade", { type: "geojson", data: seoulFade });
  map.addLayer({ id: "seoul-fade", type: "fill", source: "seoul-fade",
    paint: { "fill-color": NIGHT.edge, "fill-opacity": 0.14, "fill-antialias": false } });

  map.addSource("places", { type: "geojson", data: fc([]) });
  // 점 크기: 응급실 크게 / 편의점은 '아플 때'만 약국과 같은 크기, 나머지 상황에선 작게
  const small = (z) => ["case",
    ["==", ["get", "cat"], "er"], z.er,
    ["all", ["==", ["get", "cat"], "convenience"], ["!=", ["get", "sit"], "sick"]], z.cvs,
    z.base];
  const pointPaint = {
      "circle-radius": ["interpolate", ["linear"], ["zoom"],
        11, small({ er: 5, cvs: 1.8, base: 2.5 }),
        16, small({ er: 11, cvs: 5, base: 7 })],
      "circle-color": ["case",
        ["==", ["get", "state"], "closed"], "#34353C",
        ["==", ["get", "state"], "unknown"], "rgba(0,0,0,0)",
        ["match", ["get", "cat"], ...Object.entries(CATS).flatMap(([k, v]) => [k, v.color]), "#fff"]],
      "circle-stroke-width": ["case", ["==", ["get", "state"], "unknown"], 1, ["==", ["get", "cat"], "er"], 1.5, 0],
      "circle-stroke-color": ["case", ["==", ["get", "state"], "unknown"], "#77777f", "#ffffff"],
      "circle-opacity": ["case", ["==", ["get", "state"], "closed"], 0.75,
                                 ["==", ["get", "cat"], "convenience"], 0.55, 0.95],
  };
  map.addLayer({ id: "places", type: "circle", source: "places", paint: pointPaint });
  // 확대했을 때 카카오에서 실시간으로 받아온 편의점·약국 (저장하지 않고 화면에만 표시)
  map.addSource("live", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "live", type: "circle", source: "live", paint: pointPaint });
  map.on("click", "live", (e) => openCard(livePlaces[e.features[0].properties.idx]));
  map.on("mouseenter", "live", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "live", () => map.getCanvas().style.cursor = "");
  map.on("moveend", () => { clearTimeout(refreshLive.t); refreshLive.t = setTimeout(refreshLive, 350); });
  map.addSource("route", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "route", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#5C86FF", "line-width": 5 } }, "places");

  map.on("click", "places", (e) => openCard(places[e.features[0].properties.idx]));
  map.on("mouseenter", "places", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "places", () => map.getCanvas().style.cursor = "");
});

/* 지도 스타일의 색을 모두 믹스드 미디어 팔레트로 */
function retintMap() {
  for (const layer of map.getStyle().layers) {
    const id = layer.id;
    try {
      if (layer.type === "background") map.setPaintProperty(id, "background-color", NIGHT.base);
      else if (layer.type === "fill") {
        const c = /water/.test(id) ? NIGHT.water : /building/.test(id) ? NIGHT.building
          : /park|wood|forest|grass|landcover|green/.test(id) ? NIGHT.green : NIGHT.base;
        map.setPaintProperty(id, "fill-color", c);
        if (/building/.test(id)) map.setPaintProperty(id, "fill-outline-color", NIGHT.road);
      } else if (layer.type === "fill-extrusion") map.setPaintProperty(id, "fill-extrusion-color", NIGHT.building);
      else if (layer.type === "line") {
        const c = /water|river|stream/.test(id) ? NIGHT.water
          : /motorway|trunk|primary|major/.test(id) ? NIGHT.roadMain : NIGHT.road;
        map.setPaintProperty(id, "line-color", c);
      } else if (layer.type === "symbol" && layer.layout && layer.layout["text-field"]) {
        map.setPaintProperty(id, "text-color", NIGHT.label);
        map.setPaintProperty(id, "text-halo-color", NIGHT.base);
      }
    } catch (e) { /* 해당 속성이 없는 레이어 */ }
  }
}

function fc(features) { return { type: "FeatureCollection", features }; }
function stateOf(f) {
  const open = CATS[f.properties.cat].open;
  if (open === null) return "unknown";
  return f._closed ? "closed" : "open";
}
function render() {
  map.getSource("places").setData(fc(visible.map((f) => ({
    type: "Feature", geometry: f.geometry,
    properties: { cat: f.properties.cat, state: stateOf(f), idx: f.id, sit: situation },
  }))));
  renderCounter();
}

/* ═════════ 2막: 꺼진 도시 ═════════ */
async function pickSituation(key) {
  showScreen("mapview");
  await ready;
  situation = key;
  closeCard(); clearRoute();
  document.querySelectorAll(".tabs [data-sit]").forEach((b) => b.classList.toggle("is-selected", b.dataset.sit === key));

  setLive(false);
  visible = places.filter((f) => SITUATIONS[key].cats.includes(f.properties.cat));
  visible.forEach((f) => { f._closed = false; });
  render();
  narrate("낮에는 이 모든 곳에 불이 켜져 있었습니다…");

  clearInterval(closingTimer);
  const closing = visible.filter((f) => CATS[f.properties.cat].open === false).sort(() => Math.random() - 0.5);
  const step = Math.ceil(closing.length / 25);
  let i = 0;
  setTimeout(() => {
    closingTimer = setInterval(() => {
      for (let k = 0; k < step && i < closing.length; k++, i++) closing[i]._closed = true;
      render();
      if (i >= closing.length) {
        clearInterval(closingTimer);
        const open = visible.filter((f) => stateOf(f) === "open").length;
        narrate(`03:00. 남은 불빛 ${open.toLocaleString()}개. 점을 눌러 당신의 밤을 따라가 보세요.`);
        refreshLive();
      }
    }, 100);
  }, 1200);
}

function renderCounter() {
  const s = SITUATIONS[situation];
  const lines = s.cats.map((c) => {
    const all = visible.filter((f) => f.properties.cat === c);
    const open = all.filter((f) => stateOf(f) === "open").length;
    const right = CATS[c].open === null ? "확인불가" : `${open.toLocaleString()}곳`;
    return `<div class="r-row"><span><span class="dot" style="background:${CATS[c].color}"></span>${CATS[c].label} ${all.length.toLocaleString()}</span><span class="lead"></span><span>${right}</span></div>`;
  });
  $("counter").innerHTML = `<div class="r-sub">새벽 03:00 · ${s.label}</div><div class="r-rule"></div>` + lines.join("");
}

/* 장소마다 바뀌는 짧은 이야기 (모두 데이터로 계산) */
function narrate(text) {
  const n = $("narration");
  n.classList.remove("is-new"); void n.offsetWidth; n.classList.add("is-new");
  n.textContent = text;
}
function storyFor(f) {
  const g = gu(f);
  const inGu = visible.filter((x) => gu(x) === g);
  // 같은 건물(15m 이내)의 다른 가게는 '다음 불빛'으로 치지 않음
  const far = (x) => distance(f.geometry.coordinates, x.geometry.coordinates) > 15;
  const openInGu = inGu.filter((x) => stateOf(x) === "open" && x !== f && far(x));
  let nearest = Infinity;
  for (const x of openInGu.length ? openInGu : visible.filter((x) => stateOf(x) === "open" && x !== f && far(x))) {
    nearest = Math.min(nearest, distance(f.geometry.coordinates, x.geometry.coordinates));
  }
  const pharm = inGu.filter((x) => x.properties.cat === "pharmacy").length;
  const parts = [`${g}.`];
  if (situation === "sick" && pharm) parts.push(`이 동네 약국 ${pharm}곳 중 지금 열린 곳은 0곳.`);
  else parts.push(`이 동네에서 지금 불이 켜진 곳 ${inGu.filter((x) => stateOf(x) === "open").length}곳.`);
  if (isFinite(nearest)) parts.push(`여기서 다음 불빛까지 ${fmt(nearest)}.`);
  if (myPos) parts.push(`당신으로부터 ${fmt(distance(myPos, f.geometry.coordinates))}.`);
  parts.push("대부분의 버스는 이미 끊겼습니다 (심야 N버스 제외).");
  return parts.join(" ");
}

/* ───────── 장소 카드 ───────── */
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function openCard(f) {
  selected = f;
  const p = f.properties, c = CATS[p.cat], st = stateOf(f);
  const [lng, lat] = f.geometry.coordinates;
  const status = { open: "지금 열려 있음 ........ OPEN", closed: "지금 닫혀 있음 ...... CLOSED", unknown: "영업 여부 ........ 확인 불가" }[st];
  const enc = encodeURIComponent;
  const rows = [["상호", esc(p.name)], ["분류", c.label], ["주소", esc(p.addr)]];
  if (p.cat === "er") rows.push(["등급", esc(p.level)], ["전화", esc(p.tel)]);
  if (p.kakao && p.tel) rows.push(["전화", esc(p.tel)]);
  $("card").innerHTML = `
    <button class="close" onclick="closeCard()" aria-label="닫기">✕</button>
    <div class="r-head">새벽 3시 영수증</div>
    <div class="r-sub">NO.${String(f.id ?? 0).padStart(5, "0")} &nbsp; 03:00:00</div>
    <div class="r-rule"></div>
    ${rows.map(([k, v]) => `<div class="r-row"><span>${k}</span><span>${v}</span></div>`).join("")}
    <div class="r-rule"></div>
    <div class="r-status r-${st}">${status}</div>
    <div class="r-note">${c.note}</div>
    ${p.kakao ? `<div class="r-note">● 카카오맵 실시간 장소 정보</div>`
      : ["convenience", "shop"].includes(p.cat) ? `<div class="r-note">${p.verified ? "✓ 서울시 인허가 정보: 영업 중" : "※ 상가정보 기준 (인허가로 확인 안 됨)"}</div>` : ""}
    <div class="r-rule"></div>
    ${st === "open" ? `<button class="action action--main" onclick="chooseHere()">여기로 갈래요 → 영수증 받기</button>` : ""}
    <button class="action" onclick="routeTo()">여기까지 걸어가는 경로 보기</button>
    <a class="action" target="_blank" rel="noopener" href="${p.url || `https://map.kakao.com/link/map/${enc(p.name)},${lat},${lng}`}">카카오지도에서 보기 ↗</a>
    <a class="action" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${enc(p.name)}">네이버지도에서 보기 ↗</a>
    <div class="r-rule r-rule--double"></div>
    <div class="barcode">*${String(f.id ?? 0).padStart(6, "0")}*</div>`;
  $("card").hidden = false;
  fitCard();
  narrate(storyFor(f));
}
function closeCard() { $("card").hidden = true; }
function fitCard() {
  const card = $("card"), counterTop = $("counter").getBoundingClientRect().top;
  card.style.maxHeight = `${counterTop - card.getBoundingClientRect().top - 14}px`;
}
window.addEventListener("resize", () => { if (!$("card").hidden) fitCard(); });

/* ───────── 알림 ───────── */
function toast(text, ms = 3000) {
  $("toast").textContent = text; $("toast").hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => $("toast").hidden = true, ms);
}

/* ───────── 내 위치 · 가까운 곳 · 경로 ───────── */
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { toast("이 브라우저에서는 위치를 쓸 수 없어요"); return reject(); }
    toast("위치를 찾는 중…", 10000);
    navigator.geolocation.getCurrentPosition((pos) => {
      myPos = [pos.coords.longitude, pos.coords.latitude];
      if (!myMarker) { const el = document.createElement("div"); el.className = "me"; myMarker = new maplibregl.Marker({ element: el }); }
      myMarker.setLngLat(myPos).addTo(map);
      map.flyTo({ center: myPos, zoom: 15.5 });
      toast("현재 위치"); resolve(myPos);
    }, (err) => {
      toast(err.code === 1 ? "위치 권한이 거부되었어요" : "위치를 가져올 수 없어요", 4000); reject(err);
    }, { enableHighAccuracy: true, timeout: 10000 });
  });
}
$("btn-locate").onclick = () => locate().catch(() => {});

function distance(a, b) {
  const R = 6371e3, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmt = (m) => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

$("btn-nearest").onclick = async () => {
  if (!myPos) { try { await locate(); } catch { return; } }
  let best = null, bd = Infinity;
  for (const f of visible) { if (stateOf(f) !== "open") continue; const d = distance(myPos, f.geometry.coordinates); if (d < bd) { bd = d; best = f; } }
  if (!best) return toast("지금 열린 곳이 없어요");
  map.flyTo({ center: best.geometry.coordinates, zoom: 16.5 });
  openCard(best);
  toast(`가장 가까운 열린 곳: 약 ${fmt(bd)}`, 4000);
};

function clearRoute() { if (map.getSource("route")) map.getSource("route").setData(fc([])); }
async function routeTo() {
  if (!selected) return;
  if (!myPos) { try { await locate(); } catch { return; } }
  toast("경로를 찾는 중…", 10000);
  const to = selected.geometry.coordinates;
  try {
    const j = await (await fetch(`${ROUTE_API}${myPos[0]},${myPos[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`)).json();
    const r = j.routes[0];
    map.getSource("route").setData(fc([{ type: "Feature", geometry: r.geometry, properties: {} }]));
    const b = new maplibregl.LngLatBounds(); r.geometry.coordinates.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: 100 });
    toast(`도보 약 ${Math.max(1, Math.round(r.duration / 60))}분 · ${fmt(r.distance)}`, 6000);
  } catch { toast("경로를 불러오지 못했어요. 카카오지도를 이용해 주세요", 5000); }
}

/* ═════════ 3막: 생존 영수증 ═════════ */
function chooseHere() { printReceipt(selected); }
$("btn-end").onclick = () => printReceipt(null);

function printReceipt(place) {
  // '잠든 서울' = 서울 전체 상가 중, 새벽 3시에 열려 있다고 분류한 곳을 뺀 비율 (추정)
  const awake = places.filter((f) => CATS[f.properties.cat].open === true).length;
  const asleep = meta.total_stores ? ((1 - awake / meta.total_stores) * 100).toFixed(1) : "—";
  const row = (k, v) => `<div class="r-row"><span>${k}</span><span class="lead"></span><span>${v}</span></div>`;
  const n = (c) => places.filter((f) => f.properties.cat === c).length.toLocaleString();
  const why = situation ? SITUATIONS[situation].label : "—";
  const placeRows = place
    ? row("동네", esc(gu(place))) + row("도착한 곳", esc(place.properties.name)) + row("분류", CATS[place.properties.cat].label)
      + (myPos ? row("나와의 거리", fmt(distance(myPos, place.geometry.coordinates))) : "")
    : row("도착한 곳", "찾지 못함");
  $("final").innerHTML = `
    <div class="r-head">생존 영수증</div>
    <div class="r-sub">SEOUL · 03:00:00 · NO.${String(Date.now()).slice(-6)}</div>
    <div class="r-rule r-rule--double"></div>
    ${row("깨어 있던 이유", why)}
    ${placeRows}
    <div class="r-rule"></div>
    ${row("잠든 서울*", asleep + "%")}
    ${row("공공심야약국", "0 / 40곳")}
    ${row("응급실", n("er") + "곳")}
    ${row("편의점", n("convenience") + "곳")}
    <div class="r-rule"></div>
    <div class="r-small">* 서울 상가 ${meta.total_stores.toLocaleString()}곳 중 새벽 3시에 열려 있다고 분류한 ${awake.toLocaleString()}곳을 뺀 비율 (추정)</div>
    <div class="r-rule r-rule--double"></div>
    <div class="r-closing">이 종이는 새벽 03:00,<br>서울에서 당신이 깨어 있었다는<br>증명서입니다.</div>
    <div class="barcode">*SEOUL0300*</div>`;
  showScreen("ending");
  const w = document.querySelector(".print-wrap");
  w.classList.remove("is-printing"); void w.offsetWidth; w.classList.add("is-printing");
}


/* ═════════ 카카오 실시간 장소 (확대했을 때) ═════════
   공공데이터는 같은 주소(예: 대학 캠퍼스)의 가게를 한 점에 모아 버려서 위치가 틀린다.
   그래서 지도를 확대하면, 화면 안의 편의점·약국만 카카오에서 그 자리에서 받아와 보여준다.
   카카오 정책상 결과는 저장하지 않고 메모리에서만 쓴다. */
const LIVE_ZOOM = 14.5;
let kakaoPlaces = null, livePlaces = [], liveReq = 0;

function loadKakao() {
  if (kakaoPlaces) return kakaoPlaces;
  kakaoPlaces = new Promise((resolve, reject) => {
    if (!window.KAKAO_JS_KEY) return reject(new Error("no key"));
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${window.KAKAO_JS_KEY}&libraries=services&autoload=false`;
    s.onload = () => kakao.maps.load(() => resolve(new kakao.maps.services.Places()));
    s.onerror = reject;
    document.head.appendChild(s);
  });
  kakaoPlaces.catch(() => { kakaoPlaces = null; });
  return kakaoPlaces;
}

// 한 번에 최대 45곳까지만 주므로, 넘치면 화면을 4칸으로 나눠 다시 찾는다
function searchRect(ps, code, w, s, e, n, depth = 0) {
  return new Promise((resolve) => {
    const found = [];
    const bounds = new kakao.maps.LatLngBounds(new kakao.maps.LatLng(s, w), new kakao.maps.LatLng(n, e));
    ps.categorySearch(code, (data, status, page) => {
      if (status !== kakao.maps.services.Status.OK) return resolve(found);
      if (page.current === 1 && page.totalCount > 45 && depth < 2) {
        const mx = (w + e) / 2, my = (s + n) / 2;
        Promise.all([[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]
          .map((r) => searchRect(ps, code, ...r, depth + 1))).then((rs) => resolve(rs.flat()));
        return;
      }
      found.push(...data);
      if (page.hasNextPage) page.nextPage(); else resolve(found);
    }, { bounds, size: 15 });
  });
}

function setLive(on) {
  $("hud-live").hidden = !on;
  if (!map.getLayer("places")) return;
  // 실시간 모드에선 공공데이터의 편의점·약국 점을 숨기고 카카오 점을 보여줌 (응급실은 그대로)
  map.setFilter("places", on ? ["!", ["in", ["get", "cat"], ["literal", ["convenience", "shop", "pharmacy"]]]] : null);
  if (!on && map.getSource("live")) { livePlaces = []; map.getSource("live").setData(fc([])); }
}

async function refreshLive() {
  if (!map.getLayer("places")) return;
  const req = ++liveReq;
  if (situation !== "sick" || map.getZoom() < LIVE_ZOOM || closingTimer && visible.some((f) => CATS[f.properties.cat].open === false && !f._closed)) {
    setLive(false); return;
  }
  let ps;
  try { ps = await loadKakao(); } catch { setLive(false); return; }
  const b = map.getBounds();
  const box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const [cvs, ph] = await Promise.all([searchRect(ps, "CS2", ...box), searchRect(ps, "PM9", ...box)]);
  if (req !== liveReq) return;          // 그 사이 지도를 또 움직였으면 버림
  const seen = new Set();
  livePlaces = [];
  for (const [d, kind] of [...cvs.map((d) => [d, "cvs"]), ...ph.map((d) => [d, "ph"])]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const name = d.place_name;
    const cat = kind === "ph" ? "pharmacy" : (is24Brand(name) ? "convenience" : "shop");
    livePlaces.push({
      id: Number(d.id) % 100000, _closed: cat === "pharmacy",
      geometry: { type: "Point", coordinates: [Number(d.x), Number(d.y)] },
      properties: { name, cat, addr: d.road_address_name || d.address_name, tel: d.phone, url: d.place_url, kakao: true },
    });
  }
  map.getSource("live").setData(fc(livePlaces.map((f, i) => ({
    type: "Feature", geometry: f.geometry,
    properties: { cat: f.properties.cat, state: stateOf(f), idx: i, sit: situation },
  }))));
  setLive(true);
}

function is24Brand(name) {
  const n = name.toUpperCase().replace(/\s/g, "");
  return ["CU", "GS25", "세븐일레븐", "이마트24", "미니스톱", "7-ELEVEN"].some((b) => n.includes(b));
}
