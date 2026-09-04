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

Anything else has no buttons of its own: a form question, or one with more
options than a notification can hold. It still takes an answer here, in words,
through **Reply**.

These rules live in `src/server/quick-answers.ts` and are covered by
`test/unit/quick-answers.test.ts`.

### Reply

**Reply** is a text action: on a browser that types into a notification you
write your answer in the shade and send it, and the question is answered
without the app ever opening. On a browser that does not, it is a plain button
that opens the thread.

An encrypted question never gets one. The service worker holds no encryption
key, so it can neither show the options nor send the words.

### How many buttons show

The browser decides, through `Notification.maxActions`. The service worker reads
it and picks:

- a slot is free after the answers: the answers, then **Reply**.
- the answers fill the slots exactly: the answers alone. They are the question,
  and tapping the notification body already leads to words.
- the answers do not all fit: as many as fit, then **Reply**.
- no slots at all: no buttons; the whole notification is tap-to-open.

So a two-option question on a browser with two slots shows both answers and
nothing else. A three-option question on the same browser shows one answer and
Reply. A form question shows Reply on its own.

The rule lives in `public/sw.js` and is covered by
`test/unit/sw-actions.test.ts`.

### Per-browser results

| Platform | Browser | `maxActions` | Result | Reply |
|---|---|---|---|---|
| Linux desktop | Firefox 154 | 2 | measured: 2 answers both show; 3 answers give the first answer plus Reply | a plain button that opens the thread |
| Android | Firefox | to be measured | to be measured | to be measured |
| Android | Chrome | 2 (documented) | 2 answers both show; 3 answers give 1 answer plus Reply | types into the notification |
| iOS | Safari | 0 (documented) | no buttons; tap opens the thread | none |

The desktop row was measured on the device: `Notification.maxActions` read in
the browser, then a two-option and a three-option question posted from the CLI.
The two-option notification showed both answers; clicking one answered the
question and the waiting agent received the choice. The three-option
notification showed one answer beside a second action; that action opened the
thread in the app and left the question pending, and answering there reached
the agent just the same.

The Android row is measured on the phone the same way. The Chrome and Safari
rows come from the platform documentation; there is no device here to test them
on. iOS also needs the app added to the home screen before Web Push works at
all.

## What a tap does

- **The body**: opens `/event/<id>`, which lands in the thread.
- **An answer button**: posts the answer straight from the service worker, with
  no window opened. If it succeeds, nothing else happens; the app shows the
  answer next time you open it.
- **Reply, with words typed in**: posts them the same way, and opens nothing.
- **Reply, on a browser that shows it as a plain button**: opens the thread,
  where the answer line takes the words.

If the answer POST comes back 401, the session on that device is gone (expired,
or signed out). The notification then opens `/login?next=/event/<id>`, so
signing in lands you back on the question instead of on the inbox. Sessions
default to 365 days, so this should be rare.

Any other failure opens the thread, so the answer is never lost silently. Words
typed into a Reply that arrives too late are not carried into the thread it
opens; you type them again.

## Which answer counts

The latest answer is the answer. In the app you can change one after giving it:
tap a different option, or edit the words and send. The agent learns that it
moved, and the newest document is what it reads.

An answer from a notification is different: it lands only on a question that is
still waiting. Two of them can be in flight at once - a tap on the phone and a
tap on the desktop notification - and exactly one lands; the other gets `409`
with `Question already answered.` and opens the thread, where the answer can be
changed deliberately. A stored answer is never a mix of two bodies.

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
