#!/usr/bin/env node
// Static site generator for PBlogs.
// Reads projects/*.md (frontmatter + markdown), renders them against the
// templates in templates/, and writes fully static HTML into the repo root
// and projects/<slug>/index.html. No dependencies, no server, no client-side
// fetching of markdown at runtime.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT, "projects");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const OUT_DIR = path.join(ROOT, "_site");

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Frontmatter parsing -----------------------------------------------

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const [, fmBlock, content] = match;
  const data = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return { data, content };
}

// --- Minimal markdown -> HTML -------------------------------------------

function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let paragraph = [];
  let listType = null; // 'ul' | 'ol'

  function flushParagraph() {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  }
  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      flushParagraph();
      closeList();
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph();
      closeList();
      html.push("<hr>");
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushParagraph();
      closeList();
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote><p>${renderInline(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    // task list / unordered list
    const taskItem = line.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    const ulItem = line.match(/^\s*[-*]\s+(.*)$/);
    const olItem = line.match(/^\s*\d+\.\s+(.*)$/);

    if (taskItem) {
      flushParagraph();
      if (listType !== "ul") { closeList(); html.push("<ul class=\"task-list\">"); listType = "ul"; }
      const checked = /x/i.test(taskItem[1]);
      html.push(`<li class="task-item"><input type="checkbox" disabled ${checked ? "checked" : ""}> ${renderInline(taskItem[2])}</li>`);
      i++;
      continue;
    }
    if (ulItem) {
      flushParagraph();
      if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
      html.push(`<li>${renderInline(ulItem[1])}</li>`);
      i++;
      continue;
    }
    if (olItem) {
      flushParagraph();
      if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
      html.push(`<li>${renderInline(olItem[1])}</li>`);
      i++;
      continue;
    }

    // blank line
    if (!line.trim()) {
      flushParagraph();
      closeList();
      i++;
      continue;
    }

    // continuation of the previous list item (a wrapped line with no bullet)
    if (listType) {
      const lastIndex = html.length - 1;
      const lastLine = html[lastIndex];
      if (lastLine && lastLine.endsWith("</li>")) {
        html[lastIndex] = lastLine.slice(0, -5) + " " + renderInline(line.trim()) + "</li>";
        i++;
        continue;
      }
    }

    // paragraph text
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  closeList();
  return html.join("\n");
}

// --- Data loading ---------------------------------------------------------

function slugify(filename) {
  return filename.replace(/\.md$/, "");
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function loadProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const files = readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".md"));
  const projects = files.map((file) => {
    const raw = readFileSync(path.join(PROJECTS_DIR, file), "utf8");
    const { data, content } = parseFrontmatter(raw);
    const slug = slugify(file);
    const status = (data.status || "ongoing").toLowerCase();
    const tags = (data.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      slug,
      title: data.title || slug,
      summary: data.summary || "",
      date: data.date || "",
      status: status === "completed" ? "completed" : "ongoing",
      tags,
      link: data.link || "",
      contentHtml: markdownToHtml(content),
    };
  });
  projects.sort((a, b) => (a.date < b.date ? 1 : -1));
  return projects;
}

// --- Rendering --------------------------------------------------------

function renderTagsHtml(tags) {
  if (!tags.length) return "";
  return `<ul class="tags" aria-label="Tags">${tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
}

function renderCard(project) {
  const tagsHtml = project.tags.length
    ? `<ul class="tags">${project.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
    : "";
  return `      <a class="card" href="projects/${project.slug}/" data-status="${project.status}" data-search="${escapeHtml((project.title + " " + project.tags.join(" ")).toLowerCase())}">
        <div class="card-top">
          <span class="badge badge-${project.status}">${project.status === "completed" ? "Completed" : "Ongoing"}</span>
          <time datetime="${project.date}">${formatDate(project.date)}</time>
        </div>
        <h2>${escapeHtml(project.title)}</h2>
        <p>${escapeHtml(project.summary)}</p>
        ${tagsHtml}
      </a>`;
}

function buildIndex(projects) {
  const template = readFileSync(path.join(TEMPLATES_DIR, "index.template.html"), "utf8");
  const cards = projects.map(renderCard).join("\n");
  const ongoing = projects.filter((p) => p.status === "ongoing").length;
  const completed = projects.filter((p) => p.status === "completed").length;
  const out = template
    .replace("{{PROJECT_CARDS}}", cards)
    .replace("{{COUNT_ALL}}", String(projects.length))
    .replace("{{COUNT_ONGOING}}", String(ongoing))
    .replace("{{COUNT_COMPLETED}}", String(completed))
    .replace("{{BUILD_DATE}}", formatDate(new Date().toISOString()));
  writeFileSync(path.join(OUT_DIR, "index.html"), out);
}

function buildProjectPage(project) {
  const template = readFileSync(path.join(TEMPLATES_DIR, "project.template.html"), "utf8");
  const linkHtml = project.link
    ? `<a class="project-link" href="${project.link}" target="_blank" rel="noopener noreferrer">View project ↗</a>`
    : "";
  const out = template
    .replace(/{{TITLE}}/g, escapeHtml(project.title))
    .replace(/{{SUMMARY}}/g, escapeHtml(project.summary))
    .replace("{{STATUS_CLASS}}", project.status)
    .replace("{{STATUS_LABEL}}", project.status === "completed" ? "Completed" : "Ongoing")
    .replace("{{DATE_ISO}}", project.date)
    .replace("{{DATE_DISPLAY}}", formatDate(project.date))
    .replace("{{TAGS_HTML}}", renderTagsHtml(project.tags))
    .replace("{{LINK_HTML}}", linkHtml)
    .replace("{{CONTENT_HTML}}", project.contentHtml);

  const dir = path.join(OUT_DIR, "projects", project.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), out);
}

function copyStaticAssets() {
  const files = ["style.css", "script.js", "404.html"];
  for (const file of files) {
    const src = path.join(ROOT, file);
    if (existsSync(src)) copyFileSync(src, path.join(OUT_DIR, file));
  }
}

function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  copyStaticAssets();
  const projects = loadProjects();
  buildIndex(projects);
  for (const project of projects) buildProjectPage(project);
  console.log(`Built ${projects.length} project page(s) into _site/`);
}

main();
