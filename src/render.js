import fs from "node:fs/promises";
import path from "node:path";
import handlebars from "handlebars";

await fs
  .readFile(
    path.join(import.meta.dirname, "series-list-item.html.handlebars"),
    {
      encoding: "utf-8",
    }
  )
  .then((template) => handlebars.registerPartial("series-list-item", template));

const render = await fs
  .readFile(path.join(import.meta.dirname, "page.html.handlebars"), {
    encoding: "utf-8",
  })
  .then((template) => handlebars.compile(template));

export default async ({ books, authors, seriesTree, ordered = false }) => {
  return render({
    books,
    authors: authors.values(),
    series: seriesTree,
    ordered,
  });
};
