// track-clicks.js — 방문자가 어떤 버튼을 누르는지 GA에 기록하는 공통 스크립트
// (모든 페이지에 들어감. 버튼마다 코드를 고칠 필요 없이 클릭을 한 곳에서 감지)
//
// GA 보고서에서 확인: 보고서 → 참여도 → 이벤트
//   click_coupang   쿠팡 파트너스 (축제 준비물)
//   click_hotel     숙소 보기 (아고다 제휴 전환 판단용)
//   click_map       길찾기·지도
//   click_homepage  공식 홈페이지
//   click_report    제보하기
//   click_calendar  캘린더 추가
//   click_nearby    주변 관광지·맛집
//   click_favorite  찜하기

(function () {
  // GA가 아직 안 실려 있으면 아무것도 안 함 (에러 방지)
  function send(name, params) {
    if (typeof gtag === "function") gtag("event", name, params);
  }

  // 클릭된 요소를 보고 어떤 종류인지 판별한다
  function classify(el) {
    if (el.closest(".dir-btn.coupang")) return "click_coupang";
    if (el.closest(".dir-btn.hotel")) return "click_hotel";
    if (el.closest(".dir-btn.reserve")) return "click_reserve"; // 캠핑 예약 바로가기
    if (el.closest(".dir-btn.kakao, .dir-btn.naver")) return "click_map";
    if (el.closest(".review-link")) return "click_review"; // 네이버 후기 보기 (캠핑 카드)
    if (el.closest("#near-me")) return "click_nearme"; // 내 주변 가까운 순 (캠핑)
    if (el.closest(".report-btn, .report-link")) return "click_report";
    if (el.closest("#cal-btn")) return "click_calendar";
    if (el.closest(".shop-link")) return "click_shop"; // 네이버쇼핑 인기 상품 (가이드 페이지)
    if (el.closest(".cross-link")) return "click_cross"; // 축제↔캠핑 상호 이동 (네트워크 효과 측정)
    if (el.closest(".nearby-link")) return "click_nearby";
    if (el.closest("#fav-btn, .fav-heart")) return "click_favorite";
    if (el.closest("#share-btn")) return "click_share";
    // 정보 표 안의 홈페이지 링크
    if (el.closest(".info-value a")) return "click_homepage";
    return null;
  }

  document.addEventListener(
    "click",
    function (e) {
      const target = e.target;
      if (!target || !target.closest) return;
      const eventName = classify(target);
      if (!eventName) return;

      // 어느 페이지의 어떤 항목에서 눌렀는지 함께 기록
      const item =
        (window.FESTIVAL && window.FESTIVAL.name) ||
        (window.CAMP && window.CAMP.name) ||
        document.title.split("—")[0].trim();

      send(eventName, {
        item_name: item.slice(0, 100),
        page_path: location.pathname,
      });
    },
    true // 캡처 단계: 링크가 새 탭으로 열리기 전에 확실히 기록
  );
})();
