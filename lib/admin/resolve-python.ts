import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Next.js often has a stripped PATH (no Homebrew /usr/bin), so spawn("python3")
 * fails with ENOENT even when Python is installed.
 */
export function resolvePythonBin(root: string = process.cwd()): string {
  const fromEnv = (process.env.PYTHON || process.env.PYTHON_BIN || "").trim();
  const candidates = [
    fromEnv,
    path.join(root, "scripts", "telegram-collector", ".venv", "bin", "python"),
    "/opt/homebrew/bin/python3.12",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "python3";
}

/** Serverless hosts have no usable Python for enrich scripts. */
export function pythonIsRunnable(root: string = process.cwd()): boolean {
  if (
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY
  ) {
    return false;
  }
  const bin = resolvePythonBin(root);
  if (!bin || bin === "python3") return false;
  return existsSync(bin);
}

/** PATH so child scripts that call `python3` still find it. */
export function pythonSpawnEnv(
  extra: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const prefix = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  const current = extra.PATH || process.env.PATH || "";
  return {
    ...process.env,
    ...extra,
    PATH: current.includes("/opt/homebrew/bin")
      ? current
      : `${prefix}:${current}`,
  };
}
