/**
 * WebGL objects for the `?fps=1` badge (#501): buffers, textures and vertex
 * arrays made and freed, and shader programs linked, on one context, counted
 * from when the badge first saw it (a lost context's rebuild starts again). Something that piles up while a scene only plays (a
 * buffer per find, a texture per celebration) shows as a gap between made
 * and freed that keeps widening. Wrapped on the context itself, and only
 * once the badge is mounted, so nobody else pays.
 */
export interface GlCounts {
  buffersMade: number;
  buffersFreed: number;
  texturesMade: number;
  texturesFreed: number;
  vertexArraysMade: number;
  vertexArraysFreed: number;
  programs: number;
}

/** The context calls counted (a structural slice of WebGL2RenderingContext). */
export interface CountedGl {
  createBuffer(): unknown;
  deleteBuffer(buffer: object | null): void;
  createTexture(): unknown;
  deleteTexture(texture: object | null): void;
  createVertexArray(): unknown;
  deleteVertexArray(vertexArray: object | null): void;
  linkProgram(program: object): void;
}

const counted = new WeakMap<object, GlCounts>();

/** Starts counting on `gl` (once per context) and returns its live counts. */
export function countGl(gl: CountedGl): GlCounts {
  const known = counted.get(gl);
  if (known) return known;
  const counts: GlCounts = {
    buffersMade: 0,
    buffersFreed: 0,
    texturesMade: 0,
    texturesFreed: 0,
    vertexArraysMade: 0,
    vertexArraysFreed: 0,
    programs: 0,
  };
  counted.set(gl, counts);
  const createBuffer = gl.createBuffer.bind(gl);
  const deleteBuffer = gl.deleteBuffer.bind(gl);
  const createTexture = gl.createTexture.bind(gl);
  const deleteTexture = gl.deleteTexture.bind(gl);
  const createVertexArray = gl.createVertexArray.bind(gl);
  const deleteVertexArray = gl.deleteVertexArray.bind(gl);
  const linkProgram = gl.linkProgram.bind(gl);
  gl.createBuffer = () => {
    const made = createBuffer();
    if (made) counts.buffersMade++;
    return made;
  };
  gl.deleteBuffer = (buffer) => {
    if (buffer) counts.buffersFreed++;
    deleteBuffer(buffer);
  };
  gl.createTexture = () => {
    const made = createTexture();
    if (made) counts.texturesMade++;
    return made;
  };
  gl.deleteTexture = (texture) => {
    if (texture) counts.texturesFreed++;
    deleteTexture(texture);
  };
  gl.createVertexArray = () => {
    const made = createVertexArray();
    if (made) counts.vertexArraysMade++;
    return made;
  };
  gl.deleteVertexArray = (vertexArray) => {
    if (vertexArray) counts.vertexArraysFreed++;
    deleteVertexArray(vertexArray);
  };
  gl.linkProgram = (program) => {
    counts.programs++;
    linkProgram(program);
  };
  return counts;
}
