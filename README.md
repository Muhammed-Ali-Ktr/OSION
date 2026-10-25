# OSION — Oto Servisleri için Servis Takip

Oto tamir servisleri, elektrikçiler, kaportacılar ve usta dükkanları için müşteri, araç, servis kaydı, borç/alacak ve gelir takibi yapan web uygulaması.

- Her işletme kendi hesabını açar, ilk girişte **dükkan bilgilerini** (ad, telefon, adres, logo, para birimi, tarih biçimi, vergi bilgileri) doldurur.
- Her işletmenin verisi **veritabanı düzeyinde** (Supabase / PostgreSQL satır düzeyi güvenlik) ayrılır; bir işletme başka işletmenin kaydını göremez, değiştiremez, silemez.
- İşletme sahibi çalışanlarını **davet koduyla** ekler; roller: İşletme Sahibi, Yönetici, Çalışan.

Altyapı: ön yüz saf HTML/CSS/JavaScript; arka uç ve veritabanı **Supabase** (PostgreSQL + Auth). Sunucu kodu yoktur; tüm kurallar `supabase/migrations` içindeki SQL ile veritabanında uygulanır.

---

## Satış modelleri

| | Abonelik (aylık/yıllık) | Tek seferlik lisans |
|---|---|---|
| Altyapı | Ortak OSION Supabase projesi | Müşterinin kendi Supabase projesi |
| Kurulum | Müşteri siteden kayıt olur | Operatör kurar (aşağıdaki adımlar) |
| Plan | `basic` / `pro`, `current_period_end` ile süreli | `lifetime`, süresiz |

İki model de **aynı kodu ve aynı SQL dosyalarını** kullanır; yalnızca `config.js` farklıdır.

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
| Araç sahiplerine e-posta | Servis fişi ve hazır şablonlu mesajlar (aracınız hazır, bakım, ödeme hatırlatması) işletmenin kendi e-posta adresinden gönderilir |
| İşletme Ayarları | İşletme profili ve logo, ekip ve davetler, e-posta hesabı, abonelik bilgisi, şifre değiştirme, veri dışa aktarma, hesap kapatma |

### Roller

| Yetki | Sahip | Yönetici | Çalışan |
|---|:-:|:-:|:-:|
| Kayıt görüntüleme, ekleme, düzenleme, tahsilat | ✓ | ✓ | ✓ |
| Kayıt silme | ✓ | ✓ | – |
| İşletme profili, çalışan daveti/çıkarma | ✓ | ✓ (yalnız çalışanları çıkarır) | – |
| Yönetici daveti, rol değiştirme, veri dışa aktarma, hesabı kapatma | ✓ | – | – |

Yetkiler veritabanında uygulanır; arayüzdeki gizlemeler yalnızca kolaylık içindir.

---

## Sayfalar

| Adres | Dosyalar | Açıklama |
|---|---|---|
| `/` | `index.html`, `site.css`, `site.js` | Tanıtım sitesi: özellikler, paketler ve limitleri (fiyatlar veritabanından canlı gelir), SSS. "Giriş Yap" → `/panel#giris`, "Ücretsiz Dene" → `/panel#kayit` |
| `/panel` | `panel.html`, `platform.js`, `app.js`, `catalog.js`, `scanner.js`, `mail.js`, `style.css` | İşletme paneli (giriş, kayıt, davet ve uygulama) |
| `/admin` | `admin.html`, `admin.js`, `admin.css` | Sistem yönetimi: genel bakış, işletmeler, abonelikler ve ödemeler, duyurular, planlar ve fiyatlar, kullanıcılar, işlem kayıtları, giriş bilgilerim |

E-posta doğrulama / şifre sıfırlama / davet bağlantıları köke (`/`) gelirse otomatik olarak `/panel`'e yönlendirilir.

### Araç kaydı yenilikleri

