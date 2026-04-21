#!/usr/bin/env python3
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
CONTENT_DIR = ROOT / "content"
OUTPUT_DIR = ROOT / "output"
DOCS_DIR = ROOT / "docs"
ARCHIVE_DIR = DOCS_DIR / "archive"
POSTS_DIR = ARCHIVE_DIR / "posts"

TEXT_EXTENSIONS = {".md", ".markdown", ".rst", ".txt", ".adoc", ".asciidoc"}
EXCLUDED_CONTENT_DIRS = {"images", "pages", "static", "drafts"}


@dataclass
class Post:
    title: str
    date: Optional[datetime]
    date_raw: str
    slug: str
    source_path: Path
    summary: str
    body: str
    rendered_output_path: Optional[Path]
    archive_relative_path: str
    page_mode: str


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s-]", "", value).strip().lower()
    cleaned = re.sub(r"[\s_-]+", "-", cleaned)
    return cleaned.strip("-") or "post"


def parse_date(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    candidate = raw.strip()
    fmts = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d %b %Y",
        "%d %B %Y",
    ]
    for fmt in fmts:
        try:
            return datetime.strptime(candidate, fmt)
        except ValueError:
            pass
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", candidate)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y-%m-%d")
        except ValueError:
            return None
    return None


def parse_metadata_and_body(text: str, suffix: str) -> tuple[dict[str, str], str]:
    metadata: dict[str, str] = {}
    lines = text.splitlines()
    i = 0

    if suffix in {".md", ".markdown", ".txt", ".adoc", ".asciidoc"}:
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                break
            m = re.match(r"^([A-Za-z_]+)\s*:\s*(.+)$", line)
            if not m:
                break
            key, value = m.group(1).lower(), m.group(2).strip()
            metadata[key] = value
            i += 1
    elif suffix == ".rst":
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                break
            m = re.match(r"^:([a-zA-Z_]+):\s*(.+)$", line)
            if not m:
                break
            key, value = m.group(1).lower(), m.group(2).strip()
            metadata[key] = value
            i += 1

    body = "\n".join(lines[i:]).strip()
    return metadata, body


def derive_summary(metadata: dict[str, str], body: str) -> str:
    for key in ("summary", "description", "subtitle"):
        if metadata.get(key):
            return metadata[key].strip()

    stripped_lines = []
    in_code = False
    for line in body.splitlines():
        t = line.strip()
        if t.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        t = re.sub(r"^#+\s*", "", t)
        t = re.sub(r"^!\[[^\]]*\]\([^)]*\)", "", t)
        t = re.sub(r"\[[^\]]+\]\([^)]*\)", "", t)
        if t:
            stripped_lines.append(t)
        if len(" ".join(stripped_lines)) > 250:
            break

    summary = " ".join(stripped_lines)
    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) > 220:
        summary = summary[:217].rstrip() + "..."
    return summary


def collect_posts() -> list[Post]:
    posts: list[Post] = []
    used_slugs: set[str] = set()

    for source_path in sorted(CONTENT_DIR.rglob("*")):
        if not source_path.is_file() or source_path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        rel = source_path.relative_to(CONTENT_DIR)
        if rel.parts and rel.parts[0].lower() in EXCLUDED_CONTENT_DIRS:
            continue

        text = source_path.read_text(encoding="utf-8", errors="ignore")
        metadata, body = parse_metadata_and_body(text, source_path.suffix.lower())

        title = metadata.get("title") or source_path.stem
        date_raw = metadata.get("date", "")
        date_obj = parse_date(date_raw)
        base_slug = metadata.get("slug") or slugify(title)
        slug = slugify(base_slug)

        unique_slug = slug
        n = 2
        while unique_slug in used_slugs:
            unique_slug = f"{slug}-{n}"
            n += 1
        used_slugs.add(unique_slug)

        summary = derive_summary(metadata, body)

        posts.append(
            Post(
                title=title.strip(),
                date=date_obj,
                date_raw=date_raw.strip(),
                slug=unique_slug,
                source_path=source_path,
                summary=summary,
                body=body,
                rendered_output_path=None,
                archive_relative_path=f"posts/{unique_slug}/index.html",
                page_mode="generated",
            )
        )

    posts.sort(key=lambda p: (p.date is not None, p.date or datetime.min, p.title.lower()), reverse=True)
    return posts


def normalize_stem(name: str) -> str:
    return slugify(Path(name).stem)


