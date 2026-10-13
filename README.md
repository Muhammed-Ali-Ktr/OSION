# OtoTakip — Oto Servisleri için Çok İşletmeli Servis Takip

Oto tamir servisleri, elektrikçiler, kaportacılar ve usta dükkanları için müşteri, araç, servis kaydı, borç/alacak ve gelir takibi yapan web uygulaması. Sürüm 2 ile uygulama **tek bir dükkana özel** olmaktan çıkıp **birden fazla işletmeye satılabilen** (multi-tenant) bir yapıya geçti:

- Her işletme kendi hesabını açar, ilk girişte **dükkan bilgilerini** (ad, telefon, adres, logo, para birimi, tarih biçimi, vergi bilgileri) doldurur.
- Uygulama başlığı, menü, tutar ve tarih gösterimleri o işletmenin ayarlarına göre çalışır.
- Her işletmenin verisi **sunucu tarafında** ayrılır; bir işletme başka işletmenin kaydını göremez, değiştiremez, silemez.
- İşletme sahibi çalışanlarını **davet koduyla** ekler; roller: İşletme Sahibi, Yönetici, Çalışan.

Altyapı değişmedi: ön yüz saf HTML/CSS/JavaScript, arka uç **Google Apps Script** (`code.gs`), veritabanı **Google E-Tablolar**. Yeni çalışma zamanı bağımlılığı eklenmedi.

---

## Özellikler

| Bölüm | Açıklama |
|---|---|
| Genel Durum Paneli | Müşteri/araç sayısı, toplam borç ve tahsilat, son 6 ayın iş hacmi grafiği, ödeme dağılımı, borçlu araçlar |
| Müşteri & Araç Kayıt | Müşteri ve araç ekleme, hızlı arama |
| Müşteriler / Araçlar | Kartlar, marka klasörleri, işlem geçmişi, düzenleme |
| Tarihler | Günlere göre araç giriş takvimi |
| Servis Girişi | 16 iş koluna göre usta ücretleri, kısmi/nakit/havale/kart ödeme |
| Servis Notları / Borç Listesi | Geçmiş kayıtlar, tahsilat |
| **İşletme Ayarları** (yeni) | İşletme profili ve logo, ekip ve davetler, abonelik bilgisi, şifre değiştirme, veri dışa aktarma, hesap kapatma |

### Roller

| Yetki | Sahip | Yönetici | Çalışan |
|---|:-:|:-:|:-:|
| Kayıt görüntüleme, ekleme, düzenleme, tahsilat | ✓ | ✓ | ✓ |
| Kayıt silme | ✓ | ✓ | – |
| İşletme profili, çalışan daveti/çıkarma | ✓ | ✓ (yalnız çalışanları çıkarır) | – |
| Yönetici daveti, rol değiştirme, veri dışa aktarma, hesabı kapatma | ✓ | – | – |

Yetkiler sunucuda (`code.gs`) uygulanır; arayüzdeki gizlemeler yalnızca kolaylık içindir.

---

## Dosya yapısı

```
index.html        Uygulama kabuğu, giriş/kurulum ekranları, sayfalar ve modaller
style.css         Tema ve bileşen stilleri (açık/koyu tema, mobil uyum)
config.js         Dağıtım ayarları: API adresi, ürün adı, destek iletişimi
platform.js       Oturum, API istemcisi, giriş/kayıt/davet, kurulum sihirbazı, işletme ayarları, biçimlendirme
app.js            Müşteri/araç/servis ekranları, grafikler, arama
code.gs           Google Apps Script arka ucu (kimlik doğrulama, işletme kapsamı, veri erişimi, geçiş)
tools/
  gas-runtime.js  Apps Script ortamının Node.js taklidi (test ve yerel geliştirme için)
  dev-server.js   Yerel geliştirme sunucusu
  legacy-seed.js  Eski (v1) E-Tablo yapısında örnek veri
tests/            Otomatik testler (node:test)
yedek-v1/         Bu dönüşümden önceki dosyaların birebir kopyası
```

---

## Yerel geliştirme ve testler

Gereksinim: Node.js 18+ (bağımlılık kurulumu gerekmez).

```bash
npm test
```

```bash
npm run dev
```

`npm run dev` uygulamayı http://localhost:8787 adresinde açar ve gerçek `code.gs` dosyasını bellek içi sahte bir E-Tablo üzerinde çalıştırır; Google hesabı gerekmez. Veriler `.dev-data/` klasöründe saklanır (git'e eklenmez).

```bash
npm run dev:legacy
```

Eski tek işletmeli örnek verileri oluşturur, geçişi çalıştırır ve sahip davet kodunu terminale yazar (yalnızca yerel deneme ortamında). Kodla **Davet Kodu** sekmesinden hesap açıp geçiş akışını uçtan uca deneyebilirsiniz.

---

## Sunucu (Apps Script) kurulumu

### Yeni kurulum

