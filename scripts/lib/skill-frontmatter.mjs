import { parseDocument } from "yaml";

/** Returns the problems found in a SKILL.md frontmatter block (empty when valid). */
export function checkFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(source);
  if (match === null) return ["no frontmatter block"];
  const doc = parseDocument(match[1], { prettyErrors: true });
  if (doc.errors.length > 0) return doc.errors.map((error) => `YAML: ${error.message}`);
  const data = doc.toJS();
  const problems = [];
  for (const key of ["name", "description"]) {
    if (typeof data?.[key] !== "string" || data[key].trim() === "") {
      problems.push(`frontmatter '${key}' must be a non-empty string`);
    }
  }
  return problems;
}
