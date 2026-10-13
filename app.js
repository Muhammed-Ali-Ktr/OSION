/**
 * Oto Tamir Servisi Takip Otomasyonu - Frontend Logic
 * Framework içermeyen saf Vanilla JavaScript
 *
 * Oturum, işletme (tenant) bilgisi, API istemcisi ve biçimlendirme yardımcıları
 * platform.js dosyasındadır. Kullanıcı verisi içeren HTML'ler html`` şablonuyla
 * (otomatik kaçışlama) üretilir.
 */

// Uygulama Durumu (State) — yalnızca oturumdaki işletmenin verileri tutulur
const state = {
  customers: [],
  vehicles: [],
  serviceRecords: [],
  theme: 'light',
  currentView: 'dashboard'
};

// Bilinen Yaygın Araç Markaları (Klasör Gruplamaları için)
const KNOWN_BRANDS = [
  'Volkswagen', 'Fiat', 'Toyota', 'Opel', 'Renault', 'Ford', 
  'Hyundai', 'BMW', 'Mercedes-Benz', 'Peugeot', 'Citroën', 
  'Honda', 'Nissan', 'Seat', 'Skoda', 'Audi', 'Kia'
];

// Marka Amblem/Logo Yolları Eşleştirmesi
const BRAND_LOGOS = {
  'Volkswagen': 'car logo/volkswagen.png',
  'Fiat': 'car logo/fiat.svg',
  'Toyota': 'car logo/toyota.png',
  'Opel': 'car logo/opel.png',
  'Renault': 'car logo/renault.png',
  'Ford': 'car logo/ford.svg',
  'Hyundai': 'car logo/hyundai.png',
  'BMW': 'car logo/bmw.png',
  'Mercedes-Benz': 'car logo/Mercedes-Benz-Logo.png',
  'Peugeot': 'car logo/peugeot.png',
  'Citroën': 'car logo/citroen.png',
  'Honda': 'car logo/honda.svg',
  'Nissan': 'car logo/nissan.png',
  'Seat': 'car logo/seat.svg',
  'Skoda': 'car logo/skoda.png',
  'Audi': 'car logo/audi.png',
  'Kia': 'car logo/kia.svg'
};

let activeBrandFolder = 'ALL';

function handleBrandSelectChange(selectId, customGroupId, customInputId) {
  const select = document.getElementById(selectId);
  const customGroup = document.getElementById(customGroupId);
  const customInput = document.getElementById(customInputId);
  
  if (!select || !customGroup) return;
  
  if (select.value === "OTHER_CUSTOM") {
    customGroup.classList.remove("hidden");
    if (customInput) customInput.focus();
  } else {
    customGroup.classList.add("hidden");
    if (customInput) customInput.value = "";
  }
}

// Grafik Örnekleri (Chart.js)
let monthlyChart = null;
let paymentChart = null;

// Usta Tipleri Tanımı
const TECHNICIANS = [
  { id: 'tamirci', label: 'Tamirci İşçiliği', feeKey: 'mechanicFee', noteKey: 'mechanicNote', title: 'Tamirci İşlemleri' },
  { id: 'elektrikci', label: 'Elektrikçi', feeKey: 'electricianFee', noteKey: 'electricianNote', title: 'Elektrikçi İşlemleri' },
  { id: 'boyaci', label: 'Boyacı', feeKey: 'boyaciFee', noteKey: 'boyaciNote', title: 'Boyacı İşlemleri' },
  { id: 'cikmaci', label: 'Çıkma Parçacı', feeKey: 'cikmaciFee', noteKey: 'cikmaciNote', title: 'Çıkma Parçacı İşlemleri' },
  { id: 'egzozcu', label: 'Egzozcu', feeKey: 'egzozcuFee', noteKey: 'egzozcuNote', title: 'Egzozcu İşlemleri' },
  { id: 'frenci', label: 'Frenci', feeKey: 'frenciFee', noteKey: 'frenciNote', title: 'Frenci İşlemleri' },
  { id: 'kapakci', label: 'Kapakçı', feeKey: 'kapakciFee', noteKey: 'kapakciNote', title: 'Kapakçı İşlemleri' },
  { id: 'kaportaci', label: 'Kaportacı', feeKey: 'kaportaciFee', noteKey: 'kaportaciNote', title: 'Kaportacı İşlemleri' },
  { id: 'kurtarici', label: 'Kurtarıcı', feeKey: 'kurtariciFee', noteKey: 'kurtariciNote', title: 'Kurtarıcı İşlemleri' },
  { id: 'parcaci', label: 'Parçacı', feeKey: 'parcaciFee', noteKey: 'parcaciNote', title: 'Parçacı İşlemleri' },
  { id: 'pompaci', label: 'Pompacı', feeKey: 'pompaciFee', noteKey: 'pompaciNote', title: 'Pompacı İşlemleri' },
  { id: 'tornaci', label: 'Tornacı', feeKey: 'tornaciFee', noteKey: 'tornaciNote', title: 'Tornacı İşlemleri' },
  { id: 'turbocu', label: 'Turbocu', feeKey: 'turbocuFee', noteKey: 'turbocuNote', title: 'Turbocu İşlemleri' },
  { id: 'tupcu', label: 'Tüpçü', feeKey: 'tupcuFee', noteKey: 'tupcuNote', title: 'Tüpçü İşlemleri' },
  { id: 'yagci', label: 'Yağcı', feeKey: 'yagciFee', noteKey: 'yagciNote', title: 'Yağcı İşlemleri' },
  { id: 'yikamaci', label: 'Yıkamacı', feeKey: 'yikamaciFee', noteKey: 'yikamaciNote', title: 'Yıkamacı İşlemleri' }
];

const TECHNICIAN_CATEGORIES = [
  {
    name: 'Mekanik & Bakım',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    items: ['tamirci', 'frenci', 'egzozcu', 'kurtarici', 'kapakci', 'tornaci']
  },
  {
    name: 'Elektrik & Elektronik',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    items: ['elektrikci']
  },
  {
    name: 'Kaporta & Boya',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>',
    items: ['boyaci', 'kaportaci', 'cikmaci']
  },
  {
    name: 'Motor & Sistem',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    items: ['pompaci', 'yagci', 'turbocu', 'tupcu', 'parcaci', 'yikamaci']
  }
];

function normalizeCustomerPhones(customers) {
  return customers.map(customer => {
    const phone = String(customer.phone || '').trim();
    return {
      ...customer,
      phone: /^\d{10}$/.test(phone) ? `0${phone}` : phone
    };
  });
}

function getPaidAmount(record) {
  const total = parseFloat(record.totalAmount) || 0;
  if (record.paymentStatus === "Kısmi Ödendi") {
    return record.paidAmount !== undefined && record.paidAmount !== "" ? Math.min(Math.max(parseFloat(record.paidAmount) || 0, 0), total) : total * 0.5;
  }
  return ["Ödendi", "Nakit Ödendi", "Havale Yapıldı", "Kartla Ödendi"].includes(record.paymentStatus) ? total : 0;
}

function getRemainingAmount(record) {
  const total = parseFloat(record.totalAmount) || 0;
  if (record.paymentStatus === "Kısmi Ödendi" && record.remainingAmount !== undefined && record.remainingAmount !== "") {
    return Math.max(parseFloat(record.remainingAmount) || 0, 0);
  }
  return Math.max(total - getPaidAmount(record), 0);
}

// Toast Bildirim Sistemi
function showToast(message, type = 'success') {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-content"></div>
  `;
  // Mesajlar sunucu hata metni içerebilir; HTML olarak yorumlanmaz.
  toast.querySelector(".toast-content").textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-hiding");
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ==========================================================================
// UYGULAMA BAŞLANGICI (INIT)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Temayı yükle
  initTheme();

  // Tarihi üst bara yazdır
  updateCurrentDateDisplay();

  // Dinamik Usta Alanlarını Oluştur
  renderMechanicCheckboxes();
  initMechanicBoxes();

  // Oturumu doğrula; giriş, ilk kurulum veya uygulama ekranına yönlendir (platform.js)
  bootApp();

  // Kısayol Tuş Dinleyicisi (/)
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === "/" && !typing && document.body.classList.contains("app-ready")) {
      e.preventDefault();
      const sInput = document.getElementById("globalSearch");
      sInput.focus();
      sInput.select();
    }
    if (e.key === "Escape") {
      closeSearchResults();
      closeNewCustomerModal();
      closeNewVehicleModal();
      closeCustomerEditModal();
      closeVehicleEditModal();
      closeHistoryModal();
    }
  });

  // Arama ve Combobox dışına tıklanınca sonuçları kapat
  document.addEventListener("click", (e) => {
    const searchContainer = document.querySelector(".search-container");
    if (searchContainer && !searchContainer.contains(e.target)) {
      closeSearchResults();
    }
    if (!e.target.closest(".customer-combobox-group")) {
      document.querySelectorAll(".combobox-results-panel").forEach(panel => panel.classList.add("hidden"));
    }
  });

  // Modal arkasına tıklanınca kapatma dinleyicileri
  const editCustModal = document.getElementById("customerEditModal");
  if (editCustModal) {
    editCustModal.addEventListener("click", (e) => {
      if (e.target === editCustModal) closeCustomerEditModal();
    });
  }
  const editVehModal = document.getElementById("vehicleEditModal");
  if (editVehModal) {
    editVehModal.addEventListener("click", (e) => {
      if (e.target === editVehModal) closeVehicleEditModal();
    });
  }
  const histModal = document.getElementById("historyModal");
  if (histModal) {
    histModal.addEventListener("click", (e) => {
      if (e.target === histModal) closeHistoryModal();
    });
  }

  // Varsayılan olarak bugünün tarihini formlara ata (yerel gün)
  const vehicleEntryDate = document.getElementById("v_entryDate");
  if (vehicleEntryDate) vehicleEntryDate.value = todayIso();
  document.getElementById("s_date").value = todayIso();
});

// Üst bar tarih yazısı
function updateCurrentDateDisplay() {
  const today = new Date();
  const optionsDesktop = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const optionsMobile = { year: 'numeric', month: 'short', day: 'numeric' };
  
  const isMobile = window.innerWidth <= 768;
  const options = isMobile ? optionsMobile : optionsDesktop;
  document.getElementById("currentDateText").textContent = today.toLocaleDateString("tr-TR", options);
}
window.addEventListener('resize', updateCurrentDateDisplay);

// ==========================================================================
// VERİ ÇEKME & GÖNDERME (FETCH & SYNC)
// Tüm istekler oturum anahtarıyla gider; işletme kapsamı sunucuda belirlenir.
// ==========================================================================
async function fetchData() {
  setSyncStatus("syncing");
  try {
    setTenantData(await apiCall("getData"));
    platform.offline = false;
    document.body.classList.remove("is-offline");
    setSyncStatus("connected");
    renderAll();
    return true;
  } catch (error) {
    if (!error.handled) {
      setSyncStatus(error.code === "NETWORK" ? "offline" : "error");
      showToast(`Veriler yenilenemedi: ${error.message}`, "error");
    }
    return false;
  }
}

/**
 * Sunucuya değişiklik gönderir ve başarılıysa yalnızca değişen kaydı yerel duruma işler
 * (tüm işletme verisi yeniden indirilmez).
 * Başarıda sunucu yanıtını (ör. eklenen kayıt) döndürür, hata durumunda false.
 */
async function sendRequest(action, payload) {
  if (platform.offline) {
    showToast("Çevrimdışıyken değişiklik yapılamaz. Bağlantı geldiğinde sayfayı yenileyin.", "warning");
    return false;
  }
  setSyncStatus("syncing");
  try {
    const result = await apiCall(action, payload);
    if (applyLocalChange(action, payload, result)) {
      setSyncStatus("connected");
      renderAll();
    } else {
      await fetchData();
    }
    return result || true;
  } catch (error) {
    if (!error.handled) {
      setSyncStatus(error.code === "NETWORK" ? "offline" : "error");
      showToast(error.message, error.code === "VALIDATION" ? "warning" : "error");
    }
    return false;
  }
}

// ==========================================================================
// TEMA & MENÜ YÖNETİMİ
// ==========================================================================
function initTheme() {
  const savedTheme = storageGet("oto_takip_theme") || "light";
  setTheme(savedTheme);
}

function setTheme(themeName) {
  document.documentElement.setAttribute("data-theme", themeName);
  state.theme = themeName;
  storageSet("oto_takip_theme", themeName);
  
  const sunIcon = document.getElementById("themeIconSun");
  const moonIcon = document.getElementById("themeIconMoon");
  const themeText = document.getElementById("themeToggleText");
  
  if (themeName === "dark") {
    sunIcon.classList.remove("hidden");
    moonIcon.classList.add("hidden");
    themeText.textContent = "Açık Tema";
  } else {
    sunIcon.classList.add("hidden");
    moonIcon.classList.remove("hidden");
    themeText.textContent = "Koyu Tema";
  }
}

function toggleTheme() {
  const newTheme = state.theme === "light" ? "dark" : "light";
  setTheme(newTheme);
  // Grafikleri yeni renklere göre yeniden çiz
  renderCharts();
}

function switchView(viewName) {
  state.currentView = viewName;

  // Tüm görünümleri gizle
  document.querySelectorAll('.page-view').forEach(view => view.classList.add('hidden'));

  // Seçilen görünümü göster
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.remove('hidden');
  }

  // Sol menüdeki aktif eleman sınıfını güncelle
  document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
    item.classList.remove('active');
  });
  const activeMenuItem = document.getElementById(`menu-${viewName}`);
  if (activeMenuItem) {
    activeMenuItem.classList.add('active');
  }

  // Mobil menüyü kapat
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('active');
  if (overlay) overlay.classList.remove('active');

  // SAYFAYI EN ÜSTE KAYDIR (Sayfa aşağı kayık kalma sorununu çözer)
  window.scrollTo({ top: 0, behavior: 'instant' });
  const mainContent = document.querySelector('.main-content');
  if (mainContent) mainContent.scrollTop = 0;

  // Sayfaya özel render tetikle
  if (viewName === 'dashboard') {
    renderDashboard();
  } else if (viewName === 'customers') {
    renderRegPageList();
  } else if (viewName === 'only-customers') {
    renderOnlyCustomers();
  } else if (viewName === 'only-vehicles') {
    renderOnlyVehicles();
  } else if (viewName === 'services' || viewName === 'services-log') {
    renderServices();
  } else if (viewName === 'calendar') {
    renderCalendar();
  } else if (viewName === 'debts') {
    renderDebts();
  } else if (viewName === 'settings') {
    renderSettings();
  }
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  
  sidebar.classList.toggle("active");
  overlay.classList.toggle("active");
}

// Mobil overlay arkasına tıklanınca kapat
document.getElementById("sidebarOverlay").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("active");
  document.getElementById("sidebarOverlay").classList.remove("active");
});

// ==========================================================================
// RENDER FONKSİYONLARI (ARAYÜZ YENİLEME)
// ==========================================================================
function renderAll() {
  renderDashboard();
  renderServices();
  renderOnlyCustomers();
  renderOnlyVehicles();
  renderRegPageList();
  renderCalendar();
  renderDebts();
}

// --- 1. DASHBOARD PANELİ RENDER ---
function renderDashboard() {
  // Metrikleri Hesapla
  const totalCustomers = state.customers.length;
  const totalVehicles = state.vehicles.length;
  
  let totalDebt = 0;
  let totalRevenue = 0;
  
  state.serviceRecords.forEach(rec => {
    const total = parseFloat(rec.totalAmount) || 0;
    const status = rec.paymentStatus;
    
    if (status === "Ödendi" || status === "Nakit Ödendi" || status === "Havale Yapıldı" || status === "Kartla Ödendi") {
      totalRevenue += total;
    } else if (status === "Ödenmedi") {
      totalDebt += total;
    } else if (status === "Kısmi Ödendi") {
      // Kısmi ödemede yarısını tahsil edilmiş yarısını borç sayalım
      totalRevenue += getPaidAmount(rec);
      totalDebt += getRemainingAmount(rec);
    }
  });

  // Metrikleri ekrana yaz
  document.getElementById("metric-total-customers").textContent = totalCustomers;
  document.getElementById("metric-total-vehicles").textContent = totalVehicles;
  document.getElementById("metric-total-debt").textContent = formatMoney(totalDebt);
  document.getElementById("metric-total-revenue").textContent = formatMoney(totalRevenue);

  // Grafik çizimleri
  renderCharts();

  // Borçlu Araçlar Bento Paneli
  const debtorListContainer = document.getElementById("debtorVehiclesList");
  debtorListContainer.innerHTML = "";
  
  // Ödenmedi veya Kısmi Ödendi olan kayıtları filtrele
  const debtorRecords = state.serviceRecords.filter(rec => rec.paymentStatus === "Ödenmedi" || rec.paymentStatus === "Kısmi Ödendi");
  
  if (debtorRecords.length === 0) {
    debtorListContainer.innerHTML = state.serviceRecords.length === 0
      ? html`<div class="bento-card empty-state" style="grid-column: 1 / -1;"><strong>Henüz servis kaydı yok.</strong><span>İlk müşterinizi ve aracınızı ekleyip <em>Servis Girişi</em> ile kayıt oluşturduğunuzda gelir ve borç bilgileri burada görünür.</span></div>`
      : `<div class="bento-card" style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary);">Borçlu araç bulunmamaktadır. Tebrikler!</div>`;
    return;
  }

  debtorRecords.forEach(rec => {
    // İlgili aracı ve müşteriyi bul
    const vehicle = state.vehicles.find(v => v.id === rec.vehicleId);
    if (!vehicle) return;
    
    const customer = state.customers.find(c => c.id === vehicle.customerId);
    const customerName = customer ? `${customer.firstName} ${customer.lastName}` : "Bilinmeyen Müşteri";
    
    // Kısmi ödeme durumunda gösterilecek borç miktarını ayarla
    const debtAmount = getRemainingAmount(rec);

    const card = document.createElement("div");
    card.className = "debtor-card";
    card.innerHTML = html`
      <div class="debtor-header">
        <div class="debtor-customer">${customerName}</div>
        <div class="debtor-plate">${vehicle.plate}</div>
      </div>
      <div class="debtor-vehicle">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        ${vehicle.brand} ${vehicle.model}
      </div>
      <div style="font-size: 11px; color: var(--text-muted);">
        İşlem Tarihi: ${formatDate(rec.recordDate)}
      </div>
      <div class="debtor-footer">
        <div>
          <div class="debtor-amount-label">Borç Tutarı</div>
          <div class="debtor-amount-val">${formatMoney(debtAmount)}</div>
        </div>
        <button class="btn btn-secondary btn-mini" onclick="editServiceRecord('${rec.id}')" title="İşlemi Düzenle / Tahsil Et">
          Detay/Düzenle
        </button>
      </div>
    `;
    debtorListContainer.appendChild(card);
  });
}

