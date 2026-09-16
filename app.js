// app.js — pets-list.json을 읽어서 반려동물 동반 장소 카드를 그리는 코드 (CampingHub app.js 구조 재활용)

const listEl = document.getElementById("pet-list");
const searchEl = document.getElementById("search-input");
const regionEl = document.getElementById("region-filter");
const catEl = document.getElementById("cat-filter");
const onlyOfficialEl = document.getElementById("only-official");
const onlyFavEl = document.getElementById("only-fav");
const countEl = document.getElementById("result-count");
const nearBtn = document.getElementById("near-me");

let allPets = [];
let nearPos = null; // "내 주변" 켜면 {lat, lng} (브라우저에만 있고 어디에도 안 보냄)

// 카테고리 아이콘 (build-pages.js와 같은 표. 수정 시 양쪽 다!)
const CAT_ICON = { 카페: "☕", 식당: "🍽️", 베이커리: "🥐", 관광지: "🏞️", 숙박: "🏨", 레포츠: "🎾", 문화시설: "🎨" };
const CAT_SLUG = { 카페: "cafe", 식당: "restaurant", 베이커리: "bakery", 관광지: "spot", 숙박: "stay", 레포츠: "leisure", 문화시설: "culture" };
const REGION_SLUGS = {
  서울: "seoul", 부산: "busan", 대구: "daegu", 인천: "incheon", 광주: "gwangju",
  대전: "daejeon", 울산: "ulsan", 세종: "sejong", 경기: "gyeonggi", 강원: "gangwon",
  충북: "chungbuk", 충남: "chungnam", 전북: "jeonbuk", 전남: "jeonnam",
  경북: "gyeongbuk", 경남: "gyeongnam", 제주: "jeju",
};

// ── 찜하기 ──
function getFavorites() {
  try { return JSON.parse(localStorage.getItem("pet-favorites")) || []; } catch { return []; }
}
function toggleFavorite(id) {
  const favs = getFavorites();
  const i = favs.indexOf(id);
  if (i >= 0) favs.splice(i, 1); else favs.push(id);
  localStorage.setItem("pet-favorites", JSON.stringify(favs));
}

// 사진 없는 곳(식약처 등록부엔 사진이 없음)을 위한 카테고리 색상 타일 (build-pages.js와 같은 모양)
function placeholder(cat) {
  return `<div class="no-image ph-${CAT_SLUG[cat] || "etc"}"><span class="ph-icon">${CAT_ICON[cat] || "📍"}</span><span class="ph-label">${cat}</span></div>`;
}

// 사진 있는 곳을 전부 앞으로, 사진 없는 곳(색상 타일)은 뒤로 (각 그룹 안에서는 셔플 순서 유지)
function mixPhotos(list) {
  return [...list.filter((p) => p.image), ...list.filter((p) => !p.image)];
}

