"use strict";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

// --- State ------------------------------------------------------------------
const state = {
  tool: "pen",
  colour: "#38bdf8",
  size: 6,
  fill: false,
  drawing: false,
  startX: 0,
  startY: 0,
};

// Undo stack: snapshots of the canvas taken before each new stroke/shape.
const history = [];
const MAX_HISTORY = 30;

const PRESETS = [
  "#0f172a", "#ffffff", "#f87171", "#fb923c",
  "#facc15", "#4ade80", "#38bdf8", "#818cf8",
  "#c084fc", "#f472b6", "#94a3b8", "#78350f",
];

// --- Setup ------------------------------------------------------------------
function initCanvas() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function buildSwatches() {
  const wrap = document.getElementById("swatches");
  PRESETS.forEach((hex) => {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = hex;
    b.title = hex;
    b.addEventListener("click", () => {
      state.colour = hex;
      document.getElementById("colour").value = hex;
      markActiveSwatch(hex);
    });
    wrap.appendChild(b);
  });
}

function markActiveSwatch(hex) {
  document.querySelectorAll(".swatch").forEach((s) => {
    s.classList.toggle("is-active", s.title.toLowerCase() === hex.toLowerCase());
  });
}

// --- Coordinate helpers -----------------------------------------------------
// The canvas is displayed at a CSS size that can differ from its intrinsic
// resolution, so map pointer coordinates through the current scale factor.
function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

// --- History ----------------------------------------------------------------
function pushHistory() {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function undo() {
  if (!history.length) return;
  ctx.putImageData(history.pop(), 0, 0);
}

// --- Drawing ----------------------------------------------------------------
function applyStroke() {
  ctx.lineWidth = state.size;
  ctx.strokeStyle = state.tool === "eraser" ? "#ffffff" : state.colour;
  ctx.fillStyle = state.colour;
}

function startDraw(e) {
  const { x, y } = pointerPos(e);
  pushHistory();
  state.drawing = true;
  state.startX = x;
  state.startY = y;
  applyStroke();

  if (state.tool === "pen" || state.tool === "eraser") {
    // Begin a freehand path; a dot is drawn so a single click leaves a mark.
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  } else {
    // Shape tools preview against a saved snapshot each pointer move.
    state.snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
}

function moveDraw(e) {
  if (!state.drawing) return;
  const { x, y } = pointerPos(e);

  if (state.tool === "pen" || state.tool === "eraser") {
    ctx.lineTo(x, y);
    ctx.stroke();
    return;
  }

  // Shape preview: restore the pre-drag snapshot, then redraw the shape.
  ctx.putImageData(state.snapshot, 0, 0);
  drawShape(state.startX, state.startY, x, y);
}

function endDraw(e) {
  if (!state.drawing) return;
  state.drawing = false;
  if (state.tool === "pen" || state.tool === "eraser") ctx.closePath();
  state.snapshot = null;
}

function drawShape(x0, y0, x1, y1) {
  applyStroke();
  ctx.beginPath();

  if (state.tool === "line") {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    return;
  }

  if (state.tool === "rectangle") {
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else if (state.tool === "circle") {
    const r = Math.hypot(x1 - x0, y1 - y0);
    ctx.arc(x0, y0, r, 0, Math.PI * 2);
  } else if (state.tool === "star") {
    starPath(x0, y0, Math.hypot(x1 - x0, y1 - y0));
  }

  if (state.fill) ctx.fill();
  ctx.stroke();
}

// Five-point star centred at (cx, cy) with the given outer radius.
function starPath(cx, cy, outer) {
  const inner = outer / 2.5;
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// --- Toolbar wiring ---------------------------------------------------------
function wireToolbar() {
  document.querySelectorAll(".seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-checked", "true");
      state.tool = btn.dataset.tool;
      updateHint();
    });
  });

  document.getElementById("colour").addEventListener("input", (e) => {
    state.colour = e.target.value;
    markActiveSwatch(e.target.value);
  });

  const sizeInput = document.getElementById("size");
  sizeInput.addEventListener("input", (e) => {
    state.size = Number(e.target.value);
    document.getElementById("size-value").textContent = state.size;
  });

  document.getElementById("fill-toggle").addEventListener("change", (e) => {
    state.fill = e.target.checked;
  });

  document.getElementById("undo").addEventListener("click", undo);
  document.getElementById("clear").addEventListener("click", () => {
    pushHistory();
    initCanvas();
  });
  document.getElementById("save").addEventListener("click", saveImage);
}

function updateHint() {
  const hints = {
    pen: "Click and drag on the canvas to draw.",
    eraser: "Drag to erase back to white.",
    line: "Drag from start to end to draw a straight line.",
    rectangle: "Drag to size the rectangle.",
    circle: "Drag out from the centre to size the circle.",
    star: "Drag out from the centre to size the star.",
  };
  document.getElementById("hint").textContent = hints[state.tool] || "";
}

function saveImage() {
  const link = document.createElement("a");
  link.download = "drawing.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// --- Pointer events (mouse + touch via Pointer Events) ----------------------
canvas.addEventListener("pointerdown", startDraw);
canvas.addEventListener("pointermove", moveDraw);
window.addEventListener("pointerup", endDraw);
canvas.addEventListener("pointerleave", (e) => {
  // Only end freehand strokes on leave; shapes keep their preview.
  if (state.drawing && (state.tool === "pen" || state.tool === "eraser")) endDraw(e);
});

// Keyboard: Ctrl/Cmd+Z to undo.
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  }
});

// --- Boot -------------------------------------------------------------------
initCanvas();
buildSwatches();
markActiveSwatch(state.colour);
wireToolbar();
updateHint();
