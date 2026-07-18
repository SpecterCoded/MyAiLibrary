import type { GraphNode, GraphLink } from "./types";

export const INITIAL_NODES: GraphNode[] = [
  {
    id: "digital-garden",
    title: "Digital Garden",
    type: "concept",
    tags: ["learning", "knowledge-management", "publishing"],
    content: `# Digital Gardens: A Modern Way of Organizing Thought

A **Digital Garden** is a medium-density knowledge web that rejects the traditional, chronologically rigid format of blog posts. Instead of polished, static articles, a garden houses **live, interconnected notes** that grow over time.

## Key Characteristics
- **Non-Chronological**: Content is organized by topic and relation, not publication date.
- **Continuous Cultivation**: Notes are draft-like, and updated incrementally (from sprouts to evergreen trees).
- **Interconnectedness**: High use of bidirectional links (wikilinks) to create a web of ideas rather than a flat list.

This exact Applet is modeled on the concept of a Digital Garden, allowing you to visually explore the links between thoughts. Every node you click reveals its current status and connections!`,
  },
  {
    id: "node-graph-post",
    title: "The Node Graph Visualizer",
    type: "post",
    tags: ["ux", "canvas", "interactive"],
    content: `# The Node Graph Visualizer: Behind the Scenes
    
One of the most satisfying elements of a digital garden is its **Interactive Node Graph**. It offers an immediate birds-eye-view of your mental network.

## How It's Rendered
Many graphs use pure SVG. However, SVG can degrade in performance past a few hundred nodes.
Using standard **HTML5 Canvas API** allows us to render thousands of circles, labels, and Bezier connections at **60fps** with full drag, zoom, and dynamic physics calculation.

### Design Touchpoints
- **Curved Connection Beziers**: Straight lines look analytical; gentle curves feel organic.
- **Dynamic Halo Effects**: Creating subcircles of radial light gradients behind selected or hovered nodes.
- **Adaptive Level-of-Detail (LoD) Typography**: Labels fade out gracefully when zooming far away to avoid clutter, and expand as you zoom into local neighborhoods.`,
  },
  {
    id: "d3-physics",
    title: "D3 Force Simulation",
    type: "concept",
    tags: ["physics", "math", "simulation"],
    content: `# Under the Hood: D3 Force Simulation

To arrange nodes in a self-organizing layout, we use **D3-force**. It runs an iterative Verlet integration physics engine on particle nodes.

## The Balancing Act of Forces
1. **Many-Body Repulsion (Charge)**: Nodes act like magnets of the same pole, pushing each other away (\`d3.forceManyBody()\`).
2. **Link Force**: Edges act like elastic rubber bands pulling connected nodes together (\`d3.forceLink()\`).
3. **Radial Pull (Centering)**: Prevents the graph from drifting off into the void of coordinate \`0,0\` (\`d3.forceCenter()\`).
4. **Collision Force**: Gives nodes a physical radius to prevent overlapping (\`d3.forceCollide()\`).

Configure these parameters in real-time using the **Graph Settings** dashboard on the left!`,
  },
  {
    id: "canvas-vs-svg",
    title: "Canvas vs SVG rendering",
    type: "post",
    tags: ["performance", "web-gamedev", "d3"],
    content: `# Render Benchmarks: Canvas vs. SVG
    
When building graphs, devs face a fork in the road:
- **SVG (Scalable Vector Graphics)**: Declarative, easy CSS styling, native hover/click events, but slow with 1000+ items.
- **Canvas (Immediate 2D Context)**: Extremely fast buffering, manual redraw cycle, manual event hit-testing.
    
| Feature | SVG | Canvas |
| :--- | :---: | :---: |
| Styling | Easy CSS | JS API |
| Click Detection | Built-in | Math-based |
| High Node Counts | Redundant DOM | 60 FPS Native |
| Accessibility | Screen-ready | Bitmap Screenreader |

**Our implementation uses HTML5 Canvas** because we want smooth zoom-pan inertial physics and glowing canvas shadows!`,
  },
  {
    id: "obsidian-links",
    title: "Obsidian Bidirectional Linking",
    type: "project",
    tags: ["obsidian", "markdown", "knowledge-management"],
    content: `# The Obsidian Workflow: Linking Notes
    
Obsidian revolutionized personal knowledge bases by bringing local Markdown files together with bidirectional links (\`[[WikiLinks]]\`).
    
## Visualizing Connections
When Note A links to Note B, they form an edge. This app simulates that structure:
- Try clicking **Create Node** on the control panel.
- Define a list of connections to see the physics simulation rearrange immediately.
- Hovering over a node highlights its direct links while fading out the unrelated nodes to guide your attention.`,
  },
  {
    id: "user-interaction",
    title: "UX: Drag, Zoom, Pan, & Kinetic Inertia",
    type: "post",
    tags: ["ux", "interaction", "fluidity"],
    content: `# Crafting Fluid UX in Graphics
    
A network visualization is only as good as its interaction model. Static networks feel dead. Let's make it feel alive:
- **Inertial Zooming**: Standard scroll wheels are jagged. We interpolate scale change smoothly.
- **Sticky Dragging**: Dragging a node in D3 temporarily sets its permanent position coordinates (\`fx\`, \`fy\`), locking it in place. Double-clicking releases it back into the wild wind.
- **Dynamic Halo Glow**: Active components light up. Selected nodes glow with background radial shadows.`,
  },
  {
    id: "joshw-inspiration",
    title: "Josh W.'s Style Inspiration",
    type: "system",
    tags: ["typography", "branding", "joshw.io"],
    content: `# Design Tone & Typographic Style

This app's design is inspired by modern minimal technical blogs like **joshw.io**:
- Subtle cosmic grid background.
- Clean typography pairing: high-contrast headings with mono-spaced elements.
- Fluid negative space.
- Understated glowing borders.
- Soft, sophisticated palette instead of standard harsh primary colors.
`,
  },
  {
    id: "react-19-integration",
    title: "React & D3 Hybrid Architecture",
    type: "project",
    tags: ["react", "d3", "state"],
    content: `# Joining React State with D3 Physics

Integrating React with D3 can be tricky. Both want to control the DOM:
1. **React** controls the surrounding state, forms, details panels, and configurations.
2. **D3-force** controls coordinate math on frame ticks.
3. **HTML5 Canvas** handles the raw drawing.

## The Golden Solution
We let React manage the declarative state (active node ID, physics coefficient numbers, node array edits) and use a React \`useRef\` hook to feed the canvas element to a local D3 instantiation. 
When state updates, we smoothly inject modified elements directly into the simulation and trigger active tick redraws, combining the best of both world: high-performance animation and single-state synchronization!`,
  },
  {
    id: "performance-tag",
    title: "Performance",
    type: "tag",
    content: `# Tag: Performance
Contains all nodes related to keeping graphics compiling at maximum speed and handling high-density element structures.`,
  },
  {
    id: "ux-tag",
    title: "User Experience",
    type: "tag",
    content: `# Tag: User Experience (UX)
Highlights note nodes detailing user interface mechanics, dragging kinetics, and adaptive details layouts.`,
  },
  {
    id: "math-tag",
    title: "Mathematics",
    type: "tag",
    content: `# Tag: Mathematics
Focuses on the Verlet physics, bounding-box geometry, force vectors, and spring equations used in web simulations.`,
  },
];

