import { test, expect } from "bun:test"
import path from "node:path"
import os from "node:os"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { JailError, artifactPath, checkJail, inside } from "../../src/policy/jail"
import { ArtifactStore } from "../../src/artifacts/store"

async function setup() {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-jail-"))
  const root = path.join(base, "root")
  const outside = path.join(base, "outside")
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(path.join(root, "inside.txt"), "ok")
  await writeFile(path.join(outside, "secret.txt"), "no")
  return { base, root, outside }
}

test("accepts paths inside the root", async () => {
  const { base, root } = await setup()
  try {
    const resolved = await checkJail([root], path.join(root, "inside.txt"))
    expect(resolved).toContain("inside.txt")
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("rejects .. escapes", async () => {
  const { base, root, outside } = await setup()
  try {
    const target = path.join(root, "..", "outside", "secret.txt")
    let failure: unknown
    try {
      await checkJail([root], target)
    } catch (err) {
      failure = err
    }
    expect(failure).toBeInstanceOf(JailError)
    expect((failure as JailError).resolved.toLowerCase()).toContain(outside.toLowerCase())
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("rejects absolute paths outside the root", async () => {
  const { base, root, outside } = await setup()
  try {
    let failure: unknown
    try {
      await checkJail([root], path.join(outside, "secret.txt"))
    } catch (err) {
      failure = err
    }
    expect(failure).toBeInstanceOf(JailError)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("rejects symlinks that point outside the root", async () => {
  const { base, root, outside } = await setup()
  try {
    const link = path.join(root, "link")
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir")
    let failure: unknown
    try {
      await checkJail([root], path.join(link, "secret.txt"))
    } catch (err) {
      failure = err
    }
    expect(failure).toBeInstanceOf(JailError)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("resolves non-existent descendants through the nearest real parent", async () => {
  const { base, root } = await setup()
  try {
    const resolved = await checkJail([root], path.join(root, "not-yet", "created.txt"))
    expect(resolved.toLowerCase()).toContain(path.join("not-yet", "created.txt").toLowerCase())
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("compares Windows drive and UNC roots case-insensitively without crossing shares", () => {
  expect(inside("C:\\Work\\Root", "c:\\work\\root\\child")).toBe(true)
  expect(inside("C:\\Work\\Root", "D:\\Work\\Root\\child")).toBe(false)
  expect(inside("\\\\server\\share\\root", "\\\\server\\share\\root\\child")).toBe(true)
  expect(inside("\\\\server\\share\\root", "\\\\server\\other\\root\\child")).toBe(false)
  expect(inside("\\\\server\\share\\root", "\\\\other\\share\\root\\child")).toBe(false)
})

if (process.platform !== "win32") {
  test.skip("drive-relative and unreachable UNC targets fail closed (requires Windows)", () => undefined)
} else {
  test("drive-relative and unreachable UNC targets fail closed on Windows", async () => {
  const { base, root } = await setup()
  try {
    const drive = path.parse(root).root.slice(0, 2)
    const same = await checkJail([root], `${drive}foo`).catch((err: unknown) => err)
    expect(same).not.toBeInstanceOf(JailError)
    const other = drive.toLowerCase() === "c:" ? "D:" : "C:"
    const failure = await checkJail([root], `${other}foo`).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(JailError)
    const unc = await checkJail(["\\\\kilo-browser-nonexistent\\share\\root"], "\\\\kilo-browser-nonexistent\\share\\root\\x").catch(
      (err: unknown) => err,
    )
    expect(unc).toBeInstanceOf(JailError)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
  })
}

test("artifact paths are generated under the artifacts directory with strict names", () => {
  const relative = artifactPath("ses_1", 3, "browser.screenshot", "a1b2c3d4", "png")
  expect(relative).toBe(path.join(".kilo", "kilo-browser", "artifacts", "ses_1", "003-screenshot-a1b2c3d4.png"))
  expect(() => artifactPath("ses_1", 0, "console", "a1b2c3d4", "json")).toThrow()
  expect(() => artifactPath("ses_1", 1, "console", "not-hex", "json")).toThrow()
  expect(() => artifactPath("../escape", 1, "console", "a1b2c3d4", "json")).not.toThrow()
  expect(artifactPath("../escape", 1, "console", "a1b2c3d4", "json")).not.toContain("..")
})
test("artifact writes reject an artifacts directory that is a symlink outside the workspace", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-artifact-link-"))
  const workspace = path.join(base, "workspace")
  const outside = path.join(base, "outside")
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  try {
    const parent = path.join(workspace, ".kilo", "kilo-browser")
    await mkdir(parent, { recursive: true })
    await symlink(outside, path.join(parent, "artifacts"), process.platform === "win32" ? "junction" : "dir")
    const store = new ArtifactStore({ workspace })
    const failure = await store
      .write({ sessionID: "ses_1", tool: "console", params: {}, data: "secret", ext: "json" })
      .catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(Error)
    expect(await Bun.file(path.join(outside, "ses_1")).exists()).toBe(false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})