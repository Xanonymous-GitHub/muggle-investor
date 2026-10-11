import { defineConfig } from "drizzle-kit";

// drizzle-kit runs standalone, so read the environment directly instead of through getEnv().
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