// --- 2. GRAFİKLER RENDER (CHART.JS) ---
function renderCharts() {
  const isDark = state.theme === "dark";
  const gridColor = isDark ? "#30363d" : "#d0d7de";
  const textColor = isDark ? "#8b949e" : "#57606a";
  
  // 2.1. AYLIK GELİR GRAFİĞİ (Bar/Line Chart)
  const monthlyCanvas = document.getElementById("monthlyEarningsChart");
  if (!monthlyCanvas) return;

  // Son 6 ayın verilerini grupla
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const currentMonthIdx = new Date().getMonth();
  
  // Son 6 ayı hesapla (yıl dahil; geçen yılın aynı ayı karışmaz)
  const last6Months = [];
  const last6Keys = [];
  const totalVolumeData = [0, 0, 0, 0, 0, 0];
  const collectedData = [0, 0, 0, 0, 0, 0];
  const currentYear = new Date().getFullYear();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentYear, currentMonthIdx - i, 1);
    last6Months.push(months[d.getMonth()]);
    last6Keys.push(`${d.getFullYear()}-${d.getMonth()}`);
  }

  // Servis kayıtlarını son 6 aya göre dağıt
  state.serviceRecords.forEach(rec => {
    const date = parseDateValue(rec.recordDate);
    if (!date) return;
    const total = parseFloat(rec.totalAmount) || 0;

    // Bu ay son 6 ayın içinde mi?
    const monthPos = last6Keys.indexOf(`${date.getFullYear()}-${date.getMonth()}`);
    if (monthPos !== -1) {
      totalVolumeData[monthPos] += total;
      
      if (rec.paymentStatus === "Ödendi" || rec.paymentStatus === "Nakit Ödendi" || rec.paymentStatus === "Havale Yapıldı" || rec.paymentStatus === "Kartla Ödendi") {
        collectedData[monthPos] += total;
      } else if (rec.paymentStatus === "Kısmi Ödendi") {
        collectedData[monthPos] += getPaidAmount(rec);
      }
    }
  });

  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(monthlyCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: last6Months,
      datasets: [
        {
          label: "Toplam İş Hacmi",
          data: totalVolumeData,
          backgroundColor: isDark ? "#388bfd88" : "#0969da88",
          borderColor: isDark ? "#58a6ff" : "#0969da",
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: "Tahsil Edilen",
          data: collectedData,
          backgroundColor: isDark ? "#2ea04388" : "#1a7f3788",
          borderColor: isDark ? "#3fb950" : "#1a7f37",
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor, callback: (value) => formatNumber(value) }
        }
      },
      plugins: {
        legend: {
          labels: { color: textColor }
        }
      }
    }
  });

  // 2.2. TAHSİLAT DAĞILIM GRAFİĞİ (Doughnut)
  const paymentCanvas = document.getElementById("paymentStatusChart");
  if (!paymentCanvas) return;

  let paidCashSum = 0;
  let paidTransferSum = 0;
  let paidCardSum = 0;
  let unpaidSum = 0;
  let partialSum = 0;

  state.serviceRecords.forEach(rec => {
    const total = parseFloat(rec.totalAmount) || 0;
    if (rec.paymentStatus === "Ödendi" || rec.paymentStatus === "Nakit Ödendi") paidCashSum += total;
    else if (rec.paymentStatus === "Havale Yapıldı") paidTransferSum += total;
    else if (rec.paymentStatus === "Kartla Ödendi") paidCardSum += total;
    else if (rec.paymentStatus === "Ödenmedi") unpaidSum += total;
    else if (rec.paymentStatus === "Kısmi Ödendi") partialSum += total;
  });

  if (paymentChart) paymentChart.destroy();
  paymentChart = new Chart(paymentCanvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: ["Nakit Ödenen", "Havale Yapılan", "Kartla Ödenen", "Ödenmeyen", "Kısmi Ödenen"],
      datasets: [{
        data: [paidCashSum, paidTransferSum, paidCardSum, unpaidSum, partialSum],
        backgroundColor: [
          isDark ? "#2ea043aa" : "#1a7f37aa",
          isDark ? "#388bfdaa" : "#0969daaa",
          isDark ? "#8250dfaa" : "#8250dfaa",
          isDark ? "#da3633aa" : "#cf222eaa",
          isDark ? "#bb8009aa" : "#9a6700aa"
        ],
        borderColor: [
          isDark ? "#3fb950" : "#1a7f37",
          isDark ? "#58a6ff" : "#0969da",
          isDark ? "#a371f7" : "#8250df",
          isDark ? "#f85149" : "#cf222e",
          isDark ? "#d29922" : "#9a6700"
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: textColor }
        }
      }
    }
  });
}

