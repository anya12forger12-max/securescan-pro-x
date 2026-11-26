import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The browser stage keeps its strings in a TypeScript dictionary. This guard
// parses the source (no bundler needed) so a new key in one language cannot
// silently fall back to English, and placeholders stay in sync.
const sourceUrl = new URL("../../../frontend/src/i18n/aviator.ts", import.meta.url);

function dictionary(name, source) {
  const block = source.match(new RegExp(`const ${name}: Dictionary = \\{([\\s\\S]*?)\\n\\};`));
  assert.ok(block, `missing ${name} dictionary`);
  const entries = new Map();
  for (const match of block[1].matchAll(/^\s{2}([A-Za-z]\w*): '([^']*)',?$/gm)) {
    assert.ok(!entries.has(match[1]), `duplicate key ${name}.${match[1]}`);
    entries.set(match[1], match[2]);
  }
  assert.ok(entries.size > 50, `${name} dictionary looks truncated`);
  return entries;
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test("Aviator translation dictionaries have identical keys", async () => {
  const source = await readFile(fileURLToPath(sourceUrl), "utf8");
  const en = dictionary("en", source);
  for (const name of ["hi", "ar"]) {
    const other = dictionary(name, source);
    assert.deepEqual([...other.keys()].sort(), [...en.keys()].sort(), `${name} key parity`);
    for (const [key, value] of other) {
      assert.deepEqual(placeholders(value), placeholders(en.get(key)), `${name}.${key} placeholders`);
    }
  }
});
