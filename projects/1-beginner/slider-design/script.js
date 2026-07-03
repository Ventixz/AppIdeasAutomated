const stage = document.getElementById("stage");
const dotsBox = document.getElementById("dots");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const playBtn = document.getElementById("playpause");

const INTERVAL_MS = 4000; // "every x seconds" — the auto-rotate cadence.

// Self-contained "images": rich CSS gradients so the carousel works offline,
// with a caption overlaid on each. Swap `background` for real photo URLs to
// use Unsplash imagery as the spec suggests.
const SLIDES = [
  {
    title: "Coastal Dawn",
    text: "First light spilling over a quiet shoreline.",
    background: "linear-gradient(135deg, #ff9a9e 0%, #fad0c4 45%, #fbc2eb 100%)",
  },
  {
    title: "Deep Forest",
    text: "Layers of green fading into morning mist.",
    background: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
  },
  {
    title: "Desert Dusk",
    text: "Warm sand meeting a burning horizon.",
    background: "linear-gradient(135deg, #f77062 0%, #fe5196 100%)",
  },
  {
    title: "Aurora Night",
    text: "Ribbons of color drifting across the dark.",
    background: "linear-gradient(135deg, #4776e6 0%, #8e54e9 100%)",
  },
  {
    title: "Golden Fields",
    text: "Endless grain swaying under a soft sun.",
    background: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  },
];

let current = 0;
let timer = null;
let playing = true;

// Build slides + dots from the data above.
const slideEls = SLIDES.map((slide, i) => {
  const el = document.createElement("div");
  el.className = "slide";
  el.style.background = slide.background;
  el.setAttribute("role", "group");
  el.setAttribute("aria-roledescription", "slide");
  el.setAttribute("aria-label", `${i + 1} of ${SLIDES.length}: ${slide.title}`);
  el.innerHTML = `
    <div class="slide-caption">
      <h2>${slide.title}</h2>
      <p>${slide.text}</p>
    </div>`;
  stage.appendChild(el);

  const dot = document.createElement("button");
  dot.className = "dot";
  dot.type = "button";
  dot.setAttribute("role", "tab");
  dot.setAttribute("aria-label", `Go to slide ${i + 1}`);
  dot.addEventListener("click", () => userGoTo(i));
  dotsBox.appendChild(dot);

  return el;
});
const dotEls = [...dotsBox.children];

function show(next) {
  const total = SLIDES.length;
  next = (next + total) % total; // wrap both directions
  if (next === current) {
    // Still ensure the first render marks the active slide.
    slideEls[current].classList.add("active");
    dotEls[current].classList.add("active");
    dotEls[current].setAttribute("aria-selected", "true");
    return;
  }

  const leaving = slideEls[current];
  leaving.classList.remove("active");
  leaving.classList.add("leaving");
  // Clear the leaving flag after the transition so it can reappear cleanly.
  setTimeout(() => leaving.classList.remove("leaving"), 700);

  current = next;
  slideEls.forEach((el, i) => {
    const on = i === current;
    el.classList.toggle("active", on);
    dotEls[i].classList.toggle("active", on);
    dotEls[i].setAttribute("aria-selected", on ? "true" : "false");
  });
}

function nextSlide() { show(current + 1); }
function prevSlide() { show(current - 1); }

function startTimer() {
  stopTimer();
  if (playing) timer = setInterval(nextSlide, INTERVAL_MS);
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

// Manual controls restart the timer so the user gets a full interval after acting.
function userGoTo(i) { show(i); startTimer(); }
prevBtn.addEventListener("click", () => { prevSlide(); startTimer(); });
nextBtn.addEventListener("click", () => { nextSlide(); startTimer(); });

playBtn.addEventListener("click", () => {
  playing = !playing;
  playBtn.textContent = playing ? "⏸" : "▶";
  playBtn.setAttribute(
    "aria-label",
    playing ? "Pause automatic rotation" : "Resume automatic rotation"
  );
  if (playing) startTimer();
  else stopTimer();
});

// Pause on hover so a slide can be read; resume on leave (if still playing).
stage.addEventListener("mouseenter", stopTimer);
stage.addEventListener("mouseleave", () => { if (playing) startTimer(); });

// Keyboard: arrow keys steer the carousel.
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { prevSlide(); startTimer(); }
  else if (e.key === "ArrowRight") { nextSlide(); startTimer(); }
});

show(0);
startTimer();
