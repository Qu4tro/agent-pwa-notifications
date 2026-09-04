# Blocks

An event's body is a JSON array of typed blocks, at most 50. The server
validates every block and rejects the whole event if one is malformed, so a
typo never renders as broken markup.

Eight display blocks work in any event. Two interactive blocks are only valid on
a question (`POST /api/v1/questions`), and a question must carry at least one of
them.

The same list, machine-readable and always current for the hub you are talking
to: `GET <hub>/api/v1/schema.json`.

## Display blocks

### markdown

GitHub-flavored markdown, up to 20000 characters. The first markdown block in
an event also supplies the notification preview line.

```json
{ "type": "markdown", "text": "## Deploy finished\nAll **14** checks passed." }
```

### progress

A bar. `max` defaults to 100. Pair it with `POST /api/v1/events/:id` to move the
same card instead of posting a new one per tick.

```json
{ "type": "progress", "label": "Sources scraped", "value": 14, "max": 20 }
```

### keyvalue

Up to 50 label and value pairs. Good for a result summary.

```json
{ "type": "keyvalue", "items": [{ "k": "Tests", "v": "412 passed" }, { "k": "Duration", "v": "38s" }] }
```

### table

Up to 12 columns and 200 rows. Every cell is a string.

```json
{
  "type": "table",
  "columns": ["Package", "Before", "After"],
  "rows": [["react", "19.1.0", "19.2.0"], ["vite", "8.0.1", "8.2.2"]]
}
```

### link

One outbound link. `label` is optional and falls back to the URL.

```json
{ "type": "link", "url": "https://github.com/example/repo/pull/12", "label": "Pull request 12" }
```

Never send a link only you can reach, such as a `localhost` URL. The human opens
it on another device.

### image

An image by URL, up to 2000 characters. No `data:` URIs. `alt` is optional but
worth writing.

```json
{ "type": "image", "url": "https://example.com/chart.png", "alt": "Latency by day, flat at 40ms" }
```

### code

A code block, up to 20000 characters. `lang` is optional and only affects
highlighting.

```json
{ "type": "code", "lang": "sh", "text": "pnpm test\n# 78 passed" }
```

### callout

A single highlighted line. `tone` is `info` (default), `success`, `warn` or
`error`.

```json
{ "type": "callout", "tone": "warn", "text": "The staging database is two migrations behind." }
```

## Interactive blocks (questions only)

An answer is one document in two parts. `answer` holds the values of the blocks
below, keyed by block id; `text` holds the human's own words. They are
siblings, so no block id can collide with the words, and either part may be
empty:

```json
{ "answer": { "confirm": "Deploy" }, "text": null }
{ "answer": { "confirm": "Deploy" }, "text": "after the demo, not before" }
{ "answer": {}, "text": "wait for QA to sign off" }
```

Every question takes words, whatever blocks it carries, so plan for an answer
that arrives as prose alone.

### buttons

One choice from a list. `id` is the key the answer comes back under. Up to 8
options, but keep it to 2 or 3 short ones: that is what makes the question
answerable straight from the notification.

```json
{ "type": "buttons", "id": "confirm", "options": ["Deploy", "Hold"] }
```

Answer shape: `{ "answer": { "confirm": "Deploy" }, "text": null }`.

An option's colour is decided by three rules, in this order:

1. **What you set.** A `colors` entry always wins.
2. **What the label says.** A plain affirmative or denial - `Yes`, `Correct`,
   `Approve`, `Go ahead`, `OK`; `No`, `Wrong`, `Reject`, `Not now`, `Cancel` -
   comes out green or red on its own. The whole label has to be the word, so
   "Yes, but hold" is not an affirmative and is not coloured as one.
3. **Its position.** Everything else takes the next colour in the palette, which
   says only that the choices are different, not which one is which. Green and
   red are never handed out this way, so they only ever mean rule 2.

So send nothing. A yes/no question is already green and red, and any other set
of options already reads apart.

`colors` is optional, parallel to `options`, and may be shorter than it; it
pairs by position from the left, and an option past the end of it falls to
rules 2 and 3. Each entry is `blue`, `violet`, `mint`, `rose`, `amber`, `cyan`,
`pink`, `lime`, or `#rrggbb`.

Use it only when a particular choice should read a particular way. Because it
wins over rule 2, it is also the only way to paint an affirmative red - which
is why you should not: red is the error colour everywhere else in this app.

```json
{ "type": "buttons", "id": "confirm", "options": ["Deploy", "Hold"], "colors": ["mint", "amber"] }
```

### form

Several fields at once, submitted together. Up to 20 fields. Each field has an
`id`, a `kind` (`text`, `textarea`, `number`, `select`, `radio`, `checkbox`), a
`label`, and optionally `options` (for select, radio and checkbox), `required`
and `placeholder`.

```json
{
  "type": "form",
  "id": "deck",
  "submitLabel": "Build it",
  "fields": [
    { "id": "audience", "kind": "select", "label": "Audience", "options": ["Investor", "Customer", "Internal"] },
    { "id": "tone", "kind": "radio", "label": "Tone", "options": ["Formal", "Punchy"] },
    { "id": "notes", "kind": "textarea", "label": "Anything to emphasize?", "placeholder": "Optional" }
  ]
}
```

Answer shape:
`{ "answer": { "deck": { "audience": "Investor", "tone": "Punchy", "notes": "Lead with traction" } }, "text": null }`.

A form always opens the app: its fields cannot fit in a notification. The
notification still carries a Reply action, so the human can answer it in words
without opening anything.

## A whole question

```json
{
  "title": "Ready to deploy?",
  "timeout_minutes": 120,
  "blocks": [
    { "type": "markdown", "text": "All production checks passed." },
    { "type": "buttons", "id": "confirm", "options": ["Deploy", "Hold"] }
  ]
}
```
