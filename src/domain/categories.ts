import type { Category } from "./models";

const categoryCollator = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  usage: "sort",
});
const deterministicCollator = new Intl.Collator("pt-BR", {
  sensitivity: "variant",
  usage: "sort",
});

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(
    (left, right) =>
      categoryCollator.compare(left.name, right.name) ||
      deterministicCollator.compare(left.name, right.name) ||
      left.id.localeCompare(right.id),
  );
}
