import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { CityProcess, CitySnapshot, Theme } from "./model.ts";
import type { CityOptions } from "./city2d.ts";
import { architectures, classify } from "./districts.ts";
import { CityLayout, hash, type Plot } from "./layout.ts";
import { pickBuilding } from "./picking.ts";
import {
  processRelations,
  relationColors,
  streetRoute,
} from "./relationships.ts";

export type Quality = "auto" | "low" | "high";
export interface SceneView {
  zoom: number;
  x: number;
  y: number;
  focus?: string | null;
  theta?: number;
  phi?: number;
  elevation?: number;
}
const clamp = THREE.MathUtils.clamp;
interface Building {
  process: CityProcess;
  plot: Plot;
  index: number;
  height: number;
  width: number;
  born: number;
  roof: THREE.Object3D;
}
interface WindowMark {
  building: Building;
  floor: number;
  x: number;
  z: number;
  side: number;
  lit: boolean;
}

/** Bounded WebGL city. Counters determine geometry; animation never changes readings. */
export class WebGLCityScene {
  private renderer: THREE.WebGLRenderer;
  private world = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
  private layout = new CityLayout();
  private current = new THREE.Group();
  private past = new THREE.Group();
  private roofs = new THREE.Group();
  private labels = new THREE.Group();
  private unit = new THREE.BoxGeometry(1, 1, 1);
  private bodyMaterial = new THREE.MeshStandardMaterial({
    color: "#7b9cae",
    roughness: 0.45,
    metalness: 0.3,
  });
  private bodies: THREE.InstancedMesh;
  private windows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.065, 0.085, 0.016),
    new THREE.MeshBasicMaterial({ color: "#8df2db", toneMapped: false }),
    14000,
  );
  private buildings: Building[] = [];
  private marks: WindowMark[] = [];
  private streets = new THREE.Group();
  private connections = new THREE.Group();
  private relatives = new Set<string>();
  private ground: THREE.Mesh;
  private water: THREE.Mesh;
  private ripples: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private mirror: Reflector;
  private snapshot: CitySnapshot | null = null;
  private options: CityOptions = {
    labels: false,
    roads: true,
    paused: false,
    selected: null,
    filter: null,
    locale: "en",
    mode: "demo",
  };
  private theme: Theme;
  private baselineAt: number | null = null;
  private compare: CitySnapshot | null = null;
  private mix = 0.5;
  private flood = 0;
  private actualWater = 0;
  private radius = 32;
  private wantedRadius = 32;
  private theta = Math.PI / 4;
  private phi = 0.91;
  private target = new THREE.Vector3(0, 1, 0);
  private wantedTarget = new THREE.Vector3(0, 1, 0);
  private focusKey: string | null = null;
  private width = 1;
  private height = 1;
  private frame = 0;
  private previousDraw = 0;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private qualityMode: Quality = "auto";
  private slowFrames = 0;
  private low = false;
  private observer: ResizeObserver | null = null;
  private listeners = new AbortController();
  private introAt = -Infinity;
  private disposed = false;
  private pausedAt: number | null = null;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private ray = new THREE.Raycaster();
  private down: {
    x: number;
    y: number;
    theta: number;
    phi: number;
    target: THREE.Vector3;
    pan: boolean;
  } | null = null;
  private exitParticles: {
    x: number;
    y: number;
    z: number;
    at: number;
    seed: number;
  }[] = [];
  private particles = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      color: "#81dacb",
      size: 0.045,
      transparent: true,
      opacity: 0.75,
    }),
  );
  constructor(
    private canvas: HTMLCanvasElement,
    theme: Theme,
    private select: (key: string) => void,
    private fixed?: { width: number; height: number },
  ) {
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor("#080e17");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.world.fog = new THREE.FogExp2("#080e17", 0.012);
    this.world.add(new THREE.HemisphereLight("#b2d4e8", "#17212b", 2.1));
    this.sun = new THREE.DirectionalLight("#d9e8ff", 3.3);
    this.sun.position.set(-7, 18, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -14,
      right: 14,
      top: 14,
      bottom: -14,
      near: 1,
      far: 55,
    });
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0003;
    this.world.add(this.sun);
    const rim = new THREE.DirectionalLight(theme.accent, 2.5);
    rim.position.set(8, 6, -10);
    this.world.add(rim);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: "#122333",
      metalness: 0.65,
      roughness: 0.35,
    });
    this.ground = new THREE.Mesh(
      new THREE.BoxGeometry(18.2, 0.45, 18.2),
      baseMaterial,
    );
    this.ground.position.y = -0.27;
    this.ground.receiveShadow = true;
    this.world.add(this.ground);
    this.mirror = new Reflector(new THREE.PlaneGeometry(18.1, 18.1), {
      color: "#14222d",
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.003,
    });
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.position.y = -0.035;
    this.world.add(this.mirror);
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(18.25, 0.46, 18.25)),
      new THREE.LineBasicMaterial({
        color: theme.accent,
        transparent: true,
        opacity: 0.22,
      }),
    );
    border.position.y = -0.27;
    this.world.add(border);
    const grid = new THREE.GridHelper(17.6, 13, theme.grid, theme.grid);
    grid.position.y = -0.025;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.world.add(grid);
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65, 1.65, 0.12, 48),
      new THREE.MeshStandardMaterial({
        color: "#172e3d",
        metalness: 0.5,
        roughness: 0.4,
      }),
    );
    plaza.position.y = 0.03;
    plaza.receiveShadow = true;
    this.world.add(plaza);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.13, 0.022, 6, 80),
      new THREE.MeshBasicMaterial({ color: theme.accent, toneMapped: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.13;
    this.world.add(this.ring);
    this.bodies = this.createBodies(theme);
    this.current.add(
      this.bodies,
      this.windows,
      this.roofs,
      this.streets,
      this.connections,
      this.labels,
      this.particles,
    );
    this.world.add(this.current, this.past);
    this.particles.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(245 * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.windows.frustumCulled = false;
    this.windows.count = 0;
    this.bodies.count = 0;
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 19),
      new THREE.MeshPhysicalMaterial({
        color: theme.water,
        transparent: true,
        opacity: 0.48,
        metalness: 0.3,
        roughness: 0.16,
        clearcoat: 1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.visible = false;
    this.world.add(this.water);
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 0.94, 72),
        new THREE.MeshBasicMaterial({
          color: theme.water,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.ripples.push(ring);
      this.world.add(ring);
    }
    if (!fixed) {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
    this.resize();
    this.bind();
    if (!fixed) this.frame = requestAnimationFrame((now) => this.animate(now));
  }
  private createBodies(theme: Theme) {
    const geometry =
      theme.shape === "tree"
        ? new THREE.CylinderGeometry(0.07, 0.1, 1, 5)
        : theme.shape === "reef"
          ? new THREE.CylinderGeometry(0.42, 0.6, 1, 6)
          : this.unit;
    const mesh = new THREE.InstancedMesh(geometry, this.bodyMaterial, 110);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
  private bind() {
    const settings = { signal: this.listeners.signal };
    this.canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (this.fixed) return;
        this.canvas.focus({ preventScroll: true });
        this.down = {
          x: e.clientX,
          y: e.clientY,
          theta: this.theta,
          phi: this.phi,
          target: this.target.clone(),
          pan: e.shiftKey,
        };
        this.canvas.setPointerCapture(e.pointerId);
      },
      settings,
    );
    this.canvas.addEventListener(
      "pointermove",
      (e) => {
        if (!this.down) return;
        const dx = e.clientX - this.down.x,
          dy = e.clientY - this.down.y;
        if (Math.hypot(dx, dy) > 4)
          this.canvas.dispatchEvent(
            new CustomEvent("city-camera-input", { bubbles: true }),
          );
        if (this.down.pan) {
          this.wantedTarget
            .copy(this.down.target)
            .add(new THREE.Vector3(-dx * 0.015, 0, dy * 0.015));
          this.target.copy(this.wantedTarget);
        } else {
          this.theta = this.down.theta - dx * 0.006;
          this.phi = clamp(this.down.phi - dy * 0.004, 0.4, 1.25);
        }
        this.renderAt(performance.now());
      },
      settings,
    );
    this.canvas.addEventListener(
      "pointerup",
      (e) => {
        if (
          this.down &&
          Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5
        ) {
          const rect = this.canvas.getBoundingClientRect();
          this.ray.setFromCamera(
            new THREE.Vector2(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              1 - ((e.clientY - rect.top) / rect.height) * 2,
            ),
            this.camera,
          );
          const key = pickBuilding(
            this.ray,
            this.bodies,
            this.roofs,
            this.buildings.map((b) => b.process.key),
          );
          if (key) this.select(key);
        }
        this.down = null;
      },
      settings,
    );
    this.canvas.addEventListener(
      "pointercancel",
      () => {
        this.down = null;
      },
      settings,
    );
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (document.activeElement !== this.canvas && !e.ctrlKey) return;
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? -0.12 : 0.12);
        this.canvas.dispatchEvent(
          new CustomEvent("city-camera-input", { bubbles: true }),
        );
      },
      { ...settings, passive: false },
    );
    this.canvas.addEventListener(
      "keydown",
      (e) => {
        if (
          [
            "+",
            "=",
            "-",
            "0",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].includes(e.key)
        )
          e.preventDefault();
        if (e.key === "+" || e.key === "=") this.zoom(0.15);
        if (e.key === "-") this.zoom(-0.15);
        if (e.key === "0" || e.key === "Escape") this.reset();
        if (e.key === "ArrowLeft") this.theta -= 0.12;
        if (e.key === "ArrowRight") this.theta += 0.12;
        if (e.key === "ArrowUp") this.phi = clamp(this.phi - 0.08, 0.4, 1.25);
        if (e.key === "ArrowDown") this.phi = clamp(this.phi + 0.08, 0.4, 1.25);
        this.renderAt(performance.now());
      },
      settings,
    );
  }
  private resize() {
    const previousDefault = this.defaultRadius();
    const rect = this.fixed ?? this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.width = rect.width;
    this.height = rect.height;
    this.renderer.setPixelRatio(
      this.fixed || this.low ? 1 : Math.min(devicePixelRatio || 1, 1.5),
    );
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (
      !this.snapshot ||
      (!this.focusKey && Math.abs(this.wantedRadius - previousDefault) < 2)
    )
      this.radius = this.wantedRadius = this.defaultRadius();
    this.renderAt(performance.now());
  }
  set(snapshot: CitySnapshot, theme: Theme, options: CityOptions) {
    if (this.disposed) return;
    const firstSnapshot = this.snapshot === null;
    if (!this.fixed && options.paused && !this.options.paused)
      this.pausedAt = performance.now();
    if (!options.paused && this.pausedAt !== null) {
      const elapsed = performance.now() - this.pausedAt;
      this.buildings.forEach((b) => (b.born += elapsed));
      this.exitParticles.forEach((p) => (p.at += elapsed));
      this.introAt += elapsed;
      this.pausedAt = null;
    }
    const old = new Map(this.buildings.map((b) => [b.process.key, b]));
    const changed =
      this.snapshot?.at !== snapshot.at ||
      this.theme.id !== theme.id ||
      options.selected !== this.options.selected ||
      options.labels !== this.options.labels ||
      options.roads !== this.options.roads ||
      options.relationFocus !== this.options.relationFocus ||
      options.locale !== this.options.locale ||
      options.filter !== this.options.filter;
    this.snapshot = snapshot;
    this.options = options;
    if (this.theme.id !== theme.id) {
      this.current.remove(this.bodies);
      if (this.bodies.geometry !== this.unit) this.bodies.geometry.dispose();
      this.bodies.dispose();
      this.bodies = this.createBodies(theme);
      this.current.add(this.bodies);
      (this.water.material as THREE.MeshPhysicalMaterial).color.set(
        theme.water,
      );
      (this.ring.material as THREE.MeshBasicMaterial).color.set(theme.accent);
      (this.ground.material as THREE.MeshStandardMaterial).color.set(
        theme.ground,
      );
      this.baselineAt = null;
      this.clearGroup(this.past);
    }
    this.theme = theme;
    if (changed) {
      this.layout.sync(snapshot.processes, options.selected);
      const byKey = new Map(snapshot.processes.map((p) => [p.key, p]));
      const now = performance.now();
      for (const [key, b] of old)
        if (!byKey.has(key))
          for (let i = 0; i < 7; i++)
            this.exitParticles.push({
              x: (b.plot.x - 6) * 1.3,
              y: (b.height * i) / 7,
              z: (b.plot.z - 6) * 1.3,
              at: now,
              seed: i,
            });
      this.exitParticles = this.exitParticles
        .filter((p) => now - p.at < 2200)
        .slice(-245);
      this.clearGroup(this.roofs);
      this.clearGroup(this.streets);
      this.clearGroup(this.connections);
      this.clearGroup(this.labels);
      this.relatives =
        options.roads && options.relationFocus
          ? processRelations(snapshot.processes, options.selected).highlighted
          : new Set();
      this.buildings = [...this.layout.plots].map(([key, plot], index) => {
        const process = byKey.get(key)!;
        const building: Building = {
          process,
          plot,
          index,
          height: clamp(
            0.5 + Math.log2(process.rssBytes / 1048576 + 1) * 0.55,
            0.6,
            7.3,
          ),
          width: clamp(
            0.55 + Math.log2(process.rssBytes / 1048576 + 1) * 0.024,
            0.56,
            0.87,
          ),
          born: old.get(key)?.born ?? (firstSnapshot ? now - 2000 : now),
          roof: new THREE.Group(),
        };
        building.roof.userData.processKey = process.key;
        this.addRoof(building);
        this.roofs.add(building.roof);
        return building;
      });
      this.bodies.count = this.buildings.length;
      this.marks = [];
      const roadBatches = new Map<
        string,
        { opacity: number; segments: { a: Plot; d: Plot }[] }
      >();
      for (const b of this.buildings) {
        const floors = Math.floor(b.height / 0.29),
          color = architectures[classify(b.process.name)].color;
        if (theme.shape !== "tree")
          for (let floor = 1; floor < floors; floor++)
            for (let side = 0; side < 2; side++)
              for (let column = 0; column < 3; column++) {
                const lit =
                  hash(b.process.key + floor + ":" + side + ":" + column) %
                    100 <
                  9 + (b.process.cpu ?? 0) * 2.5;
                this.marks.push({
                  building: b,
                  floor: floor * 0.29,
                  x:
                    side === 0
                      ? b.width / 2 + 0.012
                      : (column - 1) * b.width * 0.24,
                  z:
                    side === 0
                      ? (column - 1) * b.width * 0.24
                      : b.width / 2 + 0.012,
                  side,
                  lit,
                });
              }
        const p = b.process,
          parent = p.parentKey ? this.layout.plots.get(p.parentKey) : undefined;
        if (parent && options.roads) {
          const active =
            options.relationFocus &&
            (p.key === options.selected ||
              (p.parentKey === options.selected && this.relatives.has(p.key)));
          const color = active
            ? p.key === options.selected
              ? relationColors.parent
              : relationColors.child
            : "#688d9e";
          const points = streetRoute(parent, b.plot);
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1],
              d = points[i];
            const batch = roadBatches.get(color) ?? {
              opacity: active ? 0.95 : options.relationFocus ? 0.12 : 0.6,
              segments: [],
            };
            batch.segments.push({ a, d });
            roadBatches.set(color, batch);
          }
        }
        if (
          (!(options.roads && options.relationFocus) &&
            p.key === options.selected) ||
          (options.labels && !this.relatives.has(p.key) && b.index < 24)
        )
          this.labels.add(this.label(p.name, color, b));
      }
      // Ground streets use at most three draw calls, regardless of process count.
      for (const [color, batch] of roadBatches) {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: batch.opacity,
            depthWrite: false,
          }),
          batch.segments.length,
        );
        batch.segments.forEach(({ a, d }, index) => {
          const length = Math.hypot(a.x - d.x, a.z - d.z) * 1.3;
          this.dummy.position.set(
            ((a.x + d.x) / 2 - 6) * 1.3,
            0.055,
            ((a.z + d.z) / 2 - 6) * 1.3,
          );
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(
            a.x === d.x ? 0.09 : length,
            0.012,
            a.x === d.x ? length : 0.09,
          );
          this.dummy.updateMatrix();
          mesh.setMatrixAt(index, this.dummy.matrix);
        });
        mesh.frustumCulled = false;
        this.streets.add(mesh);
      }
      if (options.roads && options.relationFocus) this.addConnections();
      this.windows.count = Math.min(this.marks.length, 14000);
      this.updateMatrices(now);
    }
    if (this.compare && this.past.children.length === 0) {
      this.baselineAt = null;
      this.comparison(this.compare, this.mix);
    }
    this.renderAt(performance.now());
  }
  private addConnections() {
    if (!this.snapshot) return;
    const family = processRelations(
      this.snapshot.processes,
      this.options.selected,
    );
    if (!family.process) return;
    const selected = this.buildings.find(
      (b) => b.process.key === family.process!.key,
    );
    if (!selected) return;
    const fa = this.options.locale === "fa";
    const labelled = [
      family.parent,
      family.process,
      ...family.children.slice(0, this.width < 700 ? 1 : 4),
    ].filter((p) => p !== null);
    for (const p of labelled) {
      const b = this.buildings.find((b) => b.process.key === p.key);
      if (!b) continue;
      const role =
        p.key === selected.process.key
          ? fa
            ? "انتخاب"
            : "SELECTED"
          : p.key === family.parent?.key
            ? fa
              ? "والد"
              : "PARENT"
            : fa
              ? "فرزند"
              : "CHILD";
      const color =
        p.key === selected.process.key
          ? relationColors.selected
          : p.key === family.parent?.key
            ? relationColors.parent
            : relationColors.child;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(b.width * 0.7, 0.025, 6, 32),
        new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          depthWrite: false,
        }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(
        (b.plot.x - 6) * 1.3,
        b.height + 0.32,
        (b.plot.z - 6) * 1.3,
      );
      marker.renderOrder = 24;
      this.connections.add(marker);
      const label = this.label(`${role} · ${p.name} · ${p.pid}`, color, b);
      label.renderOrder = 26;
      label.userData.relation = true;
      const leader = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          marker.position,
          label.position,
        ]),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.65,
          depthTest: false,
          depthWrite: false,
        }),
      );
      leader.renderOrder = 25;
      label.userData.leader = leader;
      this.connections.add(leader);
      this.labels.add(label);
    }
    for (const child of [family.process, ...family.children.slice(0, 12)]) {
      if (!child.parentKey) continue;
      const a = this.buildings.find((b) => b.process.key === child.parentKey),
        b = this.buildings.find((b) => b.process.key === child.key);
      if (!a || !b) continue;
      const color =
        child.key === family.process.key
          ? relationColors.parent
          : relationColors.child;
      const from = new THREE.Vector3(
        (a.plot.x - 6) * 1.3,
        a.height + 0.3,
        (a.plot.z - 6) * 1.3,
      );
      const to = new THREE.Vector3(
        (b.plot.x - 6) * 1.3,
        b.height + 0.3,
        (b.plot.z - 6) * 1.3,
      );
      const middle = from.clone().lerp(to, 0.5);
      middle.y =
        Math.max(from.y, to.y) + Math.min(3, from.distanceTo(to) * 0.35 + 0.6);
      const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 28, 0.05, 4, false),
        new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.95,
          toneMapped: false,
        }),
      );
      tube.renderOrder = 22;
      this.connections.add(tube);
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.45, 6),
        new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      arrow.position.copy(curve.getPoint(0.72));
      arrow.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        curve.getTangent(0.72).normalize(),
      );
      arrow.renderOrder = 23;
      this.connections.add(arrow);
    }
  }
  private arrangeRelationLabels() {
    const occupied: { x: number; y: number }[] = [];
    for (const object of this.labels.children) {
      if (!(object instanceof THREE.Sprite) || !object.userData.relation)
        continue;
      const b = object.userData.building as Building;
      const anchor = new THREE.Vector3(
        (b.plot.x - 6) * 1.3,
        b.height + 0.35,
        (b.plot.z - 6) * 1.3,
      );
      const projected = anchor.clone().project(this.camera);
      const labelWidth = Math.min(
          this.width < 600 ? 142 : 188,
          this.width - 24,
        ),
        labelHeight = 25;
      let x = ((projected.x + 1) * this.width) / 2;
      let y = ((1 - projected.y) * this.height) / 2 - 26;
      const minimumX =
        !this.fixed && this.width > 700 && this.options.locale === "fa"
          ? 330 + labelWidth / 2
          : labelWidth / 2 + 12;
      const maximumX =
        !this.fixed && this.width > 700 && this.options.locale !== "fa"
          ? this.width - 330 - labelWidth / 2
          : this.width - labelWidth / 2 - 12;
      x = clamp(x, Math.min(minimumX, maximumX), maximumX);
      const maximumY =
        !this.fixed && this.width < 700
          ? this.height * 0.52 - 55
          : this.height - 55;
      y = clamp(y, 28, Math.max(28, maximumY));
      for (
        let attempts = 0;
        attempts < 12 &&
        occupied.some(
          (p) =>
            Math.abs(p.x - x) < labelWidth + 8 &&
            Math.abs(p.y - y) < labelHeight + 5,
        );
        attempts++
      ) {
        y -= labelHeight + 6;
        if (y < 28) {
          y = Math.max(28, maximumY);
          x = clamp(x + labelWidth / 2, Math.min(minimumX, maximumX), maximumX);
        }
      }
      occupied.push({ x, y });
      object.position.copy(
        new THREE.Vector3(
          (x / this.width) * 2 - 1,
          1 - (y / this.height) * 2,
          projected.z,
        ).unproject(this.camera),
      );
      const unitsPerPixel =
        (2 *
          Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) *
          this.camera.position.distanceTo(object.position)) /
        this.height;
      object.scale.set(
        labelWidth * unitsPerPixel,
        labelHeight * unitsPerPixel,
        1,
      );
      const leader = object.userData.leader as THREE.Line;
      const positions = leader.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      positions.setXYZ(0, anchor.x, anchor.y, anchor.z);
      positions.setXYZ(
        1,
        object.position.x,
        object.position.y,
        object.position.z,
      );
      positions.needsUpdate = true;
      leader.frustumCulled = false;
    }
  }
  private addRoof(b: Building) {
    const a = architectures[classify(b.process.name)],
      theme = this.theme;
    const material = new THREE.MeshStandardMaterial({
      color: a.color,
      roughness: 0.38,
      metalness: 0.35,
      emissive: a.color,
      emissiveIntensity: 0.12,
    });
    const piece = (
      geometry: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = !this.low;
      b.roof.add(mesh);
    };
    if (theme.shape === "tree") {
      material.color.lerp(new THREE.Color(theme.top), 0.8);
      material.emissive.copy(material.color);
      for (let level = 0; level < 3; level++)
        piece(
          new THREE.ConeGeometry(
            b.width * (0.85 - level * 0.18),
            b.height * (0.55 - level * 0.1),
            6,
          ),
          0,
          b.height * (-0.35 + level * 0.16),
          0,
        );
      return;
    }
    if (theme.shape === "station") {
      piece(
        new THREE.BoxGeometry(b.width * 1.35, 0.07, b.width * 0.5),
        0,
        0.2,
        0,
      );
      piece(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 8), 0, 0.17, 0);
      return;
    }
    if (theme.shape === "reef") {
      piece(new THREE.SphereGeometry(b.width * 0.38, 6, 5), 0, 0.12, 0);
      return;
    }
    piece(
      new THREE.BoxGeometry(b.width + 0.035, 0.07, b.width + 0.035),
      0,
      0.035,
      0,
    );
    if (a.shape === "workshop" || a.shape === "studio")
      piece(
        new THREE.BoxGeometry(b.width * 0.55, 0.32, b.width * 0.55),
        0,
        0.2,
        0,
      );
    else if (a.shape === "plant") {
      piece(
        new THREE.CylinderGeometry(0.09, 0.12, 0.64, 7),
        b.width * 0.2,
        0.35,
        0,
      );
      piece(
        new THREE.CylinderGeometry(0.07, 0.09, 0.4, 7),
        -b.width * 0.2,
        0.23,
        0,
      );
    } else if (a.shape === "antenna" || a.shape === "utility") {
      piece(new THREE.CylinderGeometry(0.018, 0.022, 0.75, 5), 0, 0.42, 0);
      piece(new THREE.SphereGeometry(0.1, 8, 6), 0, 0.83, 0);
    } else if (a.shape === "terrace") {
      piece(
        new THREE.BoxGeometry(b.width * 0.65, 0.2, b.width * 0.7),
        -0.08,
        0.15,
        0,
      );
    }
  }
  private label(name: string, color: string, b: Building) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 80;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#0b1522e8";
    c.fillRect(0, 0, 512, 80);
    c.font = "500 32px Vazirmatn, sans-serif";
    c.textAlign = "center";
    c.fillStyle = color;
    c.fillText(name, 256, 50, 490);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    sprite.scale.set(3.4, 0.53, 1);
    sprite.position.set(
      (b.plot.x - 6) * 1.3,
      b.height + 0.65,
      (b.plot.z - 6) * 1.3,
    );
    sprite.userData.building = b;
    return sprite;
  }
  private updateMatrices(now: number) {
    const intro =
      this.reduced.matches || this.fixed
        ? 1
        : clamp((now - this.introAt) / 3000, 0, 1);
    for (const b of this.buildings) {
      const progress =
        this.reduced.matches || this.fixed
          ? 1
          : clamp((now - b.born - (hash(b.process.key) % 350)) / 1300, 0.02, 1);
      const rise = Math.min(1 - Math.pow(1 - progress, 3), intro);
      const dim =
          (this.options.filter && !this.options.filter.has(b.process.key)) ||
          (this.options.roads &&
            this.options.relationFocus &&
            !this.relatives.has(b.process.key)),
        selected = b.process.key === this.options.selected;
      this.dummy.position.set(
        (b.plot.x - 6) * 1.3,
        (b.height * rise) / 2 + 0.035,
        (b.plot.z - 6) * 1.3,
      );
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(b.width, b.height * rise, b.width);
      this.dummy.updateMatrix();
      this.bodies.setMatrixAt(b.index, this.dummy.matrix);
      this.color
        .set(architectures[classify(b.process.name)].color)
        .lerp(new THREE.Color(this.theme.top), 0.66)
        .multiplyScalar(dim ? 0.23 : selected ? 1.6 : 1);
      this.bodies.setColorAt(b.index, this.color);
      b.roof.position.set(
        (b.plot.x - 6) * 1.3,
        b.height * rise + 0.035,
        (b.plot.z - 6) * 1.3,
      );
      b.roof.scale.setScalar(dim ? 0.85 : 1);
      b.roof.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          object.material instanceof THREE.MeshStandardMaterial
        ) {
          object.material.color
            .set(architectures[classify(b.process.name)].color)
            .multiplyScalar(dim ? 0.25 : 1);
          object.material.emissiveIntensity = dim ? 0.015 : 0.12;
        }
      });
      b.roof.visible = rise > 0.2;
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.windows.count; i++) {
      const mark = this.marks[i],
        b = mark.building,
        progress =
          this.reduced.matches || this.fixed
            ? 1
            : clamp(
                (now - b.born - (hash(b.process.key) % 350)) / 1300,
                0.02,
                1,
              ),
        rise = Math.min(1 - Math.pow(1 - progress, 3), intro);
      const { faceX, faceZ, angle } = this.facadeOffset(mark);
      this.dummy.position.set(
        (b.plot.x - 6) * 1.3 + faceX,
        0.035 + mark.floor * rise,
        (b.plot.z - 6) * 1.3 + faceZ,
      );
      this.dummy.rotation.set(0, angle, 0);
      this.dummy.scale.setScalar(rise < 0.3 ? 0 : 1);
      this.dummy.updateMatrix();
      this.windows.setMatrixAt(i, this.dummy.matrix);
      const dim =
        (this.options.filter && !this.options.filter.has(b.process.key)) ||
        (this.options.roads &&
          this.options.relationFocus &&
          !this.relatives.has(b.process.key));
      this.color
        .set(
          mark.lit
            ? b.process.growing
              ? this.theme.secondary
              : this.theme.window
            : this.theme.grid,
        )
        .multiplyScalar(dim ? 0.1 : mark.lit ? 1.4 : 0.4);
      this.windows.setColorAt(i, this.color);
    }
    this.windows.instanceMatrix.needsUpdate = true;
    if (this.windows.instanceColor)
      this.windows.instanceColor.needsUpdate = true;
  }
  private facadeOffset(mark: WindowMark) {
    const b = mark.building;
    let faceX = mark.x,
      faceZ = mark.z,
      angle = mark.side === 0 ? Math.PI / 2 : 0;
    if (this.theme.shape === "reef") {
      const radius = b.width * (0.6 - (0.18 * mark.floor) / b.height),
        normal = mark.side === 0 ? 0 : Math.PI / 3;
      const column = (mark.side === 0 ? mark.z : mark.x) / (b.width * 0.24),
        tangent = column * radius * 0.3;
      faceX =
        Math.cos(normal) * (radius * Math.cos(Math.PI / 6) + 0.009) -
        Math.sin(normal) * tangent;
      faceZ =
        Math.sin(normal) * (radius * Math.cos(Math.PI / 6) + 0.009) +
        Math.cos(normal) * tangent;
      angle = Math.PI / 2 - normal;
    }

    return { faceX, faceZ, angle };
  }
  extras(_ghost: CitySnapshot | null, flood: number, _headline: string) {
    this.flood = clamp(flood, 0, 0.85);
  }
  comparison(snapshot: CitySnapshot | null, mix: number) {
    this.compare = snapshot;
    this.mix = clamp(mix, 0, 1);
    if (snapshot && this.baselineAt !== snapshot.at) {
      this.baselineAt = snapshot.at;
      this.clearGroup(this.past);
      const referenceLayout = new CityLayout();
      referenceLayout.sync(snapshot.processes, null);
      const marks: WindowMark[] = [];
      for (const p of [...snapshot.processes]
        .sort((a, b) => b.rssBytes - a.rssBytes)
        .slice(0, 110)) {
        const plot =
          this.layout.historical(p.key) ?? referenceLayout.plots.get(p.key);
        if (!plot) continue;
        const height = clamp(
            0.5 + Math.log2(p.rssBytes / 1048576 + 1) * 0.55,
            0.6,
            7.3,
          ),
          width = clamp(
            0.55 + Math.log2(p.rssBytes / 1048576 + 1) * 0.024,
            0.56,
            0.87,
          );
        const color = new THREE.Color(architectures[classify(p.name)].color)
          .lerp(new THREE.Color(this.theme.top), 0.66)
          .multiply(this.bodyMaterial.color);
        const mesh = new THREE.Mesh(
          this.bodies.geometry.clone().scale(width, height, width),
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.45,
            metalness: 0.3,
          }),
        );
        mesh.position.set(
          (plot.x - 6) * 1.3,
          height / 2 + 0.035,
          (plot.z - 6) * 1.3,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.past.add(mesh);
        const building: Building = {
          process: p,
          plot,
          index: 0,
          height,
          width,
          born: -Infinity,
          roof: new THREE.Group(),
        };
        this.addRoof(building);
        building.roof.position.set(
          (plot.x - 6) * 1.3,
          height + 0.035,
          (plot.z - 6) * 1.3,
        );
        this.past.add(building.roof);
        if (this.theme.shape !== "tree")
          for (let floor = 1; floor < Math.floor(height / 0.29); floor++)
            for (let side = 0; side < 2; side++)
              for (let column = 0; column < 3; column++) {
                marks.push({
                  building,
                  floor: floor * 0.29,
                  x:
                    side === 0
                      ? width / 2 + 0.012
                      : (column - 1) * width * 0.24,
                  z:
                    side === 0
                      ? (column - 1) * width * 0.24
                      : width / 2 + 0.012,
                  side,
                  lit:
                    hash(p.key + floor + ":" + side + ":" + column) % 100 <
                    9 + (p.cpu ?? 0) * 2.5,
                });
              }
      }
      const lights = new THREE.InstancedMesh(
        this.windows.geometry.clone(),
        (this.windows.material as THREE.MeshBasicMaterial).clone(),
        Math.min(marks.length, 14000),
      );
      marks.slice(0, 14000).forEach((mark, index) => {
        const { faceX, faceZ, angle } = this.facadeOffset(mark),
          building = mark.building;
        this.dummy.position.set(
          (building.plot.x - 6) * 1.3 + faceX,
          0.035 + mark.floor,
          (building.plot.z - 6) * 1.3 + faceZ,
        );
        this.dummy.rotation.set(0, angle, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        lights.setMatrixAt(index, this.dummy.matrix);
        this.color
          .set(
            mark.lit
              ? building.process.growing
                ? this.theme.secondary
                : this.theme.window
              : this.theme.grid,
          )
          .multiplyScalar(mark.lit ? 1.4 : 0.4);
        lights.setColorAt(index, this.color);
      });
      lights.frustumCulled = false;
      this.past.add(lights);
    }
  }
  quality(value: Quality) {
    this.qualityMode = value;
    this.low = value === "low";
    this.renderer.shadowMap.enabled = !this.low;
    this.mirror.visible = !this.low;
    this.resize();
  }
  intro() {
    if (!this.reduced.matches) {
      this.introAt = performance.now();
      this.radius = 43;
      this.wantedRadius = this.defaultRadius();
    }
  }
  stopIntro() {
    this.introAt = -Infinity;
    const now = performance.now();
    this.buildings.forEach((b) => (b.born = now - 2000));
    this.updateMatrices(now);
    this.renderAt(now);
  }
  private defaultRadius() {
    return this.camera.aspect > 1.8
      ? 30
      : Math.min(65, 37 / Math.min(1, this.camera.aspect));
  }
  zoom(delta: number) {
    this.wantedRadius = clamp(this.wantedRadius / (1 + delta), 9, 65);
    this.renderAt(performance.now());
  }
  reset() {
    this.wantedRadius = this.defaultRadius();
    this.theta = Math.PI / 4;
    this.phi = 0.91;
    this.wantedTarget.set(0, 1, 0);
    this.focusKey = null;
    if (this.reduced.matches) {
      this.radius = this.wantedRadius;
      this.target.copy(this.wantedTarget);
    }
    this.renderAt(performance.now());
  }
  focus(key: string) {
    const b = this.buildings.find((b) => b.process.key === key);
    if (!b) return;
    this.focusKey = key;
    this.wantedTarget.set(
      (b.plot.x - 6) * 1.3,
      b.height * 0.5,
      (b.plot.z - 6) * 1.3,
    );
    this.wantedRadius = 13;
    if (this.reduced.matches || this.options.paused) {
      this.radius = this.wantedRadius;
      this.target.copy(this.wantedTarget);
    }
    this.renderAt(performance.now());
  }
  view(): SceneView {
    return {
      zoom: 32 / this.radius,
      x: this.target.x,
      y: this.target.z,
      elevation: this.target.y,
      theta: this.theta,
      phi: this.phi,
      focus: this.focusKey,
    };
  }
  restore(view: SceneView) {
    this.radius = this.wantedRadius = clamp(32 / view.zoom, 9, 65);
    this.target.set(view.x, view.elevation ?? 1, view.y);
    this.wantedTarget.copy(this.target);
    if (view.theta !== undefined) this.theta = view.theta;
    if (view.phi !== undefined) this.phi = view.phi;
    if (view.focus !== undefined) this.focusKey = view.focus;
  }
  private animate(now: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame((at) => this.animate(at));
    const interval =
      this.reduced.matches || this.options.paused ? 1000 : this.low ? 70 : 40;
    if (document.hidden || now - this.previousDraw < interval) return;
    this.previousDraw = now;
    const start = performance.now();
    this.renderAt(now);
    if (
      this.qualityMode === "auto" &&
      !this.low &&
      performance.now() - start > 26
    ) {
      if (++this.slowFrames > 24) {
        this.low = true;
        this.renderer.shadowMap.enabled = false;
        this.mirror.visible = false;
        this.resize();
        this.canvas.dataset.quality = "adaptive";
      }
    }
  }
  renderAt(now: number) {
    if (this.disposed) return;
    now = this.pausedAt ?? now;
    const ease = this.reduced.matches || this.options.paused ? 1 : 0.1;
    this.radius += (this.wantedRadius - this.radius) * ease;
    this.target.lerp(this.wantedTarget, ease);
    this.camera.position.set(
      this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    if (this.options.relationFocus && this.width < 700 && !this.fixed)
      this.camera.setViewOffset(
        this.width,
        this.height,
        0,
        this.height * 0.18,
        this.width,
        this.height,
      );
    else this.camera.clearViewOffset();
    this.camera.updateMatrixWorld();
    this.arrangeRelationLabels();
    if (
      this.buildings.some((b) => now - b.born < 1700) ||
      now - this.introAt < 3000
    )
      this.updateMatrices(now);
    const growing =
      this.snapshot?.processes
        .filter((p) => p.growing)
        .sort((a, b) => b.growthMB - a.growthMB) ?? [];
    const amount = Math.max(
      this.flood,
      clamp(growing.reduce((n, p) => n + p.growthMB, 0) / 900, 0, 0.68),
    );
    this.actualWater =
      this.reduced.matches || this.fixed
        ? amount
        : this.options.paused
          ? this.actualWater
          : this.actualWater + (amount - this.actualWater) * 0.08;
    this.water.visible = this.actualWater > 0.008 && !this.compare;
    this.water.position.y = 0.06 + this.actualWater * 4.2;
    const source = growing[0]
      ? this.layout.plots.get(growing[0].key)
      : undefined;
    this.ripples.forEach((ring, i) => {
      ring.visible = !!source && this.water.visible;
      if (!source) return;
      const phase = ((this.reduced.matches ? 0 : now / 3300) + i / 4) % 1;
      ring.position.set(
        (source.x - 6) * 1.3,
        this.water.position.y + 0.015,
        (source.z - 6) * 1.3,
      );
      ring.scale.setScalar(0.5 + phase * 8);
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.26;
    });
    const exits = this.exitParticles.filter((p) => now - p.at < 2200);
    this.particles.visible = exits.length > 0 && !this.reduced.matches;
    if (exits.length) {
      const attribute = this.particles.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute,
        positions = attribute.array;
      exits.forEach((p, i) => {
        const elapsed = (now - p.at) / 2200;
        positions[i * 3] = p.x + Math.sin(p.seed * 8) * elapsed;
        positions[i * 3 + 1] = p.y + elapsed * 2;
        positions[i * 3 + 2] = p.z + Math.cos(p.seed * 8) * elapsed;
      });
      attribute.needsUpdate = true;
      this.particles.geometry.setDrawRange(0, exits.length);
    }
    this.renderer.setScissorTest(false);
    this.current.visible = true;
    this.past.visible = false;
    if (this.compare) {
      this.renderer.setScissorTest(true);
      const split = Math.round(this.width * this.mix);
      const beforeWater = clamp(
        this.compare.processes
          .filter((p) => p.growing)
          .reduce((n, p) => n + p.growthMB, 0) / 900,
        0,
        0.68,
      );
      this.water.visible = beforeWater > 0.008;
      this.water.position.y = 0.06 + beforeWater * 4.2;
      this.renderer.setScissor(0, 0, split, this.height);
      this.current.visible = false;
      this.past.visible = true;
      this.renderer.render(this.world, this.camera);
      this.water.visible = amount > 0.008;
      this.water.position.y = 0.06 + amount * 4.2;
      this.renderer.setScissor(split, 0, this.width - split, this.height);
      this.current.visible = true;
      this.past.visible = false;
      this.renderer.render(this.world, this.camera);
      this.renderer.setScissorTest(false);
    } else this.renderer.render(this.world, this.camera);
  }
  async image(): Promise<Blob> {
    this.renderAt(performance.now());
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not capture city.")),
        "image/png",
      ),
    );
  }
  private clearGroup(group: THREE.Group) {
    group.traverse((object) => {
      if (
        !(
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Sprite ||
          object instanceof THREE.Points
        )
      )
        return;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof Reflector) object.getRenderTarget().dispose();
      if ("geometry" in object) object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => {
        if ("map" in material && material.map instanceof THREE.Texture)
          material.map.dispose();
        material.dispose();
      });
    });
    group.clear();
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.listeners.abort();
    this.observer?.disconnect();
    this.clearGroup(this.world as unknown as THREE.Group);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
