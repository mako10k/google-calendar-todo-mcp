import { authorize, tokenPath } from "./googleClient.js";

async function runAuth(): Promise<void> {
  await authorize();
  process.stdout.write(`Authentication complete. Tokens stored at ${tokenPath}.\n`);
}

runAuth().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Authentication failed: ${message}\n`);
  process.exitCode = 1;
});
