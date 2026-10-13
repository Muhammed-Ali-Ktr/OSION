/**
 * Dağıtım yapılandırması (işletmelere değil, hizmeti işleten tarafa aittir).
 *
 * supabaseUrl     : Supabase proje adresi (Project Settings > API > Project URL).
 * supabaseAnonKey : Supabase "anon" (public) anahtarı. Tarayıcıda herkese açık olacak şekilde
 *                   tasarlanmıştır; tüm veri erişimi veritabanındaki RLS kurallarıyla korunur.
 *                   "service_role" anahtarını ASLA buraya yazmayın.
 * productName     : Giriş ekranında ve tarayıcı başlığında görünen ürün adı.
 * supportContact  : Plan değişikliği gibi durumlarda gösterilen iletişim bilgisi (isteğe bağlı).
 *
 * Tek seferlik lisans kurulumlarında bu dosya müşterinin kendi Supabase projesinin
 * bilgileriyle doldurulur; uygulama kodu aynıdır.
 */
window.OSION_CONFIG = {
  supabaseUrl: "https://gllyfkscgxpjgemlshxm.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsbHlma3NjZ3hwamdlbWxzaHhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MDE2NDgsImV4cCI6MjEwNzQ3NzY0OH0.1pt-VytYIIp-bdUrc5i-HTTc1-gUhj7vz_nchvx8usQ",
  productName: "OSION",
  supportContact: ""
};
