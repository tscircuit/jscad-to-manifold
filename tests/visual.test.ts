import { beforeAll, test } from "bun:test"
import Module, { type ManifoldToplevel } from "manifold-3d"
import { jscadPlanner as p, type JscadOperation, type JscadPolygon3 } from "jscad-planner"
import { createRequire } from "node:module"
import { jscadToManifold } from "../lib/index.js"
import { expectVisualSnapshot } from "./fixtures/visual-snapshot.js"

const jscad = createRequire(import.meta.url)("@jscad/modeling")
let manifold: ManifoldToplevel
beforeAll(async () => { manifold = await Module(); manifold.setup() })

const plate = p.booleans.subtract(
  p.primitives.cuboid({ size: [20, 16, 4] }),
  ...[-6, 6].flatMap((x) => [-4, 4].map((y) =>
    p.primitives.cylinder({ radius: 2, height: 10, center: [x, y, 0], resolution: 32 }),
  )),
)
const housing = p.booleans.subtract(
  p.primitives.roundedCuboid({ size: [20, 16, 10], roundRadius: 1.5, segments: 24 }),
  p.transforms.translate([0, 0, 2], p.primitives.cuboid({ size: [16, 12, 10] })),
)
const twisted = p.extrusions.extrudeLinear({ height: 12, twistAngle: Math.PI / 2, twistSteps: 24 },
  p.primitives.polygon({
    points: [[-5,-5],[5,-5],[5,5],[-5,5],[-2,-2],[2,-2],[2,2],[-2,2]],
    paths: [[0,1,2,3],[4,5,6,7]],
  }),
)
const revolved = p.extrusions.extrudeRotate({ angle: Math.PI * 1.5, startAngle: Math.PI / 4, segments: 64 },
  p.primitives.polygon({ points: [[4,0],[8,0],[8,2],[6,2],[6,6],[4,6]] }),
)
const polygons: JscadPolygon3[] = jscad.geometries.geom3.toPolygons(
  jscad.extrusions.extrudeLinear({ height: 4 }, jscad.primitives.polygon({
    points: [[-8,-6],[8,-6],[8,-2],[-2,-2],[-2,6],[-8,6]],
  })),
)
const customMesh = p.transforms.rotate([0.2, 0.3, 0.4], p.geometries.geom3.create(polygons))
const cases: [string, JscadOperation][] = [
  ["plate-with-holes", plate],
  ["rounded-housing", housing],
  ["twisted-polygon-with-hole", twisted],
  ["partial-revolution", revolved],
  ["transformed-concave-mesh", customMesh],
]
for (const [name, tree] of cases) {
  test(`visual: ${name}`, async () => {
    const solid = jscadToManifold(JSON.parse(JSON.stringify(tree)), { manifold })
    try { await expectVisualSnapshot(name, solid) } finally { solid.delete() }
  }, 30_000)
}
