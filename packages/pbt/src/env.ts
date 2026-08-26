/** Boot-time environment for @mantaq/pbt — the only module that reads process.env. */
export const seedEnvironment: string | undefined = process.env["MANTAQ_SEED"];
