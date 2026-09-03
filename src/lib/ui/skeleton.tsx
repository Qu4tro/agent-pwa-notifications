// A grey block the size of the thing that is coming. Used only inside the
// content area, never as a whole-page spinner.

export function Skeleton({
  width,
  height,
  className = '',
}: {
  width?: string
  height: string
  className?: string
}) {
  return (
    <div className={`skeleton rounded-ui ${className}`} style={{ width: width ?? '100%', height }} />
  )
}
