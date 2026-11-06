/*
 * thumbnail-node.js — the real-I/O adapter. It reads a batch of image files
 * from disk, generates a thumbnail for each through the DOM-free engine in
 * pool-core.js, writes the thumbnails out, and drives a live progress bar in
 * the terminal. It also measures the thing this whole category is about:
 * throughput as a function of pool size.
 *
 * To stay genuinely dependency-free (the standing rule for this repo — no npm
 * install, ever) it speaks the Netpbm PPM format (P6, binary RGB). PPM is the
 * rare image format you can parse and emit in a few honest lines without a
 * codec, so the resize is real work on real pixels rather than a mock. Point it
 * at a directory of .ppm files, or let --demo synthesise a batch for you.
 *
 * Usage:
 *   node thumbnail-node.js <inDir> <outDir> [--size=160] [--concurrency=4] [--mode=contain]
 *   node thumbnail-node.js --demo [--count=48] [--size=160]   # synthesise, then benchmark pool sizes
 *
 * Tip: ImageMagick / `convert foo.jpg foo.ppm` produces files this reads, and
 * `convert thumb.ppm thumb.png` turns the output back into something viewable.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  makeImage, makeThumbnail, runPool, summarize,
} = require('./pool-core.js');

/* ------------------------------------------------------------------ *
 * Minimal PPM (P6) read / write. Header is ASCII: "P6\n<w> <h>\n<max>\n"
 * followed by w*h*3 raw bytes. We tolerate '#' comments and arbitrary
 * whitespace between the header tokens, as the format allows.
 * ------------------------------------------------------------------ */
function readPPM(buf) {
  let pos = 0;
  function nextToken() {
    // skip whitespace and #-comments
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x23 /* # */) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; }
      else if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) pos++;
      else break;
    }
    const start = pos;
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
      pos++;
    }
    return buf.toString('ascii', start, pos);
  }
  const magic = nextToken();
  if (magic !== 'P6') throw new Error(`not a binary PPM (P6), got "${magic}"`);
  const width = parseInt(nextToken(), 10);
  const height = parseInt(nextToken(), 10);
  const maxval = parseInt(nextToken(), 10);
  if (!(width > 0 && height > 0)) throw new Error('bad PPM dimensions');
  if (maxval !== 255) throw new Error(`only 8-bit PPM supported (maxval=${maxval})`);
  pos++; // single whitespace byte after maxval, per spec
  const need = width * height * 3;
  if (buf.length - pos < need) throw new Error('PPM pixel data truncated');
  const img = makeImage(width, height, 3);
  buf.copy(img.data, 0, pos, pos + need);
  return img;
}

function writePPM(img) {
  if (img.channels !== 3) throw new Error('writePPM expects 3-channel RGB');
  const header = Buffer.from(`P6\n${img.width} ${img.height}\n255\n`, 'ascii');
  return Buffer.concat([header, Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)]);
}

/* ------------------------------------------------------------------ *
 * A synthetic image generator for --demo: colourful gradient tiles with a
 * couple of shapes so the downscale has real high-frequency detail to average.
 * ------------------------------------------------------------------ */
function syntheticImage(width, height, seed) {
  const img = makeImage(width, height, 3);
  const D = img.data;
  const cx = width * (0.3 + 0.4 * ((seed * 97) % 100) / 100);
  const cy = height * (0.3 + 0.4 * ((seed * 57) % 100) / 100);
  const r = Math.min(width, height) * 0.22;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      // base diagonal gradient, hue shifted per seed
      let rr = ((x * 255 / width) + seed * 23) % 256;
      let gg = ((y * 255 / height) + seed * 51) % 256;
      let bb = (((x + y) * 255 / (width + height)) + seed * 13) % 256;
      // a checker of fine detail to stress the resampler
      if (((x >> 3) + (y >> 3)) & 1) { rr = 255 - rr; }
      // a filled circle
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) { rr = 250; gg = 250; bb = 250; }
      D[p] = rr; D[p + 1] = gg; D[p + 2] = bb;
    }
  }
  return img;
}

/* ------------------------------------------------------------------ *
 * Terminal progress bar (self-contained; the engine stays DOM/TTY-free).
 * ------------------------------------------------------------------ */
