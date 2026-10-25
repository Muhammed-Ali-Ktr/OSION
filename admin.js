/**
 * OSION — Sistem yönetimi paneli
 *
 * Giriş, işletme paneliyle aynı oturumu kullanır (/panel). Tüm veriler veritabanındaki
 * admin_* fonksiyonlarından gelir; her fonksiyon çağıranın sistem yöneticisi olduğunu
 * kendisi denetler (0004_platform_admin.sql). Bu dosyadaki gizlemeler yalnızca kolaylıktır.
 */
(function () {
  "use strict";

  const CONFIG = window.OSION_CONFIG || {};
  let sb = null;
  const store = { me: null, tenants: null, plans: null };

  // ==========================================================================
  // YARDIMCILAR
  // ==========================================================================
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Etiketli şablon: değerler otomatik kaçışlanır; raw() ile işaretlenenler olduğu gibi kalır. */
  class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
  const raw = (v) => new Raw(v);
  const render = (v) => (v instanceof Raw ? v.v : Array.isArray(v) ? v.map(render).join("") : v == null || v === false ? "" : esc(v));
  const h = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const initials = (text) => String(text || "?").trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toLocaleUpperCase("tr")).join("") || "?";
  const norm = (t) => String(t || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "");

  function money(v, currency = "TRY") {
    if (v == null || v === "") return "—";
    try {
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: Number(v) % 1 ? 2 : 0 }).format(Number(v));
    } catch {
      return `${Number(v).toLocaleString("tr-TR")} ₺`;
    }
  }
  const num = (v) => Number(v || 0).toLocaleString("tr-TR");
  const date = (v) => (v ? new Date(v).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const dateTime = (v) => (v ? new Date(v).toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const isoDate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "");
  const daysLeft = (v) => (v ? Math.ceil((new Date(v) - Date.now()) / 86400000) : null);

  function relative(v) {
    if (!v) return "Hiç";
    const diff = (Date.now() - new Date(v)) / 1000;
    if (diff < 60) return "az önce";
    if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
    const d = Math.floor(diff / 86400);
    if (d === 1) return "dün";
    if (d < 30) return `${d} gün önce`;
    return date(v);
  }

  const ICON = {
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    pulse: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    shop: '<svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    close: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
  };

  const STATE_META = {
    active: { label: "Aktif", cls: "ok" },
    expiring: { label: "Süresi yaklaşıyor", cls: "warn" },
    trialing: { label: "Deneme", cls: "info" },
    expired: { label: "Süresi doldu", cls: "bad" },
    canceled: { label: "İptal edildi", cls: "bad" },
    lifetime: { label: "Süresiz", cls: "ok" },
    closed: { label: "Kapalı", cls: "" }
  };
  const SUB_STATUS = { trialing: "Deneme", active: "Aktif", past_due: "Ödeme gecikmiş", canceled: "İptal edildi" };
  const PERIODS = { monthly: "Aylık", yearly: "Yıllık", custom: "Özel" };
  const METHODS = { "": "—", cash: "Nakit", transfer: "Havale / EFT", card: "Kredi kartı", other: "Diğer" };
  const ROLES = { owner: "Sahip", admin: "Yönetici", staff: "Çalışan" };
  const LEVELS = { info: "Bilgi", success: "Yenilik", warning: "Önemli", maintenance: "Planlı bakım" };
  const AUDIT_LABELS = {
    register: "İşletme kaydı", accept: "Davet kabulü", create: "Kayıt ekleme", update: "Kayıt güncelleme", insert: "Kayıt ekleme",
    delete: "Kayıt silme", revoke: "Davet iptali", change_role: "Rol değişikliği", remove: "Üye çıkarma", close: "Hesap kapatma",
    plan_changed: "Plan değişikliği"
  };

  const stateBadge = (state) => {
    const m = STATE_META[state] || { label: state, cls: "" };
    return h`<span class="badge ${m.cls}">${m.label}</span>`;
  };

  function remainingText(t) {
    if (t.state === "lifetime") return "Süresiz";
    if (t.state === "closed") return "—";
    const d = daysLeft(t.endsAt);
    if (d == null) return "—";
    if (d < 0) return `${-d} gün geçti`;
    if (d === 0) return "Bugün bitiyor";
    return `${d} gün kaldı`;
  }

  // --- Bildirim ---
  function toast(message, type = "") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    $("#toastStack").appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 6000 : 3500);
  }

  // --- API ---
  async function call(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      if (/JWT|not authenticated|AUTH_REQUIRED/i.test(`${error.message} ${error.hint}`)) {
        window.location.replace("/panel#giris");
      }
      const message = error.hint && /^[A-Z_]+$/.test(error.hint)
        ? error.message
        : /violates check constraint|invalid input/i.test(error.message)
          ? "Girilen bilgilerden biri geçersiz. Alanları kontrol edin."
          : /Failed to fetch|NetworkError/i.test(error.message) ? "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin." : error.message;
      const err = new Error(message);
      err.code = error.hint || error.code;
      throw err;
    }
    return data;
  }

  async function guarded(btn, fn) {
    if (btn) btn.disabled = true;
    try {
      return await fn();
    } catch (err) {
      toast(err.message, "error");
      return undefined;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ==========================================================================
  // YAN PANEL VE İLETİŞİM KUTUSU
  // ==========================================================================
  function openModal({ title, subtitle = "", body, onSubmit, submitLabel = "Kaydet", danger = false, wide = false }) {
    const modal = $("#modal");
    modal.innerHTML = h`<form class="modal-card" style="${wide ? "width:min(720px,100%)" : ""}" novalidate>
      <header><div><h2>${title}</h2>${subtitle ? h`<p>${subtitle}</p>` : ""}</div>
        <button type="button" class="icon-btn" data-close aria-label="Kapat">${raw(ICON.close)}</button></header>
      <div class="body"><div class="form">${body}</div>
        ${onSubmit ? h`<div class="form-actions" style="margin-top:18px">
          <button type="button" class="btn" data-close>Vazgeç</button>
          <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${submitLabel}</button></div>` : ""}
      </div></form>`;
    modal.classList.remove("hidden");
    const form = $("form", modal);
    const close = () => { modal.classList.add("hidden"); modal.innerHTML = ""; };
    $$("[data-close]", modal).forEach((b) => b.addEventListener("click", close));
    modal.onclick = (e) => { if (e.target === modal) close(); };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      const btn = $('button[type="submit"]', form);
      const ok = await guarded(btn, () => onSubmit(new FormData(form), form));
      if (ok !== false && ok !== undefined) close();
    });
    const first = $("input:not([type=hidden]), textarea, select", form);
    if (first) first.focus();
    return { close, form };
  }

  function confirmBox(title, message, label = "Onayla", danger = true) {
    return new Promise((resolve) => {
      let done = false;
      const m = openModal({
        title, body: h`<p style="margin:0;color:var(--muted)">${message}</p>`, submitLabel: label, danger,
        onSubmit: () => { done = true; resolve(true); return true; }
      });
      const obs = new MutationObserver(() => {
        if ($("#modal").classList.contains("hidden")) { obs.disconnect(); if (!done) resolve(false); }
      });
      obs.observe($("#modal"), { attributes: true });
      return m;
    });
  }

  function closeDrawer() {
    $("#drawer").classList.add("hidden");
    $("#drawerBackdrop").classList.add("hidden");
    $("#drawer").innerHTML = "";
  }

  // ==========================================================================
  // YÖNLENDİRME
  // ==========================================================================
  const ROUTES = {
    genel: pageOverview, isletmeler: () => pageTenants("isletmeler"), abonelikler: () => pageTenants("abonelikler"),
    duyurular: pageAnnouncements, planlar: pagePlans, kullanicilar: pageUsers, kayitlar: pageAudit, hesap: pageAccount
  };

  function currentRoute() {
    const r = (window.location.hash.match(/^#\/([a-z]+)/) || [])[1];
    return ROUTES[r] ? r : "genel";
  }

  async function navigate() {
    const route = currentRoute();
    $$(".side-nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
    $("#side").classList.remove("open");
    $("#sideOverlay").classList.remove("open");
    closeDrawer();
    const content = $("#content");
    content.innerHTML = `<div class="gate-card" style="margin:60px auto;box-shadow:none;border:none;background:none"><div class="spinner"></div></div>`;
    try {
      await ROUTES[route]();
    } catch (err) {
      content.innerHTML = h`<div class="empty"><div class="stat-ic bad">${raw(ICON.alert)}</div><h3>Sayfa yüklenemedi</h3><p>${err.message}</p>
        <button class="btn" type="button" id="retryBtn">Tekrar dene</button></div>`.v;
      $("#retryBtn").onclick = navigate;
    }
    content.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  const pageHead = (title, desc, actions = "") => h`<div class="page-head"><div>
      <div class="kicker">Sistem yönetimi</div><h1>${title}</h1>${desc ? h`<p>${desc}</p>` : ""}</div>
      ${actions ? h`<div class="head-actions">${actions}</div>` : ""}</div>`;

  async function loadTenants(force = false) {
    if (!store.tenants || force) store.tenants = (await call("admin_tenants")) || [];
    return store.tenants;
  }
  async function loadPlans(force = false) {
    if (!store.plans || force) store.plans = (await call("admin_plans")) || [];
    return store.plans;
  }

  // ==========================================================================
  // GENEL BAKIŞ
  // ==========================================================================
  async function pageOverview() {
    const o = await call("admin_overview");
    const stat = (icon, cls, label, value, sub) => h`<div class="card stat"><span class="stat-ic ${cls}">${raw(icon)}</span>
      <div><small>${label}</small><b>${value}</b><em>${sub}</em></div></div>`;
    const maxPlan = Math.max(1, ...o.planDistribution.map((p) => p.count));

    $("#content").innerHTML = h`
      ${pageHead("Genel bakış", "Müşterileriniz, abonelik durumları ve tahsilatlar.",
        h`<button class="btn" type="button" data-act="announce">${raw(ICON.mail)}Duyuru yayınla</button>
          <button class="btn btn-primary" type="button" data-act="new-tenant">${raw(ICON.plus)}Yeni işletme</button>`)}
      <div class="stats">
        ${stat(ICON.check, "ok", "Aktif abonelik", num(o.active), `${num(o.trialing)} işletme denemede`)}
        ${stat(ICON.clock, "warn", "7 gün içinde bitecek", num(o.expiring), "Yenileme bekliyor")}
        ${stat(ICON.alert, "bad", "Süresi dolan", num(o.expired), "Salt okunur durumda")}
        ${stat(ICON.pulse, "info", "Aylık tekrarlayan gelir", money(Math.round(o.mrr)), `Bu ay tahsilat: ${money(o.revenueThisMonth)}`)}
      </div>
      <div class="stats">
        ${stat(ICON.shop, "", "İşletme", num(o.tenants), `${num(o.tenantsLast30)} yeni · ${num(o.tenantsClosed)} kapalı`)}
        ${stat(ICON.users, "", "Kullanıcı", num(o.users), `Son 30 gün: +${num(o.usersLast30)}`)}
        ${stat(ICON.mail, "", "Yayındaki duyuru", num(o.announcementsLive), "İşletme panellerinde görünüyor")}
        ${stat(ICON.box, "", "Toplam tahsilat", money(o.revenueTotal), "Kayıtlı tüm ödemeler")}
      </div>
      <div class="split">
        <section class="card card-pad">
          <div class="card-head"><h2>Yaklaşan yenilemeler</h2><a href="#/abonelikler">Tümü</a></div>
          <p class="card-sub">Önümüzdeki 30 gün içinde biten veya son 7 günde bitmiş abonelikler.</p>
          ${o.upcoming.length ? h`<div class="list">${o.upcoming.map((t) => h`<div class="list-row">
              <span class="avatar sq">${initials(t.name)}</span>
              <div class="grow"><strong>${t.name}</strong><small>${t.planName} · ${date(t.endsAt)}</small></div>
              ${stateBadge(t.state)}
              <button class="btn btn-sm" type="button" data-tenant="${t.id}">Ayrıntı</button></div>`)}</div>`
            : h`<div class="empty-row">${raw(ICON.check)}Önümüzdeki 30 günde biten abonelik yok.</div>`}
        </section>
        <section class="card card-pad">
          <div class="card-head"><h2>Son ödemeler</h2></div>
          ${o.recentPayments.length ? h`<div class="list" style="margin-bottom:18px">${o.recentPayments.map((p) => h`<div class="list-row">
              <div class="grow"><strong>${p.tenantName}</strong><small>${PERIODS[p.period] || p.period} · ${date(p.paidAt)}</small></div>
              <span class="amount">${money(p.amount, p.currency)}</span></div>`)}</div>`
            : h`<div class="empty-row" style="margin:10px 0 18px">${raw(ICON.info)}Henüz ödeme kaydı yok. İşletme ayrıntısından ödeme ekleyebilirsiniz.</div>`}
          <div class="card-head"><h2 style="font-size:14px">Plan dağılımı</h2></div>
          <div class="bars">${o.planDistribution.map((p) => h`<div class="bar-row"><span>${p.name}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round((p.count / maxPlan) * 100)}%"></div></div><b>${num(p.count)}</b></div>`)}</div>
        </section>
      </div>`.v;

    $('[data-act="announce"]').onclick = () => editAnnouncement();
    $('[data-act="new-tenant"]').onclick = newTenant;
    $$("[data-tenant]").forEach((b) => (b.onclick = () => openTenant(b.dataset.tenant)));
  }

  // ==========================================================================
  // İŞLETMELER / ABONELİKLER
  // ==========================================================================
  const TENANT_TABS = [
    ["all", "Tümü", () => true],
    ["active", "Aktif", (t) => ["active", "expiring", "lifetime"].includes(t.state)],
    ["trialing", "Deneme", (t) => t.state === "trialing"],
    ["expiring", "Süresi yaklaşan", (t) => t.state !== "closed" && t.endsAt && daysLeft(t.endsAt) >= 0 && daysLeft(t.endsAt) <= 7],
    ["expired", "Süresi dolan", (t) => ["expired", "canceled"].includes(t.state)],
    ["closed", "Kapalı", (t) => t.state === "closed"]
  ];

  async function pageTenants(kind) {
    const [tenants, plans] = await Promise.all([loadTenants(true), loadPlans()]);
    const subs = kind === "abonelikler";
    const ui = { tab: "all", q: "", plan: "", sort: subs ? "ends" : "new" };

    $("#content").innerHTML = h`
      ${subs
        ? pageHead("Abonelikler", "Bitiş tarihine göre sıralı abonelik takibi. Süresi yaklaşanları buradan tek tıkla yenileyebilirsiniz.")
        : pageHead("İşletmeler", "Kayıtlı tüm müşteriler, sahipleri, planları ve abonelik durumları.",
          h`<button class="btn btn-primary" type="button" id="newTenantBtn">${raw(ICON.plus)}Yeni işletme</button>`)}
      <div class="tabs" role="tablist" id="tabs"></div>
      <div class="filters">
        <div class="search">${raw(ICON.search)}<input class="input" id="q" type="search" placeholder="İşletme, telefon, adres, sahip adı veya e-postası"></div>
        <select class="select" id="planFilter"><option value="">Tüm planlar</option>${plans.map((p) => h`<option value="${p.id}">${p.name}</option>`)}</select>
        <select class="select" id="sort">
          ${subs ? h`<option value="ends">Bitişi en yakın</option>` : ""}
          <option value="new">En yeni kayıt</option><option value="old">En eski kayıt</option><option value="name">Ada göre (A-Z)</option>
          ${subs ? "" : h`<option value="ends">Bitişi en yakın</option>`}
        </select>
      </div>
      <div class="result-count" id="count"></div>
      <div class="table-wrap"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>`.v;

    if (!subs) $("#newTenantBtn").onclick = newTenant;

    const draw = () => {
      const filterFn = TENANT_TABS.find((t) => t[0] === ui.tab)[2];
      const q = norm(ui.q);
      const base = tenants.filter((t) => (!ui.plan || t.planId === ui.plan)
        && (!q || norm(`${t.name} ${t.phone} ${t.address} ${t.owner?.name} ${t.owner?.email} ${t.legalName}`).includes(q)));
      $("#tabs").innerHTML = TENANT_TABS.map(([id, label, fn]) => h`<button type="button" class="tab${ui.tab === id ? " active" : ""}" data-tab="${id}">${label}<span class="count">${base.filter(fn).length}</span></button>`).map(String).join("");
      $$("#tabs .tab").forEach((b) => (b.onclick = () => { ui.tab = b.dataset.tab; draw(); }));

      const rows = base.filter(filterFn).sort((a, b) => {
        if (ui.sort === "name") return a.name.localeCompare(b.name, "tr");
        if (ui.sort === "old") return new Date(a.createdAt) - new Date(b.createdAt);
        if (ui.sort === "ends") return (a.endsAt ? new Date(a.endsAt) : Infinity) - (b.endsAt ? new Date(b.endsAt) : Infinity);
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      $("#count").textContent = `${rows.length} ${subs ? "kayıt" : "işletme"}`;

      const nameCell = (t) => h`<td><div class="cell-main"><span class="avatar sq">${initials(t.name)}</span>
        <div><strong>${t.name}</strong><small>${t.phone || (t.setupCompleted ? "—" : "Kurulum bekleniyor")}</small></div></div></td>`;

      if (subs) {
        $("#thead").innerHTML = `<tr><th>İşletme</th><th>Plan / Dönem</th><th>Bitiş</th><th>Kalan süre</th><th>Ücret</th><th>Durum</th><th class="right"></th></tr>`;
        $("#tbody").innerHTML = rows.map((t) => {
          const d = daysLeft(t.endsAt);
          const total = t.state === "trialing" ? 30 : t.billingPeriod === "yearly" ? 365 : 31;
          const pct = d == null ? 0 : Math.max(0, Math.min(100, (d / total) * 100));
          const tone = d == null ? "" : d < 0 ? "bad" : d <= 7 ? "warn" : "";
          return h`<tr class="clickable" data-id="${t.id}">${nameCell(t)}
            <td><strong>${t.planName}</strong><small>${t.state === "trialing" ? "Deneme" : PERIODS[t.billingPeriod]}</small></td>
            <td class="num"><strong>${date(t.endsAt)}</strong></td>
            <td><div class="progress"><div class="bar-track"><div class="bar-fill ${tone}" style="width:${pct}%"></div></div><small>${remainingText(t)}</small></div></td>
            <td class="num">${t.state === "trialing" ? "₺0" : money(t.price)}</td>
            <td>${stateBadge(t.state)}</td>
            <td class="right"><button class="btn btn-sm" type="button" data-renew="${t.id}">${raw(ICON.refresh)}Yenile</button></td></tr>`;
        }).map(String).join("") || `<tr><td colspan="7"><div class="empty-row">${ICON.info}Bu filtreye uyan kayıt yok.</div></td></tr>`;
      } else {
        $("#thead").innerHTML = `<tr><th>İşletme</th><th>Sahip</th><th>Plan</th><th>Abonelik</th><th class="right">Araç</th><th class="right">Müşteri</th><th>Kayıt</th></tr>`;
        $("#tbody").innerHTML = rows.map((t) => h`<tr class="clickable" data-id="${t.id}">${nameCell(t)}
            <td><strong>${t.owner?.name || "—"}</strong><small>${t.owner?.email || "Sahip henüz katılmadı"}</small></td>
            <td>${t.planName}</td>
            <td>${stateBadge(t.state)}<small style="margin-top:3px">${remainingText(t)}</small></td>
            <td class="num right">${num(t.vehicles)}</td>
            <td class="num right">${num(t.customers)}</td>
            <td class="num">${date(t.createdAt)}</td></tr>`).map(String).join("")
          || `<tr><td colspan="7"><div class="empty-row">${ICON.info}Bu filtreye uyan işletme yok.</div></td></tr>`;
      }
      $$("#tbody tr[data-id]").forEach((tr) => (tr.onclick = (e) => {
        if (e.target.closest("[data-renew]")) return;
        openTenant(tr.dataset.id);
      }));
      $$("[data-renew]").forEach((b) => (b.onclick = () => renewTenant(tenants.find((t) => t.id === b.dataset.renew))));
    };

    $("#q").oninput = (e) => { ui.q = e.target.value; draw(); };
    $("#planFilter").onchange = (e) => { ui.plan = e.target.value; draw(); };
    $("#sort").onchange = (e) => { ui.sort = e.target.value; draw(); };
    draw();
  }

  async function refreshAfterTenantChange(id) {
    await loadTenants(true);
    if (["isletmeler", "abonelikler", "genel"].includes(currentRoute())) {
      const keep = id && !$("#drawer").classList.contains("hidden");
      await ROUTES[currentRoute()]();
      if (keep) openTenant(id, store.drawerTab);
    }
  }

  function renewTenant(t) {
    if (!t) return;
    const plan = (store.plans || []).find((p) => p.id === t.planId) || {};
    openModal({
      title: "Aboneliği yenile",
      subtitle: `${t.name} · ${t.planName}. Bitiş tarihi geçmişse yenileme bugünden başlar.`,
      body: h`<div class="field"><label>Dönem</label>
          <div class="quick-renew">
            <label class="check" style="border:1px solid var(--line-strong);border-radius:12px;padding:12px"><input type="radio" name="period" value="monthly" ${t.billingPeriod !== "yearly" ? "checked" : ""}> 1 ay · ${money(plan.priceMonthly)}</label>
            <label class="check" style="border:1px solid var(--line-strong);border-radius:12px;padding:12px"><input type="radio" name="period" value="yearly" ${t.billingPeriod === "yearly" ? "checked" : ""}> 1 yıl · ${money(plan.priceYearly)}</label>
          </div></div>
        <div class="form-2">
          <div class="field"><label>Tahsil edilen tutar <span>(boşsa plan fiyatı)</span></label><input class="input" name="amount" type="number" min="0" step="0.01" inputmode="decimal"></div>
          <div class="field"><label>Ödeme yöntemi</label><select class="select" name="method" style="width:100%">${Object.entries(METHODS).map(([k, v]) => h`<option value="${k}">${k ? v : "Belirtilmedi"}</option>`)}</select></div>
        </div>
        <div class="field"><label>Not <span>(isteğe bağlı)</span></label><input class="input" name="note" maxlength="300"></div>`,
      submitLabel: "Yenile ve ödemeyi kaydet",
      onSubmit: async (fd) => {
        await call("admin_renew_subscription", {
          p_tenant: t.id, p_period: fd.get("period"), p_amount: fd.get("amount") === "" ? null : Number(fd.get("amount")),
          p_method: fd.get("method"), p_note: fd.get("note")
        });
        toast("Abonelik yenilendi ve ödeme kaydedildi.", "success");
        await refreshAfterTenantChange(t.id);
        return true;
      }
    });
  }

  async function openTenant(id, tab = "summary") {
    const drawer = $("#drawer");
    $("#drawerBackdrop").classList.remove("hidden");
    drawer.classList.remove("hidden");
    drawer.innerHTML = `<div class="drawer-body"><div class="spinner" style="margin:60px auto"></div></div>`;
    $("#drawerBackdrop").onclick = closeDrawer;
    let t;
    try {
      [t] = await Promise.all([call("admin_tenant_detail", { p_tenant: id }), loadPlans()]);
    } catch (err) {
      toast(err.message, "error");
      return closeDrawer();
    }
    store.drawerTab = tab;
    const TABS = [["summary", "Özet"], ["info", "İşletme bilgileri"], ["sub", "Abonelik ve ödemeler"], ["members", "Ekip"]];

    drawer.innerHTML = h`<div class="drawer-head"><span class="avatar sq">${initials(t.name)}</span>
        <div class="grow"><h2 id="drawerTitle">${t.name}</h2><small>${t.planName} · ${remainingText(t)}</small></div>
        ${stateBadge(t.state)}<button class="icon-btn" type="button" data-close aria-label="Kapat">${raw(ICON.close)}</button></div>
      <div class="tabs">${TABS.map(([k, l]) => h`<button type="button" class="tab${k === tab ? " active" : ""}" data-dtab="${k}">${l}</button>`)}</div>
      <div class="drawer-body" id="drawerBody"></div>`.v;
    $("[data-close]", drawer).onclick = closeDrawer;
    $$("[data-dtab]", drawer).forEach((b) => (b.onclick = () => openTenantTab(t, b.dataset.dtab)));
    openTenantTab(t, tab);
  }

  function openTenantTab(t, tab) {
    store.drawerTab = tab;
    $$("#drawer [data-dtab]").forEach((b) => b.classList.toggle("active", b.dataset.dtab === tab));
    const body = $("#drawerBody");
    const plans = store.plans || [];

    if (tab === "summary") {
      body.innerHTML = h`<div class="kv">
          <div><small>Sahip</small><b>${t.owner?.name || "—"}</b><small>${t.owner?.email || "Sahip daveti bekleniyor"}</small></div>
          <div><small>Abonelik bitişi</small><b>${t.state === "lifetime" ? "Süresiz" : date(t.endsAt)}</b><small>${remainingText(t)}</small></div>
          <div><small>Müşteri / Araç</small><b>${num(t.customers)} / ${num(t.vehicles)}</b></div>
          <div><small>Servis kaydı</small><b>${num(t.services)}</b></div>
          <div><small>Ekip üyesi</small><b>${num(t.members)}</b><small>${t.pendingInvites ? `${t.pendingInvites} bekleyen davet` : ""}</small></div>
          <div><small>Kayıt tarihi</small><b>${date(t.createdAt)}</b><small>${t.setupCompleted ? "Kurulum tamam" : "Kurulum bekleniyor"}</small></div>
        </div>
        <section class="card card-pad"><div class="card-head"><h2>Hızlı yenileme</h2></div>
          <p class="card-sub">Ödemeyi aldığınızda aboneliği bir dönem uzatın.</p>
          <button class="btn btn-primary" type="button" id="renewBtn">${raw(ICON.refresh)}Aboneliği yenile</button></section>
        <section class="card card-pad"><div class="card-head"><h2>${t.status === "active" ? "İşletmeyi kapat" : "İşletmeyi yeniden aç"}</h2></div>
          <p class="card-sub">${t.status === "active"
            ? "Kapatılan işletmenin ekibi giriş yapamaz; veriler 30 gün sonra kalıcı olarak silinir. Bu süre içinde geri açabilirsiniz."
            : "İşletme yeniden etkinleşir ve ekip giriş yapabilir."}</p>
          <button class="btn ${t.status === "active" ? "btn-danger" : ""}" type="button" id="statusBtn">${t.status === "active" ? "İşletmeyi kapat" : "Yeniden aç"}</button></section>`.v;
      $("#renewBtn").onclick = () => renewTenant(t);
      $("#statusBtn").onclick = async (e) => {
        const closing = t.status === "active";
        if (closing && !(await confirmBox("İşletme kapatılsın mı?", `${t.name} kapatılacak ve ekibin erişimi kesilecek.`, "Kapat"))) return;
        await guarded(e.currentTarget, async () => {
          await call("admin_set_tenant_status", { p_tenant: t.id, p_active: !closing });
          toast(closing ? "İşletme kapatıldı." : "İşletme yeniden açıldı.", "success");
          await refreshAfterTenantChange(t.id);
          openTenant(t.id, "summary");
        });
      };
    }

    if (tab === "info") {
      body.innerHTML = h`<form class="card card-pad form" id="infoForm" novalidate>
          <div class="field"><label>İşletme adı</label><input class="input" name="name" value="${t.name}" maxlength="80" required></div>
          <div class="form-2">
            <div class="field"><label>Telefon</label><input class="input" name="phone" value="${t.phone}" maxlength="25" inputmode="tel"></div>
            <div class="field"><label>Vergi numarası</label><input class="input" name="taxNumber" value="${t.taxNumber}" maxlength="11" inputmode="numeric"></div>
          </div>
          <div class="field"><label>Adres</label><textarea class="input" name="address" maxlength="300">${t.address}</textarea></div>
          <div class="form-2">
            <div class="field"><label>Ticari unvan</label><input class="input" name="legalName" value="${t.legalName}" maxlength="150"></div>
            <div class="field"><label>Vergi dairesi</label><input class="input" name="taxOffice" value="${t.taxOffice}" maxlength="80"></div>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Bilgileri kaydet</button></div>
        </form>`.v;
      $("#infoForm").onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        guarded($('button[type="submit"]', e.currentTarget), async () => {
          await call("admin_update_tenant", { p_tenant: t.id, p: Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()])) });
          toast("İşletme bilgileri güncellendi.", "success");
          await refreshAfterTenantChange(t.id);
        });
      };
    }

    if (tab === "sub") {
      body.innerHTML = h`<form class="card card-pad form" id="subForm" novalidate>
          <div class="card-head"><h2>Abonelik ayarları</h2></div>
          <div class="form-2">
            <div class="field"><label>Plan</label><select class="select" name="planId" style="width:100%">${plans.map((p) => h`<option value="${p.id}" ${p.id === t.planId ? "selected" : ""}>${p.name}${p.isActive ? "" : " (pasif)"}</option>`)}</select></div>
            <div class="field"><label>Durum</label><select class="select" name="subscriptionStatus" style="width:100%">${Object.entries(SUB_STATUS).map(([k, v]) => h`<option value="${k}" ${k === t.subscriptionStatus ? "selected" : ""}>${v}</option>`)}</select></div>
          </div>
          <div class="form-3">
            <div class="field"><label>Fatura dönemi</label><select class="select" name="billingPeriod" style="width:100%"><option value="monthly" ${t.billingPeriod === "monthly" ? "selected" : ""}>Aylık</option><option value="yearly" ${t.billingPeriod === "yearly" ? "selected" : ""}>Yıllık</option></select></div>
            <div class="field"><label>Deneme bitişi</label><input class="input" type="date" name="trialEndsAt" value="${isoDate(t.trialEndsAt)}"></div>
            <div class="field"><label>Dönem bitişi</label><input class="input" type="date" name="currentPeriodEnd" value="${isoDate(t.currentPeriodEnd)}"><div class="hint">Boş + Aktif = süresiz lisans</div></div>
          </div>
          <div class="form-actions"><button class="btn" type="button" id="renew2">${raw(ICON.refresh)}Yenile</button><button class="btn btn-primary" type="submit">Aboneliği kaydet</button></div>
        </form>
        <section class="card card-pad">
          <div class="card-head"><h2>Ödemeler</h2><button class="btn btn-sm" type="button" id="addPay">${raw(ICON.plus)}Ödeme ekle</button></div>
          ${t.payments.length ? h`<div class="list">${t.payments.map((p) => h`<div class="list-row">
              <div class="grow"><strong>${money(p.amount, p.currency)} · ${PERIODS[p.period] || p.period}</strong>
                <small>${dateTime(p.paidAt)} · ${METHODS[p.method] || "—"}${p.periodEnd ? ` · ${date(p.periodEnd)} tarihine kadar` : ""}${p.note ? ` · ${p.note}` : ""}</small></div>
              <button class="icon-btn" type="button" data-delpay="${p.id}" title="Ödemeyi sil" aria-label="Ödemeyi sil">${raw(ICON.trash)}</button></div>`)}</div>`
            : h`<div class="empty-row">${raw(ICON.info)}Bu işletme için ödeme kaydı yok.</div>`}
        </section>`.v;
      $("#renew2").onclick = () => renewTenant(t);
      $("#subForm").onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const toTs = (v) => (v ? new Date(`${v}T23:59:00`).toISOString() : "");
        guarded($('button[type="submit"]', e.currentTarget), async () => {
          await call("admin_set_subscription", { p_tenant: t.id, p: {
            planId: fd.get("planId"), subscriptionStatus: fd.get("subscriptionStatus"), billingPeriod: fd.get("billingPeriod"),
            trialEndsAt: toTs(fd.get("trialEndsAt")), currentPeriodEnd: toTs(fd.get("currentPeriodEnd")) } });
          toast("Abonelik güncellendi.", "success");
          await refreshAfterTenantChange(t.id);
        });
      };
      $("#addPay").onclick = () => openModal({
        title: "Ödeme ekle", subtitle: t.name,
        body: h`<div class="form-2">
            <div class="field"><label>Tutar</label><input class="input" name="amount" type="number" min="0" step="0.01" required inputmode="decimal"></div>
            <div class="field"><label>Tarih</label><input class="input" name="paidAt" type="date" value="${isoDate(new Date())}"></div></div>
          <div class="form-2">
            <div class="field"><label>Dönem</label><select class="select" name="period" style="width:100%"><option value="monthly">Aylık</option><option value="yearly">Yıllık</option><option value="custom">Özel</option></select></div>
            <div class="field"><label>Yöntem</label><select class="select" name="method" style="width:100%">${Object.entries(METHODS).map(([k, v]) => h`<option value="${k}">${k ? v : "Belirtilmedi"}</option>`)}</select></div></div>
          <div class="field"><label>Not</label><input class="input" name="note" maxlength="300"></div>
          <p class="hint" style="margin:0;color:var(--muted);font-size:12.5px">Bu işlem yalnızca ödemeyi kaydeder; abonelik süresini uzatmak için "Yenile"yi kullanın.</p>`,
        onSubmit: async (fd) => {
          if (!(Number(fd.get("amount")) >= 0) || fd.get("amount") === "") throw new Error("Geçerli bir tutar girin.");
          await call("admin_add_payment", { p_tenant: t.id, p: { amount: fd.get("amount"), period: fd.get("period"), method: fd.get("method"),
            note: fd.get("note"), paidAt: fd.get("paidAt") ? new Date(`${fd.get("paidAt")}T12:00:00`).toISOString() : "" } });
          toast("Ödeme kaydedildi.", "success");
          openTenant(t.id, "sub");
          return true;
        }
      });
      $$("[data-delpay]").forEach((b) => (b.onclick = async () => {
        if (!(await confirmBox("Ödeme kaydı silinsin mi?", "Bu işlem geri alınamaz. Abonelik süresi değişmez.", "Sil"))) return;
        await guarded(b, async () => {
          await call("admin_delete_payment", { p_id: b.dataset.delpay });
          toast("Ödeme kaydı silindi.");
          openTenant(t.id, "sub");
        });
      }));
    }

    if (tab === "members") {
      body.innerHTML = h`<section class="card card-pad"><div class="card-head"><h2>Ekip üyeleri</h2></div>
        ${t.memberList.length ? h`<div class="list">${t.memberList.map((m) => h`<div class="list-row">
            <span class="avatar">${initials(m.name || m.email)}</span>
            <div class="grow"><strong>${m.name || m.email}</strong><small>${m.email} · ${date(m.since)}</small></div>
            <span class="badge ${m.role === "owner" ? "info" : ""}">${ROLES[m.role] || m.role}</span>
            ${m.status !== "active" ? h`<span class="badge">Çıkarıldı</span>` : ""}</div>`)}</div>`
          : h`<div class="empty-row">${raw(ICON.info)}Henüz katılan üye yok${t.pendingInvites ? ` · ${t.pendingInvites} bekleyen davet` : ""}.</div>`}
        </section>`.v;
    }
  }

  function newTenant() {
    const plans = (store.plans || []).filter((p) => p.isActive);
    const ensure = store.plans ? Promise.resolve() : loadPlans();
    ensure.then(() => openModal({
      title: "Yeni işletme",
      subtitle: "İşletme açılır ve sahibi için davet kodu üretilir. Sahip, giriş sayfasındaki Davet Kodu sekmesinden kodla hesabını oluşturur.",
      body: h`<div class="field"><label>İşletme adı</label><input class="input" name="name" maxlength="80" required></div>
        <div class="form-2">
          <div class="field"><label>Sahip e-postası</label><input class="input" name="ownerEmail" type="email" maxlength="120" required></div>
          <div class="field"><label>Telefon <span>(isteğe bağlı)</span></label><input class="input" name="phone" maxlength="25" inputmode="tel"></div></div>
        <div class="form-2">
          <div class="field"><label>Plan</label><select class="select" name="planId" style="width:100%">${(plans.length ? plans : store.plans || []).map((p) => h`<option value="${p.id}" ${p.id === "trial" ? "selected" : ""}>${p.name}</option>`)}</select></div>
          <div class="field"><label>Deneme süresi (gün)</label><input class="input" name="trialDays" type="number" min="1" max="365" value="30"></div></div>`,
      submitLabel: "İşletmeyi oluştur",
      onSubmit: async (fd) => {
        const r = await call("admin_create_tenant", { p: Object.fromEntries(fd.entries()) });
        store.tenants = null;
        const link = `${window.location.origin}/panel#davet=${r.code}`;
        setTimeout(() => openModal({
          title: "İşletme oluşturuldu",
          subtitle: `${r.tenant.name} · Sahip daveti ${r.ownerEmail} için ${date(r.expiresAt)} tarihine kadar geçerli. Kod yalnızca şimdi gösterilir.`,
          body: h`<div class="field"><label>Davet kodu</label><div class="code-box"><span>${r.code}</span><button class="btn btn-sm" type="button" data-copy="${r.code}">Kopyala</button></div></div>
            <div class="field"><label>Davet bağlantısı</label><div class="code-box"><span>${link}</span><button class="btn btn-sm" type="button" data-copy="${link}">Kopyala</button></div></div>`
        }), 0);
        setTimeout(() => $$("#modal [data-copy]").forEach((b) => (b.onclick = async () => {
          try { await navigator.clipboard.writeText(b.dataset.copy); toast("Panoya kopyalandı."); } catch { toast("Kopyalanamadı; metni seçip kopyalayın.", "error"); }
        })), 50);
        if (["isletmeler", "abonelikler", "genel"].includes(currentRoute())) ROUTES[currentRoute()]();
        return true;
      }
    }));
  }

  // ==========================================================================
  // DUYURULAR
  // ==========================================================================
  async function pageAnnouncements() {
    const list = (await call("admin_announcements")) || [];
    const ui = { tab: "all" };
    const STATES = { live: ["Yayında", "ok"], scheduled: ["Planlanmış", "info"], ended: ["Sona erdi", ""], draft: ["Taslak", "warn"] };
    const TABS = [["all", "Tümü"], ["live", "Yayında"], ["scheduled", "Planlanmış"], ["ended", "Sona eren"], ["draft", "Taslak"]];

    $("#content").innerHTML = h`${pageHead("Duyurular", "Bakım, bilgilendirme ve yenilik mesajlarını işletme panellerinin üst kısmında gösterin.",
      h`<button class="btn btn-primary" type="button" id="newAnn">${raw(ICON.plus)}Yeni duyuru</button>`)}
      <div class="tabs" id="tabs"></div><div id="annList"></div>`.v;
    $("#newAnn").onclick = () => editAnnouncement();

    const draw = () => {
      $("#tabs").innerHTML = TABS.map(([k, l]) => h`<button type="button" class="tab${ui.tab === k ? " active" : ""}" data-tab="${k}">${l}<span class="count">${list.filter((a) => k === "all" || a.state === k).length}</span></button>`).map(String).join("");
      $$("#tabs .tab").forEach((b) => (b.onclick = () => { ui.tab = b.dataset.tab; draw(); }));
      const rows = list.filter((a) => ui.tab === "all" || a.state === ui.tab);
      $("#annList").innerHTML = rows.length ? h`<div class="ann-list">${rows.map((a) => h`<article class="card ann">
          <span class="stat-ic ${a.level === "maintenance" ? "bad" : a.level === "warning" ? "warn" : a.level === "success" ? "ok" : "info"}">${raw(ICON.mail)}</span>
          <div class="grow"><h3>${a.title}</h3>${a.body ? h`<p>${a.body}</p>` : ""}
            <div class="ann-meta"><span class="badge ${STATES[a.state][1]}">${STATES[a.state][0]}</span><span class="badge">${LEVELS[a.level]}</span>
              <span>${dateTime(a.startsAt)}${a.endsAt ? ` → ${dateTime(a.endsAt)}` : " · bitiş yok"}</span></div></div>
          <div style="display:flex;gap:6px"><button class="btn btn-sm" type="button" data-edit="${a.id}">${raw(ICON.edit)}Düzenle</button>
            <button class="icon-btn" type="button" data-del="${a.id}" aria-label="Sil" title="Sil">${raw(ICON.trash)}</button></div></article>`)}</div>`.v
        : h`<div class="empty"><div class="stat-ic">${raw(ICON.mail)}</div><h3>Duyuru yok</h3><p>Planlı bakım veya yenilikleri işletmelere buradan duyurabilirsiniz.</p>
            <button class="btn btn-primary" type="button" id="emptyNew">${raw(ICON.plus)}Yeni duyuru</button></div>`.v;
      const emptyNew = $("#emptyNew");
      if (emptyNew) emptyNew.onclick = () => editAnnouncement();
      $$("[data-edit]").forEach((b) => (b.onclick = () => editAnnouncement(list.find((a) => a.id === b.dataset.edit))));
      $$("[data-del]").forEach((b) => (b.onclick = async () => {
        if (!(await confirmBox("Duyuru silinsin mi?", "Duyuru işletme panellerinden de kaldırılır.", "Sil"))) return;
        await guarded(b, async () => { await call("admin_delete_announcement", { p_id: b.dataset.del }); toast("Duyuru silindi."); pageAnnouncements(); });
      }));
    };
    draw();
  }

  function editAnnouncement(a = null) {
    const local = (v) => { if (!v) return ""; const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
    openModal({
      title: a ? "Duyuruyu düzenle" : "Yeni duyuru",
      subtitle: "Yayındaki duyurular tüm işletme panellerinin üstünde görünür; kullanıcı kapatabilir.",
      body: h`<div class="field"><label>Başlık</label><input class="input" name="title" maxlength="120" required value="${a ? a.title : ""}"></div>
        <div class="field"><label>Mesaj</label><textarea class="input" name="body" maxlength="2000">${a ? a.body : ""}</textarea></div>
        <div class="form-3">
          <div class="field"><label>Tür</label><select class="select" name="level" style="width:100%">${Object.entries(LEVELS).map(([k, v]) => h`<option value="${k}" ${a && a.level === k ? "selected" : ""}>${v}</option>`)}</select></div>
          <div class="field"><label>Başlangıç</label><input class="input" type="datetime-local" name="startsAt" value="${local(a ? a.startsAt : new Date())}"></div>
          <div class="field"><label>Bitiş <span>(boş: süresiz)</span></label><input class="input" type="datetime-local" name="endsAt" value="${local(a && a.endsAt)}"></div>
        </div>
        <label class="check"><input type="checkbox" name="isPublished" ${!a || a.isPublished ? "checked" : ""}> Yayınla (işaretsizse taslak olarak saklanır)</label>`,
      submitLabel: a ? "Kaydet" : "Yayınla",
      onSubmit: async (fd) => {
        if (String(fd.get("title")).trim().length < 2) throw new Error("Başlık en az 2 karakter olmalıdır.");
        const ts = (v) => (v ? new Date(v).toISOString() : "");
        await call("admin_save_announcement", { p: { id: a ? a.id : "", title: fd.get("title"), body: fd.get("body"), level: fd.get("level"),
          startsAt: ts(fd.get("startsAt")), endsAt: ts(fd.get("endsAt")), isPublished: fd.get("isPublished") === "on" } });
        toast(a ? "Duyuru güncellendi." : "Duyuru kaydedildi.", "success");
        if (currentRoute() === "duyurular") pageAnnouncements(); else if (currentRoute() === "genel") pageOverview();
        return true;
      }
    });
  }

  // ==========================================================================
  // PLANLAR VE FİYATLAR
  // ==========================================================================
  async function pagePlans() {
    const plans = await loadPlans(true);
    const lim = (v) => (v == null ? "Sınırsız" : num(v));
    $("#content").innerHTML = h`${pageHead("Planlar ve fiyatlar", "Paketlerin fiyatlarını ve limitlerini yönetin. Limitler sunucu tarafında uygulanır; herkese açık planlar tanıtım sitesinde listelenir.",
      h`<a class="btn" href="/#fiyatlar" target="_blank" rel="noopener">Sitede gör ↗</a><button class="btn btn-primary" type="button" id="newPlan">${raw(ICON.plus)}Yeni plan</button>`)}
      <div class="plans">${plans.map((p) => h`<article class="card plan-card${p.isActive ? "" : " inactive"}">
        <div class="plan-top"><div><h3>${p.name}</h3><div class="plan-code">${p.id}</div></div>
          <div class="plan-badges">${!p.isActive ? h`<span class="badge">Pasif</span>` : ""}${p.isFeatured ? h`<span class="badge info">Öne çıkan</span>` : ""}${p.isPublic ? h`<span class="badge ok">Sitede</span>` : h`<span class="badge">Gizli</span>`}</div></div>
        <p class="plan-desc">${p.description || "—"}</p>
        <div class="plan-prices"><div><b>${p.priceMonthly == null ? "—" : money(p.priceMonthly, p.currency)}</b><small>aylık</small></div>
          <div><b>${p.priceYearly == null ? "—" : money(p.priceYearly, p.currency)}</b><small>yıllık</small></div></div>
        <div class="plan-limits"><div><span>Kullanıcı</span><b>${lim(p.maxUsers)}</b></div><div><span>Müşteri</span><b>${lim(p.maxCustomers)}</b></div><div><span>Araç</span><b>${lim(p.maxVehicles)}</b></div></div>
        <div class="plan-foot"><span>${num(p.tenants)} işletme</span><div style="display:flex;gap:6px">
          ${p.id !== "trial" && !p.tenants ? h`<button class="icon-btn" type="button" data-del="${p.id}" title="Planı sil" aria-label="Planı sil">${raw(ICON.trash)}</button>` : ""}
          <button class="btn btn-sm" type="button" data-edit="${p.id}">${raw(ICON.edit)}Düzenle</button></div></div>
      </article>`)}</div>`.v;
    $("#newPlan").onclick = () => editPlan();
    $$("[data-edit]").forEach((b) => (b.onclick = () => editPlan(plans.find((p) => p.id === b.dataset.edit))));
    $$("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox("Plan silinsin mi?", `"${b.dataset.del}" planı kalıcı olarak silinecek.`, "Sil"))) return;
      await guarded(b, async () => { await call("admin_delete_plan", { p_id: b.dataset.del }); toast("Plan silindi."); pagePlans(); });
    }));
  }

  function editPlan(p = null) {
    openModal({
      title: p ? `${p.name} planını düzenle` : "Yeni plan", wide: true,
      subtitle: "Limit alanını boş bırakmak sınırsız demektir. Fiyat boşsa sitede 'Teklif alın' görünür.",
      body: h`<div class="form-2">
          <div class="field"><label>Plan adı</label><input class="input" name="name" maxlength="60" required value="${p ? p.name : ""}"></div>
          <div class="field"><label>Plan kodu <span>(değiştirilemez)</span></label><input class="input mono" name="id" maxlength="30" pattern="[a-z0-9_]+" required value="${p ? p.id : ""}" ${p ? "readonly" : ""} placeholder="ornek_plan"></div></div>
        <div class="field"><label>Açıklama</label><input class="input" name="description" maxlength="300" value="${p ? p.description : ""}"></div>
        <div class="form-3">
          <div class="field"><label>Aylık fiyat</label><input class="input" name="priceMonthly" type="number" min="0" step="0.01" value="${p && p.priceMonthly != null ? p.priceMonthly : ""}"></div>
          <div class="field"><label>Yıllık fiyat</label><input class="input" name="priceYearly" type="number" min="0" step="0.01" value="${p && p.priceYearly != null ? p.priceYearly : ""}"></div>
          <div class="field"><label>Para birimi</label><select class="select" name="currency" style="width:100%">${["TRY", "EUR", "USD", "GBP"].map((c) => h`<option ${(p ? p.currency : "TRY") === c ? "selected" : ""}>${c}</option>`)}</select></div></div>
        <div class="form-3">
          <div class="field"><label>Kullanıcı sınırı</label><input class="input" name="maxUsers" type="number" min="1" required value="${p ? p.maxUsers : 3}"></div>
          <div class="field"><label>Müşteri sınırı</label><input class="input" name="maxCustomers" type="number" min="1" value="${p && p.maxCustomers != null ? p.maxCustomers : ""}" placeholder="Sınırsız"></div>
          <div class="field"><label>Araç sınırı</label><input class="input" name="maxVehicles" type="number" min="1" value="${p && p.maxVehicles != null ? p.maxVehicles : ""}" placeholder="Sınırsız"></div></div>
        <div class="field"><label>Özellikler <span>(her satıra bir madde — sitede listelenir)</span></label><textarea class="input" name="features">${p ? (p.features || []).join("\n") : ""}</textarea></div>
        <div class="form-3">
          <div class="field"><label>Sıra</label><input class="input" name="sort" type="number" value="${p ? p.sort : 10}"></div>
          <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" name="isPublic" ${!p || p.isPublic ? "checked" : ""}> Sitede göster</label>
          <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" name="isFeatured" ${p && p.isFeatured ? "checked" : ""}> Öne çıkar</label></div>
        <label class="check"><input type="checkbox" name="isActive" ${!p || p.isActive ? "checked" : ""}> Aktif (yeni işletmelere atanabilir)</label>`,
      onSubmit: async (fd) => {
        const data = Object.fromEntries(fd.entries());
        data.features = String(data.features || "").split("\n").map((s) => s.trim()).filter(Boolean);
        ["isPublic", "isFeatured", "isActive"].forEach((k) => (data[k] = fd.get(k) === "on"));
        await call("admin_save_plan", { p: data });
        toast("Plan kaydedildi.", "success");
        pagePlans();
        return true;
      }
    });
  }

  // ==========================================================================
  // KULLANICILAR
  // ==========================================================================
  async function pageUsers() {
    const users = (await call("admin_users")) || [];
    $("#content").innerHTML = h`${pageHead("Kullanıcılar", "Kayıtlı hesaplar. Şifreler ve oturum belirteçleri hiçbir zaman gösterilmez.")}
      <div class="filters"><div class="search">${raw(ICON.search)}<input class="input" id="q" type="search" placeholder="Ad, e-posta veya işletme"></div></div>
      <div class="result-count" id="count"></div>
      <div class="table-wrap"><table><thead><tr><th>Kullanıcı</th><th>E-posta</th><th>İşletme</th><th>Son giriş</th><th>Kayıt</th><th>Durum</th><th class="right"></th></tr></thead><tbody id="tbody"></tbody></table></div>`.v;
    const draw = (q = "") => {
      const nq = norm(q);
      const rows = users.filter((u) => !nq || norm(`${u.name} ${u.email} ${u.tenants.map((t) => t.name).join(" ")}`).includes(nq));
      $("#count").textContent = `${rows.length} kullanıcı`;
      $("#tbody").innerHTML = rows.map((u) => h`<tr>
          <td><div class="cell-main"><span class="avatar">${initials(u.name || u.email)}</span><div><strong>${u.name || "—"}</strong>${u.isAdmin ? h`<small>🛡 Sistem yöneticisi</small>` : ""}</div></div></td>
          <td>${u.email}</td>
          <td title="${u.tenants.map((t) => `${t.name} (${ROLES[t.role] || t.role})`).join(", ")}">${u.tenants.length ? h`<strong>${u.tenants[0].name}</strong><small>${ROLES[u.tenants[0].role] || ""}${u.tenants.length > 1 ? ` · +${u.tenants.length - 1} işletme` : ""}</small>` : "—"}</td>
          <td>${relative(u.lastSignInAt)}</td>
          <td class="num">${date(u.createdAt)}</td>
          <td>${u.suspended ? h`<span class="badge bad">Askıda</span>` : u.confirmed ? h`<span class="badge ok">Aktif</span>` : h`<span class="badge warn">Doğrulanmadı</span>`}</td>
          <td class="right">${u.isCurrentUser ? h`<span class="badge">Siz</span>` : u.isAdmin ? "" : h`<button class="btn-link ${u.suspended ? "" : "danger"}" type="button" data-user="${u.id}" data-suspend="${u.suspended ? "0" : "1"}">${u.suspended ? "Etkinleştir" : "Askıya al"}</button>`}</td>
        </tr>`).map(String).join("") || `<tr><td colspan="7"><div class="empty-row">${ICON.info}Eşleşen kullanıcı yok.</div></td></tr>`;
      $$("[data-user]").forEach((b) => (b.onclick = async () => {
        const suspend = b.dataset.suspend === "1";
        const u = users.find((x) => x.id === b.dataset.user);
        if (suspend && !(await confirmBox("Kullanıcı askıya alınsın mı?", `${u.email} giriş yapamaz ve açık oturumları kapatılır.`, "Askıya al"))) return;
        await guarded(b, async () => {
          await call("admin_set_user_suspended", { p_user: u.id, p_suspended: suspend });
          u.suspended = suspend;
          toast(suspend ? "Kullanıcı askıya alındı." : "Kullanıcı yeniden etkinleştirildi.", "success");
          draw($("#q").value);
        });
      }));
    };
    $("#q").oninput = (e) => draw(e.target.value);
    draw();
  }

  // ==========================================================================
  // İŞLEM KAYITLARI
  // ==========================================================================
  async function pageAudit(prefix = "") {
    const rows = (await call("admin_audit", { p_prefix: prefix || null, p_limit: 300 })) || [];
    const label = (a) => (a.startsWith("platform.") ? "Sistem yönetimi" : AUDIT_LABELS[a] || a);
    $("#content").innerHTML = h`${pageHead("İşlem kayıtları", "Önemli işlemler ve yönetim hareketleri. Kayıtlarda şifre, belirteç veya müşteri kişisel verisi tutulmaz.")}
      <div class="filters"><select class="select" id="prefix">
        <option value="">Tüm işlemler</option><option value="platform.">Sistem yönetimi</option><option value="register">İşletme kayıtları</option>
        <option value="accept">Davet kabulleri</option><option value="insert">Kayıt eklemeler</option><option value="update">Kayıt güncellemeler</option>
        <option value="delete">Kayıt silmeler</option><option value="close">Hesap kapatmalar</option></select></div>
      <div class="result-count">${rows.length} kayıt${rows.length >= 300 ? " (son 300)" : ""}</div>
      <div class="table-wrap"><table><thead><tr><th>Zaman</th><th>İşlem</th><th>Kullanıcı</th><th>İşletme</th><th>Ayrıntı</th></tr></thead><tbody>
        ${rows.map((r) => h`<tr><td class="num" style="white-space:nowrap">${dateTime(r.at)}</td>
          <td><span class="mono">${r.action}</span><small>${label(r.action)} · ${r.entity}</small></td>
          <td>${r.userEmail || "—"}</td><td>${r.tenantName || "—"}</td>
          <td><div class="detail-json" title="${r.detail ? JSON.stringify(r.detail) : ""}">${r.detail ? JSON.stringify(r.detail) : ""}</div></td></tr>`)}
        ${rows.length ? "" : raw(`<tr><td colspan="5"><div class="empty-row">${ICON.info}Kayıt yok.</div></td></tr>`)}
      </tbody></table></div>`.v;
    $("#prefix").value = prefix;
    $("#prefix").onchange = (e) => pageAudit(e.target.value).catch((err) => toast(err.message, "error"));
  }

  // ==========================================================================
  // GİRİŞ BİLGİLERİM
  // ==========================================================================
  async function pageAccount() {
    const me = store.me;
    $("#content").innerHTML = h`${pageHead("Giriş bilgilerim", "Sistem yönetimine giriş yaptığınız e-posta ve şifre. Giriş sayfası işletmelerle aynıdır; bu hesapla giriş yapınca yönetim paneline yönlendirilirsiniz.")}
      <div class="stack narrow">
        <form class="card section-card" id="profileForm" novalidate><header><h2>Profil</h2></header><div class="body form">
          <div class="field"><label>Ad soyad</label><input class="input" name="name" maxlength="80" value="${me.name}"></div>
          <div><button class="btn" type="submit">Kaydet</button></div></div></form>
        <form class="card section-card" id="credForm" novalidate><header><h2>E-posta ve şifre</h2>
          <p>Değişiklik için mevcut şifreniz gerekir. Şifre değişince diğer cihazlardaki oturumlarınız kapatılır.</p></header>
          <div class="body form">
            <div class="field"><label>Giriş e-postası</label><input class="input" name="email" type="email" autocomplete="username" value="${me.email}"></div>
            <div class="form-2">
              <div class="field"><label>Yeni şifre <span>(değiştirmeyecekseniz boş bırakın)</span></label><input class="input" name="password" type="password" autocomplete="new-password"></div>
              <div class="field"><label>Yeni şifre (tekrar)</label><input class="input" name="password2" type="password" autocomplete="new-password"></div></div>
            <div class="hint" style="color:var(--muted);font-size:12.5px">Şifre en az 8 karakter olmalı; en az bir harf ve bir rakam içermelidir.</div>
            <div class="field"><label>Mevcut şifre</label><input class="input" name="current" type="password" autocomplete="current-password" required></div>
            <div><button class="btn btn-primary" type="submit">${raw(ICON.shield)}Giriş bilgilerini güncelle</button></div>
          </div></form>
      </div>`.v;

    $("#profileForm").onsubmit = (e) => {
      e.preventDefault();
      const name = new FormData(e.currentTarget).get("name").trim();
      guarded($("button", e.currentTarget), async () => {
        await call("admin_save_profile", { p_display_name: name });
        me.name = name;
        paintMe();
        toast("Profil kaydedildi.", "success");
      });
    };
    $("#credForm").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get("email")).trim().toLowerCase();
      const password = String(fd.get("password"));
      guarded($('button[type="submit"]', e.currentTarget), async () => {
        if (!fd.get("current")) throw new Error("Mevcut şifrenizi girin.");
        if (password && password !== fd.get("password2")) throw new Error("Yeni şifreler eşleşmiyor.");
        if (password && (password.length < 8 || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password) || !/\d/.test(password))) {
          throw new Error("Şifre en az 8 karakter olmalı; en az bir harf ve bir rakam içermelidir.");
        }
        const check = await sb.auth.signInWithPassword({ email: me.email, password: String(fd.get("current")) });
        if (check.error) throw new Error("Mevcut şifre hatalı.");
        const changes = {};
        if (email && email !== me.email) changes.email = email;
        if (password) changes.password = password;
        if (!Object.keys(changes).length) throw new Error("Değiştirilecek bir bilgi girmediniz.");
        const { error } = await sb.auth.updateUser(changes, { emailRedirectTo: `${window.location.origin}/panel` });
        if (error) throw new Error(error.message);
        if (password) { try { await sb.auth.signOut({ scope: "others" }); } catch { /* yok say */ } }
        e.currentTarget.reset();
        $('[name="email"]', e.currentTarget).value = me.email;
        toast(changes.email ? "Yeni e-posta adresinize doğrulama bağlantısı gönderildi." : "Şifreniz güncellendi.", "success");
      });
    };
  }

  // ==========================================================================
  // AÇILIŞ
  // ==========================================================================
  function gate(title, text, actions = []) {
    $("#gateSpinner").classList.add("hidden");
    $("#gateTitle").textContent = title;
    $("#gateText").textContent = text;
    $("#gateActions").innerHTML = "";
    actions.forEach(([label, href, primary]) => {
      const a = document.createElement("a");
      a.className = `btn ${primary ? "btn-primary" : ""}`;
      a.href = href;
      a.textContent = label;
      $("#gateActions").appendChild(a);
    });
  }

  function paintMe() {
    $("#meAvatar").textContent = initials(store.me.name || store.me.email);
    $("#meName").textContent = store.me.name || "Sistem yöneticisi";
    $("#meEmail").textContent = store.me.email;
  }

  async function boot() {
    if (!window.supabase || !CONFIG.supabaseUrl) return gate("Yapılandırma eksik", "config.js içindeki Supabase bilgileri bulunamadı.");
    sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if (!session) {
      gate("Giriş yapın", "Sistem yönetimine erişmek için yönetici hesabınızla giriş yapın.", [["Giriş sayfasına git", "/panel#giris", true]]);
      return;
    }
    let isAdmin = false;
    try {
      isAdmin = await call("platform_is_admin");
    } catch (err) {
      return gate("Bağlantı kurulamadı", err.message, [["Tekrar dene", "/admin", true]]);
    }
    if (!isAdmin) {
      return gate("Yetkiniz yok", "Bu alan yalnızca sistem yöneticilerine açıktır.", [["İşletme paneline dön", "/panel", true], ["Tanıtım sitesi", "/"]]);
    }
    const { data: profile } = await sb.from("profiles").select("display_name, email").eq("id", session.user.id).maybeSingle();
    store.me = { id: session.user.id, email: session.user.email, name: (profile && profile.display_name) || "" };
    paintMe();

    $("#gate").classList.add("hidden");
    $("#shell").classList.remove("hidden");
    $("#menuBtn").onclick = () => { $("#side").classList.add("open"); $("#sideOverlay").classList.add("open"); };
    $("#sideOverlay").onclick = () => { $("#side").classList.remove("open"); $("#sideOverlay").classList.remove("open"); };
    $("#logoutBtn").onclick = async () => {
      try { await sb.auth.signOut({ scope: "local" }); } catch { /* yok say */ }
      window.location.replace("/panel#giris");
    };
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#modal").classList.contains("hidden")) { $("#modal").classList.add("hidden"); $("#modal").innerHTML = ""; }
      else closeDrawer();
    });
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") window.location.replace("/panel#giris"); });
    window.addEventListener("hashchange", navigate);
    if (!window.location.hash) history.replaceState(null, "", "#/genel");
    navigate();
  }

  boot().catch((err) => gate("Beklenmeyen hata", err.message, [["Tekrar dene", "/admin", true]]));
})();
