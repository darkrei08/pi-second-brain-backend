const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

function waitForStep(operation, timeout_ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeout_ms}ms`)), timeout_ms);
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

export async function shutdownGateway({
  gateway,
  pool,
  timeout_ms = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  writeError = (message) => process.stderr.write(`${message}\n`),
  exit = (code) => process.exit(code)
} = {}) {
  let failed = false;
  for (const [name, operation] of [['gateway.stop', () => gateway.stop()], ['pool.end', () => pool.end()]]) {
    try {
      await waitForStep(operation, timeout_ms);
    } catch (error) {
      failed = true;
      writeError(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  exit(failed ? 1 : 0);
}
