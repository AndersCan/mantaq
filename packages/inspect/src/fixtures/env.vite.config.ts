import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default { envDir: dirname(fileURLToPath(import.meta.url)) };
