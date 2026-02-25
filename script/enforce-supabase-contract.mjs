import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXAMPLE_ENV_PATH = path.join(ROOT, ".env.example");
const LOCAL_ENV_PATH = path.join(ROOT, ".env");

const REQUIRED_SUPABASE_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];

const SUPABASE_KEY_PREFIXES = ["SUPABASE_", "VITE_SUPABASE_"];

const FRONTEND_SCAN_DIRS = ["client", "mobile", "android", "ios", "lib"];
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".dart",
  ".yaml",
  ".yml",
  ".html",
]);

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".dart_tool",
  "Pods",
]);

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseEnv(content) {
  const map = new Map();
  const duplicates = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = line.slice(eqIndex + 1).trim();
    if (map.has(key)) duplicates.push(key);
    map.set(key, value);
  }
  return { map, duplicates };
}

function isSupabaseContractKey(key) {
  return SUPABASE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function listFilesRecursive(dirPath) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      out.push(...listFilesRecursive(fullPath));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (SCAN_EXTENSIONS.has(ext)) out.push(fullPath);
  }

  return out;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function failWith(title, lines) {
  console.error(`\n[guard:supabase] ${title}`);
  for (const line of lines) console.error(`- ${line}`);
  process.exitCode = 1;
}

function run() {
  if (!fs.existsSync(EXAMPLE_ENV_PATH)) {
    failWith("Missing .env.example", [".env.example file is required for contract checks."]);
    return;
  }

  const exampleParsed = parseEnv(readFileSafe(EXAMPLE_ENV_PATH));
  if (exampleParsed.duplicates.length > 0) {
    failWith("Duplicate keys in .env.example", Array.from(new Set(exampleParsed.duplicates)));
  }

  const missingRequiredInExample = REQUIRED_SUPABASE_KEYS.filter((key) => !exampleParsed.map.has(key));
  if (missingRequiredInExample.length > 0) {
    failWith("Missing required Supabase keys in .env.example", missingRequiredInExample);
  }

  if (fs.existsSync(LOCAL_ENV_PATH)) {
    const localParsed = parseEnv(readFileSafe(LOCAL_ENV_PATH));
    const localSupabaseKeys = Array.from(localParsed.map.keys()).filter(isSupabaseContractKey);
    const missingFromExample = localSupabaseKeys.filter((key) => !exampleParsed.map.has(key));
    if (missingFromExample.length > 0) {
      failWith(
        "Env drift detected for Supabase contract keys (.env keys missing from .env.example)",
        missingFromExample.sort(),
      );
    }
  } else {
    console.log("[guard:supabase] .env not found locally; skipping local env drift check.");
  }

  const leakedFiles = [];
  for (const dirName of FRONTEND_SCAN_DIRS) {
    const dirPath = path.join(ROOT, dirName);
    const files = listFilesRecursive(dirPath);
    for (const filePath of files) {
      const content = readFileSafe(filePath);
      if (content.includes("SUPABASE_SERVICE_ROLE_KEY")) {
        leakedFiles.push(relative(filePath));
      }
    }
  }

  if (leakedFiles.length > 0) {
    failWith("Service role key identifier leaked into frontend/mobile code", leakedFiles.sort());
  }

  if (process.exitCode && process.exitCode !== 0) return;
  console.log("[guard:supabase] Contract checks passed.");
}

run();