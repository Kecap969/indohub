// Dashboard admin (halaman terpisah: /admin). Login tetap di halaman utama (index).
(function(){
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = "admin_token", MSG_KEY = "gate_msg";
  let cfg = { maxUploadMB:2048, pricePerMonth:50000 }, items = [], token = "";

  const store = area => ({
    get(k){ try{ return area.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ area.setItem(k,v); }catch(e){} },
    del(k){ try{ area.removeItem(k); }catch(e){} }
  });
  const ss = store(window.sessionStorage);
  const rupiah = n => "Rp" + Number(n).toLocaleString("id-ID");
  const fmtDate = d => new Date(d).toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" });
  const fmtSize = b => b >= 1073741824 ? (b/1073741824).toFixed(1)+" GB" : b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b/1024))+" KB";
  const ts = it => new Date(it.lastModified).getTime();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const CATNAME = { free:"Gratis", premium:"Premium" };

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

      await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PUT", d.uploadUrl);
        x.setRequestHeader("Content-Type", type);
        x.upload.onprogress = e => { if (e.lengthComputable) prog.value = Math.round(e.loaded / e.total * 100); };
        x.onload = () => x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("Upload ditolak R2 (kode " + x.status + ")"));
        x.onerror = () => reject(new Error("Upload gagal. Periksa CORS R2: method PUT dan header Content-Type harus diizinkan."));
        x.send(f);
      });
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
      await loadAdmin(d.album);
    }catch(e){
      err.textContent = e.message;
    }finally{
      btn.disabled = false; prog.hidden = true;
    }
  });

  /* ---------- dashboard admin: daftar ---------- */

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


  /* ---------- admin: pembayaran ---------- */
  async function loadPayAdmin(){
    try{
      const r = await api("/api/admin/overview");
      if (r.status === 401){ adminExpired(); return; }
      if (!r.ok) throw new Error(r.d.error || "Gagal memuat data pembayaran");
      $("priceTxt").textContent = rupiah(r.d.price);
      const q = $("qrisPrev"); q.hidden = !r.d.qris; if (r.d.qris) q.src = r.d.qris;
      renderPays(r.d.payments); renderUsers(r.d.users); $("payErr").textContent = "";
    }catch(e){ $("payErr").textContent = e.message; }
  }
  async function decide(id, act, body){
    const r = await api("/api/admin/payments/" + id + "/" + act, body || {});
    if (r.status === 401){ adminExpired(); return; }
    if (!r.ok){ $("payErr").textContent = r.d.error || "Gagal memproses"; return; }
    loadPayAdmin();
  }
  const PSTAT = { pending:"Menunggu", approved:"Disetujui", rejected:"Ditolak" };
  function renderPays(list){
    const ul = $("payList"); ul.innerHTML = "";
    if (!list.length){ ul.appendChild(el("li", "empty", "Belum ada bukti transfer.")); return; }
    list.sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));
    list.forEach(p => {
      const li = el("li");
      const a = el("a"); a.href = p.proofUrl || "#"; a.target = "_blank"; a.rel = "noopener";
      const img = el("img"); img.alt = "Bukti " + p.username; img.loading = "lazy"; if (p.proofUrl) img.src = p.proofUrl; a.appendChild(img);
      const mid = el("div"), nm = el("div", "name", p.username);
      nm.append(" ", el("span", "pill " + p.status, PSTAT[p.status]));
      mid.append(nm, el("div", "meta", rupiah(p.amount) + " · " + p.months + " bln · " + new Date(p.createdAt).toLocaleString("id-ID") + (p.reason ? " · " + p.reason : "")));
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
  function renderUsers(list){
    const ul = $("userList"); ul.innerHTML = "";
    if (!list.length){ ul.appendChild(el("li", "empty", "Belum ada pengguna.")); return; }
    list.forEach(u => {
      const li = el("li", "nothumb"), mid = el("div");
      const active = u.premiumUntil && new Date(u.premiumUntil) > new Date();
      mid.append(el("div", "name", u.username),
        el("div", "meta", (active ? "Premium sampai " + fmtDate(u.premiumUntil) : "Gratis") + " · " + (u.hasPassword ? "pakai password" : "tanpa password")));
      const acts = el("div", "pacts");
      if (u.hasPassword){
        const b = el("button", "btn ghost", "Hapus password"); b.type = "button";
        b.addEventListener("click", async () => {
          if (!confirm("Hapus password " + u.username + "? Akun bisa dimasuki hanya dengan username sampai user membuat password baru.")) return;
          const r = await api("/api/admin/users/" + encodeURIComponent(u.key) + "/clear-password", {});
          if (r.status === 401){ adminExpired(); return; }
          if (!r.ok){ $("payErr").textContent = r.d.error || "Gagal menghapus password"; return; }
          loadPayAdmin();
        });
        acts.appendChild(b);
      }
      li.append(mid, acts); ul.appendChild(li);
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
      loadPayAdmin();
    }catch(e){ err.textContent = e.message; }
    finally{ btn.disabled = false; }
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
    loadAdmin(); loadPayAdmin();
  }
  start();
})();
