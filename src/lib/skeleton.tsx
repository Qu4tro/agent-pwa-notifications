// Placeholders for the content area, never for the whole page. Each one has
// the height of the row it stands in for, so the header stays put and nothing
// jumps when the data lands.

import { Container } from './shell'

export function Skeleton({ width, height, radius }: { width?: string; height: string; radius?: string }) {
  return (
    <div
      className="skeleton"
      style={{ width: width ?? '100%', height, borderRadius: radius ?? '0.4rem' }}
    />
  )
}

function Card({ height }: { height: string }) {
  return (
    <div
      className="skeleton"
      style={{ height, borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
    />
  )
}

function Rows({ count, height }: { count: number; height: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} height={height} />
      ))}
    </div>
  )
}

function Heading() {
  return (
    <div style={{ margin: '0 0 0.7rem' }}>
      <Skeleton width="7rem" height="0.72rem" />
    </div>
  )
}

export function ProjectsSkeleton() {
  return (
    <Container>
      <section style={{ marginBottom: '1.6rem' }}>
        <Heading />
        <Rows count={4} height="4.6rem" />
      </section>
    </Container>
  )
}

export function TasksSkeleton() {
  return (
    <Container>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.2rem' }}>
        <Skeleton width="0.7rem" height="0.7rem" radius="999px" />
        <Skeleton width="11rem" height="1.4rem" />
      </div>
      <section style={{ marginBottom: '1.6rem' }}>
        <Heading />
        <Rows count={3} height="6rem" />
      </section>
    </Container>
  )
}

export function ThreadSkeleton() {
  return (
    <Container>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
        <Skeleton width="0.6rem" height="0.6rem" radius="999px" />
        <Skeleton width="6rem" height="0.8rem" />
      </div>
      <div style={{ margin: '0 0 1.3rem' }}>
        <Skeleton width="60%" height="1.4rem" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <Card height="9rem" />
        <Card height="9rem" />
      </div>
    </Container>
  )
}

export function SettingsSkeleton() {
  return (
    <Container>
      <div style={{ margin: '0 0 1.5rem' }}>
        <Skeleton width="6rem" height="1.4rem" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Card height="9rem" />
        <Card height="9rem" />
        <Card height="9rem" />
      </div>
    </Container>
  )
}
