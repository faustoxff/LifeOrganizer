#!/usr/bin/env node
/**
 * Wrapper for the Milo eval so its flags actually arrive.
 *
 * They never used to. Vitest rejects unknown CLI options outright, and the
 * args that survive a `--` separator are not in `process.argv` inside the test
 * worker. So `--filter`, `--repeat`, `--model` and `--provider` were parsed by
 * code that could only ever see the defaults, and every documented run silently
 * did the same full thing: both models, one repeat, no filter.
 *
 * Env vars do arrive, because they are inherited by the worker. This wrapper
 * turns the friendly CLI into those env vars and then hands off to vitest.
 *
 *   npm run eval:milo
 *   npm run eval:milo -- --filter recurrencia
 *   npm run eval:milo -- --model default --repeat 3
 *   npm run eval:milo -- --provider ollama
 *   npm run eval:milo -- --mode legacy    (baseline: el camino de TASKS_ACTION)
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CLI flag -> env var the eval reads. */
const FLAGS = {
  filter: "EVAL_FILTER",
  repeat: "EVAL_REPEAT",
  model: "EVAL_MODEL",
  provider: "EVAL_PROVIDER",
  mode: "EVAL_MODE",
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
    console.error(`eval:milo: --${name} necesita un valor.`);
    process.exit(1);
  }

  process.env[envName] = value;
  i += 1;
}

if (unknown.length > 0) {
  console.error(
    `eval:milo: opción desconocida ${unknown.join(", ")}.\n` +
      `  Opciones: ${Object.keys(FLAGS).map((f) => `--${f}`).join(", ")}`
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.eval.mts", "milo-chat.eval", ...forwarded],
  { cwd: root, stdio: "inherit", env: process.env }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
