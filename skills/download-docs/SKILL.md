---
name: download-docs
description: "Download documentation from websites and save as markdown files locally. Crawls docs sites, converts pages to markdown, and saves them to the project for offline reference and search. Use when user says 'download docs', 'download documentation', 'scrape docs', 'save docs locally', 'archive docs', 'download API docs', or similar. Perfect for API documentation sites like Open-Meteo, OpenAI, Stripe, etc."
---

# Download Documentation Skill

Downloads documentation from websites and saves them as markdown files locally for easy reference and search.

## Variables

- `url` -- The documentation URL to download (e.g., `https://open-meteo.com/en/docs`)
- `output_dir` -- Where to save the docs (default: `docs/external/{site-name}/` in project root)
- `depth` -- How many levels to crawl (default: 1 for single page, increase for site crawling)
- `selector` -- CSS selector to extract main content (optional, e.g., `main` or `.content`)

## Instructions

### Step 1: Determine Target and Scope

**Parse the user's request:**
- Extract the documentation URL
- Determine if they want a single page or full site
- Identify the output directory (default to `docs/external/{site-name}/`)
- Extract site name from URL for the folder name

### Step 2: Set Up Output Directory

```bash
# Extract site name from URL for folder naming
SITE_NAME=$(echo "{url}" | sed -E 's|https?://||' | sed -E 's|/.*||' | sed -E 's|www\.||' | cut -d. -f1)
OUTPUT_DIR="{output_dir:-docs/external/$SITE_NAME}"
mkdir -p "$OUTPUT_DIR"
```

### Step 3: Download Documentation

**Option A: Single Page via webfetch (Fastest)**

For a single page, use the MCP webfetch tool and save directly:

```javascript
// Using webfetch MCP tool
const result = await webfetch({url: "{url}", format: "markdown"});
fs.writeFileSync("{output_dir}/index.md", result.content);
```

**Option B: HTML Download + Node.js Conversion (Recommended)**

For better control over content extraction:

```bash
# 1. Download HTML
curl -s "{url}" -A "Mozilla/5.0" -o "{output_dir}/index.html"

# 2. Convert to Markdown using Node.js
# Create converter script
cat > "{output_dir}/convert.js" << 'EOF'
const fs = require('fs');
const TurndownService = require('turndown');
const { JSDOM } = require('jsdom');

const inputFile = process.argv[2];
const outputFile = process.argv[3];
const selector = process.argv[4] || 'main';

const html = fs.readFileSync(inputFile, 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

// Extract content by selector
let content = doc.querySelector(selector) || doc.body;

// Remove noise
['script', 'style', 'nav', 'header', 'footer', 'aside'].forEach(tag => {
    content.querySelectorAll(tag).forEach(el => el.remove());
});

// Convert
const turndown = new TurndownService({headingStyle: 'atx'});
const markdown = turndown.turndown(content.innerHTML);

// Add metadata
const meta = `---\nsource: {url}\ndownloaded: ${new Date().toISOString()}\n---\n\n`;
fs.writeFileSync(outputFile, meta + markdown);
console.log('Converted:', outputFile);
EOF

# 3. Install dependencies if needed
npm install turndown jsdom --silent

# 4. Run conversion
node "{output_dir}/convert.js" "{output_dir}/index.html" "{output_dir}/index.md" "{selector:-main}"

# 5. Cleanup
rm "{output_dir}/index.html" "{output_dir}/convert.js"
```

**Option C: wget + pandoc (Full Site Crawling)**

For downloading multiple pages recursively:

```bash
# Download HTML files
wget --recursive --no-clobber --page-requisites --html-extension \
     --convert-links --restrict-file-names=windows \
     --domains "{domain}" --no-parent \
     --accept "*.html,*.htm" \
     --reject-regex "(logout|signin|login|search)" \
     --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
     "{url}" -P "{output_dir}/html/"

# Convert with pandoc if available
if command -v pandoc &> /dev/null; then
    find "{output_dir}/html/" -name "*.html" -type f | while read -r file; do
        output="${file%.html}.md"
        pandoc -f html -t markdown --wrap=none "$file" -o "$output" 2>/dev/null
    done
fi
```

### Step 4: Create Index and Organize

