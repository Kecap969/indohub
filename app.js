(function(){
  const $ = id => document.getElementById(id);
  const NAME_KEY = "media_username", TOKEN_KEY = "admin_token", SEEN_KEY = "media_seen";
  const NAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  let cfg = { title:"Indohub", subtitle:"", maxUploadMB:2048, adminUser:"kecap" };
  let username = "", items = [], token = "", hls = null;
  let tab = "home", openAlbum = null, albumItems = [], current = -1;

  const store = area => ({
    get(k){ try{ return area.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ area.setItem(k,v); }catch(e){} },
    del(k){ try{ area.removeItem(k); }catch(e){} }
  });
  const ls = store(window.localStorage), ss = store(window.sessionStorage);
  const isAdminName = v => v.trim().toLowerCase() === cfg.adminUser;
  const fmtSize = b => b >= 1073741824 ? (b/1073741824).toFixed(1)+" GB" : b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b/1024))+" KB";
  const ts = it => new Date(it.lastModified).getTime();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const CATNAME = { free:"Gratis", premium:"Premium" };
  const TABTITLE = { home:"Home", premium:"Premium", notif:"Notifikasi", profil:"Profil" };

  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
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
    const r = await fetch("/api/list"); const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Gagal memuat daftar");
    return d.items;
  }

  /* ---------- pindah tampilan ---------- */
  function view(name){
    $("gate").hidden = name !== "gate";
    $("app").hidden = name !== "app";
    $("admin").hidden = name !== "admin";
  }
  function showGate(){ closePlayer(false); view("gate"); $("username").focus(); }
  function showApp(){
    $("who").textContent = username; $("avatar").textContent = username.charAt(0);
    view("app"); openAlbum = null; setTab("home"); loadItems();
  }
  function showAdmin(){ view("admin"); loadAdmin(); }

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
    if (name === "notif"){ renderNotifs(); if (items.length) ls.set(SEEN_KEY, String(Math.max(...items.map(ts)))); updateDot(); }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".bottomnav button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

  /* ---------- daftar album ---------- */
  function hue(s){ let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function renderAlbums(){
    const cat = tab === "premium" ? "premium" : "free";
    $("catTitle").textContent = cat === "premium" ? "Album premium" : "Album gratis";
    const box = $("albums"); box.innerHTML = "";
    const list = albumsOf(cat);
    if (!list.length){
      box.appendChild(el("p", "empty", cat === "premium" ? "Belum ada album premium." : "Belum ada album."));
      return;
    }
    list.forEach(a => {
      const b = el("button", "album"); b.type = "button";
      const ic = el("span", "folder"); ic.innerHTML = ICON_FOLDER; ic.style.setProperty("--h", hue(a.name.toLowerCase()));
      b.append(ic, el("b", "", a.name), el("small", "", a.list.length + " video"));
      b.addEventListener("click", () => openAlbumView(cat, a.name));
      box.appendChild(b);
    });
  }

  /* ---------- isi album: grid 2 kolom tanpa judul ---------- */
  function openAlbumView(cat, name, push){
    openAlbum = { cat, name };
    albumItems = items.filter(i => i.category === cat && i.album.toLowerCase() === name.toLowerCase())
                      .sort((a,b) => ts(a) - ts(b));
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
      if (it.type === "audio"){
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
      const play = el("span", "tplay"); play.innerHTML = ICON_PLAY;
      const num = el("span", "tnum", String(i + 1));
      const dur = el("span", "tdur", "");
      b.append(play, num, dur);
      b.addEventListener("click", () => openPlayer(i));
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
    $("plErr").textContent = "Media tidak bisa dimuat. Periksa domain publik R2 dan pengaturan CORS.";
  });
  $("player").addEventListener("ended", () => { if (current + 1 < albumItems.length) playAt(current + 1); });

  async function loadItems(){
    $("albums").innerHTML = ""; $("albums").appendChild(el("p", "empty", "Memuat..."));
    try{ items = await fetchItems(); }
    catch(e){ items = []; $("albums").innerHTML = ""; $("albums").appendChild(el("p", "empty", e.message)); return; }
    $("mediaCount").textContent = items.length + " media tersedia";
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
    if (!items.length){ $("notifDot").hidden = true; return; }
    if (!ls.get(SEEN_KEY)) ls.set(SEEN_KEY, String(Math.max(...items.map(ts)))); // kunjungan pertama: anggap sudah dilihat
    const n = items.filter(it => ts(it) > seen()).length;
    $("notifDot").hidden = !n || tab === "notif"; $("notifDot").textContent = n > 9 ? "9+" : n;
  }
  function renderNotifs(){
    const ul = $("notifs"); ul.innerHTML = "";
    if (!items.length){ ul.appendChild(el("li", "empty", "Belum ada notifikasi.")); return; }
    const last = seen();
    items.slice(0, 20).forEach(it => {
      const li = el("li", ts(it) > last ? "new" : "");
      const ic = el("span", "ic"); ic.innerHTML = ICON_BELL;
      const box = el("div");
      box.append(el("b", "", "Media baru: " + it.title),
                 el("small", "", CATNAME[it.category] + " › " + it.album + " · " + relTime(it.lastModified)));
      li.append(ic, box); ul.appendChild(li);
    });
  }

  /* ---------- gate ---------- */
  function togglePw(focus){
    const adm = isAdminName($("username").value);
    $("pwBox").hidden = !adm; $("password").required = adm;
    if (!adm) $("password").value = "";
    if (adm && focus) $("password").focus();
  }
  $("username").addEventListener("input", () => togglePw(false));
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
    username = v; ls.set(NAME_KEY, v); showApp();
  });
  $("logout").addEventListener("click", () => {
    ls.del(NAME_KEY); username = ""; $("username").value = ""; togglePw(false); showGate();
  });

  /* ---------- dashboard admin: upload ---------- */
  const NEW = "__new__";
  const catVal = () => document.querySelector('input[name=cat]:checked').value;
  function refreshAlbumChoices(){
    const sel = $("albumSel"), names = albumsOf(catVal()).map(a => a.name);
    sel.innerHTML = "";
    names.forEach(n => { const o = el("option", "", n); o.value = n; sel.appendChild(o); });
    const o = el("option", "", "+ Buat album baru"); o.value = NEW; sel.appendChild(o);
    const none = !names.length;
    sel.hidden = none; $("albumSelLbl").hidden = none;
    if (none) sel.value = NEW;
    toggleNew();
  }
  function toggleNew(){
    const isNew = $("albumSel").value === NEW;
    $("albumNew").hidden = !isNew;
    if (!isNew) $("albumNew").value = "";
  }
  document.querySelectorAll('input[name=cat]').forEach(r => r.addEventListener("change", refreshAlbumChoices));
  $("albumSel").addEventListener("change", () => { toggleNew(); if (!$("albumNew").hidden) $("albumNew").focus(); });

  function chosenAlbum(){
    if ($("albumSel").value !== NEW) return $("albumSel").value;
    const typed = $("albumNew").value.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim();
    const same = albumsOf(catVal()).find(a => a.name.toLowerCase() === typed.toLowerCase()); // jangan buat album ganda
    return same ? same.name : typed;
  }

  $("uploadBtn").addEventListener("click", async () => {
    const f = $("file").files[0], err = $("upErr"), ok = $("upOk"), prog = $("prog"), btn = $("uploadBtn");
    err.textContent = ""; ok.textContent = "";
    if (!f){ err.textContent = "Pilih file dulu."; return; }
    const album = chosenAlbum(), category = catVal();
    if (album.length < 2){ err.textContent = "Isi nama album (minimal 2 karakter)."; $("albumNew").focus(); return; }
    const type = f.type || (/\.(mp4|m4v|mov)$/i.test(f.name) ? "video/mp4" : /\.mp3$/i.test(f.name) ? "audio/mpeg" : "");
    if (!/^(video|audio)\//.test(type)){ err.textContent = "Hanya file video atau audio."; return; }
    if (f.size > cfg.maxUploadMB * 1048576){ err.textContent = "File terlalu besar (maks " + cfg.maxUploadMB + " MB)."; return; }

    btn.disabled = true; prog.hidden = false; prog.value = 0;
    try{
      const r = await fetch("/api/presign", {
        method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+token},
        body: JSON.stringify({ category, album, filename: f.name, contentType: type, size: f.size })
      });
      const d = await r.json();
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error(d.error || "Gagal memulai upload");

      await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PUT", d.uploadUrl);
        x.setRequestHeader("Content-Type", type);
        x.upload.onprogress = e => { if (e.lengthComputable) prog.value = Math.round(e.loaded / e.total * 100); };
        x.onload = () => x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload ditolak R2 (kode " + x.status + ")"));
        x.onerror = () => reject(new Error("Upload gagal. Periksa CORS R2: method PUT dan header Content-Type harus diizinkan."));
        x.send(f);
      });
      ok.textContent = "Upload selesai: " + f.name + " → " + CATNAME[category] + " › " + d.album;
      $("file").value = "";
      await loadAdmin(d.album);
    }catch(e){
      err.textContent = e.message;
    }finally{
      btn.disabled = false; prog.hidden = true;
    }
  });

  /* ---------- dashboard admin: daftar ---------- */
  function adminExpired(){ ss.del(TOKEN_KEY); token = ""; $("username").value = ""; togglePw(false); showGate(); $("gateErr").textContent = "Sesi admin habis, silakan masuk lagi"; }
  $("aOut").addEventListener("click", () => { ss.del(TOKEN_KEY); token = ""; $("username").value = ""; togglePw(false); showGate(); });

  async function loadAdmin(keepAlbum){
    $("aerr").textContent = "";
    const prevCat = catVal(), prevSel = $("albumSel").value;
    try{ items = await fetchItems(); }catch(ex){ items = []; $("aerr").textContent = ex.message; }
    refreshAlbumChoices();
    if (keepAlbum){ const o = [...$("albumSel").options].find(o => o.value.toLowerCase() === keepAlbum.toLowerCase()); if (o){ $("albumSel").value = o.value; toggleNew(); } }
    else if (prevSel && [...$("albumSel").options].some(o => o.value === prevSel)){ $("albumSel").value = prevSel; toggleNew(); }
    renderAdmin();
  }
  const checks = () => [...document.querySelectorAll("#alist input[type=checkbox]")];
  function sync(){
    const n = checks().filter(c=>c.checked).length;
    $("del").disabled = !n; $("del").textContent = n ? "Hapus terpilih ("+n+")" : "Hapus terpilih";
  }
  function renderAdmin(){
    const q = $("q").value.trim().toLowerCase();
    const shown = items.filter(i => !q || i.title.toLowerCase().includes(q) || i.album.toLowerCase().includes(q) || CATNAME[i.category].toLowerCase().includes(q));
    $("sCount").textContent = items.length;
    $("sSize").textContent = fmtSize(items.reduce((a,i)=>a+i.size,0));
    const ul = $("alist"); ul.innerHTML = ""; $("all").checked = false;
    if (!shown.length){ const li = el("li", "empty", "Tidak ada file."); li.style.display = "block"; ul.appendChild(li); sync(); return; }
    ["free","premium"].forEach(cat => {
      const inCat = shown.filter(i => i.category === cat); if (!inCat.length) return;
      const byAlbum = new Map();
      inCat.forEach(i => { const k = i.album.toLowerCase(); if (!byAlbum.has(k)) byAlbum.set(k, { name: i.album, list: [] }); byAlbum.get(k).list.push(i); });
      byAlbum.forEach(a => {
        const gh = el("li", "grp"); gh.append(el("span", "pill " + cat, CATNAME[cat]), el("b", "", a.name), el("small", "", a.list.length + " file"));
        ul.appendChild(gh);
        a.list.forEach(it => {
          const li = el("li");
          const cb = el("input"); cb.type = "checkbox"; cb.dataset.key = it.key; cb.setAttribute("aria-label","Pilih "+it.title);
          cb.addEventListener("change", sync);
          const mid = el("div");
          mid.append(el("div", "name", it.title), el("div", "meta", fmtSize(it.size) + " · " + new Date(it.lastModified).toLocaleString("id-ID")));
          const acts = el("div", "acts");
          const open = el("a", "", "Buka"); open.href = it.url; open.target = "_blank"; open.rel = "noopener";
          const cp = el("button", "", "Salin link"); cp.type = "button";
          cp.addEventListener("click", async () => {
            try{ await navigator.clipboard.writeText(it.url); cp.textContent = "Tersalin"; setTimeout(()=>cp.textContent="Salin link",1500); }
            catch(e){ prompt("Salin link:", it.url); }
          });
          acts.append(open, cp);
          li.append(cb, mid, acts); ul.appendChild(li);
        });
      });
    });
    sync();
  }
  $("all").addEventListener("change", e => { checks().forEach(c => c.checked = e.target.checked); sync(); });
  $("q").addEventListener("input", renderAdmin);
  $("del").addEventListener("click", async () => {
    const keys = checks().filter(c=>c.checked).map(c=>c.dataset.key);
    if (!keys.length) return;
    if (!confirm("Hapus "+keys.length+" file secara permanen? Tindakan ini tidak bisa dibatalkan.")) return;
    $("del").disabled = true; $("aerr").textContent = "";
    try{
      const r = await fetch("/api/delete", { method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}, body: JSON.stringify({ keys }) });
      const d = await r.json();
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error(d.error || "Gagal menghapus");
      await loadAdmin();
    }catch(ex){ $("aerr").textContent = ex.message; sync(); }
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
    const saved = ls.get(NAME_KEY);
    if (NAME_RE.test(saved) && !isAdminName(saved)){ username = saved; showApp(); } else showGate();
  }
  start();
})();
