import { describe, expect, it } from "vitest";
import type { GraphTeam, GraphTeamDetail } from "@scry/shared";
import {
  CLOSE_SPACING_PX,
  NODE_SPACING,
  OPEN_SPACING_PX,
  buildScene,
  fitCircles,
  layoutTeamInitiatives,
  layoutTeams,
  pickOpenTeams,
  placeLabels,
  prepareOpenTeam,
  teamCircleRadius,
  teamRadius,
  type Circle,
} from "./graph-map";

const team = (id: string, total: number, orgUnit: string | null = "Eng"): GraphTeam => ({
  id,
  name: id.toUpperCase(),
  orgUnit,
  total,
  connected: 0,
  byStatus: { idea: total },
});

function overlapping(circles: Circle[]) {
  const pairs: string[] = [];
  circles.forEach((a, i) =>
    circles.slice(i + 1).forEach((b, j) => {
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) pairs.push(`${i}-${i + j + 1}`);
    }),
  );
  return pairs;
}

describe("layoutTeams", () => {
  const teams = Array.from({ length: 40 }, (_, i) => ({
    id: `team-${String(i).padStart(2, "0")}`,
    orgUnit: i % 3 === 0 ? "Data" : i % 3 === 1 ? "Product" : null,
    r: teamRadius((i * 37) % 200),
  }));
  const links = [
    { a: "team-01", b: "team-02", weight: 3 },
    { a: "team-05", b: "team-30", weight: 1 },
  ];

  it("never overlaps two teams", () => {
    const layout = layoutTeams(teams, links);
    expect(layout.size).toBe(40);
    expect(overlapping([...layout.values()])).toEqual([]);
  });

  it("gives the same picture for the same data", () => {
    const a = layoutTeams(teams, links);
    const b = layoutTeams([...teams].reverse(), links);
    for (const [id, p] of a) expect(b.get(id)).toEqual(p);
  });

  it("barely moves teams when it starts from the previous picture", () => {
    const before = layoutTeams(teams, links);
    const grown = teams.map((t) => (t.id === "team-07" ? { ...t, r: t.r + 10 } : t));
    const after = layoutTeams(grown, links, before);
    const moved = [...after].map(([id, p]) =>
      Math.hypot(p.x - before.get(id)!.x, p.y - before.get(id)!.y),
    );
    expect(Math.max(...moved)).toBeLessThan(60);
    expect(overlapping([...after.values()])).toEqual([]);
  });

  it("keeps a dense map of equal teams apart", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `t${String(i).padStart(3, "0")}`,
      orgUnit: `unit ${i % 8}`,
      r: teamRadius(200),
    }));
    const links = Array.from({ length: 1500 }, (_, i) => ({
      a: many[(i * 31) % 300]!.id,
      b: many[(i * 17 + 5) % 300]!.id,
      weight: 2,
    }));
    expect(overlapping([...layoutTeams(many, links).values()])).toEqual([]);
  });

  it("handles one team and none", () => {
    expect(layoutTeams([], [])).toEqual(new Map());
    const one = layoutTeams([{ id: "a", orgUnit: null, r: 50 }], []);
    expect(one.get("a")).toMatchObject({ r: 50 });
  });
});

describe("teamCircleRadius", () => {
  it("fits what's shown and grows a little beyond the cap", () => {
    expect(teamCircleRadius(10, 200)).toBe(teamRadius(10));
    expect(teamCircleRadius(200, 200)).toBe(teamRadius(200));
    expect(teamCircleRadius(3200, 200)).toBeGreaterThan(teamRadius(200));
    expect(teamCircleRadius(3200, 200)).toBeLessThan(teamRadius(200) * 1.5);
  });
});