// --- 4. SERVİS NOTLARI GÜNLÜĞÜ RENDER ---
function renderServices() {
  const container = document.getElementById("servicesLogContainer");

  if (!container) return;
  container.innerHTML = "";

  if (state.serviceRecords.length === 0) {
    container.innerHTML = `<div class="search-no-results">Geçmiş servis işlemi bulunmuyor. Yeni kayıt için <strong>Servis Girişi</strong> sayfasını kullanın.</div>`;
    return;
  }

  // Servisleri tarihe göre yeniden eskiye diz
  const sortedServices = [...state.serviceRecords].sort((a, b) => 
    new Date(b.recordDate) - new Date(a.recordDate)
  );

  sortedServices.forEach(rec => {
    const vehicle = state.vehicles.find(v => v.id === rec.vehicleId);
    if (!vehicle) return;
    
    const customer = state.customers.find(c => c.id === vehicle.customerId);
    const customerName = customer ? `${customer.firstName} ${customer.lastName}` : "Bilinmeyen Müşteri";
    const customerPhone = customer ? customer.phone : "";

    // Ödeme durumuna göre rozet ayarla
    let badgeClass = "badge-unpaid";
    if (rec.paymentStatus === "Ödendi" || rec.paymentStatus === "Nakit Ödendi" || rec.paymentStatus === "Havale Yapıldı") badgeClass = "badge-paid";
    else if (rec.paymentStatus === "Kartla Ödendi") badgeClass = "badge-card";
    else if (rec.paymentStatus === "Kısmi Ödendi") badgeClass = "badge-partial";

    // Usta detaylarını hazırla (Tüm usta ücret ve notları)
    const techDetailHtml = [];
    TECHNICIANS.forEach(tech => {
      const fee = parseFloat(rec[tech.feeKey]) || 0;
      const note = rec[tech.noteKey];
      if (fee > 0 || note) {
        techDetailHtml.push(html`
          <div class="sub-op-row" style="padding: 8px 12px; background: var(--bg-subtle); border-radius: 6px; margin-bottom: 6px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <strong style="color: var(--text-primary); font-size: 13px;">${tech.label}:</strong>
              <span style="font-weight: 700; color: var(--accent); font-size: 13px;">${fee > 0 ? formatMoney(fee) : "İşlem Yapıldı"}</span>
            </div>
            ${note ? html`<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; font-style: italic; border-left: 2px solid var(--accent); padding-left: 8px;">${note}</div>` : ""}
          </div>
        `);
      }
    });

    if (!techDetailHtml.length) {
      techDetailHtml.push(html`<div style="font-size: 12px; color: var(--text-muted); font-style: italic;">Ayrıntılı usta ücret kaydı bulunmuyor.</div>`);
    }

    const card = document.createElement("div");
    card.className = "service-log-card";
    card.id = `service-log-card-${rec.id}`;
    card.innerHTML = html`
      <div class="service-log-header">
        <div>
          <span class="service-log-title" style="font-size: 15px; font-weight: 700;">${customerName}</span>
          <span style="font-size:13px; margin-left:8px; color:var(--text-secondary);">${vehicle.brand} ${vehicle.model} - <strong style="color: var(--accent);">${vehicle.plate}</strong></span>
        </div>
        <span class="badge ${badgeClass}">${rec.paymentStatus}</span>
      </div>
      
      <div class="service-log-meta-visible" style="margin-top: 8px; font-size: 13px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <span>Servis Kayıt Tarihi: <strong>${formatDate(rec.recordDate)}</strong></span>
        <span style="font-weight: 700; font-size:15px; color: var(--text-primary);">Toplam Ücret: ${formatMoney(rec.totalAmount)}</span>
      </div>

      <div class="card-details-collapse" id="service-details-${rec.id}">
        <div style="margin-top: 12px; border-top: 1px dashed var(--border-color); padding-top: 12px; display: flex; flex-direction: column; gap: 10px;">
          
          <!-- Araç ve Müşteri Künye Bilgileri -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; background: var(--bg-subtle); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); font-size: 12px;">
            <div><strong>Müşteri:</strong> ${customerName}</div>
            ${customerPhone ? html`<div><strong>Telefon:</strong> <a href="tel:${customerPhone}" style="color: var(--text-primary); font-weight: 600;">${customerPhone}</a></div>` : ''}
            <div><strong>Araç Plakası:</strong> <span class="only-card-badge" style="font-size: 11px;">${vehicle.plate}</span></div>
            <div><strong>Marka / Model:</strong> ${vehicle.brand} ${vehicle.model}</div>
            <div><strong>Giriş KM:</strong> ${formatNumber(rec.entryKm)} KM</div>
            <div><strong>Şasi No (VIN):</strong> ${vehicle.chassisNo || "Belirtilmedi"}</div>
          </div>

          <!-- Yapılan Usta İşlemleri Listesi -->
          <div>
            <div style="font-weight: 700; font-size: 13px; color: var(--text-primary); margin-bottom: 8px;">Yapılan İşlemler ve Usta Notları:</div>
            ${techDetailHtml}
          </div>

          <!-- Genel İşlem Özeti -->
          ${rec.generalSummary ? html`
          <div class="service-log-summary" style="padding: 10px 12px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;">
            <strong style="color: var(--text-primary);">Genel İşlem Özeti & Not:</strong>
            <div style="margin-top: 4px; color: var(--text-secondary); line-height: 1.5;">${rec.generalSummary}</div>
          </div>` : ""}

        </div>
      </div>

      <div class="service-log-footer" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-muted); display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px;">
        ${customerPhone ? html`<a href="tel:${customerPhone}" class="btn btn-call btn-mini" title="Müşteriyi Ara">Ara</a>` : ""}
        ${receiptMailButton(rec)}
        <button class="btn btn-secondary btn-mini" onclick="editServiceRecord('${rec.id}')">Düzenle</button>
        ${canDelete() ? html`<button class="btn btn-danger btn-mini" onclick="triggerDeleteServiceRecord('${rec.id}')">Sil</button>` : ""}
        <button class="btn btn-info btn-mini btn-toggle-details" onclick="toggleCardDetails('service', '${rec.id}', this)">Daha Fazla</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ==========================================================================
// MÜŞTERİ CANLI ARAMA (COMBOBOX) MANTIGI
// ==========================================================================
function handleCustomerComboboxSearch(query, hiddenInputId, panelId, inputId, clearBtnId, badgeId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const q = String(query || "").trim().toLowerCase();
  
  // Arama sonuçlarını filtrele
  const matches = state.customers.filter(c => {
    if (!q) return true;
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const phone = String(c.phone || "").toLowerCase();
    const ref = String(c.reference || "").toLowerCase();
    return fullName.includes(q) || phone.includes(q) || ref.includes(q);
  });

  panel.innerHTML = "";

  if (matches.length === 0) {
    panel.innerHTML = html`
      <div class="combobox-result-item" style="cursor: default; text-align: center; color: var(--text-secondary); padding: 12px;">
        <div style="font-size: 13px;">Kayıtlı müşteri bulunamadı.</div>
        <button type="button" class="btn btn-secondary btn-mini" style="margin-top: 6px; width: 100%; font-weight: 600;">
          + "${q}" İle Yeni Müşteri Ekle
        </button>
      </div>
    `;
    // Arama metni satır içi onclick'e gömülmez (betik enjeksiyonunu önler)
    panel.querySelector("button").addEventListener("click", () => openNewCustomerModalWithQuery(q));
  } else {
    // İlk 15 sonucu göster
    matches.slice(0, 15).forEach(c => {
      const item = document.createElement("div");
      item.className = "combobox-result-item";
      item.innerHTML = html`
        <div class="combobox-result-name">
          <span>👤 ${c.firstName} ${c.lastName}</span>
          <span class="combobox-result-phone">${c.phone}</span>
        </div>
        ${c.reference ? html`<div class="combobox-result-meta">Referans: ${c.reference}</div>` : ""}
      `;
      item.onclick = (e) => {
        e.stopPropagation();
        selectCustomerComboboxItem(c, hiddenInputId, inputId, clearBtnId, badgeId, panelId);
      };
      panel.appendChild(item);
    });
  }

  panel.classList.remove("hidden");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function handleVehicleComboboxSearch(query) {
  const panel = document.getElementById("s_vehicleDropdownResults");
  if (!panel) return;

  const normalizedQuery = normalizeSearchText(query).trim();
  const matches = state.vehicles.filter(vehicle => {
    const owner = state.customers.find(customer => customer.id === vehicle.customerId);
    const searchableText = [
      vehicle.plate,
      vehicle.brand,
      vehicle.model,
      vehicle.chassisNo,
      owner ? `${owner.firstName} ${owner.lastName}` : "",
      owner ? owner.phone : ""
    ].map(normalizeSearchText).join(" ");
    return !normalizedQuery || searchableText.includes(normalizedQuery);
  });

  panel.innerHTML = "";
  if (matches.length === 0) {
    panel.innerHTML = `<div class="combobox-result-item" style="cursor: default; text-align: center; color: var(--text-secondary);">Arama kriterine uygun araç bulunamadı.</div>`;
  } else {
    matches.slice(0, 20).forEach(vehicle => {
      const owner = state.customers.find(customer => customer.id === vehicle.customerId);
      const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Bilinmeyen müşteri";
      const item = document.createElement("div");
      item.className = "combobox-result-item";
      item.innerHTML = html`
        <div class="combobox-result-name">
          <span>${vehicle.plate}</span>
          <span class="combobox-result-phone">${vehicle.brand} ${vehicle.model}</span>
        </div>
        <div class="combobox-result-meta">Sahibi: ${ownerName}</div>
      `;
      item.onclick = (event) => {
        event.stopPropagation();
        selectVehicleComboboxItem(vehicle);
      };
      panel.appendChild(item);
    });
  }
  panel.classList.remove("hidden");
}

function selectVehicleComboboxItem(vehicle) {
  const hiddenInput = document.getElementById("s_vehicleId");
  const input = document.getElementById("s_vehicleSearchInput");
  const clearButton = document.getElementById("s_vehicleClearBtn");
  const badge = document.getElementById("s_vehicleSelectedBadge");
  const panel = document.getElementById("s_vehicleDropdownResults");
  const owner = state.customers.find(customer => customer.id === vehicle.customerId);
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Bilinmeyen müşteri";

  if (hiddenInput) hiddenInput.value = vehicle.id;
  if (input) input.value = `${vehicle.plate} - ${vehicle.brand} ${vehicle.model}`;
  if (clearButton) clearButton.classList.remove("hidden");
  if (badge) {
    badge.innerHTML = html`<span>Seçili Araç: <strong>${vehicle.plate}</strong> - ${vehicle.brand} ${vehicle.model} (${ownerName})</span>`;
    badge.classList.remove("hidden");
  }
  if (panel) panel.classList.add("hidden");
  handleServiceVehicleSelect(vehicle.id);
}

function clearVehicleCombobox() {
  const hiddenInput = document.getElementById("s_vehicleId");
  const input = document.getElementById("s_vehicleSearchInput");
  const clearButton = document.getElementById("s_vehicleClearBtn");
  const badge = document.getElementById("s_vehicleSelectedBadge");

  if (hiddenInput) hiddenInput.value = "";
  if (input) {
    input.value = "";
    input.focus();
  }
  if (clearButton) clearButton.classList.add("hidden");
  if (badge) {
    badge.innerHTML = "";
    badge.classList.add("hidden");
  }
  handleServiceVehicleSelect("");
}

function selectCustomerComboboxItem(customer, hiddenInputId, inputId, clearBtnId, badgeId, panelId) {
  const hiddenInput = document.getElementById(hiddenInputId);
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);
  const badge = document.getElementById(badgeId);
  const panel = document.getElementById(panelId);

  if (hiddenInput) hiddenInput.value = customer.id;
  if (input) input.value = `${customer.firstName} ${customer.lastName}`;
  if (clearBtn) clearBtn.classList.remove("hidden");
  
  if (badge) {
    badge.innerHTML = html`
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success);"><polyline points="20 6 9 17 4 12"/></svg>
      <span>Seçili Müşteri: <strong>${customer.firstName} ${customer.lastName}</strong> (${customer.phone})</span>
    `;
    badge.classList.remove("hidden");
  }

  if (panel) panel.classList.add("hidden");
}

function clearCustomerCombobox(hiddenInputId, inputId, clearBtnId, badgeId) {
  const hiddenInput = document.getElementById(hiddenInputId);
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearBtnId);
  const badge = document.getElementById(badgeId);

  if (hiddenInput) hiddenInput.value = "";
  if (input) {
    input.value = "";
    input.focus();
  }
  if (clearBtn) clearBtn.classList.add("hidden");
  if (badge) {
    badge.innerHTML = "";
    badge.classList.add("hidden");
  }
}

function openNewCustomerModalWithQuery(nameQuery) {
  openNewCustomerModal();
  if (nameQuery) {
    const parts = nameQuery.trim().split(/\s+/);
    const lastName = parts.length > 1 ? parts.pop() : "";
    const firstName = parts.join(" ");
    
    const fInput = document.getElementById("c_firstName");
    const lInput = document.getElementById("c_lastName");
    if (fInput) fInput.value = firstName || nameQuery;
    if (lInput) lInput.value = lastName;
  }
}

// ==========================================================================
// MODAL PENCERE YÖNETİMLERİ (YENİ MÜŞTERİ & ARAÇ POPUP)
// ==========================================================================
function openNewCustomerModal() {
  const modal = document.getElementById("newCustomerModal");
  if (modal) {
    const form = document.getElementById("newCustomerModalForm");
    if (form) form.reset();
    modal.classList.remove("hidden");
  }
}

function closeNewCustomerModal() {
  const modal = document.getElementById("newCustomerModal");
  if (modal) modal.classList.add("hidden");
}

function openNewVehicleModal() {
  const modal = document.getElementById("newVehicleModal");
  if (modal) {
    const form = document.getElementById("newVehicleModalForm");
    if (form) form.reset();
    
    const dateEl = document.getElementById("v_entryDate");
    if (dateEl) dateEl.value = todayIso();

    clearCustomerCombobox('v_customerId', 'v_customerSearchInput', 'v_customerClearBtn', 'v_customerSelectedBadge');

    modal.classList.remove("hidden");
  }
}

function closeNewVehicleModal() {
  const modal = document.getElementById("newVehicleModal");
  if (modal) modal.classList.add("hidden");
}

async function handleCustomerSubmit(e) {
  e.preventDefault();
  
  const payload = {
    firstName: document.getElementById("c_firstName").value.trim(),
    lastName: document.getElementById("c_lastName").value.trim(),
    phone: document.getElementById("c_phone").value.trim(),
    email: document.getElementById("c_email").value.trim().toLowerCase(),
    reference: document.getElementById("c_reference").value.trim(),
    notes: document.getElementById("c_notes").value.trim()
  };
  if (payload.email && !EMAIL_RE.test(payload.email)) {
    showToast("Geçerli bir e-posta adresi girin veya alanı boş bırakın.", "warning");
    document.getElementById("c_email").focus();
    return;
  }

  const btn = document.getElementById("btnSaveCustomer");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Kaydediliyor...";
  }

  const success = await sendRequest("addCustomer", payload);
  
  if (success) {
    const form1 = document.getElementById("customerForm");
    const form2 = document.getElementById("newCustomerModalForm");
    if (form1) form1.reset();
    if (form2) form2.reset();
    
    closeNewCustomerModal();
    showToast("✓ Müşteri kaydı başarıyla oluşturuldu.", "success");
    
    // Araç ekleme modalı açıksa yeni eklenen müşteriyi otomatik seç
    const lastCustomer = state.customers.find(c => c.id === success.id) || state.customers[state.customers.length - 1];
    if (lastCustomer) {
      selectCustomerComboboxItem(lastCustomer, 'v_customerId', 'v_customerSearchInput', 'v_customerClearBtn', 'v_customerSelectedBadge', 'v_customerDropdownResults');
    }
  }
  
  if (btn) {
    btn.disabled = false;
    btn.textContent = "✓ Müşteriyi Kaydet";
  }
}

async function handleVehicleSubmit(e) {
  e.preventDefault();

  const brandSelect = document.getElementById("v_brand_select");
  const customBrandInput = document.getElementById("v_custom_brand");
  let brandValue = "";
  if (brandSelect) {
    if (brandSelect.value === "OTHER_CUSTOM") {
      brandValue = customBrandInput ? customBrandInput.value.trim() : "";
    } else {
      brandValue = brandSelect.value;
    }
  }

  if (!brandValue) {
    showToast("Lütfen araç markasını seçin veya yazın.", "warning");
    return;
  }

  const payload = {
    customerId: document.getElementById("v_customerId").value,
    brand: brandValue,
    model: document.getElementById("v_model").value.trim(),
    plate: document.getElementById("v_plate").value.trim().replace(/\s+/g, ""),
    chassisNo: document.getElementById("v_chassis").value.trim(),
    entryDate: document.getElementById("v_entryDate").value,
    notes: document.getElementById("v_notes").value.trim()
  };

  const btn = document.getElementById("btnSaveVehicle");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Kaydediliyor...";
  }

  const success = await sendRequest("addVehicle", payload);

  if (success) {
    const form1 = document.getElementById("vehicleForm");
    const form2 = document.getElementById("newVehicleModalForm");
    if (form1) form1.reset();
    if (form2) form2.reset();
    
    closeNewVehicleModal();
    showToast("✓ Araç kaydı başarıyla oluşturuldu.", "success");
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = "✓ Aracı Kaydet";
  }
}

async function triggerDeleteServiceRecord(id) {
  const rec = state.serviceRecords.find(r => r.id === id);
  if (!rec) return;
  const vehicle = state.vehicles.find(v => v.id === rec.vehicleId);
  const plateText = vehicle ? vehicle.plate : "Servis";
  
  const confirmDelete = confirm(`${plateText} plakalı araca ait bu servis kaydını silmek istediğinize emin misiniz?`);
  if (confirmDelete) {
    const success = await sendRequest("deleteServiceRecord", { id: id });
    if (success) {
      showToast("✓ Servis kaydı başarıyla silindi.", "info");
    }
  }
}

// ==========================================================================
// SERVİS İŞLEMLERİ FORM VE MANTIK YÖNETİMİ
// ==========================================================================

function goToServiceStep(step) {
  [1, 2, 3].forEach(s => {
    const sec = document.getElementById(`serviceStep${s}`);
    const ind = document.getElementById(`stepIndicator${s}`);
    if (sec) {
      if (s === step) {
        sec.classList.remove("hidden");
        if (ind) {
          ind.classList.add("active");
          ind.classList.remove("completed");
        }
      } else {
        sec.classList.add("hidden");
        if (ind) {
          ind.classList.remove("active");
          if (s < step) ind.classList.add("completed");
          else ind.classList.remove("completed");
        }
      }
    }
  });
}

function handleServiceVehicleSelect(vehicleId) {
  const card = document.getElementById("selectedVehicleSummaryCard");
  const plateEl = document.getElementById("svPlateText");
  const brandEl = document.getElementById("svBrandText");
  const ownerEl = document.getElementById("svOwnerText");

  if (!vehicleId) {
    if (card) card.classList.add("hidden");
    return;
  }

  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (vehicle) {
    const owner = state.customers.find(c => c.id === vehicle.customerId);
    const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Bilinmeyen Müşteri";
    
    if (plateEl) plateEl.textContent = vehicle.plate;
    if (brandEl) brandEl.textContent = `${vehicle.brand} ${vehicle.model}`;
    if (ownerEl) ownerEl.textContent = `Sahibi: ${ownerName}`;
    if (card) card.classList.remove("hidden");
  }
}

// Dinamik usta onay kutularını ekleme (Kategorize Çip Tasarımı)
function renderMechanicCheckboxes() {
  const container = document.getElementById("mechanicsCheckboxes");
  if (!container) return;
  
  container.innerHTML = "";
  TECHNICIAN_CATEGORIES.forEach(cat => {
    const catBlock = document.createElement("div");
    catBlock.className = "tech-category-block";

    let chipsHtml = "";
    cat.items.forEach(techId => {
      const tech = TECHNICIANS.find(t => t.id === techId);
      if (!tech) return;

      chipsHtml += `
        <div class="tech-chip" id="chip-${tech.id}" onclick="toggleTechFields('${tech.id}')">
          <span class="tech-chip-check">&check;</span>
          ${tech.label}
        </div>
      `;
    });

    catBlock.innerHTML = `
      <div class="tech-category-title">
        ${cat.icon}
        ${cat.name}
      </div>
      <div class="tech-chips-grid">
        ${chipsHtml}
      </div>
    `;

    container.appendChild(catBlock);
  });
}

// Dinamik usta giriş panellerini oluşturma
function initMechanicBoxes() {
  const container = document.getElementById("dynamicMechanicBoxes");
  if (!container) return;
  
  container.innerHTML = "";
  TECHNICIANS.forEach(tech => {
    const box = document.createElement("div");
    box.id = `box-${tech.id}`;
    box.className = "dynamic-mechanic-box hidden";
    box.innerHTML = `
      <div class="mechanic-box-header">${tech.title}</div>
      <div class="form-group">
        <label class="form-label" for="s_${tech.id}Fee">${tech.label} İşlem Ücreti (<span data-currency-symbol>${currencySymbol()}</span>) *</label>
        <input type="number" id="s_${tech.id}Fee" class="form-control" placeholder="0" min="0" oninput="calculateTotalFee()">
      </div>
      <div class="form-group">
        <label class="form-label" for="s_${tech.id}Note">${tech.label} İşlem Notu</label>
        <textarea id="s_${tech.id}Note" class="form-control" placeholder="Yapılan detaylı işlemleri ve yedek parça bilgisini yazın..."></textarea>
      </div>
    `;
    container.appendChild(box);
  });
}

function toggleTechFields(techId) {
  const tech = TECHNICIANS.find(t => t.id === techId);
  if (!tech) return;
  
  const chip = document.getElementById(`chip-${techId}`);
  const box = document.getElementById(`box-${techId}`);
  const feeInput = document.getElementById(`s_${techId}Fee`);
  const noteInput = document.getElementById(`s_${techId}Note`);

  const isActive = chip ? chip.classList.contains("active") : false;
  
  if (!isActive) {
    if (chip) chip.classList.add("active");
    if (box) box.classList.remove("hidden");
    if (feeInput) feeInput.required = true;
  } else {
    if (chip) chip.classList.remove("active");
    if (box) box.classList.add("hidden");
    if (feeInput) {
      feeInput.required = false;
      feeInput.value = "";
    }
    if (noteInput) noteInput.value = "";
  }
  calculateTotalFee();
}

function formatCurrency(val) {
  return formatMoney(val);
}

function calculateTotalFee() {
  let laborTotal = 0;
  TECHNICIANS.forEach(tech => {
    const feeInput = document.getElementById(`s_${tech.id}Fee`);
    if (feeInput) {
      const val = parseFloat(feeInput.value) || 0;
      laborTotal += val;
    }
  });

  const totalInput = document.getElementById("s_totalFee");
  if (totalInput) totalInput.value = laborTotal;

  const laborDisp = document.getElementById("feeLaborTotal");
  if (laborDisp) laborDisp.textContent = formatCurrency(laborTotal);

  const grandDisp = document.getElementById("feeGrandTotalDisplay");
  if (grandDisp) grandDisp.textContent = formatCurrency(laborTotal);
  calculateRemainingAmount();
}

function handlePaymentStatusChange() {
  const isPartial = document.getElementById("s_paymentStatus").value === "Kısmi Ödendi";
  const fields = document.getElementById("partialPaymentFields");
  const paidInput = document.getElementById("s_paidAmount");
  if (fields) fields.classList.toggle("hidden", !isPartial);
  if (paidInput) paidInput.required = isPartial;
  if (isPartial) calculateRemainingAmount();
}

function calculateRemainingAmount() {
  const total = parseFloat(document.getElementById("s_totalFee")?.value) || 0;
  const paidInput = document.getElementById("s_paidAmount");
  const remainingInput = document.getElementById("s_remainingAmount");
  if (!paidInput || !remainingInput) return;
  const paid = Math.min(Math.max(parseFloat(paidInput.value) || 0, 0), total);
  remainingInput.value = Math.max(total - paid, 0).toFixed(2);
}

// Araç detaylarından hızlıca servis açma
function quickCreateServiceRecord(vehicleId) {
  switchView("services");
  resetServiceForm();
  const vehicle = state.vehicles.find(item => item.id === vehicleId);
  if (vehicle) selectVehicleComboboxItem(vehicle);
  handleServiceVehicleSelect(vehicleId);
  goToServiceStep(1);
}

// Kayıtlı Servis Notunu Düzenlemek / Düzenleme Modu
function editServiceRecord(recordId) {
  const rec = state.serviceRecords.find(r => r.id === recordId);
  if (!rec) return;

  switchView("services");

  document.getElementById("serviceFormTitle").textContent = "Servis Kaydını Güncelle";
  document.getElementById("btnSaveService").textContent = "✓ Kaydı Güncelle";
  
  document.getElementById("s_recordId").value = rec.id;
  const recordVehicle = state.vehicles.find(vehicle => vehicle.id === rec.vehicleId);
  if (recordVehicle) selectVehicleComboboxItem(recordVehicle);
  handleServiceVehicleSelect(rec.vehicleId);

  document.getElementById("s_km").value = rec.entryKm;
  document.getElementById("s_date").value = toIsoDate(rec.recordDate);
  
  // Tüm ustalar için alanları doldur
  TECHNICIANS.forEach(tech => {
    const feeVal = rec[tech.feeKey];
    const noteVal = rec[tech.noteKey];
    
    const chip = document.getElementById(`chip-${tech.id}`);
    const box = document.getElementById(`box-${tech.id}`);
    const feeInput = document.getElementById(`s_${tech.id}Fee`);
    const noteInput = document.getElementById(`s_${tech.id}Note`);
    
    if (parseFloat(feeVal) > 0 || noteVal) {
      if (chip) chip.classList.add("active");
      if (box) box.classList.remove("hidden");
      if (feeInput) {
        feeInput.value = feeVal || "";
        feeInput.required = true;
      }
      if (noteInput) noteInput.value = noteVal || "";
    } else {
      if (chip) chip.classList.remove("active");
      if (box) box.classList.add("hidden");
      if (feeInput) {
        feeInput.value = "";
        feeInput.required = false;
      }
      if (noteInput) noteInput.value = "";
    }
  });
  
  document.getElementById("s_summary").value = rec.generalSummary || "";
  document.getElementById("s_paymentStatus").value = rec.paymentStatus === "Ödendi" ? "Nakit Ödendi" : rec.paymentStatus;
  document.getElementById("s_paidAmount").value = rec.paidAmount !== undefined ? rec.paidAmount : (rec.paymentStatus === "Kısmi Ödendi" ? (parseFloat(rec.totalAmount) || 0) * 0.5 : "");
  document.getElementById("s_remainingAmount").value = rec.remainingAmount !== undefined ? rec.remainingAmount : (rec.paymentStatus === "Kısmi Ödendi" ? (parseFloat(rec.totalAmount) || 0) * 0.5 : "");
  handlePaymentStatusChange();
  calculateTotalFee();

  goToServiceStep(1);
}

function resetServiceForm() {
  document.getElementById("serviceForm").reset();
  document.getElementById("s_recordId").value = "";
  clearVehicleCombobox();
  document.getElementById("s_paidAmount").value = "";
  document.getElementById("s_remainingAmount").value = "";
  document.getElementById("s_date").value = todayIso();
  document.getElementById("serviceFormTitle").textContent = "Yeni Servis Kaydı";
  document.getElementById("btnSaveService").textContent = "✓ Servis Kaydını Tamamla";
  
  const svCard = document.getElementById("selectedVehicleSummaryCard");
  if (svCard) svCard.classList.add("hidden");

  TECHNICIANS.forEach(tech => {
    const box = document.getElementById(`box-${tech.id}`);
    const chip = document.getElementById(`chip-${tech.id}`);
    if (box) box.classList.add("hidden");
    if (chip) chip.classList.remove("active");
  });

  calculateTotalFee();
  handlePaymentStatusChange();
  goToServiceStep(1);
}

async function handleServiceSubmit(e) {
  e.preventDefault();
  
  const recordId = document.getElementById("s_recordId").value;
  const vehicleId = document.getElementById("s_vehicleId").value;
  
  if (!vehicleId) {
    showToast("Lütfen servise giren bir araç seçin.", "warning");
    goToServiceStep(1);
    return;
  }

  const payload = {
    vehicleId: vehicleId,
    entryKm: document.getElementById("s_km").value,
    recordDate: document.getElementById("s_date").value,
    generalSummary: document.getElementById("s_summary").value.trim(),
    paymentStatus: document.getElementById("s_paymentStatus").value,
    totalAmount: parseFloat(document.getElementById("s_totalFee").value) || 0,
    paidAmount: document.getElementById("s_paymentStatus").value === "Kısmi Ödendi" ? parseFloat(document.getElementById("s_paidAmount").value) || 0 : 0,
    remainingAmount: document.getElementById("s_paymentStatus").value === "Kısmi Ödendi" ? parseFloat(document.getElementById("s_remainingAmount").value) || 0 : 0
  };

  TECHNICIANS.forEach(tech => {
    const feeInput = document.getElementById(`s_${tech.id}Fee`);
    const noteInput = document.getElementById(`s_${tech.id}Note`);
    
    payload[tech.feeKey] = feeInput ? (parseFloat(feeInput.value) || 0) : 0;
    payload[tech.noteKey] = noteInput ? noteInput.value.trim() : "";
  });

  const btn = document.getElementById("btnSaveService");
  btn.disabled = true;
  btn.textContent = "Kaydediliyor...";

  let success = false;
  
  if (recordId) {
    payload.id = recordId;
    success = await sendRequest("updateServiceRecord", payload);
  } else {
    success = await sendRequest("addServiceRecord", payload);
  }

  if (success) {
    resetServiceForm();
    showToast(recordId ? "✓ Servis kaydı başarıyla güncellendi." : "✓ Servis kaydı başarıyla oluşturuldu.", "success");
    switchView("services-log");
  }

  btn.disabled = false;
  btn.textContent = recordId ? "✓ Kaydı Güncelle" : "✓ Servis Kaydını Tamamla";
}

// ==========================================================================
// GELİŞMİŞ GLOBAL ARAMA (SEARCH ENGINE)
// ==========================================================================
function handleGlobalSearch() {
  const query = normalizeSearchText(document.getElementById("globalSearch").value).trim();
  const panel = document.getElementById("searchResultsPanel");

  if (!query) {
    closeSearchResults();
    return;
  }

  panel.innerHTML = "";
  let resultsFound = false;

  // Kategori 1: Sayfa Geçişleri
  const pages = [
    { title: "Ana Sayfa (Panel)", view: "dashboard", keywords: ["anasayfa", "dashboard", "grafik", "borç", "gelir", "panel"] },
    { title: "Müşteri & Araç Kayıt", view: "customers", keywords: ["müşteri", "araç", "plaka", "tel", "telefon", "kayıt"] },
    { title: "Müşteriler (Liste)", view: "only-customers", keywords: ["müşteri", "müşteriler", "liste", "rehber", "telefon", "isim"] },
    { title: "Araçlar (Liste)", view: "only-vehicles", keywords: ["araç", "araçlar", "plaka", "plakalar", "liste", "sadece"] },
    { title: "Tarihler (Takvim)", view: "calendar", keywords: ["takvim", "tarih", "tarihler", "günler", "araç girişler", "plan", "giriş"] },
    { title: "Servis Girişi (Ekle)", view: "services", keywords: ["yeni servis", "servis ekle", "servis girişi", "işlem girişi", "usta", "tamir"] },
    { title: "Servis Notları (Geçmiş)", view: "services-log", keywords: ["servis", "servis geçmişi", "servis notları", "servis günlüğü", "fatura", "ücret"] },
    { title: "Borç Listesi (Ödemeler)", view: "debts", keywords: ["borç", "alacak", "ödeme", "ödenmeyenler", "kısmi ödenenler", "muhasebe", "tahsilat"] },
    { title: "İşletme Ayarları", view: "settings", keywords: ["ayar", "ayarlar", "işletme", "logo", "ekip", "kullanıcı", "davet", "abonelik", "şifre", "para birimi"] }
  ];
  
  const matchedPages = pages.filter(p => 
    normalizeSearchText(p.title).includes(query) || p.keywords.some(k => normalizeSearchText(k).includes(query))
  );

  if (matchedPages.length > 0) {
    resultsFound = true;
    appendSearchCategoryHeader("SİSTEM SAYFALARI");
    matchedPages.forEach(p => {
      appendSearchResultItem(p.title, "Uygulama Sayfası", "SAYFA", () => {
        switchView(p.view);
        closeSearchResults();
        document.getElementById("globalSearch").value = "";
      });
    });
  }

  // Kategori 2: Müşteriler
  const matchedCustomers = state.customers.filter(c => 
    normalizeSearchText(`${c.firstName} ${c.lastName} ${c.phone} ${c.reference}`).includes(query)
  );

  if (matchedCustomers.length > 0) {
    resultsFound = true;
    appendSearchCategoryHeader("MÜŞTERİLER");
    matchedCustomers.forEach(c => {
      appendSearchResultItem(`${c.firstName} ${c.lastName}`, `Telefon: ${c.phone}`, "MÜŞTERİ", () => {
        switchView("only-customers");
        
        // Müşteri kartını bul ve parlat
        setTimeout(() => {
          const card = document.getElementById(`only-cust-card-${c.id}`);
          if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.borderColor = "var(--accent)";
            setTimeout(() => card.style.borderColor = "", 2000);
          }
        }, 150);
        
        closeSearchResults();
        document.getElementById("globalSearch").value = "";
      });
    });
  }

  // Kategori 3: Araçlar & Plakalar
  const matchedVehicles = state.vehicles.filter(v => {
    const owner = state.customers.find(c => c.id === v.customerId);
    return normalizeSearchText(`${v.plate} ${v.brand} ${v.model} ${v.chassisNo} ${owner ? `${owner.firstName} ${owner.lastName} ${owner.phone}` : ""}`).includes(query);
  }
  );

  if (matchedVehicles.length > 0) {
    resultsFound = true;
    appendSearchCategoryHeader("ARAÇLAR & PLAKALAR");
    matchedVehicles.forEach(v => {
      const owner = state.customers.find(c => c.id === v.customerId);
      const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Bilinmiyor";
      
      appendSearchResultItem(`${v.plate} - ${v.brand} ${v.model}`, `Sahibi: ${ownerName}`, "ARAÇ", () => {
        switchView("only-vehicles");
        
        // Araç kartını bul ve parlat
        setTimeout(() => {
          const card = document.getElementById(`only-veh-card-${v.id}`);
          if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.borderColor = "var(--accent)";
            setTimeout(() => card.style.borderColor = "", 2000);
          }
        }, 150);

        closeSearchResults();
        document.getElementById("globalSearch").value = "";
      });
    });
  }

  // Kategori 4: Servis Kayıtları
  const matchedRecords = state.serviceRecords.filter(rec => {
    // İlgili plakayı kontrol et
    const vehicle = state.vehicles.find(v => v.id === rec.vehicleId);
    const plateMatches = vehicle ? vehicle.plate.toLowerCase().includes(query) : false;
    
    const owner = vehicle ? state.customers.find(c => c.id === vehicle.customerId) : null;
    const searchableRecord = [
      vehicle ? `${vehicle.plate} ${vehicle.brand} ${vehicle.model} ${vehicle.chassisNo}` : "",
      owner ? `${owner.firstName} ${owner.lastName} ${owner.phone}` : "",
      rec.id,
      rec.recordDate,
      rec.paymentStatus,
      rec.generalSummary,
      ...TECHNICIANS.map(tech => rec[tech.noteKey])
    ].map(normalizeSearchText).join(" ");
    return plateMatches || searchableRecord.includes(query);
  });

  if (matchedRecords.length > 0) {
    resultsFound = true;
    appendSearchCategoryHeader("SERVİS KAYITLARI");
    matchedRecords.forEach(rec => {
      const vehicle = state.vehicles.find(v => v.id === rec.vehicleId);
      const plate = vehicle ? vehicle.plate : "Plakasız";
      const desc = rec.generalSummary || rec.mechanicNote || "Detay belirtilmemiş.";
      
      appendSearchResultItem(`${plate} - ${formatDate(rec.recordDate)}`, desc, "SERVİS", () => {
        editServiceRecord(rec.id);
        closeSearchResults();
        document.getElementById("globalSearch").value = "";
      });
    });
  }

  if (!resultsFound) {
    panel.innerHTML = html`<div class="search-no-results">"${query}" ile eşleşen sonuç bulunamadı.</div>`;
  }

  panel.classList.add("active");
}

