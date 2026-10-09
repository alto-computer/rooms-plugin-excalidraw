import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { opsPath } from "./ops";

describe("manifest", () => {
  const draw = manifest.tools.draw;

  it("declares the draw tool within Rooms' limits", () => {
    expect([...draw.description].length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(draw.input).length).toBeLessThanOrEqual(16 * 1024);
    expect(draw.input.required).toEqual(["doc", "ops"]);
  });

  it("shows the side panel as a palette icon", () => {
    expect(manifest.slots["artifact.sidePanel"].icon).toBe("palette");
  });

  it("appends where the panel reads", () => {
    expect(draw.appendTo.replace("{doc}", "0123456789abcdef")).toBe(opsPath("0123456789abcdef"));
  });
});
