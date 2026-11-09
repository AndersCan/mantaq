/** 1-based line numbers in `after` that are not in the longest common run of lines with `before`. */
export function addedLines(before: string, after: string): number[] {
  const a = before.split("\n").map((line) => line.trimEnd());
  const b = after.split("\n").map((line) => line.trimEnd());
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const added: number[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      added.push(j + 1);
      j++;
    }
  }
  return added;
}
