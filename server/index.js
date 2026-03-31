console.log("Starting server...");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs2 = require("fs/promises");
const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nanoid = () => randomUUID().replace(/-/g, "").slice(0, 21);
const cors = require("cors");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const UPLOADS = path.join(ROOT, "uploads");
const JWT_SECRET = process.env.JWT_SECRET || "roomscore-dev-secret-change-in-prod";

async function ensureDirs() {
  await fs2.mkdir(DATA_DIR, { recursive: true });
  await fs2.mkdir(UPLOADS, { recursive: true });
}
async function readDb() {
  try { const raw = await fs2.readFile(DATA_FILE, "utf8"); const j = JSON.parse(raw); return Array.isArray(j.posts) ? j : { posts: [] }; }
  catch { return { posts: [] }; }
}
async function writeDb(db) { await fs2.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8"); }
async function readUsers() {
  try { const raw = await fs2.readFile(USERS_FILE, "utf8"); const j = JSON.parse(raw); return Array.isArray(j.users) ? j : { users: [] }; }
  catch { return { users: [] }; }
}
async function writeUsers(db) { await fs2.writeFile(USERS_FILE, JSON.stringify(db, null, 2), "utf8"); }

function buildSearchBlob(p) {
  return [p.title, p.room, p.style, (p.tags || []).join(" "), p.description].filter(Boolean).join(" . ").toLowerCase();
}
function withImageUrl(p) {
  if (!p) return p;
  return { ...p, imageUrl: p.imageFile ? "/uploads/" + p.imageFile : p.imageUrl || null };
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid or expired token." }); }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => { const ext = path.extname(file.originalname || "") || ".jpg"; cb(null, nanoid() + ext); },
});
const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image uploads are allowed.")); cb(null, true); } });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!username || username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
    if (!/^[a-z0-9_]+$/.test(username)) return res.status(400).json({ error: "Username can only contain letters, numbers, and underscores." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    const db = await readUsers();
    if (db.users.find((u) => u.username === username)) return res.status(409).json({ error: "Username already taken." });
    const hash = await bcrypt.hash(password, 10);
    const user = { id: nanoid(), username, passwordHash: hash, createdAt: Date.now() };
    db.users.push(user); await writeUsers(db);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, username: user.username });
  } catch (e) { console.error(e); res.status(500).json({ error: "Registration failed." }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const db = await readUsers();
    const user = db.users.find((u) => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Invalid username or password." });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, username: user.username });
  } catch (e) { console.error(e); res.status(500).json({ error: "Login failed." }); }
});

app.get("/api/posts", async (_req, res) => {
  try { const db = await readDb(); res.json({ posts: db.posts.map(withImageUrl) }); }
  catch (e) { console.error(e); res.status(500).json({ error: "Could not load posts." }); }
});

app.get("/api/export", async (_req, res) => {
  try {
    const db = await readDb(); const posts = [];
    for (const p of db.posts) {
      const { imageFile, ...rest } = p; const copy = { ...rest };
      if (imageFile) { const buf = await fs2.readFile(path.join(UPLOADS, imageFile)); const ext = path.extname(imageFile).replace(".", "") || "jpeg"; const mime = ext === "jpg" ? "jpeg" : ext; copy.imageDataUrl = "data:image/" + mime + ";base64," + buf.toString("base64"); }
      posts.push(copy);
    }
    res.json({ version: 1, exportedAt: Date.now(), posts });
  } catch (e) { console.error(e); res.status(500).json({ error: "Export failed." }); }
});

app.post("/api/posts", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image file is required." });
    let tags = []; try { tags = JSON.parse(req.body.tags || "[]"); } catch { tags = []; }
    if (!Array.isArray(tags)) tags = [];
    const post = { id: nanoid(), title: String(req.body.title || "Untitled").slice(0, 60), room: String(req.body.room || "Other"), style: String(req.body.style || "Other"), description: String(req.body.description || "").slice(0, 400), tags, imageFile: req.file.filename, w: Number(req.body.w) || 0, h: Number(req.body.h) || 0, createdAt: Date.now(), likes: 0, author: req.user.username, comments: [] };
    post.searchBlob = buildSearchBlob(post);
    const db = await readDb(); db.posts.push(post); await writeDb(db);
    res.status(201).json({ post: withImageUrl(post) });
  } catch (e) { console.error(e); if (req.file) { try { await fs2.unlink(path.join(UPLOADS, req.file.filename)); } catch {} } res.status(500).json({ error: e.message || "Save failed." }); }
});

app.patch("/api/posts/:id/like", async (req, res) => {
  try {
    const d = Number(req.body.delta) === -1 ? -1 : 1;
    const db = await readDb(); const p = db.posts.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Not found." });
    p.likes = Math.max(0, (p.likes || 0) + d); await writeDb(db);
    res.json({ id: p.id, likes: p.likes });
  } catch (e) { console.error(e); res.status(500).json({ error: "Update failed." }); }
});

app.delete("/api/posts/:id", authMiddleware, async (req, res) => {
  try {
    const db = await readDb(); const i = db.posts.findIndex((x) => x.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: "Not found." });
    const [removed] = db.posts.splice(i, 1); await writeDb(db);
    if (removed.imageFile) { try { await fs2.unlink(path.join(UPLOADS, removed.imageFile)); } catch {} }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Delete failed." }); }
});

