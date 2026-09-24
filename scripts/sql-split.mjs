/**
 * Split a SQL file into statements without being fooled by its contents.
 *
 * The migration runner used to split on every semicolon and strip everything
 * after `--`. That works until a migration carries data — and the London
 * places carry both: "…; the queue is long" in a summary, and a URL is one
 * hyphen away from a comment. This walks the text once and only counts a
 * semicolon or a comment when it is outside a string literal.
 *
 * Handles: 'single-quoted' strings with '' escapes, "double-quoted"
 * identifiers, -- line comments, block comments. Returns trimmed
 * statements with comments removed and empty ones dropped.
 */
export function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === "'" || c === '"') {
      // Copy the whole literal, including a doubled quote inside it.
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === q) {
          if (sql[j + 1] === q) { j += 2; continue; }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }

    if (c === ";") {
      const s = cur.trim();
      if (s) out.push(s);
      cur = "";
      i++;
      continue;
    }

    cur += c;
    i++;
  }

  const last = cur.trim();
  if (last) out.push(last);
  return out;
}

/** SQL string literal for a JS value: NULL, a number, or a quoted string. */
export function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}
