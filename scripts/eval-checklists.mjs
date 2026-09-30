#!/usr/bin/env node
/**
 * Wrapper for the checklist eval (list and activity-detection quality against the real
 * models). Same flags as eval:milo minus --model, which only applies to chat: they
 * are turned into env vars because vitest does not forward unknown CLI options to
 * the worker.
 *
 *   npm run eval:checklists
 *   npm run eval:checklists -- --filter mudanza
 *   npm run eval:checklists -- --provider ollama
 *   npm run eval:checklists -- --transcript /tmp/checklists
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CLI flag -> env var the eval reads. */
const FLAGS = {
  filter: "EVAL_FILTER",
  repeat: "EVAL_REPEAT",
  provider: "EVAL_PROVIDER",
  transcript: "EVAL_TRANSCRIPT"
};

const argv = process.argv.slice(2);
const forwarded = [];
const unknown = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];

  if (!arg.startsWith("--")) {
    // Not one of ours: pass it on so vitest's own options still work.
    forwarded.push(arg);
    continue;
  }

  const name = arg.slice(2);
  const envName = FLAGS[name];

  if (!envName) {
    unknown.push(arg);
    continue;
  }

  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`eval:checklists: --${name} necesita un valor.`);
    process.exit(1);
  }

  process.env[envName] = value;
  i += 1;
}

if (unknown.length > 0) {
  console.error(
    `eval:checklists: opción desconocida ${unknown.join(", ")}.\n` +
      `  Opciones: ${Object.keys(FLAGS).map((f) => `--${f}`).join(", ")}`
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.eval.mts", "checklist.eval", ...forwarded],
  { cwd: root, stdio: "inherit", env: process.env }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