function drawBar(done, total, extra = '') {
  const frac = total ? done / total : 0;
  const width = 32;
  const filled = Math.round(frac * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pct = String(Math.round(frac * 100)).padStart(3);
  if (process.stdout.isTTY) {
    process.stdout.write(`\r[${bar}] ${pct}%  ${done}/${total}  ${extra}   `);
    if (done === total) process.stdout.write('\n');
  } else if (done === total) {
    process.stdout.write(`[${bar}] ${pct}%  ${done}/${total}  ${extra}\n`);
  }
}

/* ------------------------------------------------------------------ *
 * The job: read a file, decode, thumbnail, write. Returned value is a small
 * record. A throw here (bad file, decode error) is caught by the pool and
 * recorded as a failure without stopping the batch.
 * ------------------------------------------------------------------ */
function makeJob(inDir, outDir, size, mode) {
  return async function thumbnailJob(name) {
    const src = readPPM(await fs.promises.readFile(path.join(inDir, name)));
    const thumb = makeThumbnail(src, size, size, mode);
    const outName = name.replace(/\.ppm$/i, '') + `.thumb.ppm`;
    await fs.promises.writeFile(path.join(outDir, outName), writePPM(thumb));
    return { name, from: `${src.width}x${src.height}`, to: `${thumb.width}x${thumb.height}`, out: outName };
  };
}

async function processDir(inDir, outDir, { size, concurrency, mode }) {
  const names = (await fs.promises.readdir(inDir)).filter((n) => /\.ppm$/i.test(n)).sort();
  if (names.length === 0) { console.error(`no .ppm files in ${inDir}`); process.exit(1); }
  await fs.promises.mkdir(outDir, { recursive: true });
  console.log(`Thumbnailing ${names.length} images → ${size}px (${mode}), pool of ${concurrency}\n`);
  const t0 = Date.now();
  const results = await runPool(names, makeJob(inDir, outDir, size, mode), {
    concurrency,
    onProgress: ({ done, total }) => drawBar(done, total, `${((done / ((Date.now() - t0) / 1000)) || 0).toFixed(1)}/s`),
  });
  const secs = (Date.now() - t0) / 1000;
  const { ok, failed } = summarize(results);
  console.log(`\nDone in ${secs.toFixed(2)}s — ${ok} ok, ${failed} failed, ${(ok / secs).toFixed(1)} img/s`);
  for (const r of results) {
    if (r && r.status === 'rejected') console.error(`  ✗ ${names[r.index]}: ${r.reason.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * --demo: synthesise a batch in a temp dir, then run it through a RANGE of
 * pool sizes and print the throughput curve. This is the payoff of the whole
 * category — you can watch throughput climb with concurrency up to roughly the
 * core count (resizing is CPU-bound), then flatten or dip as extra workers just
 * add scheduling overhead with no core to run on.
 * ------------------------------------------------------------------ */
async function demo({ count, size }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-demo-'));
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  const dim = 900; // big enough that one resize is a visible chunk of CPU
  console.log(`Synthesising ${count} ${dim}x${dim} images in ${srcDir} ...`);
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(srcDir, `img${String(i).padStart(3, '0')}.ppm`), writePPM(syntheticImage(dim, dim, i + 1)));
  }
  // inject two deliberately broken files to prove failure isolation
  fs.writeFileSync(path.join(srcDir, 'broken-a.ppm'), Buffer.from('P6\n10 10\n255\nnot enough bytes'));
  fs.writeFileSync(path.join(srcDir, 'broken-b.ppm'), Buffer.from('totally not a ppm'));

  const names = fs.readdirSync(srcDir).filter((n) => /\.ppm$/i.test(n)).sort();
  const cores = os.cpus() ? os.cpus().length : 4;
  console.log(`\nMachine reports ${cores} logical cores. Resizing is CPU-bound, so expect`);
  console.log(`throughput to rise until ~${cores} workers and then stop improving.\n`);

  const sizes = Array.from(new Set([1, 2, 4, cores, cores * 2])).filter((n) => n >= 1).sort((a, b) => a - b);
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  console.log('pool │ time    │ throughput │ result');
  console.log('─────┼─────────┼────────────┼────────────────');
  let best = null;
  for (const c of sizes) {
    const t0 = Date.now();
    const results = await runPool(names, makeJob(srcDir, outDir, size, 'contain'), { concurrency: c });
    const secs = (Date.now() - t0) / 1000;
    const { ok, failed } = summarize(results);
    const rate = ok / secs;
    if (!best || rate > best.rate) best = { c, rate };
    console.log(
      `${String(c).padStart(4)} │ ${secs.toFixed(2).padStart(6)}s │ ${rate.toFixed(1).padStart(7)}/s │ ${ok} ok, ${failed} failed`
    );
  }
  console.log(`\nFastest pool size here: ${best.c} (${best.rate.toFixed(1)} img/s).`);
  console.log(`The 2 broken files are reported as failures every run — the batch never aborts.`);
  console.log(`\nThumbnails + sources left in: ${dir}`);
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
    else pos.push(a);
  }
  return { pos, opt };
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const size = opt.size ? parseInt(opt.size, 10) : 160;
  if (opt.demo) {
    await demo({ count: opt.count ? parseInt(opt.count, 10) : 48, size });
    return;
  }
  if (pos.length < 2) {
    console.error('Usage: node thumbnail-node.js <inDir> <outDir> [--size=160] [--concurrency=4] [--mode=contain]');
    console.error('   or: node thumbnail-node.js --demo [--count=48] [--size=160]');
    process.exit(1);
  }
  await processDir(pos[0], pos[1], {
    size,
    concurrency: opt.concurrency ? parseInt(opt.concurrency, 10) : 4,
    mode: opt.mode || 'contain',
  });
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { readPPM, writePPM, syntheticImage };