def find_rendered_file(post: Post) -> Optional[Path]:
    if not OUTPUT_DIR.exists():
        return None

    forbidden_parts = {"tag", "tags", "category", "categories", "author", "theme", "feeds", "images"}
    candidates: list[Path] = []
    desired = {post.slug, slugify(post.title), slugify(post.source_path.stem)}

    for html_path in OUTPUT_DIR.rglob("*.html"):
        rel = html_path.relative_to(OUTPUT_DIR)
        if any(part.lower() in forbidden_parts for part in rel.parts[:-1]):
            continue
        stem_norm = normalize_stem(html_path.name)
        if stem_norm in desired:
            candidates.append(html_path)

    if not candidates:
        return None

    candidates.sort(key=lambda p: (len(p.relative_to(OUTPUT_DIR).parts), len(str(p))))
    return candidates[0]


def extract_article_html(rendered_html: str) -> Optional[str]:
    patterns = [
        r"(<article[\s\S]*?</article>)",
        r"(<main[\s\S]*?</main>)",
        r"(<section class=\"post-content\"[\s\S]*?</section>)",
    ]
    for pattern in patterns:
        m = re.search(pattern, rendered_html, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def markdownish_to_html(body: str) -> str:
    lines = body.splitlines()
    out: list[str] = []
    in_code = False
    for line in lines:
        if line.strip().startswith("```"):
            if not in_code:
                out.append("<pre><code>")
            else:
                out.append("</code></pre>")
            in_code = not in_code
            continue

        if in_code:
            out.append(html.escape(line))
            continue

        if not line.strip():
            out.append("")
            continue

        if line.startswith("### "):
            out.append(f"<h3>{html.escape(line[4:].strip())}</h3>")
        elif line.startswith("## "):
            out.append(f"<h2>{html.escape(line[3:].strip())}</h2>")
        elif line.startswith("# "):
            out.append(f"<h1>{html.escape(line[2:].strip())}</h1>")
        else:
            escaped = html.escape(line)
            escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
            out.append(f"<p>{escaped}</p>")

    if in_code:
        out.append("</code></pre>")

    return "\n".join(out)


def write_post_page(post: Post) -> None:
    target = POSTS_DIR / post.slug / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)

    article_block = ""
    if post.rendered_output_path:
        rendered_html = post.rendered_output_path.read_text(encoding="utf-8", errors="ignore")
        extracted = extract_article_html(rendered_html)
        if extracted:
            article_block = extracted
            post.page_mode = "copied-rendered-body"
        else:
            post.page_mode = "generated"

    if not article_block:
        converted = markdownish_to_html(post.body)
        article_block = f'<article class="archive-article">\n{converted}\n</article>'

    date_line = ""
    if post.date:
        date_line = post.date.strftime("%Y-%m-%d")
    elif post.date_raw:
        date_line = post.date_raw

    content = f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>{html.escape(post.title)} | Archive</title>
  <link rel=\"stylesheet\" href=\"../../../styles.css\">
</head>
<body>
  <header>
    <nav>
      <a href=\"../../../index.html\">Home</a>
      <a href=\"../../index.html\" aria-current=\"page\">Archive</a>
      <a href=\"../../../contact/index.html\">Contact</a>
    </nav>
  </header>
  <main>
    <h1>{html.escape(post.title)}</h1>
    {f'<p class="meta">{html.escape(date_line)}</p>' if date_line else ''}
    {article_block}
  </main>
</body>
</html>
"""
    target.write_text(content, encoding="utf-8")


def write_archive_index(posts: list[Post]) -> None:
    items: list[str] = []
    for post in posts:
        date_str = ""
        if post.date:
            date_str = post.date.strftime("%Y-%m-%d")
        elif post.date_raw:
            date_str = post.date_raw

        summary_html = f"<p>{html.escape(post.summary)}</p>" if post.summary else ""
        meta_html = f"<p class=\"meta\">{html.escape(date_str)}</p>" if date_str else ""
        items.append(
            "\n".join(
                [
                    "<li>",
                    f'  <h2><a href="{html.escape(post.archive_relative_path)}">{html.escape(post.title)}</a></h2>',
                    f"  {meta_html}",
                    f"  {summary_html}",
                    "</li>",
                ]
            )
        )

    items_html = "\n".join(items)
    page = f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>Archive</title>
  <link rel=\"stylesheet\" href=\"../styles.css\">
</head>
<body>
  <header>
    <nav>
      <a href=\"../index.html\">Home</a>
      <a href=\"./index.html\" aria-current=\"page\">Archive</a>
      <a href=\"../contact/index.html\">Contact</a>
    </nav>
  </header>
  <main>
    <h1>Archive</h1>
    <p>Older blog posts.</p>
    <ul class=\"archive-list\">
      {items_html}
    </ul>
  </main>
</body>
</html>
"""
    (ARCHIVE_DIR / "index.html").write_text(page, encoding="utf-8")


