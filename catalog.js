/**
 * Araç marka/model kataloğu ve seçim kutuları (marka → model, model yılı).
 *
 * Hazır liste bu dosyadadır; işletmenin eklediği markalar ve modeller veritabanındaki
 * vehicle_catalog tablosunda tutulur ve tüm ekip üyeleriyle paylaşılır. İşletmenin
 * araç kayıtlarında geçen markalar/modeller de seçeneklere otomatik eklenir.
 */

// Hazır marka → model listesi. "A / B" biçimindeki satırlar ayrı modellerdir.
const BUILTIN_VEHICLE_CATALOG = {
  "Renault": ["Clio", "Megane Sedan", "Duster", "Boreal", "Austral", "Captur", "Taliant", "Express", "Kangoo", "Trafic"],
  "Togg": ["T10X", "T10F"],
  "Fiat": ["Egea Sedan", "Egea Cross", "Doblo", "Fiorino", "Tipo", "500", "Scudo", "Ducato"],
  "Volkswagen": ["Taigo", "Polo", "T-Roc", "Tiguan", "Golf", "Passat", "Caddy", "Transporter", "Amarok", "ID.3", "ID.4"],
  "Hyundai": ["i20", "Bayon", "Tucson", "i10", "Elantra", "Kona", "Santa Fe", "Staria", "Ioniq 5", "Ioniq 6"],
  "Toyota": ["Corolla", "C-HR", "Yaris", "Yaris Cross", "RAV4", "Hilux", "Land Cruiser", "Camry", "Proace", "Corolla Cross"],
  "Ford": ["Transit", "Transit Custom", "Focus", "Puma", "Kuga", "Ranger", "Fiesta", "Tourneo", "Mustang Mach-E"],
  "Peugeot": ["2008", "3008", "208", "308", "5008", "Partner", "Expert", "Rifter", "408"],
  "Mercedes-Benz": ["C-Serisi", "E-Serisi", "A-Serisi", "GLC", "GLA", "CLA", "Vito", "V-Class", "Sprinter", "EQE", "EQS"],
  "Škoda": ["Octavia", "Kamiq", "Karoq", "Kodiaq", "Fabia", "Superb", "Scala", "Enyaq"],
  "Citroën": ["C3", "C4", "C5 Aircross", "Berlingo", "C3 Aircross", "Jumpy", "Ami"],
  "Kia": ["Sportage", "Cerato", "Forte", "Stonic", "Picanto", "Sorento", "Niro", "EV6", "Carnival", "Seltos"],
  "Opel": ["Corsa", "Mokka", "Astra", "Crossland", "Grandland", "Combo", "Vivaro", "Frontera"],
  "Nissan": ["Qashqai", "Juke", "X-Trail", "Micra", "Leaf", "Navara", "Townstar"],
  "Tesla": ["Model Y", "Model 3", "Model S", "Model X"],
  "BMW": ["3 Serisi", "5 Serisi", "X1", "X3", "X5", "1 Serisi", "iX", "i4", "7 Serisi"],
  "Volvo": ["XC40", "XC60", "XC90", "S60", "V60", "EX30", "EX90"],
  "Dacia": ["Sandero", "Sandero Stepway", "Duster", "Jogger", "Logan", "Spring"],
  "KG Mobility (SsangYong)": ["Torres", "Tivoli", "Korando", "Rexton", "Musso"],
  "Chery": ["Tiggo 7", "Tiggo 7 Pro", "Tiggo 8", "Omoda 5", "Arrizo 8"],
  "Audi": ["A3", "A4", "Q3", "Q5", "A6", "Q2", "e-tron", "Q4 e-tron", "A1"],
  "Omoda & Jaecoo": ["Omoda 5", "Jaecoo 7", "Omoda 7"],
  "Honda": ["Civic", "CR-V", "HR-V", "City", "Jazz", "ZR-V"],
  "Cupra": ["Formentor", "Leon", "Born", "Ateca", "Terramar"],
  "Jeep": ["Compass", "Renegade", "Avenger", "Wrangler", "Grand Cherokee", "Cherokee"],
  "Seat": ["Ibiza", "Leon", "Arona", "Ateca", "Tarraco"]
};

const MIN_MODEL_YEAR = 1960;

// İşletmenin kendi eklediği katalog satırları ({ brand, model }); model "" ise yalnızca markadır.
const vehicleCatalogState = { custom: [], loaded: false, loading: null };

