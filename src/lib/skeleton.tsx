// Placeholders for the content area, never for the whole page. Each one has
// the height of the row it stands in for, so the header stays put and nothing
// jumps when the data lands.

import { Container } from './shell'
import { Skeleton } from './ui'

// `detail` is how many muted lines sit under the title. A project row has one
// (the models); a task row lists what happened on its thread, so it has more.
// The 56px time gutter is left empty and kept, so nothing shifts sideways when
// the rows arrive.
function RowLines({ count, detail = 1 }: { count: number; detail?: number }) {
  return (
    <div className="border-t border-edge">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex border-b border-line">
          <div className="w-14 shrink-0 py-3 pr-1.5 pl-4">
            <Skeleton width="100%" height="13px" />
          </div>
          <div className="min-w-0 flex-1 border-l-[3px] border-l-transparent py-3 pr-4 pl-2.5">
            <Skeleton width="55%" height="17px" />
            {Array.from({ length: detail }, (_, j) => (
              <div key={j} className="mt-1">
                <Skeleton width={j === 0 ? '35%' : '48%'} height="15px" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Heading() {
  return (
    <div className="mb-1.5 px-4">
      <Skeleton width="6rem" height="14px" />
    </div>
  )
}

function Group({ rows, detail = 1 }: { rows: number; detail?: number }) {
  return (
    <section className="mb-8">
      <Heading />
      <RowLines count={rows} detail={detail} />
    </section>
  )
}

export function ProjectsSkeleton() {
  return (
    <Container>
      <Group rows={2} />
      <Group rows={6} />
    </Container>
  )
}

export function TasksSkeleton() {
  return (
    <Container>
      <div className="mb-4 px-4">
        <Skeleton width="10rem" height="22px" />
      </div>
      <Group rows={3} detail={3} />
      <Group rows={3} detail={3} />
    </Container>
  )
}

// A thread arrives as a list of message summaries, most of them shut, so the
// placeholder is a list of rows - not the two tall blocks that stood in for
// messages back when every one of them was open.
// The pending page is a single list of question rows, each with its answer
// buttons hanging under it.
export function PendingSkeleton() {
  return (
    <Container>
      <div className="mb-4 px-4">
        <Skeleton width="8rem" height="22px" />
      </div>
      <Group rows={3} detail={1} />
    </Container>
  )
}

export function ThreadSkeleton() {
  return (
    <Container>
      <div className="mb-4 px-4">
        <Skeleton width="60%" height="22px" />
      </div>
      <div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex border-b border-b-line">
            <div className="w-14 shrink-0 pt-3 pr-1.5 pl-4">
              <Skeleton width="100%" height="13px" />
            </div>
            <div className="min-w-0 flex-1 border-l-[3px] border-l-line py-3 pr-4 pl-2.5">
              <Skeleton width="7rem" height="13px" />
              <div className="mt-1.5">
                <Skeleton width="70%" height="17px" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Container>
  )
}

export function SettingsSkeleton() {
  return (
    <Container>
      <div className="mb-5 px-4">
        <Skeleton width="6rem" height="22px" />
      </div>
      <div className="flex flex-col gap-8 px-4">
        <Skeleton height="5rem" />
        <Skeleton height="5rem" />
        <Skeleton height="5rem" />
      </div>
    </Container>
  )
}

// The live mode is one card in the middle of the screen, so its placeholder is
// one card in the middle of the screen.
export function LiveSkeleton() {
  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100svh-3.25rem)] w-full max-w-[44rem] flex-col justify-center px-4 py-6">
      <div className="rounded-ui border border-edge bg-surface p-5">
        <Skeleton width="8rem" height="15px" />
        <div className="mt-2">
          <Skeleton width="75%" height="22px" />
        </div>
        <div className="mt-4">
          <Skeleton height="4rem" />
        </div>
        <div className="mt-4">
          <Skeleton width="12rem" height="44px" />
        </div>
      </div>
    </main>
  )
}
