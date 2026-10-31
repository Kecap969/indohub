(function(){
  const $ = id => document.getElementById(id);
  const NAME_KEY = "media_username", TOKEN_KEY = "admin_token", UKEY = "user_token", SEEN_KEY = "media_seen";
  const NAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  let cfg = { title:"Indohub", subtitle:"", maxUploadMB:2048, adminUser:"kecap", pricePerMonth:50000, plans:{ 1:50000, 12:100000 } };
  let username = "", items = [], token = "", utoken = "", me = {}, srv = [], hls = null, forcePw = false, lastRef = 0;
  let tab = "home", openAlbum = null, albumItems = [], current = -1;

  const store = area => ({
    get(k){ try{ return area.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ area.setItem(k,v); }catch(e){} },
    del(k){ try{ area.removeItem(k); }catch(e){} }
  });
  const ls = store(window.localStorage), ss = store(window.sessionStorage);
  const rupiah = n => "Rp" + Number(n).toLocaleString("id-ID");
  const durTxt = m => m % 12 === 0 ? (m / 12) + " tahun" : m + " bulan";
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
  const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7S18.5 19 12 19 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  // 1.234 -> "1,2 rb", 1.500.000 -> "1,5 jt"
  const fmtCount = n => {
    n = Number(n) || 0;
    const f = (v, u) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace(".", ",") + " " + u;
    return n >= 1e6 ? f(n / 1e6, "jt") : n >= 1e3 ? f(n / 1e3, "rb") : String(n);
  };

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
    if ($("profCard")){ // profil: centang emas + status premium
      const prem = !!me.premiumUntil;
      $("profCard").classList.toggle("is-premium", prem);
      $("nameBadge").hidden = !prem;
      $("tier").textContent = prem ? "Premium" : "Gratis";
      $("rowUntil").hidden = !prem;
      if (prem){
        const left = Math.max(0, Math.ceil((new Date(me.premiumUntil) - Date.now()) / 864e5));
        $("premInfo").textContent = fmtDate(me.premiumUntil);
        $("premLeft").textContent = left > 1 ? left + " hari lagi" : "berakhir hari ini";
      }
      $("rowPend").hidden = !me.pending;
      $("pfUpgrade").textContent = prem ? "Perpanjang premium" : "Jadi premium";
      $("pfUpgrade").classList.toggle("gold", !prem); $("pfUpgrade").classList.toggle("ghost", prem);
    }
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
  // sembunyikan navbar saat mengetik (keyboard HP), tampil lagi setelah selesai
  (function(){
    const nav = document.querySelector(".bottomnav");
    const typing = t => t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && !/^(file|radio|checkbox|button|submit|range)$/.test(t.type || "");
    document.addEventListener("focusin", e => { if (typing(e.target)) nav.classList.add("kb"); });
    document.addEventListener("focusout", () => nav.classList.remove("kb"));
  })();

  /* ---------- daftar album ---------- */
  function hue(s){ let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function renderAlbums(){
    const cat = tab === "premium" ? "premium" : "free";
    $("catTitle").textContent = cat === "premium" ? "Album premium" : "Video gratis";
    renderSubCard(cat);
    // Home: semua video gratis langsung tampil (tanpa folder). Premium tetap per album.
    $("albums").hidden = cat === "free"; $("homeList").hidden = cat !== "free";
    if (cat === "free"){ renderFree(); return; }
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
    if (!$("cSheet").hidden){ hideComments(); return; }
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

  // semua video gratis, terbaru di atas (albumItems dipakai pemutar untuk urutan putar)
  function renderFree(){
    albumItems = items.filter(i => i.category === "free").sort((a,b) => ts(b) - ts(a));
    renderList($("homeList"), "Belum ada video gratis.");
  }
  function renderList(list, emptyMsg){
    list = list || $("list"); list.innerHTML = "";
    if (!albumItems.length){ const li = el("li", "empty", emptyMsg || "Album ini kosong."); li.style.gridColumn = "1/-1"; list.appendChild(li); return; }
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
        // cadangan (video lama tanpa thumbnail): memuat sebagian video, hanya saat tile terlihat
        const useVideo = () => {
          const v = document.createElement("video");
          v.muted = true; v.playsInline = true; v.preload = "metadata"; v.tabIndex = -1; v.setAttribute("aria-hidden", "true");
          v.dataset.src = it.url + "#t=0.5";
          v.addEventListener("loadedmetadata", () => { if (!it.duration && isFinite(v.duration) && v.duration > 0) dur.textContent = fmtDur(v.duration); }); // hanya bila server belum punya durasinya
          b.prepend(v);
          if (thumbObserver) thumbObserver.observe(v); else v.src = v.dataset.src;
        };
        if (it.thumb){ // gambar JPG kecil: tidak mengunduh videonya
          const im = document.createElement("img");
          im.alt = ""; im.loading = "lazy"; im.decoding = "async"; im.setAttribute("aria-hidden", "true");
          im.onerror = () => { im.remove(); useVideo(); };
          im.src = it.thumb; b.appendChild(im);
        } else useVideo();
      }
      const play = el("span", "tplay"); play.innerHTML = it.locked ? ICON_LOCK : ICON_PLAY;
      b.dataset.vkey = it.key;
      const num = el("span", "tnum");
      num.setAttribute("aria-label", fmtCount(it.views) + " tayangan");
      num.innerHTML = ICON_EYE; num.append(el("span", "vcount", fmtCount(it.views)));
      const dur = el("span", "tdur", it.duration ? fmtDur(it.duration) : ""); // durasi dari server: tampil langsung, tanpa memuat video
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
  let playTok = 0, viewTimer = 0, retried = ""; // playTok: hanya permintaan putar terbaru yang dijalankan (geser cepat tidak menumpuk)
  async function playAt(i){
    const it = albumItems[i]; if (!it || it.locked) return;
    const tok = ++playTok, vw = $("viewer");
    current = i; $("plErr").textContent = "";
    vw.classList.remove("paused");
    vw.classList.toggle("is-audio", it.type === "audio");
    $("cover").innerHTML = it.type === "audio" ? ICON_AUDIO : "";
    updateRail(it); retried = "";
    clearTimeout(viewTimer); // tayangan baru dihitung bila ditonton ≥ 3 detik
    viewTimer = setTimeout(() => { if (playTok === tok && !$("viewer").hidden) trackView(it); }, 3000);
    if (!$("cSheet").hidden) loadComments();
    $("player").pause();
    await attach(it.url); // hanya 1 media yang dimuat: src lama diganti, unduhan lama dibatalkan
    if (tok !== playTok) return;
    $("player").play().catch(() => { vw.classList.add("paused"); });
  }
  function openPlayer(i){
    $("viewer").hidden = false; document.body.classList.add("noscroll");
    history.pushState({ player: true }, "");
    playAt(i); $("vclose").focus();
  }
  /* ---------- like, tayangan, komentar (di pemutar layar penuh) ---------- */
  const curItem = () => albumItems[current];
  const viewed = new Set();
  let likeBusy = false, cBusy = false;
  function updateRail(it){
    const on = !!it.liked;
    $("likeBtn").setAttribute("aria-pressed", String(on));
    $("likeBtn").setAttribute("aria-label", on ? "Batal suka" : "Suka");
    $("likeCnt").textContent = fmtCount(it.likes);
    $("cmtCnt").textContent = fmtCount(it.comments);
  }
  function bumpTile(it){
    document.querySelectorAll(".tile[data-vkey]").forEach(t => {
      if (t.dataset.vkey !== it.key) return;
      const c = t.querySelector(".vcount"); if (c) c.textContent = fmtCount(it.views);
    });
  }
  async function trackView(it){
    if (viewed.has(it.key)) return; viewed.add(it.key);
    try{
      const r = await api("/api/media/view", { key: it.key });
      if (r.ok){ it.views = r.d.views; bumpTile(it); } else viewed.delete(it.key);
    }catch(e){ viewed.delete(it.key); }
  }
  $("likeBtn").addEventListener("click", async () => {
    const it = curItem(); if (!it || likeBusy) return;
    likeBusy = true;
    const was = !!it.liked, n = it.likes || 0;
    it.liked = !was; it.likes = Math.max(0, n + (was ? -1 : 1)); updateRail(it);
    if (it.liked){ const b = $("likeBtn"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    try{
      const r = await api("/api/media/like", { key: it.key });
      if (r.status === 401){ userExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal");
      it.liked = r.d.liked; it.likes = r.d.likes;
    }catch(e){ it.liked = was; it.likes = n; }
    finally{ likeBusy = false; if (curItem() === it) updateRail(it); }
  });

  const setCTitle = () => {
    const it = curItem();
    $("cTitle").textContent = "Komentar" + (it && it.comments ? " (" + fmtCount(it.comments) + ")" : "");
  };
  function commentRow(c){
    const li = el("li");
    const av = el("span", "cav", c.username.charAt(0)); av.setAttribute("aria-hidden", "true");
    const box = el("div"), who = el("div", "cwho", c.username);
    who.appendChild(el("small", "", relTime(c.createdAt)));
    box.append(who, el("div", "ctxt", c.body));
    li.append(av, box);
    if (c.mine){
      const d = el("button", "cdel", "Hapus"); d.type = "button";
      d.addEventListener("click", () => delComment(c, li));
      li.appendChild(d);
    }
    return li;
  }
  function renderComments(list){
    const ul = $("cList"); ul.innerHTML = "";
    if (!list.length){ ul.appendChild(el("li", "empty", "Belum ada komentar. Jadilah yang pertama.")); return; }
    list.forEach(c => ul.appendChild(commentRow(c)));
  }
  async function loadComments(){
    const it = curItem(); if (!it) return;
    $("cErr").textContent = ""; setCTitle();
    const ul = $("cList"); ul.innerHTML = ""; ul.appendChild(el("li", "empty", "Memuat..."));
    try{
      const r = await api("/api/media/comments?key=" + encodeURIComponent(it.key));
      if (r.status === 401){ userExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal memuat komentar");
      if (curItem() !== it) return;
      if (r.d.items.length < 100) it.comments = r.d.items.length;
      updateRail(it); setCTitle(); renderComments(r.d.items);
    }catch(ex){ ul.innerHTML = ""; $("cErr").textContent = ex.message; }
  }
  async function delComment(c, li){
    if (!confirm("Hapus komentar ini?")) return;
    const it = curItem();
    try{
      const r = await api("/api/media/comment/" + c.id + "/delete", {});
      if (r.status === 401){ userExpired(); return; }
      if (!r.ok && r.status !== 404) throw new Error(r.d.error || "Gagal menghapus komentar");
      li.remove();
      if (it){ it.comments = Math.max(0, (it.comments || 0) - 1); if (curItem() === it){ updateRail(it); setCTitle(); } }
      if (!$("cList").children.length) renderComments([]);
    }catch(ex){ $("cErr").textContent = ex.message; }
  }
  function openComments(){
    if (!curItem()) return;
    $("cSheet").hidden = false;
    history.pushState({ comments: true }, "");
    loadComments();
  }
  const hideComments = () => { $("cSheet").hidden = true; };
  function closeComments(pop){
    if ($("cSheet").hidden) return;
    hideComments();
    if (pop && history.state && history.state.comments){ skipPop = true; history.back(); }
  }
  $("cmtBtn").addEventListener("click", openComments);
  $("cClose").addEventListener("click", () => closeComments(true));
  $("cBg").addEventListener("click", () => closeComments(true));
  $("cForm").addEventListener("submit", async e => {
    e.preventDefault();
    const it = curItem(), inp = $("cInput"), body = inp.value.trim();
    if (!it || !body || cBusy) return;
    cBusy = true; $("cSend").disabled = true; $("cErr").textContent = "";
    try{
      const r = await api("/api/media/comment", { key: it.key, body });
      if (r.status === 401){ userExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal mengirim komentar");
      inp.value = ""; it.comments = (it.comments || 0) + 1;
      if (curItem() === it){
        const ul = $("cList"); if (ul.querySelector(".empty")) ul.innerHTML = "";
        ul.insertBefore(commentRow(r.d.comment), ul.firstChild); ul.scrollTop = 0;
        updateRail(it); setCTitle();
      }
    }catch(ex){ $("cErr").textContent = ex.message; }
    finally{ cBusy = false; $("cSend").disabled = false; }
  });

  function closePlayer(pop){
    hideComments();
    if ($("viewer").hidden) return;
    playTok++; clearTimeout(tapTimer); clearTimeout(viewTimer);
    $("viewer").classList.remove("paused", "go-next", "go-prev", "go-edge");
    const p = $("player"); p.pause(); p.removeAttribute("src"); p.load();
    if (hls){ hls.destroy(); hls = null; }
    $("viewer").hidden = true; document.body.classList.remove("noscroll"); current = -1;
    if (pop && history.state && history.state.player){ skipPop = true; history.back(); }
  }
  $("vclose").addEventListener("click", () => closePlayer(true));
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("cSheet").hidden) closeComments(true);
    else if (!$("viewer").hidden) closePlayer(true);
  });
  $("player").addEventListener("error", async () => {
    if (!$("player").getAttribute("src") && !hls) return;
    const it = curItem();
    if (it && retried !== it.key){ // link sementara (6 jam) mungkin kedaluwarsa: minta link baru sekali
      retried = it.key;
      try{
        const fresh = (await fetchItems()).find(x => x.key === it.key && x.url);
        if (fresh && curItem() === it){ it.url = fresh.url; $("plErr").textContent = ""; await attach(it.url); $("player").play().catch(() => {}); return; }
      }catch(e){}
    }
    $("plErr").textContent = "Media tidak bisa dimuat. Periksa koneksi internet lalu coba lagi.";
  });
  $("player").addEventListener("ended", () => { if (!stepTo(1)) $("viewer").classList.add("paused"); });
  $("player").addEventListener("playing", () => $("viewer").classList.remove("paused"));

  /* ---------- gestur pemutar: ketuk = putar/jeda, ketuk 2x kiri/kanan = mundur/maju 10 dtk, geser = ganti video ---------- */
  if ($("fxC")) $("fxC").innerHTML = ICON_PLAY;
  const SEEK = 10;
  let tapTimer = 0, lastTap = 0, gid = null, gx = 0, gy = 0, gt = 0, wheelAt = 0;
  const flash = e => { if (!e) return; e.classList.remove("on"); void e.offsetWidth; e.classList.add("on"); };
  function fx(cls){ const v = $("viewer"); v.classList.remove("go-next", "go-prev", "go-edge"); void v.offsetWidth; v.classList.add(cls); }
  function togglePlay(){
    const p = $("player"), v = $("viewer");
    if (current < 0) return;
    if (p.paused){ v.classList.remove("paused"); p.play().catch(() => v.classList.add("paused")); }
    else { p.pause(); v.classList.add("paused"); }
  }
  function seekBy(s){
    const p = $("player"); if (current < 0) return;
    const max = isFinite(p.duration) ? p.duration : Infinity;
    p.currentTime = Math.max(0, Math.min(max, p.currentTime + s));
    flash($(s < 0 ? "fxL" : "fxR"));
  }
  // pindah ke video berikutnya (dir = 1) atau sebelumnya (dir = -1); video terkunci dilewati
  function stepTo(dir){
    if (current < 0) return false;
    let i = current + dir;
    while (albumItems[i] && albumItems[i].locked) i += dir;
    if (!albumItems[i]){ fx("go-edge"); return false; }
    fx(dir > 0 ? "go-next" : "go-prev"); playAt(i); return true;
  }
  const vtap = $("vtap") || document.createElement("div"); // aman bila index.html lama belum punya #vtap
  vtap.addEventListener("pointerdown", e => { gid = e.pointerId; gx = e.clientX; gy = e.clientY; gt = Date.now(); });
  vtap.addEventListener("pointercancel", () => { gid = null; });
  vtap.addEventListener("pointerup", e => {
    if (e.pointerId !== gid) return; gid = null;
    const dx = e.clientX - gx, dy = e.clientY - gy, dt = Date.now() - gt;
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.3 && dt < 900){ // geser vertikal
      clearTimeout(tapTimer); lastTap = 0; stepTo(dy < 0 ? 1 : -1); return;
    }
    if (Math.abs(dx) > 14 || Math.abs(dy) > 14 || dt > 500) return; // bukan ketukan
    const r = vtap.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, now = Date.now();
    if (now - lastTap < 300){ // ketukan beruntun
      lastTap = now; clearTimeout(tapTimer);
      if (x < 0.4) seekBy(-SEEK); else if (x > 0.6) seekBy(SEEK); else togglePlay();
    } else {
      lastTap = now; clearTimeout(tapTimer);
      tapTimer = setTimeout(togglePlay, 280); // tunggu sebentar: mungkin ini ketukan pertama dari dua kali ketuk
    }
  });
  // desktop: roda mouse & tombol panah
  $("viewer").addEventListener("wheel", e => {
    if (!$("cSheet").hidden) return; e.preventDefault();
    const n = Date.now(); if (n - wheelAt < 600 || Math.abs(e.deltaY) < 20) return;
    wheelAt = n; stepTo(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if ($("viewer").hidden || !$("cSheet").hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowDown") stepTo(1);
    else if (e.key === "ArrowUp") stepTo(-1);
    else if (e.key === "ArrowLeft") seekBy(-SEEK);
    else if (e.key === "ArrowRight") seekBy(SEEK);
  });

  async function loadItems(){
    $("albums").innerHTML = ""; for (let i = 0; i < 6; i++) $("albums").appendChild(el("div", "album skel"));
    $("homeList").innerHTML = ""; for (let i = 0; i < 6; i++) $("homeList").appendChild(el("li", "skeltile"));
    lastRef = Date.now();
    try{
      const sres = await api("/api/session");
      if (sres.status === 401){ userExpired(); return; }
      if (sres.ok){ me = sres.d.me; applyMe(); }
    }catch(e){}
    try{ items = await fetchItems(); }
    catch(e){
      items = []; $("albums").innerHTML = ""; $("albums").appendChild(el("p", "empty", e.message));
      $("homeList").innerHTML = ""; const li = el("li", "empty", e.message); li.style.gridColumn = "1/-1"; $("homeList").appendChild(li);
      return;
    }
    try{ const n = await api("/api/notifs"); srv = n.ok ? n.d.items : []; }catch(e){ srv = []; }
    $("mediaCount").textContent = openItems().length;
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
    if (!ls.get(SEEN_KEY)) ls.set(SEEN_KEY, String(latest() || Date.now())); // kunjungan pertama: anggap sudah dilihat
    const n = srv.filter(x => srvTs(x) > seen()).length;
    $("notifDot").hidden = !n || tab === "notif"; $("notifDot").textContent = n > 9 ? "9+" : n;
  }
  const srvTs = n => new Date(n.created_at).getTime();
  const openItems = () => items.filter(i => !i.locked);
  const latest = () => Math.max(0, ...srv.map(srvTs));
  function renderNotifs(){
    const ul = $("notifs"); ul.innerHTML = "";
    const last = seen();
    const feed = srv.map(n => ({ t: srvTs(n), title: n.title, sub: (n.body ? n.body + " · " : "") + relTime(n.created_at) }))
      .sort((x, y) => y.t - x.t).slice(0, 30);
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
    ls.del(NAME_KEY); ls.del(UKEY); utoken = ""; me = {}; srv = []; items = []; forcePw = false; viewed.clear();
    username = ""; $("username").value = ""; togglePw(false); showGate();
  });

  /* ---------- kartu & modal berlangganan ---------- */
  const ICON_CROWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function renderSubCard(cat){
    const c = $("subCard"); c.hidden = cat !== "premium"; if (cat !== "premium") return;
    c.innerHTML = ""; c.classList.toggle("on", !!me.premiumUntil);
    const ic = el("span", "sic"); ic.innerHTML = ICON_CROWN; ic.setAttribute("aria-hidden", "true");
    if (me.pending){
      c.classList.remove("on"); c.classList.add("waiting");
      const t = el("div"), b = el("button", "btn", "Lihat detail pembayaran"); b.type = "button";
      t.append(el("b", "", "Menunggu verifikasi"), el("small", "", "Bukti transfer " + rupiah(me.pending.amount) + " sedang diperiksa admin"));
      b.addEventListener("click", openDetail);
      c.append(ic, t, b); return;
    }
    c.classList.remove("waiting");
    const t = el("div"), b = el("button", "btn", me.premiumUntil ? "Perpanjang" : "Berlangganan sekarang"); b.type = "button";
    if (me.premiumUntil) t.append(el("b", "", "Premium aktif"), el("small", "", "Berlaku sampai " + fmtDate(me.premiumUntil)));
    else t.append(el("b", "", "Buka semua album premium"), el("small", "", "Mulai " + rupiah(cfg.plans[1]) + " / bulan · " + rupiah(cfg.plans[12]) + " / tahun"));
    b.addEventListener("click", openSheet);
    c.append(ic, t);
    if (!me.premiumUntil){
      const ul = el("ul", "perks");
      ["Semua album premium terbuka", "Putar video dan audio tanpa batas", "Perpanjang kapan saja, sisa masa aktif tetap dihitung"].forEach(s => {
        const li = el("li"), i = el("span"); i.innerHTML = ICON_CHECK; li.append(i, el("span", "", s)); ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    c.appendChild(b);
  }

  // isi harga paket di jendela berlangganan dari konfigurasi server
  function renderPlans(){
    const p1 = cfg.plans[1], p12 = cfg.plans[12];
    $("plan1").textContent = rupiah(p1); $("plan12").textContent = rupiah(p12);
    $("plan12s").textContent = "≈ " + rupiah(Math.round(p12 / 12)) + " / bulan";
    const save = Math.round((1 - p12 / (p1 * 12)) * 100);
    $("saveBadge").hidden = save <= 0; $("saveBadge").textContent = "Hemat " + save + "%";
  }
  const proofLabel = "Pilih foto bukti transfer";
  function showProofName(){
    const f = $("proofFile").files[0];
    $("proofName").textContent = f ? f.name : proofLabel;
    document.querySelector(".drop").classList.toggle("has", !!f);
  }
  $("proofFile").addEventListener("change", showProofName);

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
    $("dtMonths").textContent = p0 ? durTxt(p0.months) : "-";
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
      $("dtMonths").textContent = durTxt(p.months);
      $("dtAmount").textContent = rupiah(p.amount);
      $("dtDate").textContent = fmtDateTime(p.createdAt);
      if (p.proofUrl){ $("dtProof").src = p.proofUrl; $("dtProofLink").href = p.proofUrl; $("dtProofLink").hidden = false; }
      else $("dtProofNone").hidden = false;
    }catch(e){ sheetErr(e.message); }
  }
  async function openSheet(){
    if (me.pending){ openDetail(); return; } // sudah kirim bukti: jangan buat tagihan baru
    sheetErr(""); pay = null; $("stepDone").hidden = true; $("stepDetail").hidden = true; $("proofFile").value = ""; showProofName();
    renderPlans();
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
      const q = $("qrisImg"); q.hidden = !r.d.qris; $("qrisBox").hidden = !r.d.qris; $("qrisNone").hidden = !!r.d.qris;
      if (r.d.qris) q.src = r.d.qris;
    }catch(e){ sheetErr(e.message); }
  }
  let payTok = 0;
  async function startPay(){
    const tok = ++payTok;
    $("proofBtn").disabled = true; $("payAmount").textContent = "-"; pay = null;
    try{
      const r = await api("/api/payment/start", { months: monthVal() });
      if (tok !== payTok) return; // paket sudah diganti lagi: abaikan respons lama
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
      $("mediaCount").textContent = openItems().length;
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
  const within = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]); // null bila kelamaan
  if ($("pfUpgrade")) $("pfUpgrade").addEventListener("click", () => setTab("premium"));
  async function start(){
    try{ const r = await within(fetch("/api/config"), 2500); if (r && r.ok) cfg = Object.assign(cfg, await r.json()); }catch(e){}
    document.title = cfg.title;
    $("gateTitle").textContent = cfg.title; $("gateSub").textContent = cfg.subtitle;

    token = ss.get(TOKEN_KEY);
    if (token){
      try{
        const r = await within(fetch("/api/me", { headers:{ Authorization:"Bearer "+token } }), 8000);
        if (r && r.ok){ showAdmin(); return; }
        if (!r){ showGate(); return; } // jaringan terlalu lambat: jangan hapus sesi admin
      }catch(e){}
      ss.del(TOKEN_KEY); token = "";
    }
    utoken = ls.get(UKEY);
    if (utoken){
      let r = null;
      try{ r = await within(api("/api/session"), 8000); }catch(e){}
      if (r && r.ok){ me = r.d.me; showApp(); return; }
      if (!r || r.status !== 401){ me = { username: ls.get(NAME_KEY) }; showApp(); return; } // server/jaringan bermasalah: tetap masuk
      ls.del(UKEY); utoken = "";
    }
    const saved = ls.get(NAME_KEY);
    if (NAME_RE.test(saved) && !isAdminName(saved)) $("username").value = saved;
    showGate();
    const note = ss.get("gate_msg"); if (note){ ss.del("gate_msg"); $("gateErr").textContent = note; }
  }
  start().finally(() => { const b = $("boot"); if (b) b.hidden = true; });
})();
