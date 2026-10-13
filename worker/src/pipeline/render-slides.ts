import fs from "node:fs/promises";
import path from "node:path";
import { run } from "../lib/ffmpeg";

/**
 * Deterministic, template-based slide renderer. Reuses the exact same
 * toolchain already proven for video (ffmpeg + the DejaVu Sans font already
 * installed in the worker image, docker/Dockerfile.worker) instead of adding
 * a new native image-processing dependency: a 1-frame "video" with the
 * headline/body burned in via a hand-written ASS subtitle track over a flat
 * brand-colored background, exported as a single PNG. A Sharp/Canva-API
 * based renderer is a reasonable drop-in swap later if finer typography is
 * needed — the slide script -> PNG contract (renderSlide) stays the same.
 */

export interface SlideRenderInput {
  headline: string;
  body?: string | null;
  index: number;
  total: number;
  width: number;
  height: number;
  /** Hex, e.g. "#1A2B3C" — falls back to a neutral dark background. */
  backgroundHex?: string | null;
  accentHex?: string | null;
  outFile: string;
}

export const PLATFORM_DIMENSIONS: Record<string, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1350 }, // 4:5 feed carousel
  square: { width: 1080, height: 1080 },
  linkedin: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

export function dimensionsFor(platform: string): { width: number; height: number } {
  return PLATFORM_DIMENSIONS[platform] ?? PLATFORM_DIMENSIONS.instagram!;
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Normalizes to a plain 6-hex-digit RGB string (no "#"), falling back when absent/invalid. */
function normalizeHex(hex: string | null | undefined, fallback: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  return (m ? m[1]! : fallback).toUpperCase();
}

/** RGB hex -> ASS's &H00BBGGRR (ASS/SSA colors are BGR, alpha first). */
function assColor(rgbHex: string): string {
  const r = rgbHex.slice(0, 2);
  const g = rgbHex.slice(2, 4);
  const b = rgbHex.slice(4, 6);
  return `&H00${b}${g}${r}`;
}

/** Word-wraps to roughly `maxChars` per line (ASS doesn't auto-wrap at an arbitrary pixel width for \pos'd text). Returns the lines unjoined — join with the literal (unescaped) \N after escaping each line, never before, or escaping doubles the \N marker itself into visible text. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > maxChars) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Escapes one line of plain text for an ASS Dialogue — never called on a string that already contains a \N marker. */
function escapeAssText(s: string): string {
  return s.replace(/\\/g, "⧵").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/** Wraps, escapes each line independently, then joins with a literal (unescaped) ASS \N. */
function wrapAndEscape(text: string, maxChars: number): string {
  return wrap(text, maxChars).map(escapeAssText).join("\\N");
}

/** Renders one slide to a PNG at `input.outFile`. Caller owns the work directory and cleanup. */
export async function renderSlide(input: SlideRenderInput): Promise<void> {
  const { width, height } = input;
  const bgHex = normalizeHex(input.backgroundHex, "14213D"); // neutral dark navy default
  const bg = assColor(bgHex);
  const accent = assColor(normalizeHex(input.accentHex, "FFFFFF"));

  const headlineFontSize = Math.round(width * 0.062);
  const bodyFontSize = Math.round(width * 0.034);
  const marginH = Math.round(width * 0.09);
  const headlineY = Math.round(height * 0.42);
  const bodyY = Math.round(height * 0.6);
  const headlineWrapChars = Math.max(8, Math.round((width - 2 * marginH) / (headlineFontSize * 0.52)));
  const bodyWrapChars = Math.max(10, Math.round((width - 2 * marginH) / (bodyFontSize * 0.5)));

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Alignment, MarginL, MarginR, MarginV, Outline, Shadow",
    `Style: Headline,DejaVu Sans,${headlineFontSize},&H00FFFFFF,&H00000000,&H00000000,1,5,${marginH},${marginH},0,0,0`,
    `Style: Body,DejaVu Sans,${bodyFontSize},&H00E8E8E8,&H00000000,&H00000000,0,5,${marginH},${marginH},0,0,0`,
    `Style: Footer,DejaVu Sans,${Math.round(width * 0.026)},${accent},&H00000000,&H00000000,0,8,${marginH},${marginH},${Math.round(height * 0.04)},0,0`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:05.00,Headline,,0,0,0,,{\\pos(${Math.round(width / 2)},${headlineY})}${wrapAndEscape(input.headline, headlineWrapChars)}`,
    input.body
      ? `Dialogue: 0,0:00:00.00,0:00:05.00,Body,,0,0,0,,{\\pos(${Math.round(width / 2)},${bodyY})}${wrapAndEscape(input.body, bodyWrapChars)}`
      : "",
    `Dialogue: 0,0:00:00.00,0:00:05.00,Footer,,0,0,0,,${input.index + 1}/${input.total}`,
  ]
    .filter(Boolean)
    .join("\n");

  const workDir = path.dirname(input.outFile);
  const assPath = path.join(workDir, `slide-${input.index}.ass`);
  await fs.writeFile(assPath, ass, "utf8");

  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x${bgHex}:s=${width}x${height}:d=1`,
    "-vf",
    `ass='${escapeFilterPath(assPath)}'`,
    "-frames:v",
    "1",
    input.outFile,
  ]);
}