/** Karşılaştırma anahtarı: büyük/küçük harf, Türkçe karakter ve aksanlardan bağımsız. */
function catalogKey(text) {
  return String(text || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanCatalogText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

const BUILTIN_BRAND_BY_KEY = new Map(Object.keys(BUILTIN_VEHICLE_CATALOG).map((b) => [catalogKey(b), b]));

/** Kayıtlı bir marka adını hazır listedeki yazımına çevirir (ör. "skoda" → "Škoda"). */
function canonicalBrandName(brand) {
  const clean = cleanCatalogText(brand);
  return BUILTIN_BRAND_BY_KEY.get(catalogKey(clean)) || findCustomBrand(clean) || clean;
}

function findCustomBrand(brand) {
  const key = catalogKey(brand);
  const hit = vehicleCatalogState.custom.find((e) => catalogKey(e.brand) === key);
  return hit ? hit.brand : "";
}

function brandLogoSrc(brand) {
  return BRAND_LOGOS_BY_KEY.get(catalogKey(brand)) || "";
}

/** Tüm markalar: işletmede kullanılanlar araç sayısına göre önce, kalanlar alfabetik. */
function catalogBrands() {
  const map = new Map();
  const add = (name, count = 0) => {
    const clean = cleanCatalogText(name);
    if (!clean) return;
    const key = catalogKey(clean);
    const entry = map.get(key) || { name: canonicalBrandName(clean), count: 0, custom: !BUILTIN_BRAND_BY_KEY.has(key) };
    entry.count += count;
    map.set(key, entry);
  };
  Object.keys(BUILTIN_VEHICLE_CATALOG).forEach((b) => add(b));
  vehicleCatalogState.custom.forEach((e) => add(e.brand));
  state.vehicles.forEach((v) => add(v.brand, 1));
  return [...map.values()].sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, "tr"));
}

/** Bir markanın modelleri: işletmede kullanılanlar önce, ardından hazır ve eklenen modeller. */
function catalogModels(brand) {
  const brandKey = catalogKey(brand);
  if (!brandKey) return [];
  const map = new Map();
  const add = (name, count = 0, order = 1000) => {
    const clean = cleanCatalogText(name);
    if (!clean) return;
    const key = catalogKey(clean);
    const entry = map.get(key) || { name: clean, count: 0, order };
    entry.count += count;
    entry.order = Math.min(entry.order, order);
    map.set(key, entry);
  };
  const builtin = BUILTIN_VEHICLE_CATALOG[BUILTIN_BRAND_BY_KEY.get(brandKey)] || [];
  builtin.forEach((m, i) => add(m, 0, i));
  vehicleCatalogState.custom.forEach((e) => { if (catalogKey(e.brand) === brandKey) add(e.model); });
  state.vehicles.forEach((v) => { if (catalogKey(v.brand) === brandKey) add(v.model, 1); });
  return [...map.values()].sort((a, b) => (b.count - a.count) || (a.order - b.order) || a.name.localeCompare(b.name, "tr"));
}

async function loadVehicleCatalog({ force = false } = {}) {
  if (platform.offline) return;
  if (vehicleCatalogState.loaded && !force) return;
  if (vehicleCatalogState.loading) return vehicleCatalogState.loading;
  vehicleCatalogState.loading = (async () => {
    try {
      vehicleCatalogState.custom = (await apiCall("listVehicleCatalog")) || [];
      vehicleCatalogState.loaded = true;
    } catch {
      // Katalog tablosu yoksa veya bağlantı yoksa hazır liste ve araç kayıtları kullanılır.
    } finally {
      vehicleCatalogState.loading = null;
    }
  })();
  return vehicleCatalogState.loading;
}

function isInCatalog(brand, model = "") {
  const bKey = catalogKey(brand);
  const mKey = catalogKey(model);
  if (!mKey) return catalogBrands().some((b) => catalogKey(b.name) === bKey);
  return catalogModels(brand).some((m) => catalogKey(m.name) === mKey);
}

/**
 * Listede olmayan bir marka/modeli işletme kataloğuna ekler. Hata olursa kayıt yine de
 * araç üzerinde kalır; katalog yalnızca seçim kolaylığı içindir.
 */