app.get("/api/posts/:id/comments", async (req, res) => {
  try { const db = await readDb(); const p = db.posts.find((x) => x.id === req.params.id); if (!p) return res.status(404).json({ error: "Not found." }); res.json({ comments: p.comments || [] }); }
  catch (e) { console.error(e); res.status(500).json({ error: "Could not load comments." }); }
});

app.post("/api/posts/:id/comments", authMiddleware, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Comment cannot be empty." });
    const db = await readDb(); const p = db.posts.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Not found." });
    if (!Array.isArray(p.comments)) p.comments = [];
    const comment = { id: nanoid(), author: req.user.username, text, createdAt: Date.now() };
    p.comments.push(comment); await writeDb(db);
    res.status(201).json({ comment });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not save comment." }); }
});

app.delete("/api/posts/:id/comments/:cid", authMiddleware, async (req, res) => {
  try {
    const db = await readDb(); const p = db.posts.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Not found." });
    const ci = (p.comments || []).findIndex((c) => c.id === req.params.cid);
    if (ci === -1) return res.status(404).json({ error: "Comment not found." });
    if (p.comments[ci].author !== req.user.username) return res.status(403).json({ error: "Not your comment." });
    p.comments.splice(ci, 1); await writeDb(db);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Delete failed." }); }
});

app.post("/api/posts/import", express.json({ limit: "80mb" }), async (req, res) => {
  try {
    const { posts, replace } = req.body;
    if (!Array.isArray(posts)) return res.status(400).json({ error: "Expected { posts: [...] }." });
    const db = await readDb();
    if (replace) { for (const p of db.posts) { if (p.imageFile) { try { await fs2.unlink(path.join(UPLOADS, p.imageFile)); } catch {} } } db.posts = []; }
    const idSeen = new Set(db.posts.map((p) => p.id));
    for (const raw of posts) {
      let imageFile = null; const dataUrl = raw.imageDataUrl;
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) {
        const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/s);
        if (m) { const ext = m[1] === "jpeg" ? "jpg" : m[1]; imageFile = nanoid() + "." + ext; await fs2.writeFile(path.join(UPLOADS, imageFile), Buffer.from(m[2], "base64")); }
      }
      if (!imageFile) continue;
      const tags = Array.isArray(raw.tags) ? raw.tags : [];
      let id = typeof raw.id === "string" && raw.id ? raw.id : nanoid();
      if (idSeen.has(id)) id = nanoid(); idSeen.add(id);
      const post = { id, title: String(raw.title || "Untitled").slice(0, 60), room: String(raw.room || "Other"), style: String(raw.style || "Other"), description: String(raw.description || "").slice(0, 400), tags, imageFile, w: Number(raw.w) || 0, h: Number(raw.h) || 0, createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(), likes: Math.max(0, Number(raw.likes) || 0), author: raw.author || "unknown", comments: Array.isArray(raw.comments) ? raw.comments : [] };
      post.searchBlob = buildSearchBlob(post); db.posts.push(post);
    }
    await writeDb(db); res.json({ ok: true, count: db.posts.length });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message || "Import failed." }); }
});

app.post("/api/ai/generate", authMiddleware, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim().slice(0, 400);
    const room  = String(req.body.room  || "Living Room");
    const style = String(req.body.style || "Modern");
    const title = (String(req.body.title || "").trim().slice(0, 60)) || (style + " " + room);
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const fullPrompt = "interior design, " + style + " style " + room + ", " + prompt + ", architectural digest, professional photography, 4k, highly detailed";
    const encoded = encodeURIComponent(fullPrompt);
    const seed = Math.floor(Math.random() * 999999);
    const url = "https://image.pollinations.ai/prompt/" + encoded + "?width=768&height=768&seed=" + seed + "&nologo=true&enhance=true&model=flux";

    console.log("Calling Pollinations AI...");
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!imgRes.ok) {
      console.error("Pollinations error:", imgRes.status);
      return res.status(502).json({ error: "AI service error. Try again shortly." });
    }

    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    if (imgBuffer.length < 1000) {
      return res.status(502).json({ error: "AI returned an invalid image. Try a different prompt." });
    }
    const imageFile = nanoid() + ".jpg";
    await fs2.writeFile(path.join(UPLOADS, imageFile), imgBuffer);

    const tags = [style.toLowerCase(), room.toLowerCase().replace(/ /g, "-"), "ai-generated"];
    const post = { id: nanoid(), title, room, style, description: prompt, tags, imageFile, w: 768, h: 768, createdAt: Date.now(), likes: 0, author: req.user.username, comments: [], aiGenerated: true };
    post.searchBlob = buildSearchBlob(post);
    const db = await readDb(); db.posts.push(post); await writeDb(db);
    res.status(201).json({ post: withImageUrl(post) });
  } catch (e) {
    console.error("AI generate error:", e);
    if (e.name === "TimeoutError") return res.status(504).json({ error: "Generation timed out. Try again." });
    res.status(500).json({ error: e.message || "Generation failed." });
  }
});

app.use("/uploads", express.static(UPLOADS));
app.use(express.static(ROOT));

app.use((err, _req, res, _next) => { console.error(err); res.status(400).json({ error: err.message || "Bad request." }); });

const PORT = Number(process.env.PORT) || 3000;
ensureDirs().then(() => { console.log("Directories ready"); app.listen(PORT, () => console.log("RoomScore serving at http://localhost:" + PORT)); }).catch((err) => console.error("Startup error:", err));