1. Google Drive'da yeni bir E-Tablo oluşturun → **Uzantılar > Apps Script**.
2. `code.gs` içeriğini yapıştırıp kaydedin.
3. **Dağıt > Yeni dağıtım > Web uygulaması**
   - Şu kişi olarak çalıştır: **Ben**
   - Erişimi olan kişiler: **Herkes**
   (Erişim herkese açık olsa da veri döndüren her işlem oturum ister; `doGet` hiçbir veri döndürmez.)
4. Verilen `.../exec` adresini `config.js` içindeki `apiUrl` alanına yazın.
5. Statik dosyaları (`index.html`, `style.css`, `config.js`, `platform.js`, `app.js`, `car logo/`) herhangi bir statik barındırmaya (GitHub Pages, Netlify, Vercel vb.) yükleyin. `tools/`, `tests/`, `yedek-v1/` ve `.dev-data/` yayınlanmamalıdır.

Sayfalar (`Tenants`, `Users`, `Memberships`, `Sessions`, `Invitations`, `AuditLog`, `Customers`, `Vehicles`, `ServiceRecords`) ilk istekte otomatik oluşturulur.

### Ortam ayarları (Script Properties)

Apps Script düzenleyicisinde **Proje Ayarları > Komut dosyası özellikleri** altından tanımlanır. Hepsi isteğe bağlıdır; gizli anahtar kaynak koda yazılmaz.

| Anahtar | Varsayılan | Açıklama |
|---|---|---|
| `SIGNUP_MODE` | `open` | `open`: herkes işletme hesabı açabilir. `closed`: yeni işletmeler yalnızca operatörün `provisionTenant()` ile oluşturduğu sahip davet koduyla açılır. |
| `SIGNUP_HOURLY_LIMIT` | `20` | Saatte açılabilecek en fazla yeni işletme (kötüye kullanım sınırı). |
| `DATA_RETENTION_DAYS` | `30` | Kapatılan işletmenin verisinin kalıcı silinmeden önce saklanacağı gün sayısı. |
| `LEGACY_TENANT_NAME` | `İşletmem` | Eski verilerin bağlanacağı varsayılan işletmenin başlangıç adı (sahibi kurulumda değiştirir). |
| `BILLING_PROVIDER` | – | Ödeme sağlayıcısı entegre edildiğinde doldurulacak; şu an yalnızca arayüzdeki bilgilendirmeyi etkiler. |

Sistem tarafından yazılan anahtarlar: `SCHEMA_VERSION`, `LEGACY_TENANT_ID`, `LEGACY_BACKUP_ID`, `OWNER_CLAIM_<işletmeId>` (tek kullanımlık sahip davet kodu; kullanıldığında silinir).

`config.js` alanları: `apiUrl` (Apps Script adresi), `productName` (giriş ekranı ve sekme başlığındaki ürün adı), `supportContact` (plan/hesap işlemleri için gösterilecek iletişim bilgisi).

### Operatör fonksiyonları (Apps Script düzenleyicisinden çalıştırılır)

| Fonksiyon | Ne yapar |
|---|---|
| `migrateLegacyData()` | Eski tek işletmeli verileri varsayılan işletmeye bağlar (aşağıya bakın). |
| `provisionTenant('İşletme Adı')` | Yeni işletme + sahip davet kodu oluşturur (kapalı kayıt modu için). Düzenleyicide `function calistir(){ provisionTenant('Yıldız Oto'); }` gibi bir sarmalayıcıyla çalıştırın. |
| `setTenantPlan(tenantId, planId, durum)` | Plan/abonelik durumunu elle atar. Planlar: `trial`, `basic`, `pro`, `legacy`; durumlar: `trialing`, `active`, `past_due`, `canceled`. |
| `restoreTenant(tenantId)` | Kapatılmış ama henüz silinmemiş işletmeyi geri açar. |
| `dailyMaintenance()` | Saklama süresi dolan kapalı işletmelerin verisini kalıcı siler, eski oturumları temizler. **Tetikleyiciler > Zamana dayalı > Günlük** olarak kurulması önerilir. |

---

## Mevcut (v1) kurulumdan geçiş

Eski sürüm tüm verileri tek bir E-Tabloda, işletme ayrımı olmadan tutuyordu. Geçiş **veri silmez** ve **tekrar çalıştırılabilir**.

1. **Ön yüzü ve sunucuyu birlikte güncelleyin.** Eski ön yüz yeni sunucuyla, yeni ön yüz eski sunucuyla çalışmaz.
2. Apps Script'te `code.gs` içeriğini yenisiyle değiştirin. **Dağıt > Dağıtımları yönet > (mevcut dağıtım) > Düzenle > Sürüm: Yeni sürüm** ile yayınlayın; böylece adres değişmez (adres `config.js` içinde zaten tanımlı). Yeni dağıtım oluşturursanız `config.js` → `apiUrl` değerini güncelleyin.
3. (İsteğe bağlı) `LEGACY_TENANT_NAME` özelliğine dükkan adını yazın.
4. Düzenleyicide `migrateLegacyData` fonksiyonunu seçip **Çalıştır**'a basın. Fonksiyon:
   - Taşınacak satır varsa önce E-Tablonun **tam bir kopyasını** Drive'a alır (`LEGACY_BACKUP_ID`),
   - Mevcut sütunlara dokunmadan `tenantId` ve `updatedAt` sütunlarını **sona ekler**,
   - `tenantId`'si boş tüm müşteri/araç/servis satırlarını varsayılan işletmeye bağlar,
   - İşletmenin sahibi yoksa tek kullanımlık bir **sahip davet kodu** üretir ve `OWNER_CLAIM_<işletmeId>` özelliğine yazar (kod loglanmaz).
