// Service worker: receive Web Push, show the notification, and deep-link into
// the relevant event when tapped. Deliberately tiny: no offline caching (the
// app needs the network to be useful anyway).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function actionsForNotification(data) {
  const reportedMax = Number(self.Notification && self.Notification.maxActions)
  const max = Number.isFinite(reportedMax) ? Math.max(0, reportedMax) : 0
  if (max === 0) return []

  const quickAnswers = Array.isArray(data.quickAnswers) ? data.quickAnswers : []
  const answers = quickAnswers
    .filter((item) => item && typeof item.action === 'string' && typeof item.title === 'string')
    .map(({ action, title }) => ({ action, title }))

  // Every answer fits: show only the answers. A spare slot buys nothing, since
  // tapping the notification body already opens the thread.
  if (answers.length <= max) return answers
  // Too many: keep as many answers as fit beside a "More" that opens the thread.
  return [...answers.slice(0, max - 1), { action: 'more', title: 'More' }]
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
  const actions = isQuestion ? actionsForNotification(data) : []
  const options = {
    body: data.body || '',
    tag: data.tag || data.eventId || 'agent-notifications',
    data: {
      url: data.eventId ? `/event/${data.eventId}` : '/',
      eventId: data.eventId,
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  event.waitUntil(
    (async () => {
      const quickAnswers = Array.isArray(data.quickAnswers) ? data.quickAnswers : []
      const selected = quickAnswers.find((item) => item && item.action === event.action)
      if (selected && data.eventId && selected.answer) {
        try {
          const answerUrl = new URL(
            `/api/v1/questions/${encodeURIComponent(data.eventId)}/answer`,
            self.location.origin,
          )
          const response = await fetch(answerUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(selected.answer),
          })
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
