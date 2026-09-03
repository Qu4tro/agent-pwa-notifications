// Every read the app makes, as a query; every write, as a mutation. Keys are
// defined once here so a mutation can invalidate exactly what it changed and
// `useLiveRefresh` can attach the poll interval to the lists.

import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient, QueryFunction, QueryKey } from '@tanstack/react-query'
import { api, type EventItem, type ProjectRow, type TaskSummary, type ThreadData } from './api'

export const queryKeys = {
  config: () => ['config'] as const,
  account: () => ['account'] as const,
  projects: () => ['projects'] as const,
  tasks: (project: string) => ['tasks', project] as const,
  thread: (project: string, key: string) => ['thread', project, key] as const,
  settings: () => ['settings'] as const,
  event: (id: string) => ['event', id] as const,
}

// The queries that follow the agents: they poll while the tab is visible and
// they are what a mutation or a live message invalidates. Prefixes, so
// ['tasks'] covers every project.
export const LIVE_KEYS: ReadonlyArray<readonly string[]> = [['projects'], ['tasks'], ['thread']]

// Never changes for the life of a deploy, so it is fetched once and kept.
export const configQuery = () =>
  queryOptions({
    queryKey: queryKeys.config(),
    queryFn: () => api.config(),
    staleTime: Infinity,
    gcTime: Infinity,
  })

// The route guard reads this on every navigation, so it must not cost a
// request each time. A session that expires later surfaces as a 401 on the
// page's own query, which the QueryCache error handler turns into a redirect.
export const accountQuery = () =>
  queryOptions({ queryKey: queryKeys.account(), queryFn: () => api.account(), staleTime: Infinity })

export const projectsQuery = () =>
  queryOptions({
    queryKey: queryKeys.projects(),
    queryFn: async (): Promise<ProjectRow[]> => (await api.projects()).projects,
  })

export const tasksQuery = (project: string) =>
  queryOptions({
    queryKey: queryKeys.tasks(project),
    queryFn: async (): Promise<TaskSummary[]> => (await api.tasks(project)).tasks,
  })

export const threadQuery = (project: string, key: string) =>
  queryOptions({
    queryKey: queryKeys.thread(project, key),
    queryFn: async (): Promise<ThreadData | null> => (await api.thread(project, key)).thread ?? null,
  })

export const settingsQuery = () =>
  queryOptions({
    queryKey: queryKeys.settings(),
    queryFn: async (): Promise<{ start: number; end: number } | null> =>
      ((await api.settings()).quiet_hours as { start: number; end: number } | null) ?? null,
  })

export const eventQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.event(id),
    queryFn: async (): Promise<EventItem | null> => (await api.event(id)).event ?? null,
  })

// What every route loader calls. Cached data resolves at once and the refresh
// runs behind the rendered page; only a cold key waits for the network. A
// failed load is left to the component, which shows an inline error with a
// retry instead of an empty page.
export function ensure<TData>(
  client: QueryClient,
  options: { queryKey: QueryKey; queryFn?: QueryFunction<TData, never, never> } & Record<string, any>,
): Promise<TData | undefined> {
  const run = () => client.query(options as Parameters<QueryClient['query']>[0]) as Promise<TData>
  const cached = client.getQueryData(options.queryKey) as TData | undefined
  if (cached !== undefined) {
    void run().catch(() => undefined)
    return Promise.resolve(cached)
  }
  return run().then(
    (data) => data,
    () => undefined,
  )
}

function invalidateLists(client: QueryClient) {
  return Promise.all(LIVE_KEYS.map((key) => client.invalidateQueries({ queryKey: key })))
}

// -- Mutations --------------------------------------------------------------

// `display` is the plaintext answer for the optimistic cache write; `payload`
// is what goes on the wire, which for an E2E question is ciphertext.
export type AnswerInput = {
  eventId: string
  payload: Record<string, unknown>
  display: Record<string, unknown>
}

