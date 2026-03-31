console.log("Starting server...");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs2 = require("fs/promises");
const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const nanoid = () => randomUUID().replace(/-/g, "").slice(0, 21);
const cors = require("cors");

const ROOT = path.join(__dirname, "..");
const UPLOADS = path.join(ROOT, "uploads");
const JWT_SECRET = process.env.JWT_SECRET || "roomscore-dev-secret-change-in-prod";
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Vishal:vishalVK47@cluster0.55wth1q.mongodb.net/roomscore";

// ── Mongoose schemas ──────────────────────────────────────────────────────────

const postSchema = new mongoose.Schema({
  _id: { type: String, default: () => nanoid() },
  title: String, room: String, style: String,
  description: String, tags: [String],
  imageFile: String, imageUrl: String,
  w: Number, h: Number,
  createdAt: { type: Number, default: Date.now },
  likes: { type: Number, default: 0 },
  author: String,
  aiGenerated: { type: Boolean, default: false },
  searchBlob: String,
  comments: [{
    _id: false,
    id: { type: String, default: () => nanoid() },
    author: String, text: String,
    createdAt: { type: Number, default: Date.now },
  }],
}, { _id: false });

const userSchema = new mongoose.Schema({
  _id: { type: String, default: () => nanoid() },
  username: { type: String, unique: true },
  passwordHash: String,
  createdAt: { type: Number, default: Date.now },
}, { _id: false });

const Post = mongoose.model("Post", postSchema);
const User = mongoose.model("User", userSchema);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSearchBlob(p) {
  return [p.title, p.room, p.style, (p.tags || []).join(" "), p.description]
    .filter(Boolean).join(" . ").toLowerCase();
}

function withImageUrl(p) {
  const obj = p.toObject ? p.toObject() : { ...p };
  obj.id = obj._id;
  if (!obj.imageUrl && obj.imageFile) obj.imageUrl = "/uploads/" + obj.imageFile;
  return obj;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid or expired token." }); }
}

async function ensureDirs() {
  await fs2.mkdir(UPLOADS, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".jpg";
    cb(null, nanoid() + ext);
  },
});
const upload = multer({
  storage, limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image uploads are allowed."));
    cb(null, true);
  },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!username || username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
    if (!/^[a-z0-9_]+$/.test(username)) return res.status(400).json({ error: "Username can only contain letters, numbers, and underscores." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    if (await User.findOne({ username })) return res.status(409).json({ error: "Username already taken." });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash });
    const token = jwt.sign({ id: user._id, username }, JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, username });
  } catch (e) { console.error(e); res.status(500).json({ error: "Registration failed." }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: "Invalid username or password." });
    const token = jwt.sign({ id: user._id, username }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, username });
  } catch (e) { console.error(e); res.status(500).json({ error: "Login failed." }); }
});

// ── Posts ─────────────────────────────────────────────────────────────────────

app.get("/api/posts", async (_req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json({ posts: posts.map(withImageUrl) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load posts." }); }
});

app.get("/api/export", async (_req, res) => {
  try {
    const posts = await Post.find();
    const out = [];
    for (const p of posts) {
      const obj = withImageUrl(p);
      if (p.imageFile) {
        try {
          const buf = await fs2.readFile(path.join(UPLOADS, p.imageFile));
          const ext = path.extname(p.imageFile).replace(".", "") || "jpeg";
          const mime = ext === "jpg" ? "jpeg" : ext;
          obj.imageDataUrl = "data:image/" + mime + ";base64," + buf.toString("base64");
        } catch {}
      }
      out.push(obj);
    }
    res.json({ version: 1, exportedAt: Date.now(), posts: out });
  } catch (e) { console.error(e); res.status(500).json({ error: "Export failed." }); }
});

app.post("/api/posts", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image file is required." });
    let tags = []; try { tags = JSON.parse(req.body.tags || "[]"); } catch { tags = []; }
    const id = nanoid();
    const post = await Post.create({
      _id: id,
      title: String(req.body.title || "Untitled").slice(0, 60),
      room: String(req.body.room || "Other"),
      style: String(req.body.style || "Other"),
      description: String(req.body.description || "").slice(0, 400),
      tags, imageFile: req.file.filename,
      imageUrl: "/uploads/" + req.file.filename,
      w: Number(req.body.w) || 0, h: Number(req.body.h) || 0,
      author: req.user.username, comments: [],
      searchBlob: buildSearchBlob({ title: req.body.title, room: req.body.room, style: req.body.style, tags, description: req.body.description }),
    });
    res.status(201).json({ post: withImageUrl(post) });
  } catch (e) {
    console.error(e);
    if (req.file) { try { await fs2.unlink(path.join(UPLOADS, req.file.filename)); } catch {} }
    res.status(500).json({ error: e.message || "Save failed." });
  }
});

app.patch("/api/posts/:id/like", async (req, res) => {
  try {
    const d = Number(req.body.delta) === -1 ? -1 : 1;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found." });
    post.likes = Math.max(0, (post.likes || 0) + d);
    await post.save();
    res.json({ id: post._id, likes: post.likes });
  } catch (e) { console.error(e); res.status(500).json({ error: "Update failed." }); }
});

app.delete("/api/posts/:id", authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found." });
    if (post.imageFile) { try { await fs2.unlink(path.join(UPLOADS, post.imageFile)); } catch {} }
    await post.deleteOne();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Delete failed." }); }
});