async function addToVehicleCatalog(brand, model = "", { silent = false } = {}) {
  const cleanBrand = canonicalBrandName(brand);
  const cleanModel = cleanCatalogText(model);
  if (!cleanBrand || isInCatalog(cleanBrand, cleanModel)) return true;
  if (platform.offline) return false;
  try {
    const row = await apiCall("addVehicleCatalogEntry", { brand: cleanBrand, model: cleanModel });
    vehicleCatalogState.custom.push(row || { brand: cleanBrand, model: cleanModel });
  } catch (err) {
    if (err.code === "DUPLICATE") {
      vehicleCatalogState.custom.push({ brand: cleanBrand, model: cleanModel });
      return true;
    }
    if (!silent && !err.handled) showToast(`Listeye eklenemedi: ${err.message}`, "warning");
    return false;
  }
  if (!silent) showToast(cleanModel ? `"${cleanModel}" modeli ${cleanBrand} listesine eklendi.` : `"${cleanBrand}" markası listeye eklendi.`, "success");
  return true;
}

// ==========================================================================
// SEÇİM KUTUSU (yazarak ara, listeden seç, yoksa ekle)
// ==========================================================================
const PICKER_CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function brandAvatarHtml(name) {
  const logo = brandLogoSrc(name);
  if (logo) return html`<span class="picker-avatar"><img src="${logo}" alt="" loading="lazy"></span>`;
  return html`<span class="picker-avatar picker-avatar-text">${initials(name)}</span>`;
}

/**
 * Bir metin kutusunu açılır seçim listesine çevirir.
 * options(query) → [{ name, count }], onPick(name, { created }) seçimden sonra çağrılır.
 */
function createPicker({ input, kind, options, onPick, createLabel }) {
  const wrap = input.closest(".picker");
  const panel = wrap.querySelector(".picker-panel");
  const toggle = wrap.querySelector(".picker-toggle");
  let items = [];
  let active = -1;

  const close = () => {
    panel.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };

  const choose = async (item) => {
    close();
    input.value = item.name;
    if (item.create) await addToVehicleCatalog(...createLabel.args(item.name));
    onPick(item.name, { created: !!item.create });
  };

  const render = () => {
    const query = cleanCatalogText(input.value);
    const qKey = catalogKey(query);
    const all = options();
    const matches = qKey ? all.filter((o) => catalogKey(o.name).includes(qKey)) : all;
    items = matches.slice(0, 80);
    const exact = qKey && all.some((o) => catalogKey(o.name) === qKey);
    if (query && !exact) items.push({ name: query, create: true });

    if (!items.length) {
      panel.innerHTML = html`<div class="picker-empty">${createLabel.empty()}</div>`.toString();
    } else {
      panel.innerHTML = items.map((o, i) => html`<button type="button" class="picker-option${o.create ? " picker-option-create" : ""}" role="option" data-index="${i}" tabindex="-1">
        ${o.create ? rawHtml(`<span class="picker-avatar picker-avatar-add">+</span>`) : kind === "brand" ? brandAvatarHtml(o.name) : ""}
        <span class="picker-option-name">${o.create ? createLabel.text(o.name) : o.name}</span>
        ${o.count ? html`<span class="picker-option-count" title="Bu işletmedeki araç sayısı">${o.count}</span>` : ""}
      </button>`).map(String).join("");
    }
    panel.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    active = -1;
  };

  const highlight = (index) => {
    const buttons = panel.querySelectorAll(".picker-option");
    if (!buttons.length) return;
    active = (index + buttons.length) % buttons.length;
    buttons.forEach((b, i) => b.classList.toggle("highlighted", i === active));
    buttons[active].scrollIntoView({ block: "nearest" });
  };

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.addEventListener("focus", render);
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (panel.classList.contains("hidden")) render(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter" && !panel.classList.contains("hidden") && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") close();
  });
  // Listeden seçim, odak kaybından önce yakalanmalı (mobilde dokunma sırası).
  panel.addEventListener("pointerdown", (e) => e.preventDefault());
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest(".picker-option");
    if (btn) choose(items[Number(btn.dataset.index)]);
  });
  input.addEventListener("blur", () => {
    setTimeout(close, 120);
    // Yazılan değer listedeki bir seçenekle eşleşiyorsa listedeki yazımı kullan.
    const qKey = catalogKey(input.value);
    const hit = qKey && options().find((o) => catalogKey(o.name) === qKey);
    if (hit && hit.name !== input.value) input.value = hit.name;
    onPick(cleanCatalogText(input.value), { created: false, typed: true });
  });
  if (toggle) {
    toggle.addEventListener("pointerdown", (e) => e.preventDefault());
    toggle.addEventListener("click", () => {
      if (!panel.classList.contains("hidden")) return close();
      input.focus();
      render();
    });
  }
  return { close, open: render };
}

