/**
 * Dağıtım yapılandırması (işletmelere değil, hizmeti işleten tarafa aittir).
 *
 * apiUrl      : Google Apps Script web uygulaması adresi (".../exec"). Gizli değildir;
 *               tüm veri erişimi sunucuda oturum ve işletme yetkisiyle korunur.
 *               Boş bırakılırsa uygulama kurulum uyarısı gösterir.
 * productName : Giriş ekranında ve tarayıcı başlığında görünen ürün adı.
 * supportContact : Kapalı kayıt, plan değişikliği gibi durumlarda gösterilen iletişim bilgisi (isteğe bağlı).
 *
 * Yerel geliştirmede `npm run dev` bu dosyadaki apiUrl'i otomatik olarak yerel sunucuya yönlendirir.
 */
window.OTO_TAKIP_CONFIG = {
  // Önceki sürümde app.js içine gömülü olan dağıtım adresi. Yeni code.gs aynı dağıtıma
  // "yeni sürüm" olarak yüklenirse adres değişmez (bkz. README > Sunucu kurulumu).
  apiUrl: "https://script.google.com/macros/s/AKfycbyEjKLeIdZH0IUuANWubS6seveDg83t2lUb7O4Kahw_qBl-hynETiIe_zHLzg8H1UOcEg/exec",
  productName: "OtoTakip",
  supportContact: ""
};