function appendSearchCategoryHeader(title) {
  const panel = document.getElementById("searchResultsPanel");
  const header = document.createElement("div");
  header.className = "search-category-title";
  header.textContent = title;
  panel.appendChild(header);
}

function appendSearchResultItem(title, subtitle, badgeText, clickCallback) {
  const panel = document.getElementById("searchResultsPanel");
  const item = document.createElement("div");
  item.className = "search-item";
  item.onclick = clickCallback;
  
  item.innerHTML = html`
    <div>
      <div class="search-item-title">${title}</div>
      <div class="search-item-subtitle">${subtitle}</div>
    </div>
    <span class="search-item-badge">${badgeText}</span>
  `;
  panel.appendChild(item);
}

function closeSearchResults() {
  const panel = document.getElementById("searchResultsPanel");
  panel.classList.remove("active");
}

// ==========================================================================
// DİĞER YARDIMCI FONKSİYONLAR (HELPERS)
// ==========================================================================
function formatDate(dateStr) {
  return formatDisplayDate(dateStr);
}

function triggerCall() {
  const phone = document.getElementById("c_phone").value.trim();
  if (!phone) {
    alert("Lütfen önce aranacak telefon numarasını girin.");
    return;
  }
  window.location.href = `tel:${phone}`;
}

// Mobil görünümde form gösterme / gizleme
function toggleMobileForm(type) {
  const customerCard = document.getElementById("customerFormCard");
  const vehicleCard = document.getElementById("vehicleFormCard");
  const customerBtn = document.getElementById("toggleCustomerFormBtn");
  const vehicleBtn = document.getElementById("toggleVehicleFormBtn");

  if (type === 'customer') {
    const isAct = customerCard.classList.toggle("active");
    if (isAct) {
      vehicleCard.classList.remove("active");
      vehicleBtn.classList.remove("btn-accent");
      customerBtn.classList.add("btn-accent");
    } else {
      customerBtn.classList.remove("btn-accent");
    }
  } else if (type === 'vehicle') {
    const isAct = vehicleCard.classList.toggle("active");
    if (isAct) {
      customerCard.classList.remove("active");
      customerBtn.classList.remove("btn-accent");
      vehicleBtn.classList.add("btn-accent");
    } else {
      vehicleBtn.classList.remove("btn-accent");
    }
  }
}

