// A count in a pill. Two of these exist and they are one shape: the count on
// the bell in the header, filled in the question colour, which means "waiting
// on you"; and the count on a project row, filled in the line colour, which
// means "new". Same size, same corners, same digits, so the eye learns one
// thing and reads the fill. The fill is the caller's, because the fill is the
// meaning.
//
// The row's fill is --color-line and not --color-surface, because a row
// paints --color-surface under itself on hover and the pill would vanish into
// it. Tabular digits, so a row with 9 and a row with 10 do not wobble.
export const badgeClass =
  'min-w-[1.1rem] rounded-full px-1 text-center text-[12px] leading-[1.1rem] font-semibold tabular-nums'
