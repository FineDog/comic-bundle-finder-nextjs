import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';

const contentDir = path.join(process.cwd(), 'content');

export function getBlogSlugs() {
  const dir = path.join(contentDir, 'blog');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

function readMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return matter(raw);
}

export function getAllBlogPosts() {
  return getBlogSlugs()
    .map(slug => {
      const { data } = readMarkdown(path.join(contentDir, 'blog', `${slug}.md`));
      return { slug, ...data };
    })
    .filter(p => !p.draft)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function getBlogPost(slug) {
  const filePath = path.join(contentDir, 'blog', `${slug}.md`);
  const { data, content } = readMarkdown(filePath);
  const processed = await remark().use(html, { sanitize: false }).process(content);
  return { frontmatter: data, html: processed.toString() };
}

export async function getFaqContent() {
  const filePath = path.join(contentDir, 'faq.md');
  const { data, content } = readMarkdown(filePath);
  const processed = await remark().use(html, { sanitize: false }).process(content);
  return { frontmatter: data, html: processed.toString(), faqItems: parseFaqItems(content) };
}

// Extract Q&A pairs for FAQPage structured data. Each `## Heading` is a question;
// everything up to the next `## ` (or single-`#` section divider) is its answer.
// Markdown is stripped to plain text so the JSON-LD `text` is clean.
function parseFaqItems(content) {
  const items = [];
  const sections = content.split(/\n(?=## )/);
  for (const sec of sections) {
    const m = sec.match(/^##\s+(.+)/);
    if (!m) continue; // skips frontmatter remnants and the "# Premium Features" divider
    const question = m[1].trim();
    const answer = sec
      .replace(/^##\s+.+/, '')      // drop the heading line
      .replace(/^#\s+.+$/gm, '')    // drop any single-# section divider in the body
      .replace(/[*_`>#]/g, '')      // strip inline markdown markers
      .replace(/\s+/g, ' ')
      .trim();
    if (answer) items.push({ question, answer });
  }
  return items;
}
