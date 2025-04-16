import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import slugify from "slugify";
import sqlite from "sqlite3";
import render from "./render.js";

const CALIBRE_DIR = path.join(homedir(), "calibre");

const all = async (query, db) =>
  new Promise((resolve, reject) => {
    db.all(query, (err, rows) => {
      if (err) {
        reject(err);
      } else resolve(rows);
    });
  });

const main = async () => {
  const db = new sqlite.Database(path.join(CALIBRE_DIR, "metadata.db"));

  const authors = new Map();
  const seriesIDs = new Map();
  const series = new Map();

  await all("SELECT id,name FROM authors", db).then((rows) => {
    rows.forEach(({ id, name }) => {
      authors.set(id, { name, slug: slugify(name).toLowerCase() });
    });
  });

  await all("SELECT id,name FROM series", db).then((rows) => {
    rows.forEach(({ id, name }) => {
      const hierarchy = name.split(".");
      seriesIDs.set(id, hierarchy);
      hierarchy.forEach((name, i) => {
        series.set(name, {
          name,
          parent: i > 0 ? hierarchy[i - 1] : false,
          slug: slugify(name).toLowerCase(),
          leaf: i === hierarchy.length - 1,
        });
      });
    });
  });

  const authorLinks = new Map();
  const seriesLinks = new Map();

  await all("SELECT book,author FROM books_authors_link", db).then((rows) => {
    rows.forEach(({ book, author }) => {
      authorLinks.set(book, authors.get(author));
    });
  });

  await all("SELECT book,series as s FROM books_series_link", db).then(
    (rows) => {
      rows.forEach(({ book, s }) => {
        seriesLinks.set(book, seriesIDs.get(s));
      });
    }
  );

  const books = await all(
    "SELECT id,title,series_index as i,path FROM books",
    db
  ).then((rows) =>
    rows.map(({ id, title, i, path: bookPath }) => {
      const coverPath = path.join(CALIBRE_DIR, bookPath, "cover.jpg");

      const author = authorLinks.get(id);
      const seriesList = seriesLinks.get(id) ?? [];

      const book = {
        id,
        title,
        slug: slugify(title).toLowerCase(),
        i,
        coverPath,
        author,
        series: seriesList.map((name) => series.get(name)),
      };

      return book;
    })
  );

  await Promise.all(
    books.map(({ id, coverPath }) => {
      return fs.copyFile(coverPath, path.join("docs/covers", `${id}.jpg`));
    })
  );

  books.sort(({ title: a }, { title: b }) => {
    const titleA = a.replace(/^(a|an|the) /i, "").toLowerCase();
    const titleB = b.replace(/^(a|an|the) /i, "").toLowerCase();

    if (titleA > titleB) {
      return 1;
    }
    if (titleA < titleB) {
      return -1;
    }
    return 0;
  });

  const seriesTree = Array.from(
    series.values().filter(({ parent }) => !parent)
  );

  const alphaSort = ({ name: a }, { name: b }) => {
    if (a > b) {
      return 1;
    }
    if (a < b) {
      return -1;
    }
    return 0;
  };
  seriesTree.sort(alphaSort);

  const queue = [...seriesTree];
  while (queue.length) {
    const parentSeries = queue.shift();
    parentSeries.children = Array.from(
      series.values().filter(({ parent }) => parent === parentSeries.name)
    );
    parentSeries.children.sort(alphaSort);
    queue.push(...parentSeries.children);
  }

  await fs.writeFile(
    "./docs/index.html",
    await render({ books, authors, seriesTree })
  );

  await Promise.all(
    authors.values().map(async (author) => {
      const authorBooks = books.filter(
        ({ author: { name } }) => name === author.name
      );

      await fs.writeFile(
        `./docs/author--${author.slug}.html`,
        await render({ books: authorBooks, authors, seriesTree })
      );
    })
  );

  const containerSeries = series.values().filter(({ leaf }) => !leaf);
  await Promise.all(
    containerSeries.map(async (series) => {
      const seriesBooks = books.filter(({ series: bookSeries }) => {
        return bookSeries.some(({ name }) => name === series.name);
      });

      await fs.writeFile(
        `./docs/series--${series.slug}.html`,
        await render({ books: seriesBooks, authors, seriesTree })
      );
    })
  );

  const leafSeries = series.values().filter(({ leaf }) => leaf);
  await Promise.all(
    leafSeries.map(async (series) => {
      const seriesBooks = books.filter(({ series: bookSeries }) => {
        return bookSeries.some(({ name }) => name === series.name);
      });
      seriesBooks.sort(({ i: a }, { i: b }) => a - b);

      await fs.writeFile(
        `./docs/series--${series.slug}.html`,
        await render({ books: seriesBooks, authors, seriesTree, ordered: true })
      );
    })
  );

  await db.close();
};

main();