// ── Comments ──────────────────────────────────────────────────────────────────

app.get("/api/posts/:id/comments", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found." });
    res.json({ comments: post.comments || [] });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load comments." }); }
});

app.post("/api/posts/:id/comments", authMiddleware, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: "Comment cannot be empty." });
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found." });
    const comment = { id: nanoid(), author: req.user.username, text, createdAt: Date.now() };
    post.comments.push(comment);
    await post.save();
    res.status(201).json({ comment });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not save comment." }); }
});

app.delete("/api/posts/:id/comments/:cid", authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Not found." });
    const ci = post.comments.findIndex((c) => c.id === req.params.cid);
    if (ci === -1) return res.status(404).json({ error: "Comment not found." });
    if (post.comments[ci].author !== req.user.username) return res.status(403).json({ error: "Not your comment." });
    post.comments.splice(ci, 1);
    await post.save();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Delete failed." }); }
});

// ── Profile ───────────────────────────────────────────────────────────────────

app.get("/api/profile/:username", async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "User not found." });
    const posts = await Post.find({ author: username }).sort({ createdAt: -1 });
    const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
    res.json({ username: user.username, joinedAt: user.createdAt, postCount: posts.length, totalLikes, posts: posts.map(withImageUrl) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load profile." }); }
});

// ── AI Generate ───────────────────────────────────────────────────────────────

app.post("/api/ai/generate", authMiddleware, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim().slice(0, 400);
    const room = String(req.body.room || "Living Room");
    const style = String(req.body.style || "Modern");
    const title = (String(req.body.title || "").trim().slice(0, 60)) || (style + " " + room);
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const fullPrompt = "interior design, " + style + " style " + room + ", " + prompt + ", architectural digest, professional photography, 4k, highly detailed";
    const encoded = encodeURIComponent(fullPrompt);
    const seed = Math.floor(Math.random() * 999999);
    const url = "https://image.pollinations.ai/prompt/" + encoded + "?width=768&height=768&seed=" + seed + "&nologo=true&enhance=true&model=flux";

    console.log("Calling Pollinations AI...");
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!imgRes.ok) return res.status(502).json({ error: "AI service error. Try again shortly." });

    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    if (imgBuffer.length < 1000) return res.status(502).json({ error: "AI returned an invalid image. Try a different prompt." });

    const imageFile = nanoid() + ".jpg";
    await fs2.writeFile(path.join(UPLOADS, imageFile), imgBuffer);

    const tags = [style.toLowerCase(), room.toLowerCase().replace(/ /g, "-"), "ai-generated"];
    const id = nanoid();
    const post = await Post.create({
      _id: id, title, room, style, description: prompt, tags,
      imageFile, imageUrl: "/uploads/" + imageFile,
      w: 768, h: 768, author: req.user.username,
      aiGenerated: true, comments: [],
      searchBlob: buildSearchBlob({ title, room, style, tags, description: prompt }),
    });
    res.status(201).json({ post: withImageUrl(post) });
  } catch (e) {
    console.error("AI generate error:", e);
    if (e.name === "TimeoutError") return res.status(504).json({ error: "Generation timed out. Try again." });
    res.status(500).json({ error: e.message || "Generation failed." });
  }
});

// ── Import ────────────────────────────────────────────────────────────────────

app.post("/api/posts/import", express.json({ limit: "80mb" }), async (req, res) => {
  try {
    const { posts, replace } = req.body;
    if (!Array.isArray(posts)) return res.status(400).json({ error: "Expected { posts: [...] }." });
    if (replace) {
      const existing = await Post.find({}, "imageFile");
      for (const p of existing) {
        if (p.imageFile) { try { await fs2.unlink(path.join(UPLOADS, p.imageFile)); } catch {} }
      }
      await Post.deleteMany({});
    }
    for (const raw of posts) {
      let imageFile = null;
      const dataUrl = raw.imageDataUrl;
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) {
        const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/s);
        if (m) {
          const ext = m[1] === "jpeg" ? "jpg" : m[1];
          imageFile = nanoid() + "." + ext;
          await fs2.writeFile(path.join(UPLOADS, imageFile), Buffer.from(m[2], "base64"));
        }
      }
      if (!imageFile) continue;
      const tags = Array.isArray(raw.tags) ? raw.tags : [];
      const id = nanoid();
      await Post.create({
        _id: id,
        title: String(raw.title || "Untitled").slice(0, 60),
        room: String(raw.room || "Other"), style: String(raw.style || "Other"),
        description: String(raw.description || "").slice(0, 400),
        tags, imageFile, imageUrl: "/uploads/" + imageFile,
        w: Number(raw.w) || 0, h: Number(raw.h) || 0,
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
        likes: Math.max(0, Number(raw.likes) || 0),
        author: raw.author || "unknown", comments: [],
        searchBlob: buildSearchBlob({ title: raw.title, room: raw.room, style: raw.style, tags, description: raw.description }),
      });
    }
    const count = await Post.countDocuments();
    res.json({ ok: true, count });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message || "Import failed." }); }
});

app.use("/uploads", express.static(UPLOADS));
app.use(express.static(ROOT));
app.use((err, _req, res, _next) => { console.error(err); res.status(400).json({ error: err.message || "Bad request." }); });

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  await ensureDirs();
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected");
  app.listen(PORT, () => console.log("RoomScore serving at http://localhost:" + PORT));
}

start().catch((err) => { console.error("Startup error:", err); process.exit(1); });
