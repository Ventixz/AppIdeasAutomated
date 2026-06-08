const display = document.getElementById('display');
const toggleBtn = document.getElementById('toggle');

const intervalInput = document.getElementById('interval');
const colorInput = document.getElementById('color');
const intensityInput = document.getElementById('intensity');
const sizeInput = document.getElementById('size');
const rowsInput = document.getElementById('rows');

const intervalValue = document.getElementById('intervalValue');
const intensityValue = document.getElementById('intensityValue');
const sizeValue = document.getElementById('sizeValue');
const rowsValue = document.getElementById('rowsValue');

const BULBS_PER_ROW = 8;
let timer = null;

/** Rebuild the grid of bulbs from the current row/size/color settings. */
function buildLights() {
  display.style.setProperty('--fade', `${intervalInput.value}ms`);
  display.innerHTML = '';

  const rows = Number(rowsInput.value);
  const size = Number(sizeInput.value);

  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    row.className = 'light-row';

    for (let i = 0; i < BULBS_PER_ROW; i++) {
      const bulb = document.createElement('span');
      bulb.className = 'bulb';
      bulb.style.width = `${size}px`;
      bulb.style.height = `${size}px`;
      bulb.style.setProperty('--bulb-size', `${size}px`);
      bulb.style.setProperty('--color', colorInput.value);
      bulb.style.setProperty('--intensity', '1');
      row.appendChild(bulb);
    }
    display.appendChild(row);
  }
}

/** Give every bulb a fresh random opacity between min-intensity and 1. */
function twinkle() {
  const min = Number(intensityInput.value) / 100;
  document.querySelectorAll('.bulb').forEach((bulb) => {
    const intensity = min + Math.random() * (1 - min);
    bulb.style.setProperty('--intensity', intensity.toFixed(2));
  });
}

function start() {
  stop();
  display.style.setProperty('--fade', `${intervalInput.value}ms`);
  timer = setInterval(twinkle, Number(intervalInput.value));
  twinkle();
  toggleBtn.textContent = 'Stop';
  toggleBtn.classList.add('running');
}

function stop() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  toggleBtn.textContent = 'Start';
  toggleBtn.classList.remove('running');
}

const isRunning = () => timer !== null;

toggleBtn.addEventListener('click', () => (isRunning() ? stop() : start()));

// Live-update the label next to each slider.
intervalInput.addEventListener('input', () => {
  intervalValue.textContent = `${intervalInput.value} ms`;
  display.style.setProperty('--fade', `${intervalInput.value}ms`);
  if (isRunning()) start(); // restart so the new interval takes effect
});

intensityInput.addEventListener('input', () => {
  intensityValue.textContent = `${intensityInput.value}%`;
});

sizeInput.addEventListener('input', () => {
  sizeValue.textContent = `${sizeInput.value} px`;
  buildLights();
});

rowsInput.addEventListener('input', () => {
  rowsValue.textContent = rowsInput.value;
  buildLights();
});

colorInput.addEventListener('input', buildLights);

buildLights();
