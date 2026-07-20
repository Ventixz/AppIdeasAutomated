'use strict';

// ---- State -----------------------------------------------------------------
// `slots` is the ordered list of frames. Each entry is either null (empty slot)
// or a data-URL string for an image.
const MIN_SLOTS = 8;
let slots = new Array(MIN_SLOTS).fill(null);

let playing = false;
let timer = null;
let playIndex = 0;
let fillTarget = -1; // which slot the file dialog is currently filling

// ---- Elements --------------------------------------------------------------
const thumbsEl = document.getElementById('thumbs');
const fileInput = document.getElementById('file-input');
const speedEl = document.getElementById('speed');
const speedValueEl = document.getElementById('speed-value');
const transitionEl = document.getElementById('transition');
const playBtn = document.getElementById('play');
const clearBtn = document.getElementById('clear');
const sampleBtn = document.getElementById('sample');
const addSlotBtn = document.getElementById('add-slot');
const stageImg = document.getElementById('stage-img');
const stageEmpty = document.getElementById('stage-empty');
const frameCounter = document.getElementById('frame-counter');

// ---- Rendering -------------------------------------------------------------
function render() {
  thumbsEl.innerHTML = '';
  slots.forEach((src, i) => {
    const cell = document.createElement('div');
    cell.className = 'thumb';
    cell.setAttribute('role', 'listitem');
    cell.dataset.index = String(i);
    cell.draggable = Boolean(src);

    const frame = document.createElement('div');
    frame.className = 'thumb__frame';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = `Frame ${i + 1}`;
      frame.appendChild(img);
    } else {
      const num = document.createElement('span');
      num.className = 'thumb__num';
      num.textContent = i + 1;
      frame.appendChild(num);
    }
    cell.appendChild(frame);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = src ? 'thumb__btn thumb__btn--remove' : 'thumb__btn thumb__btn--add';
    btn.textContent = src ? '−' : '+'; // minus / plus
    btn.title = src ? 'Remove or replace this frame' : 'Add an image to this frame';
    btn.addEventListener('click', () => onSlotButton(i));
    cell.appendChild(btn);

    // Drag-and-drop reordering (bonus).
    cell.addEventListener('dragstart', (e) => onDragStart(e, i));
    cell.addEventListener('dragover', onDragOver);
    cell.addEventListener('drop', (e) => onDrop(e, i));
    cell.addEventListener('dragend', onDragEnd);

    thumbsEl.appendChild(cell);
  });
  updateControls();
}

function filledCount() {
  return slots.filter(Boolean).length;
}

function updateControls() {
  const hasFrames = filledCount() > 0;
  // Disabled until at least one image is added; stays enabled while playing so
  // it can act as the Stop button.
  playBtn.disabled = !hasFrames;
  if (!hasFrames && playing) stopAnimation();
  if (!hasFrames) {
    stageEmpty.hidden = false;
    stageImg.style.display = 'none';
  }
}

// ---- Slot add / remove -----------------------------------------------------
function onSlotButton(i) {
  if (slots[i]) {
    slots[i] = null; // '-' removes
    render();
  } else {
    fillTarget = i; // '+' opens the file dialog for this slot
    fileInput.value = '';
    fileInput.click();
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file || fillTarget < 0) return;
  const reader = new FileReader();
  reader.onload = () => {
    slots[fillTarget] = reader.result;
    fillTarget = -1;
    render();
  };
  reader.readAsDataURL(file);
});

// ---- Drag-and-drop reordering ---------------------------------------------
let dragFrom = -1;
function onDragStart(e, i) {
  if (!slots[i]) { e.preventDefault(); return; }
  dragFrom = i;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('thumb--dragging');
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onDrop(e, i) {
  e.preventDefault();
  if (dragFrom < 0 || dragFrom === i) return;
  const moved = slots.splice(dragFrom, 1)[0];
  slots.splice(i, 0, moved);
  dragFrom = -1;
  render();
}
function onDragEnd(e) {
  e.currentTarget.classList.remove('thumb--dragging');
  dragFrom = -1;
}

// ---- Animation -------------------------------------------------------------
function frameList() {
  return slots.filter(Boolean);
}

function highlightPlaying(currentSrc) {
  // Bonus: highlight the config thumbnail currently on the stage.
  [...thumbsEl.children].forEach((cell) => {
    const img = cell.querySelector('img');
    cell.classList.toggle('thumb--active', Boolean(img && img.src === currentSrc));
  });
}

function showFrame(list) {
  const src = list[playIndex % list.length];
  const ease = transitionEl.value;
  if (ease === 'none') {
    stageImg.style.transition = 'none';
    stageImg.style.opacity = '1';
    stageImg.src = src;
  } else {
    stageImg.style.transition = `opacity 200ms ${ease}`;
    stageImg.style.opacity = '0';
    // Swap the source after the fade-out, then fade back in.
    setTimeout(() => {
      stageImg.src = src;
      stageImg.style.opacity = '1';
    }, 120);
  }
  highlightPlaying(src);
  frameCounter.textContent = `Frame ${(playIndex % list.length) + 1} of ${list.length}`;
  playIndex++;
}

function startAnimation() {
  const list = frameList();
  if (!list.length) return;
  playing = true;
  playIndex = 0;
  playBtn.textContent = 'Stop Animation';
  playBtn.classList.add('btn--stop');
  stageEmpty.hidden = true;
  stageImg.style.display = 'block';

  const tick = () => showFrame(frameList());
  tick(); // show the first frame immediately
  timer = setInterval(tick, Number(speedEl.value));
}

function stopAnimation() {
  playing = false;
  clearInterval(timer);
  timer = null;
  playBtn.textContent = 'Start Animation';
  playBtn.classList.remove('btn--stop');
  highlightPlaying(null);
  frameCounter.textContent = '';
}

function togglePlay() {
  if (playing) stopAnimation();
  else startAnimation();
}

// If the speed changes mid-playback, restart the interval at the new rate.
speedEl.addEventListener('input', () => {
  speedValueEl.textContent = `${speedEl.value} ms/frame`;
  if (playing) {
    clearInterval(timer);
    timer = setInterval(() => showFrame(frameList()), Number(speedEl.value));
  }
});

// ---- Operation buttons -----------------------------------------------------
playBtn.addEventListener('click', togglePlay);

clearBtn.addEventListener('click', () => {
  stopAnimation();
  slots = new Array(Math.max(MIN_SLOTS, slots.length)).fill(null);
  stageImg.removeAttribute('src');
  render();
});

sampleBtn.addEventListener('click', () => {
  stopAnimation();
  slots = SAMPLE_FRAMES.slice();
  render();
});

addSlotBtn.addEventListener('click', () => {
  slots.push(null); // bonus: unlimited thumbnails
  render();
});

// ---- Init ------------------------------------------------------------------
render();
