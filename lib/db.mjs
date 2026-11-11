import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool;
let local;

export async function sql(text, params = []) {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await pool.query(text, params)).rows;
  }
  local ??= startLocal().catch((error) => {
    local = undefined;
    throw error;
  });
  return (await (await local).query(text, params)).rows;
}

export async function withTransaction(work) {
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const rows = await work({
        query: async (text, params = []) =>
          (await client.query(text, params)).rows,
      });
      await client.query("commit");
      return rows;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  const db = await (local ??= startLocal().catch((error) => {
    local = undefined;
    throw error;
  }));
  await db.query("begin");
  try {
    const rows = await work({
      query: async (text, params = []) => (await db.query(text, params)).rows,
    });
    await db.query("commit");
    return rows;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function startLocal() {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => []))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}
