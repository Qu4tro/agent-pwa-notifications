// Every text input in the app shares this outline. --color-edge is 3.9:1 on
// the background and 3.7:1 on the surface, so the boundary of the control is
// visible on its own, which a hairline divider colour would not be.
//
// 16px is not a taste call: iOS zooms the page into any input smaller than
// that, and the zoom does not come back out on its own.
export const fieldClass =
  'ui-field w-full rounded-ui border border-edge bg-transparent px-3 py-2.5 text-[16px] text-text'
