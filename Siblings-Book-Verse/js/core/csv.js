// Full RFC 4180, not a split on commas: the summaries hold commas, quotes and
// line breaks inside a single cell.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }

  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