// ── 카드 그리기 ──
function render() {
  const keyword = searchEl.value.trim().toLowerCase();
  const region = regionEl.value;
  const cat = catEl.value;
  const favorites = getFavorites();

  let shown = allPets.filter((p) => {
    const matchKeyword = !keyword || p.name.toLowerCase().includes(keyword) || (p.sigungu || "").includes(keyword);
    const matchRegion = !region || p.sido === region;
    const matchCat = !cat || p.category === cat;
    const matchOfficial = !onlyOfficialEl.checked || p.official;
    const matchFav = !onlyFavEl.checked || favorites.includes(p.id);
    return matchKeyword && matchRegion && matchCat && matchOfficial && matchFav;
  });

  if (nearPos) {
    // 내 주변: 현재 위치에서 가까운 순 (하버사인)
    const rad = (deg) => (deg * Math.PI) / 180;
    shown.forEach((p) => {
      if (!p.lat || !p.lng) { p._dist = Infinity; return; }
      const dLat = rad(p.lat - nearPos.lat), dLng = rad(p.lng - nearPos.lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(nearPos.lat)) * Math.cos(rad(p.lat)) * Math.sin(dLng / 2) ** 2;
      p._dist = 6371 * 2 * Math.asin(Math.sqrt(h));
    });
    shown.sort((a, b) => a._dist - b._dist);
    shown = mixPhotos(shown); // 가까운 순 안에서도 사진 있는 곳 먼저
  } else {
    // 매일 셔플 (같은 날엔 같은 순서) — 4천여 곳이 공평하게 노출
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const daySeed = `${kst.getUTCFullYear()}${kst.getUTCMonth() + 1}${kst.getUTCDate()}`;
    const rank = (id) => { let h = 5381; const s = daySeed + id; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
    shown.sort((a, b) => rank(a.id) - rank(b.id));
    shown = mixPhotos(shown);
  }

  countEl.textContent = `${shown.length}곳`;

  if (shown.length === 0) {
    listEl.innerHTML = `<div class="empty-result"><p class="empty-title">🔍 조건에 맞는 장소가 없습니다</p><p>필터를 줄이거나 다른 지역을 선택해 보세요.</p></div>`;
    return;
  }

  listEl.innerHTML = shown.map((p) => {
    const faved = favorites.includes(p.id);
    const icon = CAT_ICON[p.category] || "📍";
    const img = p.image ? `<img src="${p.image}" alt="${p.name}" loading="lazy" />` : placeholder(p.category);
    const badges = [
      p.official ? `<span class="badge ongoing">✅ 식약처 등록</span>` : "",
      `<span class="badge upcoming">${icon} ${p.category}</span>`,
      p.petSize ? `<span class="badge long">🐕 ${p.petSize}</span>` : "",
    ].join(" ");
    const dist = nearPos && isFinite(p._dist) ? ` · 🚗 ${p._dist < 10 ? p._dist.toFixed(1) : Math.round(p._dist)}km` : "";
    return `
      <a class="card-link" href="place/${p.id}.html">
        <article class="card">
          <button class="fav-heart${faved ? " faved" : ""}" data-id="${p.id}" aria-label="찜하기">${faved ? "❤️" : "🤍"}</button>
          ${img}
          <div class="card-body">
            ${badges}
            <h2>${p.name}</h2>
            <p class="period">📍 ${p.sido} ${p.sigungu || ""}${dist}</p>
            <button class="review-link" data-query="${p.sigungu || p.sido} ${p.name}"
              onclick="event.preventDefault();window.open('https://map.naver.com/p/search/'+encodeURIComponent(this.dataset.query)+'?placePath=%2Freview','_blank','noopener');">📝 네이버 후기 보기</button>
          </div>
        </article>
      </a>`;
  }).join("");
}

// ── 필터 옵션·칩 채우기 ──
function fillOptions() {
  const regions = [...new Set(allPets.map((p) => p.sido))].filter((r) => REGION_SLUGS[r]).sort((a, b) => a.localeCompare(b, "ko"));
  for (const r of regions) {
    const opt = document.createElement("option");
    opt.value = r; opt.textContent = r;
    regionEl.appendChild(opt);
  }
  const nav = document.getElementById("quick-links");
  const addChip = (href, label, cls = "chip", tip = "") => {
    const a = document.createElement("a");
    a.className = cls; a.href = href; a.textContent = label;
    if (tip) a.dataset.tip = tip;
    nav.appendChild(a);
  };
  const counts = {};
  for (const p of allPets) counts[p.category] = (counts[p.category] || 0) + 1;
  for (const [cat, slug] of Object.entries(CAT_SLUG)) {
    if (counts[cat]) addChip(`cat-${slug}.html`, `${CAT_ICON[cat]} ${cat} ${counts[cat]}`, cat === "카페" ? "chip chip-hot" : "chip");
  }
  for (const r of regions) addChip(`region-${REGION_SLUGS[r]}.html`, r);
}

// ── 시작 ──
async function init() {
  try {
    const res = await fetch("pets-list.json");
    if (!res.ok) throw new Error(`pets-list.json 로드 실패 (${res.status})`);
    allPets = await res.json();
    fillOptions();
    render();
  } catch (err) {
    listEl.innerHTML = `<p style="text-align:center; grid-column: 1 / -1;">⚠️ 데이터를 불러오지 못했습니다: ${err.message}</p>`;
  }
}

searchEl.addEventListener("input", render);
regionEl.addEventListener("change", render);
catEl.addEventListener("change", render);
onlyOfficialEl.addEventListener("change", render);
onlyFavEl.addEventListener("change", render);

listEl.addEventListener("click", (e) => {
  const heart = e.target.closest(".fav-heart");
  if (!heart) return;
  e.preventDefault();
  toggleFavorite(heart.dataset.id);
  render();
});

// ── 내 주변 가까운 순 (CampingHub와 같은 방식) ──
function enableNear(silent) {
  if (!navigator.geolocation) { if (!silent) alert("이 브라우저는 위치 기능을 지원하지 않아요."); return; }
  nearBtn.textContent = "📍 위치 확인 중...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      nearPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      nearBtn.classList.add("on");
      nearBtn.textContent = "📍 내 주변 순 (누르면 끔)";
      render();
      if (!silent) window.scrollTo({ top: 0 });
    },
    () => {
      nearBtn.textContent = "📍 내 주변 가까운 순";
      if (!silent) alert("위치 정보를 가져오지 못했어요.\n주소창 근처의 위치 권한을 허용으로 바꾸고 다시 눌러주세요.");
    },
    { maximumAge: 600000, timeout: 8000 }
  );
}
nearBtn.addEventListener("click", () => {
  if (nearPos) {
    nearPos = null;
    nearBtn.classList.remove("on");
    nearBtn.textContent = "📍 내 주변 가까운 순";
    try { localStorage.setItem("near-off", "1"); } catch (e) {}
    render();
    return;
  }
  try { localStorage.removeItem("near-off"); } catch (e) {}
  enableNear(false);
});

init();
if (localStorage.getItem("near-off") !== "1") enableNear(true);