export const INITIAL_LINKS: GraphLink[] = [
  { id: "l1", source: "digital-garden", target: "node-graph-post", linkType: "contain" },
  { id: "l2", source: "digital-garden", target: "obsidian-links", linkType: "reference" },
  { id: "l3", source: "node-graph-post", target: "canvas-vs-svg", linkType: "contain" },
  { id: "l4", source: "node-graph-post", target: "user-interaction", linkType: "contain" },
  { id: "l5", source: "node-graph-post", target: "d3-physics", linkType: "reference" },
  { id: "l6", source: "d3-physics", target: "react-19-integration", linkType: "reference" },
  { id: "l7", source: "obsidian-links", target: "react-19-integration", linkType: "reference" },
  { id: "l8", source: "node-graph-post", target: "joshw-inspiration", linkType: "reference" },
  { id: "l9", source: "canvas-vs-svg", target: "performance-tag", linkType: "reference" },
  { id: "l10", source: "react-19-integration", target: "performance-tag", linkType: "reference" },
  { id: "l11", source: "user-interaction", target: "ux-tag", linkType: "reference" },
  { id: "l12", source: "digital-garden", target: "ux-tag", linkType: "reference" },
  { id: "l13", source: "d3-physics", target: "math-tag", linkType: "reference" },
];
