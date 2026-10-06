import { beforeAll, expect, test } from "bun:test"
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d"
import { jscadPlanner as p, executeJscadOperations, type JscadOperation, type JscadPolygon3, type Matrix4 } from "jscad-planner"
import { createRequire } from "node:module"
import { jscadToManifold } from "../lib/index.js"
const jscad = createRequire(import.meta.url)("@jscad/modeling")
let manifold: ManifoldToplevel
beforeAll(async () => { manifold = await Module(); manifold.setup() })
const convert = (tree: JscadOperation | JscadOperation[]): Manifold => jscadToManifold(tree, { manifold })
function check(tree: JscadOperation, volume?: number) {
  const result = convert(JSON.parse(JSON.stringify(tree)))
  try {
    expect(result.status()).toBe("NoError")
    expect(result.volume()).toBeCloseTo(volume ?? jscad.measurements.measureVolume(executeJscadOperations(jscad, tree)), 5)
    return result.boundingBox()
  } finally { result.delete() }
}

test("defaults and centered primitive placement", () => {
  expect(check(p.primitives.cube({}))).toEqual({ min: [-1,-1,-1], max: [1,1,1] })
  expect(check(p.primitives.cube({size: 4, center: [10,20,30]}))).toEqual({min: [8,18,28], max: [12,22,32]})
  check(p.primitives.cuboid({size: [2,4,6]}), 48)
  const cylinder = convert(p.primitives.cylinder({radius: 2, height: 6, center: [1,2,3], resolution: 64}))
  try {
    expect(cylinder.boundingBox()).toEqual({min:[-1,0,0], max:[3,4,6]})
    expect(cylinder.volume()).toBeCloseTo(Math.PI*24, 0)
  } finally { cylinder.delete() }
  const sphere = convert(p.primitives.sphere({ radius: 2, center: [1,2,3] }))
  try { expect(sphere.boundingBox()).toEqual({min:[-1,0,1], max:[3,4,5]}) } finally { sphere.delete() }
})
test("boolean union, intersection, subtraction and multiple roots", () => {
  const a = p.primitives.cube({size: 2}), b = p.transforms.translate([1,0,0], a)
  check(p.booleans.union(a,b), 12)
  check(p.booleans.intersect(a,b), 4)
  check(p.booleans.subtract(a,b), 4)
  const result = convert([a,b]); try { expect(result.volume()).toBeCloseTo(12,8) } finally { result.delete() }
})
test("radian rotation, scale, translation and Euler order match JSCAD bounds", () => {
  const tree = p.transforms.translate([10,20,30], p.transforms.rotate([0.3,0.5,0.7], p.transforms.scale([2,3,4], p.primitives.cuboid({size:[2,4,6]}))))
  const bounds = check(tree)
  const expected = jscad.measurements.measureBoundingBox(executeJscadOperations(jscad,tree))
  for (let i=0;i<3;i++) { expect(bounds.min[i]).toBeCloseTo(expected[0][i],7); expect(bounds.max[i]).toBeCloseTo(expected[1][i],7) }
  expect(check(p.transforms.rotateZ(Math.PI/2,p.primitives.cuboid({size:[2,4,6]})))).toEqual({min:[-2,-1,-3],max:[2,1,3]})
})
test("column-major affine transform and reflection", () => {
  const matrix: Matrix4 = [-2,0,0,0, 0,3,0,0, 0,0,4,0, 10,20,30,1]
  expect(check(p.transforms.transform(matrix,p.primitives.cube({size:2})),192)).toEqual({min:[8,17,26],max:[12,23,34]})
})
test("2D booleans and transformed sections extrude from z=0", () => {
  const shape = p.booleans.subtract(p.primitives.rectangle({size:[10,8]}),p.primitives.rectangle({size:[2,2]}))
  const tree = p.extrusions.extrudeLinear({height:3},p.transforms.translate([5,6],p.transforms.rotateZ(Math.PI/2,shape)))
  expect(check(tree,228)).toEqual({min:[1,1,0],max:[9,11,3]})
  expect(check(p.extrusions.extrudeLinear({height:-3},p.primitives.rectangle({size:[2,4]})),24)).toEqual({min:[-1,-2,-3],max:[1,2,0]})
})
test("polygon with indexed hole", () => {
  check(p.extrusions.extrudeLinear({height:2},p.primitives.polygon({points:[[0,0],[10,0],[10,10],[0,10],[3,3],[7,3],[7,7],[3,7]],paths:[[0,1,2,3],[4,5,6,7]]})),168)
})
test("linear twist and full/partial revolution produce valid solids", () => {
  const twist = convert(p.extrusions.extrudeLinear({height:4,twistAngle:Math.PI/2,twistSteps:32},p.primitives.rectangle({size:[2,2]})))
  try { expect(twist.status()).toBe("NoError"); expect(twist.boundingBox().max[2]).toBe(4) } finally { twist.delete() }
  const profile = p.primitives.polygon({points:[[2,0],[3,0],[3,4],[2,4]]})
  const full = convert(p.extrusions.extrudeRotate({segments:64},profile))
  const half = convert(p.extrusions.extrudeRotate({segments:64,angle:Math.PI,startAngle:Math.PI/2},profile))
  try { expect(full.volume()).toBeCloseTo(Math.PI*20,0); expect(half.volume()).toBeCloseTo(full.volume()/2,4); expect(half.boundingBox().max[0]).toBeCloseTo(0,6) } finally {full.delete();half.delete()}
})
test("hull, hullChain and rounded cuboid", () => {
  const cubes = [0,4,8].map((x)=>p.primitives.cube({size:2,center:[x,0,0]}))
  check(p.hulls.hull(...cubes),40)
  check(p.hulls.hullChain(...cubes),40)
  const result = convert(p.primitives.roundedCuboid({size:[4,6,8],roundRadius:0.5,segments:16}))
  try { expect(result.status()).toBe("NoError"); expect(result.boundingBox()).toEqual({min:[-2,-3,-4],max:[2,3,4]}); expect(result.volume()).toBeLessThan(192) } finally {result.delete()}
})
test("native JSCAD polygon objects and concave mesh faces", () => {
  const geometry = jscad.extrusions.extrudeLinear({height:3},jscad.primitives.polygon({points:[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]]}))
  const polygons: JscadPolygon3[] = jscad.geometries.geom3.toPolygons(geometry)
  check(p.geometries.geom3.create(polygons),21)
})
test("reference planes and appearance wrappers do not enter fabrication geometry", () => {
  const tree = p.booleans.union(p.primitives.cube({size:2}),p.primitives.rectangle({size:[100,100],name:"board",reference:true}))
  check(tree,8)
  check(p.colors.colorize([1,0,0],p.primitives.cube({size:2})),8)
})
test("unsupported non-solids, malformed matrices and mixed dimensions fail clearly", () => {
  expect(()=>convert(p.primitives.rectangle({size:[2,2]}))).toThrow("extrude")
  expect(()=>convert(p.measurements.measureVolume(p.primitives.cube({size:2})))).toThrow("Unsupported")
  expect(()=>convert(p.booleans.union(p.primitives.cube({size:2}),p.primitives.rectangle({size:[2,2]})))).toThrow("mix")
  expect(()=>convert({type:"transform",matrix:[1,2] as unknown as Matrix4,shape:p.primitives.cube({})})).toThrow()
  expect(()=>convert({type:"cube",size:NaN})).toThrow("finite")
  expect(()=>convert([])).toThrow("no solid")
  expect(()=>convert(p.primitives.rectangle({size:[2,2],name:"board",reference:true}))).toThrow("no solid")
})

