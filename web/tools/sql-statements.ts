// Split trusted migration files, preserving PL/pgSQL dollar quotes, strings and comments.
export function sqlStatements(sql: string) {
  const statements: string[] = [];
  let start = 0,
    quote = '',
    dollar = '',
    block = 0,
    line = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i],
      next = sql[i + 1];
    if (line) {
      if (char === '\n') line = false;
      continue;
    }
    if (block) {
      if (char === '/' && next === '*') {
        block++;
        i++;
      } else if (char === '*' && next === '/') {
        block--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = '';
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (char === '-' && next === '-') {
      line = true;
      i++;
    } else if (char === '/' && next === '*') {
      block = 1;
      i++;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '$') {
      const token = /^(\$[a-zA-Z_][a-zA-Z0-9_]*\$|\$\$)/.exec(sql.slice(i));
      if (token) {
        dollar = token[0];
        i += dollar.length - 1;
      }
    } else if (char === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  if (quote || dollar || block) throw new Error('Unterminated SQL token in migration');
  const last = sql.slice(start).trim();
  if (last.replace(/--[^\n]*/g, '').trim()) statements.push(last);
  return statements;
}
