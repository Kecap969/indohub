// Dashboard admin (halaman terpisah: /admin). Login tetap di halaman utama (index).
(function(){
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = "admin_token", MSG_KEY = "gate_msg";
  let cfg = { maxUploadMB:2048 };
  let items = [], pays = [], users = [], price = 0, token = "", tab = "home";
  const F = { media:"all", pay:"pending", user:"all" }; // filter aktif tiap tab

  const store = area => ({
    get(k){ try{ return area.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ area.setItem(k,v); }catch(e){} },
    del(k){ try{ area.removeItem(k); }catch(e){} }
  });
  const ss = store(window.sessionStorage);
  const rupiah = n => "Rp" + Number(n).toLocaleString("id-ID");
  const durTxt = m => m % 12 === 0 ? (m / 12) + " thn" : m + " bln";
  const fmtDate = d => new Date(d).toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
  const fmtDateTime = d => new Date(d).toLocaleString("id-ID", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
  const fmtSize = b => b >= 1073741824 ? (b/1073741824).toFixed(1)+" GB" : b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b/1024))+" KB";
  const ts = it => new Date(it.lastModified).getTime();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const CATNAME = { free:"Gratis", premium:"Premium" };
  const isActive = u => !!(u.premiumUntil && new Date(u.premiumUntil) > new Date());

  async function api(path, body, method){
    const o = { method: method || (body ? "POST" : "GET"), headers: {} };
    if (token) o.headers.Authorization = "Bearer " + token;
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
      x.onload = () => x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload ditolak (kode " + x.status + ")"));
      x.onerror = () => reject(new Error("Upload gagal. Periksa koneksi dan pengaturan CORS penyimpanan (method PUT dan header Content-Type harus diizinkan)."));
      x.send(file);
    });
  }
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

  // balik ke halaman login (index)
  function toLogin(msg){ ss.del(TOKEN_KEY); if (msg) ss.set(MSG_KEY, msg); location.replace("/"); }
  function adminExpired(){ toLogin("Sesi admin habis, silakan masuk lagi"); }
  $("aOut").addEventListener("click", () => toLogin(""));

  /* ---------- tab & navbar bawah ---------- */
  const TITLES = { home:"Beranda", media:"Media", pay:"Pembayaran", users:"Pengguna" };
  function setTab(name){
    if (!TITLES[name]) name = "home";
    tab = name; $("aTitle").textContent = TITLES[name];
    Object.keys(TITLES).forEach(t => { $("pane-" + t).hidden = t !== name; });
    document.querySelectorAll(".bottomnav button").forEach(b => {
      if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    sync(); window.scrollTo(0, 0);
  }
  document.querySelectorAll(".bottomnav button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  window.addEventListener("hashchange", () => { const n = location.hash.slice(1); if (TITLES[n] && n !== tab) setTab(n); });

  // deretan filter (chip)
  function chips(box, opts, cur, onPick){
    box.innerHTML = "";
    opts.forEach(o => {
      const b = el("button", "chip" + (o.v === cur ? " on" : ""), o.t); b.type = "button";
      b.setAttribute("aria-pressed", String(o.v === cur));
      if (o.n != null) b.append(" ", el("small", "", String(o.n)));
      b.addEventListener("click", () => onPick(o.v));
      box.appendChild(b);
    });
  }

  /* ---------- muat data ---------- */
  async function loadMedia(keepAlbum){
    $("aerr").textContent = "";
    const prevSel = $("albumSel").value;
    try{ items = await fetchItems(); }catch(ex){ items = []; $("aerr").textContent = ex.message; }
    refreshAlbumChoices();
    const opts = [...$("albumSel").options];
    if (keepAlbum){ const o = opts.find(o => o.value.toLowerCase() === keepAlbum.toLowerCase()); if (o){ $("albumSel").value = o.value; toggleNew(); } }
    else if (prevSel && opts.some(o => o.value === prevSel)){ $("albumSel").value = prevSel; toggleNew(); }
    if (!items.length) $("upDetails").open = true;
    renderMedia(); renderHome();
  }
  async function loadPay(){
    try{
      const r = await api("/api/admin/overview");
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal memuat data pembayaran");
      price = r.d.price; pays = r.d.payments || []; users = r.d.users || [];
      const pl = r.d.plans || { 1: price, 12: price * 12 };
      $("priceTxt").textContent = rupiah(pl[1]) + " / bulan · " + rupiah(pl[12]) + " / tahun";
      const q = $("qrisPrev"); q.hidden = !r.d.qris; if (r.d.qris) q.src = r.d.qris;
      $("payErr").textContent = "";
      renderPays(); renderUsers(); fillNotifyTargets(); renderHome(); updateDot();
    }catch(e){ $("payErr").textContent = e.message; }
  }
  const pendingCount = () => pays.filter(p => p.status === "pending").length;
  function updateDot(){
    const n = pendingCount(), d = $("payDot");
    d.hidden = !n; d.textContent = n > 99 ? "99+" : String(n);
  }

  /* ---------- beranda ---------- */
  function goPay(status){ F.pay = status; renderPays(); setTab("pay"); }
  function renderHome(){
    const pend = pendingCount();
    const albums = new Set(items.map(i => i.category + "/" + i.album.toLowerCase())).size;
    const S = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
    const IC = {
      file: S('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>'),
      disk: S('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
      album: S('<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z"/>'),
      users: S('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6"/><path d="M18.5 14.8c1.6.8 2.7 2.4 3 5.2"/>'),
      crown: S('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/>'),
      clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    };
    const cards = [
      ["File", items.length, () => setTab("media"), IC.file, "#2f5bff"],
      ["Total ukuran", fmtSize(items.reduce((a, i) => a + i.size, 0)), () => setTab("media"), IC.disk, "#7b5cff"],
      ["Album", albums, () => setTab("media"), IC.album, "#0e9aa7"],
      ["Pengguna", users.length, () => { F.user = "all"; renderUsers(); setTab("users"); }, IC.users, "#2f8f5b"],
      ["Premium aktif", users.filter(isActive).length, () => { F.user = "premium"; renderUsers(); setTab("users"); }, IC.crown, "#b7791f"],
      ["Menunggu verifikasi", pend, () => goPay("pending"), IC.clock, "#d98a00"],
    ];
    const box = $("homeStats"); box.innerHTML = "";
    cards.forEach(([label, val, go, icon, color]) => {
      const b = el("button", "astat" + (label === "Menunggu verifikasi" && pend ? " hot" : "")); b.type = "button";
      b.style.setProperty("--c", color);
      const ic = el("span", "aic"); ic.innerHTML = icon; ic.setAttribute("aria-hidden", "true");
      b.append(ic, el("b", "", String(val)), el("span", "", label));
      b.addEventListener("click", go); box.appendChild(b);
    });
    $("todoCard").hidden = !pend;
    if (pend) $("todoTxt").textContent = pend + " bukti transfer menunggu verifikasi";

    const ul = $("recentList"); ul.innerHTML = "";
    const recent = items.slice(0, 5);
    if (!recent.length){ const li = el("li", "empty", "Belum ada media. Upload dulu di tab Media."); li.style.display = "block"; ul.appendChild(li); return; }
    recent.forEach(it => {
      const li = el("li", "recent"), mid = el("div");
      const nm = el("div", "name", it.title); nm.append(" ", el("span", "pill " + it.category, CATNAME[it.category]));
      mid.append(nm, el("div", "meta", it.album + " · " + fmtSize(it.size) + " · " + fmtDateTime(it.lastModified)));
      li.appendChild(mid); ul.appendChild(li);
    });
  }
  $("todoBtn").addEventListener("click", () => goPay("pending"));

  /* ---------- media: upload ---------- */
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
    $("albumRow").hidden = catVal() === "free"; // video gratis tidak memakai album
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
    if (catVal() === "free") return "Umum"; // folder internal; pengguna melihat semua video gratis langsung di Home
    if ($("albumSel").value !== NEW) return $("albumSel").value;
    const typed = $("albumNew").value.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim();
    const same = albumsOf(catVal()).find(a => a.name.toLowerCase() === typed.toLowerCase()); // jangan buat album ganda
    return same ? same.name : typed;
  }

  // ambil 1 frame dari video lokal (di browser admin) sebagai gambar JPEG kecil
  function makeThumb(file){
    return new Promise(resolve => {
      const url = URL.createObjectURL(file), v = document.createElement("video");
      let done = false;
      const end = blob => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute("src"); v.load(); resolve(blob); };
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); };
      v.onseeked = () => {
        try{
          const w = 480, h = Math.round(w * (v.videoHeight || 270) / (v.videoWidth || 480));
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(v, 0, 0, w, h);
          c.toBlob(b => end(b), "image/jpeg", 0.75);
        }catch(e){ end(null); }
      };
      v.onerror = () => end(null);
      setTimeout(() => end(null), 15000);
      v.src = url;
    });
  }

  /* ---------- upload banyak file sekaligus (antrean, satu per satu) ---------- */
  let queue = []; // [{ f, li, st, bar }]
  const typeOf = f => f.type || (/\.(mp4|m4v|mov)$/i.test(f.name) ? "video/mp4" : /\.mp3$/i.test(f.name) ? "audio/mpeg" : "");
  function setSt(q, text, cls){ q.st.textContent = text; q.li.className = cls || ""; }
  function renderQueue(){
    const ul = $("upQueue"); ul.innerHTML = ""; queue = [];
    [...$("file").files].forEach(f => {
      const li = el("li"), top = el("div", "uptop");
      const nm = el("span", "upname", f.name), st = el("span", "upst", fmtSize(f.size));
      top.append(nm, st);
      const bar = el("progress"); bar.max = 100; bar.value = 0; bar.hidden = true;
      li.append(top, bar); ul.appendChild(li);
      queue.push({ f, li, st, bar });
    });
    $("uploadBtn").textContent = queue.length > 1 ? "Upload " + queue.length + " file" : "Upload";
  }
  $("file").addEventListener("change", () => { $("upErr").textContent = ""; $("upOk").textContent = ""; renderQueue(); });

  async function uploadOne(q, category, album){
    const f = q.f, type = typeOf(f);
    if (!/^(video|audio)\//.test(type)) throw new Error("Bukan file video/audio");
    if (f.size > cfg.maxUploadMB * 1048576) throw new Error("Terlalu besar (maks " + cfg.maxUploadMB + " MB)");
    const r = await fetch("/api/presign", {
      method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+token},
      body: JSON.stringify({ category, album, filename: f.name, contentType: type, size: f.size })
    });
    const d = await r.json();
    if (r.status === 401){ adminExpired(); throw new Error("Sesi habis"); }
    if (!r.ok) throw new Error(d.error || "Gagal memulai upload");

    q.bar.hidden = false; q.bar.value = 0;
    await putFile(d.uploadUrl, f, type, v => { q.bar.value = v; q.st.textContent = "Mengunggah " + v + "%"; });

    if (type.startsWith("video/")){
      q.st.textContent = "Membuat thumbnail...";
      try{
        const blob = await makeThumb(f);
        if (blob){
          const tr = await fetch("/api/presign-thumb", {
            method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+token},
            body: JSON.stringify({ key: d.key })
          });
          const td = await tr.json();
          if (tr.ok) await fetch(td.uploadUrl, { method: "PUT", headers: {"Content-Type":"image/jpeg"}, body: blob });
        }
      }catch(e){ /* thumbnail gagal tidak membatalkan upload */ }
    }
    return d.album;
  }

  $("uploadBtn").addEventListener("click", async () => {
    const err = $("upErr"), ok = $("upOk"), btn = $("uploadBtn");
    err.textContent = ""; ok.textContent = "";
    if (!queue.length){ err.textContent = "Pilih file dulu."; return; }
    const album = chosenAlbum(), category = catVal();
    if (album.length < 2){ err.textContent = "Isi nama album (minimal 2 karakter)."; $("albumNew").focus(); return; }

    const lock = v => { [btn, $("file"), $("albumSel"), $("albumNew"), ...document.querySelectorAll("input[name=cat]")].forEach(x => { x.disabled = v; }); };
    lock(true);
    const failed = []; let done = 0, lastAlbum = album;
    for (let i = 0; i < queue.length; i++){
      const q = queue[i];
      btn.textContent = "Mengunggah " + (i + 1) + " dari " + queue.length + "...";
      setSt(q, "Mengunggah 0%", "active");
      try{
        lastAlbum = await uploadOne(q, category, album) || lastAlbum;
        q.bar.value = 100; setSt(q, "Selesai ✓", "okrow"); done++;
      }catch(e){
        q.bar.hidden = true; setSt(q, "Gagal: " + e.message, "failrow"); failed.push(q.f);
        if (e.message === "Sesi habis") return;
      }
    }
    lock(false);
    ok.textContent = done + " file berhasil diunggah ke " + CATNAME[category] + " › " + lastAlbum + (failed.length ? ", " + failed.length + " gagal" : "") + ".";
    if (failed.length) err.textContent = "Ada file yang gagal. Tekan Upload lagi untuk mencoba ulang file yang gagal saja.";
    // sisakan hanya file yang gagal (di antrean & input) supaya bisa dicoba ulang; baris selesai tetap tampil sebagai info
    queue = queue.filter(q => failed.includes(q.f));
    try{ const dt = new DataTransfer(); queue.forEach(q => dt.items.add(q.f)); $("file").files = dt.files; }catch(e){ if (!queue.length) $("file").value = ""; }
    btn.textContent = queue.length > 1 ? "Upload " + queue.length + " file" : "Upload";
    await loadMedia(lastAlbum);
  });

  /* ---------- media: daftar, pilih, hapus ---------- */
  const checks = () => [...document.querySelectorAll("#alist input[data-key]")];
  const selected = () => checks().filter(c => c.checked);
  function sync(){
    const n = selected().length;
    $("selBar").hidden = !(tab === "media" && n);
    $("selTxt").textContent = n + " file dipilih";
    $("del").disabled = !n;
    // status checkbox header album & "pilih semua"
    document.querySelectorAll("#alist input[data-gh]").forEach(h => {
      const mine = checks().filter(c => c.dataset.grp === h.dataset.gh);
      h.checked = mine.length > 0 && mine.every(c => c.checked);
      h.indeterminate = !h.checked && mine.some(c => c.checked);
    });
    const all = checks(); $("all").checked = all.length > 0 && all.every(c => c.checked);
  }
  /* ----- tampilan folder: kartu per folder, klik untuk melihat & mengelola isinya ----- */
  let openFolder = null; // { cat, key (nama album huruf kecil), name }
  const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z"/></svg>';
  const folderItems = f => items.filter(i => i.category === f.cat && i.album.toLowerCase() === f.key);
  function foldersOf(){
    const map = new Map();
    items.forEach(i => {
      const k = i.category + "/" + i.album.toLowerCase();
      if (!map.has(k)) map.set(k, { cat: i.category, key: i.album.toLowerCase(), name: i.album, list: [], latest: 0, size: 0 });
      const f = map.get(k); f.list.push(i); f.latest = Math.max(f.latest, ts(i)); f.size += i.size;
    });
    return [...map.values()].sort((a, b) => b.latest - a.latest);
  }
  function renderMedia(){
    if (openFolder && !folderItems(openFolder).length) openFolder = null; // folder sudah kosong: kembali ke daftar folder
    $("folderView").hidden = !!openFolder; $("fileView").hidden = !openFolder;
    if (openFolder) renderFiles(); else renderFolders();
  }
  function renderFolders(){
    $("alist").innerHTML = ""; sync();
    const q = $("q").value.trim().toLowerCase(), all = foldersOf();
    const cnt = c => all.filter(f => c === "all" || f.cat === c).length;
    chips($("mediaChips"), [
      { v:"all", t:"Semua", n:cnt("all") }, { v:"free", t:"Gratis", n:cnt("free") }, { v:"premium", t:"Premium", n:cnt("premium") }
    ], F.media, v => { F.media = v; renderMedia(); });
    const list = all.filter(f => (F.media === "all" || f.cat === F.media) &&
      (!q || f.name.toLowerCase().includes(q) || f.list.some(i => i.title.toLowerCase().includes(q))));
    const box = $("folders"); box.innerHTML = "";
    if (!list.length){ box.appendChild(el("p", "empty", all.length ? "Tidak ada folder yang cocok." : "Belum ada media. Upload dulu lewat kartu di atas.")); return; }
    list.forEach(f => {
      const b = el("button", "fcard"); b.type = "button";
      b.setAttribute("aria-label", "Buka folder " + f.name + ", " + CATNAME[f.cat] + ", " + f.list.length + " file");
      const ic = el("span", "ficon"); ic.innerHTML = ICON_FOLDER; ic.style.setProperty("--h", hue(f.name.toLowerCase())); ic.setAttribute("aria-hidden", "true");
      b.append(el("span", "pill " + f.cat, CATNAME[f.cat]), ic, el("b", "", f.name), el("small", "", f.list.length + " file · " + fmtSize(f.size)));
      b.addEventListener("click", () => { openFolder = { cat: f.cat, key: f.key, name: f.name }; $("fq").value = ""; renderMedia(); window.scrollTo(0, 0); });
      box.appendChild(b);
    });
  }
  function renderFiles(){
    const f = openFolder, all = folderItems(f), keep = new Set(selected().map(c => c.dataset.key));
    $("fName").textContent = f.name;
    $("fPill").className = "pill " + f.cat; $("fPill").textContent = CATNAME[f.cat];
    $("fMeta").textContent = all.length + " file · " + fmtSize(all.reduce((s, i) => s + i.size, 0));
    $("fRename").hidden = f.cat !== "premium"; // folder gratis adalah folder internal
    const q = $("fq").value.trim().toLowerCase();
    const list = all.filter(i => !q || i.title.toLowerCase().includes(q)).sort((a, b) => ts(b) - ts(a));
    const ul = $("alist"); ul.innerHTML = "";
    if (!list.length){ const li = el("li", "empty", "Tidak ada file yang cocok."); li.style.display = "block"; ul.appendChild(li); sync(); return; }
    list.forEach(it => {
      const li = el("li");
      const cb = el("input"); cb.type = "checkbox"; cb.dataset.key = it.key; cb.checked = keep.has(it.key); cb.setAttribute("aria-label", "Pilih " + it.title);
      cb.addEventListener("change", sync);
      const mid = el("div");
      mid.append(el("div", "name", it.title), el("div", "meta", (it.type === "audio" ? "Audio" : "Video") + " · " + fmtSize(it.size) + " · " + fmtDateTime(it.lastModified)));
      const acts = el("div", "acts");
      if (it.url){
        const open = el("a", "", "Buka"); open.href = it.url; open.target = "_blank"; open.rel = "noopener";
        const cp = el("button", "", "Salin link"); cp.type = "button";
        cp.addEventListener("click", async () => {
          try{ await navigator.clipboard.writeText(it.url); cp.textContent = "Tersalin"; setTimeout(() => cp.textContent = "Salin link", 1500); }
          catch(e){ prompt("Salin link:", it.url); }
        });
        acts.append(open, cp);
      }
      const mv = el("button", "mv", it.category === "free" ? "Ke Premium" : "Ke Gratis"); mv.type = "button";
      mv.addEventListener("click", () => openMove([it.key], it.category === "free" ? "premium" : "free"));
      acts.appendChild(mv);
      li.append(cb, mid, acts); ul.appendChild(li);
    });
    sync();
  }

  // aksi folder
  async function moveAll(keys, category, album){
    for (let i = 0; i < keys.length; i += 200){
      const r = await api("/api/move", { keys: keys.slice(i, i + 200), category, album });
      if (r.status === 401){ adminExpired(); throw new Error("Sesi habis"); }
      if (!r.ok) throw new Error(r.d.error || "Gagal memindahkan");
    }
  }
  $("fBack").addEventListener("click", () => { openFolder = null; renderMedia(); window.scrollTo(0, 0); });
  $("fq").addEventListener("input", renderMedia);
  $("fUp").addEventListener("click", () => {
    const f = openFolder; if (!f) return;
    document.querySelector("input[name=cat][value=" + f.cat + "]").checked = true;
    refreshAlbumChoices();
    if (f.cat === "premium"){ const o = [...$("albumSel").options].find(o => o.value.toLowerCase() === f.key); if (o){ $("albumSel").value = o.value; toggleNew(); } }
    $("upDetails").open = true; $("upDetails").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("fRename").addEventListener("click", async () => {
    const f = openFolder; if (!f) return;
    const typed = prompt("Nama baru folder:", f.name); if (typed === null) return;
    let name = typed.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim();
    if (name.length < 2){ $("aerr").textContent = "Nama folder minimal 2 karakter (huruf, angka, spasi, - atau _)."; window.scrollTo(0, 0); return; }
    if (name === f.name) return;
    const other = foldersOf().find(x => x.cat === "premium" && x.key === name.toLowerCase() && x.key !== f.key);
    if (other){ if (!confirm('Folder "' + other.name + '" sudah ada. Gabungkan isi folder ini ke sana?')) return; name = other.name; }
    $("aerr").textContent = ""; $("fRename").disabled = true;
    try{
      await moveAll(folderItems(f).map(i => i.key), "premium", name);
      openFolder = { cat: "premium", key: name.toLowerCase(), name };
    }catch(e){ $("aerr").textContent = e.message; window.scrollTo(0, 0); }
    finally{ $("fRename").disabled = false; }
    await loadMedia();
  });
  $("fDel").addEventListener("click", async () => {
    const f = openFolder; if (!f) return;
    const keys = folderItems(f).map(i => i.key);
    if (!confirm('Hapus folder "' + f.name + '" beserta ' + keys.length + " file di dalamnya secara permanen? Tindakan ini tidak bisa dibatalkan.")) return;
    $("aerr").textContent = ""; $("fDel").disabled = true;
    try{
      for (let i = 0; i < keys.length; i += 1000){
        const r = await api("/api/delete", { keys: keys.slice(i, i + 1000) });
        if (r.status === 401){ adminExpired(); return; }
        if (!r.ok) throw new Error(r.d.error || "Gagal menghapus");
      }
      openFolder = null;
    }catch(e){ $("aerr").textContent = e.message; window.scrollTo(0, 0); }
    finally{ $("fDel").disabled = false; }
    await loadMedia();
  });
  $("all").addEventListener("change", e => { checks().forEach(c => { c.checked = e.target.checked; }); sync(); });
  $("q").addEventListener("input", renderMedia);
  $("del").addEventListener("click", async () => {
    const keys = selected().map(c => c.dataset.key);
    if (!keys.length) return;
    if (!confirm("Hapus " + keys.length + " file secara permanen? Tindakan ini tidak bisa dibatalkan.")) return;
    $("del").disabled = true; $("aerr").textContent = "";
    try{
      const r = await fetch("/api/delete", { method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+token}, body: JSON.stringify({ keys }) });
      const d = await r.json();
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error(d.error || "Gagal menghapus");
      await loadMedia();
    }catch(ex){ $("aerr").textContent = ex.message; sync(); }
  });

  /* ---------- pindahkan file (Gratis <-> Premium) ---------- */
  let mvKeys = [];
  const mvCat = () => document.querySelector("input[name=mvcat]:checked").value;
  const itemOf = k => items.find(i => i.key === k) || {};
  function mvToggle(){
    const prem = mvCat() === "premium";
    $("mvAlbumBox").hidden = !prem; $("mvFreeNote").hidden = prem;
    $("mvNew").hidden = $("mvAlbum").value !== NEW;
  }
  function mvFillAlbums(){
    const sel = $("mvAlbum"), names = albumsOf("premium").map(a => a.name);
    sel.innerHTML = "";
    names.forEach(n => { const o = el("option", "", n); o.value = n; sel.appendChild(o); });
    const o = el("option", "", "+ Buat album baru"); o.value = NEW; sel.appendChild(o);
    if (!names.length) sel.value = NEW;
    mvToggle();
  }
  function openMove(keys, dest){
    if (!keys.length) return;
    mvKeys = keys; $("mvErr").textContent = "";
    const cats = new Set(keys.map(k => itemOf(k).category));
    dest = dest || (cats.size === 1 && cats.has("premium") ? "free" : "premium");
    document.querySelector("input[name=mvcat][value=" + dest + "]").checked = true;
    $("mvTitle").textContent = keys.length > 1 ? "Pindahkan " + keys.length + " file" : "Pindahkan file";
    $("mvInfo").textContent = keys.length === 1 ? (itemOf(keys[0]).title || "") : "Pilih tujuan untuk file yang dipilih.";
    $("mvNew").value = ""; mvFillAlbums();
    $("mvSheet").hidden = false; document.body.classList.add("noscroll");
  }
  function closeMove(){ $("mvSheet").hidden = true; document.body.classList.remove("noscroll"); }
  document.querySelectorAll("input[name=mvcat]").forEach(r => r.addEventListener("change", mvToggle));
  $("mvAlbum").addEventListener("change", () => { mvToggle(); if (!$("mvNew").hidden) $("mvNew").focus(); });
  $("mvBtn").addEventListener("click", () => openMove(selected().map(c => c.dataset.key)));
  $("mvClose").addEventListener("click", closeMove);
  $("mvBg").addEventListener("click", closeMove);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("mvSheet").hidden) closeMove(); });
  $("mvGo").addEventListener("click", async () => {
    const dest = mvCat(), err = $("mvErr"), btn = $("mvGo"); err.textContent = "";
    let album = "";
    if (dest === "premium"){
      album = $("mvAlbum").value === NEW ? $("mvNew").value.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim() : $("mvAlbum").value;
      if (album.length < 2){ err.textContent = "Isi nama album (minimal 2 karakter)."; $("mvNew").focus(); return; }
      const same = albumsOf("premium").find(a => a.name.toLowerCase() === album.toLowerCase()); if (same) album = same.name;
    }
    const keys = dest === "free" ? mvKeys.filter(k => itemOf(k).category !== "free") : mvKeys;
    if (!keys.length){ err.textContent = "File yang dipilih sudah ada di Gratis."; return; }
    btn.disabled = true; btn.textContent = "Memindahkan...";
    try{
      const r = await api("/api/move", { keys, category: dest, album });
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal memindahkan");
      closeMove(); await loadMedia();
    }catch(e){ err.textContent = e.message; loadMedia(); }
    finally{ btn.disabled = false; btn.textContent = "Pindahkan"; }
  });

  /* ---------- pembayaran ---------- */
  async function decide(id, act, body){
    const r = await api("/api/admin/payments/" + id + "/" + act, body || {});
    if (r.status === 401){ adminExpired(); return; }
    if (!r.ok){ $("payErr").textContent = r.d.error || "Gagal memproses"; renderPays(); return; }
    loadPay();
  }
  const PSTAT = { pending:"Menunggu", approved:"Disetujui", rejected:"Ditolak" };
  function renderPays(){
    const cnt = s => pays.filter(p => s === "all" || p.status === s).length;
    chips($("payChips"), [
      { v:"pending", t:"Menunggu", n:cnt("pending") }, { v:"approved", t:"Disetujui", n:cnt("approved") },
      { v:"rejected", t:"Ditolak", n:cnt("rejected") }, { v:"all", t:"Semua", n:cnt("all") }
    ], F.pay, v => { F.pay = v; renderPays(); });

    const list = pays.filter(p => F.pay === "all" || p.status === F.pay);
    const ul = $("payList"); ul.innerHTML = "";
    if (!list.length){
      ul.appendChild(el("li", "empty", F.pay === "pending" ? "Tidak ada bukti transfer yang menunggu." : "Belum ada data."));
      return;
    }
    list.slice().sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)).forEach(p => {
      const li = el("li");
      const a = el("a"); a.href = p.proofUrl || "#"; a.target = "_blank"; a.rel = "noopener";
      const img = el("img"); img.alt = "Bukti " + p.username; img.loading = "lazy"; if (p.proofUrl) img.src = p.proofUrl; a.appendChild(img);
      const mid = el("div"), nm = el("div", "name", p.username);
      nm.append(" ", el("span", "pill " + p.status, PSTAT[p.status]));
      mid.append(nm, el("div", "meta", rupiah(p.amount) + " · " + durTxt(p.months) + " · " + fmtDateTime(p.createdAt) + (p.reason ? " · " + p.reason : "")));
      const acts = el("div", "pacts");
      if (p.status === "pending"){
        const sel = el("select"); sel.setAttribute("aria-label", "Durasi");
        [...new Set([1, 12, p.months])].sort((a, b) => a - b).forEach(m => { const o = el("option", "", durTxt(m)); o.value = m; if (m === p.months) o.selected = true; sel.appendChild(o); });
        const ok = el("button", "btn", "Setujui"); ok.type = "button";
        ok.addEventListener("click", () => { ok.disabled = true; decide(p.id, "approve", { months: Number(sel.value) }); });
        const no = el("button", "btn danger", "Tolak"); no.type = "button";
        no.addEventListener("click", () => {
          const reason = prompt("Alasan penolakan (boleh kosong):"); if (reason === null) return;
          no.disabled = true; decide(p.id, "reject", { reason });
        });
        acts.append(sel, ok, no);
      }
      li.append(a, mid, acts); ul.appendChild(li);
    });
  }

  $("qrisBtn").addEventListener("click", async () => {
    const f = $("qrisFile").files[0], err = $("qrisErr"), ok = $("qrisOk"), btn = $("qrisBtn");
    err.textContent = ""; ok.textContent = "";
    if (!f){ err.textContent = "Pilih gambar QRIS dulu."; return; }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)){ err.textContent = "QRIS harus berupa gambar JPG, PNG, atau WebP."; return; }
    if (f.size > 5 * 1048576){ err.textContent = "Ukuran gambar maksimal 5 MB."; return; }
    btn.disabled = true;
    try{
      const p = await api("/api/payment/qris-presign", { contentType: f.type, size: f.size });
      if (p.status === 401){ adminExpired(); return; }
      if (!p.ok) throw new Error(p.d.error || "Gagal memulai upload");
      await putFile(p.d.uploadUrl, f, f.type);
      $("qrisFile").value = ""; ok.textContent = "QRIS berhasil disimpan.";
      loadPay();
    }catch(e){ err.textContent = e.message; }
    finally{ btn.disabled = false; }
  });

  /* ---------- pengguna ---------- */
  function renderUsers(){
    const q = $("uq").value.trim().toLowerCase();
    const match = (u, f) => f === "all" || (f === "premium") === isActive(u);
    const cnt = f => users.filter(u => match(u, f)).length;
    chips($("userChips"), [
      { v:"all", t:"Semua", n:cnt("all") }, { v:"premium", t:"Premium", n:cnt("premium") }, { v:"free", t:"Gratis", n:cnt("free") }
    ], F.user, v => { F.user = v; renderUsers(); });

    const list = users.filter(u => match(u, F.user) && (!q || u.username.toLowerCase().includes(q)));
    const ul = $("userList"); ul.innerHTML = "";
    if (!list.length){ ul.appendChild(el("li", "empty", users.length ? "Tidak ada pengguna yang cocok." : "Belum ada pengguna.")); return; }
    list.forEach(u => {
      const li = el("li", "nothumb"), mid = el("div");
      const nm = el("div", "name", u.username);
      nm.append(" ", el("span", "pill " + (isActive(u) ? "premium" : "pending"), isActive(u) ? "Premium" : "Gratis"));
      mid.append(nm, el("div", "meta", (isActive(u) ? "Sampai " + fmtDate(u.premiumUntil) : "Akun gratis") + " · " + (u.hasPassword ? "pakai password" : "tanpa password")));
      const acts = el("div", "pacts");
      if (u.hasPassword){
        const b = el("button", "btn ghost", "Hapus password"); b.type = "button";
        b.addEventListener("click", async () => {
          if (!confirm("Hapus password " + u.username + "? Akun bisa dimasuki hanya dengan username sampai user membuat password baru.")) return;
          const r = await api("/api/admin/users/" + encodeURIComponent(u.key) + "/clear-password", {});
          if (r.status === 401){ adminExpired(); return; }
          if (!r.ok){ $("payErr").textContent = r.d.error || "Gagal menghapus password"; return; }
          loadPay();
        });
        acts.appendChild(b);
      }
      li.append(mid, acts); ul.appendChild(li);
    });
  }
  $("uq").addEventListener("input", renderUsers);

  /* ---------- kirim notifikasi ---------- */
  function fillNotifyTargets(){
    const sel = $("nfTo"), cur = sel.value || "all";
    sel.innerHTML = "";
    const add = (v, t) => { const o = el("option", "", t); o.value = v; sel.appendChild(o); };
    add("all", "Semua pengguna (" + users.length + ")");
    users.forEach(u => add(u.key, u.username));
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : "all";
  }
  $("nfBtn").addEventListener("click", async () => {
    const title = $("nfTitle").value.trim(), body = $("nfBody").value.trim(), to = $("nfTo").value || "all";
    $("nfErr").textContent = ""; $("nfOk").textContent = "";
    if (!title){ $("nfErr").textContent = "Judul wajib diisi"; $("nfTitle").focus(); return; }
    const label = to === "all" ? "semua pengguna" : $("nfTo").selectedOptions[0].textContent;
    if (!confirm("Kirim notifikasi ke " + label + "?")) return;
    $("nfBtn").disabled = true;
    try{
      const r = await api("/api/admin/notify", { title, body, to });
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok){ $("nfErr").textContent = r.d.error || "Gagal mengirim notifikasi"; return; }
      $("nfOk").textContent = "Terkirim ke " + label + ".";
      $("nfTitle").value = ""; $("nfBody").value = "";
    }catch(e){ $("nfErr").textContent = "Tidak bisa terhubung ke server"; }
    finally{ $("nfBtn").disabled = false; }
  });

  /* ---------- start: wajib sudah login admin di halaman utama ---------- */
  async function start(){
    token = ss.get(TOKEN_KEY);
    if (!token){ toLogin(""); return; }
    try{
      const r = await fetch("/api/me", { headers:{ Authorization:"Bearer " + token } });
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error("server");
    }catch(e){
      $("aerr").textContent = "Tidak bisa terhubung ke server. Muat ulang halaman.";
    }
    try{ const r = await fetch("/api/config"); if (r.ok) cfg = Object.assign(cfg, await r.json()); }catch(e){}
    $("admin").hidden = false;
    setTab(TITLES[location.hash.slice(1)] ? location.hash.slice(1) : "home");
    loadMedia(); loadPay();
    // bukti transfer baru muncul otomatis (tiap 30 detik, hanya saat halaman terlihat)
    setInterval(() => { if (document.visibilityState === "visible") loadPay(); }, 30000);
  }
  start();
})();
