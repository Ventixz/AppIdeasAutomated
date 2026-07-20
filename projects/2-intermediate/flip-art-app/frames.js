// Built-in sample frames so the app animates without needing image files.
// Each frame is a self-contained SVG data URI: a bouncing ball flip-book.
// The ball drops, squashes at the bottom, and rebounds across 8 frames.

const SAMPLE_FRAMES = (function () {
  // Vertical centre of the ball per frame (parabolic-ish bounce), and how much
  // it squashes when it hits the floor.
  const cy = [30, 60, 100, 150, 172, 150, 100, 60];
  const squash = [0, 0, 0, 0, 0.35, 0, 0, 0];
  const hue = [200, 210, 225, 250, 280, 250, 225, 210];

  return cy.map((y, i) => {
    const rx = 22 * (1 + squash[i]);
    const ry = 22 * (1 - squash[i]);
    const groundY = 190;
    // Shadow shrinks as the ball rises.
    const dist = (groundY - y) / groundY;
    const shadowRx = 26 * (1 - dist * 0.6);
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#11151f"/>
  <line x1="0" y1="${groundY}" x2="200" y2="${groundY}" stroke="#2c3547" stroke-width="2"/>
  <ellipse cx="100" cy="${groundY + 4}" rx="${shadowRx.toFixed(1)}" ry="6"
           fill="#000" opacity="${(0.35 * (1 - dist * 0.5)).toFixed(2)}"/>
  <ellipse cx="100" cy="${y}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"
           fill="hsl(${hue[i]}, 80%, 60%)"/>
  <circle cx="${(100 - rx * 0.35).toFixed(1)}" cy="${(y - ry * 0.35).toFixed(1)}"
          r="${(rx * 0.25).toFixed(1)}" fill="#fff" opacity="0.7"/>
  <text x="100" y="18" text-anchor="middle" font-family="monospace" font-size="12"
        fill="#5b6472">frame ${i + 1}</text>
</svg>`.trim();
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  });
})();