5. Dükkan sahibi uygulamada **Davet Kodu** sekmesinden bu kodla e-posta ve şifresini belirler, kurulum sihirbazını tamamlar ve eski verilerini görür.

Notlar:
- Geçiş çalıştırılana kadar eski satırlar silinmez ama **hiçbir kullanıcıya görünmez** (işletmesi belirsiz veri varsayılan olarak gizlenir).
- Geçiş tekrar çalıştırılırsa yalnızca hâlâ işletmesiz satırları bağlar; geçerli sahip kodunu yeniden üretmez, yedeği bir kez alır.
- Tarayıcıda eski sürümün `oto_takip_local_db` ve `oto_takip_api_url` anahtarları silinmez ve yeni sürüm tarafından kullanılmaz. Yalnızca yerel modda (Sheets bağlantısı olmadan) kullanılmış veriler varsa bunlar otomatik içe aktarılmaz.

---

## Güvenlik modeli

- **İşletme kapsamı sunucuda:** Her istek bir oturum anahtarı taşır; sunucu oturumdan kullanıcıyı, üyeliği ve işletmeyi bulur. İstemcinin gönderdiği `tenantId`/`id`/`createdAt` gibi alanlar yok sayılır. Tüm okuma, güncelleme ve silmeler `id` **ve** `tenantId` eşleşmesiyle yapılır; başka işletmenin kaydı "bulunamadı" yanıtı alır. Araç–müşteri ve servis–araç bağlantıları da aynı işletme içinde doğrulanır.
- **Kimlik doğrulama:** Şifreler PBKDF2-HMAC-SHA256 (tuzlu, 4.000 tur) ile saklanır; oturum anahtarları ve davet kodları yalnızca SHA-256 özetleriyle saklanır. 5 hatalı girişte hesap 15 dakika kilitlenir. Oturum 7 gün geçerlidir; çıkış, şifre değişikliği, üyelikten çıkarma ve hesap kapatma ilgili oturumları anında geçersiz kılar.
- **Formül enjeksiyonu:** `=`, `+`, `-`, `@` ile başlayan metinler hücreye düz metin olarak yazılır; kullanıcı girdisi E-Tabloda formül çalıştıramaz.
- **XSS:** Kullanıcı verisi içeren tüm HTML, otomatik kaçışlayan `html` şablonuyla üretilir; logo olarak yalnızca PNG/JPEG/WEBP kabul edilir (SVG kabul edilmez).
- **Eşzamanlılık:** Yazma işlemleri Apps Script betik kilidi altında yapılır.
- **Loglama:** Beklenmeyen hatalarda yalnızca işlem adı ve hata mesajı loglanır; istek içeriği (müşteri bilgisi, şifre) loglanmaz. `AuditLog` sayfası yalnızca kimlikleri (işletme, kullanıcı, kayıt) içerir.
- **Tarayıcı önbelleği:** Çevrimdışı salt okunur görüntüleme için son veriler işletme+kullanıcı anahtarıyla saklanır ve çıkışta silinir.

Bilinen sınırlar (Google Sheets altyapısı nedeniyle): veritabanı düzeyinde kısıt veya satır düzeyi güvenlik yoktur, bu nedenle tüm erişim `code.gs`'teki tek veri erişim katmanından geçer. E-Tabloyu düzenleme yetkisi olan herkes (betik sahibi) tüm işletmelerin verisini görür.

---

## Abonelik ve ödeme

Ödeme sağlayıcısı entegrasyonu **yoktur**; uygulama gerçek ödeme alıyormuş gibi davranmaz. Hazır olan temel:

- `Tenants` sayfasında `planId`, `subscriptionStatus`, `trialEndsAt`, `billingProvider`, `billingCustomerId`, `billingSubscriptionId`, `currentPeriodEnd` alanları.
- `code.gs` içindeki `PLANS` kataloğu (kullanıcı sınırı davetlerde uygulanır).
- Yeni işletmeler 30 günlük `trial` planla başlar; deneme süresi dolduğunda erişim **kısıtlanmaz** (ödeme altyapısı olmadan kilitleme yapılmaz).
- Operatör planı `setTenantPlan()` ile elle yönetir.

Entegrasyon yapılacaksa: sağlayıcının (ör. iyzico, Stripe) webhook'unu doğrulayan ayrı bir uç nokta, `subscriptionStatus`'a göre erişim kuralı ve gizli anahtarların Script Properties'te tutulması gerekir.

---

## Lisans

Önceki sürümün README'si projeyi "açık kaynak ve ücretsiz" olarak tanımlıyordu. Ürün ücretli satılacaksa lisans, kullanım koşulları ve KVKK aydınlatma metni satış öncesinde netleştirilmelidir.
