/** Same-origin API helpers */
function apiUrl(path) { return path.startsWith("/") ? path : `/${path}`; }

const LIKED_KEY = "roomscore_liked_v1";
const AUTH_KEY  = "roomscore_auth_v1";
const THEME_KEY = "roomscore_theme_v1";

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = theme === "light" ? "☀️" : "🌙";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
}

function toggleTheme() {
  const isLight = document.documentElement.classList.contains("light");
  const next = isLight ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function readLikedMap() {
  try { return JSON.parse(localStorage.getItem(LIKED_KEY) || "{}"); } catch { return {}; }
}
function writeLikedMap(map) { localStorage.setItem(LIKED_KEY, JSON.stringify(map)); }

function readAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
function writeAuth(data) {
  if (data) localStorage.setItem(AUTH_KEY, JSON.stringify(data));
  else localStorage.removeItem(AUTH_KEY);
}

function authHeaders() {
  const a = readAuth();
  return a ? { Authorization: `Bearer ${a.token}` } : {};
}

function imageSrc(p) {
  if (p.imageUrl) return p.imageUrl;
  if (p.imageFile) return `/uploads/${p.imageFile}`;
  return p.imageDataUrl || "";
}
function safeLower(s) { return (s ?? "").toString().toLowerCase(); }
function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function normalizeTags(raw) {
  return (raw || "").split(",").map((t) => t.trim()).filter(Boolean)
    .map((t) => t.replace(/\s+/g, " ")).slice(0, 14);
}
function buildSearchBlob(p) {
  return [p.title, p.room, p.style, (p.tags || []).join(" "), p.description]
    .filter(Boolean).join(" · ").toLowerCase();
}

async function getAllPosts() {
  const res = await fetch(apiUrl("/api/posts"));
  if (!res.ok) throw new Error(`Server returned ${res.status}. Run npm start in RoomScore.`);
  const data = await res.json();
  return data.posts || [];
}

async function deletePostRemote(id) {
  const res = await fetch(apiUrl(`/api/posts/${id}`), {
    method: "DELETE", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Delete failed.");
}

function el(id) { return document.getElementById(id); }

const state = {
  posts: [], query: "", activeChip: "", room: "", style: "", sort: "newest",
  selectedId: null,
  upload: { file: null, dataUrl: "", w: 0, h: 0 },
  authMode: "login", // "login" | "register"
};

const dom = {
  masonry: el("masonry"), empty: el("emptyState"),
  pinsCount: el("pinsCount"), likesCount: el("likesCount"), storageInfo: el("storageInfo"),
  chipRow: el("chipRow"), searchInput: el("searchInput"),
  sortSelect: el("sortSelect"), roomFilter: el("roomFilter"), styleFilter: el("styleFilter"),
  newPinBtn: el("newPinBtn"), emptyUploadBtn: el("emptyUploadBtn"),
  exportBtn: el("exportBtn"), importInput: el("importInput"),
  authBtn: el("authBtn"),

  uploadBackdrop: el("uploadBackdrop"), closeUploadBtn: el("closeUploadBtn"),
  cancelUploadBtn: el("cancelUploadBtn"), uploadForm: el("uploadForm"),
  dropZone: el("dropZone"), imageInput: el("imageInput"), browseBtn: el("browseBtn"),
  previewImg: el("previewImg"), titleInput: el("titleInput"), roomInput: el("roomInput"),
  styleInput: el("styleInput"), tagsInput: el("tagsInput"), descInput: el("descInput"),
  uploadStatus: el("uploadStatus"),

  detailBackdrop: el("detailBackdrop"), closeDetailBtn: el("closeDetailBtn"),
  detailImg: el("detailImg"), detailTitleText: el("detailTitleText"),
  detailSubText: el("detailSubText"), detailChips: el("detailChips"),
  detailDesc: el("detailDesc"), detailFooter: el("detailFooter"),
  detailLikeBtn: el("detailLikeBtn"), detailDeleteBtn: el("detailDeleteBtn"),
  commentsList: el("commentsList"), commentForm: el("commentForm"),
  commentInput: el("commentInput"), commentStatus: el("commentStatus"),

  authBackdrop: el("authBackdrop"), closeAuthBtn: el("closeAuthBtn"),
  authForm: el("authForm"), authUsername: el("authUsername"),
  authPassword: el("authPassword"), authError: el("authError"),
  authSubmitBtn: el("authSubmitBtn"), tabLogin: el("tabLogin"), tabRegister: el("tabRegister"),
  themeToggle: el("themeToggle"),

  aiBtn: el("aiBtn"), aiBackdrop: el("aiBackdrop"), closeAiBtn: el("closeAiBtn"),
  aiForm: el("aiForm"), aiPrompt: el("aiPrompt"), aiRoom: el("aiRoom"),
  aiStyle: el("aiStyle"), aiTitle: el("aiTitle"),
  aiGenerateBtn: el("aiGenerateBtn"), aiSaveBtn: el("aiSaveBtn"),
  aiRegenerateBtn: el("aiRegenerateBtn"), cancelAiBtn: el("cancelAiBtn"),
  aiPreviewWrap: el("aiPreviewWrap"), aiPreviewImg: el("aiPreviewImg"),
  aiLoading: el("aiLoading"), aiLoadingText: el("aiLoadingText"),
  aiError: el("aiError"), aiStatus: el("aiStatus"),
};

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(backdrop) {
  backdrop.removeAttribute("hidden");
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add("is-open")));
}

function closeModal(backdrop) {
  const finalize = () => {
    backdrop.setAttribute("hidden", "");
    backdrop.classList.remove("is-open");
    document.body.style.overflow = "";
  };
  if (!backdrop.classList.contains("is-open")) { finalize(); return; }
  backdrop.classList.remove("is-open");
  let settled = false;
  const settle = () => {
    if (settled) return; settled = true;
    backdrop.removeEventListener("transitionend", onEnd);
    clearTimeout(fallbackTimer);
    finalize();
  };
  const onEnd = (e) => { if (e.target !== backdrop) return; settle(); };
  backdrop.addEventListener("transitionend", onEnd);
  const fallbackTimer = setTimeout(settle, 450);
}

function bytesToNice(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let u = 0, v = n;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}

// ── Auth UI ───────────────────────────────────────────────────────────────────

function updateAuthBtn() {
  const a = readAuth();
  dom.authBtn.textContent = a ? `@${a.username}` : "Sign in";
}

function setAuthMode(mode) {
  state.authMode = mode;
  dom.authError.textContent = "";
  if (mode === "login") {
    dom.tabLogin.classList.add("authTab--active");
    dom.tabRegister.classList.remove("authTab--active");
    dom.authSubmitBtn.textContent = "Sign in";
    el("authTitle").textContent = "Sign in";
    dom.authPassword.autocomplete = "current-password";
  } else {
    dom.tabRegister.classList.add("authTab--active");
    dom.tabLogin.classList.remove("authTab--active");
    dom.authSubmitBtn.textContent = "Create account";
    el("authTitle").textContent = "Create account";
    dom.authPassword.autocomplete = "new-password";
  }
}

function openAuth() {
  const a = readAuth();
  if (a) {
    if (confirm(`Signed in as @${a.username}. Sign out?`)) {
      writeAuth(null);
      updateAuthBtn();
    }
    return;
  }
  setAuthMode("login");
  dom.authUsername.value = "";
  dom.authPassword.value = "";
  openModal(dom.authBackdrop);
}

async function submitAuth(e) {
  e.preventDefault();
  dom.authError.textContent = "";
  const username = dom.authUsername.value.trim();
  const password = dom.authPassword.value;
  const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  dom.authSubmitBtn.disabled = true;
  try {
    const res = await fetch(apiUrl(endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { dom.authError.textContent = data.error || "Something went wrong."; return; }
    writeAuth({ token: data.token, username: data.username });
    updateAuthBtn();
    closeModal(dom.authBackdrop);
  } catch {
    dom.authError.textContent = "Network error. Is the server running?";
  } finally {
    dom.authSubmitBtn.disabled = false;
  }
}

// ── Chips / filters / render ──────────────────────────────────────────────────

function renderChips(posts) {
  const counts = new Map();
  for (const p of posts) for (const t of p.tags || []) {
    const key = t.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  dom.chipRow.innerHTML = "";
  for (const key of top) {
    const btn = document.createElement("button");
    btn.className = "chip"; btn.type = "button";
    btn.textContent = `#${key}`; btn.dataset.key = key;
    btn.dataset.active = state.activeChip === key ? "true" : "false";
    btn.addEventListener("click", () => { state.activeChip = state.activeChip === key ? "" : key; render(); });
    dom.chipRow.appendChild(btn);
  }
}

function applyFilters(posts) {
  let out = posts.slice();
  if (state.room) out = out.filter((p) => p.room === state.room);
  if (state.style) out = out.filter((p) => p.style === state.style);
  const q = safeLower(state.query).trim();
  if (q) out = out.filter((p) => (p.searchBlob || "").includes(q));
  if (state.activeChip) {
    const chip = state.activeChip.toLowerCase();
    out = out.filter((p) => (p.tags || []).some((t) => t.toLowerCase() === chip));
  }
  switch (state.sort) {
    case "oldest": out.sort((a, b) => a.createdAt - b.createdAt); break;
    case "mostLiked": out.sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.createdAt - a.createdAt); break;
    case "titleAsc": out.sort((a, b) => a.title.localeCompare(b.title)); break;
    default: out.sort((a, b) => b.createdAt - a.createdAt);
  }
  return out;
}

function cardTemplate(post) {
  const card = document.createElement("article");
  card.className = "card"; card.tabIndex = 0;
  card.setAttribute("role", "button"); card.setAttribute("aria-label", `Open ${post.title}`);
  card.addEventListener("click", () => openDetail(post.id));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openDetail(post.id); });

  const thumbWrap = document.createElement("div"); thumbWrap.className = "thumbWrap";
  const img = document.createElement("img");
  img.className = "thumb"; img.loading = "lazy"; img.src = imageSrc(post); img.alt = post.title;
  const pill = document.createElement("div"); pill.className = "pill"; pill.textContent = post.room;
  thumbWrap.appendChild(img); thumbWrap.appendChild(pill);

  const meta = document.createElement("div"); meta.className = "meta";
  const titleRow = document.createElement("div"); titleRow.className = "titleRow";
  const title = document.createElement("div"); title.className = "cardTitle"; title.textContent = post.title;
  const likeBtn = document.createElement("button");
  likeBtn.className = "like"; likeBtn.type = "button"; likeBtn.dataset.on = post.liked ? "true" : "false";
  likeBtn.innerHTML = `<span aria-hidden="true">♥</span><span>${post.likes || 0}</span>`;
  likeBtn.addEventListener("click", async (e) => { e.stopPropagation(); await toggleLike(post.id); });
  titleRow.appendChild(title); titleRow.appendChild(likeBtn);

  const mini = document.createElement("div"); mini.className = "mini";
  mini.innerHTML = `<span>${post.style}</span><span>${fmtDate(post.createdAt)}</span>`;
  meta.appendChild(titleRow); meta.appendChild(mini);
  card.appendChild(thumbWrap); card.appendChild(meta);
  return card;
}

function renderStats(postsAll) {
  dom.pinsCount.textContent = `${postsAll.length}`;
  dom.likesCount.textContent = `${postsAll.reduce((s, p) => s + (p.likes || 0), 0)}`;
}

async function renderStorage() {
  try {
    const res = await fetch(apiUrl("/api/health"));
    dom.storageInfo.textContent = res.ok ? "Server" : "Offline";
  } catch { dom.storageInfo.textContent = "Offline"; }
}

function render() {
  const filtered = applyFilters(state.posts);
  renderChips(state.posts); renderStats(state.posts); renderStorage();
  dom.masonry.innerHTML = "";
  for (const p of filtered) dom.masonry.appendChild(cardTemplate(p));
  dom.empty.hidden = state.posts.length !== 0;
}

async function refresh() {
  const likedMap = readLikedMap();
  const posts = await getAllPosts();
  state.posts = posts.map((p) => ({
    ...p, likes: p.likes || 0, liked: !!likedMap[p.id],
    tags: Array.isArray(p.tags) ? p.tags : [],
    searchBlob: p.searchBlob || buildSearchBlob(p),
  }));
  render();
}

// ── Upload ────────────────────────────────────────────────────────────────────

function resetUploadForm() {
  state.upload = { file: null, dataUrl: "", w: 0, h: 0 };
  dom.previewImg.hidden = true; dom.previewImg.src = ""; dom.previewImg.alt = "";
  dom.uploadStatus.textContent = ""; dom.uploadForm.reset();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function getImageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = dataUrl;
  });
}

