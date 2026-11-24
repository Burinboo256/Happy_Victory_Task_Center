import { AppError } from '../errors';

// Compile only the equality/AND/OR subset used by server-owned repository queries.
// Unknown syntax fails closed; never drop a filter or interpolate values into SQL.
export function compileFilter(formula: string | undefined, values: unknown[]) {
  if (!formula) return 'TRUE';
  const source = formula;
  let cursor = 0;
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  function expression(): string {
    for (const op of ['AND', 'OR']) {
      if (source.startsWith(`${op}(`, cursor)) {
        cursor += op.length + 1;
        const parts = [expression()];
        while (source[cursor] === ',') {
          cursor++;
          parts.push(expression());
        }
        if (source[cursor++] !== ')') throw new Error();
        return `(${parts.join(` ${op} `)})`;
      }
    }
    const match = /^(?:\{([^{}]+)\}|(RECORD_ID\(\)))=/.exec(source.slice(cursor));
    if (!match) throw new Error();
    cursor += match[0].length;
    const literal = /^"(?:[^"\\]|\\["\\])*"/.exec(source.slice(cursor));
    if (!literal) throw new Error();
    const value = JSON.parse(literal[0]);
    cursor += literal[0].length;
    const field = match[1];
    if (match[2] || field === 'Record ID') return `id=${parameter(value)}`;
    if (field === 'Agent Record ID') return `fields->'Agent'->>0=${parameter(value)}`;
    if (field === 'Task Record ID') return `fields->'Task'->>0=${parameter(value)}`;
    return `(fields->>${parameter(field)})=${parameter(value)}`;
  }
  try {
    const sql = expression();
    if (cursor !== formula.length) throw new Error();
    return sql;
  } catch {
    throw new AppError(503, 'TASK_FILTER_UNSUPPORTED', 'รูปแบบการค้นหายังไม่รองรับ');
  }
}
