import dotenv from "dotenv";
dotenv.config();

import { supabase } from "./supabase.js";

async function runTest(): Promise<void> {
  console.log("[Supabase Test]: Initiating Supabase connection test...");

  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("id")
      .limit(1);

    if (error) {
      // If table does not exist yet in fresh project, authentication and endpoint connectivity still succeeded
      if (
        error.message?.includes("Could not find the table") ||
        error.message?.includes("does not exist") ||
        error.code === "PGRST205" ||
        error.code === "42P01"
      ) {
        console.log(
          "[Supabase Test]: SUCCESS - Connected and authenticated with Supabase project successfully."
        );
        console.log(
          "[Supabase Test]: Schema status - 'sessions' table not found yet. Please paste and run 'backend/supabase/schema.sql' in the Supabase SQL Editor."
        );
        return;
      }

      console.error(
        `[Supabase Test]: FAILED - Database query error: ${error.message}`
      );
      process.exit(1);
    }

    console.log(
      `[Supabase Test]: SUCCESS - Connected to Supabase project and queried 'sessions' table successfully.`
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Supabase Test]: FAILED - ${errorMessage}`);
    process.exit(1);
  }
}

runTest();
