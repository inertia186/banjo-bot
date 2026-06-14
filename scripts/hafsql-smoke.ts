import "dotenv/config";
import pg from "pg";

const host = process.env.HAFSQL_HOST ?? "hafsql-sql.mahdiyari.info";
const port = Number.parseInt(process.env.HAFSQL_PORT ?? "5432", 10);
const database = process.env.HAFSQL_DATABASE ?? "haf_block_log";
const user = process.env.HAFSQL_USERNAME ?? "hafsql_public";
const password = process.env.HAFSQL_PASSWORD ?? "hafsql_public";
const ssl = process.env.HAFSQL_SSL === "true";
const timeout = Number.parseInt(process.env.HAFSQL_STATEMENT_TIMEOUT_MS ?? "8000", 10);

const pool = new pg.Pool({
  host,
  port,
  database,
  user,
  password,
  ssl,
  max: 1,
  idleTimeoutMillis: 5_000,
  query_timeout: timeout,
});

try {
  const schemas = await pool.query<{ schema_name: string }>(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name IN ('hafsql', 'hafbe_bal', 'hafd')
    ORDER BY schema_name
  `);
  const accounts = await pool.query<{ total: string }>("SELECT COUNT(*) AS total FROM hafsql.accounts LIMIT 1");
  const delegations = await pool.query<{ delegator: string; delegatee: string }>(`
    SELECT delegator, delegatee
    FROM hafsql.delegations
    LIMIT 1
  `);

  console.log(`Connected to ${host}/${database}`);
  console.log(`Schemas: ${schemas.rows.map((row) => row.schema_name).join(", ") || "(none)"}`);
  console.log(`Accounts: ${accounts.rows[0]?.total ?? "unknown"}`);
  console.log(`Delegation sample: ${delegations.rows[0]?.delegator ?? "none"} -> ${delegations.rows[0]?.delegatee ?? "none"}`);
} finally {
  await pool.end();
}
