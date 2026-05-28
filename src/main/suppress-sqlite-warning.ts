// node:sqlite emits a one-time ExperimentalWarning when the module is first loaded.
// Importing this module (before "node:sqlite") installs a filter that drops just that
// message so it does not spam stderr or test output; every other warning passes through.
const original = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning?.message;
  if (typeof message === "string" && message.includes("SQLite is an experimental feature")) return;
  return (original as (warning: string | Error, ...args: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;
