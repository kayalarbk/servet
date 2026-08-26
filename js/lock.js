/* =====================================================================
   lock.js — PIN ile şifreli saklama (Web Crypto, AES-GCM + PBKDF2)

   Açıkken portföy localStorage'da düz metin yerine şifreli tutulur.
   Anahtar yalnızca girilen PIN'den türetilir; hiçbir yerde saklanmaz.

   GÜVENLİK NOTU: PIN unutulursa veri KURTARILAMAZ. Bu yüzden şifreleme
   açılmadan önce yedek indirmek zorunludur ve PIN iki kez sorulur.
   ===================================================================== */
window.Lock = (function () {
  'use strict';

  const KEY_ENC = 'servet.v1.enc';     // {v, salt, iv, data} — base64
  const KEY_PLAIN = 'servet.v1';
  const ITER = 250000;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const supported = () => !!(window.crypto && crypto.subtle && window.isSecureContext);

  async function deriveKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin),
      'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encryptText(text, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pin, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv },
      key, new TextEncoder().encode(text));
    return JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) });
  }

  async function decryptText(blob, pin) {
    const o = JSON.parse(blob);
    const key = await deriveKey(pin, unb64(o.salt));
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) },
      key, unb64(o.data));
    return new TextDecoder().decode(out);
  }

  const isEnabled = () => !!localStorage.getItem(KEY_ENC);

  /* ---------------- Açılışta kilit ekranı ----------------
     index.html içinde, uygulama başlamadan önce çağrılır.
     Çözülen düz metni localStorage'a geçici olarak yazar ki Store normal
     çalışsın; sayfa kapanırken/gizlenirken düz kopya tekrar silinir.      */
  function unlockScreen() {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'lock-screen';
      wrap.innerHTML = `
        <div class="lock-card">
          <div class="splash-word" style="font-size:34px;padding:10px 18px">
            <span class="ser">S</span><span class="ser">E</span><span class="ser">R</span><span class="vet">V</span><span class="vet">E</span><span class="vet">T</span>
          </div>
          <h2>Portföyünüz kilitli</h2>
          <p>Verileriniz bu cihazda şifreli saklanıyor. Devam etmek için PIN'inizi girin.</p>
          <form id="lockForm" autocomplete="off">
            <input id="lockPin" type="password" inputmode="numeric" autocomplete="current-password"
              placeholder="PIN" aria-label="PIN" maxlength="64">
            <p class="lock-err" id="lockErr" hidden></p>
            <button class="btn btn-gold" type="submit" id="lockGo">Kilidi aç</button>
          </form>
          <details class="lock-help">
            <summary>PIN'imi unuttum</summary>
            <p>PIN yalnızca sizde olduğu için şifreli veri <b>kurtarılamaz</b>. Elinizde JSON yedek
              varsa verileri sıfırlayıp yedekten geri yükleyebilirsiniz.</p>
            <button class="btn btn-sm btn-danger" id="lockReset" type="button">Şifreli veriyi sil ve sıfırdan başla</button>
          </details>
        </div>`;
      document.body.appendChild(wrap);
      setTimeout(() => $('#lockPin', wrap).focus(), 80);

      const fail = msg => {
        const e = $('#lockErr', wrap);
        e.textContent = msg; e.hidden = false;
        $('#lockPin', wrap).value = '';
        $('#lockPin', wrap).focus();
      };

      $('#lockForm', wrap).addEventListener('submit', async ev => {
        ev.preventDefault();
        const pin = $('#lockPin', wrap).value;
        if (!pin) return;
        const btn = $('#lockGo', wrap);
        btn.disabled = true; btn.textContent = 'Çözülüyor…';
        try {
          const text = await decryptText(localStorage.getItem(KEY_ENC), pin);
          JSON.parse(text);                       // bozuk çözüm erken yakalanır
          localStorage.setItem(KEY_PLAIN, text);  // Store bunu okuyacak
          session.pin = pin;
          wrap.classList.add('done');
          setTimeout(() => wrap.remove(), 400);
          resolve(true);
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Kilidi aç';
          fail('PIN doğru değil. Tekrar deneyin.');
        }
      });

      $('#lockReset', wrap).addEventListener('click', () => {
        if (!confirm('Şifreli veri kalıcı olarak silinecek. Emin misiniz?')) return;
        localStorage.removeItem(KEY_ENC);
        localStorage.removeItem(KEY_PLAIN);
        location.reload();
      });
    });
  }

  /* ---------------- Oturum ---------------- */
  const session = { pin: null };

  /* Düz metni şifreleyip diske yazar (Store her kaydettiğinde çağrılır) */
  async function persist() {
    if (!session.pin) return;
    const plain = localStorage.getItem(KEY_PLAIN);
    if (!plain) return;
    try {
      localStorage.setItem(KEY_ENC, await encryptText(plain, session.pin));
    } catch (e) {
      console.error('[Servet] Şifreli kayıt başarısız:', e);
    }
  }

  /* Sekme kapanırken düz kopyayı sil (şifreli kopya kalır) */
  function scrubPlain() {
    if (!session.pin) return;
    localStorage.removeItem(KEY_PLAIN);
  }

  /* ---------------- Aç / kapat ---------------- */
  async function enable(pin) {
    const plain = localStorage.getItem(KEY_PLAIN) || '{}';
    localStorage.setItem(KEY_ENC, await encryptText(plain, pin));
    session.pin = pin;
    return true;
  }

  async function disable(pin) {
    const blob = localStorage.getItem(KEY_ENC);
    if (!blob) return true;
    const text = await decryptText(blob, pin);      // yanlış PIN'de hata fırlatır
    localStorage.setItem(KEY_PLAIN, text);
    localStorage.removeItem(KEY_ENC);
    session.pin = null;
    return true;
  }

  async function changePin(oldPin, newPin) {
    await disable(oldPin);
    return enable(newPin);
  }

  function lockNow() {
    if (!isEnabled()) return;
    scrubPlain();
    session.pin = null;
    location.reload();
  }

  /* Store kaydettikçe şifreli kopyayı tazele */
  function attach() {
    if (!isEnabled()) return;
    window.addEventListener('pagehide', () => { persist(); scrubPlain(); });
    window.addEventListener('beforeunload', () => { persist(); scrubPlain(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    if (window.Store && Store.subscribe) {
      let t = null;
      Store.subscribe(() => { clearTimeout(t); t = setTimeout(persist, 400); });
    }
  }

  return {
    supported, isEnabled, unlockScreen, enable, disable, changePin,
    lockNow, persist, attach, encryptText, decryptText,
    get unlocked() { return !!session.pin; }
  };
})();