function renderRegPageList() {
  const container = document.getElementById("regPageContainer");
  if (!container) return;
  container.innerHTML = "";
  
  if (state.customers.length === 0) {
    container.innerHTML = `<div class="search-no-results" style="grid-column: 1 / -1; color: var(--text-secondary);">Sistemde kayıtlı müşteri veya araç bulunmuyor.</div>`;
    return;
  }
  
  const sorted = [...state.customers].sort((a, b) => 
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, "tr")
  );
  
  sorted.forEach(c => {
    const custVehicles = state.vehicles.filter(v => v.customerId === c.id);
    const vehiclesHtml = [];
    if (custVehicles.length > 0) {
      custVehicles.forEach(v => {
        vehiclesHtml.push(html`<span class="only-card-vehicle-tag" onclick="switchView('only-vehicles'); setTimeout(() => {
          const card = document.getElementById('only-veh-card-${v.id}');
          if(card) {
            card.scrollIntoView({behavior: 'smooth', block: 'center'});
            card.style.borderColor = 'var(--accent)';
            setTimeout(() => card.style.borderColor = '', 2000);
          }
        }, 150)">🚘 ${v.plate} - ${v.brand} ${v.model}</span>`);
      });
    } else {
      vehiclesHtml.push(html`<span style="font-size: 11px; color: var(--text-muted);">Kayıtlı araç yok</span>`);
    }

    const card = document.createElement("div");
    card.className = "only-card";
    card.innerHTML = html`
      <div>
        <div class="only-card-header">
          <div class="only-card-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            ${c.firstName} ${c.lastName}
          </div>
          ${c.reference ? html`<span class="only-card-badge">Ref: ${c.reference}</span>` : ""}
        </div>
        <div class="only-card-body">
          <div class="only-card-row">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <strong>Telefon:</strong>&nbsp;<a href="tel:${c.phone}" style="color: var(--text-primary); font-weight: 600;">${c.phone}</a>
          </div>
          ${c.notes ? html`<div class="only-card-row" style="font-size: 12px; color: var(--text-secondary);"><strong>Not:</strong> ${c.notes}</div>` : ""}
          <div class="only-card-vehicles">
            <div style="font-weight: 600; margin-bottom: 6px; font-size: 11px; color: var(--text-secondary);">Kayıtlı Araçları (${custVehicles.length}):</div>
            <div>${vehiclesHtml}</div>
          </div>
        </div>
      </div>
      <div class="only-card-footer">
        <a href="tel:${c.phone}" class="btn btn-call btn-mini">Ara</a>
        <button type="button" class="btn btn-accent btn-mini" onclick="showCustomerHistory('${c.id}')">Geçmiş</button>
        ${customerMailButton(c)}
        <button type="button" class="btn btn-secondary btn-mini" onclick="openCustomerEditModal('${c.id}')">Düzenle</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function filterRegPageList() {
  const q = document.getElementById("regPageSearch").value.toLowerCase();
  document.querySelectorAll("#regPageContainer .only-card").forEach(card => {
    if (card.textContent.toLowerCase().includes(q)) {
      card.style.setProperty("display", "flex", "important");
    } else {
      card.style.setProperty("display", "none", "important");
    }
  });
}

// ==========================================================================
// MÜŞTERİLER SAYFASI RENDER VE MANTIK
// ==========================================================================
function renderOnlyCustomers() {
  const container = document.getElementById("onlyCustomersContainer");
  if (!container) return;
  container.innerHTML = "";
  
  if (state.customers.length === 0) {
    container.innerHTML = `<div class="search-no-results" style="grid-column: 1 / -1; color: var(--text-secondary);">Sistemde kayıtlı müşteri bulunmuyor.</div>`;
    return;
  }
  
  // Alfabeye göre sırala
  const sorted = [...state.customers].sort((a, b) => 
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, "tr")
  );
  
  sorted.forEach(c => {
    // Müşteriye ait araçları bul
    const custVehicles = state.vehicles.filter(v => v.customerId === c.id);
    
    // Müşterinin servis işlemlerini ve toplam borcunu hesapla
    const custVehicleIds = custVehicles.map(v => v.id);
    const custServices = state.serviceRecords.filter(s => custVehicleIds.includes(s.vehicleId));
    let custDebtTotal = 0;
    custServices.forEach(s => {
      if (s.paymentStatus === "Ödenmedi") custDebtTotal += parseFloat(s.totalAmount) || 0;
      else if (s.paymentStatus === "Kısmi Ödendi") custDebtTotal += getRemainingAmount(s);
    });

    const vehiclesHtml = [];
    if (custVehicles.length > 0) {
      custVehicles.forEach(v => {
        vehiclesHtml.push(html`<span class="only-card-vehicle-tag" onclick="switchView('only-vehicles'); setTimeout(() => {
          const card = document.getElementById('only-veh-card-${v.id}');
          if(card) {
            card.scrollIntoView({behavior: 'smooth', block: 'center'});
            card.style.borderColor = 'var(--accent)';
            setTimeout(() => card.style.borderColor = '', 2000);
          }
        }, 150)">🚘 ${v.plate} - ${v.brand} ${v.model}</span>`);
      });
    } else {
      vehiclesHtml.push(html`<span style="font-size: 11px; color: var(--text-muted);">Kayıtlı araç bulunmuyor</span>`);
    }
    
    const card = document.createElement("div");
    card.className = "only-card";
    card.id = `only-cust-card-${c.id}`;
    card.innerHTML = html`
      <div>
        <div class="only-card-header">
          <div class="only-card-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            ${c.firstName} ${c.lastName}
          </div>
          ${c.reference ? html`<span class="only-card-badge">Ref: ${c.reference}</span>` : ""}
        </div>
        
        <div class="only-card-body">
          <div class="only-card-row">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <strong>Telefon:</strong>&nbsp;<a href="tel:${c.phone}" style="color: var(--text-primary); font-weight: 600;">${c.phone}</a>
          </div>

          ${custDebtTotal > 0 ? html`
          <div class="only-card-row" style="color: var(--danger); font-weight: 600;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <strong>Bekleyen Borç:</strong>&nbsp;${formatMoney(custDebtTotal)}
          </div>` : ''}

          ${c.notes ? html`<div class="only-card-row" style="align-items: flex-start; background: var(--bg-subtle); padding: 8px; border-radius: 6px; border-left: 3px solid var(--accent); margin-top: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div style="font-size: 12px; color: var(--text-secondary);"><strong>Müşteri Notu:</strong> ${c.notes}</div>
          </div>` : ""}
          
          <div class="only-card-vehicles">
            <div style="font-weight: 600; margin-bottom: 6px; font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center;">
              <span>Kayıtlı Araçları (${custVehicles.length})</span>
              <span style="font-size: 11px; color: var(--text-muted);">${custServices.length} Servis Kaydı</span>
            </div>
            <div>${vehiclesHtml}</div>
          </div>
        </div>
      </div>
      
      <div class="only-card-footer">
        <a href="tel:${c.phone}" class="btn btn-call btn-mini" title="Müşteriyi Ara">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Ara
        </a>
        <button type="button" class="btn btn-accent btn-mini" onclick="showCustomerHistory('${c.id}')">
          İşlem Geçmişi
        </button>
        ${customerMailButton(c)}
        <button type="button" class="btn btn-secondary btn-mini" onclick="openCustomerEditModal('${c.id}')">
          Düzenle
        </button>
        ${canDelete() ? html`<button type="button" class="btn btn-danger btn-mini" onclick="triggerDeleteCustomer('${c.id}')">
          Sil
        </button>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}

