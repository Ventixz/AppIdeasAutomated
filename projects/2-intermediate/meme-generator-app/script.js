// Meme Generator — vanilla JS, single canvas.
// The canvas is redrawn from a small model every frame:
//   image  -> shapes (drawings) -> the two draggable text lines.

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ---- Model ---------------------------------------------------------------
const state = {
  image: null,           // HTMLImageElement once loaded
  top: { text: "", x: 0.5, y: 0.10 },    // positions stored as 0..1 fractions
  bottom: { text: "", x: 0.5, y: 0.90 }, // so they survive image resizes
  color: "#ffffff",
  outline: "#000000",
  size: 48,
  font: "Impact, 'Anton', sans-serif",
  shapes: [],            // committed drawings
  tool: "none",          // none | free | rect | circle
  brushColor: "#e63946",
  brushWidth: 6,
};

// ---- Elements ------------------------------------------------------------
const el = {
  imageInput: document.getElementById("imageInput"),
  sampleBtn: document.getElementById("sampleBtn"),
  topText: document.getElementById("topText"),
  bottomText: document.getElementById("bottomText"),
  textColor: document.getElementById("textColor"),
  outlineColor: document.getElementById("outlineColor"),
  fontSize: document.getElementById("fontSize"),
  sizeOut: document.getElementById("sizeOut"),
  fontFamily: document.getElementById("fontFamily"),
  brushColor: document.getElementById("brushColor"),
  brushWidth: document.getElementById("brushWidth"),
  brushOut: document.getElementById("brushOut"),
  undoBtn: document.getElementById("undoBtn"),
  clearDrawBtn: document.getElementById("clearDrawBtn"),
  saveBtn: document.getElementById("saveBtn"),
  shareTwitter: document.getElementById("shareTwitter"),
  shareReddit: document.getElementById("shareReddit"),
  shareFacebook: document.getElementById("shareFacebook"),
  placeholder: document.getElementById("placeholder"),
  hint: document.getElementById("hint"),
  canvasWrap: document.getElementById("canvasWrap"),
};

// ---- Rendering -----------------------------------------------------------
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.image) {
    ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#141a30";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Drawings sit above the image, below the text.
  for (const s of state.shapes) drawShape(s);
  if (livePreviewShape) drawShape(livePreviewShape);

  drawTextLine(state.top, "top");
  drawTextLine(state.bottom, "bottom");
}

