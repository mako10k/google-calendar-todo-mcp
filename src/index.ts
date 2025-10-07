import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { startServer } from "./server.js";
import { authorize, requiredScopes, tokenPath } from "./googleClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
const VERSION = packageJson.version ?? "0.0.0";

type Command = "start" | "auth" | "version" | "help";

function parseCommand(): Command {
  const [, , firstArg] = process.argv;
  if (!firstArg) {
    return "start";
  }

  switch (firstArg) {
    case "start":
      return "start";
    case "auth":
      return "auth";
    case "version":
    case "--version":
    case "-v":
      return "version";
    case "help":
    case "--help":
    case "-h":
      return "help";
    default:
      return "start";
  }
}

function showHelp(): void {
  const scopes = requiredScopes.join("\n    - ");
  process.stdout.write(`google-calendar-todo-mcp v${VERSION}\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  google-calendar-todo-mcp [command]\n\n`);
  process.stdout.write(`Commands:\n`);
  process.stdout.write(`  start     Start the MCP server over stdio (default)\n`);
  process.stdout.write(`  auth      Run authentication flow and cache tokens\n`);
  process.stdout.write(`  version   Show the current version\n`);
  process.stdout.write(`  help      Show this help message\n\n`);
  process.stdout.write(`Environment variables:\n`);
  process.stdout.write(`  GOOGLE_OAUTH_CREDENTIALS   Path to OAuth credentials JSON\n`);
  process.stdout.write(`  GOOGLE_CALENDAR_MCP_TOKEN_PATH   Custom token cache path (optional)\n\n`);
  process.stdout.write(`Required OAuth scopes (requested automatically):\n    - ${scopes}\n`);
  process.stdout.write(`Token cache location: ${tokenPath}\n`);
}

async function run(): Promise<void> {
  const command = parseCommand();

  switch (command) {
    case "auth": {
      await authorize();
      process.stdout.write(`OAuth tokens saved to ${tokenPath}.\n`);
      break;
    }
    case "version": {
      process.stdout.write(`google-calendar-todo-mcp v${VERSION}\n`);
      break;
    }
    case "help": {
      showHelp();
      break;
    }
    case "start":
    default: {
      await startServer(VERSION);
      break;
    }
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
