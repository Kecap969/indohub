(function(){
  const $ = id => document.getElementById(id);
  const NAME_KEY = "media_username", TOKEN_KEY = "admin_token";
  const NAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  let cfg = { title:"Perpustakaan Media", subtitle:"", maxUploadMB:2048, adminUser:"kecap" };
  let username = "", items = [], current = -1, hls = null, token = "";

  const ls = {
    get(k){ try{ return localStorage.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  const ss = {
    get(k){ try{ return sessionStorage.getItem(k) || ""; }catch(e){ return ""; } },
    set(k,v){ try{ sessionStorage.setItem(k,v); }catch(e){} },
    del(k){ try{ sessionStorage.removeItem(k); }catch(e){} }
  };
  const isAdminName = v => v.trim().toLowerCase() === cfg.adminUser;
  const fmtSize = b => b >= 1073741824 ? (b/1073741824).toFixed(1)+" GB" : b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b/1024))+" KB";

  /* ---------- pindah tampilan ---------- */
  function view(name){
    $("gate").hidden = name !== "gate";
    $("app").hidden = name !== "app";
    $("admin").hidden = name !== "admin";
  }
  function showGate(){ $("player").pause(); view("gate"); $("username").focus(); }
  function showApp(){ $("who").textContent = username; view("app"); loadList(); }
  function showAdmin(){ view("admin"); loadAdmin(); }

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

  /* ---------- daftar & pemutar ---------- */
  async function fetchItems(){
    const r = await fetch("/api/list"); const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Gagal memuat daftar");
    return d.items;
  }
  async function loadList(){
    const list = $("list");
    list.innerHTML = '<li class="empty">Memuat daftar...</li>';
    try{ items = await fetchItems(); }
    catch(e){
      items = []; list.innerHTML = "";
      const li = document.createElement("li"); li.className = "empty"; li.textContent = e.message; list.appendChild(li);
      return;
    }
    renderList();
  }
  function renderList(){
    const list = $("list"); list.innerHTML = "";
    if (!items.length){
      const li = document.createElement("li"); li.className = "empty"; li.textContent = "Belum ada media.";
      list.appendChild(li); return;
    }
    items.forEach((it, i) => {
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button";
      const left = document.createElement("span");
      const t = document.createElement("span"); t.className = "ttl"; t.textContent = it.title;
      left.append(t);
      const s = document.createElement("span"); s.className = "size"; s.textContent = fmtSize(it.size);
      b.append(left, s);
      b.addEventListener("click", () => play(i, true));
      li.appendChild(b); list.appendChild(li);
    });
    if (current < 0 || current >= items.length) play(0, false);
    else mark();
  }
  function mark(){ document.querySelectorAll("#list button").forEach((b,k)=>b.setAttribute("aria-current", k===current)); }

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
  async function play(i, auto){
    const it = items[i]; if (!it) return;
    current = i; $("plErr").textContent = "";
    $("stage").classList.toggle("is-audio", it.type === "audio");
    $("cover").textContent = it.title;
    $("nowTitle").textContent = it.title;
    mark();
    await attach(it.url);
    if (auto) $("player").play().catch(()=>{});
  }
  $("player").addEventListener("error", () => {
    $("plErr").textContent = "Media tidak bisa dimuat. Periksa domain publik R2 dan pengaturan CORS.";
  });
  $("player").addEventListener("ended", () => { if (current + 1 < items.length) play(current + 1, true); });

  /* ---------- upload ---------- */
  $("uploadBtn").addEventListener("click", async () => {
    const f = $("file").files[0], err = $("upErr"), ok = $("upOk"), prog = $("prog"), btn = $("uploadBtn");
    err.textContent = ""; ok.textContent = "";
    if (!f){ err.textContent = "Pilih file dulu."; return; }
    const type = f.type || (/\.(mp4|m4v|mov)$/i.test(f.name) ? "video/mp4" : /\.mp3$/i.test(f.name) ? "audio/mpeg" : "");
    if (!/^(video|audio)\//.test(type)){ err.textContent = "Hanya file video atau audio."; return; }
    if (f.size > cfg.maxUploadMB * 1048576){ err.textContent = "File terlalu besar (maks " + cfg.maxUploadMB + " MB)."; return; }

    btn.disabled = true; prog.hidden = false; prog.value = 0;
    try{
      const r = await fetch("/api/presign", {
        method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+token},
        body: JSON.stringify({ filename: f.name, contentType: type, size: f.size })
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
      ok.textContent = "Upload selesai: " + f.name;
      $("file").value = "";
      await loadAdmin();
    }catch(e){
      err.textContent = e.message;
    }finally{
      btn.disabled = false; prog.hidden = true;
    }
  });

  /* ---------- dashboard admin ---------- */
  function adminExpired(){ ss.del(TOKEN_KEY); token = ""; $("username").value = ""; togglePw(false); showGate(); $("gateErr").textContent = "Sesi admin habis, silakan masuk lagi"; }
  $("aOut").addEventListener("click", () => { ss.del(TOKEN_KEY); token = ""; $("username").value = ""; togglePw(false); showGate(); });

  async function loadAdmin(){
    $("aerr").textContent = "";
    try{ items = await fetchItems(); }catch(ex){ items = []; $("aerr").textContent = ex.message; }
    renderAdmin();
  }
  const checks = () => [...document.querySelectorAll("#alist input[type=checkbox]")];
  function sync(){
    const n = checks().filter(c=>c.checked).length;
    $("del").disabled = !n; $("del").textContent = n ? "Hapus terpilih ("+n+")" : "Hapus terpilih";
  }
  function renderAdmin(){
    const q = $("q").value.trim().toLowerCase();
    const shown = items.filter(i => !q || i.title.toLowerCase().includes(q) || i.uploader.toLowerCase().includes(q));
    $("sCount").textContent = items.length;
    $("sSize").textContent = fmtSize(items.reduce((a,i)=>a+i.size,0));
    const ul = $("alist"); ul.innerHTML = ""; $("all").checked = false;
    if (!shown.length){
      const li = document.createElement("li"); li.className = "empty"; li.style.display = "block"; li.textContent = "Tidak ada file.";
      ul.appendChild(li); sync(); return;
    }
    shown.forEach(it => {
      const li = document.createElement("li");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.dataset.key = it.key; cb.setAttribute("aria-label","Pilih "+it.title);
      cb.addEventListener("change", sync);
      const mid = document.createElement("div");
      const n = document.createElement("div"); n.className = "name"; n.textContent = it.title;
      const m = document.createElement("div"); m.className = "meta";
      m.textContent = it.uploader + " · " + fmtSize(it.size) + " · " + new Date(it.lastModified).toLocaleString("id-ID");
      mid.append(n, m);
      const a = document.createElement("div"); a.className = "acts";
      const open = document.createElement("a"); open.href = it.url; open.target = "_blank"; open.rel = "noopener"; open.textContent = "Buka";
      const cp = document.createElement("button"); cp.type = "button"; cp.textContent = "Salin link";
      cp.addEventListener("click", async () => {
        try{ await navigator.clipboard.writeText(it.url); cp.textContent = "Tersalin"; setTimeout(()=>cp.textContent="Salin link",1500); }
        catch(e){ prompt("Salin link:", it.url); }
      });
      a.append(open, cp);
      li.append(cb, mid, a); ul.appendChild(li);
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
    $("gateTitle").textContent = cfg.title; $("gateSub").textContent = cfg.subtitle; $("title").textContent = cfg.title;

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
