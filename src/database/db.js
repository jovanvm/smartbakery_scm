import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(currentDir, '..', '..');
const schemaPath = path.join(currentDir, 'schema.sql');

export const dbConfig = {
  host: String(process.env.DB_HOST ?? '127.0.0.1').trim() || '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306) || 3306,
  user: String(process.env.DB_USER ?? 'root').trim() || 'root',
  password: String(process.env.DB_PASSWORD ?? ''),
  database: String(process.env.DB_NAME ?? 'smartbakery_scm').trim() || 'smartbakery_scm'
};

export const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10) || 10,
  queueLimit: 0,
  namedPlaceholders: true,
  multipleStatements: true,
  decimalNumbers: true,
  dateStrings: true,
  charset: 'utf8mb4'
});

const transactionStore = new AsyncLocalStorage();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value);
}

function usesNamedPlaceholders(sql) {
  return /@[A-Za-z_][A-Za-z0-9_]*/.test(sql);
}

function toMysqlSql(sql) {
  return usesNamedPlaceholders(sql)
    ? sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, ':$1')
    : sql;
}

function normalizeParameters(sql, parameters) {
  const list = Array.isArray(parameters) ? parameters : [parameters];
  const values = list.length === 1 && Array.isArray(list[0]) ? list[0] : list;

  if (usesNamedPlaceholders(sql)) {
    if (values.length === 0) {
      return {};
    }

    if (!isPlainObject(values[0])) {
      throw new Error('Query dengan parameter bernama membutuhkan satu objek parameter.');
    }

    return values[0];
  }

  return values;
}

function getExecutor() {
  return transactionStore.getStore() ?? pool;
}

async function query(sql, parameters = []) {
  const [rows] = await getExecutor().execute(toMysqlSql(sql), normalizeParameters(sql, parameters));
  return rows;
}

async function get(sql, parameters = []) {
  const rows = await query(sql, parameters);
  return rows[0] ?? undefined;
}

async function all(sql, parameters = []) {
  return query(sql, parameters);
}

async function run(sql, parameters = []) {
  const [result] = await getExecutor().execute(toMysqlSql(sql), normalizeParameters(sql, parameters));

  return {
    lastInsertRowid: result.insertId,
    insertId: result.insertId,
    changes: result.affectedRows,
    affectedRows: result.affectedRows
  };
}

export async function withTransaction(callback) {
  const connection = await pool.getConnection();
  let started = false;

  try {
    await connection.query('BEGIN');
    started = true;

    const result = await transactionStore.run(connection, () => callback(connection));

    await connection.query('COMMIT');
    return result;
  } catch (error) {
    if (started) {
      try {
        await connection.query('ROLLBACK');
      } catch {
        throw error;
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

export async function initializeDatabase() {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
}

export async function closeDatabase() {
  await pool.end();
}

export const db = {
  pool,
  config: dbConfig,
  query,
  get,
  all,
  run,
  transaction: withTransaction,
  prepare(sql) {
    return {
      get: (...parameters) => get(sql, parameters),
      all: (...parameters) => all(sql, parameters),
      run: (...parameters) => run(sql, parameters)
    };
  }
};

await initializeDatabase();
