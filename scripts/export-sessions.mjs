// Copy this project's Claude Code session log(s) into ai-sessions/, masking OpenRouter keys.
//
//   node scripts/export-sessions.mjs [--session <id>] [--config-dir <dir>] [--out ai-sessions]
//
// Copies <config>/projects/<project-slug>/<id>.jsonl and <id>/subagents/* unchanged
// except for masking. Masks anything shaped like an OpenRouter key (sk-or-…) and
// the exact OPENROUTER_API_KEY value from .env, if there is one. Then re-scans the
// copies and exits 1, naming the file and line but never the secret, if anything
// key-like is left. Run it after the session has ended, not on a live one.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const MASK = "sk-or-v1-****MASKED****";
/** OpenRouter keys: "sk-or-" then a long run of key characters. Prose like "grep for `sk-or-`" doesn't match. */
const KEY_SHAPE = /sk-or-[A-Za-z0-9_-]{8,}/g;

/** Mask key-shaped strings and the exact known key values. Returns the text and how many were masked. */
export function maskSecrets(text, knownKeys = []) {
  let count = 0;
  let out = text;
  for (const key of knownKeys.filter((k) => k && k.length >= 8)) {
    const parts = out.split(key);
    count += parts.length - 1;
    out = parts.join(MASK);
  }
  out = out.replace(KEY_SHAPE, () => {
    count++;
    return MASK;
  });
  return { text: out, count };
}

/** 1-based line numbers that still contain something key-like (or a known key). */
export function findSecrets(text, knownKeys = []) {
  const lines = [];
  text.split("\n").forEach((line, i) => {
    const shaped = (line.match(KEY_SHAPE) ?? []).length > 0;
    const known = knownKeys.some((k) => k && k.length >= 8 && line.includes(k));
    if (shaped || known) lines.push(i + 1);
  });
  return lines;
}

/** Claude Code's project folder name: the absolute path with every non-alphanumeric character as "-". */
export const projectSlug = (dir) => resolve(dir).replace(/[^a-zA-Z0-9]/g, "-");

function knownKeysFromEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env: rely on the pattern
  }
  return [process.env.OPENROUTER_API_KEY].filter(Boolean);
}

function main() {
  const { values: args } = parseArgs({
    options: {
      session: { type: "string" },
      "config-dir": { type: "string" },
      out: { type: "string", default: "ai-sessions" },
    },
  });
  const configDir = args["config-dir"] ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const projectDir = join(configDir, "projects", projectSlug(process.cwd()));
  if (!existsSync(projectDir)) fail(`no session folder at ${projectDir}`);

  // default: the most recently written session
  const sessions = readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ id: basename(f, ".jsonl"), mtime: statSync(join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const id = args.session ?? sessions[0]?.id;
  if (!id || !existsSync(join(projectDir, `${id}.jsonl`))) fail(`session not found: ${id ?? "(none)"}`);

  const files = [{ from: join(projectDir, `${id}.jsonl`), to: `${id}.jsonl` }];
  const subDir = join(projectDir, id, "subagents");
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir)) files.push({ from: join(subDir, f), to: join(`${id}-subagents`, f) });
  }

  const known = knownKeysFromEnv();
  mkdirSync(join(args.out, `${id}-subagents`), { recursive: true });
  let masked = 0;
  const leftovers = [];
  for (const f of files) {
    const dest = join(args.out, f.to);
    if (!/\.(jsonl|json)$/.test(f.from)) {
      copyFileSync(f.from, dest);
      continue;
    }
    const result = maskSecrets(readFileSync(f.from, "utf8"), known);
    masked += result.count;
    writeFileSync(dest, result.text);
    // check what was actually written, not what we meant to write
    const lines = findSecrets(readFileSync(dest, "utf8"), known);
    if (lines.length) leftovers.push(`${dest}: line(s) ${lines.slice(0, 10).join(", ")}`);
  }

  console.log(`copied ${files.length} file(s) for session ${id} into ${args.out}/, masked ${masked} key-like string(s)`);
  if (leftovers.length) fail(`something key-like is still in:\n  ${leftovers.join("\n  ")}\nDo not commit ${args.out}/.`);
}

function fail(msg) {
  console.error(`export-sessions: ${msg}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