```bash
# Generate README index
SITE_NAME=$(echo "{url}" | sed -E 's|https?://||' | sed -E 's|/.*||' | sed -E 's|www\.||' | cut -d. -f1)
DATE=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

cat > "{output_dir}/README.md" << EOF
---
site: $SITE_NAME
docs_url: {url}
downloaded: $DATE
tool: download-docs skill
---

# $SITE_NAME Documentation

**Source:** {url}  
**Downloaded:** $DATE

## Files

EOF

# List all markdown files
find "{output_dir}" -name "*.md" -type f ! -name "README.md" | sort | while read -r file; do
    rel_path=$(basename "$file")
    title=$(grep -m 1 "^# " "$file" 2>/dev/null | sed 's/^# //' || echo "$rel_path")
    echo "- [$title]($rel_path)" >> "{output_dir}/README.md"
done

echo "" >> "{output_dir}/README.md"
echo "## Notes" >> "{output_dir}/README.md"
echo "" >> "{output_dir}/README.md"
echo "- Downloaded for offline reference" >> "{output_dir}/README.md"
echo "- Original URL: {url}" >> "{output_dir}/README.md"
```

### Step 5: Return Summary

```
Downloaded documentation: {Site Name}
Source: {url}
Location: {output_dir}/
Files:
- README.md (index)
- index.md (content)
Total size: $(du -sh {output_dir} | cut -f1)

Usage:
Browse docs in {output_dir}/README.md
Search with: grep -r "term" {output_dir}/
```

## Quick Start

### For Open-Meteo (your example):

```bash
# Single page download
download-docs https://open-meteo.com/en/docs

# Multi-page crawl
download-docs https://open-meteo.com/en/docs --depth 2

# With content selector
download-docs https://open-meteo.com/en/docs --selector "main"
```

### Other Examples:

```bash
# Stripe API docs
download-docs https://stripe.com/docs/api --depth 3

# OpenAI API docs
download-docs https://platform.openai.com/docs --selector "main"

# GitHub API docs
download-docs https://docs.github.com/en/rest --depth 2
```

## Tools Required

**Primary (Node.js):**
- `turndown` - HTML to Markdown converter
- `jsdom` - DOM parser for content extraction
- `curl` - For downloading HTML

Install: `npm install turndown jsdom`

**Alternative:**
- `pandoc` - Universal document converter (if available)
- `wget` - For recursive crawling

## Cookbook

<If: User wants Open-Meteo API docs>
<Then:>
```bash
mkdir -p docs/external/open-meteo
curl -s "https://open-meteo.com/en/docs" -A "Mozilla/5.0" -o docs/external/open-meteo/api.html
# Then convert using Node.js turndown
```

<If: Site requires authentication>
<Then:>
```bash
curl -s "{url}" -H "Cookie: session=abc123" -H "Authorization: Bearer token"
```

<If: Site blocks requests>
<Then:>
- Add `-A "Mozilla/5.0..."` user-agent
- Add delays: `sleep 1` between requests
- Check `robots.txt` first

<If: Need to extract specific section>
<Then:>
Use `--selector` with CSS selectors like:
- `main` or `article` - Main content
- `.content` or `.docs` - Common doc containers
- `#api-reference` - Specific sections

## Validation

- [ ] Output directory created
- [ ] Markdown file(s) generated
- [ ] README.md index created
- [ ] Source URL documented
- [ ] Files are searchable text

## Troubleshooting

**No turndown module:**
```bash
npm install turndown jsdom
```

**Content missing:**
- Try different CSS selector: `main`, `article`, `.content`
- Check if site uses JavaScript rendering (needs puppeteer)

**Encoding issues:**
```bash
# Force UTF-8
curl -s "{url}" | iconv -f UTF-8 -t UTF-8//IGNORE
```

**Rate limited:**
- Add `--limit-rate 100K` to curl
- Add `sleep 2` between requests

## Pro Tips

1. **For API docs:** Often `main` or `article` selectors work best
2. **For reference sites:** Try `.documentation` or `.docs-content`
3. **Save converter script:** Keep the convert.js for future use
4. **Git track:** Add docs/external to .gitignore if they're large
5. **Search:** Use `grep -r` or `rg` to search across all downloaded docs
