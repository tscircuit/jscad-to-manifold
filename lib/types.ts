export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Mat4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]

/** Structural interfaces: consumers do not need manifold-3d to resolve our types. */
export interface SolidLike<S> {
  translate(v: Vec3): S
  rotate(v: Vec3): S
  scale(v: Vec3): S
  transform(m: Mat4): S
  status(): string
  delete(): void
}
export interface CrossSectionLike<S, C> {
  translate(v: Vec2): C
  rotate(degrees: number): C
  scale(v: Vec2): C
  transform(m: Mat3): C
  extrude(height: number, divisions?: number, twistDegrees?: number): S
  revolve(segments?: number, degrees?: number): S
  bounds(): {min: Vec2; max: Vec2}
  delete(): void
}
export interface MeshLike { merge(): boolean }
export interface ManifoldModule<S, C, M> {
  Manifold: {
    cube(size: Vec3, center?: boolean): S
    sphere(radius: number, segments?: number): S
    cylinder(height: number, radiusLow: number, radiusHigh?: number, segments?: number, center?: boolean): S
    union(shapes: NoInfer<S>[]): S
    difference(shapes: NoInfer<S>[]): S
    intersection(shapes: NoInfer<S>[]): S
    hull(shapes: NoInfer<S>[]): S
    ofMesh(mesh: M): S
  }
  CrossSection: {
    new(contours: Vec2[][], fillRule?: "EvenOdd" | "NonZero"): C
    square(size: Vec2, center?: boolean): C
    union(shapes: NoInfer<C>[]): C
    difference(shapes: NoInfer<C>[]): C
    intersection(shapes: NoInfer<C>[]): C
    hull(shapes: NoInfer<C>[]): C
  }
  Mesh: new(options: {numProp: number; vertProperties: Float32Array; triVerts: Uint32Array}) => M
}
export interface JscadToManifoldOptions<S, C, M> {
  /** Initialized module from await Manifold(); call module.setup() before conversion. */
  manifold: ManifoldModule<S, C, M>
}