function filterOnlyCustomers() {
  const q = document.getElementById("onlyCustomersSearch").value.toLowerCase();
  document.querySelectorAll("#onlyCustomersContainer .only-card").forEach(card => {
    if (card.textContent.toLowerCase().includes(q)) {
      card.style.setProperty("display", "flex", "important");
    } else {
      card.style.setProperty("display", "none", "important");
    }
  });
}

// ==========================================================================
// ARAÇLAR SAYFASI RENDER VE MARKA KLASÖRLERİ MANTIGI
// ==========================================================================
function renderBrandFolders() {
  const container = document.getElementById("brandFoldersContainer");
  if (!container) return;
  container.innerHTML = "";

  // Markalara göre araç sayılarını hesapla
  const brandCounts = {};
  let otherCount = 0;

  state.vehicles.forEach(v => {
    const b = (v.brand || "").trim();
    const matchedBrand = KNOWN_BRANDS.find(kb => kb.toLowerCase() === b.toLowerCase());
    if (matchedBrand) {
      brandCounts[matchedBrand] = (brandCounts[matchedBrand] || 0) + 1;
    } else {
      otherCount++;
    }
  });

  // 1. Tüm Markalar Kartı
  const allCard = document.createElement("button");
  allCard.type = "button";
  allCard.className = `brand-card ${activeBrandFolder === 'ALL' ? 'active' : ''}`;
  allCard.innerHTML = html`
    <span class="brand-card-count">${state.vehicles.length}</span>
    <div class="brand-card-logo-wrap">
      <svg class="brand-card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    </div>
    <span class="brand-card-name">Tüm Markalar</span>
  `;
  allCard.onclick = () => selectBrandFolder('ALL');
  container.appendChild(allCard);

  // 2. Bilinen Yaygın Marka Kartları
  KNOWN_BRANDS.forEach(b => {
    const count = brandCounts[b] || 0;
    const logoSrc = BRAND_LOGOS[b] || '';
    const card = document.createElement("button");
    card.type = "button";
    card.className = `brand-card ${activeBrandFolder === b ? 'active' : ''}`;
    card.title = b;
    
    let logoHtml = '';
    if (logoSrc) {
      logoHtml = html`<img src="${logoSrc}" alt="${b}" class="brand-card-logo" onerror="this.onerror=null; this.parentElement.innerHTML='<span style=\'font-size:26px;\'>🚗</span>';" />`;
    } else {
      logoHtml = html`<span style="font-size:26px;">🚗</span>`;
    }

    card.innerHTML = html`
      <span class="brand-card-count">${count}</span>
      <div class="brand-card-logo-wrap">
        ${logoHtml}
      </div>
      <span class="brand-card-name">${b}</span>
    `;
    card.onclick = () => selectBrandFolder(b);
    container.appendChild(card);
  });

  // 3. Diğer Markalar Kartı
  const otherCard = document.createElement("button");
  otherCard.type = "button";
  otherCard.className = `brand-card ${activeBrandFolder === 'OTHER' ? 'active' : ''}`;
  otherCard.innerHTML = html`
    <span class="brand-card-count">${otherCount}</span>
    <div class="brand-card-logo-wrap">
      <svg class="brand-card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-1.38-2.3A2 2 0 0 0 7.37 2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/></svg>
    </div>
    <span class="brand-card-name">Diğer Markalar</span>
  `;
  otherCard.onclick = () => selectBrandFolder('OTHER');
  container.appendChild(otherCard);
}

function selectBrandFolder(brandFolder) {
  activeBrandFolder = brandFolder;
  renderOnlyVehicles();
}

