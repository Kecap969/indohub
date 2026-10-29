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
      x.onload = () => x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload ditolak R2 (kode " + x.status + ")"));
      x.onerror = () => reject(new Error("Upload gagal. Periksa CORS R2: method PUT dan header Content-Type harus diizinkan."));
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
      $("priceTxt").textContent = rupiah(price);
      const q = $("qrisPrev"); q.hidden = !r.d.qris; if (r.d.qris) q.src = r.d.qris;
      $("payErr").textContent = "";
      renderPays(); renderUsers(); renderHome(); updateDot();
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
    const cards = [
      ["File", items.length, () => setTab("media")],
      ["Total ukuran", fmtSize(items.reduce((a, i) => a + i.size, 0)), () => setTab("media")],
      ["Album", albums, () => setTab("media")],
      ["Pengguna", users.length, () => { F.user = "all"; renderUsers(); setTab("users"); }],
      ["Premium aktif", users.filter(isActive).length, () => { F.user = "premium"; renderUsers(); setTab("users"); }],
      ["Menunggu verifikasi", pend, () => goPay("pending")],
    ];
    const box = $("homeStats"); box.innerHTML = "";
    cards.forEach(([label, val, go]) => {
      const b = el("button", "astat" + (label === "Menunggu verifikasi" && pend ? " hot" : "")); b.type = "button";
      b.append(el("b", "", String(val)), el("span", "", label));
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

      await putFile(d.uploadUrl, f, type, v => { prog.value = v; });

      if (type.startsWith("video/")){
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
      ok.textContent = "Upload selesai: " + f.name + " → " + CATNAME[category] + " › " + d.album;
      $("file").value = "";
      await loadMedia(d.album);
    }catch(e){
      err.textContent = e.message;
    }finally{
      btn.disabled = false; prog.hidden = true;
    }
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
  function renderMedia(){
    const q = $("q").value.trim().toLowerCase();
    const cnt = c => items.filter(i => c === "all" || i.category === c).length;
    chips($("mediaChips"), [
      { v:"all", t:"Semua", n:cnt("all") }, { v:"free", t:"Gratis", n:cnt("free") }, { v:"premium", t:"Premium", n:cnt("premium") }
    ], F.media, v => { F.media = v; renderMedia(); });

    const shown = items.filter(i => (F.media === "all" || i.category === F.media) &&
      (!q || i.title.toLowerCase().includes(q) || i.album.toLowerCase().includes(q)));
    const ul = $("alist"); ul.innerHTML = "";
    if (!shown.length){
      const li = el("li", "empty", items.length ? "Tidak ada file yang cocok." : "Belum ada media."); li.style.display = "block";
      ul.appendChild(li); sync(); return;
    }
    ["free", "premium"].forEach(cat => {
      const inCat = shown.filter(i => i.category === cat); if (!inCat.length) return;
      const byAlbum = new Map();
      inCat.forEach(i => { const k = i.album.toLowerCase(); if (!byAlbum.has(k)) byAlbum.set(k, { name: i.album, list: [] }); byAlbum.get(k).list.push(i); });
      byAlbum.forEach((a, k) => {
        const gk = cat + "/" + k;
        const gh = el("li", "grp");
        const hc = el("input"); hc.type = "checkbox"; hc.dataset.gh = gk; hc.setAttribute("aria-label", "Pilih semua di album " + a.name);
        hc.addEventListener("change", () => { checks().filter(c => c.dataset.grp === gk).forEach(c => { c.checked = hc.checked; }); sync(); });
        gh.append(hc, el("span", "pill " + cat, CATNAME[cat]), el("b", "", a.name),
          el("small", "", a.list.length + " file · " + fmtSize(a.list.reduce((s, i) => s + i.size, 0))));
        ul.appendChild(gh);
        a.list.forEach(it => {
          const li = el("li");
          const cb = el("input"); cb.type = "checkbox"; cb.dataset.key = it.key; cb.dataset.grp = gk; cb.setAttribute("aria-label", "Pilih " + it.title);
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
          li.append(cb, mid, acts); ul.appendChild(li);
        });
      });
    });
    sync();
  }
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
      mid.append(nm, el("div", "meta", rupiah(p.amount) + " · " + p.months + " bln · " + fmtDateTime(p.createdAt) + (p.reason ? " · " + p.reason : "")));
      const acts = el("div", "pacts");
      if (p.status === "pending"){
        const sel = el("select"); sel.setAttribute("aria-label", "Durasi");
        [1, 2, 3, 6, 12].forEach(m => { const o = el("option", "", m + " bln"); o.value = m; if (m === p.months) o.selected = true; sel.appendChild(o); });
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
      $("qrisFile").value = ""; ok.textContent = "QRIS tersimpan di payment/qris.jpg.";
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
