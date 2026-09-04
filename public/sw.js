// Service worker: receive Web Push, show the notification, and deep-link into
// the relevant event when tapped. Deliberately tiny: no offline caching (the
// app needs the network to be useful anyway).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Reply takes a slot whenever one is free, so a question with no options - a
// form, or one too long for a notification - can still be answered in words on
// a browser that types into a notification. A browser without inline text shows
// it as a plain button, and the click opens the thread.
const REPLY_ACTION = {
  action: 'reply',
  type: 'text',
  title: 'Reply',
  placeholder: 'Your answer',
}

function actionsForNotification(data) {
  // The worker holds no encryption key, so it can neither show the options of
  // an encrypted question nor send words for one.
  if (data.kind !== 'question' || data.encrypted) return []

  const reportedMax = Number(self.Notification && self.Notification.maxActions)
  const max = Number.isFinite(reportedMax) ? Math.max(0, reportedMax) : 0
  if (max === 0) return []

  const quickAnswers = Array.isArray(data.quickAnswers) ? data.quickAnswers : []
  const answers = quickAnswers
    .filter((item) => item && typeof item.action === 'string' && typeof item.title === 'string')
    .map(({ action, title }) => ({ action, title }))

  // Every answer fits with room over: the spare slot goes to Reply.
  if (answers.length < max) return [...answers, REPLY_ACTION]
  // The answers fill the slots: they are the question, and the body tap still
  // opens the app, where words are always possible.
  if (answers.length === max) return answers
  // Too many: keep as many answers as fit beside Reply.
  return [...answers.slice(0, max - 1), REPLY_ACTION]
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'Agent Notifications', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Agent Notifications'
  const isQuestion = data.kind === 'question'
  const actions = actionsForNotification(data)
  const options = {
    body: data.body || '',
    tag: data.tag || data.eventId || 'agent-notifications',
    data: {
      url: data.eventId ? `/event/${data.eventId}` : '/',
      eventId: data.eventId,
      kind: data.kind,
      encrypted: data.encrypted === true,
      quickAnswers: data.quickAnswers,
    },
    icon: '/icon-192.png',
    badge: '/badge.png',
    requireInteraction: isQuestion || data.priority >= 2,
    vibrate: isQuestion ? [80, 40, 80] : [40],
  }
  if (actions.length > 0) options.actions = actions
  event.waitUntil(self.registration.showNotification(title, options))
})

async function openNotificationTarget(path) {
  const url = new URL(path || '/', self.location.origin).href
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of list) {
    try {
      const navigated = await client.navigate(url)
      if (navigated) return navigated.focus()
    } catch {
      // Try another controlled window, then fall back to opening one.
    }
  }
  return self.clients.openWindow(url)
}

// Every answer from a notification carries `if_pending`, so it lands only on a
// question that is still waiting. An answer given elsewhere in the meantime
// stands, and the tap opens the thread instead of overwriting it.
async function sendAnswer(eventId, body) {
  const answerUrl = new URL(
    `/api/v1/questions/${encodeURIComponent(eventId)}/answer`,
    self.location.origin,
  )
  return fetch(answerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ ...body, if_pending: true }),
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  event.waitUntil(
    (async () => {
      const quickAnswers = Array.isArray(data.quickAnswers) ? data.quickAnswers : []
      const selected = quickAnswers.find((item) => item && item.action === event.action)
      const typed = typeof event.reply === 'string' ? event.reply.trim() : ''
      const body =
        event.action === 'reply' && typed
          ? { text: typed }
          : selected && selected.answer
            ? { answer: selected.answer }
            : null

      if (body && data.eventId) {
        try {
          const response = await sendAnswer(data.eventId, body)
          if (response.ok) return
          // The session is gone (expired, or logged out on this device). Send
          // the human to the login page and back to the question afterwards,
          // instead of a silent redirect loop through the thread.
          if (response.status === 401) {
            return openNotificationTarget(
              `/login?next=${encodeURIComponent(data.url || `/event/${data.eventId}`)}`,
            )
          }
        } catch {
          // Open the question so the answer is not lost silently.
        }
      }
      return openNotificationTarget(data.url)
    })(),
  )
})
