// Rebuild home-screen icons from the original logo without redrawing it.
// Run `node scripts/generate-app-icons.mjs`; ffmpeg must be installed.
// Publish the shared artwork with purpose "any": Chrome's shortcut and WebAPK
// paths apply different adaptive scaling when the same image is "maskable".
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const sourcePath = join(publicDir, "icon.png");
const size = 512;
// The original red outline reaches 43.4% of the canvas width from the center.
// This scale leaves room for launchers that display circular icon shapes.
const markSize = 460;
const count = size * size;
const sourceFile = readFileSync(sourcePath);
if (sourceFile.readUInt32BE(16) !== size || sourceFile.readUInt32BE(20) !== size) {
  throw new Error("The source logo must be 512x512");
}

function ffmpeg(args) {
  return execFileSync("ffmpeg", ["-v", "error", ...args], {
    maxBuffer: count * 8,
  });
}

const source = ffmpeg([
  "-i", sourcePath, "-f", "rawvideo", "-pix_fmt", "rgba", "-",
]);

function visitNeighbors(index, visit) {
  const x = index % size;
  const y = Math.floor(index / size);
  if (x > 0) visit(index - 1);
  if (x < size - 1) visit(index + 1);
  if (y > 0) visit(index - size);
  if (y < size - 1) visit(index + size);
}

// The red strokes form closed outlines. Flooding from the canvas edges keeps
// the original gray bevel and every pixel inside those outlines with the mark.
const red = new Uint8Array(count);
for (let index = 0; index < count; index++) {
  const [r, g, b] = source.subarray(index * 4, index * 4 + 3);
  red[index] = Number(r > 80 && r > g * 1.5 && r > b * 1.5);
}
const outside = new Uint8Array(count);
const queue = new Int32Array(count);
let head = 0;
let tail = 0;
function visitOutside(index) {
  if (!outside[index] && !red[index]) {
    outside[index] = 1;
    queue[tail++] = index;
  }
}
for (let position = 0; position < size; position++) {
  visitOutside(position);
  visitOutside((size - 1) * size + position);
  visitOutside(position * size);
  visitOutside(position * size + size - 1);
}
while (head < tail) visitNeighbors(queue[head++], visitOutside);

// Include the antialiased edge around the red outline in the cutout.
const mark = new Uint8Array(count);
for (let index = 0; index < count; index++) {
  if (outside[index]) continue;
  const x = index % size;
  const y = Math.floor(index / size);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
        mark[ny * size + nx] = 1;
      }
    }
  }
}
const cutout = Buffer.from(source);
for (let index = 0; index < count; index++) {
  cutout[index * 4 + 3] = mark[index] ? 255 : 0;
}

// Sample the original charcoal above the mark and fill the entire canvas.
// The operating system supplies rounded corners; the artwork has no inner tile.
const sampleOffset = (32 * size + size / 2) * 4;
const backgroundColor = Buffer.from(source.subarray(sampleOffset, sampleOffset + 4));
backgroundColor[3] = 255;
const background = Buffer.alloc(count * 4);
for (let index = 0; index < count; index++) backgroundColor.copy(background, index * 4);

const workDir = mkdtempSync(join(tmpdir(), "91-app-icons-"));
const masterPath = join(publicDir, "app-icon-512-v4.png");
try {
  const backgroundPath = join(workDir, "background.rgba");
  const cutoutPath = join(workDir, "mark.rgba");
  writeFileSync(backgroundPath, background);
  writeFileSync(cutoutPath, cutout);
  const rawInput = ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "512x512"];
  ffmpeg([
    ...rawInput, "-i", backgroundPath,
    ...rawInput, "-i", cutoutPath,
    "-filter_complex",
    `[1:v]scale=${markSize}:${markSize}:flags=lanczos[mark];[0:v][mark]overlay=(W-w)/2:(H-h)/2:format=rgb`,
    "-frames:v", "1", "-update", "1", "-pix_fmt", "rgb24",
    "-compression_level", "9", "-y", masterPath,
  ]);
  for (const [dimension, name] of [
    [192, "app-icon-192-v4.png"],
    [180, "apple-touch-icon-v4.png"],
  ]) {
    ffmpeg([
      "-i", masterPath, "-vf", `scale=${dimension}:${dimension}:flags=lanczos`,
      "-frames:v", "1", "-update", "1", "-compression_level", "9",
      "-y", join(publicDir, name),
    ]);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log("Generated shared home-screen icons from public/icon.png");
