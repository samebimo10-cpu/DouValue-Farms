// Move the wall clock, so a test that quietly depends on today's date says so.
//
// A screen like the end-of-shift board takes no date: the day it is about is
// the day the person is standing in, so it reads the clock itself. A test that
// pins its fixture to a literal date therefore agrees with that screen on the
// day it is written and on no day afterwards — and the failure lands weeks or
// months later, on a commit nobody touched, which is the worst possible moment
// to be reading it.
//
// This is loaded with `node --import` ahead of the suite. It shifts `new Date()`
// and `Date.now()` forward by FAKE_CLOCK_DAYS and leaves every other use of
// Date alone, so a fixture built from an explicit string still means what it
// says while anything reading "now" moves.
//
// Run by scripts/test-clock-offsets.mjs. Nothing in web/ or server/ imports it.

const days = Number(process.env.FAKE_CLOCK_DAYS || 0);
const offset = days * 86400000;

if (offset) {
  const Real = Date;
  class ShiftedDate extends Real {
    constructor(...args) {
      // Only a bare `new Date()` means "now". Everything else is a date the
      // caller named, and naming it is exactly what we must not interfere with.
      if (args.length === 0) super(Real.now() + offset);
      else super(...args);
    }

    static now() { return Real.now() + offset; }
  }
  ShiftedDate.parse = Real.parse;
  ShiftedDate.UTC = Real.UTC;
  globalThis.Date = ShiftedDate;
}
