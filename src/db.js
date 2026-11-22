import mysql from "mysql2";
import { normalizeMysqlResult, prepareMysqlQuery } from "./mysql-adapter.js";

const requiredSettings = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER"];
const missingSettings = requiredSettings.filter((name) => !process.env[name]?.trim());
if (process.env.MYSQL_PASSWORD === undefined) missingSettings.push("MYSQL_PASSWORD");
if (missingSettings.length) {
  throw new Error(
    `Configure ${missingSettings.join(", ")} no arquivo .env antes de iniciar a aplicação.`
  );
}

const ssl = process.env.MYSQL_SSL === "true"
  ? {
      ...(process.env.MYSQL_SSL_CA
        ? { ca: process.env.MYSQL_SSL_CA.replace(/\\n/g, "\n") }
        : {}),
      rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "false",
    }
  : undefined;

const mysqlOptions = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  charset: "utf8mb4",
  timezone: "-03:00",
  dateStrings: ["DATE", "DATETIME", "TIMESTAMP"],
  typeCast(field, next) {
    if (field.type === "TINY" && field.length === 1) {
      const value = field.string();
      return value === null ? null : value === "1";
    }
    return next();
  },
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  waitForConnections: true,
  queueLimit: 0,
  ...(ssl ? { ssl } : {}),
};

export const mysqlPool = mysql.createPool(mysqlOptions);
mysqlPool.on("connection", (connection) => {
  connection.query("SET time_zone = '-03:00'", (error) => {
    if (error) console.error("Não foi possível definir o fuso horário da conexão MySQL.");
  });
});
const promisePool = mysqlPool.promise();

function createQueryClient(connection) {
  return {
    async query(sql, parameters = []) {
      const prepared = prepareMysqlQuery(sql, parameters);
      const [result] = await connection.query(prepared.sql, prepared.parameters);
      return normalizeMysqlResult(result);
    },
    release() {
      connection.release();
    },
  };
}

export const pool = {
  query(sql, parameters = []) {
    return createQueryClient(promisePool).query(sql, parameters);
  },
  async connect() {
    return createQueryClient(await promisePool.getConnection());
  },
  end() {
    return promisePool.end();
  },
  on(event, handler) {
    mysqlPool.on(event, handler);
    return this;
  },
};

pool.on("error", () => {
  console.error("A conexão ociosa com o banco de dados falhou.");
});
