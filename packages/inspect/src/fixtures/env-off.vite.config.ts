import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default { envDir: false, root: dirname(fileURLToPath(import.meta.url)) };
