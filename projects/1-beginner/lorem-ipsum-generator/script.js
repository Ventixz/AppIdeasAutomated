// A small bank of latin-ish words to draw from. The classic opener is kept
// separate so it can be prepended verbatim when requested.
const CLASSIC_OPENER =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit";

const WORDS = (
  "a ac accumsan ante aliquam arcu at auctor augue bibendum blandit commodo " +
  "condimentum congue consequat convallis cras cursus dapibus diam dictum " +
  "dignissim dolor donec dui duis efficitur egestas eget eleifend elit enim " +
  "erat eros est et eu euismod facilisis fames faucibus felis fermentum " +
  "feugiat finibus fringilla fusce gravida habitant hendrerit iaculis id " +
  "imperdiet in integer interdum ipsum justo lacinia lacus laoreet lectus " +
  "leo libero ligula lobortis lorem luctus maecenas magna malesuada massa " +
  "mattis mauris maximus metus mi molestie mollis morbi nam nec neque nibh " +
  "nisi nisl non nulla nunc odio orci ornare pellentesque pharetra phasellus " +
  "placerat porta porttitor posuere praesent pretium proin pulvinar purus " +
  "quam quis quisque rhoncus risus rutrum sagittis sapien scelerisque sed " +
  "sem semper senectus sit sodales sollicitudin suscipit suspendisse tellus " +
  "tempor tempus tincidunt tortor tristique turpis ullamcorper ultrices " +
  "ultricies urna ut varius vehicula vel velit venenatis vestibulum vitae " +
  "vivamus viverra volutpat vulputate"
).split(" ");

const controls = document.getElementById("controls");
const countInput = document.getElementById("count");
const unitSelect = document.getElementById("unit");
const classicToggle = document.getElementById("classic");
const output = document.getElementById("output");
const stats = document.getElementById("stats");
const copyBtn = document.getElementById("copy");

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pickWord = () => WORDS[randInt(0, WORDS.length - 1)];

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Build one sentence of 6–14 words, occasionally dropping in a comma so the
// text reads less robotically. Always capitalized and full-stopped.
function makeSentence() {
  const length = randInt(6, 14);
  const words = Array.from({ length }, pickWord);
  if (length > 8) {
    // splice a comma in somewhere in the middle third
    const commaAt = randInt(2, length - 3);
    words[commaAt] += ",";
  }
  return capitalize(words.join(" ")) + ".";
}

function makeParagraph() {
  const sentences = Array.from({ length: randInt(3, 6) }, makeSentence);
  return sentences.join(" ");
}

function generate(unit, count, useClassic) {
  if (unit === "words") {
    const words = Array.from({ length: count }, pickWord);
    if (useClassic) {
      const opener = CLASSIC_OPENER.toLowerCase().split(" ");
      // Replace the front of the output with the opener, keeping `count` words.
      words.splice(0, opener.length, ...opener);
      words.length = count;
    }
    return [capitalize(words.join(" ")) + "."];
  }

  if (unit === "sentences") {
    const sentences = Array.from({ length: count }, makeSentence);
    if (useClassic) sentences[0] = capitalize(CLASSIC_OPENER) + ".";
    return [sentences.join(" ")];
  }

  // paragraphs
  const paragraphs = Array.from({ length: count }, makeParagraph);
  if (useClassic) {
    paragraphs[0] = capitalize(CLASSIC_OPENER) + ". " + paragraphs[0];
  }
  return paragraphs;
}

function render(paragraphs) {
  output.replaceChildren(
    ...paragraphs.map((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    })
  );

  const plain = paragraphs.join("\n\n");
  const wordCount = plain.split(/\s+/).filter(Boolean).length;
  stats.textContent = `${wordCount} word${wordCount === 1 ? "" : "s"}`;
  copyBtn.disabled = false;
  resetCopyLabel();
}

function resetCopyLabel() {
  copyBtn.textContent = "Copy";
  copyBtn.classList.remove("copied");
}

controls.addEventListener("submit", (event) => {
  event.preventDefault();
  const unit = unitSelect.value;
  const count = Math.min(Math.max(parseInt(countInput.value, 10) || 1, 1), 50);
  countInput.value = count;
  render(generate(unit, count, classicToggle.checked));
});

copyBtn.addEventListener("click", async () => {
  const text = Array.from(output.querySelectorAll("p"))
    .map((p) => p.textContent)
    .join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied!";
    copyBtn.classList.add("copied");
    setTimeout(resetCopyLabel, 1500);
  } catch {
    // Clipboard API needs a secure context; fall back to selecting the text.
    const range = document.createRange();
    range.selectNodeContents(output);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

// Generate a first batch on load so the page isn't empty.
controls.dispatchEvent(new Event("submit"));
