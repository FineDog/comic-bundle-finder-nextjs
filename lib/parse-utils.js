// Shared utilities for parsing comic issue names from CSV, XLSX, and CLZ exports.
// Import from here instead of copy-pasting into pages.

export function parseCSVLine(line) {
  const fields = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i+1]==='"'){current+='"';i++;}else inQuotes=!inQuotes; }
    else if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  fields.push(current.trim()); return fields;
}

export function yearFromDateString(s) {
  if (!s) return "";
  const m = s.match(/^(\d{4})-/); if (m) return m[1];
  const clz = s.match(/^[A-Za-z]{3}-(\d{2})$/);
  if (clz) { const y = parseInt(clz[1], 10); return String(y < 30 ? 2000 + y : 1900 + y); }
  const d = new Date(s); return isNaN(d) ? "" : String(d.getFullYear());
}

export function monthYearFromDateString(s) {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return { year: parseInt(iso[1], 10), month: parseInt(iso[2], 10) };
  const CLZ_MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const clz = s.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (clz) {
    const month = CLZ_MONTHS[clz[1].toLowerCase()];
    const y = parseInt(clz[2], 10);
    return month ? { year: y < 30 ? 2000 + y : 1900 + y, month } : null;
  }
  const d = new Date(s);
  return isNaN(d) ? null : { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function yearAfterMonths(date, offset) {
  if (!date) return "";
  if (!date.month) return String(date.year);
  return String(Math.floor((date.year * 12 + date.month - 1 + offset) / 12));
}

export function cleanSeriesName(name) {
  return name
    .replace(/\s*\(Vol\.\s*\d+\)/gi, "")
    .replace(/,?\s*Vol\.\s*\d+/gi, "")
    .replace(/\s*\(\d{4}\s*[-–]\s*(?:\d{4}|[Pp]resent)\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseIssueNum(s) {
  const m = String(s).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
