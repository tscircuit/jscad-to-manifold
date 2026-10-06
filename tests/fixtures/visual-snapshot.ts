import { expect } from "bun:test"
import { Document, NodeIO } from "@gltf-transform/core"
import { writeMesh, type Properties } from "manifold-3d/lib/gltf-io"
import type { Manifold } from "manifold-3d"
import { renderGLTFToPNGFromGLB } from "poppygl"
import { PNG } from "pngjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const snapshots = fileURLToPath(new URL("../__snapshots__/", import.meta.url))
const artifacts = fileURLToPath(new URL("../__artifacts__/", import.meta.url))
const update = process.env.UPDATE_SNAPSHOTS === "1"

/** Export a standard self-contained GLB for PoppyGL (no manifold extension required). */
export async function solidToGlb(solid: Manifold): Promise<Uint8Array> {
  const doc = new Document()
  const material = doc.createMaterial("snapshot-blue")
    .setBaseColorFactor([0.12, 0.42, 0.72, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.7)
  const mesh = solid.getMesh()
  const properties = new Map<number, Properties>()
  for (const id of mesh.runOriginalID) properties.set(id, { material, attributes: ["POSITION"] })
  const gltfMesh = writeMesh(doc, mesh, properties, false)
  doc.createScene("snapshot").addChild(doc.createNode("solid").setMesh(gltfMesh))
  return new NodeIO().writeBinary(doc)
}

export async function expectVisualSnapshot(name: string, solid: Manifold): Promise<void> {
  const glb = await solidToGlb(solid)
  const png = Buffer.from(await renderGLTFToPNGFromGLB(Buffer.from(glb), {
    width: 480,
    height: 480,
    realistic: true,
    supersampling: 1,
    camPos: [32, -40, 30],
    lookAt: [0, 0, 2],
    up: "z+",
    fov: 32,
    grid: false,
    backgroundColor: [1, 1, 1],
  }))
  const actual = PNG.sync.read(png)
  // Prevent accepting a blank render as a baseline.
  let foreground = 0
  for (let i = 0; i < actual.data.length; i += 4) {
    if (actual.data[i] < 240 || actual.data[i + 1] < 240 || actual.data[i + 2] < 240) foreground++
  }
  expect(foreground, `${name} must contain visible geometry`).toBeGreaterThan(1000)
  const path = `${snapshots}${name}.png`
  if (update) {
    mkdirSync(snapshots, { recursive: true })
    writeFileSync(path, png)
    return
  }
  if (!existsSync(path)) throw new Error(`Missing visual snapshot ${path}; run bun run snapshots:update`)
  const expected = PNG.sync.read(readFileSync(path))
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height])
  const diff = new PNG({ width: actual.width, height: actual.height })
  let differentPixels = 0
  for (let i = 0; i < actual.data.length; i += 4) {
    const changed = actual.data.subarray(i, i + 4).some((channel, offset) => channel !== expected.data[i + offset])
    if (changed) differentPixels++
    diff.data[i] = changed ? 255 : actual.data[i]
    diff.data[i + 1] = changed ? 0 : actual.data[i + 1]
    diff.data[i + 2] = changed ? 255 : actual.data[i + 2]
    diff.data[i + 3] = 255
  }
  if (differentPixels) {
    mkdirSync(artifacts, { recursive: true })
    writeFileSync(`${artifacts}${name}.actual.png`, png)
    writeFileSync(`${artifacts}${name}.diff.png`, PNG.sync.write(diff))
    writeFileSync(`${artifacts}${name}.glb`, glb)
  }
  expect(differentPixels, `${name}: visual regression; see tests/__artifacts__/`).toBe(0)
}
