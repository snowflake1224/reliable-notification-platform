import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../packages/shared/src/template.js";

describe("templates", () => {
  it("renders {{placeholders}}", () => {
    expect(renderTemplate("Hi {{name}}, order {{orderId}}", { name: "Ada", orderId: 9 })).toBe(
      "Hi Ada, order 9"
    );
  });
});
