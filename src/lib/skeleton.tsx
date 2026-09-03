// Placeholders for the content area, never for the whole page. Each one has
// the height of the row it stands in for, so the header stays put and nothing
// jumps when the data lands.

import { Container } from './shell'
import { Skeleton } from './ui'

// `detail` is how many muted lines sit under the title. A project row has one
// (the models); a task row lists what happened on its thread, so it has more.
function RowLines({ count, detail = 1 }: { count: number; detail?: number }) {
  return (
    <div className="border-t border-edge">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="border-b border-l-[3px] border-line border-l-transparent px-4 py-3">
          <Skeleton width="55%" height="17px" />
          {Array.from({ length: detail }, (_, j) => (
            <div key={j} className="mt-1">
              <Skeleton width={j === 0 ? '35%' : '48%'} height="15px" />
            </div>
          ))}
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
export function ThreadSkeleton() {
  return (
    <Container>
      <div className="mb-4 px-4">
        <Skeleton width="60%" height="22px" />
      </div>
      <div>
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="border-b border-b-line border-l-[3px] border-l-line px-4 py-3"
          >
            <Skeleton width="7rem" height="13px" />
            <div className="mt-1.5">
              <Skeleton width="70%" height="17px" />
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
