(function(){
  const $ = id => document.getElementById(id);
  const NAME_KEY = "media_username", TOKEN_KEY = "admin_token", UKEY = "user_token", SEEN_KEY = "media_seen";
  const NAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  let cfg = { title:"Indohub", subtitle:"", maxUploadMB:2048, adminUser:"kecap", pricePerMonth:50000 };
  let username = "", items = [], token = "", utoken = "", me = {}, srv = [], hls = null, forcePw = false, lastRef = 0;
  let tab = "home", openAlbum = null, albumItems = [], current = -1;

  const store = area => ({
    get(k){ try{ return area.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ area.setItem(k,v); }catch(e){} },
    del(k){ try{ area.removeItem(k); }catch(e){} }
  });
  const ls = store(window.localStorage), ss = store(window.sessionStorage);
  const rupiah = n => "Rp" + Number(n).toLocaleString("id-ID");
  const fmtDate = d => new Date(d).toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
  // panggilan API: otomatis membawa token admin atau token user
  async function api(path, body, method){
    const o = { method: method || (body ? "POST" : "GET"), headers: {} };
    const t = token || utoken; if (t) o.headers.Authorization = "Bearer " + t;
    if (body){ o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    const r = await fetch(path, o); let d = {};
    try{ d = await r.json(); }catch(e){}
    return { ok: r.ok, status: r.status, d };
  }
  function putFile(url, file, type, onProg){
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url); x.setRequestHeader("Content-Type", type);
      x.upload.onprogress = e => { if (e.lengthComputable && onProg) onProg(Math.round(e.loaded / e.total * 100)); };
      x.onload = () => x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload ditolak (kode " + x.status + "), coba lagi"));
      x.onerror = () => reject(new Error("Upload gagal. Periksa koneksi internet lalu coba lagi."));
      x.send(file);
    });
  }
  const isAdminName = v => v.trim().toLowerCase() === cfg.adminUser;
  const fmtSize = b => b >= 1073741824 ? (b/1073741824).toFixed(1)+" GB" : b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b/1024))+" KB";
  const ts = it => new Date(it.lastModified).getTime();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const CATNAME = { free:"Gratis", premium:"Premium" };
  const TABTITLE = { home:"Home", premium:"Premium", notif:"Notifikasi", profil:"Profil" };

  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const ICON_AUDIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
  const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 21h4"/></svg>';
  const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z"/></svg>';

  /* ---------- data: kelompokkan per kategori & album ---------- */
  function albumsOf(cat){
    const map = new Map();
    items.filter(i => i.category === cat).forEach(i => {
      const k = i.album.toLowerCase();
      if (!map.has(k)) map.set(k, { name: i.album, list: [], latest: 0 });
      const a = map.get(k); a.list.push(i); a.latest = Math.max(a.latest, ts(i));
    });
    return [...map.values()].sort((a,b) => b.latest - a.latest);
  }
  async function fetchItems(){
    const r = await api("/api/list");
    if (!r.ok) throw new Error(r.d.error || "Gagal memuat daftar");
    return r.d.items;
  }

  /* ---------- pindah tampilan ---------- */
  function view(name){
    $("gate").hidden = name !== "gate";
    $("app").hidden = name !== "app";
  }
  function showGate(){ closePlayer(false); view("gate"); $("username").focus(); }
  function applyMe(){
    username = me.username || username;
    $("who").textContent = username; $("avatar").textContent = username.charAt(0);
    $("premInfo").textContent = me.premiumUntil ? "Premium aktif sampai " + fmtDate(me.premiumUntil) : "Akun gratis";
    $("pwToggle").textContent = me.hasPassword ? "Ganti password" : "Buat password";
    $("pwCur").hidden = !me.hasPassword; $("pwCur").required = !!me.hasPassword;
    if (tab === "premium" && !openAlbum) renderSubCard("premium");
  }
  function showApp(){
    applyMe(); view("app"); openAlbum = null; setTab("home"); loadItems();
  }
  function showAdmin(){ location.replace("/admin"); } // dashboard admin = halaman terpisah
  function userExpired(){
    ls.del(UKEY); utoken = ""; me = {}; srv = []; items = [];
    $("username").value = ls.get(NAME_KEY); togglePw(false); showGate();
    $("gateErr").textContent = "Sesi habis, silakan masuk lagi";
  }

  /* ---------- tab bawah ---------- */
  const TABS = ["catalog","notif","profil"];
  function setTab(name){
    tab = name; $("title").textContent = TABTITLE[name];
    const pane = name === "home" || name === "premium" ? "catalog" : name;
    TABS.forEach(t => $("tab-" + t).hidden = t !== pane);
    document.querySelectorAll(".bottomnav button").forEach(b => {
      if (b.dataset.tab === name) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
    });
    if (pane === "catalog"){ closeAlbum(false); renderAlbums(); }
    else closePlayer(false);
    if (name === "notif"){ renderNotifs(); if (latest()) ls.set(SEEN_KEY, String(latest())); updateDot(); }
    if (name !== "home") refreshQuiet();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".bottomnav button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

  /* ---------- daftar album ---------- */
  function hue(s){ let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function renderAlbums(){
    const cat = tab === "premium" ? "premium" : "free";
    $("catTitle").textContent = cat === "premium" ? "Album premium" : "Album gratis";
    renderSubCard(cat);
    const box = $("albums"); box.innerHTML = "";
    const list = albumsOf(cat);
    if (!list.length){
      box.appendChild(el("p", "empty", cat === "premium" ? "Belum ada album premium." : "Belum ada album."));
      return;
    }
    list.forEach(a => {
      const lk = a.list.every(i => i.locked);
      const b = el("button", "album" + (lk ? " locked" : "")); b.type = "button";
      const ic = el("span", "folder"); ic.innerHTML = ICON_FOLDER; ic.style.setProperty("--h", hue(a.name.toLowerCase()));
      b.append(ic, el("b", "", a.name), el("small", "", a.list.length + " video" + (lk ? " · terkunci" : "")));
      b.addEventListener("click", () => openAlbumView(cat, a.name));
      box.appendChild(b);
    });
  }

  /* ---------- isi album: grid 2 kolom tanpa judul ---------- */
  function openAlbumView(cat, name, push){
    const found = items.filter(i => i.category === cat && i.album.toLowerCase() === name.toLowerCase())
                       .sort((a,b) => ts(a) - ts(b));
    openAlbum = { cat, name };
    albumItems = found;
    $("albumView").hidden = true; $("watchView").hidden = false;
    $("crumb").textContent = CATNAME[cat] + " › " + name;
    renderList();
    if (push !== false) history.pushState({ album: name }, "");
    window.scrollTo(0, 0);
  }
  function closeAlbum(pop){
    if (!openAlbum) return;
    closePlayer(false);
    openAlbum = null;
    $("watchView").hidden = true; $("albumView").hidden = false;
    if (pop && history.state && history.state.album) history.back();
  }
  $("backBtn").addEventListener("click", () => { closeAlbum(true); renderAlbums(); });
  let skipPop = false; // history.back() yang kita panggil sendiri tidak boleh menutup album juga
  window.addEventListener("popstate", () => {
    if (skipPop){ skipPop = false; return; }
    if (!$("viewer").hidden){ closePlayer(false); return; }
    if (openAlbum){ closeAlbum(false); renderAlbums(); }
  });

  const fmtDur = s => { s = Math.round(s); const m = Math.floor(s/60), r = s % 60; return m >= 60 ? Math.floor(m/60) + ":" + String(m%60).padStart(2,"0") + ":" + String(r).padStart(2,"0") : m + ":" + String(r).padStart(2,"0"); };
  // thumbnail dimuat hanya saat terlihat di layar (hemat kuota)
  const thumbObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const v = en.target; thumbObserver.unobserve(v);
      v.src = v.dataset.src;
    });
  }, { rootMargin: "200px" }) : null;

  function renderList(){
    const list = $("list"); list.innerHTML = "";
    if (!albumItems.length){ const li = el("li", "empty", "Album ini kosong."); li.style.gridColumn = "1/-1"; list.appendChild(li); return; }
    albumItems.forEach((it, i) => {
      const li = el("li"), b = el("button", "tile"); b.type = "button";
      b.setAttribute("aria-label", "Putar " + it.title);
      if (it.locked){
        b.classList.add("locked");
        b.setAttribute("aria-label", it.title + " (terkunci, khusus premium)");
        if (it.thumb){
          const im = document.createElement("img");
          im.src = it.thumb; im.alt = ""; im.loading = "lazy"; im.setAttribute("aria-hidden", "true");
          b.appendChild(im);
        } else if (it.type === "audio"){
          b.classList.add("is-audio");
          const ic = el("span", "tic"); ic.innerHTML = ICON_AUDIO; b.appendChild(ic);
        }
      } else if (it.type === "audio"){
        b.classList.add("is-audio");
        const ic = el("span", "tic"); ic.innerHTML = ICON_AUDIO; b.appendChild(ic);
      } else {
        const v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "metadata"; v.tabIndex = -1; v.setAttribute("aria-hidden", "true");
        v.dataset.src = it.url + "#t=0.5";
        v.addEventListener("loadedmetadata", () => { if (isFinite(v.duration)) dur.textContent = fmtDur(v.duration); });
        b.appendChild(v);
        if (thumbObserver) thumbObserver.observe(v); else v.src = v.dataset.src;
      }
      const play = el("span", "tplay"); play.innerHTML = it.locked ? ICON_LOCK : ICON_PLAY;
      const num = el("span", "tnum", String(i + 1));
      const dur = el("span", "tdur", "");
      b.append(play, num, dur);
      b.addEventListener("click", () => { if (it.locked) openSheet(); else openPlayer(i); });
      li.appendChild(b); list.appendChild(li);
    });
  }

  /* ---------- pemutar layar penuh ---------- */
  function loadHls(){
    return new Promise((ok, no) => {
      if (window.Hls) return ok();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
      s.onload = ok; s.onerror = no; document.head.appendChild(s);
    });
  }
  async function attach(src){
    const p = $("player");
    if (hls){ hls.destroy(); hls = null; }
    if (/\.m3u8(\?|$)/i.test(src) && !p.canPlayType("application/vnd.apple.mpegurl")){
      await loadHls();
      if (window.Hls && Hls.isSupported()){ hls = new Hls(); hls.loadSource(src); hls.attachMedia(p); return; }
    }
    p.src = src;
  }
  async function playAt(i){
    const it = albumItems[i]; if (!it) return;
    current = i; $("plErr").textContent = "";
    $("viewer").classList.toggle("is-audio", it.type === "audio");
    $("cover").innerHTML = it.type === "audio" ? ICON_AUDIO : "";
    await attach(it.url);
    $("player").play().catch(()=>{});
  }
  function openPlayer(i){
    $("viewer").hidden = false; document.body.classList.add("noscroll");
    history.pushState({ player: true }, "");
    playAt(i); $("vclose").focus();
  }
  function closePlayer(pop){
    if ($("viewer").hidden) return;
    const p = $("player"); p.pause(); p.removeAttribute("src"); p.load();
    if (hls){ hls.destroy(); hls = null; }
    $("viewer").hidden = true; document.body.classList.remove("noscroll"); current = -1;
    if (pop && history.state && history.state.player){ skipPop = true; history.back(); }
  }
  $("vclose").addEventListener("click", () => closePlayer(true));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("viewer").hidden) closePlayer(true); });
  $("player").addEventListener("error", () => {
    if (!$("player").getAttribute("src") && !hls) return;
    $("plErr").textContent = "Media tidak bisa dimuat. Periksa koneksi internet lalu coba lagi.";
  });
  $("player").addEventListener("ended", () => { if (current + 1 < albumItems.length) playAt(current + 1); });

  async function loadItems(){
    $("albums").innerHTML = ""; for (let i = 0; i < 6; i++) $("albums").appendChild(el("div", "album skel"));
    lastRef = Date.now();
    try{
      const sres = await api("/api/session");
      if (sres.status === 401){ userExpired(); return; }
      if (sres.ok){ me = sres.d.me; applyMe(); }
    }catch(e){}
    try{ items = await fetchItems(); }
    catch(e){ items = []; $("albums").innerHTML = ""; $("albums").appendChild(el("p", "empty", e.message)); return; }
    try{ const n = await api("/api/notifs"); srv = n.ok ? n.d.items : []; }catch(e){ srv = []; }
    $("mediaCount").textContent = openItems().length + " media tersedia";
    if (!openAlbum && (tab === "home" || tab === "premium")) renderAlbums();
    updateDot();
  }

  /* ---------- notifikasi ---------- */
  const seen = () => Number(ls.get(SEEN_KEY)) || 0;
  function relTime(d){
    const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return "baru saja";
    if (s < 3600) return Math.floor(s/60) + " menit lalu";
    if (s < 86400) return Math.floor(s/3600) + " jam lalu";
    if (s < 604800) return Math.floor(s/86400) + " hari lalu";
    return new Date(d).toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
  }
  function updateDot(){
    if (!openItems().length && !srv.length){ $("notifDot").hidden = true; return; }
    if (!ls.get(SEEN_KEY)) ls.set(SEEN_KEY, String(latest())); // kunjungan pertama: anggap sudah dilihat
    const n = openItems().filter(it => ts(it) > seen()).length + srv.filter(x => srvTs(x) > seen()).length;
    $("notifDot").hidden = !n || tab === "notif"; $("notifDot").textContent = n > 9 ? "9+" : n;
  }
  const srvTs = n => new Date(n.created_at).getTime();
  const openItems = () => items.filter(i => !i.locked);
  const latest = () => Math.max(0, ...openItems().map(ts), ...srv.map(srvTs));
  function renderNotifs(){
    const ul = $("notifs"); ul.innerHTML = "";
    const last = seen();
    const feed = [
      ...srv.map(n => ({ t: srvTs(n), title: n.title, sub: (n.body ? n.body + " · " : "") + relTime(n.created_at) })),
      ...openItems().slice(0, 20).map(it => ({ t: ts(it), title: "Media baru: " + it.title,
        sub: CATNAME[it.category] + " › " + it.album + " · " + relTime(it.lastModified) }))
    ].sort((x, y) => y.t - x.t).slice(0, 30);
    if (!feed.length){ ul.appendChild(el("li", "empty", "Belum ada notifikasi.")); return; }
    feed.forEach(f => {
      const li = el("li", f.t > last ? "new" : "");
      const ic = el("span", "ic"); ic.innerHTML = ICON_BELL;
      const box = el("div");
      box.append(el("b", "", f.title), el("small", "", f.sub));
      li.append(ic, box); ul.appendChild(li);
    });
  }

  /* ---------- gate ---------- */
  function togglePw(focus){
    const need = isAdminName($("username").value) || forcePw;
    $("pwBox").hidden = !need; $("password").required = need;
    if (!need) $("password").value = "";
    if (need && focus) $("password").focus();
  }
  $("username").addEventListener("input", () => { forcePw = false; togglePw(false); });
  $("gateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = $("username").value.trim(), err = $("gateErr");
    err.textContent = "";
    if (!NAME_RE.test(v)){ err.textContent = "Username harus 2-30 karakter: huruf, angka, _ atau -"; return; }
    if (isAdminName(v)){
      if ($("pwBox").hidden){ togglePw(true); return; }
      const btn = $("gateBtn"); btn.disabled = true;
      try{
        const r = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ username: v, password: $("password").value }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Gagal masuk");
        token = d.token; ss.set(TOKEN_KEY, token);
        $("password").value = ""; showAdmin();
      }catch(ex){ err.textContent = ex.message; $("password").select(); }
      finally{ btn.disabled = false; }
      return;
    }
    const btn = $("gateBtn"); btn.disabled = true;
    try{
      const r = await api("/api/enter", { username: v, password: $("password").value });
      if (r.d.needPassword){ forcePw = true; togglePw(true); err.textContent = r.d.error; $("password").select(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal masuk");
      utoken = r.d.token; ls.set(UKEY, utoken); me = r.d.me; ls.set(NAME_KEY, me.username);
      $("password").value = ""; forcePw = false; showApp();
    }catch(ex){ err.textContent = ex.message; }
    finally{ btn.disabled = false; }
  });
  $("logout").addEventListener("click", () => {
    ls.del(NAME_KEY); ls.del(UKEY); utoken = ""; me = {}; srv = []; items = []; forcePw = false;
    username = ""; $("username").value = ""; togglePw(false); showGate();
  });

  /* ---------- kartu & modal berlangganan ---------- */
  function renderSubCard(cat){
    const c = $("subCard"); c.hidden = cat !== "premium"; if (cat !== "premium") return;
    c.innerHTML = ""; c.classList.toggle("on", !!me.premiumUntil);
    if (me.pending){
      c.classList.remove("on"); c.classList.add("waiting");
      const t = el("div"), b = el("button", "btn", "Detail selengkapnya"); b.type = "button";
      t.append(el("b", "", "Menunggu verifikasi"), el("small", "", "Bukti transfer " + rupiah(me.pending.amount) + " sedang diperiksa admin"));
      b.addEventListener("click", openDetail);
      c.append(t, b); return;
    }
    c.classList.remove("waiting");
    const t = el("div"), b = el("button", "btn", me.premiumUntil ? "Perpanjang" : "Berlangganan sekarang"); b.type = "button";
    if (me.premiumUntil) t.append(el("b", "", "Premium aktif"), el("small", "", "Berlaku sampai " + fmtDate(me.premiumUntil)));
    else t.append(el("b", "", "Buka semua album premium"), el("small", "", "Mulai " + rupiah(cfg.pricePerMonth) + " / bulan"));
    b.addEventListener("click", openSheet);
    c.append(t, b);
  }

  let pay = null, qrisLoaded = false;
  const sheetErr = m => { $("sheetErr").textContent = m || ""; };
  const monthVal = () => Number(document.querySelector("input[name=mon]:checked").value);
  const fmtDateTime = d => new Date(d).toLocaleString("id-ID", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  const refreshSubCard = () => renderSubCard(tab === "premium" ? "premium" : "free");
  async function openDetail(){
    sheetErr(""); pay = null;
    ["stepPw", "stepPay", "stepDone"].forEach(id => { $(id).hidden = true; });
    $("sheetTitle").textContent = "Detail pembayaran";
    $("stepDetail").hidden = false; $("sheet").hidden = false; document.body.classList.add("noscroll");
    const p0 = me.pending;
    $("dtMonths").textContent = p0 ? p0.months + " bulan" : "-";
    $("dtAmount").textContent = p0 ? rupiah(p0.amount) : "-";
    $("dtDate").textContent = p0 ? fmtDateTime(p0.createdAt) : "-";
    $("dtProofLink").hidden = true; $("dtProofNone").hidden = true;
    try{
      const r = await api("/api/payment/pending");
      if (r.status === 401){ closeSheet(); userExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal memuat detail pembayaran");
      const p = r.d.payment;
      if (!p){ // sudah diproses admin: tutup & segarkan status
        me.pending = null; closeSheet(); refreshSubCard(); lastRef = 0; return;
      }
      $("dtMonths").textContent = p.months + " bulan";
      $("dtAmount").textContent = rupiah(p.amount);
      $("dtDate").textContent = fmtDateTime(p.createdAt);
      if (p.proofUrl){ $("dtProof").src = p.proofUrl; $("dtProofLink").href = p.proofUrl; $("dtProofLink").hidden = false; }
      else $("dtProofNone").hidden = false;
    }catch(e){ sheetErr(e.message); }
  }
  async function openSheet(){
    if (me.pending){ openDetail(); return; } // sudah kirim bukti: jangan buat tagihan baru
    sheetErr(""); pay = null; $("stepDone").hidden = true; $("stepDetail").hidden = true; $("proofFile").value = "";
    $("sheetTitle").textContent = "Berlangganan Premium";
    $("sheet").hidden = false; document.body.classList.add("noscroll");
    if (!me.hasPassword){ $("stepPay").hidden = true; $("stepPw").hidden = false; $("spw").focus(); return; }
    $("stepPw").hidden = true; $("stepPay").hidden = false;
    await Promise.all([loadQris(), startPay()]);
  }
  function closeSheet(){ $("sheet").hidden = true; document.body.classList.remove("noscroll"); }
  async function loadQris(){
    try{
      const r = await api("/api/payment/info"); if (!r.ok) throw new Error(r.d.error || "Gagal memuat QRIS");
      const q = $("qrisImg"); q.hidden = !r.d.qris; $("qrisNone").hidden = !!r.d.qris;
      if (r.d.qris) q.src = r.d.qris;
    }catch(e){ sheetErr(e.message); }
  }
  async function startPay(){
    $("proofBtn").disabled = true; $("payAmount").textContent = "-"; pay = null;
    try{
      const r = await api("/api/payment/start", { months: monthVal() });
      if (r.status === 401){ closeSheet(); userExpired(); return; }
      if (r.d.needPassword){ me.hasPassword = false; applyMe(); $("stepPay").hidden = true; $("stepPw").hidden = false; return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal membuat tagihan");
      pay = r.d; $("payAmount").textContent = rupiah(pay.amount); $("proofBtn").disabled = false; sheetErr("");
    }catch(e){ sheetErr(e.message); }
  }
  document.querySelectorAll("input[name=mon]").forEach(r => r.addEventListener("change", startPay));
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheetBg").addEventListener("click", closeSheet);
  $("doneBtn").addEventListener("click", closeSheet);
  $("dtClose").addEventListener("click", closeSheet);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

  $("spwBtn").addEventListener("click", async () => {
    const pw = $("spw").value;
    if (pw.length < 6){ sheetErr("Password minimal 6 karakter"); return; }
    $("spwBtn").disabled = true;
    try{
      const r = await api("/api/password", { password: pw });
      if (!r.ok){ sheetErr(r.d.error || "Gagal menyimpan password"); return; }
      me.hasPassword = true; applyMe(); $("spw").value = ""; sheetErr("");
      $("stepPw").hidden = true; $("stepPay").hidden = false;
      await Promise.all([loadQris(), startPay()]);
    }finally{ $("spwBtn").disabled = false; }
  });

  $("proofBtn").addEventListener("click", async () => {
    const f = $("proofFile").files[0], btn = $("proofBtn"), prog = $("proofProg"); sheetErr("");
    if (!pay){ sheetErr("Tagihan belum siap, tunggu sebentar."); return; }
    if (!f){ sheetErr("Pilih foto bukti transfer dulu."); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)){ sheetErr("Bukti harus berupa gambar JPG, PNG, atau WebP."); return; }
    if (f.size > 5 * 1048576){ sheetErr("Ukuran gambar maksimal 5 MB."); return; }
    btn.disabled = true; prog.hidden = false; prog.value = 0;
    try{
      const p = await api("/api/payment/" + pay.id + "/presign", { contentType: f.type, size: f.size });
      if (p.status === 401){ closeSheet(); userExpired(); return; }
      if (!p.ok) throw new Error(p.d.error || "Gagal memulai upload");
      await putFile(p.d.uploadUrl, f, f.type, v => { prog.value = v; });
      const r = await api("/api/payment/" + pay.id + "/submit", {});
      if (!r.ok) throw new Error(r.d.error || "Gagal mengirim bukti");
      me.pending = { id: pay.id, months: pay.months, amount: pay.amount, createdAt: new Date().toISOString() };
      pay = null; $("stepPay").hidden = true; $("stepDone").hidden = false; lastRef = 0; refreshSubCard();
    }catch(e){ sheetErr(e.message); }
    finally{ prog.hidden = true; btn.disabled = !pay; }
  });

  // segarkan status premium & notifikasi tanpa layar "Memuat..." (maks. tiap 15 detik)
  async function refreshQuiet(){
    if (Date.now() - lastRef < 15000 || !utoken) return; lastRef = Date.now();
    try{
      const s = await api("/api/session"); if (s.status === 401){ userExpired(); return; }
      if (s.ok){ me = s.d.me; applyMe(); }
      items = await fetchItems();
      const n = await api("/api/notifs"); if (n.ok) srv = n.d.items;
      $("mediaCount").textContent = openItems().length + " media tersedia";
      if (!openAlbum && (tab === "home" || tab === "premium")) renderAlbums();
      if (tab === "notif") renderNotifs();
      updateDot();
    }catch(e){}
  }

  /* ---------- profil: buat / ganti password ---------- */
  $("pwToggle").addEventListener("click", () => {
    $("pwForm").hidden = !$("pwForm").hidden; $("pwOk").textContent = "";
    if (!$("pwForm").hidden) ($("pwCur").hidden ? $("pwNew") : $("pwCur")).focus();
  });
  $("pwForm").addEventListener("submit", async e => {
    e.preventDefault(); const err = $("pwErr"); err.textContent = "";
    const r = await api("/api/password", { password: $("pwNew").value, current: $("pwCur").value });
    if (r.status === 401){ userExpired(); return; }
    if (!r.ok){ err.textContent = r.d.error || "Gagal menyimpan password"; return; }
    me.hasPassword = true; applyMe(); $("pwNew").value = ""; $("pwCur").value = "";
    $("pwForm").hidden = true; $("pwOk").textContent = "Password tersimpan. Gunakan password ini saat masuk berikutnya.";
  });

  /* ---------- start ---------- */
  async function start(){
    try{ const r = await fetch("/api/config"); if (r.ok) cfg = Object.assign(cfg, await r.json()); }catch(e){}
    document.title = cfg.title;
    $("gateTitle").textContent = cfg.title; $("gateSub").textContent = cfg.subtitle;

    token = ss.get(TOKEN_KEY);
    if (token){
      try{
        const r = await fetch("/api/me", { headers:{ Authorization:"Bearer "+token } });
        if (r.ok){ showAdmin(); return; }
      }catch(e){}
      ss.del(TOKEN_KEY); token = "";
    }
    utoken = ls.get(UKEY);
    if (utoken){
      let r = null;
      try{ r = await api("/api/session"); }catch(e){}
      if (r && r.ok){ me = r.d.me; showApp(); return; }
      if (!r || r.status !== 401){ me = { username: ls.get(NAME_KEY) }; showApp(); return; } // server/jaringan bermasalah: tetap masuk
      ls.del(UKEY); utoken = "";
    }
    const saved = ls.get(NAME_KEY);
    if (NAME_RE.test(saved) && !isAdminName(saved)) $("username").value = saved;
    showGate();
    const note = ss.get("gate_msg"); if (note){ ss.del("gate_msg"); $("gateErr").textContent = note; }
  }
  start();
})();
