// report.js — "사진 제보하기" 버튼(.report-link, mailto:)을 눌렀을 때 안내창을 띄운다.
// mailto:는 PC에 메일 앱이 연결돼 있지 않으면 아무 일도 안 일어나서(웹 지메일·네이버메일 사용자 대부분),
// 주소 복사 / Gmail 웹으로 보내기 / 메일 앱으로 보내기 세 가지를 모두 제공한다.

(function () {
  function parseMailto(href) {
    const [addr, query = ""] = href.slice(7).split("?");
    const q = new URLSearchParams(query);
    return { to: addr, subject: q.get("subject") || "", body: q.get("body") || "" };
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = "✅ 복사됨";
    setTimeout(() => { btn.textContent = old; }, 1500);
  }

  function openModal(m, mailtoHref) {
    closeModal();
    const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to)}&su=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    const wrap = document.createElement("div");
    wrap.className = "report-modal-bg";
    wrap.innerHTML = `
      <div class="report-modal" role="dialog" aria-label="사진 제보 방법">
        <button class="report-close" aria-label="닫기">✕</button>
        <h3 class="photo-call-title">📷 사진 제보하기</h3>
        <p class="report-desc">직접 찍은 사진 1~3장을 아래 주소로 보내주세요. 확인 후 닉네임과 함께 올려드려요.</p>
        <div class="report-row">
          <code class="report-addr"></code>
          <button class="report-copy" data-copy="addr">주소 복사</button>
        </div>
        <textarea class="report-body" rows="6" readonly></textarea>
        <div class="report-row">
          <button class="report-copy" data-copy="body">제보 내용 복사</button>
          <span class="report-hint">→ 복사한 내용을 메일 본문에 붙여넣고 사진을 첨부해 주세요</span>
        </div>
        <div class="report-actions">
          <a class="photo-call-btn" target="_blank" rel="noopener" data-gmail>Gmail로 보내기</a>
          <a class="photo-call-btn report-alt" data-mailto>메일 앱으로 보내기</a>
        </div>
        <p class="report-hint">※ 다른 사람 얼굴·차량 번호판이 나온 사진은 피해 주세요. 보내주신 사진은 사이트에 게시되는 데 동의한 것으로 봅니다.</p>
      </div>`;
    wrap.querySelector(".report-addr").textContent = m.to;
    wrap.querySelector(".report-body").value = `제목: ${m.subject}\n\n${m.body}`;
    wrap.querySelector("[data-gmail]").href = gmail;
    wrap.querySelector("[data-mailto]").href = mailtoHref;
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest(".report-close")) { closeModal(); return; }
      const c = e.target.closest(".report-copy");
      if (c) copyText(c.dataset.copy === "addr" ? m.to : wrap.querySelector(".report-body").value, c);
    });
    document.body.appendChild(wrap);
    document.addEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() {
    const el = document.querySelector(".report-modal-bg");
    if (el) el.remove();
    document.removeEventListener("keydown", escClose);
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.report-link");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("mailto:")) return;
    e.preventDefault();
    openModal(parseMailto(href), href);
  });
})();
