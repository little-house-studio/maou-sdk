/**
 * Portfolio works — 3D gallery content + copy.
 */

export interface Work {
  id: string;
  title: string;
  year: string;
  medium: string;
  blurb: string;
  /** HSL base for mesh material */
  hue: number;
  sat: number;
  lit: number;
  form: "knot" | "icosa" | "torus" | "lathe" | "crystal";
}

export const ARTIST = {
  name: "MAOU STUDIO",
  role: "Spatial · Generative · Print",
  tagline: "canvas-ui living demo — HUD + Bayer + ASCII.",
  bio: "Showcase models for the canvas-ui filter library. Geometry is rendered with three.js and graded by ThreeFilterPipeline (GPU ordered dither / ASCII). Companion APIs cover Canvas2D HUD widgets and CPU ordered dither.",
  location: "Remote / CN",
  email: "studio@maou.local",
};

export const WORKS: Work[] = [
  {
    id: "w01",
    title: "Keep Resonance",
    year: "2026",
    medium: "Realtime sculpture · ASCII",
    blurb:
      "A knotted field of warm bronze. The surface is sampled at character resolution so the object dissolves into type when the eye rests.",
    hue: 0.08,
    sat: 0.45,
    lit: 0.48,
    form: "knot",
  },
  {
    id: "w02",
    title: "Paper Orbit",
    year: "2025",
    medium: "Lattice · Bayer dither",
    blurb:
      "Orbital rings over a stone void. Ordered dithering holds the midtones like ink on newsprint.",
    hue: 0.55,
    sat: 0.22,
    lit: 0.52,
    form: "torus",
  },
  {
    id: "w03",
    title: "Facet Archive",
    year: "2025",
    medium: "Icosahedron · monochrome",
    blurb:
      "Twenty faces, one memory. Hard edges survive the ASCII reduction better than soft gradients.",
    hue: 0.12,
    sat: 0.35,
    lit: 0.55,
    form: "icosa",
  },
  {
    id: "w04",
    title: "Vessel Study",
    year: "2024",
    medium: "Lathe body · warm ink",
    blurb:
      "A turning profile from a single curve. The filter reads silhouette first — type as pottery shard.",
    hue: 0.05,
    sat: 0.5,
    lit: 0.42,
    form: "lathe",
  },
  {
    id: "w05",
    title: "Crystal Index",
    year: "2026",
    medium: "Octa stack · dual tone",
    blurb:
      "Stacked octahedra as a catalog of cuts. Color mode tints glyphs without abandoning the grid.",
    hue: 0.72,
    sat: 0.28,
    lit: 0.5,
    form: "crystal",
  },
];