def write_home_page() -> None:
    page = """<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>Home</title>
  <link rel=\"stylesheet\" href=\"styles.css\">
</head>
<body>
  <header>
    <nav>
      <a href=\"index.html\" aria-current=\"page\">Home</a>
      <a href=\"archive/index.html\">Archive</a>
      <a href=\"contact/index.html\">Contact</a>
    </nav>
  </header>
  <main>
    <h1>Under Construction</h1>
    <p>This site is being rebuilt.</p>
    <div class=\"image-placeholder\" aria-label=\"Image placeholder\"></div>
  </main>
</body>
</html>
"""
    (DOCS_DIR / "index.html").write_text(page, encoding="utf-8")


def write_contact_page() -> None:
    page = """<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>Contact</title>
  <link rel=\"stylesheet\" href=\"../styles.css\">
</head>
<body>
  <header>
    <nav>
      <a href=\"../index.html\">Home</a>
      <a href=\"../archive/index.html\">Archive</a>
      <a href=\"./index.html\" aria-current=\"page\">Contact</a>
    </nav>
  </header>
  <main>
    <h1>Contact</h1>
    <p>Use this form to send a message. Messages should ultimately route to ai.brandonanhorn@gmail.com through your backend integration.</p>
    <form method=\"post\" action=\"REPLACE_WITH_BACKEND_ENDPOINT\">
      <label for=\"name\">Name</label>
      <input id=\"name\" name=\"name\" type=\"text\" required>

      <label for=\"email\">Email</label>
      <input id=\"email\" name=\"email\" type=\"email\" required>

      <label for=\"message\">Message</label>
      <textarea id=\"message\" name=\"message\" rows=\"6\" required></textarea>

      <button type=\"submit\">Send</button>
    </form>
  </main>
</body>
</html>
"""
    (DOCS_DIR / "contact" / "index.html").write_text(page, encoding="utf-8")


def write_styles() -> None:
    css = """* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Arial, Helvetica, sans-serif;
  background: #fff;
  color: #000;
  line-height: 1.5;
}
header {
  border-bottom: 1px solid #000;
  padding: 0.75rem 1rem;
}
nav {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
nav a {
  color: #000;
  text-decoration: none;
}
nav a[aria-current=\"page\"] {
  text-decoration: underline;
}
main {
  max-width: 860px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}
.image-placeholder {
  margin-top: 1rem;
  width: 100%;
  min-height: 240px;
  border: 1px dashed #000;
}
.archive-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
}
.archive-list li {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #ddd;
}
.meta {
  margin: 0.25rem 0;
  font-size: 0.95rem;
}
form {
  display: grid;
  gap: 0.75rem;
  max-width: 600px;
}
input, textarea, button {
  font: inherit;
  padding: 0.5rem;
  border: 1px solid #000;
  background: #fff;
  color: #000;
}
button {
  width: fit-content;
  cursor: pointer;
}
.archive-article img {
  max-width: 100%;
  height: auto;
}
pre {
  overflow-x: auto;
  border: 1px solid #ddd;
  padding: 0.75rem;
}
@media (max-width: 640px) {
  main { padding: 1rem 0.75rem 2rem; }
}
"""
    (DOCS_DIR / "styles.css").write_text(css, encoding="utf-8")


def main() -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / "contact").mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / "images").mkdir(parents=True, exist_ok=True)

    posts = collect_posts()
    for post in posts:
        post.rendered_output_path = find_rendered_file(post)
        write_post_page(post)

    write_home_page()
    write_contact_page()
    write_styles()
    write_archive_index(posts)

    print(f"Discovered posts: {len(posts)}")
    for post in posts:
        rendered = str(post.rendered_output_path.relative_to(ROOT)) if post.rendered_output_path else "none"
        print(f"- {post.title} | slug={post.slug} | source={post.source_path.relative_to(ROOT)} | rendered={rendered} | mode={post.page_mode}")


if __name__ == "__main__":
    main()
