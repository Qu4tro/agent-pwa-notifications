// Placeholders for the content area, never for the whole page. Each one has
// the height of the row it stands in for, so the header stays put and nothing
// jumps when the data lands.

import { Container } from './shell'
import { Skeleton } from './ui'

function RowLines({ count }: { count: number }) {
  return (
    <div className="border-t border-line">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="border-b border-l-[3px] border-line border-l-transparent px-4 py-3">
          <Skeleton width="55%" height="17px" />
          <div className="mt-1">
            <Skeleton width="35%" height="15px" />
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

function Group({ rows }: { rows: number }) {
  return (
    <section className="mb-8">
      <Heading />
      <RowLines count={rows} />
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
      <Group rows={3} />
      <Group rows={3} />
    </Container>
  )
}

export function ThreadSkeleton() {
  return (
    <Container>
      <div className="mb-4 px-4">
        <Skeleton width="60%" height="22px" />
      </div>
      <div className="flex flex-col gap-4 px-4">
        <Skeleton height="7rem" />
        <Skeleton height="7rem" />
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
