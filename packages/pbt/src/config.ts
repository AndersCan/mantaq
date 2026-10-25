import { seedEnvironment } from "./env.ts";
import { parseSeed } from "./parse-seed.ts";
import { Either } from "@mantaq/utils";
import fc from "fast-check";

const seedResult = parseSeed(seedEnvironment);

export const seedError = Either.getLeft(seedResult);

const globalConfig = { numRuns: 100, endOnFailure: true, verbose: 1 };

const validSeed = Either.getRight(seedResult);
fc.configureGlobal(validSeed === undefined ? globalConfig : { seed: validSeed, ...globalConfig });
