import fc from "fast-check";

export const anyName = fc.stringMatching(/^[a-z0-9]{1,12}$/);

export const anyDuration = fc.integer({ min: 0, max: 10_000 });

export const anySmallDuration = fc.integer({ min: 0, max: 100 });

export const anyPayload = fc.jsonValue();
