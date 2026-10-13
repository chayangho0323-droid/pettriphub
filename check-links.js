// check-links.js — 반려동물 동반 장소의 홈페이지(homepage)가 (캠핑허브 check-links.js와 같은 코드) 실제로 열리는지 검사해 link-status.json에 기록한다.
//
// 왜: 고캠핑 데이터의 주소가 바뀌거나 사이트가 닫혀도 공공데이터는 그대로라서(2026-10-13 웅포관광지 캠핑장 camping.iksan.go.kr 502 발견)
//     방문자가 "예약 바로가기"를 눌렀다가 오류 페이지를 만난다. build-pages.js가 이 결과를 읽어 죽은 링크는 버튼에서 빼고
//     "네이버에서 예약처 찾기"로 대체한다.
//
// 판정:
//   ok      2xx (리다이렉트 따라간 최종 응답 기준)
//   dead    404·410·5xx, DNS 실패, 연결 거부, 15초 타임아웃  → 버튼에서 제외
//   unknown 401·403·429·999 등 "봇 차단"일 수 있는 응답       → 링크 유지 (사람 브라우저에선 열릴 수 있음)
// 같은 URL은 7일(RECHECK_DAYS) 동안 다시 검사하지 않는다. dead로 판정된 URL은 3일 뒤 재검사해 일시 장애를 걸러낸다.
// 실행: node check-links.js  (워크플로에서 매일, 처음엔 전체·이후엔 기한 지난 것만)

const fs = require("fs");

const FILE = "link-status.json";
const RECHECK_DAYS = 7;
const DEAD_RECHECK_DAYS = 3;
const CONCURRENCY = 12;
const TIMEOUT_MS = 15000;
const MAX_PER_RUN = Number(process.env.LINK_BUDGET || 2500);

const now = Date.now();
const today = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function probe(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; PetTripHubLinkCheck/1.0; +https://pettriphub.kr)" } });
    } catch (e) {
      // https 실패 시 http로 한 번 더 (인증서 만료 사이트)
      if (/^https:/.test(url)) res = await fetch(url.replace(/^https:/, "http:"), { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; PetTripHubLinkCheck/1.0)" } });
      else throw e;
    }
    try { await res.body?.cancel(); } catch {}
    const s = res.status;
    if (s >= 200 && s < 300) return { state: "ok", status: s, final: res.url !== url ? res.url : "" };
    if (s === 404 || s === 410 || s >= 500) return { state: "dead", status: s };
    return { state: "unknown", status: s };
  } catch (e) {
    const msg = String(e && (e.code || e.message) || e);
    return { state: /abort/i.test(msg) ? "dead" : "dead", status: 0, error: msg.slice(0, 80) };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const camps = JSON.parse(fs.readFileSync("pets.json", "utf-8"));
  let status = {};
  try { status = JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch {}

  const urls = new Set();
  for (const c of camps) for (const u of [c.homepage]) if (u && /^https?:\/\//i.test(u)) urls.add(u.trim());
  const due = [...urls].filter((u) => {
    const r = status[u];
    if (!r) return true;
    const age = (now - new Date(r.checkedAt).getTime()) / 86400000;
    return age >= (r.state === "dead" ? DEAD_RECHECK_DAYS : RECHECK_DAYS);
  }).slice(0, MAX_PER_RUN);
  console.log(`🔗 링크 검사: 전체 ${urls.size}개 중 오늘 검사 ${due.length}개 (동시 ${CONCURRENCY})`);

  let i = 0, done = 0;
  const counts = { ok: 0, dead: 0, unknown: 0 };
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < due.length) {
      const u = due[i++];
      const r = await probe(u);
      const prev = status[u];
      // 이전에 ok였던 게 한 번 dead로 나오면 바로 믿지 않고 "의심"으로 두고, 다음 검사(3일 뒤)에도 dead면 확정
      if (r.state === "dead" && prev && prev.state === "ok" && !prev.suspect) {
        status[u] = { ...prev, suspect: true, checkedAt: new Date(now).toISOString(), lastError: r.error || r.status };
        counts.ok++;
      } else {
        status[u] = { state: r.state, status: r.status, checkedAt: new Date(now).toISOString(), ...(r.final ? { final: r.final } : {}), ...(r.error ? { error: r.error } : {}) };
        counts[r.state]++;
      }
      done++;
      if (done % 200 === 0) console.log(`   ${done}/${due.length}`);
    }
  }));
  // 더 이상 데이터에 없는 URL은 정리
  for (const u of Object.keys(status)) if (!urls.has(u)) delete status[u];
  fs.writeFileSync(FILE, JSON.stringify(status, null, 1), "utf-8");
  const all = Object.values(status);
  console.log(`✅ ${FILE} 저장 — 이번 검사 ok ${counts.ok} · dead ${counts.dead} · unknown ${counts.unknown} | 전체 dead ${all.filter((r) => r.state === "dead").length} / ${all.length} (${today})`);
}

main().catch((err) => { console.error("❌ 링크 검사 실패 (기존 결과 유지):", err.message); process.exit(0); });
