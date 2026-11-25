/**
 * Options for a page whose link names the walk to open: `?machine=&step=&run=&payload=&focus=` (and old `?value=` links). The viewer never writes the address, so a reload opens what the link names (`linkOptions`).
 */
import type { ViewerOptions } from "./embed.ts";
import "./viewer.css";

/** Options that open the walk the address bar names. */
export function linkOptions(): ViewerOptions {
  const params = new URLSearchParams(location.search);
  const machine = params.get("machine");
  const run = params.get("run");
  return {
    ...(machine === null ? {} : { machine }),
    ...(machine !== null && run !== null ? { run } : {}),
    steps: params.getAll("step"),
    payloads: params.getAll("payload"),
    values: params.getAll("value"),
    focus: params.getAll("focus"),
  };
}