function drawShape(s) {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (s.type === "free") {
    const pts = s.points;
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  } else if (s.type === "rect") {
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  } else if (s.type === "circle") {
    const r = Math.hypot(s.w, s.h);
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Returns the bounding box (in canvas px) so drag hit-testing can reuse it.
function drawTextLine(line, which) {
  if (!line.text) return null;
  const size = state.size;
  ctx.font = `${size}px ${state.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = which === "top" ? "top" : "bottom";
  ctx.lineWidth = Math.max(2, size / 14);
  ctx.strokeStyle = state.outline;
  ctx.fillStyle = state.color;

  const text = line.text.toUpperCase();
  const px = line.x * canvas.width;
  const py = line.y * canvas.height;

  ctx.strokeText(text, px, py);
  ctx.fillText(text, px, py);

  const m = ctx.measureText(text);
  const w = m.width;
  const top = which === "top" ? py : py - size;
  return { x: px - w / 2, y: top, w, h: size };
}

// ---- Text drag -----------------------------------------------------------
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };

function textBox(line, which) {
  if (!line.text) return null;
  ctx.font = `${state.size}px ${state.font}`;
  const w = ctx.measureText(line.text.toUpperCase()).width;
  const px = line.x * canvas.width;
  const py = line.y * canvas.height;
  const top = which === "top" ? py : py - state.size;
  return { x: px - w / 2, y: top, w, h: state.size, line };
}

function hitText(cx, cy) {
  for (const [line, which] of [[state.bottom, "bottom"], [state.top, "top"]]) {
    const b = textBox(line, which);
    if (b && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return b;
  }
  return null;
}

// ---- Pointer / drawing ---------------------------------------------------
let drawing = false;
let livePreviewShape = null;
let startPt = null;

function toCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

canvas.addEventListener("pointerdown", (e) => {
  const p = toCanvasCoords(e);
  canvas.setPointerCapture(e.pointerId);

  if (state.tool === "none") {
    const hit = hitText(p.x, p.y);
    if (hit) {
      dragTarget = hit.line;
      dragOffset.x = p.x - hit.line.x * canvas.width;
      dragOffset.y = p.y - hit.line.y * canvas.height;
    }
    return;
  }

  // A drawing tool is active.
  if (!state.image) return; // nothing to draw on yet
  drawing = true;
  startPt = p;
  if (state.tool === "free") {
    livePreviewShape = { type: "free", color: state.brushColor, width: state.brushWidth, points: [p] };
  } else {
    livePreviewShape = { type: state.tool, color: state.brushColor, width: state.brushWidth, x: p.x, y: p.y, w: 0, h: 0 };
  }
});

canvas.addEventListener("pointermove", (e) => {
  const p = toCanvasCoords(e);

  if (dragTarget) {
    dragTarget.x = clamp((p.x - dragOffset.x) / canvas.width, 0, 1);
    dragTarget.y = clamp((p.y - dragOffset.y) / canvas.height, 0, 1);
    draw();
    return;
  }

  if (!drawing || !livePreviewShape) {
    updateCursor(p);
    return;
  }

  if (state.tool === "free") {
    livePreviewShape.points.push(p);
  } else {
    livePreviewShape.w = p.x - startPt.x;
    livePreviewShape.h = p.y - startPt.y;
  }
  draw();
});

function endStroke(e) {
  if (e) { try { canvas.releasePointerCapture(e.pointerId); } catch {} }
  if (dragTarget) { dragTarget = null; return; }
  if (drawing && livePreviewShape) {
    // Ignore accidental zero-size clicks for shapes.
    const s = livePreviewShape;
    const meaningful = s.type === "free" ? s.points.length > 1 : (Math.abs(s.w) > 2 || Math.abs(s.h) > 2);
    if (meaningful) state.shapes.push(s);
  }
  drawing = false;
  livePreviewShape = null;
  draw();
}

canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

function updateCursor(p) {
  if (state.tool === "none") {
    canvas.style.cursor = hitText(p.x, p.y) ? "grab" : "default";
  } else {
    canvas.style.cursor = "crosshair";
  }
}

// ---- Image loading -------------------------------------------------------
function loadImageFromSrc(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    state.image = img;
    // Fit the canvas to the image's aspect ratio, capped for sanity.
    const maxDim = 900;
    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    el.placeholder.style.display = "none";
    draw();
  };
  img.onerror = () => alert("Could not load that image.");
  img.src = src;
}

el.imageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadImageFromSrc(reader.result);
  reader.readAsDataURL(file);
});

// A tiny self-contained gradient sample so the app is usable with zero files.
el.sampleBtn.addEventListener("click", () => {
  const c = document.createElement("canvas");
  c.width = 600; c.height = 600;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 600, 600);
  grad.addColorStop(0, "#ff9966");
  grad.addColorStop(1, "#ff5e62");
  g.fillStyle = grad;
  g.fillRect(0, 0, 600, 600);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "bold 42px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("SAMPLE", 300, 315);
  loadImageFromSrc(c.toDataURL());
  if (!el.topText.value && !el.bottomText.value) {
    el.topText.value = "When you";
    el.bottomText.value = "ship it on a Friday";
    state.top.text = el.topText.value;
    state.bottom.text = el.bottomText.value;
  }
});

// ---- Control wiring ------------------------------------------------------
el.topText.addEventListener("input", (e) => { state.top.text = e.target.value; draw(); });
el.bottomText.addEventListener("input", (e) => { state.bottom.text = e.target.value; draw(); });
el.textColor.addEventListener("input", (e) => { state.color = e.target.value; draw(); });
el.outlineColor.addEventListener("input", (e) => { state.outline = e.target.value; draw(); });
el.fontSize.addEventListener("input", (e) => { state.size = +e.target.value; el.sizeOut.textContent = e.target.value; draw(); });
el.fontFamily.addEventListener("change", (e) => { state.font = e.target.value; draw(); });
el.brushColor.addEventListener("input", (e) => { state.brushColor = e.target.value; });
el.brushWidth.addEventListener("input", (e) => { state.brushWidth = +e.target.value; el.brushOut.textContent = e.target.value; });

document.querySelectorAll(".tool").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tool = btn.dataset.tool;
    el.hint.textContent = state.tool === "none"
      ? "Tip: drag either text line to reposition it. Switch to a Draw tool to sketch on top."
      : "Draw mode: click-drag on the image. Switch back to Move text to reposition captions.";
  });
});

el.undoBtn.addEventListener("click", () => { state.shapes.pop(); draw(); });
el.clearDrawBtn.addEventListener("click", () => { state.shapes = []; draw(); });

// ---- Save ----------------------------------------------------------------
el.saveBtn.addEventListener("click", () => {
  if (!state.image) { alert("Upload an image first."); return; }
  const link = document.createElement("a");
  link.download = "meme.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

// ---- Share (bonus) -------------------------------------------------------
function shareText() {
  const parts = [state.top.text, state.bottom.text].filter(Boolean);
  return (parts.join(" — ") || "Check out my meme!") + " #meme";
}
el.shareTwitter.addEventListener("click", () => {
  const url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText());
  window.open(url, "_blank", "noopener");
});
el.shareReddit.addEventListener("click", () => {
  const url = "https://www.reddit.com/submit?title=" + encodeURIComponent(shareText());
  window.open(url, "_blank", "noopener");
});
el.shareFacebook.addEventListener("click", () => {
  const url = "https://www.facebook.com/sharer/sharer.php?u=" +
    encodeURIComponent("https://github.com/florinpop17/app-ideas") +
    "&quote=" + encodeURIComponent(shareText());
  window.open(url, "_blank", "noopener");
});

// ---- Utils ---------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

draw();
