# Rich presentation blocks

Always call `get_capabilities` first and use only
`presentation.available_blocks`. These blocks are Pro on hosted Agent Dash and
available in self-hosted Community mode. Free fallbacks preserve the content.

## Choose the smallest useful block

| Need | Rich block | Free fallback |
|---|---|---|
| Several visual options or screenshots | `gallery` | Separate `image` or `artifact` blocks |
| Show a visual change | `before_after` | Two labeled images/artifacts |
| Explain a code change | `diff` | A unified diff inside `code` |
| Summarize key outcomes | `metrics` | `keyvalue` |
| Show implementation or rollout state | `timeline` | Markdown bullets or `table` |

Do not use a carousel for unrelated images, a diff for an entire large file, or
metrics when ordinary prose is clearer.

## Visual sources

Gallery and before/after sources accept exactly one of:

```json
{ "url": "https://example.com/result.png", "alt": "Dashboard after contrast fix", "label": "After", "caption": "AA contrast" }
```

```json
{ "artifact_id": "01...", "alt": "Dashboard after contrast fix", "label": "After", "caption": "AA contrast" }
```

Use `upload_artifact` to stage private/local images and receive artifact ids.
Never send localhost URLs, secrets, or data URLs.

## Gallery

```json
{
  "type": "gallery",
  "title": "Three header directions",
  "items": [
    { "artifact_id": "01A...", "label": "Quiet", "caption": "Lowest visual weight" },
    { "artifact_id": "01B...", "label": "Balanced", "caption": "Recommended" },
    { "artifact_id": "01C...", "label": "Bold", "caption": "Highest contrast" }
  ]
}
```

Use 2–12 items. Keep labels short and make `alt` text describe what materially
differs.

## Before/after

```json
{
  "type": "before_after",
  "title": "Settings contrast repair",
  "before": { "artifact_id": "01A...", "label": "Before", "caption": "CTA label disappears" },
  "after": { "artifact_id": "01B...", "label": "After", "caption": "Readable at AA contrast" }
}
```

Both images should use the same viewport and framing so the comparison slider
is meaningful.

## Diff

```json
{
  "type": "diff",
  "filename": "src/routes/settings.tsx",
  "lang": "tsx",
  "summary": "Makes the CTA label explicit and raises contrast.",
  "old_text": "<Button className=\"text-transparent\" />",
  "new_text": "<Button>Connect Agent Dash</Button>"
}
```

Send the smallest relevant excerpt, not generated build output or a whole
repository. The UI provides Changes, Before, and After tabs.

## Metrics

```json
{
  "type": "metrics",
  "title": "Accessibility pass",
  "items": [
    { "label": "Contrast issues", "value": "0", "delta": "−6", "tone": "success" },
    { "label": "Lighthouse", "value": "98", "delta": "+11", "tone": "success" }
  ]
}
```

Use 1–6 items. `tone` is `neutral`, `success`, `warn`, or `error`.

## Timeline

```json
{
  "type": "timeline",
  "title": "Deployment",
  "items": [
    { "label": "Build", "detail": "Typecheck and bundle", "status": "done" },
    { "label": "Deploy", "detail": "Cloudflare Worker", "status": "active" },
    { "label": "Smoke test", "status": "pending" }
  ]
}
```

Statuses are `pending`, `active`, `done`, and `error`.

## Enhanced core blocks

Core `table` supports optional `caption` and `compact`. Core `code` supports
optional `filename` and `highlight_lines` (1-based line numbers). These work on
Free and should be preferred over a Pro block when they communicate the result
just as well.