describe("layoutTeamInitiatives", () => {
  const circle = { x: 100, y: -50, r: teamRadius(30) };
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: `n${i}`,
    title: `Initiative ${i}`,
    status: "idea" as const,
    degree: i < 3 ? 1 : 0,
  }));

  it("keeps every initiative inside the circle, apart from each other", () => {
    const pos = layoutTeamInitiatives(circle, nodes, new Map());
    expect(pos.size).toBe(30);
    const points = [...pos.values()];
    for (const p of points) {
      expect(Math.hypot(p.x - circle.x, p.y - circle.y)).toBeLessThan(circle.r);
    }
    const unique = new Set(points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(unique.size).toBe(30);
  });

  it("puts related work on the rim, facing the other team", () => {
    const east = 0;
    const pos = layoutTeamInitiatives(circle, nodes, new Map([["n0", east]]));
    const p = pos.get("n0")!;
    const inner = pos.get("n10")!;
    expect(p.x).toBeGreaterThan(circle.x);
    expect(Math.hypot(p.x - circle.x, p.y - circle.y)).toBeGreaterThan(
      Math.hypot(inner.x - circle.x, inner.y - circle.y),
    );
  });

  it("squeezes a team that outgrew its circle", () => {
    const small = { x: 0, y: 0, r: teamRadius(4) };
    const pos = layoutTeamInitiatives(small, nodes, new Map());
    for (const p of pos.values()) expect(Math.hypot(p.x, p.y)).toBeLessThan(small.r);
  });
});

describe("buildScene", () => {
  const teams = [team("a", 3), team("b", 2), team("c", 1)];
  const circles = new Map<string, Circle>([
    ["a", { x: 0, y: 0, r: 50 }],
    ["b", { x: 200, y: 0, r: 50 }],
    ["c", { x: 0, y: 200, r: 50 }],
  ]);
  const teamLinks = [
    { fromTeamId: "a", toTeamId: "b", type: "builds_on" as const, count: 2 },
    { fromTeamId: "b", toTeamId: "a", type: "builds_on" as const, count: 1 },
    { fromTeamId: "b", toTeamId: "c", type: "related" as const, count: 1 },
  ];
  const detailA: GraphTeamDetail = {
    teamId: "a",
    total: 3,
    nodes: [
      { id: "a1", title: "A one", status: "idea", teamId: "a" },
      { id: "a2", title: "A two", status: "planned", teamId: "a" },
    ],
    edges: [
      {
        id: "e1",
        fromInitiativeId: "a1",
        toInitiativeId: "b1",
        fromTeamId: "a",
        toTeamId: "b",
        type: "builds_on",
      },
      {
        id: "e2",
        fromInitiativeId: "a2",
        toInitiativeId: "b1",
        fromTeamId: "a",
        toTeamId: "b",
        type: "builds_on",
      },
      {
        id: "e3",
        fromInitiativeId: "b2",
        toInitiativeId: "a3",
        fromTeamId: "b",
        toTeamId: "a",
        type: "builds_on",
      },
    ],
  };

  it("draws team to team lines while everything is closed", () => {
    const scene = buildScene(teams, teamLinks, circles, new Map());
    expect(scene.nodes.map((n) => n.id)).toEqual(["t:a", "t:b", "t:c"]);
    expect(scene.links).toHaveLength(3);
    // Both directions between a and b bend to opposite sides of one another.
    const ab = scene.links.filter((l) => l.source !== "t:c" && l.target !== "t:c");
    expect(ab).toHaveLength(2);
    expect(ab[0]!.curvature).not.toBe(0);
  });

  it("replaces an open team's lines with its initiatives' own", () => {
    const open = new Map([["a", prepareOpenTeam(detailA, circles)]]);
    const scene = buildScene(teams, teamLinks, circles, open);
    expect(scene.nodes.map((n) => n.id)).toEqual(["t:a", "t:b", "t:c", "i:a1", "i:a2"]);
    const links = scene.links.map((l) => `${l.source}>${l.target}:${l.count}`).sort();
    expect(links).toEqual([
      "i:a1>t:b:1",
      "i:a2>t:b:1",
      // a3 isn't drawn (capped), so its line ends at its own team's circle.
      "t:b>t:a:1",
      "t:b>t:c:1",
    ]);
  });

  it("joins initiatives directly when both teams are open, once per relationship", () => {
    const detailB: GraphTeamDetail = {
      teamId: "b",
      total: 2,
      nodes: [
        { id: "b1", title: "B one", status: "idea", teamId: "b" },
        { id: "b2", title: "B two", status: "idea", teamId: "b" },
      ],
      edges: [
        ...detailA.edges,
        {
          id: "e4",
          fromInitiativeId: "b2",
          toInitiativeId: "c1",
          fromTeamId: "b",
          toTeamId: "c",
          type: "related",
        },
      ],
    };
    const open = new Map([
      ["a", prepareOpenTeam(detailA, circles)],
      ["b", prepareOpenTeam(detailB, circles)],
    ]);
    const scene = buildScene(teams, teamLinks, circles, open);
    const links = scene.links.map((l) => `${l.source}>${l.target}:${l.count}`).sort();
    expect(links).toEqual(["i:a1>i:b1:1", "i:a2>i:b1:1", "i:b2>t:a:1", "i:b2>t:c:1"]);
  });

  it("faces related work towards the other team", () => {
    const open = prepareOpenTeam(detailA, circles);
    // b is east of a.
    expect(open.positions.get("a1")!.x).toBeGreaterThan(0);
    expect(open.degree.get("a1")).toBe(1);
  });
});

