/**
 * Round-trip tests for note-serializer.
 *
 * Contract: toMarkdown(fromMarkdown(X)) should preserve the salient features
 * of X. We cannot demand byte-identity because our round-trip normalises
 * whitespace and canonicalises some constructs, but the following must be
 * invariant:
 *   - frontmatter keys (id, evergreen, tags, project_id, etc.)
 *   - block-level structure (headings, list items, table dimensions)
 *   - math latex string
 *   - wikilink targets
 *   - footnote ids + content
 */

import { describe, it, expect } from "vitest";
import {
  toMarkdown,
  fromMarkdown,
  parseFrontmatter,
} from "../note-serializer";

const baseFm = {
  id: "00000000-0000-0000-0000-000000000001",
  project_id: "00000000-0000-0000-0000-000000000aaa",
  folder_id: null,
  item_id: null,
  evergreen: true,
  tags: ["synthesis", "re-via-testing"],
  anchor_selectors: null,
  links_out: [],
  created_at: "2026-04-18T12:00:00Z",
  updated_at: "2026-04-18T12:34:56Z",
  content_hash: "abc123",
};

function assertRoundTripMatchesFrontmatter(md: string) {
  const parsed = fromMarkdown(md);
  expect(parsed.frontmatter.id).toBe(baseFm.id);
  expect(parsed.frontmatter.project_id).toBe(baseFm.project_id);
  expect(parsed.frontmatter.evergreen).toBe(true);
  expect(parsed.frontmatter.tags).toEqual(["synthesis", "re-via-testing"]);
}

describe("fromMarkdown → parses frontmatter", () => {
  it("parses basic frontmatter", () => {
    const md = `---\nid: abc\nevergreen: true\ntags: ["a", "b"]\n---\n# Title\n\nBody`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter.id).toBe("abc");
    expect(frontmatter.evergreen).toBe(true);
    expect(frontmatter.tags).toEqual(["a", "b"]);
  });

  it("handles missing frontmatter gracefully", () => {
    const md = `# Just a title\n\nbody`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.id).toBe("");
    expect(body).toContain("Just a title");
  });
});

describe("round-trip: plain text", () => {
  it("preserves paragraphs and title", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "My Synthesis",
      html: "<p>First paragraph.</p><p>Second paragraph with <strong>bold</strong>.</p>",
    });
    const parsed = fromMarkdown(input);
    expect(parsed.title).toBe("My Synthesis");
    expect(parsed.body).toContain("First paragraph");
    expect(parsed.body).toContain("Second paragraph");
    expect(parsed.html).toContain("<strong>");
    assertRoundTripMatchesFrontmatter(input);
  });
});

describe("round-trip: math", () => {
  it("preserves inline math", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "Math",
      html: `<p>Einstein said <span data-type="math-inline" data-latex="E=mc^2"></span>.</p>`,
    });
    expect(input).toContain("$E=mc^2$");
    const parsed = fromMarkdown(input);
    expect(parsed.html).toContain('data-type="math-inline"');
    expect(parsed.html).toContain('data-latex="E=mc^2"');
  });

  it("preserves display math", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "Math",
      html: `<p>Before</p><div data-type="math-block" data-latex="\\int_0^1 f(x) dx"></div><p>After</p>`,
    });
    expect(input).toContain("$$\\int_0^1 f(x) dx$$");
    const parsed = fromMarkdown(input);
    expect(parsed.html).toContain('data-type="math-block"');
    expect(parsed.html).toContain('data-latex="\\int_0^1 f(x) dx"');
  });
});

describe("round-trip: tables", () => {
  it("preserves headers and rows", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "Tables",
      html: `<table>
<thead><tr><th>Feature</th><th>Status</th></tr></thead>
<tbody>
  <tr><td>Math</td><td>Done</td></tr>
  <tr><td>Comments</td><td>WIP</td></tr>
</tbody>
</table>`,
    });
    expect(input).toMatch(/\| Feature \| Status \|/);
    expect(input).toMatch(/\| --- \| --- \|/);
    expect(input).toMatch(/\| Math \| Done \|/);
    expect(input).toMatch(/\| Comments \| WIP \|/);

    const parsed = fromMarkdown(input);
    expect(parsed.html).toContain("<table>");
    expect(parsed.html).toContain("<th>Feature</th>");
    expect(parsed.html).toContain("<td>Math</td>");
  });
});

describe("round-trip: wikilinks", () => {
  it("preserves wikilink targets", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "Wikilinks",
      html: `<p>See also <a data-type="wikilink" data-target="Requirement Engineering" href="/project-notes?q=Requirement%20Engineering">[[Requirement Engineering]]</a>.</p>`,
    });
    expect(input).toContain("[[Requirement Engineering]]");
    const parsed = fromMarkdown(input);
    expect(parsed.html).toContain('data-type="wikilink"');
    expect(parsed.html).toContain('data-target="Requirement Engineering"');
  });
});

describe("round-trip: footnotes", () => {
  it("preserves ref + definition with same id", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "Footnotes",
      html: `<p>Body with reference<sup data-fn-id="1" data-type="footnote-ref">[1]</sup>.</p><div data-type="footnote-def" data-fn-id="1">Footnote content.</div>`,
    });
    expect(input).toContain("[^1]");
    expect(input).toContain("[^1]: Footnote content.");
    const parsed = fromMarkdown(input);
    expect(parsed.html).toContain('data-type="footnote-ref"');
    expect(parsed.html).toContain('data-fn-id="1"');
    expect(parsed.html).toContain("Footnote content");
  });
});

describe("round-trip: task lists", () => {
  it("preserves checked + unchecked items", () => {
    const input = toMarkdown({
      frontmatter: baseFm,
      title: "Tasks",
      html: `<ul data-type="taskList">
<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Write spec</p></div></li>
<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Draft PR</p></div></li>
</ul>`,
    });
    expect(input).toMatch(/- \[x\] Write spec/);
    expect(input).toMatch(/- \[ \] Draft PR/);
    const parsed = fromMarkdown(input);
    expect(parsed.html).toContain('data-type="taskItem"');
  });
});

describe("round-trip: mixed content preserves frontmatter", () => {
  it("complex note passes through all frontmatter keys", () => {
    const md = toMarkdown({
      frontmatter: baseFm,
      title: "Mixed",
      html: `<h1>Heading</h1><p>Math: <span data-type="math-inline" data-latex="x^2"></span></p><ul><li>a</li><li>b</li></ul>`,
    });
    assertRoundTripMatchesFrontmatter(md);
    const parsed = fromMarkdown(md);
    expect(parsed.html).toContain("<h1>");
    expect(parsed.html).toContain("<ul>");
  });
});

describe("frontmatter: null fields survive", () => {
  it("preserves null item_id and folder_id", () => {
    const md = toMarkdown({
      frontmatter: {
        ...baseFm,
        item_id: null,
        folder_id: null,
      },
      title: "Null fields",
      html: "<p>body</p>",
    });
    expect(md).toContain("item_id: null");
    expect(md).toContain("folder_id: null");
    const parsed = fromMarkdown(md);
    expect(parsed.frontmatter.item_id).toBe(null);
    expect(parsed.frontmatter.folder_id).toBe(null);
  });
});
