/** Shared interaction states so every control focuses and disables the same way. */

/** Inset focus ring: visible on keyboard focus, never shifting layout. */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/** Disabled controls drop to 64 percent opacity and stop taking pointer events. */
export const disabledState = 'disabled:pointer-events-none disabled:opacity-64';