/**
 * Araç formundaki marka, model ve model yılı alanlarını bağlar.
 * prefix: "v" (yeni araç) veya "edit_v" (düzenleme).
 */
function setupVehicleFields(prefix) {
  const brandInput = document.getElementById(`${prefix}_brand`);
  const modelInput = document.getElementById(`${prefix}_model`);
  const yearSelect = document.getElementById(`${prefix}_year`);
  if (!brandInput || !modelInput) return;
  let currentBrandKey = "";
  let modelPicker = null;

  const syncModelState = () => {
    const hasBrand = !!cleanCatalogText(brandInput.value);
    modelInput.disabled = !hasBrand;
    modelInput.placeholder = hasBrand ? "Model seçin veya yazın" : "Önce marka seçin";
    const avatar = brandInput.closest(".picker").querySelector(".picker-leading");
    if (avatar) avatar.innerHTML = hasBrand ? brandAvatarHtml(canonicalBrandName(brandInput.value)).toString() : "";
    brandInput.closest(".picker").classList.toggle("has-leading", hasBrand);
  };

  createPicker({
    input: brandInput,
    kind: "brand",
    options: catalogBrands,
    createLabel: {
      text: (q) => `"${q}" markasını ekle`,
      empty: () => "Marka bulunamadı",
      args: (name) => [name, ""]
    },
    onPick: (name, { typed }) => {
      const key = catalogKey(name);
      if (key !== currentBrandKey) {
        currentBrandKey = key;
        if (!name || !catalogModels(name).some((m) => catalogKey(m.name) === catalogKey(modelInput.value))) modelInput.value = "";
      }
      syncModelState();
      if (name && !typed && !modelInput.value) {
        modelInput.focus();
        if (modelPicker) modelPicker.open();
      }
    }
  });

  modelPicker = createPicker({
    input: modelInput,
    kind: "model",
    options: () => catalogModels(brandInput.value),
    createLabel: {
      text: (q) => `"${q}" modelini ${canonicalBrandName(brandInput.value)} listesine ekle`,
      empty: () => "Bu marka için kayıtlı model yok — yazarak ekleyin",
      args: (name) => [brandInput.value, name]
    },
    onPick: () => {}
  });

  if (yearSelect && yearSelect.options.length <= 1) {
    const maxYear = new Date().getFullYear() + 1;
    for (let y = maxYear; y >= MIN_MODEL_YEAR; y--) yearSelect.add(new Option(String(y), String(y)));
  }

  brandInput._syncVehicleFields = (brand = brandInput.value) => {
    brandInput.value = brand ? canonicalBrandName(brand) : "";
    currentBrandKey = catalogKey(brandInput.value);
    syncModelState();
  };
  syncModelState();
}

/** Formu doldurur (düzenleme) veya temizler (yeni kayıt). */
function fillVehicleFields(prefix, { brand = "", model = "", modelYear = null } = {}) {
  const brandInput = document.getElementById(`${prefix}_brand`);
  const modelInput = document.getElementById(`${prefix}_model`);
  const yearSelect = document.getElementById(`${prefix}_year`);
  if (!brandInput) return;
  brandInput._syncVehicleFields(brand);
  modelInput.value = model || "";
  if (yearSelect) {
    if (modelYear && ![...yearSelect.options].some((o) => o.value === String(modelYear))) {
      yearSelect.add(new Option(String(modelYear), String(modelYear)));
    }
    yearSelect.value = modelYear ? String(modelYear) : "";
  }
  loadVehicleCatalog();
}

/** Form değerlerini okur; listede olmayan marka/model sessizce işletme kataloğuna eklenir. */
function readVehicleFields(prefix) {
  const brand = canonicalBrandName(document.getElementById(`${prefix}_brand`).value);
  const model = cleanCatalogText(document.getElementById(`${prefix}_model`).value);
  const yearValue = document.getElementById(`${prefix}_year`)?.value || "";
  return { brand, model, modelYear: yearValue ? Number(yearValue) : null };
}

function rememberVehicleCatalogEntry(brand, model) {
  if (!brand) return;
  if (!isInCatalog(brand)) addToVehicleCatalog(brand, "", { silent: true });
  if (model && !isInCatalog(brand, model)) addToVehicleCatalog(brand, model, { silent: true });
}

document.addEventListener("DOMContentLoaded", () => {
  setupVehicleFields("v");
  setupVehicleFields("edit_v");
});
