/**
 * Portable resolution of the Railway CLI executable for child_process calls,
 * WITHOUT a shell (no `shell: true`, no cmd.exe).
 *
 * Why: Node spawns only real executables. On Windows, `spawn("railway")` finds
 * `railway.exe`/`railway.com` on PATH but not npm's `railway.cmd` shim or the
 * extension-less bash shim Git Bash runs — hence `spawnSync railway ENOENT`
 * while `railway` works in the terminal.
 *
 * Order:
 *   1. RAILWAY_CLI=<path>   explicit override (an .exe, a binary, or an npm .cmd shim)
 *   2. PATH, in PATH order
 *      - Linux/macOS: the first executable file named `railway`
 *      - Windows:     per directory railway.exe, railway.com, then railway.cmd/.bat
 * A .cmd/.bat is never executed: its target is read from the npm shim
 * ("%dp0%\node_modules\@railway\cli\bin\railway.js") and resolved to
 *   - the native railway.exe the @railway/cli package installs next to railway.js, or
 *   - the current Node running railway.js if that binary is missing
 *     (railway.js then prints the package's own "binary not installed" error).
 *
 * Returns { command, args, source } — spawn `command` with [...args, ...cliArgs].
 */
import fs from "node:fs";
import path from "node:path";

const WINDOWS_EXTS = [".exe", ".com", ".cmd", ".bat"];

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return isFile(p);
  } catch {
    return false;
  }
}

function pathDirs(env, platform) {
  const raw = env.PATH ?? env.Path ?? env.path ?? "";
  return raw
    .split(platform === "win32" ? ";" : ":")
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/** Reads an npm cmd-shim and returns the absolute path of the program it launches. */
function shimTarget(shimPath) {
  let text;
  try {
    text = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const dir = path.dirname(shimPath);
  // cmd-shim quotes every target as "%dp0%\..." (npm 7+) or "%~dp0\..." (older npm).
  for (const m of text.matchAll(/"%~?dp0%?\\([^"%]+)"/g)) {
    const rel = m[1];
    if (/^node(\.exe)?$/i.test(rel)) continue; // the optional bundled node.exe, not the target
    const target = path.join(dir, ...rel.split("\\"));
    if (isFile(target)) return target;
  }
  return null;
}

function fromWindowsFile(file, execPath, source) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".exe" || ext === ".com") return { command: file, args: [], source };
  if (ext === ".cmd" || ext === ".bat") {
    const target = shimTarget(file);
    if (!target) return null;
    const tExt = path.extname(target).toLowerCase();
    if (tExt === ".exe" || tExt === ".com") return { command: target, args: [], source: `${source} → ${target}` };
    if ([".js", ".cjs", ".mjs"].includes(tExt)) {
      const native = path.join(path.dirname(target), "railway.exe");
      if (isFile(native)) return { command: native, args: [], source: `${source} → ${native}` };
      return { command: execPath, args: [target], source: `${source} → node ${target}` };
    }
  }
  return null;
}

export function resolveRailwayCli({ platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  const override = env.RAILWAY_CLI;
  if (override) {
    if (!isFile(override)) throw new Error(`RAILWAY_CLI=${override} does not exist`);
    if (platform === "win32") {
      const r = fromWindowsFile(override, execPath, "RAILWAY_CLI");
      if (r) return r;
      throw new Error(`RAILWAY_CLI=${override}: expected railway.exe or an npm railway.cmd shim`);
    }
    return { command: override, args: [], source: "RAILWAY_CLI" };
  }

  const dirs = pathDirs(env, platform);
  const unusable = [];
  for (const dir of dirs) {
    if (platform === "win32") {
      for (const ext of WINDOWS_EXTS) {
        const file = path.join(dir, `railway${ext}`);
        if (!isFile(file)) continue;
        const r = fromWindowsFile(file, execPath, `PATH (${file})`);
        if (r) return r;
        unusable.push(file);
      }
    } else {
      const file = path.join(dir, "railway");
      if (isExecutable(file)) return { command: file, args: [], source: `PATH (${file})` };
    }
  }
  const hint = unusable.length ? ` Found but could not resolve: ${unusable.join(", ")}.` : "";
  throw new Error(
    `Railway CLI not found on PATH (${dirs.length} directories searched).${hint} ` +
      "Install it (https://docs.railway.com/guides/cli) or set RAILWAY_CLI to the railway executable.",
  );
}
