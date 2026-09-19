import { getGoogleAuthClient, TOKEN_REUSE_MESSAGE, getAuthPaths } from "./googleAuth.js";
import fs from "fs";

async function main() {
  console.log("=== CloseFuture Google Calendar OAuth Setup ===");
  const { credentialsPath, tokensPath } = getAuthPaths();
  console.log(`Credentials: ${credentialsPath}`);
  console.log(`Tokens file: ${tokensPath}`);

  if (fs.existsSync(tokensPath)) {
    console.log("Existing tokens.json found.");
    console.log(TOKEN_REUSE_MESSAGE);
  } else {
    console.log("No tokens found. Opening browser for authorization...");
  }

  const client = await getGoogleAuthClient();
  const tokenInfo = await client.getAccessToken();

  if (tokenInfo.token) {
    console.log("\n✅ Google Calendar OAuth authentication is successful!");
    console.log(TOKEN_REUSE_MESSAGE);
  } else {
    console.error("\n❌ Failed to obtain valid access token.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Authentication error:", err?.message || err);
  process.exit(1);
});
