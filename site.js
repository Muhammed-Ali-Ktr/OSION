/**
 * OSION tanıtım sitesi: menü, paket fiyatları (veritabanından canlı), oturum algılama.
 * Fiyatlar Sistem yönetimi > Planlar ve fiyatlar bölümünden yönetilir.
 */
(function () {
  "use strict";

  const CONFIG = window.OSION_CONFIG || {};

  // Veritabanına ulaşılamazsa gösterilecek yedek paketler.
  const FALLBACK_PLANS = [
    { id: "basic", name: "Temel", description: "Tek ustalı veya küçük servisler için.", priceMonthly: 599, priceYearly: 5990,
      currency: "TRY", maxUsers: 3, maxCustomers: 500, maxVehicles: 750, isFeatured: false,
      features: ["Müşteri ve araç kartları", "Servis ve usta işçilik girişi", "Borç / tahsilat takibi",
        "Şasi numarasını kamerayla okutma", "E-posta ile servis fişi"] },
    { id: "pro", name: "Profesyonel", description: "Ekibi olan, yoğun çalışan servisler için.", priceMonthly: 999, priceYearly: 9990,
      currency: "TRY", maxUsers: 15, maxCustomers: null, maxVehicles: null, isFeatured: true,
      features: ["Temel paketteki her şey", "Sınırsız müşteri ve araç", "QR kodla ekip daveti",
        "Gelir grafikleri ve raporlar", "Öncelikli destek"] }
  ];

  const state = { plans: [], period: "monthly" };

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function money(value, currency) {
    if (value == null) return "";
    try {
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: currency || "TRY", maximumFractionDigits: 0 }).format(Number(value));
    } catch {
      return `${Number(value).toLocaleString("tr-TR")} ₺`;
    }
  }

  const limit = (n, unit) => (n == null ? "Sınırsız" : `${Number(n).toLocaleString("tr-TR")} ${unit}`);

  // --- Oturum açıksa "Panele Git" ---
  function hasSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(key) && localStorage.getItem(key)) return true;
      }
    } catch { /* depolama kapalı */ }
    return false;
  }

  function applySessionLinks() {
    if (!hasSession()) return;
    document.querySelectorAll('[data-auth-link="login"]').forEach((a) => {
      a.textContent = "Panele Git";
      a.href = "/panel";
    });
    document.querySelectorAll('.header-actions [data-auth-link="register"]').forEach((a) => {
      a.textContent = "Panele Git";
      a.href = "/panel";
    });
    document.querySelectorAll('.header-actions [data-auth-link="login"]').forEach((a) => a.remove());
  }

  // --- Menü ---
  function setupNav() {
    const header = document.getElementById("siteHeader");
    const toggle = document.getElementById("navToggle");
    const nav = document.getElementById("siteNav");
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    toggle.addEventListener("click", () => {
      const open = !nav.classList.contains("open");
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }

  // --- Paketler ---
  function renderPlans() {
    const grid = document.getElementById("pricingGrid");
    const yearly = state.period === "yearly";
    if (!state.plans.length) {
      grid.innerHTML = `<div class="pricing-loading">Paket bilgisi şu anda alınamadı. Lütfen daha sonra tekrar deneyin.</div>`;
      return;
    }
    grid.innerHTML = state.plans.map((p) => {
      const price = yearly ? p.priceYearly : p.priceMonthly;
      const free = price != null && Number(price) === 0;
      let sub = "";
      if (yearly && p.priceYearly != null && p.priceMonthly) {
        const saving = Number(p.priceMonthly) * 12 - Number(p.priceYearly);
        sub = `Aylık ${money(Number(p.priceYearly) / 12, p.currency)}'ye denk gelir${saving > 0 ? ` · ${money(saving, p.currency)} tasarruf` : ""}`;
      } else if (!yearly && p.priceYearly) {
        sub = `Yıllık ödemede ${money(p.priceYearly, p.currency)}`;
      }
      return `<article class="plan${p.isFeatured ? " featured" : ""}">
        ${p.isFeatured ? `<span class="plan-badge">En çok tercih edilen</span>` : ""}
        <h3>${escapeHtml(p.name)}</h3>
        <p class="plan-desc">${escapeHtml(p.description || "")}</p>
        <div class="plan-price">
          ${price == null ? `<b>Teklif alın</b>` : `<b>${free ? "Ücretsiz" : escapeHtml(money(price, p.currency))}</b>${free ? "" : `<span>/ ${yearly ? "yıl" : "ay"}</span>`}`}
        </div>
        <div class="plan-sub">${escapeHtml(sub)}</div>
        <dl class="plan-limits">
          <div><dt>Kullanıcı</dt><dd>${escapeHtml(limit(p.maxUsers, "kişi"))}</dd></div>
          <div><dt>Müşteri</dt><dd>${escapeHtml(limit(p.maxCustomers, "müşteri"))}</dd></div>
          <div><dt>Araç</dt><dd>${escapeHtml(limit(p.maxVehicles, "araç"))}</dd></div>
        </dl>
        <ul class="plan-features">${(p.features || []).map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
        <a href="/panel#kayit" class="btn ${p.isFeatured ? "btn-primary" : "btn-outline"} btn-lg btn-block" data-auth-link="register">30 Gün Ücretsiz Deneyin</a>
      </article>`;
    }).join("");

    // En yüksek yıllık indirimi rozet olarak göster.
    const best = Math.max(0, ...state.plans.filter((p) => p.priceMonthly && p.priceYearly)
      .map((p) => 1 - Number(p.priceYearly) / (Number(p.priceMonthly) * 12)));
    const badge = document.getElementById("yearlySave");
    if (badge) {
      badge.textContent = best > 0 ? `%${Math.round(best * 100)} indirim` : "";
      badge.hidden = !(best > 0);
    }
  }

  async function loadPlans() {
    if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
      try {
        const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/public_plans`, {
          method: "POST",
          headers: { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${CONFIG.supabaseAnonKey}`, "Content-Type": "application/json" },
          body: "{}"
        });
        if (res.ok) {
          const plans = await res.json();
          if (Array.isArray(plans) && plans.length) {
            state.plans = plans;
            return renderPlans();
          }
        }
      } catch { /* yedek paketler gösterilir */ }
    }
    state.plans = FALLBACK_PLANS;
    renderPlans();
  }

  function setupBillingToggle() {
    document.querySelectorAll(".billing-toggle [data-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.period = btn.dataset.period;
        document.querySelectorAll(".billing-toggle [data-period]").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-checked", String(on));
        });
        renderPlans();
        applySessionLinks();
      });
    });
  }

  function setupReveal() {
    const items = document.querySelectorAll(".feature, .steps li, .section-head, .faq details");
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -40px 0px" });
    items.forEach((el) => {
      el.classList.add("reveal");
      io.observe(el);
    });
  }

  document.getElementById("year").textContent = String(new Date().getFullYear());
  setupNav();
  setupBillingToggle();
  setupReveal();
  applySessionLinks();
  loadPlans().then(applySessionLinks);
})();
