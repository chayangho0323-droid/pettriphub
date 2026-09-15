// pet-page.js — place/*.html 상세 페이지의 동작 담당 (찜하기, 링크 복사, 지도)
// 장소 정보는 각 페이지에 심어둔 window.PET에서 읽는다

const p = window.PET;

// ── 찜하기 (목록 페이지 app.js와 같은 저장소 키) ──
function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem("pet-favorites")) || [];
  } catch {
    return [];
  }
}

function toggleFavorite(id) {
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(id);
  localStorage.setItem("pet-favorites", JSON.stringify(favs));
  return idx < 0;
}

const favBtn = document.getElementById("fav-btn");
function paintFavBtn(faved) {
  favBtn.textContent = faved ? "❤️ 찜 해제" : "🤍 찜하기";
  favBtn.classList.toggle("faved", faved);
}
paintFavBtn(getFavorites().includes(p.id));
favBtn.addEventListener("click", () => paintFavBtn(toggleFavorite(p.id)));

// ── 링크 복사 ──
const shareBtn = document.getElementById("share-btn");
shareBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    shareBtn.textContent = "✅ 복사됨!";
  } catch {
    shareBtn.textContent = "⚠️ 복사 실패";
  }
  setTimeout(() => (shareBtn.textContent = "🔗 링크 복사"), 2000);
});

// ── 지도 (Leaflet + OpenStreetMap) ──
if (p.lat && p.lng && document.getElementById("map")) {
  const map = L.map("map").setView([Number(p.lat), Number(p.lng)], 15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.marker([Number(p.lat), Number(p.lng)]).addTo(map).bindPopup(p.name).openPopup();
}
