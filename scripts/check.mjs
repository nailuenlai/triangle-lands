import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const PURE_MATH_FILES = new Set(['noise.ts', 'biome-field.ts', 'terrain.ts']);

const failures = [];

function fail(file, message) {
  failures.push(`${path.relative(process.cwd(), file)}: ${message}`);
}

const files = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(SRC_DIR, f));

for (const file of files) {
  const base = path.basename(file);
  const src = fs.readFileSync(file, 'utf8');

  // 1. Keep core spatial/terrain math free of Three.js so Node scripts can import Terrain directly
  if (PURE_MATH_FILES.has(base) && /from\s+['"]three['"]/.test(src)) {
    fail(file, 'must not import "three" (keep terrain/biome math pure for Node tooling)');
  }

  // 2. Prevent throwaway prototypes from leaking into static production imports
  if (!base.includes('.prototype.')) {
    const staticProto = src.match(/^\s*import\s+(?!type\b).*\.prototype['"]/m);
    if (staticProto) {
      fail(file, 'must not statically import a *.prototype module (gate dynamic import behind import.meta.env.DEV)');
    }
  }

  // 3. Guard custom GLSL shaders against NaN/Inf bloom blowups and missing tone mapping
  const glslRe = /(vertexShader|fragmentShader)\s*:\s*\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/g;
  let match;
  while ((match = glslRe.exec(src)) !== null) {
    const kind = match[1];
    const body = match[2];
    const startLine = src.slice(0, match.index).split('\n').length;

    if (kind === 'fragmentShader') {
      if (!body.includes('#include <tonemapping_fragment>')) {
        fail(file, `line ${startLine}: custom fragmentShader missing "#include <tonemapping_fragment>"`);
      }
      if (!body.includes('#include <colorspace_fragment>')) {
        fail(file, `line ${startLine}: custom fragmentShader missing "#include <colorspace_fragment>"`);
      }
    }

    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bpow\s*\(/.test(line) && !/>\s*1e-6\s*\?/.test(line)) {
        fail(file, `line ${startLine + i}: unguarded GLSL pow() (use safePow() or guard with "> 1e-6 ?")`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Static checks failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Static checks passed (${files.length} source files verified).`);
