import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../schema/project.schema.json", import.meta.url);
const analystSchemaUrl = new URL(
  "../../../skills/document-analyst/output.schema.json",
  import.meta.url
);

test("project schema is valid JSON and pins the supported MIME types", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.mimeType.enum, [
    "application/pdf",
    "image/png",
    "image/jpeg"
  ]);
});

test("canonical IR requires provenance and confidence", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  assert.ok(schema.$defs.block.required.includes("confidence"));
  assert.ok(schema.$defs.block.required.includes("source"));
  assert.ok(schema.$defs.block.required.includes("warnings"));
});

test("document analyst output is constrained and cannot return replacement text", async () => {
  const schema = JSON.parse(await readFile(analystSchemaUrl, "utf8"));
  const block = schema.properties.kinds.items;
  assert.equal(block.additionalProperties, false);
  assert.equal(Object.hasOwn(block.properties, "text"), false);
  assert.deepEqual(block.required, ["id", "kind"]);
});