function renderOnlyVehicles() {
  renderBrandFolders();

  const container = document.getElementById("onlyVehiclesContainer");
  const activeInfo = document.getElementById("brandActiveInfo");
  if (!container) return;
  container.innerHTML = "";

  if (activeInfo) {
    if (activeBrandFolder === 'ALL') {
      activeInfo.style.display = "none";
    } else if (activeBrandFolder === 'OTHER') {
      activeInfo.style.display = "block";
      activeInfo.innerHTML = `📁 Seçili Klasör: <strong>Diğer Markalar</strong> (Yaygın listede olmayan tüm araçlar)`;
    } else {
      activeInfo.style.display = "block";
      activeInfo.innerHTML = `🚗 Seçili Klasör: <strong>${activeBrandFolder}</strong>`;
    }
  }

  if (state.vehicles.length === 0) {
    container.innerHTML = `<div class="search-no-results" style="grid-column: 1 / -1; color: var(--text-secondary);">Sistemde kayıtlı araç bulunmuyor.</div>`;
    return;
  }

  // Seçili marka klasörüne göre filtrele
  const filtered = state.vehicles.filter(v => {
    if (activeBrandFolder === 'ALL') return true;
    const b = (v.brand || "").trim();
    const matchedBrand = KNOWN_BRANDS.find(kb => kb.toLowerCase() === b.toLowerCase());
    if (activeBrandFolder === 'OTHER') {
      return !matchedBrand;
    }
    return matchedBrand === activeBrandFolder;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="search-no-results" style="grid-column: 1 / -1; color: var(--text-secondary);">Bu klasörde henüz kayıtlı araç bulunmuyor.</div>`;
    return;
  }

  // Markaya ve modele göre alfabetik sırala
  const sorted = [...filtered].sort((a, b) => 
    a.brand.localeCompare(b.brand, "tr") || a.model.localeCompare(b.model, "tr")
  );
  
  sorted.forEach(v => {
    // Aracın sahibini bul
    const owner = state.customers.find(c => c.id === v.customerId);
    const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Bilinmeyen Müşteri";
    const ownerPhone = owner ? owner.phone : "";
    
    // Aracın servis kayıtlarını bul
    const vehServices = state.serviceRecords.filter(s => s.vehicleId === v.id);

    const card = document.createElement("div");
    card.className = "only-card";
    card.id = `only-veh-card-${v.id}`;
    card.innerHTML = html`
      <div>
        <div class="only-card-header">
          <div class="only-card-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            ${v.brand} ${v.model}
          </div>
          <span class="only-card-badge">${v.plate}</span>
        </div>
        
        <div class="only-card-body">
          <div class="only-card-row" onclick="switchView('only-customers'); setTimeout(() => {
            const card = document.getElementById('only-cust-card-${v.customerId}');
            if(card) {
              card.scrollIntoView({behavior: 'smooth', block: 'center'});
              card.style.borderColor = 'var(--accent)';
              setTimeout(() => card.style.borderColor = '', 2000);
            }
          }, 150)" style="cursor: pointer;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            <strong>Sahibi:</strong>&nbsp;<span style="color: var(--accent); font-weight: 600; text-decoration: underline;">${ownerName}</span>
          </div>

          ${ownerPhone ? html`<div class="only-card-row">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <strong>Telefon:</strong>&nbsp;<a href="tel:${ownerPhone}" style="color: var(--text-primary); font-weight: 600;">${ownerPhone}</a>
          </div>` : ""}

          <div class="only-card-row">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <strong>Giriş Tarihi:</strong>&nbsp;${formatDate(v.entryDate)}
          </div>

          ${v.chassisNo ? html`<div class="only-card-row">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33"/></svg>
            <strong>Şasi No:</strong>&nbsp;${v.chassisNo}
          </div>` : ""}

          ${v.notes ? html`<div class="only-card-row" style="align-items: flex-start; background: var(--bg-subtle); padding: 8px; border-radius: 6px; border-left: 3px solid var(--accent); margin-top: 4px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div style="font-size: 12px; color: var(--text-secondary);"><strong>Araç Notu:</strong> ${v.notes}</div>
          </div>` : ""}

          <div style="margin-top: 8px; font-size: 11px; color: var(--text-muted); font-weight: 500;">
            ${vehServices.length} Geçmiş Servis Kaydı
          </div>
        </div>
      </div>
      
      <div class="only-card-footer">
        ${ownerPhone ? html`<a href="tel:${ownerPhone}" class="btn btn-call btn-mini" title="Araç Sahibini Ara">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Ara
        </a>` : ""}
        <button type="button" class="btn btn-accent btn-mini" onclick="showVehicleHistory('${v.id}')">
          İşlem Geçmişi
        </button>
        <button type="button" class="btn btn-secondary btn-mini" onclick="openVehicleEditModal('${v.id}')">
          Düzenle
        </button>
        ${canDelete() ? html`<button type="button" class="btn btn-danger btn-mini" onclick="triggerDeleteVehicle('${v.id}')">
          Sil
        </button>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}

function filterOnlyVehicles() {
  const q = document.getElementById("onlyVehiclesSearch").value.toLowerCase();
  document.querySelectorAll("#onlyVehiclesContainer .only-card").forEach(card => {
    if (card.textContent.toLowerCase().includes(q)) {
      card.style.setProperty("display", "flex", "important");
    } else {
      card.style.setProperty("display", "none", "important");
    }
  });
}

// ==========================================================================
// DÜZENLEME MODALLERİ HESAPLARI & EVENT HANDLERS
// ==========================================================================

// Müşteri Düzenle Modal
function openCustomerEditModal(id) {
  const c = state.customers.find(item => item.id === id);
  if (!c) return;
  document.getElementById("edit_c_id").value = c.id;
  document.getElementById("edit_c_firstName").value = c.firstName;
  document.getElementById("edit_c_lastName").value = c.lastName;
  document.getElementById("edit_c_phone").value = c.phone;
  document.getElementById("edit_c_email").value = c.email || "";
  document.getElementById("edit_c_reference").value = c.reference || "";
  document.getElementById("edit_c_notes").value = c.notes || "";
  document.getElementById("customerEditModal").classList.remove("hidden");
}

function closeCustomerEditModal() {
  document.getElementById("customerEditModal").classList.add("hidden");
  document.getElementById("editCustomerForm").reset();
}

async function handleCustomerEditSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("edit_c_id").value;
  const payload = {
    id: id,
    firstName: document.getElementById("edit_c_firstName").value.trim(),
    lastName: document.getElementById("edit_c_lastName").value.trim(),
    phone: document.getElementById("edit_c_phone").value.trim(),
    email: document.getElementById("edit_c_email").value.trim().toLowerCase(),
    reference: document.getElementById("edit_c_reference").value.trim(),
    notes: document.getElementById("edit_c_notes").value.trim()
  };
  if (payload.email && !EMAIL_RE.test(payload.email)) {
    showToast("Geçerli bir e-posta adresi girin veya alanı boş bırakın.", "warning");
    document.getElementById("edit_c_email").focus();
    return;
  }
  
  const btn = document.getElementById("btnUpdateCustomer");
  btn.disabled = true;
  btn.textContent = "Güncelleniyor...";
  
  const success = await sendRequest("updateCustomer", payload);
  if (success) {
    closeCustomerEditModal();
    showToast("✓ Müşteri bilgileri güncellendi.", "success");
  }
  btn.disabled = false;
  btn.textContent = "Güncelle";
}

// Araç Düzenle Modal
function openVehicleEditModal(id) {
  const v = state.vehicles.find(item => item.id === id);
  if (!v) return;
  
  const owner = state.customers.find(c => c.id === v.customerId);
  if (owner) {
    selectCustomerComboboxItem(owner, 'edit_v_customerId', 'edit_v_customerSearchInput', 'edit_v_customerClearBtn', 'edit_v_customerSelectedBadge', 'edit_v_customerDropdownResults');
  } else {
    clearCustomerCombobox('edit_v_customerId', 'edit_v_customerSearchInput', 'edit_v_customerClearBtn', 'edit_v_customerSelectedBadge');
  }
  
  document.getElementById("edit_v_id").value = v.id;
  document.getElementById("edit_v_customerId").value = v.customerId;

  const matchedBrand = KNOWN_BRANDS.find(kb => kb.toLowerCase() === (v.brand || "").toLowerCase());
  const brandSelect = document.getElementById("edit_v_brand_select");
  const customGroup = document.getElementById("edit_v_custom_brand_group");
  const customInput = document.getElementById("edit_v_custom_brand");
  
  if (brandSelect) {
    if (matchedBrand) {
      brandSelect.value = matchedBrand;
      if (customGroup) customGroup.classList.add("hidden");
      if (customInput) customInput.value = "";
    } else {
      brandSelect.value = "OTHER_CUSTOM";
      if (customGroup) customGroup.classList.remove("hidden");
      if (customInput) customInput.value = v.brand || "";
    }
  }

  document.getElementById("edit_v_model").value = v.model;
  document.getElementById("edit_v_plate").value = v.plate;
  document.getElementById("edit_v_chassis").value = v.chassisNo || "";
  document.getElementById("edit_v_entryDate").value = toIsoDate(v.entryDate);
  document.getElementById("edit_v_notes").value = v.notes || "";
  
  document.getElementById("vehicleEditModal").classList.remove("hidden");
}

function closeVehicleEditModal() {
  document.getElementById("vehicleEditModal").classList.add("hidden");
  document.getElementById("editVehicleForm").reset();
  clearCustomerCombobox('edit_v_customerId', 'edit_v_customerSearchInput', 'edit_v_customerClearBtn', 'edit_v_customerSelectedBadge');
  const customGroup = document.getElementById("edit_v_custom_brand_group");
  if (customGroup) customGroup.classList.add("hidden");
}

async function handleVehicleEditSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("edit_v_id").value;

  const brandSelect = document.getElementById("edit_v_brand_select");
  const customBrandInput = document.getElementById("edit_v_custom_brand");
  let brandValue = "";
  if (brandSelect) {
    if (brandSelect.value === "OTHER_CUSTOM") {
      brandValue = customBrandInput ? customBrandInput.value.trim() : "";
    } else {
      brandValue = brandSelect.value;
    }
  }

  if (!brandValue) {
    showToast("Lütfen araç markasını seçin veya yazın.", "warning");
    return;
  }

  const payload = {
    id: id,
    customerId: document.getElementById("edit_v_customerId").value,
    brand: brandValue,
    model: document.getElementById("edit_v_model").value.trim(),
    plate: document.getElementById("edit_v_plate").value.trim().replace(/\s+/g, ""),
    chassisNo: document.getElementById("edit_v_chassis").value.trim(),
    entryDate: document.getElementById("edit_v_entryDate").value,
    notes: document.getElementById("edit_v_notes").value.trim()
  };
  
  const btn = document.getElementById("btnUpdateVehicle");
  btn.disabled = true;
  btn.textContent = "Güncelleniyor...";
  
  const success = await sendRequest("updateVehicle", payload);
  if (success) {
    closeVehicleEditModal();
    showToast("✓ Araç bilgileri güncellendi.", "success");
  }
  btn.disabled = false;
  btn.textContent = "Güncelle";
}

// ==========================================================================
// SİLME İŞLEMLERİ (DELETE ACTIONS)
// ==========================================================================
async function triggerDeleteCustomer(id) {
  const c = state.customers.find(item => item.id === id);
  if (!c) return;
  const confirmDelete = confirm(`${c.firstName} ${c.lastName} isimli müşteriyi silmek istediğinize emin misiniz?\n(Bu işlem müşteriyi ve ilişkili tüm araç kayıtlarını sistemden tamamen silecektir!)`);
  if (confirmDelete) {
    const success = await sendRequest("deleteCustomer", { id: id });
    if (success) {
      showToast("✓ Müşteri kaydı silindi.", "info");
    }
  }
}

async function triggerDeleteVehicle(id) {
  const v = state.vehicles.find(item => item.id === id);
  if (!v) return;
  const confirmDelete = confirm(`${v.plate} plakalı aracı silmek istediğinize emin misiniz?\n(Bu işlem aracı sistemden tamamen silecektir!)`);
  if (confirmDelete) {
    const success = await sendRequest("deleteVehicle", { id: id });
    if (success) {
      showToast("✓ Araç kaydı silindi.", "info");
    }
  }
}

// ==========================================================================
// SERVİS GEÇMİŞİ MODAL VE FİLTRE HESAPLARI
// ==========================================================================

function showCustomerHistory(customerId) {
  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) return;
  
  document.getElementById("historyModalTitle").textContent = `${customer.firstName} ${customer.lastName} - Servis Geçmişi`;
  const body = document.getElementById("historyModalBody");
  body.innerHTML = "";
  
  const custVehicles = state.vehicles.filter(v => v.customerId === customerId);
  const records = state.serviceRecords.filter(rec => custVehicles.some(v => v.id === rec.vehicleId));
  
  if (records.length === 0) {
    body.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Bu müşteriye ait geçmiş servis işlemi bulunamadı.</div>`;
    document.getElementById("historyModal").classList.remove("hidden");
    return;
  }
  
  // Tarihe göre sırala
  records.sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));
  
  records.forEach(rec => {
    const v = custVehicles.find(veh => veh.id === rec.vehicleId);
    const plateText = v ? `${v.brand} ${v.model} (${v.plate})` : "Bilinmeyen Araç";
    
    let badgeClass = "badge-unpaid";
    if (rec.paymentStatus === "Ödendi" || rec.paymentStatus === "Nakit Ödendi" || rec.paymentStatus === "Havale Yapıldı") badgeClass = "badge-paid";
    else if (rec.paymentStatus === "Kısmi Ödendi") badgeClass = "badge-partial";
    
    const techDetailHtml = [];
    TECHNICIANS.forEach(tech => {
      const fee = parseFloat(rec[tech.feeKey]) || 0;
      const note = rec[tech.noteKey];
      if (fee > 0 || note) {
        techDetailHtml.push(html`
          <div class="sub-op-row">
            <span class="sub-op-name">${tech.label}:</span>
            <span>${formatMoney(fee)}</span>
          </div>
          ${note ? html`<div class="sub-op-note">${note}</div>` : ""}
        `);
      }
    });
    
    const item = document.createElement("div");
    item.className = "service-log-card";
    item.style.marginBottom = "12px";
    item.innerHTML = html`
      <div class="service-log-header">
        <div>
          <span class="service-log-title">${plateText}</span>
        </div>
        <span class="badge ${badgeClass}">${rec.paymentStatus}</span>
      </div>
      <div class="service-log-meta">
        <span>Tarih: <strong>${formatDate(rec.recordDate)}</strong></span>
        <span>KM: <strong>${formatNumber(rec.entryKm)} km</strong></span>
      </div>
      <div class="service-log-sub-ops">
        ${techDetailHtml}
      </div>
      ${rec.generalSummary ? html`<div class="service-log-summary"><strong>Özet:</strong> ${rec.generalSummary}</div>` : ""}
      <div class="service-log-footer" style="margin-top: 8px;">
        <span style="font-weight: 700;">Toplam: ${formatMoney(rec.totalAmount)}</span>
        <button class="btn btn-secondary btn-mini" onclick="closeHistoryModal(); editServiceRecord('${rec.id}')">Düzenle</button>
      </div>
    `;
    body.appendChild(item);
  });
  
  document.getElementById("historyModal").classList.remove("hidden");
}

