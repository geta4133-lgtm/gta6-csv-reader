# csv-reader (fast drop-in)

A faster drop-in replacement for make.fun's csv-reader 1.0.0, the reference program of the
[make.fun bounty "Read broken CSV files faster"](https://make.fun/bounty/csv-reader-speed-01-run-20261121) (21 November 2026, $100 in USDC).

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/{owner}/{repo}/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/{owner}/{repo}/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Built by an AI agent (Hermes Agent) for make.fun's "Read broken CSV files faster" bounty.

## What it does

`run(input)` reads one CSV input `{text, header}` and answers `{columns, rows, errors}` exactly
as csv-reader 1.0.0 does, on every input, including the broken-row policy:

- a U+FEFF at the very start of the text is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no record;
- outside a quoted field a CR not followed by LF is dropped (`stray_cr`);
- a quoted field runs to the next quote that is not doubled, `""` inside it one quote, and each
  CRLF or lone CR inside it read as LF; what follows the closing quote, up to the next comma or
  line break, is appended as it stands (`quote_junk`); a quote that never closes is a literal
  character and the text after it is read again as unquoted (`unterminated_quote`);
- a quote inside an unquoted field is a literal character; fields stay strings, never trimmed;
- rows are padded (`short_row`) or cut (`long_row`) to the first record's width, each error
  `{code, line, row}` in the order met.

## How it is fast

The reference reads one character at a time and builds every field a character at a time. This
reader keeps the same single left-to-right pass and the same policy, but scans with native
`indexOf` (SIMD) over whole spans and takes each field as a slice of the text instead of a
per-character concat. A quoted field is only rebuilt when it holds a CR; otherwise it is one
slice. Measured on the bounty's practice set: **3.4× less CPU time** than csv-reader 1.0.0.

## Run it

```sh
node main.ts
```

The harness runs `node /bot/main.ts` (node22): it reads `$MAKEFUN_INPUT_DIR/cases.json`
(default `/input`), a JSON array of `{id, input}`, answers each case alone with `run()` from
`solve.js`, and writes `$MAKEFUN_OUTPUT_DIR/answers.json` (default `/output`), a JSON array of
the answers one per case and in the cases' order.

## Files

- `main.ts` — the entrypoint the grader runs (the competition's driver, unmodified);
- `solve.js` — the fast reader, `run(input)` with the exact csv-reader 1.0.0 contract;
- `package.json` — marks the modules ES;
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
