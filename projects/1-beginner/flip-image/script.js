// Flip Image — a single image repeated in a 2x2 matrix, where each cell can be
// flipped vertically or horizontally independently. Native HTML/CSS/JS only.

// A small, license-free placeholder so the page works offline on first load.
const DEFAULT_IMAGE =
  "https://picsum.photos/seed/flipimage/480/360";

const matrix = document.getElementById("matrix");
const urlInput = document.getElementById("url-input");
const displayBtn = document.getElementById("display-btn");
const resetBtn = document.getElementById("reset-btn");
const status = document.getElementById("status");

// Each cell tracks its own flip state. scaleX === -1 flips horizontally,
// scaleY === -1 flips vertically. Four independent cells in the matrix.
const cells = [];

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = "status" + (kind ? " " + kind : "");
}

// Push the current flip state of a cell onto its <img> via a transform.
function applyTransform(cell) {
  cell.img.style.transform = `scaleX(${cell.scaleX}) scaleY(${cell.scaleY})`;
}

// Build one matrix cell: an image flanked by four directional arrows.
function createCell(src) {
  const el = document.createElement("div");
  el.className = "cell";

  const img = document.createElement("img");
  img.className = "cell-image";
  img.alt = "Image to flip";
  img.src = src;

  const cell = { el, img, scaleX: 1, scaleY: 1 };

  // Up/Down flip vertically (toggle scaleY); Left/Right flip horizontally.
  const arrows = [
    { dir: "up", glyph: "↑", axis: "scaleY", label: "Flip vertically" },
    { dir: "down", glyph: "↓", axis: "scaleY", label: "Flip vertically" },
    { dir: "left", glyph: "←", axis: "scaleX", label: "Flip horizontally" },
    { dir: "right", glyph: "→", axis: "scaleX", label: "Flip horizontally" },
  ];

  for (const { dir, glyph, axis, label } of arrows) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `arrow ${dir}`;
    btn.textContent = glyph;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", () => {
      cell[axis] *= -1;
      applyTransform(cell);
    });
    el.appendChild(btn);
  }

  el.appendChild(img);
  return cell;
}

// (Re)build the 2x2 matrix from a source URL, resetting all flip state.
function buildMatrix(src) {
  matrix.innerHTML = "";
  cells.length = 0;
  for (let i = 0; i < 4; i++) {
    const cell = createCell(src);
    cells.push(cell);
    matrix.appendChild(cell.el);
  }
}

// Load a candidate URL into an off-screen Image first, so we can report a
// clear error if it fails before swapping it into the matrix.
function displayImage(src) {
  setStatus("Loading image…");
  const probe = new Image();
  probe.onload = () => {
    buildMatrix(src);
    setStatus("Image loaded. Use the arrows to flip each cell.", "success");
  };
  probe.onerror = () => {
    setStatus("Could not load that image URL. Check the address and try again.", "error");
  };
  probe.src = src;
}

displayBtn.addEventListener("click", () => {
  const src = urlInput.value.trim();
  if (!src) {
    setStatus("Enter an image URL first.", "error");
    return;
  }
  displayImage(src);
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") displayBtn.click();
});

resetBtn.addEventListener("click", () => {
  for (const cell of cells) {
    cell.scaleX = 1;
    cell.scaleY = 1;
    applyTransform(cell);
  }
  setStatus("All flips reset.");
});

// Initial render with the default image.
buildMatrix(DEFAULT_IMAGE);
setStatus("Showing the default image. Paste a URL above to use your own.");
