# PBlogs

A catalogue of my ongoing and completed projects. Static site, generated from Markdown,
deployed to GitHub Pages via GitHub Actions.

## Adding a new project

Create a new file in `projects/`, e.g. `projects/my-cool-project.md`:

```markdown
---
title: My Cool Project
summary: One sentence describing what it is.
date: 2026-08-08
status: ongoing        # or "completed"
tags: python, ml, cli
link: https://github.com/you/repo   # optional, omit the line if there isn't one
---

Write the full project writeup here in normal Markdown: headings, lists, code
blocks, links, images, blockquotes, task lists — all supported.
```

The filename (minus `.md`) becomes the URL slug, so `my-cool-project.md` is served at
`/projects/my-cool-project/`.

Commit and push to `main`. GitHub Actions rebuilds the whole site — the catalogue on the
home page and the project's own page — automatically. Nothing else to wire up.

## How it works

- `projects/*.md` — one file per project, the only thing you normally touch.
- `scripts/build.mjs` — a dependency-free Node script that parses the frontmatter +
  Markdown and renders fully static HTML into `_site/` using the templates in `templates/`.
- `.github/workflows/deploy.yml` — runs the build on every push to `main` and publishes
  `_site/` to GitHub Pages. No client-side fetching, no JS framework, no build tool beyond
  plain Node — pages load instantly and work with JavaScript disabled (the theme toggle and
  live search are progressive enhancements only).

## Local preview

```
npm run build   # generates _site/
npm run serve   # builds, then serves _site/ at http://localhost:8080
```

## One-time GitHub setup

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. After that, every
push to `main` deploys automatically.
