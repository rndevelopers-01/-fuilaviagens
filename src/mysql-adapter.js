export function prepareMysqlQuery(sql, parameters = []) {
  const values = [];
  const mysqlSql = sql
    .replace(/=\s*ANY\(\$(\d+)::uuid\[\]\)/gi, (_match, index) => `IN ($${index})`)
    .replace(/\$(\d+)/g, (_match, index) => {
      const parameterIndex = Number(index) - 1;
      if (parameterIndex < 0 || parameterIndex >= parameters.length) {
        throw new Error(`Parâmetro SQL $${index} não foi informado.`);
      }
      values.push(parameters[parameterIndex]);
      return "?";
    });

  return { sql: mysqlSql, parameters: values };
}

export function normalizeMysqlResult(result) {
  if (Array.isArray(result)) {
    return { rows: result, rowCount: result.length };
  }
  return {
    rows: [],
    rowCount: result?.affectedRows || 0,
    insertId: result?.insertId,
  };
}
