import earcut from "earcut"
import { assertTransformMatrix, resolveReferencePlanes, type JscadOperation, type JscadPolygon3 } from "jscad-planner"
import type { CrossSectionLike, JscadToManifoldOptions, Mat3, MeshLike, SolidLike, Vec2, Vec3 } from "./types.js"
export type * from "./types.js"
export type { JscadOperation } from "jscad-planner"

const degrees = (radians: number) => radians * 180 / Math.PI
const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}
const positive = (value: number, name: string): number => {
  if (finite(value, name) <= 0) throw new Error(`${name} must be positive`)
  return value
}
const vector = (value: number[], length: number, name: string) => {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${name} must have ${length} components`)
  value.forEach((v) => finite(v, name))
}
const segments = (value: number | undefined) => {
  const result = value ?? 32
  if (!Number.isInteger(result) || result < 4) throw new Error("segments/resolution must be an integer >= 4")
  return result
}

/** Evaluate a geometry plan. The caller owns (and must delete) the returned solid. */
export function jscadToManifold<S extends SolidLike<S>, C extends CrossSectionLike<S, C>, M extends MeshLike>(
  tree: JscadOperation | JscadOperation[], options: JscadToManifoldOptions<S, C, M>,
): S {
  const module = options?.manifold
  if (!module?.Manifold || !module.CrossSection || !module.Mesh) {
    throw new Error("Provide an initialized manifold-3d module in options.manifold")
  }
  const { geometry } = resolveReferencePlanes(tree)
  if (!geometry || (Array.isArray(geometry) && geometry.length === 0)) throw new Error("JSCAD plan contains no solid geometry")
  const { Manifold, CrossSection, Mesh } = module
  const allocated = new Set<S | C>()
  type Value = { kind: "solid"; value: S } | { kind: "section"; value: C }
  const solid = (value: S): Value => { allocated.add(value); return { kind: "solid", value } }
  const section = (value: C): Value => { allocated.add(value); return { kind: "section", value } }
  const requireSolid = (value: Value): S => {
    if (value.kind !== "solid") throw new Error("Expected a 3D solid; extrude 2D geometry first")
    return value.value
  }
  const requireSection = (value: Value): C => {
    if (value.kind !== "section") throw new Error("Extrusion requires a 2D cross section")
    return value.value
  }
  const combine = (type: "union" | "subtract" | "intersect" | "hull", values: Value[]): Value => {
    if (!values.length) throw new Error(`${type} requires at least one shape`)
    if (values.some((v) => v.kind !== values[0].kind)) throw new Error(`${type} cannot mix 2D and 3D geometry`)
    if (values.length === 1) return values[0]
    const method = type === "subtract" ? "difference" : type === "intersect" ? "intersection" : type
    return values[0].kind === "solid"
      ? solid(Manifold[method](values.map(requireSolid)))
      : section(CrossSection[method](values.map(requireSection)))
  }
  const centered = (shape: Value, center: Vec3 | undefined): Value => {
    if (!center) return shape
    vector(center, 3, "center")
    return solid(requireSolid(shape).translate(center))
  }
  const meshSolid = (polygons: JscadPolygon3[]): Value => {
    const vertices: number[] = [], triangles: number[] = []
    const vertexIndices = new Map<string, number>()
    for (const { vertices: face } of polygons) {
      if (face.length < 3) throw new Error("createGeom3 polygons require at least three vertices")
      face.forEach((v) => vector(v, 3, "polygon vertex"))
      const normal: Vec3 = [0, 0, 0]
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length]
        normal[0] += (a[1] - b[1]) * (a[2] + b[2])
        normal[1] += (a[2] - b[2]) * (a[0] + b[0])
        normal[2] += (a[0] - b[0]) * (a[1] + b[1])
      })
      const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)))
      if (!normal[axis]) throw new Error("createGeom3 contains a degenerate polygon")
      const u = (axis + 1) % 3, v = (axis + 2) % 3
      const projected = face.flatMap((point) => [point[u], point[v]])
      const indices = face.map((point) => {
        const key = point.join(",")
        let index = vertexIndices.get(key)
        if (index === undefined) {
          index = vertices.length / 3
          vertexIndices.set(key, index)
          vertices.push(...point)
        }
        return index
      })
      const local = earcut(projected)
      for (let i = 0; i < local.length; i += 3) {
        const a = local[i], b = local[i + 1], c = local[i + 2]
        const cross = (projected[2*b] - projected[2*a]) * (projected[2*c+1] - projected[2*a+1]) - (projected[2*b+1] - projected[2*a+1]) * (projected[2*c] - projected[2*a])
        triangles.push(indices[a], indices[cross * normal[axis] > 0 ? b : c], indices[cross * normal[axis] > 0 ? c : b])
      }
    }
    const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(vertices), triVerts: new Uint32Array(triangles) })
    mesh.merge()
    return solid(Manifold.ofMesh(mesh))
  }
  const evaluate = (op: JscadOperation): Value => {
    if (!op || typeof op !== "object") throw new Error("Expected a jscad-planner operation")
    switch (op.type) {
      case "cube": case "cuboid": {
        const size = op.size ?? 2
        const dimensions: Vec3 = typeof size === "number" ? [size, size, size] : [...size] as Vec3
        vector(dimensions, 3, "size")
        dimensions.forEach((v) => positive(v, "size"))
        return centered(solid(Manifold.cube(dimensions, true)), "center" in op ? op.center : undefined)
      }
      case "sphere":
        return centered(solid(Manifold.sphere(positive(op.radius ?? 1, "radius"), segments(op.resolution))), op.center)
      case "cylinder":
        return centered(solid(Manifold.cylinder(positive(op.height ?? 2, "height"), positive(op.radius ?? 1, "radius"), op.radius ?? 1, segments(op.resolution), true)), op.center)
      case "roundedCuboid": {
        vector(op.size, 3, "size")
        const radius = positive(op.roundRadius, "roundRadius")
        if (op.size.some((v) => positive(v, "size") <= radius * 2)) throw new Error("roundRadius must be less than half every size component")
        const ball = requireSolid(solid(Manifold.sphere(radius, segments(op.segments))))
        const corners: Value[] = []
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          corners.push(solid(ball.translate([x*(op.size[0]/2-radius), y*(op.size[1]/2-radius), z*(op.size[2]/2-radius)])))
        }
        return combine("hull", corners)
      }
      case "rectangle": {
        vector(op.size, 2, "size")
        op.size.forEach((v) => positive(v, "size"))
        const result = section(CrossSection.square(op.size, true))
        if (!op.center) return result
        vector(op.center, 2, "center")
        return section(requireSection(result).translate(op.center))
      }
      case "polygon": {
        const points = op.points
        const nested = Array.isArray(points[0]?.[0])
        const flat: Vec2[] = nested ? (points as Vec2[][]).flat() : points as Vec2[]
        let contours: Vec2[][]
        if (op.paths) {
          const paths = typeof op.paths[0] === "number" ? [op.paths as number[]] : op.paths as number[][]
          contours = paths.map((path) => path.map((i) => {
            if (!Number.isInteger(i) || !flat[i]) throw new Error("polygon path index is out of range")
            return flat[i]
          }))
        } else contours = nested ? points as Vec2[][] : [flat]
        contours.forEach((contour) => {
          if (contour.length < 3) throw new Error("polygon requires at least three points per contour")
          contour.forEach((v) => vector(v, 2, "polygon point"))
        })
        return section(new CrossSection(contours, "EvenOdd"))
      }
      case "fromPointsGeom2": return evaluate({ type: "polygon", points: op.points })
      case "createGeom2": throw new Error("createGeom2 uses JSCAD directed sides; use fromPointsGeom2 or polygon")
      case "createGeom3": return meshSolid(op.polygons)
      case "union": case "subtract": case "intersect": case "hull": return combine(op.type, op.shapes.map(evaluate))
      case "hullChain": {
        const shapes = op.shapes.map(evaluate)
        if (shapes.length < 2) throw new Error("hullChain requires at least two shapes")
        return combine("union", shapes.slice(1).map((shape, i) => combine("hull", [shapes[i], shape])))
      }
      case "colorize": case "applyMaterial": return evaluate(op.shape)
      case "translate": case "scale": {
        const shape = evaluate(op.shape)
        const values = op.type === "translate" ? op.vector : op.factors
        if (values.length !== 2 && values.length !== 3) throw new Error(`${op.type} requires 2 or 3 components`)
        values.forEach((v) => finite(v, op.type))
        if (op.type === "scale" && values.some((v) => v === 0)) throw new Error("scale factors must be nonzero")
        if (shape.kind === "section") {
          if (op.type === "translate" && values[2]) throw new Error("2D translation must remain in the XY plane; translate after extrusion")
          return section(shape.value[op.type]([values[0], values[1]]))
        }
        return solid(shape.value[op.type]([values[0], values[1], values[2] ?? (op.type === "scale" ? 1 : 0)]))
      }
      case "rotate": case "rotateX": case "rotateY": case "rotateZ": {
        const shape = evaluate(op.shape)
        const angles: Vec3 = [0, 0, 0]
        if (op.type === "rotate") {
          vector(op.angles, 3, "angles")
          angles.splice(0, 3, ...op.angles)
        } else angles[op.type === "rotateX" ? 0 : op.type === "rotateY" ? 1 : 2] = finite(op.angle, "angle")
        if (shape.kind === "section") {
          if (angles[0] || angles[1]) throw new Error("2D rotation must remain in the XY plane; rotate after extrusion")
          return section(shape.value.rotate(degrees(angles[2])))
        }
        let result: Value = shape
        for (let axis = 0; axis < 3; axis++) if (angles[axis]) {
          const rotation: Vec3 = [0, 0, 0]
          rotation[axis] = degrees(angles[axis])
          result = solid(requireSolid(result).rotate(rotation))
        }
        return result
      }
      case "transform": {
        assertTransformMatrix(op.matrix)
        const m = op.matrix
        if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) throw new Error("Manifold requires an affine transform matrix")
        const shape = evaluate(op.shape)
        if (shape.kind === "solid") return solid(shape.value.transform(m))
        if (m[2] || m[6] || m[14]) throw new Error("2D transform must remain in the XY plane")
        const matrix: Mat3 = [m[0], m[1], 0, m[4], m[5], 0, m[12], m[13], 1]
        return section(shape.value.transform(matrix))
      }
      case "extrudeLinear": {
        const height = finite(op.options.height, "height")
        if (!height) throw new Error("Extrusion height must be nonzero")
        const twist = finite(op.options.twistAngle ?? 0, "twistAngle")
        const steps = op.options.twistSteps ?? 1
        if (!Number.isInteger(steps) || steps < 1) throw new Error("twistSteps must be a positive integer")
        const result = solid(requireSection(evaluate(op.shape)).extrude(Math.abs(height), twist ? steps - 1 : 0, degrees(twist)))
        return height < 0 ? solid(requireSolid(result).scale([1, 1, -1])) : result
      }
      case "extrudeRotate": {
        const angle = finite(op.options.angle ?? 2*Math.PI, "angle")
        if (angle <= 0 || angle > 2*Math.PI) throw new Error("Revolve angle must be in (0, 2π]")
        const start = finite(op.options.startAngle ?? 0, "startAngle")
        const profile = requireSection(evaluate(op.shape))
        if (profile.bounds().min[0] < 0) throw new Error("Revolve profile must lie in x >= 0")
        const result = solid(profile.revolve(Math.max(4, Math.ceil(segments(op.options.segments ?? 12) * angle / (2*Math.PI))), degrees(angle)))
        return start ? solid(requireSolid(result).rotate([0, 0, degrees(start)])) : result
      }
      default: throw new Error(`Unsupported geometry operation: ${op.type}`)
    }
  }
  let output: S | undefined
  try {
    const roots = Array.isArray(geometry) ? geometry : [geometry]
    output = requireSolid(combine("union", roots.map(evaluate)))
    const status = output.status()
    if (status !== "NoError") throw new Error(`Manifold conversion failed: ${status}`)
    return output
  } catch (error) {
    output = undefined
    throw error
  } finally {
    for (const value of allocated) if (value !== output) value.delete()
  }
}
export const convertJscadToManifold = jscadToManifold