export function useAnswer(project: string, key: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ eventId, payload }: AnswerInput) => {
      const res = await api.answer(eventId, payload)
      if (!res.ok) throw new Error(res.error ?? 'Could not submit.')
      return res
    },
    // Settle the question in the cache before the round trip, so the buttons
    // go away the moment they are tapped.
    onMutate: async ({ eventId, display }: AnswerInput) => {
      const queryKey = queryKeys.thread(project, key)
      await client.cancelQueries({ queryKey })
      const previous = client.getQueryData<ThreadData | null>(queryKey)
      client.setQueryData<ThreadData | null>(queryKey, (thread) =>
        thread
          ? {
              ...thread,
              events: thread.events.map((e) =>
                e.id === eventId && e.question
                  ? { ...e, question: { ...e.question, status: 'answered' as const, answer: display } }
                  : e,
              ),
            }
          : thread,
      )
      return { previous, queryKey }
    },
    onError: (_error, _input, context) => {
      if (context) client.setQueryData(context.queryKey, context.previous)
    },
    onSettled: () => invalidateLists(client),
  })
}

// Answering a micro-question straight from the project list. Same endpoint as
// the thread form; the optimistic write drops the row out of "Needs you" the
// moment a button is tapped.
export function useAnswerFromList(project: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      eventId,
      answer,
    }: {
      eventId: string
      answer: Record<string, unknown>
    }) => {
      const res = await api.answer(eventId, answer)
      if (!res.ok) throw new Error(res.error ?? 'Could not submit.')
      return res
    },
    onMutate: async ({ eventId }) => {
      const queryKey = queryKeys.tasks(project)
      await client.cancelQueries({ queryKey })
      const previous = client.getQueryData<TaskSummary[]>(queryKey)
      client.setQueryData<TaskSummary[]>(queryKey, (tasks) =>
        tasks?.map((t) =>
          t.pending_event_id === eventId
            ? { ...t, pending: false, pending_event_id: null, pending_question: null, pending_answers: [] }
            : t,
        ),
      )
      return { previous, queryKey }
    },
    onError: (_error, _input, context) => {
      if (context) client.setQueryData(context.queryKey, context.previous)
    },
    onSettled: () => invalidateLists(client),
  })
}

// Note 4's Clear: the Done rows leave the list on the tap, before the round
// trip, because there is nothing to undo on the server if it fails - the write
// is idempotent and the next poll puts anything back that did not go.
export function useArchive(project: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ keys }: { keys: string[] }) => api.archive(project, keys),
    onMutate: async ({ keys }) => {
      const queryKey = queryKeys.tasks(project)
      await client.cancelQueries({ queryKey })
      const previous = client.getQueryData<TaskSummary[]>(queryKey)
      const going = new Set(keys)
      client.setQueryData<TaskSummary[]>(queryKey, (tasks) =>
        tasks?.filter((t) => !going.has(t.key)),
      )
      return { previous, queryKey }
    },
    onError: (_error, _input, context) => {
      if (context) client.setQueryData(context.queryKey, context.previous)
    },
    onSettled: () => invalidateLists(client),
  })
}

export function useMarkRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.projects() }),
        client.invalidateQueries({ queryKey: ['tasks'] }),
      ]),
  })
}

export function useMarkAllRead() {
  const client = useQueryClient()
  return useMutation({ mutationFn: () => api.markAllRead(), onSuccess: () => invalidateLists(client) })
}

export function useClear() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ scope, project }: { scope: 'read' | 'all'; project?: string | null }) =>
      api.clear(scope, project),
    onSuccess: () => invalidateLists(client),
  })
}

export function usePutSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (quiet: { start: number; end: number } | null) => {
      const offsetMin = -new Date().getTimezoneOffset()
      return api.putSettings({ quiet_hours: quiet ? { ...quiet, offsetMin } : null })
    },
    onMutate: (quiet) => {
      client.setQueryData(queryKeys.settings(), quiet)
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.settings() }),
  })
}

export function useSubscribePush() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (sub: unknown) => api.subscribePush(sub),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.settings() }),
  })
}

export function useUnsubscribePush() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (endpoint: string) => api.unsubscribePush(endpoint),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.settings() }),
  })
}
