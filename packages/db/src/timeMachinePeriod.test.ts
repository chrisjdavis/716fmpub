import { describe, expect, it } from "vitest";
import {
  nextUtcCalendarMonthYyyMm,
  parseTimeMachineMonthYyyMm,
  previousUtcCalendarMonthYyyMm,
  sameUtcCalendarMonthOneYearPriorYyyMm,
  utcCalendarMonthBoundsIso,
  utcCalendarYearStartYmdFromMonthYyyMm,
} from "./timeMachinePeriod.js";

describe("parseTimeMachineMonthYyyMm", () => {
  it("accepts valid months", () => {
    expect(parseTimeMachineMonthYyyMm("2017-03")).toBe("2017-03");
    expect(parseTimeMachineMonthYyyMm(" 2000-12 ")).toBe("2000-12");
  });

  it("rejects invalid", () => {
    expect(parseTimeMachineMonthYyyMm(null)).toBeNull();
    expect(parseTimeMachineMonthYyyMm("2017-13")).toBeNull();
    expect(parseTimeMachineMonthYyyMm("17-03")).toBeNull();
    expect(parseTimeMachineMonthYyyMm("2017-3")).toBeNull();
  });
});

describe("utcCalendarMonthBoundsIso", () => {
  it("returns half-open UTC window", () => {
    const b = utcCalendarMonthBoundsIso("2017-03");
    expect(b).not.toBeNull();
    expect(b!.gteIso).toBe("2017-03-01T00:00:00.000Z");
    expect(b!.ltExclusiveIso).toBe("2017-04-01T00:00:00.000Z");
  });
});

describe("nextUtcCalendarMonthYyyMm", () => {
  it("steps forward one month", () => {
    expect(nextUtcCalendarMonthYyyMm("2017-04")).toBe("2017-05");
  });

  it("steps across year boundary", () => {
    expect(nextUtcCalendarMonthYyyMm("2017-12")).toBe("2018-01");
  });
});

describe("previousUtcCalendarMonthYyyMm", () => {
  it("steps back across year boundary", () => {
    expect(previousUtcCalendarMonthYyyMm("2017-01")).toBe("2016-12");
  });

  it("returns null before 1970-01", () => {
    expect(previousUtcCalendarMonthYyyMm("1970-01")).toBeNull();
  });
});

describe("sameUtcCalendarMonthOneYearPriorYyyMm", () => {
  it("steps back one year", () => {
    expect(sameUtcCalendarMonthOneYearPriorYyyMm("2017-04")).toBe("2016-04");
  });

  it("returns null before 1970", () => {
    expect(sameUtcCalendarMonthOneYearPriorYyyMm("1970-06")).toBeNull();
  });
});

describe("utcCalendarYearStartYmdFromMonthYyyMm", () => {
  it("returns january first for the month’s year", () => {
    expect(utcCalendarYearStartYmdFromMonthYyyMm("2017-11")).toBe("2017-01-01");
  });
});
