import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMysqlResult, prepareMysqlQuery } from "../src/mysql-adapter.js";

test("PostgreSQL-style parameters are converted to MySQL placeholders", () => {
  const prepared = prepareMysqlQuery(
    "SELECT * FROM orders WHERE contact_email_hash = $1 OR receipt_token_hash = $1 LIMIT $2 OFFSET $3",
    ["email-hash", 50, 100]
  );

  assert.equal(
    prepared.sql,
    "SELECT * FROM orders WHERE contact_email_hash = ? OR receipt_token_hash = ? LIMIT ? OFFSET ?"
  );
  assert.deepEqual(prepared.parameters, ["email-hash", "email-hash", 50, 100]);
});

test("UUID array filters become MySQL IN clauses", () => {
  const prepared = prepareMysqlQuery(
    "SELECT * FROM participants WHERE order_id = ANY($1::uuid[])",
    [["order-a", "order-b"]]
  );

  assert.equal(
    prepared.sql,
    "SELECT * FROM participants WHERE order_id IN (?)"
  );
  assert.deepEqual(prepared.parameters, [["order-a", "order-b"]]);
});

test("MySQL results expose rows and affected-row counts", () => {
  assert.deepEqual(normalizeMysqlResult([{ id: "order-a" }]), {
    rows: [{ id: "order-a" }],
    rowCount: 1,
  });
  assert.deepEqual(normalizeMysqlResult({ affectedRows: 2, insertId: 8 }), {
    rows: [],
    rowCount: 2,
    insertId: 8,
  });
});

test("missing SQL parameters fail instead of running an incomplete query", () => {
  assert.throws(
    () => prepareMysqlQuery("SELECT * FROM orders WHERE id = $1", []),
    /Parâmetro SQL \$1 não foi informado/
  );
});
