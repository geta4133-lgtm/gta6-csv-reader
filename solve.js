// Fast drop-in for make.fun's csv-reader 1.0.0 (the house baseline): run(input) answers
// {columns, rows, errors} exactly as the reference does, on every input, with nothing kept
// from one call to the next.
//
// The reference reads one character at a time and builds every field up a character at a time.
// This reader keeps the same single left-to-right pass and the same broken-row policy, but
// scans with native indexOf (SIMD) over whole spans, and takes each field as a slice of the
// text instead of a per-character concat. A quoted field is only rebuilt when it holds a CR
// (each CRLF or lone CR inside quotes reads as LF); otherwise it is one slice. The policy is
// the reference's, written out the same way:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it
//     one quote, and each CRLF or lone CR inside it read as LF; what follows its closing quote,
//     up to the next comma or line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character and the text after it is read
//     again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never
//     trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after
//     it, each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF,
//     CRLF and lone CR inside a quoted field counted), row its record's index in rows (null for
//     the header), in the order met, a field's quote_junk when the field ends and a record's
//     short_row or long_row when the record ends.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const LF = 10;
const CR = 13;
const QUOTE = 34;
const COMMA = 44;
const BOM = 0xfeff;

/** How a field ended: 1 a comma (the record goes on), 2 a line break, 3 the end of the text. */
const AT_COMMA = 1;
const AT_BREAK = 2;
const AT_END = 3;

/** The reading of one CSV input, {text, header}: {columns, rows, errors} (the header). */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === BOM) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Scratch shared by the field readers, so neither allocates to hand its result back.
  let fStart = 0; // where the current field's value starts
  let fq = ''; // the field readUnquoted() read
  let f = ''; // the current field's final value

  // Counts the LF characters in [a, b): a LF is never preceded by a CR on any path here,
  // because a CR inside a quoted field is consumed together with the LF that follows it.
  function countLFs(a, b) {
    let n = 0;
    let i = text.indexOf('\n', a);
    while (i >= 0 && i < b) {
      n += 1;
      i = text.indexOf('\n', i + 1);
    }
    return n;
  }

  // Reads unquoted characters from pos (the value starts at fStart) up to the next comma or
  // line break: a CR not followed by LF is dropped (stray_cr). Sets fq and returns how the
  // field ended. Each field is one slice of the text; only fields with dropped CRs need joining.
  function readUnquoted() {
    let s = fStart;
    let parts = null; // slices kept so far, set only when a stray CR is dropped
    let added = 0;
    while (true) {
      let c = text.indexOf(',', pos);
      if (c < 0) c = len;
      let n = text.indexOf('\n', pos);
      if (n < 0) n = len;
      let r = text.indexOf('\r', pos);
      if (r < 0) r = len;
      let m = c < n ? c : n;
      if (r < m) m = r;
      if (m === len) {
        // The text ends: what is left is the field as it stands.
        fq = parts === null ? text.slice(s) : (parts.push(text.slice(s, len)), parts.join(''));
        pos = len;
        return AT_END;
      }
      if (m === r) {
        // A CR: a CRLF ends the record, a lone CR is dropped (stray_cr) and the read goes on.
        if (text.charCodeAt(m + 1) === LF) {
          fq = parts === null ? text.slice(s, m) : (parts.push(text.slice(s, m)), parts.join(''));
          pos = m + 2;
          line += 1;
          return AT_BREAK;
        }
        if (parts === null) parts = [];
        if (m > s) {
          parts.push(text.slice(s, m));
          added += m - s;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = m + 1;
        s = pos;
        continue;
      }
      if (m === c) {
        // A comma: the field ends and the record goes on.
        fq = parts === null ? text.slice(s, m) : (parts.push(text.slice(s, m)), parts.join(''));
        pos = m + 1;
        return AT_COMMA;
      }
      // A LF: the record ends.
      fq = parts === null ? text.slice(s, m) : (parts.push(text.slice(s, m)), parts.join(''));
      pos = m + 1;
      line += 1;
      return AT_BREAK;
    }
    void added;
  }

  // Reads a quoted field whose opening quote is at pos. Sets f and returns how the field ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (true) {
      const q = text.indexOf('"', pos);
      if (q < 0) {
        // The quote never closes: it is a literal character, and the text after it is read
        // again as unquoted, starting at the quote itself.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        fStart = open;
        const ended = readUnquoted();
        f = fq;
        return ended;
      }
      // The span [pos, q) is quoted content up to the next quote.
      if (q > pos) {
        const r = text.indexOf('\r', pos);
        if (r < 0 || r >= q) {
          // No CR inside: the whole span is one slice; only its LFs move the line.
          value += text.slice(pos, q);
          line += countLFs(pos, q);
        } else {
          // Each CRLF or lone CR inside quotes reads as one LF.
          let i = pos;
          while (i < q) {
            const rr = text.indexOf('\r', i);
            if (rr < 0 || rr >= q) {
              value += text.slice(i, q);
              line += countLFs(i, q);
              break;
            }
            if (rr > i) {
              value += text.slice(i, rr);
              line += countLFs(i, rr);
            }
            value += '\n';
            line += 1;
            pos = rr + (text.charCodeAt(rr + 1) === LF ? 2 : 1);
            i = pos;
          }
        }
      }
      pos = q + 1;
      if (text.charCodeAt(q + 1) === QUOTE) {
        // A doubled quote: one quote inside the field.
        value += '"';
        pos = q + 2;
        continue;
      }
      closed = true;
      break;
    }
    void closed;
    if (pos >= len) {
      f = value;
      return AT_END;
    }
    const ch = text.charCodeAt(pos);
    if (ch === COMMA) {
      pos += 1;
      f = value;
      return AT_COMMA;
    }
    if (ch === LF) {
      pos += 1;
      line += 1;
      f = value;
      return AT_BREAK;
    }
    if (ch === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      f = value;
      return AT_BREAK;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line
    // break; any of it kept makes quote_junk.
    fStart = pos;
    const ended = readUnquoted();
    if (fq.length > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    f = value + fq;
    return ended;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === LF) {
        pos += 1;
        line += 1;
      } else if (ch === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === QUOTE;
      if (quoted) {
        ended = readQuoted();
      } else {
        fStart = pos;
        ended = readUnquoted();
        f = fq;
      }
      fields.push(f);
    } while (ended === AT_COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr
    // errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
