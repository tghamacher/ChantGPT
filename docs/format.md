# The ChantGPT document format

A ChantGPT document holds what has been read from a source (a PDF or a set of page images): its pages, their staves,
and on each staff the chant as **GABC**, the notation of Gregorio, with every piece placed on the page. It is JSON, and
`js/chant.js` reads, writes and checks it.

The idea is to change GABC as little as possible. A staff holds syllables as GABC writes them, `text(notes)`, and each
GABC group inside the parentheses is an *item* that can carry a box on the page and the recognizer's confidence. So a
document turns straight into GABC, and a GABC transcription (from GregoBase, say) turns straight into a document, which
is how training data and tests will be made.

## An example

```json
{
  "format": "chantgpt",
  "version": 1,
  "source": { "name": "Graduale-1908.pdf", "type": "pdf", "pages": 912 },
  "pages": [
    {
      "n": 1,
      "size": [612, 792],
      "staves": [
        {
          "id": "p1s1",
          "box": [52, 96, 508, 44],
          "lines": [[52, 104, 560, 103], [52, 113, 560, 112], [52, 122, 560, 121], [52, 131, 560, 130]],
          "syllables": [
            { "text": "", "items": [{ "g": "c4", "box": [54, 100, 9, 26], "conf": 0.99 }] },
            { "text": "Gló", "box": [70, 140, 22, 12], "items": [{ "g": "f", "box": [74, 124, 7, 6], "conf": 0.97 }] },
            { "text": "ri", "join": true, "items": [{ "g": "gh", "box": [96, 113, 9, 15], "conf": 0.62 }] },
            { "text": "", "items": [{ "g": ":", "box": [140, 104, 2, 27] }] },
            { "text": "", "items": [{ "g": "h+", "box": [552, 108, 5, 9] }] }
          ]
        }
      ]
    }
  ],
  "chants": [
    { "headers": { "name": "Gloria Patri", "mode": "8" }, "staves": ["p1s1"] }
  ]
}
```

## The parts

**Document**

- `format`: always `"chantgpt"`; `version`: `1`.
- `source`: the file's `name`, its `type` (`"pdf"` or `"images"`), and the number of `pages`. The file itself is not
  kept in the document.
- `pages`: one for each page of the source, in order.
- `chants`: the pieces found in the source. Each has GABC `headers` (`name`, `mode`, `office-part` and so on, as
  GregoBase uses them) and the `staves` it runs over, by id, in order. A chant can run over several pages.

**Page**

- `n`: the page number in the source, from 1.
- `size`: `[width, height]` in the page's own units. **Every box and line on the page is in these units**, measured
  from the top left: PDF points (1/72 inch) for a PDF, pixels for an image. They stay the same at any zoom.
- `staves`: in reading order.

**Staff**

- `id`: unique in the document. The app writes `p<page>s<staff>`, but any string will do.
- `box`: `[x, y, width, height]` around the staff and its notes (optional). The app sets it from the lines: from
  their ends, and a space and a half above the top line and below the bottom one.
- `lines`: the four staff lines, top to bottom, each a list of points from left to right, `[x0, y0, x1, y1, …]`
  (optional, but the recognizer will need them). A straight staff, level or tilted, has two points a line, its ends.
  A staff on a page that couldn't be scanned flat bends: it has a point at each bend, and runs straight between them.
  The app gives all four lines points at the same xs. The app keeps a page's staves in reading order, top to bottom.
- `syllables`: in order, left to right.

**Syllable**

- `text`: the syllable as GABC writes it, markup included (`<i>`, `<sp>V/</sp>`). Clefs, bars and a custos usually
  stand on a syllable with no text, as in GABC's `(c4)` and `(::)`.
- `join`: `true` when the syllable goes on with the word before it (no space). It may be the first syllable of a
  staff, for a word broken over a line.
- `box`: around the text (optional).
- `items`: the GABC groups over this syllable, in order.

**Item**

- `g`: GABC, as written inside the parentheses but without them. Its kind follows from what it is:
  - **clef**: `c1`–`c4`, `f1`–`f4`, `cb3` (a clef with a B flat);
  - **bar**: `,` `;` `:` `::` `` ` `` and their numbered forms (`;3`, `,0`);
  - **custos**: a letter and `+` (`h+`);
  - **accidental**, standing alone: a letter and `x` (flat), `y` (natural) or `#` (sharp);
  - **break**: `z`, `z+`, `z-`, `z0`, `Z` (only in GABC read in; a staff ends instead);
  - **neume**: anything else: notes with their signs, kept exactly as written (`fgh`, `f/gh`, `ivHG`, `gwh_`, `ixhi`).
- `box`: around the item on the page (optional). Its left edge is where the item is drawn; its top and bottom
  follow the item's notes, and the app sets them. An item without a box isn't drawn: placing GABC on a staff gives
  every item a box, spaced along the staff.
- `conf`: the recognizer's confidence, from 0 to 1 (optional; absent for what a person entered). The app marks items
  under 0.8.

A neume item may hold several neumes over one syllable (`fg gf`): a box goes around them all. Splitting them so each
has its own box may come with the editor.

## Pitch

GABC writes notes as staff positions, `a` (below the lowest line) to `m`; the four lines are `d f h j`. The clef in
force names the pitch: `CGChant.pitch('h', 'c4')` is A3; `c4` puts middle C on the top line, and an F clef's line is
the F below middle C. `CGChant.withClefs(staff, clefBefore)` lists a staff's items with the clef in force at each.

## GABC in and out

- `CGChant.fromGabc(text)` reads GABC into `{ headers, staves }`. A line break (`z`, `Z`) starts a new staff, so a
  transcription made line by line comes back in the source's staves.
- `CGChant.toGabc(doc, { chant, lines })` writes a chant (by default the first, or all staves if there are no chants).
  `lines: true` keeps the source's line breaks as `(z)`. Custos items are left out: Gregorio sets its own.
- `CGChant.check(doc)` lists what is wrong with a document, in plain sentences.

## Later

- MEI-Neumes and Volpiano export.
- Mensural notation (version 2 of the format, or a sibling): five lines, and items in a mensural encoding instead of
  GABC.