async function setSelectedFile(file) {
  if (!file) return;
  if (!file.type?.startsWith("image/")) { dom.uploadStatus.textContent = "Please select an image file."; return; }
  state.upload.file = file;
  dom.uploadStatus.textContent = "Loading preview…";
  const dataUrl = await readFileAsDataUrl(file);
  const { w, h } = await getImageSize(dataUrl);
  state.upload.dataUrl = dataUrl; state.upload.w = w; state.upload.h = h;
  dom.previewImg.src = dataUrl; dom.previewImg.alt = "Preview"; dom.previewImg.hidden = false;
  const nice = bytesToNice(file.size);
  dom.uploadStatus.textContent = `Image ready (${nice}${w && h ? `, ${w}×${h}` : ""}).`;
  if (file.size > 8 * 1024 * 1024) dom.uploadStatus.textContent += " Large uploads may be slower.";
}

function openUpload() {
  const a = readAuth();
  if (!a) { openAuth(); return; }
  resetUploadForm(); openModal(dom.uploadBackdrop);
}

async function saveNewPin() {
  if (!state.upload.file || !state.upload.dataUrl) {
    dom.uploadStatus.textContent = "Please add an image first."; return;
  }
  const fd = new FormData();
  fd.append("image", state.upload.file);
  fd.append("title", dom.titleInput.value.trim());
  fd.append("room", dom.roomInput.value);
  fd.append("style", dom.styleInput.value);
  fd.append("description", dom.descInput.value.trim());
  fd.append("tags", JSON.stringify(normalizeTags(dom.tagsInput.value)));
  fd.append("w", String(state.upload.w));
  fd.append("h", String(state.upload.h));
  dom.uploadStatus.textContent = "Saving…";
  const res = await fetch(apiUrl("/api/posts"), {
    method: "POST", headers: authHeaders(), body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    dom.uploadStatus.textContent = err.error || "Save failed. Is the server running?";
    return;
  }
  dom.uploadStatus.textContent = "Saved!";
  closeModal(dom.uploadBackdrop);
  await refresh();
}

// ── Detail modal ──────────────────────────────────────────────────────────────

async function loadComments(postId) {
  dom.commentsList.innerHTML = '<div class="muted" style="font-size:13px">Loading…</div>';
  try {
    const res = await fetch(apiUrl(`/api/posts/${postId}/comments`));
    const data = await res.json();
    renderComments(postId, data.comments || []);
  } catch {
    dom.commentsList.innerHTML = '<div class="muted" style="font-size:13px">Could not load comments.</div>';
  }
}

function renderComments(postId, comments) {
  dom.commentsList.innerHTML = "";
  const auth = readAuth();
  if (comments.length === 0) {
    dom.commentsList.innerHTML = '<div class="muted" style="font-size:13px">No comments yet. Be the first!</div>';
    return;
  }
  for (const c of comments) {
    const item = document.createElement("div");
    item.className = "commentItem";
    const isOwn = auth && auth.username === c.author;
    item.innerHTML = `
      <div class="commentMeta">
        <span class="commentAuthor">@${c.author}</span>
        <span class="commentDate muted">${fmtDate(c.createdAt)}</span>
        ${isOwn ? `<button class="commentDelete" data-id="${c.id}" type="button" aria-label="Delete comment">✕</button>` : ""}
      </div>
      <div class="commentText">${c.text.replace(/</g, "&lt;")}</div>
    `;
    if (isOwn) {
      item.querySelector(".commentDelete").addEventListener("click", async () => {
        await deleteComment(postId, c.id);
      });
    }
    dom.commentsList.appendChild(item);
  }
}

async function deleteComment(postId, commentId) {
  const res = await fetch(apiUrl(`/api/posts/${postId}/comments/${commentId}`), {
    method: "DELETE", headers: authHeaders(),
  });
  if (res.ok) await loadComments(postId);
}

async function submitComment(e) {
  e.preventDefault();
  const auth = readAuth();
  if (!auth) { dom.commentStatus.textContent = "Sign in to comment."; return; }
  const text = dom.commentInput.value.trim();
  if (!text) return;
  dom.commentStatus.textContent = "";
  const res = await fetch(apiUrl(`/api/posts/${state.selectedId}/comments`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    dom.commentStatus.textContent = err.error || "Failed to post comment.";
    return;
  }
  dom.commentInput.value = "";
  await loadComments(state.selectedId);
}

function openDetail(id) {
  const p = state.posts.find((x) => x.id === id);
  if (!p) return;
  state.selectedId = id;
  dom.detailImg.src = imageSrc(p); dom.detailImg.alt = p.title;
  dom.detailTitleText.textContent = p.title;
  dom.detailSubText.textContent = `${p.room} · ${p.style}`;
  dom.detailDesc.textContent = p.description || "";
  dom.detailFooter.textContent = `Saved ${fmtDate(p.createdAt)} · ${p.w || "?"}×${p.h || "?"}`;
  dom.detailLikeBtn.textContent = p.liked ? `Liked · ${p.likes}` : `Like · ${p.likes}`;
  dom.detailLikeBtn.classList.toggle("btnGhost", true);
  dom.detailChips.innerHTML = "";
  for (const t of p.tags || []) {
    const c = document.createElement("span"); c.className = "chipSmall"; c.textContent = `#${t}`;
    c.addEventListener("click", () => { state.activeChip = t.toLowerCase(); closeDetail(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    dom.detailChips.appendChild(c);
  }
  dom.commentStatus.textContent = "";
  dom.commentInput.value = "";
  const auth = readAuth();
  dom.commentInput.placeholder = auth ? "Add a comment…" : "Sign in to comment…";
  loadComments(id);
  openModal(dom.detailBackdrop);
}

function closeDetail() { state.selectedId = null; closeModal(dom.detailBackdrop); }

async function toggleLike(id) {
  const p = state.posts.find((x) => x.id === id);
  if (!p) return;
  const nextLiked = !p.liked;
  const delta = nextLiked ? 1 : -1;
  if (!nextLiked && (p.likes || 0) <= 0) return;
  const res = await fetch(apiUrl(`/api/posts/${id}/like`), {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta }),
  });
  if (!res.ok) return;
  const map = readLikedMap();
  if (nextLiked) map[id] = true; else delete map[id];
  writeLikedMap(map);
  await refresh();
  if (state.selectedId === id) openDetail(id);
}

async function deleteSelected() {
  const id = state.selectedId;
  if (!id) return;
  const p = state.posts.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.title}"?`)) return;
  await deletePostRemote(id);
  const map = readLikedMap(); delete map[id]; writeLikedMap(map);
  closeDetail(); await refresh();
}

// ── AI Generate ───────────────────────────────────────────────────────────────

let aiGeneratedPost = null;

function resetAiModal() {
  aiGeneratedPost = null;
  dom.aiPrompt.value = "";
  dom.aiTitle.value = "";
  dom.aiError.textContent = "";
  dom.aiStatus.textContent = "";
  dom.aiPreviewWrap.hidden = true;
  dom.aiLoading.hidden = true;
  dom.aiSaveBtn.hidden = true;
  dom.aiRegenerateBtn.hidden = true;
  dom.aiGenerateBtn.hidden = false;
  dom.aiGenerateBtn.disabled = false;
}

function openAiModal() {
  const a = readAuth();
  if (!a) { openAuth(); return; }
  resetAiModal();
  openModal(dom.aiBackdrop);
}

async function runGenerate() {
  const prompt = dom.aiPrompt.value.trim();
  if (!prompt) { dom.aiError.textContent = "Please enter a prompt."; return; }

  dom.aiError.textContent = "";
  dom.aiPreviewWrap.hidden = true;
  dom.aiLoading.hidden = false;
  dom.aiGenerateBtn.disabled = true;
  dom.aiGenerateBtn.hidden = true;
  dom.aiSaveBtn.hidden = true;
  dom.aiRegenerateBtn.hidden = true;
  dom.aiLoadingText.textContent = "Generating your interior…";

  try {
    const res = await fetch(apiUrl("/api/ai/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        prompt,
        room: dom.aiRoom.value,
        style: dom.aiStyle.value,
        title: dom.aiTitle.value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      dom.aiError.textContent = data.error || "Generation failed. Try again.";
      dom.aiGenerateBtn.hidden = false;
      dom.aiGenerateBtn.disabled = false;
      return;
    }
    aiGeneratedPost = data.post;
    dom.aiPreviewImg.src = data.post.imageUrl;
    dom.aiPreviewWrap.hidden = false;
    dom.aiSaveBtn.hidden = false;
    dom.aiRegenerateBtn.hidden = false;
    dom.aiStatus.textContent = "Looking good? Save it as a pin or regenerate.";
  } catch (e) {
    dom.aiError.textContent = "Network error. Is the server running?";
    dom.aiGenerateBtn.hidden = false;
    dom.aiGenerateBtn.disabled = false;
  } finally {
    dom.aiLoading.hidden = true;
  }
}

async function saveAiPin() {
  if (!aiGeneratedPost) return;
  dom.aiSaveBtn.disabled = true;
  dom.aiStatus.textContent = "Saved!";
  await refresh();
  setTimeout(() => closeModal(dom.aiBackdrop), 600);
}

// ── Export / Import ───────────────────────────────────────────────────────────

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function exportData() {
  const res = await fetch(apiUrl("/api/export"));
  if (!res.ok) { alert("Export failed. Is the server running?"); return; }
  downloadJson(`roomscore-export-${new Date().toISOString().slice(0, 10)}.json`, await res.json());
}

async function importData(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { alert("Invalid JSON file."); return; }
  const posts = Array.isArray(data?.posts) ? data.posts : null;
  if (!posts) { alert("That file doesn't look like a RoomScore export."); return; }
  if (!confirm(`Import ${posts.length} designs onto the server? This replaces all current designs.`)) return;
  const res = await fetch(apiUrl("/api/posts/import"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posts, replace: true }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); alert(err.error || "Import failed."); return; }
  writeLikedMap({}); await refresh();
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireEvents() {
  dom.themeToggle.addEventListener("click", toggleTheme);

  dom.aiBtn.addEventListener("click", openAiModal);
  dom.closeAiBtn.addEventListener("click", () => closeModal(dom.aiBackdrop));
  dom.cancelAiBtn.addEventListener("click", () => closeModal(dom.aiBackdrop));
  dom.aiBackdrop.addEventListener("click", (e) => { if (e.target === dom.aiBackdrop) closeModal(dom.aiBackdrop); });
  dom.aiForm.addEventListener("submit", (e) => { e.preventDefault(); runGenerate(); });
  dom.aiRegenerateBtn.addEventListener("click", () => runGenerate());
  dom.aiSaveBtn.addEventListener("click", saveAiPin);

  dom.newPinBtn.addEventListener("click", openUpload);
  dom.emptyUploadBtn.addEventListener("click", openUpload);
  dom.closeUploadBtn.addEventListener("click", () => closeModal(dom.uploadBackdrop));
  dom.cancelUploadBtn.addEventListener("click", () => closeModal(dom.uploadBackdrop));
  dom.uploadBackdrop.addEventListener("click", (e) => { if (e.target === dom.uploadBackdrop) closeModal(dom.uploadBackdrop); });

  dom.closeDetailBtn.addEventListener("click", closeDetail);
  dom.detailBackdrop.addEventListener("click", (e) => { if (e.target === dom.detailBackdrop) closeDetail(); });
  dom.detailLikeBtn.addEventListener("click", async () => { if (state.selectedId) await toggleLike(state.selectedId); });
  dom.detailDeleteBtn.addEventListener("click", deleteSelected);
  dom.commentForm.addEventListener("submit", submitComment);

  dom.authBtn.addEventListener("click", openAuth);
  dom.closeAuthBtn.addEventListener("click", () => closeModal(dom.authBackdrop));
  dom.authBackdrop.addEventListener("click", (e) => { if (e.target === dom.authBackdrop) closeModal(dom.authBackdrop); });
  dom.authForm.addEventListener("submit", submitAuth);
  dom.tabLogin.addEventListener("click", () => setAuthMode("login"));
  dom.tabRegister.addEventListener("click", () => setAuthMode("register"));

  dom.searchInput.addEventListener("input", (e) => { state.query = e.target.value || ""; render(); });
  dom.sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  dom.roomFilter.addEventListener("change", (e) => { state.room = e.target.value || ""; render(); });
  dom.styleFilter.addEventListener("change", (e) => { state.style = e.target.value || ""; render(); });

  dom.exportBtn.addEventListener("click", exportData);
  dom.importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (file) await importData(file);
  });

  dom.browseBtn.addEventListener("click", () => dom.imageInput.click());
  dom.imageInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    try { await setSelectedFile(file); } catch { dom.uploadStatus.textContent = "Couldn't read that image."; }
  });

  dom.dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dom.dropZone.dataset.over = "true"; });
  dom.dropZone.addEventListener("dragleave", () => { dom.dropZone.dataset.over = "false"; });
  dom.dropZone.addEventListener("drop", async (e) => {
    e.preventDefault(); dom.dropZone.dataset.over = "false";
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try { await setSelectedFile(file); } catch { dom.uploadStatus.textContent = "Couldn't read that image."; }
  });

  dom.uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await saveNewPin(); } catch (err) {
      dom.uploadStatus.textContent = "Save failed. Check the server console or try a smaller image.";
      console.error(err);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!dom.detailBackdrop.hidden) closeDetail();
    else if (!dom.uploadBackdrop.hidden) closeModal(dom.uploadBackdrop);
    else if (!dom.authBackdrop.hidden) closeModal(dom.authBackdrop);
    else if (!dom.aiBackdrop.hidden) closeModal(dom.aiBackdrop);
  });

  const brandLogo = document.getElementById("brandLogo");
  if (brandLogo) {
    const playLogoSpin = () => { brandLogo.classList.remove("logo--spin"); void brandLogo.offsetWidth; brandLogo.classList.add("logo--spin"); };
    brandLogo.addEventListener("click", playLogoSpin);
    brandLogo.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; e.preventDefault(); playLogoSpin(); });
    brandLogo.addEventListener("animationend", (e) => {
      if (e.target !== brandLogo) return;
      if (e.animationName && !e.animationName.includes("logoSpinSmooth")) return;
      brandLogo.classList.remove("logo--spin");
    });
    brandLogo.addEventListener("animationcancel", () => brandLogo.classList.remove("logo--spin"));
  }
}

async function main() {
  initTheme();
  updateAuthBtn();
  wireEvents();
  await refresh();
}

main().catch((err) => {
  console.error(err);
  alert("RoomScore failed to start. Check the console for details.");
});
