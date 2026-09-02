# Notifications

How a message becomes a notification, when it carries answer buttons, and what
each browser actually does with them.

## What gets pushed

Every event has a priority:

| Priority | Push | Quiet hours |
|---|---|---|
| `0` | none, the event shows in the app only | n/a |
| `1` | a notification | suppressed |
| `2` | a notification | still rings |

Questions are always priority 2, so a question always reaches you.

Quiet hours are set in Settings as a start and an end in your local time. Only
priority 2 gets through them.

An event updated in place (`POST /api/v1/events/:id`) pushes only when the
update sets `notify: true`. That is what lets an agent move a progress bar
without buzzing the phone on every tick.

## Answering from the notification

A question can carry its answers as notification buttons, so you never open the
app. That happens when all of these hold:

- the title is at most 80 characters;
- the blocks contain exactly one interactive block, and it is `buttons`;
- that block has 2 or 3 options;
- every option is at most 20 characters, with no leading or trailing space;
- the question is not end-to-end encrypted.

Anything else is tap-to-open: the notification opens the thread, and you answer
there. A form is always tap-to-open.

These rules live in `src/server/quick-answers.ts` and are covered by
`test/unit/quick-answers.test.ts`.

### How many buttons show

The browser decides, through `Notification.maxActions`. The service worker reads
it and picks:

- every answer fits: show the answers, and nothing else. Tapping the
  notification body opens the thread anyway, so a spare slot stays empty.
- the answers do not all fit: show as many as fit beside a **More** button that
  opens the thread.
- no slots at all: no buttons; the whole notification is tap-to-open.

So a two-option question on a browser with two slots shows both answers and no
More. A three-option question on the same browser shows one answer and More.

The rule lives in `public/sw.js` and is covered by
`test/unit/sw-actions.test.ts`.

### Per-browser results

| Platform | Browser | `maxActions` | Result |
|---|---|---|---|
| Linux desktop | Firefox | to be filled in | to be filled in |
| Android | Firefox | to be filled in | to be filled in |
| Android | Chrome | 2 (documented) | 2 answers both show; 3 answers give 1 answer plus More |
| iOS | Safari | 0 (documented) | no buttons; tap opens the thread |

The rows marked "to be filled in" are measured on the real devices as part of
the cutover, not guessed. The Chrome and Safari rows come from the platform
documentation; iOS has no device here to test on. iOS also needs the app added
to the home screen before Web Push works at all.

## What a tap does

- **The body**: opens `/event/<id>`, which lands in the thread.
- **An answer button**: posts the answer straight from the service worker, with
  no window opened. If it succeeds, nothing else happens; the app shows the
  answer next time you open it.
- **More**: opens the thread.

If the answer POST comes back 401, the session on that device is gone (expired,
or signed out). The notification then opens `/login?next=/event/<id>`, so
signing in lands you back on the question instead of on the inbox. Sessions
default to 365 days, so this should be rare.

Any other failure opens the thread, so the answer is never lost silently.

## First answer wins

Two answers to one question can be in flight at once: a tap on the phone and a
tap on the desktop notification. The write is conditional on the question still
being pending, so exactly one lands. The other gets `409` with
`Question already answered.` and the stored answer is the winner's, never a mix.

The agent polling `GET /api/v1/questions/:id` sees one answer, once.

## End-to-end encryption

With an encryption key set, block content is encrypted in the browser and in the
CLI, and the hub only ever stores ciphertext.

The server therefore cannot read the options of an encrypted question, so it
cannot build answer buttons for it. **Encrypted questions are always
tap-to-open.** That is by design, not a gap: building the buttons would mean
sending the plaintext options to the server.

The answer to an encrypted question comes back as a ciphertext string rather
than an object, and the agent decrypts it with the same key.

## Clearing the inbox

"Clear read and answered" removes:

- every event you have already read, and
- every question that is answered or expired, whether or not you read it.

It keeps anything unread and any question still waiting on you. "Clear
everything" removes both.

Opening a thread marks its events read on every load, not only the first, so an
update that arrives while you are looking at the thread does not linger as
unread afterwards. A question stays unread until it is answered, which is what
keeps it in "Waiting on you".

## Why a notification did not arrive

- Priority 0: it is in the app, by design.
- Quiet hours, and priority below 2.
- Notifications are off for that device in Settings.
- The keys were rotated (`pnpm setup --rotate`), which invalidates every
  subscription. Turn notifications off and on again on each device.
- On iOS, the app is not added to the home screen.
