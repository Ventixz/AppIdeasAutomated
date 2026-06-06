// Border Radius Previewer — adjust each corner of a box with sliders and
// read off the generated CSS.
//
// Project spec (app-ideas):
//   - Display a box and four sliders, one per corner.
//   - Update the box's border-radius live as the sliders move.
//   - Show the resulting CSS rule, and (bonus) let the user copy it.
//
// The CSS `border-radius` shorthand takes the four corners in clockwise order
// starting from the top-left: top-left, top-right, bottom-right, bottom-left.

// Build the shorthand value string from the four corner sizes (in px).
function borderRadiusValue(topLeft, topRight, bottomRight, bottomLeft) {
  return `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`;
}

function wireUp() {
  const preview = document.getElementById("preview");
  const codeOutput = document.getElementById("code-output");
  const copyButton = document.getElementById("copy-button");

  // Each slider maps to a corner and its live value label.
  const sliders = [
    { input: document.getElementById("tl"), label: document.getElementById("tl-value") },
    { input: document.getElementById("tr"), label: document.getElementById("tr-value") },
    { input: document.getElementById("br"), label: document.getElementById("br-value") },
    { input: document.getElementById("bl"), label: document.getElementById("bl-value") },
  ];

  function render() {
    const [tl, tr, br, bl] = sliders.map((s) => Number(s.input.value));
    const value = borderRadiusValue(tl, tr, br, bl);

    preview.style.borderRadius = value;
    codeOutput.textContent = `border-radius: ${value};`;
    sliders.forEach((s) => {
      s.label.textContent = `${s.input.value}px`;
    });
  }

  sliders.forEach((s) => s.input.addEventListener("input", render));

  copyButton.addEventListener("click", async () => {
    const text = codeOutput.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API may be unavailable (e.g. file:// without permission);
      // fall back to a transient selection-based copy.
      const range = document.createRange();
      range.selectNodeContents(codeOutput);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("copy");
      selection.removeAllRanges();
    }
    copyButton.textContent = "Copied!";
    copyButton.classList.add("copied");
    setTimeout(() => {
      copyButton.textContent = "Copy";
      copyButton.classList.remove("copied");
    }, 1200);
  });

  render();
}

if (typeof document !== "undefined") {
  wireUp();
}

// Expose for testing in non-browser environments (e.g. Node).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { borderRadiusValue };
}