- **Marka → model seçimi:** hazır liste `catalog.js` içindedir. Listede olmayan marka/model yazılınca işletmenin kendi listesine (`vehicle_catalog`) eklenir ve tüm ekip görür.
- **Model yılı** alanı (`vehicles.model_year`).
- **Şasi numarasını kamerayla okutma:** kapı direği etiketindeki barkod (Code 39/128, Data Matrix, QR) yerel ZXing (`vendor/zxing.min.js`) ile, ön cam/ruhsat yazısı Tesseract OCR ile okunur (yalnızca okutma açıldığında jsDelivr'den yüklenir). Okunan numara kaydetmeden önce kullanıcıya onaylatılır. Kamera yalnızca https üzerinde çalışır.
- **QR ile ekip daveti:** davet oluşturulunca QR gösterilir; yeni üye telefon kamerasıyla okutur veya giriş sayfasındaki *Davet Kodu → QR Kodu Okut* bölümünü kullanır.

### Sistem yöneticisi

`supabase/migrations/0004_platform_admin.sql` çalıştırıldıktan sonra yönetici hesabını SQL Editor'den bir kez ekleyin (hesap önce siteden normal şekilde oluşturulmuş olmalı):

```sql
insert into public.platform_admins (user_id)
  select id from auth.users where email = 'yonetici@ornek.com';
```

Yönetici, işletmelerle aynı giriş sayfasından girer; işletmesi yoksa doğrudan `/admin`'e yönlendirilir, varsa panel menüsünde **Sistem Yönetimi** bağlantısı görünür. Plan müşteri/araç/kullanıcı limitleri veritabanında uygulanır.

### Güncelleme sırası (mevcut kurulum)

1. SQL Editor'de sırayla `0003_vehicle_catalog.sql` ve `0004_platform_admin.sql` dosyalarını çalıştırın.
2. Yönetici hesabını ekleyin (yukarıdaki SQL).
3. Siteyi yeniden yayınlayın (`npx vercel --prod`). Sıra önemlidir: model yılı sütunu yoksa uygulama yılı kaydetmeden çalışmaya devam eder, ancak katalog/yönetim özellikleri göç olmadan çalışmaz.

---

## Dosya yapısı

```
index.html                 Tanıtım sitesi (site.css, site.js)
panel.html                 Uygulama kabuğu, giriş/kurulum ekranları, sayfalar ve modaller
admin.html                 Sistem yönetimi paneli (admin.js, admin.css)
catalog.js                 Araç marka/model kataloğu ve seçim kutuları
scanner.js                 Kamera ile şasi no / davet QR okuma, QR üretimi
vendor/                    ZXing barkod kütüphanesi (Apache-2.0)
kullanim-kosullari.html    Kullanım Koşulları (taslak, doldurulmalı)
gizlilik.html              KVKK Aydınlatma Metni (taslak, doldurulmalı)
vercel.json                Vercel yayın ayarları ve güvenlik başlıkları
tools/build.js             Yayın paketi (dist/) ve CSP üretimi
style.css                  Tema ve bileşen stilleri
config.js                  Dağıtım ayarları: Supabase adresi ve anon anahtarı, ürün adı
platform.js                Supabase istemcisi, oturum, giriş/kayıt/davet, kurulum sihirbazı, işletme ayarları
app.js                     Müşteri/araç/servis ekranları, grafikler, arama
mail.js                    İşletme e-posta ayarları, servis fişi ve müşteri mesajı gönderimi
supabase/migrations/       Veritabanı şeması, güvenlik kuralları (RLS) ve fonksiyonlar
supabase/functions/send-mail/  E-postayı işletmenin SMTP hesabıyla gönderen Edge Function
supabase/templates/        Supabase hesap e-postalarının Türkçe şablonları
tests/                     Veritabanı (gömülü Postgres) ve e-posta içeriği testleri
tools/dev-server.js        Yerel geliştirme sunucusu
```

---

## Yerel geliştirme ve testler

Gereksinim: Node.js 18+.

```bash
npm install
```

```bash
npm test
```

```bash
npm run dev
```

`npm run dev` uygulamayı http://localhost:8787 adresinde açar; veriler `config.js`'teki Supabase projesine gider.

---

## Yayına alma (Vercel)

`vercel.json` hazırdır: Vercel `node tools/build.js` ile yalnızca uygulama dosyalarını `dist/` klasörüne paketler ve güvenlik başlıklarını (CSP, HSTS, X-Frame-Options vb.) ekler. Yasal metinlerde doldurulmamış `[DOLDURUN: …]` alanları yayını durdurmaz; sitede "(güncellenecek)" olarak görünür ve build uyarı verir. Alanları doldurup yeniden yayınlamanız yeterlidir. Boş alan varken yayını durdurmak isterseniz build komutunu `node tools/build.js --siki` yapın.

Yerelde yayın paketini denemek için:

```bash
npm run preview
```

### Kontrol listesi

1. `kullanim-kosullari.html` ve `gizlilik.html` içindeki `[DOLDURUN: …]` alanlarını (müsait olduğunuzda) doldurup yeniden yayınlayın; metinleri bir avukata kontrol ettirin.
2. `config.js` → `supportContact` alanına destek e-postanızı yazın.
3. `send-mail` Edge Function'ını dağıtın (aşağıda).
4. Projeyi Vercel'e yükleyin:
   ```bash
   npx vercel --prod
   ```
   İlk çalıştırmada Vercel hesabınıza giriş yapıp yeni proje (`osion`) oluşturmayı onaylayın; ayarları değiştirmeyin (`vercel.json` kullanılır).
5. Alan adı: Vercel proje ayarları > **Domains** bölümünden alan adınızı ekleyin ve gösterilen DNS kayıtlarını alan adı sağlayıcınıza girin.
6. Supabase **Authentication > URL Configuration**:
   - Site URL: `https://alanadiniz.com` (yayın adresi)
   - Redirect URLs: `https://alanadiniz.com/**` ve geliştirme için `http://localhost:8787`
7. Brevo'da alan adınızı doğrulayın (SPF/DKIM) ve SMTP gönderen adresini `bildirim@alanadiniz.com` gibi alan adınıza ait bir adres yapın.
8. Supabase planı: Ücretsiz projeler 7 gün kullanılmazsa **duraklatılır** ve otomatik yedek almaz. Gerçek müşterilerden önce **Pro** plana (aylık ~25 $, günlük yedek) geçin.
9. Supabase **Advisors > Security Advisor** sayfasında uyarı kalmadığını kontrol edin.
10. Yayından sonra: kayıt → e-posta doğrulama → kurulum → müşteri/araç/servis kaydı → servis fişi e-postası akışını gerçek adreste baştan sona deneyin.

## Supabase kurulumu (yeni proje)

1. Supabase'de proje oluşturun (bölge: **Frankfurt / eu-central-1**).
2. **SQL Editor** → `supabase/migrations/` içindeki dosyaları sırayla yapıştırıp **Run** ile çalıştırın.
3. **Authentication > URL Configuration**
   - Site URL: uygulamanın yayın adresi (ör. `https://osion.com.tr`)
   - Redirect URLs: yayın adresi ve geliştirme için `http://localhost:8787`
4. **Authentication > Providers > Email**: "Confirm email" açık kalsın; en az şifre uzunluğunu **8** yapın.
5. **Hesap e-postaları (SMTP)** — Supabase'in yerleşik e-posta servisi yalnızca proje ekibindeki adreslere ve saatte birkaç e-posta gönderir; gerçek müşteriler için aşağıdaki "Brevo SMTP" adımlarını uygulayın.
6. **Authentication > Emails > Templates**: `supabase/templates/` içindeki şablonları ilgili sekmelere yapıştırın:

   | Sekme | Dosya | Konu |
   |---|---|---|
   | Confirm signup | `confirmation.html` | OSION hesabınızı doğrulayın |
   | Reset Password | `recovery.html` | OSION şifre sıfırlama |
   | Change Email Address | `email_change.html` | OSION e-posta adresi değişikliği |
7. **Project Settings > API**: Project URL ve `anon` anahtarını `config.js`'e yazın. `service_role` anahtarını asla ön yüze koymayın.
8. **send-mail Edge Function** (araç sahiplerine e-posta için) — aşağıdaki "Edge Function dağıtımı" adımlarını uygulayın.
9. Statik dosyaları (`index.html`, `style.css`, `config.js`, `platform.js`, `app.js`, `mail.js`, `car logo/`) bir statik barındırmaya (Vercel, Netlify vb.) yükleyin. `supabase/`, `tests/`, `tools/` ve `node_modules/` yayınlanmamalıdır.

### Brevo SMTP (ortak abonelik projesi)

1. [brevo.com](https://www.brevo.com) üzerinde ücretsiz hesap açın (günde 300 e-posta).
2. **Senders, Domains & Dedicated IPs > Senders**: gönderen adresini (ör. `bildirim@alanadiniz.com` veya kendi e-postanız) ekleyip doğrulayın. Alan adınız olduğunda **Domains** bölümünden alan adını da doğrulayın (SPF/DKIM); e-postaların spam'e düşmemesi için önemlidir.
3. **SMTP & API > SMTP** sekmesinde bir **SMTP key** oluşturun.
4. Supabase **Authentication > Emails > SMTP Settings** → "Enable Custom SMTP":
   - Sender email: Brevo'da doğruladığınız adres · Sender name: `OSION`
   - Host: `smtp-relay.brevo.com` · Port: `587`
   - Username: Brevo SMTP sayfasındaki "Login" değeri · Password: oluşturduğunuz SMTP key
5. **Authentication > Rate Limits**: "Rate limit for sending emails" değerini ihtiyaca göre (ör. saatte 100) yükseltin.

### Edge Function dağıtımı (send-mail)

Bir kez yapılır; kod güncellenince 3. komut tekrar çalıştırılır.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <proje-ref>
```

```bash
npx supabase functions deploy send-mail
```

`<proje-ref>`, proje adresindeki alt alan adıdır (`https://<proje-ref>.supabase.co`). Fonksiyonun ihtiyaç duyduğu `SUPABASE_URL`, `SUPABASE_ANON_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` değerlerini Supabase otomatik sağlar; ek ayar gerekmez.

### Araç sahiplerine e-posta (işletmenin kendi adresi)

- İşletme sahibi/yöneticisi e-posta hesabını ilk kurulumun son adımında veya **İşletme Ayarları > E-posta** bölümünden ekler, ardından **Test E-postası Gönder** ile doğrular.
- Desteklenen sağlayıcılar: Gmail/Google Workspace, Yandex, Yahoo ve 465 (SSL) portunu destekleyen diğer sunucular. Supabase Edge Functions 25 ve 587 portlarına bağlanamadığı için Outlook/Hotmail desteklenmez.
- Gmail için hesapta 2 Adımlı Doğrulama açık olmalı ve <https://myaccount.google.com/apppasswords> adresinden uygulama şifresi alınmalıdır.
- Uygulama şifresi Supabase Vault'ta şifreli saklanır; tarayıcıya ve veritabanı kullanıcılarına hiçbir zaman geri gönderilmez.
- Alıcı her zaman veritabanındaki müşteri e-postasıdır; işletme başına 24 saatte en fazla 200 e-posta gönderilir. Gönderimler `mail_log` tablosuna yazılır.

### Tek seferlik lisans kurulumu

1. Müşteri adına (müşterinin hesabında) yeni bir Supabase projesi açın ve yukarıdaki 1–6. adımları uygulayın.
2. Müşterinin işletme sahibi hesabı uygulamadan kayıt olur.
3. SQL Editor'de işletmeyi süresiz lisansa geçirin:
   ```sql
   select private.set_tenant_plan((select id from public.tenants limit 1), 'lifetime', 'active', null);
   ```
4. Başkasının bu kuruluma kayıt olmaması için **Authentication > Providers > Email > Allow new users to sign up** seçeneğini kapatın (çalışanlar davet koduyla eklenmeye devam eder).
5. **Hesap e-postaları müşterinin kendi Gmail'inden gider:** Müşterinin Google hesabında 2 Adımlı Doğrulama açıp <https://myaccount.google.com/apppasswords> adresinden uygulama şifresi alın. Müşterinin projesinde **Authentication > Emails > SMTP Settings** → "Enable Custom SMTP":
   - Sender email: müşterinin Gmail adresi · Sender name: işletme adı
   - Host: `smtp.gmail.com` · Port: `465`
   - Username: müşterinin Gmail adresi · Password: 16 haneli uygulama şifresi (boşluksuz)
6. `send-mail` Edge Function'ını müşterinin projesine de dağıtın (`npx supabase link --project-ref <müşteri-proje-ref>` ardından deploy). Araç sahiplerine e-posta için müşteri aynı Gmail ve uygulama şifresini **İşletme Ayarları > E-posta** bölümüne girer.

---

## Operatör işlemleri (SQL Editor)

| Komut | Ne yapar |
|---|---|
| `select private.set_tenant_plan('<işletme-id>', 'pro', 'active', now() + interval '1 month');` | Planı ve abonelik dönem sonunu atar. Planlar: `trial`, `basic`, `pro`, `lifetime`; durumlar: `trialing`, `active`, `past_due`, `canceled`. |
| `select private.set_tenant_plan('<işletme-id>', 'lifetime', 'active', null);` | Süresiz lisans. |
| `select private.restore_tenant('<işletme-id>');` | Kapatılmış ama henüz silinmemiş işletmeyi geri açar. |
| `select private.purge_closed_tenants();` | Saklama süresi (30 gün) dolan kapalı işletmeleri kalıcı siler. `pg_cron` etkinse her gün 03:00'te otomatik çalışır. |
| `select id, name, plan_id, subscription_status, trial_ends_at, current_period_end from public.tenants;` | İşletmeleri ve aboneliklerini listeler. |

Planların kullanıcı sınırları `public.plans` tablosundadır.

### Abonelik kuralı

Yazma (kayıt ekleme/düzenleme/silme) şu durumlarda açıktır; aksi halde işletme verilerini yalnızca **okuyabilir**:

- `trialing` ve `trial_ends_at` gelecekte (yeni işletmeler 30 gün deneme ile başlar),
- `active` ve `current_period_end` boş (süresiz) ya da en fazla 3 gün geçmiş,
- `past_due` ve `current_period_end` en fazla 7 gün geçmiş.

Ödeme sağlayıcısı (iyzico / PayTR) entegrasyonu henüz yoktur; planlar operatör tarafından elle atanır.

---

## Güvenlik modeli

- **İşletme izolasyonu veritabanında:** Müşteri, araç ve servis tablolarında RLS yalnızca kullanıcının aktif üyesi olduğu işletmelerin satırlarına izin verir. Araç–müşteri ve servis–araç ilişkileri `(tenant_id, id)` bileşik yabancı anahtarıyla kurulduğundan başka işletmenin kaydına bağlanmak imkânsızdır. Kayıtların `tenant_id`, `id` ve `created_at` alanları güncellemeyle değiştirilemez.
- **Yetkiler:** Silme yalnızca sahip/yöneticiye açıktır. Plan ve abonelik sütunlarını kullanıcılar değiştiremez (sütun yetkileri). Ekip ve davet işlemleri rol denetimli veritabanı fonksiyonlarıyla yapılır; üyelikten çıkarılan kullanıcının erişimi bir sonraki istekte kesilir.
- **Kimlik doğrulama:** Supabase Auth (e-posta doğrulama, şifre sıfırlama, oturum yenileme). Davet kodları 96 bit rastgeledir ve yalnızca SHA-256 özetiyle saklanır.
- **İş kuralları sunucuda:** Servis toplamı usta ücretlerinin toplamı olarak veritabanında hesaplanır; istemcinin gönderdiği toplam yok sayılır.
- **XSS:** Kullanıcı verisi içeren tüm HTML, otomatik kaçışlayan `html` şablonuyla üretilir; logo olarak yalnızca PNG/JPEG/WEBP kabul edilir.
- **E-posta şifreleri:** İşletmelerin SMTP uygulama şifreleri Supabase Vault'ta şifreli tutulur; yalnızca `send-mail` Edge Function'ı (service_role) çözebilir. Alıcı adresi istemciden alınmaz, veritabanındaki müşteri kaydından okunur.
- **Denetim kaydı:** `audit_log` tablosu yalnızca kimlikleri (işletme, kullanıcı, kayıt) içerir; kişisel veri yazılmaz.
- **Tarayıcı önbelleği:** Çevrimdışı salt okunur görüntüleme için son veriler işletme+kullanıcı anahtarıyla saklanır ve çıkışta silinir.

---

## Lisans ve yasal

Ürün ücretli satılacağı için satış öncesinde lisans/kullanım koşulları, mesafeli satış sözleşmesi, KVKK aydınlatma metni ve (veriler yurt dışında barındırıldığı için) yurt dışına aktarım hükümleri netleştirilmelidir.
