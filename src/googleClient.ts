import { authenticate } from "@google-cloud/local-auth";
import { google, calendar_v3, tasks_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks"
];

const DEFAULT_TOKEN_PATH = path.join(
  os.homedir(),
  ".config",
  "google-calendar-todo-mcp",
  "token.json"
);

function getTokenPath(): string {
  return process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH ?? DEFAULT_TOKEN_PATH;
}

async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
  try {
    const tokenPath = getTokenPath();
    const content = await fs.readFile(tokenPath, "utf-8");
    const tokens = JSON.parse(content) as {
      client_id: string;
      client_secret: string;
      refresh_token?: string;
      access_token?: string;
      expiry_date?: number;
    };

    if (!tokens.client_id || !tokens.client_secret) {
      return null;
    }

    const client = new google.auth.OAuth2(
      tokens.client_id,
      tokens.client_secret
    );
    client.setCredentials(tokens);
    return client;
  } catch (error) {
    return null;
  }
}

async function saveCredentials(client: OAuth2Client): Promise<void> {
  const keyfilePath = process.env.GOOGLE_OAUTH_CREDENTIALS;
  if (!keyfilePath) {
    throw new Error("GOOGLE_OAUTH_CREDENTIALS environment variable is required");
  }

  const content = await fs.readFile(keyfilePath, "utf-8");
  const credentials = JSON.parse(content) as {
    installed?: { client_id: string; client_secret: string };
    web?: { client_id: string; client_secret: string };
  };

  const keys = credentials.installed ?? credentials.web;
  if (!keys || !keys.client_id || !keys.client_secret) {
    throw new Error("Invalid Google OAuth credentials file. Expected installed or web client.");
  }

  const { client_id, client_secret } = keys;
  const payload = {
    type: "authorized_user",
    client_id,
    client_secret,
    refresh_token: client.credentials.refresh_token,
    access_token: client.credentials.access_token,
    expiry_date: client.credentials.expiry_date
  };

  const tokenPath = getTokenPath();
  await ensureDirectoryExists(tokenPath);
  await fs.writeFile(tokenPath, JSON.stringify(payload, null, 2));
}

export async function authorize(): Promise<OAuth2Client> {
  const keyfilePath = process.env.GOOGLE_OAUTH_CREDENTIALS;
  if (!keyfilePath) {
    throw new Error("Set GOOGLE_OAUTH_CREDENTIALS to the path of your OAuth client credentials JSON file.");
  }

  const cachedClient = await loadSavedCredentialsIfExist();
  if (cachedClient) {
    return cachedClient;
  }

  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath
  });

  await saveCredentials(client);
  return client;
}

export function getCalendarClient(auth: OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth });
}

export function getTasksClient(auth: OAuth2Client): tasks_v1.Tasks {
  return google.tasks({ version: "v1", auth });
}

export const tokenPath = getTokenPath();
export const requiredScopes = [...SCOPES];
