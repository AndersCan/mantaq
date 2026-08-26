import { Either } from "@mantaq/utils";

export const SEED_ENV = "MANTAQ_SEED";

export const DEFAULT_SEED = 0x1a51e;

export interface SeedError {
  readonly kind: "invalid-seed";
  readonly raw: string;
  readonly message: string;
}

export function parseSeed(raw: string | undefined): Either<SeedError, number> {
  if (raw === undefined || raw === "") return Either.right(DEFAULT_SEED);
  const parsedSeed = Number(raw);
  if (!Number.isInteger(parsedSeed)) {
    return Either.left<SeedError>({
      kind: "invalid-seed",
      raw,
      message: `MANTAQ_SEED must be an integer, got ${JSON.stringify(raw)}`,
    });
  }
  return Either.right(parsedSeed);
}
