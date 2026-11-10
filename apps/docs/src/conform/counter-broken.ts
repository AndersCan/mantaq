export function createCounter(max: number) {
  let count = 0;
  return {
    increment: () => {
      if (count <= max) count += 1;
    },
    decrement: () => {
      if (count > 0) count -= 1;
    },
    reset: () => {
      count = 0;
    },
    get count() {
      return count;
    },
  };
}