function showVehicleHistory(vehicleId) {
  const v = state.vehicles.find(veh => veh.id === vehicleId);
  if (!v) return;
  
  document.getElementById("historyModalTitle").textContent = `${v.plate} - ${v.brand} ${v.model} Servis Geçmişi`;
  const body = document.getElementById("historyModalBody");
  body.innerHTML = "";
  
  const records = state.serviceRecords.filter(rec => rec.vehicleId === vehicleId);
  
  if (records.length === 0) {
    body.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Bu araca ait geçmiş servis işlemi bulunamadı.</div>`;
    document.getElementById("historyModal").classList.remove("hidden");
    return;
  }
  
  // Tarihe göre sırala
  records.sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));
  
  records.forEach(rec => {
    let badgeClass = "badge-unpaid";
    if (rec.paymentStatus === "Ödendi" || rec.paymentStatus === "Nakit Ödendi" || rec.paymentStatus === "Havale Yapıldı") badgeClass = "badge-paid";
    else if (rec.paymentStatus === "Kısmi Ödendi") badgeClass = "badge-partial";
    
    const techDetailHtml = [];
    TECHNICIANS.forEach(tech => {
      const fee = parseFloat(rec[tech.feeKey]) || 0;
      const note = rec[tech.noteKey];
      if (fee > 0 || note) {
        techDetailHtml.push(html`
          <div class="sub-op-row">
            <span class="sub-op-name">${tech.label}:</span>
            <span>${formatMoney(fee)}</span>
          </div>
          ${note ? html`<div class="sub-op-note">${note}</div>` : ""}
        `);
      }
    });
    
    const item = document.createElement("div");
    item.className = "service-log-card";
    item.style.marginBottom = "12px";
    item.innerHTML = html`
      <div class="service-log-header">
        <div>
          <span class="service-log-title">KM: ${formatNumber(rec.entryKm)} km</span>
        </div>
        <span class="badge ${badgeClass}">${rec.paymentStatus}</span>
      </div>
      <div class="service-log-meta">
        <span>Tarih: <strong>${formatDate(rec.recordDate)}</strong></span>
      </div>
      <div class="service-log-sub-ops">
        ${techDetailHtml}
      </div>
      ${rec.generalSummary ? html`<div class="service-log-summary"><strong>Özet:</strong> ${rec.generalSummary}</div>` : ""}
      <div class="service-log-footer" style="margin-top: 8px;">
        <span style="font-weight: 700;">Toplam: ${formatMoney(rec.totalAmount)}</span>
        <button class="btn btn-secondary btn-mini" onclick="closeHistoryModal(); editServiceRecord('${rec.id}')">Düzenle</button>
      </div>
    `;
    body.appendChild(item);
  });
  
  document.getElementById("historyModal").classList.remove("hidden");
}

function closeHistoryModal() {
  document.getElementById("historyModal").classList.add("hidden");
  document.getElementById("historyModalBody").innerHTML = "";
}

function filterServicesLog() {
  const q = document.getElementById("servicesLogSearch").value.toLowerCase();
  document.querySelectorAll("#servicesLogContainer .service-log-card").forEach(card => {
    if (card.textContent.toLowerCase().includes(q)) {
      card.style.setProperty("display", "block", "important");
    } else {
      card.style.setProperty("display", "none", "important");
    }
  });
}

// ==========================================================================
// TARİHLER (TAKVİM) SAYFASI YÖNETİMİ
// ==========================================================================

const MONTHS_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", 
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

function navigateCalendar(direction) {
  state.calendarMonth += direction;
  if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear -= 1;
  } else if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear += 1;
  }
  // Seçili tarihi geçilen ayın ilk gününe çek
  state.calendarSelectedDate = `${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, '0')}-01`;
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById("calendarDaysGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (state.calendarYear === undefined) {
    state.calendarYear = new Date().getFullYear();
    state.calendarMonth = new Date().getMonth();
    state.calendarSelectedDate = todayIso();
  }

  // Ay ve yıl başlığını yazdır
  document.getElementById("calendarMonthTitle").textContent = `${MONTHS_TR[state.calendarMonth]} ${state.calendarYear}`;

  // Ayın ilk gününün haftanın hangi günü olduğunu ve toplam gün sayısını hesapla
  const firstDay = new Date(state.calendarYear, state.calendarMonth, 1).getDay();
  const totalDays = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();

  // Pazartesi'yi ilk gün yapmak için indeks ayarlama
  // JS getDay(): 0 (Paz), 1 (Pzt), 2 (Sal)...
  // Hedef indeks: 0 (Pzt), 1 (Sal)... 6 (Paz)
  let firstDayIndex = firstDay === 0 ? 6 : firstDay - 1;

  // Boş hücreleri doldur (ayın başlangıcından önceki günler)
  for (let i = 0; i < firstDayIndex; i++) {
    const cell = document.createElement("div");
    cell.className = "calendar-day-cell empty";
    grid.appendChild(cell);
  }

  const todayStr = todayIso();

  // Günleri doldur
  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // O gün servise giren araçları bul
    const dayVehicles = state.vehicles.filter(v => {
      if (!v.entryDate) return false;
      return toIsoDate(v.entryDate) === dateStr;
    });

    const cell = document.createElement("div");
    cell.className = "calendar-day-cell";
    if (dateStr === todayStr) cell.classList.add("today");
    if (dateStr === state.calendarSelectedDate) cell.classList.add("active");

    cell.innerHTML = `<div>${day}</div>`;

    if (dayVehicles.length > 0) {
      const badge = document.createElement("span");
      badge.className = "calendar-day-badge";
      badge.textContent = `${dayVehicles.length} Araç`;
      cell.appendChild(badge);
    }

    cell.onclick = () => {
      document.querySelectorAll(".calendar-day-cell.active").forEach(c => c.classList.remove("active"));
      cell.classList.add("active");
      state.calendarSelectedDate = dateStr;
      showSelectedDayVehicles(dateStr);
    };

    grid.appendChild(cell);
  }

  // Seçili günün kayıtlarını göster
  showSelectedDayVehicles(state.calendarSelectedDate);
}

function showSelectedDayVehicles(dateStr) {
  const listContainer = document.getElementById("selectedDateVehiclesList");
  if (!listContainer) return;
  listContainer.innerHTML = "";

  const dateObj = new Date(dateStr);
  const dateFormatted = isNaN(dateObj.getTime()) ? dateStr : dateObj.toLocaleDateString("tr-TR", { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  document.getElementById("selectedDateTitle").textContent = `${dateFormatted} Girişleri`;

  const dayVehicles = state.vehicles.filter(v => {
    if (!v.entryDate) return false;
    return toIsoDate(v.entryDate) === dateStr;
  });

  if (dayVehicles.length === 0) {
    listContainer.innerHTML = `<div style="text-align: center; padding: 32px; color: var(--text-secondary);">Bu tarihte servise giriş yapan araç kaydı bulunmuyor.</div>`;
    return;
  }

  dayVehicles.forEach(v => {
    const owner = state.customers.find(c => c.id === v.customerId);
    const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Bilinmeyen Müşteri";
    const ownerPhone = owner ? owner.phone : "";

    const card = document.createElement("div");
    card.className = "service-log-card";
    card.style.marginBottom = "10px";
    card.style.border = "1px solid var(--border-color)";
    card.style.backgroundColor = "var(--bg-subtle)";
    card.innerHTML = html`
      <div class="service-log-header">
        <div>
          <span class="service-log-title" style="font-size: 14px;">${v.brand} ${v.model}</span>
        </div>
        <span class="badge badge-paid" style="font-family: var(--font-mono);">${v.plate}</span>
      </div>
      <div class="service-log-meta" style="margin-top: 4px; font-size: 11px; display: flex; flex-direction: column; gap: 2px;">
        <div>Sahibi: <strong>${ownerName}</strong></div>
        ${ownerPhone ? html`<div>Tel: <strong>${ownerPhone}</strong></div>` : ""}
      </div>
      ${v.notes ? html`<div class="service-log-summary" style="margin-top: 6px; font-size: 12px; padding: 6px;"><strong>Araç Notu:</strong> ${v.notes}</div>` : ""}
      <div class="service-log-footer" style="margin-top: 8px; padding-top: 6px; display: flex; justify-content: flex-end; gap: 6px;">
        <button class="btn btn-secondary btn-mini" onclick="switchView('only-vehicles'); setTimeout(() => {
          const card = document.getElementById('only-veh-card-${v.id}');
          if(card) {
            card.scrollIntoView({behavior: 'smooth', block: 'center'});
            card.style.borderColor = 'var(--accent)';
            setTimeout(() => card.style.borderColor = '', 2000);
          }
        }, 150)">Araca Git</button>
        <button class="btn btn-accent btn-mini" onclick="showVehicleHistory('${v.id}')">İşlem Geçmişi</button>
      </div>
    `;
    listContainer.appendChild(card);
  });
}

function toggleCardDetails(type, id, btn) {
  let targetId = "";
  let containerId = "";
  if (type === 'customer') {
    targetId = `cust-details-${id}`;
    containerId = "onlyCustomersContainer";
  } else if (type === 'vehicle') {
    targetId = `veh-details-${id}`;
    containerId = "onlyVehiclesContainer";
  } else if (type === 'service') {
    targetId = `service-details-${id}`;
    containerId = "servicesLogContainer";
  } else if (type === 'debt') {
    targetId = `debt-details-${id}`;
    containerId = "debtsContainer";
  }
  
  const targetEl = document.getElementById(targetId);
  if (!targetEl) return;
  
  const isCurrentlyOpen = targetEl.classList.contains("open");
  
  // Aynı gruptaki diğer açık detay kartlarını kapat
  const container = document.getElementById(containerId);
  if (container) {
    container.querySelectorAll(".card-details-collapse").forEach(collapse => {
      if (collapse.id !== targetId) {
        collapse.classList.remove("open");
      }
    });
    // Diğer tüm butonların metnini "Daha Fazla" olarak sıfırla
    container.querySelectorAll(".btn-toggle-details").forEach(button => {
      if (button !== btn) {
        button.textContent = "Daha Fazla";
      }
    });
  }
  
  // Tıklanan kartı aç veya kapat
  if (!isCurrentlyOpen) {
    targetEl.classList.add("open");
    btn.textContent = "Daha Az";
  } else {
    targetEl.classList.remove("open");
    btn.textContent = "Daha Fazla";
  }
}

// ==========================================================================
// BORÇ LİSTESİ (ÖDENMEYEN KAYITLAR) YÖNETİMİ
// ==========================================================================

function renderDebts() {
  const container = document.getElementById("debtsContainer");
  if (!container) return;
  container.innerHTML = "";

  // Sadece "Ödenmedi" veya "Kısmi Ödendi" olan kayıtları filtrele
  const debtRecords = state.serviceRecords.filter(rec => 
    rec.paymentStatus === "Ödenmedi" || rec.paymentStatus === "Kısmi Ödendi"
  );

  // Metrikleri hesapla
  let totalDebt = 0;
  debtRecords.forEach(rec => {
    totalDebt += getRemainingAmount(rec);
  });

  const debtTotalEl = document.getElementById("debtTotalAmount");
  if (debtTotalEl) debtTotalEl.textContent = `${formatMoney(totalDebt)}`;

  const debtCountEl = document.getElementById("debtTotalCount");
  if (debtCountEl) debtCountEl.textContent = debtRecords.length;

  if (debtRecords.length === 0) {
    container.innerHTML = `<div class="search-no-results" style="color: var(--text-secondary); text-align: center; padding: 32px;">Ödenmemiş veya borçlu servis kaydı bulunmuyor.</div>`;
    return;
  }

  // Tarihe göre yeniden eskiye sırala
  debtRecords.sort((a, b) => new Date(b.recordDate) - new Date(a.recordDate));

  debtRecords.forEach(rec => {
    const vehicle = state.vehicles.find(v => v.id === rec.vehicleId);
    const vehicleText = vehicle ? `${vehicle.brand} ${vehicle.model} - ${vehicle.plate}` : "Bilinmeyen Araç";
    const customer = vehicle ? state.customers.find(c => c.id === vehicle.customerId) : null;
    const customerName = customer ? `${customer.firstName} ${customer.lastName}` : "Bilinmeyen Müşteri";
    const customerPhone = customer ? customer.phone : "";

    let badgeClass = rec.paymentStatus === "Kısmi Ödendi" ? "badge-partial" : "badge-unpaid";

    const card = document.createElement("div");
    card.className = "service-log-card";
    card.id = `debt-card-${rec.id}`;
    card.innerHTML = html`
      <div class="service-log-header">
        <div>
          <span class="service-log-title">${customerName}</span>
          <span style="font-size:12px; margin-left:8px; color:var(--text-secondary);">${vehicleText}</span>
        </div>
        <span class="badge ${badgeClass}">${rec.paymentStatus}</span>
      </div>
      
      <div class="service-log-meta-visible" style="margin-top: 8px; font-size: 13px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <span>Tarih: <strong>${formatDate(rec.recordDate)}</strong></span>
        <span style="font-weight: 700; font-size:14px; color: var(--danger);">Borç: ${formatMoney(getRemainingAmount(rec))}</span>
      </div>

      <div class="card-details-collapse" id="debt-details-${rec.id}">
        <div style="margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 8px;">
          <div class="service-log-meta" style="margin-bottom: 8px;">
            <span>KM: <strong>${formatNumber(rec.entryKm)} km</strong></span>
          </div>
          
          <div class="service-log-sub-ops" style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
            <!-- Detaylı usta ücretlerini listele -->
            ${getTechDetailListHtml(rec)}
          </div>

          ${rec.generalSummary ? html`<div class="service-log-summary" style="margin-top: 8px;"><strong>İşlem Özeti:</strong> ${rec.generalSummary}</div>` : ""}
        </div>
      </div>

      <div class="service-log-footer" style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-muted); display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px;">
        ${customerPhone ? html`<a href="tel:${customerPhone}" class="btn btn-call btn-mini" title="Ara">Ara</a>` : ""}
        <button class="btn btn-success btn-mini" onclick="markAsPaid('${rec.id}')">Tahsil Et (Ödendi)</button>
        ${receiptMailButton(rec)}
        <button class="btn btn-secondary btn-mini" onclick="editServiceRecord('${rec.id}')">Düzenle</button>
        <button class="btn btn-info btn-mini btn-toggle-details" onclick="toggleCardDetails('debt', '${rec.id}', this)">Daha Fazla</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Yardımcı Fonksiyon: Usta detaylarını html olarak hazırla
function getTechDetailListHtml(rec) {
  const parts = [];
  TECHNICIANS.forEach(tech => {
    const fee = parseFloat(rec[tech.feeKey]) || 0;
    const note = rec[tech.noteKey];
    if (fee > 0 || note) {
      parts.push(html`
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <strong>${tech.label}:</strong>
          <span>${formatMoney(fee)}</span>
        </div>
        ${note ? html`<div style="font-style: italic; font-size: 11px; margin-bottom: 8px; color: var(--text-muted); padding-left: 8px; border-left: 2px solid var(--border-color);">${note}</div>` : ""}
      `);
    }
  });
  return parts.length ? parts : html`<div>Usta kaydı bulunmuyor.</div>`;
}

async function markAsPaid(recordId) {
  const rec = state.serviceRecords.find(r => r.id === recordId);
  if (!rec) return;

  const confirmPayment = confirm("Bu servis kaydının ödemesinin tamamen tahsil edildiğini onaylıyor musunuz?");
  if (!confirmPayment) return;

  // Ödeme durumunu güncelle
  const payload = { ...rec, paymentStatus: "Nakit Ödendi" };

  const success = await sendRequest("updateServiceRecord", payload);
  if (success) {
    showToast("✓ Ödeme başarıyla tahsil edildi (Nakit Ödendi).", "success");
  }
}

function filterDebtsList() {
  const q = document.getElementById("debtsSearch").value.toLowerCase();
  document.querySelectorAll("#debtsContainer .service-log-card").forEach(card => {
    if (card.textContent.toLowerCase().includes(q)) {
      card.style.setProperty("display", "block", "important");
    } else {
      card.style.setProperty("display", "none", "important");
    }
  });
}