describe("pickOpenTeams", () => {
  const view = { width: 1000, height: 800 };
  const teams = [
    { id: "big", circle: { x: 0, y: 0, r: 100 }, shown: 50 },
    { id: "small", circle: { x: 300, y: 0, r: 50 }, shown: 10 },
    { id: "far", circle: { x: 100_000, y: 0, r: 100 }, shown: 10 },
    { id: "empty", circle: { x: -300, y: 0, r: 48 }, shown: 0 },
  ];
  const at = (k: number) => ({ k, x: 500, y: 400 });
  const opening = OPEN_SPACING_PX / NODE_SPACING;

  it("opens every team in view with work once initiatives are far enough apart", () => {
    expect([...pickOpenTeams(teams, at(opening), view, new Set())].sort()).toEqual([
      "big",
      "small",
    ]);
    expect(pickOpenTeams(teams, at(opening * 0.9), view, new Set()).size).toBe(0);
  });

  it("keeps open teams open a little below the threshold", () => {
    const k = opening * 0.9;
    expect([...pickOpenTeams(teams, at(k), view, new Set(["big"]))]).toEqual(["big"]);
    const below = (CLOSE_SPACING_PX * 0.95) / NODE_SPACING;
    expect(pickOpenTeams(teams, at(below), view, new Set(["big"])).size).toBe(0);
  });

  it("opens a packed team that fills much of the view", () => {
    const huge = [{ id: "huge", circle: { x: 0, y: 0, r: 1000 }, shown: 200 }];
    const k = 0.3; // initiatives 8px apart, but the circle is 600px across
    expect(NODE_SPACING * k).toBeLessThan(OPEN_SPACING_PX);
    expect([...pickOpenTeams(huge, at(k), view, new Set())]).toEqual(["huge"]);
    expect(pickOpenTeams(huge, at(0.1), view, new Set()).size).toBe(0);
  });

  it("stays within the budget, biggest on screen first, but always opens one", () => {
    expect([...pickOpenTeams(teams, at(2), view, new Set(), 55)]).toEqual(["big"]);
    expect([...pickOpenTeams(teams, at(2), view, new Set(), 5)]).toEqual(["big"]);
  });
});

describe("fitCircles", () => {
  it("frames the circles and caps the zoom", () => {
    const view = { width: 1000, height: 600 };
    const fit = fitCircles([{ x: 0, y: 0, r: 10 }], view, 40, 3);
    expect(fit.k).toBe(3);
    const wide = fitCircles(
      [
        { x: -500, y: 0, r: 100 },
        { x: 500, y: 0, r: 100 },
      ],
      view,
      40,
      3,
    );
    expect(wide.k).toBeCloseTo((1000 - 80) / 1200);
    expect(wide.cx).toBeCloseTo(0);
  });

  it("keeps the top clear for the toolbar", () => {
    const view = { width: 1000, height: 600 };
    const fit = fitCircles([{ x: 0, y: 0, r: 100 }], view, 20, 10, 200);
    // The circle's top edge lands below the toolbar.
    expect((0 - 100) * fit.k + fit.y).toBeGreaterThanOrEqual(200);
    expect((0 + 100) * fit.k + fit.y).toBeLessThanOrEqual(600);
  });
});

describe("placeLabels", () => {
  it("keeps the most important of overlapping labels", () => {
    const kept = placeLabels([
      { x: 0, y: 0, w: 100, h: 14, priority: 1 },
      { x: 50, y: 5, w: 100, h: 14, priority: 5 },
      { x: 300, y: 0, w: 100, h: 14, priority: 0 },
    ]);
    expect(kept.sort()).toEqual([1, 2]);
  });
});
