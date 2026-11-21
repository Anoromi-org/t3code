import { expect, it } from "@effect/vitest";
import { Tool } from "effect/ai";

import { ProjectToolkit } from "./tools.ts";

const hiddenSchemaOf = (schema: unknown) =>
  JSON.stringify(
    (schema as { readonly properties?: Readonly<Record<string, unknown>> }).properties?.hidden,
  );

it("exposes the hidden flag on project reads and writes", () => {
  const { t3_project_list, t3_project_read, t3_project_create, t3_project_update } =
    ProjectToolkit.tools;
  expect(hiddenSchemaOf(Tool.getJsonSchema(t3_project_update))).toContain('"boolean"');
  expect(hiddenSchemaOf(Tool.getJsonSchema(t3_project_create))).toContain('"boolean"');
  expect(hiddenSchemaOf(Tool.getJsonSchemaFromSchema(t3_project_read.successSchema))).toContain(
    '"boolean"',
  );
  const list = Tool.getJsonSchemaFromSchema(t3_project_list.successSchema) as {
    readonly properties: { readonly projects: { readonly items: unknown } };
  };
  expect(hiddenSchemaOf(list.properties.projects.items)).toContain('"boolean"');
});
