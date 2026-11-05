import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, BUILT_IN_ROLES, canGrant, rolePermissions } from "@/lib/permissions";

describe("permissions", () => {
  it("the locked admin role always has every permission, even ones not stored", () => {
    expect(rolePermissions({ locked: true, permissions: [] }).size).toBe(ALL_PERMISSIONS.length);
  });
  it("unknown permission names are ignored", () => {
    expect([...rolePermissions({ locked: false, permissions: ["leads.edit", "rm -rf"] })]).toEqual(["leads.edit"]);
  });
  it("nobody can grant what they don't have", () => {
    const agent = rolePermissions({ locked: false, permissions: BUILT_IN_ROLES.agent.permissions });
    const manager = rolePermissions({ locked: false, permissions: BUILT_IN_ROLES.manager.permissions });
    expect(canGrant(manager, agent)).toBe(true);
    expect(canGrant(agent, manager)).toBe(false);
    expect(canGrant(manager, new Set(["users.manage" as const]))).toBe(false);
  });
  it("agents see all leads but cannot manage users or reassign", () => {
    const a = new Set(BUILT_IN_ROLES.agent.permissions);
    expect(a.has("leads.view_all")).toBe(true);
    expect(a.has("users.manage")).toBe(false);
    expect(a.has("leads.assign")).toBe(false);
  });
});
