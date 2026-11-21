import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// Encoded as ASCII code arrays so this linter file never triggers plaintext grep scans itself.
const BLOCKED_CODE_SEQUENCES = [
  [99, 101, 108, 111, 114],
  [99, 101, 49, 111, 114],
  [99, 104, 114, 111, 110, 111, 45, 115, 111, 108, 97, 110, 97],
  [115, 111, 108, 97, 105, 114],
  [114, 111, 98, 105, 116],
  [120, 105, 110, 110, 101, 114],
  [104, 111, 111, 100, 98, 111, 97, 114, 100],
  [100, 111, 109, 105, 110, 97, 115, 98, 114, 111],
  [115, 111, 108, 98, 111, 120],
  [109, 97, 116, 117, 114, 101, 118, 97, 116, 115],
  [112, 114, 97, 107, 104, 97, 114, 103, 97, 117, 114],
  [49, 57, 56, 46, 49, 50, 46, 57, 53],
  [110, 103, 114, 111, 107],
  [112, 117, 109, 112, 46, 102, 117, 110],
  [54, 69, 70, 56, 114, 114, 101, 99, 116, 104],
  [46, 99, 108, 111, 117, 100],
  [46, 112, 97, 103, 101, 115, 46, 100, 101, 118],
  [115, 111, 108, 97, 110, 97],
  [109, 105, 110, 116],
  [116, 114, 101, 110, 99, 104],
  [115, 110, 105, 112, 101, 114]
];

const BLOCKED_PATTERNS = BLOCKED_CODE_SEQUENCES.map((codes) => {
  const word = String.fromCharCode(...codes);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { word, regex: new RegExp(escaped, "i") };
});

const EM_DASH_CHAR = String.fromCharCode(0x2014);

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".svg",
  ".md",
  ".yml",
  ".yaml",
  ".txt"
]);

function walkRepoFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRepoFiles(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext) || entry.name === "LICENSE" || entry.name === ".gitignore") {
        out.push(full);
      }
    }
  }
  return out;
}

export function isMonochromeHex(hexStr) {
  const raw = String(hexStr || "").replace(/^#/, "").trim();
  let r;
  let g;
  let b;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length === 6 || raw.length === 8) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  } else {
    return false;
  }
  if ([r, g, b].some((n) => Number.isNaN(n))) return false;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread <= 14;
}

export function runBrandAndThemeAudit(rootDir = ROOT_DIR) {
  const files = walkRepoFiles(rootDir);
  const violations = [];

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const lineNo = index + 1;
      if (line.includes(EM_DASH_CHAR)) {
        violations.push(`${rel}:${lineNo} contains disallowed em-dash character`);
      }

      for (const item of BLOCKED_PATTERNS) {
        if (item.regex.test(line)) {
          violations.push(`${rel}:${lineNo} matched disallowed term "${item.word}"`);
        }
      }

      if (/\.(js|mjs|html|css|svg)$/i.test(rel) && !rel.startsWith("scripts/")) {
        const hexMatches = line.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        for (const hex of hexMatches) {
          if (hex.length === 4 || hex.length === 7 || hex.length === 9) {
            if (!isMonochromeHex(hex)) {
              violations.push(`${rel}:${lineNo} contains non-monochrome color ${hex}`);
            }
          }
        }
      }
    });
  }

  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = runBrandAndThemeAudit(ROOT_DIR);
  if (issues.length > 0) {
    console.error("Brand / monochrome lint failed:");
    issues.forEach((msg) => console.error(`  - ${msg}`));
    process.exit(1);
  }
  console.log("Brand, punctuation, and monochrome palette audit passed with 0 issues.");
}
