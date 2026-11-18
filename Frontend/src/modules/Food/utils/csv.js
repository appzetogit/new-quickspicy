/**
 * CSV in and out for admin import/export pages. Handles quoted fields with
 * commas, quotes ("") and line breaks; a UTF-8 BOM is added on export so Excel
 * shows ₹ and Indian names correctly.
 */
const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`

export const toCsv = (rows, columns) =>
  [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","))].join("\r\n")

export const downloadCsv = (text, filename) => {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Rows as objects keyed by the header line. Empty lines are skipped. */
export const parseCsv = (text) => {
  const src = String(text || "").replace(/^﻿/, "")
  const lines = []
  let row = []
  let field = ""
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { row.push(field); field = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(field); field = ""
      if (row.some((v) => v.trim() !== "")) lines.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((v) => v.trim() !== "")) lines.push(row)
  if (!lines.length) return []
  const header = lines[0].map((h) => h.trim())
  return lines.slice(1).map((values) => Object.fromEntries(header.map((h, i) => [h, (values[i] ?? "").trim()])))
}
