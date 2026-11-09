export interface BannerFinding {
  machine: string;
  title: string;
  state: string | null;
  event: string | null;
  note?: boolean;
}

const LIMIT = 6;

const unique = (items: string[]) => [...new Set(items)];
const names = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function bannerParts(findings: BannerFinding[]) {
  const bugs = findings.filter((f) => !f.note);
  return {
    count: bugs.length,
    machines: names(unique(bugs.map((f) => f.machine))),
    shown: bugs.slice(0, LIMIT).map((f) => f.title),
    more: bugs.length > LIMIT ? `; and ${bugs.length - LIMIT} more` : "",
  };
}
