import fs from "fs";
import path from "path";
import http from "http";
import { URL } from "url";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export const TOKEN_REUSE_MESSAGE =
  "Tokens are persisted and reused; re-authentication may be required if authorization is revoked or the refresh token becomes invalid.";

/**
 * Resolves path to credentials.json and tokens.json, supporting execution from
 * either repository root or backend folder.
 */
export function getAuthPaths(): { credentialsPath: string; tokensPath: string } {
  const candidates = [
    path.resolve(process.cwd(), "credentials.json"),
    path.resolve(process.cwd(), "backend", "credentials.json"),
    path.resolve(__dirname, "../../../credentials.json"),
  ];

  let credentialsPath = candidates[0];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      credentialsPath = p;
      break;
    }
  }

  const baseDir = path.dirname(credentialsPath);
  const tokensPath = path.join(baseDir, "tokens.json");

  return { credentialsPath, tokensPath };
}

/**
 * Loads credentials.json securely.
 */
function loadCredentialsConfig(credentialsPath: string) {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Google OAuth credentials file not found at: ${credentialsPath}. Please place credentials.json in backend/`
    );
  }

  const raw = fs.readFileSync(credentialsPath, "utf-8");
  const parsed = JSON.parse(raw);
  const config = parsed.installed || parsed.web;

  if (!config || !config.client_id || !config.client_secret) {
    throw new Error(
      "Invalid credentials.json: Missing 'installed' or 'web' configuration with client_id/client_secret."
    );
  }

  return config;
}

/**
 * Saves tokens securely to tokens.json.
 * Never prints tokens or credentials to any output.
 */
function saveTokens(tokensPath: string, tokens: Record<string, unknown>): void {
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf-8");
}

/**
 * Launches local HTTP loopback server to handle desktop OAuth consent flow.
 * Outputs the authorization URL clearly to stderr and opens the system browser.
 */
async function authenticateDesktop(
  credentialsPath: string,
  scopes: string[]
): Promise<OAuth2Client> {
  const config = loadCredentialsConfig(credentialsPath);
  const client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret
  );

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const address = server.address() as any;
        const port = address?.port || 3000;
        const reqUrl = new URL(req.url || "", `http://localhost:${port}`);
        const code = reqUrl.searchParams.get("code");
        const error = reqUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h3>Authorization rejected. You may close this tab.</h3>");
          server.close();
          return reject(new Error(`OAuth Authorization Error: ${error}`));
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body style='font-family:sans-serif;text-align:center;padding-top:50px;'><h2>Authentication Successful!</h2><p>CloseFuture Calendar is now authorized. You can close this tab and return to the application.</p></body></html>"
          );
          server.close();

          const redirectUri = `http://localhost:${port}`;
          const { tokens } = await client.getToken({
            code,
            redirect_uri: redirectUri,
          });
          client.setCredentials(tokens);
          resolve(client);
        }
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    const port = 3000;
    server.listen(port, () => {
      const redirectUri = `http://localhost:${port}`;

      const authorizeUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
        redirect_uri: redirectUri,
      });

      console.error("\n=======================================================");
      console.error("[GoogleAuth] GOOGLE CALENDAR AUTHORIZATION REQUIRED");
      console.error("Please open the following URL in your browser to authorize:");
      console.error(authorizeUrl);
      console.error("=======================================================\n");

      // Attempt to launch default browser automatically
      try {
        if (process.platform === "win32") {
          exec(`start "" "${authorizeUrl}"`).unref();
        } else if (process.platform === "darwin") {
          exec(`open "${authorizeUrl}"`).unref();
        } else {
          exec(`xdg-open "${authorizeUrl}"`).unref();
        }
      } catch {
        // Fallback to manual link click
      }
    });

    server.on("error", (err) => reject(err));
  });
}

let cachedAuthClient: OAuth2Client | null = null;

/**
 * Obtains an authenticated OAuth2Client for Google Calendar API.
 * Reuses persisted tokens from tokens.json whenever available.
 */
export async function getGoogleAuthClient(): Promise<OAuth2Client> {
  if (cachedAuthClient) {
    return cachedAuthClient;
  }

  const { credentialsPath, tokensPath } = getAuthPaths();
  const config = loadCredentialsConfig(credentialsPath);
  const redirectUri = config.redirect_uris?.[0] || "http://localhost";

  const oauth2Client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    redirectUri
  );

  // Setup automatic token refresh persistence
  oauth2Client.on("tokens", (newTokens) => {
    try {
      let existingTokens: Record<string, unknown> = {};
      if (fs.existsSync(tokensPath)) {
        existingTokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
      }
      const merged = { ...existingTokens, ...newTokens };
      saveTokens(tokensPath, merged);
      console.error(
        `[GoogleAuth] ${TOKEN_REUSE_MESSAGE}`
      );
    } catch (err: any) {
      console.error("[GoogleAuth] Warning: Failed to persist refreshed tokens:", err?.message);
    }
  });

  // Check if tokens.json already exists
  if (fs.existsSync(tokensPath)) {
    try {
      const savedTokensRaw = fs.readFileSync(tokensPath, "utf-8");
      const tokens = JSON.parse(savedTokensRaw);
      oauth2Client.setCredentials(tokens);

      console.error(`[GoogleAuth] ${TOKEN_REUSE_MESSAGE}`);
      cachedAuthClient = oauth2Client;
      return oauth2Client;
    } catch (err: any) {
      console.error(
        "[GoogleAuth] Persisted tokens.json is invalid or unreadable. Initiating re-authentication...",
        err?.message
      );
    }
  }

  // Tokens not found or invalid: initiate desktop authentication flow
  console.error("[GoogleAuth] No active tokens found. Launching local OAuth authorization flow...");

  const authenticatedClient = await authenticateDesktop(credentialsPath, OAUTH_SCOPES);

  if (authenticatedClient.credentials) {
    saveTokens(tokensPath, authenticatedClient.credentials as Record<string, unknown>);
    console.error(`[GoogleAuth] Authorization successful. ${TOKEN_REUSE_MESSAGE}`);
  }

  cachedAuthClient = authenticatedClient;
  return authenticatedClient;
}
