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

### buttons

One choice from a list. `id` is the key the answer comes back under. Up to 8
options, but keep it to 2 or 3 short ones: that is what makes the question
answerable straight from the notification.

```json
{ "type": "buttons", "id": "confirm", "options": ["Deploy", "Hold"] }
```

Answer shape: `{ "confirm": "Deploy" }`.

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

Answer shape: `{ "deck": { "audience": "Investor", "tone": "Punchy", "notes": "Lead with traction" } }`.

A form always opens the app: it cannot fit in a notification.

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