test("conversion releases intermediate WASM objects on success and failure", () => {
  const deleted = new Set<Manifold>()
  const track = (value: Manifold): Manifold => {
    const originalDelete = value.delete.bind(value)
    const originalTranslate = value.translate.bind(value)
    value.delete = () => { deleted.add(value); originalDelete() }
    value.translate = ((vector: readonly [number,number,number]) => track(originalTranslate(vector))) as typeof value.translate
    return value
  }
  const instrumented: typeof manifold.Manifold = Object.create(manifold.Manifold)
  instrumented.cube = (size, center) => track(manifold.Manifold.cube(size, center))
  instrumented.union = ((shapes: Manifold[]) => track(manifold.Manifold.union(shapes))) as typeof instrumented.union
  const injected = {...manifold, Manifold: instrumented}
  const result = jscadToManifold(p.booleans.union(p.primitives.cube({size:2}),p.transforms.translate([1,0,0],p.primitives.cube({size:2}))), {manifold: injected})
  expect(deleted.size).toBe(3)
  expect(deleted.has(result)).toBe(false)
  expect(result.volume()).toBeCloseTo(12,8)
  result.delete()
  expect(deleted.has(result)).toBe(true)
  const beforeFailure = deleted.size
  expect(()=>jscadToManifold(p.booleans.union(p.primitives.cube({size:2}),p.measurements.measureVolume(p.primitives.cube({size:2}))), {manifold: injected})).toThrow("Unsupported")
  expect(deleted.size).toBe(beforeFailure+1)
})
test("input remains unchanged; invalid open meshes and missing injection fail", () => {
  const tree = p.transforms.translate([1,2,3],p.primitives.cube({size:2}))
  const before = JSON.stringify(tree)
  const solid = convert(tree)
  solid.delete()
  expect(JSON.stringify(tree)).toBe(before)
  expect(()=>convert(p.geometries.geom3.create([{vertices:[[0,0,0],[1,0,0],[0,1,0]]}]))).toThrow("manifold")
  expect(()=>jscadToManifold(tree,{} as never)).toThrow("initialized")
  expect(()=>convert(p.extrusions.extrudeRotate({},p.primitives.rectangle({size:[2,2]})))).toThrow("x >= 0")
})
