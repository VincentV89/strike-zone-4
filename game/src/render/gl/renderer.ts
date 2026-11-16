/**
 * createRenderer (LC-G-3): the public renderer facade over the pure core. Owns the WebGL2
 * context, the world and viewmodel scenes, and the context-loss state machine (LC-R-9).
 * Read-only towards the simulation (BR-R-01): it receives frozen snapshots and drained events.
 * No try/catch: errors propagate to app-shell's boundary (RD-R-5).
 */
import type { AssetFactory } from '@sz/assets';
import { RIG_PARTS } from '@sz/assets/core/rig-parts';
import type { WeaponId } from '@sz/kernel';
import type { MapDefinition } from '@sz/maps';
import {
  INITIAL_CONTEXT,
  canRender,
  contextTransition,
  type ContextEvent,
  type ContextMachine,
} from '@sz/render/core/context-state';
import {
  applyRenderSettings,
  beginRound as beginCoreRound,
  coreStats,
  stepPresentation,
  type CoreStats,
} from '@sz/render/core/frame';
import { safeDpr } from '@sz/render/core/guards';
import { createPresentationState, EFFECT_KINDS } from '@sz/render/core/state';
import type { RenderFrame, RenderSettings } from '@sz/render/core/types';
import {
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type Material,
} from 'three';
import { createWebGl2Context } from './context';
import { syncInstances, wrapInstances, type WrappedMesh } from './instanced';
import { buildMapScene, type MapScene } from './map-scene';
import type { ContextEventType, RendererOptions } from './ports';
import { createViewmodelScene, type ViewmodelScene } from './viewmodel-scene';

export interface RendererStats extends CoreStats {
  readonly mapId: string | null;
  readonly contextState: string;
  readonly mapMeshes: number;
  readonly skippedSolids: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly programs: number;
  readonly gpuGeometries: number;
  readonly gpuTextures: number;
}

export interface Renderer {
  loadMap(map: MapDefinition, opts?: { readonly force?: boolean }): void;
  unloadMap(): void;
  beginRound(weapon?: WeaponId): void;
  render(frame: RenderFrame): void;
  applySettings(settings: Partial<RenderSettings>): RenderSettings;
  stats(): RendererStats;
  dispose(): void;
}

export function createRenderer(opts: RendererOptions): Renderer {
  const assets: AssetFactory = opts.assets;
  const gl = createWebGl2Context(opts.canvas);
  const webgl = new WebGLRenderer({
    canvas: opts.canvas as unknown as HTMLCanvasElement,
    context: gl as unknown as WebGLRenderingContext,
    antialias: true,
    powerPreference: 'high-performance',
  });
  webgl.outputColorSpace = SRGBColorSpace;
  webgl.autoClear = false;
  webgl.shadowMap.type = PCFShadowMap;
  assets.attachRenderer(webgl);

  const core = createPresentationState();
  const world = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.05, 100);
  camera.rotation.order = 'YXZ';
  let vm: ViewmodelScene | undefined;
  let map: MapScene | undefined;
  let currentMap: MapDefinition | undefined;
  let ctx: ContextMachine = INITIAL_CONTEXT;
  let disposed = false;
  let lastW = -1;
  let lastH = -1;
  let lastDpr = -1;
  let lastScale = -1;
  const botMeshes: WrappedMesh[] = [];
  const effectMeshes: WrappedMesh[] = [];

  /** Bot and effect meshes need the models step; built lazily on the first map load. */
  function ensureDynamicMeshes(): void {
    if (botMeshes.length > 0) return;
    const geo = assets.partGeometry('torso');
    const mat = assets.botMaterial();
    const quad = assets.quadGeometry();
    if (geo === undefined || mat === undefined || quad === undefined) return;
    RIG_PARTS.forEach((_p, i) => {
      for (const set of [core.botNear, core.botFar]) {
        const buffer = set[i];
        if (buffer === undefined) continue;
        const w = wrapInstances(geo, mat, buffer);
        w.mesh.receiveShadow = true;
        botMeshes.push(w);
        world.add(w.mesh);
      }
    });
    for (const kind of EFFECT_KINDS) {
      const m = assets.effectMaterial(kind);
      if (m === undefined) continue;
      const w = wrapInstances(quad, m, core.effectBuffers[kind]);
      w.mesh.renderOrder = kind === 'decal' ? 1 : 2;
      effectMeshes.push(w);
      world.add(w.mesh);
    }
    vm = createViewmodelScene(assets);
    applyGlSettings();
  }

  function markMaterials(): void {
    const seen = new Set<Material>(assets.allMaterials());
    for (const m of seen) m.needsUpdate = true;
  }

  function applyGlSettings(): void {
    const p = core.preset;
    if (webgl.shadowMap.enabled !== p.sunShadows) {
      webgl.shadowMap.enabled = p.sunShadows;
      markMaterials();
    }
    if (map !== undefined) {
      const sun = map.sun;
      sun.castShadow = p.sunShadows;
      if (
        p.sunShadows &&
        (sun.shadow.mapSize.x !== p.shadowMapSize || sun.shadow.radius !== p.shadowRadius)
      ) {
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
        sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
        sun.shadow.radius = p.shadowRadius;
      }
      map.fog.far = Math.min(map.fogFar, p.drawDistanceM);
    }
    // Near meshes (even indices) cast shadows when the preset has sun shadows (PD-R-2).
    botMeshes.forEach((w, i) => {
      w.mesh.castShadow = i % 2 === 0 && p.sunShadows;
    });
    assets.setAnisotropy(p.anisotropy);
    lastScale = -1;
  }

  function resize(): number {
    const w = Math.max(1, Math.floor(opts.canvas.clientWidth));
    const h = Math.max(1, Math.floor(opts.canvas.clientHeight));
    const dpr = safeDpr(opts.devicePixelRatio(), core.preset.pixelRatioCap);
    const scale = core.preset.renderScale;
    if (w !== lastW || h !== lastH || dpr !== lastDpr || scale !== lastScale) {
      webgl.setPixelRatio(dpr * scale);
      webgl.setSize(w, h, false);
      lastW = w;
      lastH = h;
      lastDpr = dpr;
      lastScale = scale;
    }
    return w / h;
  }

  function loadMap(next: MapDefinition, o: { readonly force?: boolean } = {}): void {
    if (disposed) return;
    if (map !== undefined && map.mapId === next.id && o.force !== true) return;
    unloadMap();
    ensureDynamicMeshes();
    map = buildMapScene(next, assets, core.preset);
    currentMap = next;
    world.add(map.group);
    world.fog = map.fog;
    world.background = map.fog.color;
    applyGlSettings();
  }

  function unloadMap(): void {
    if (map === undefined) return;
    world.remove(map.group);
    map.dispose();
    map = undefined;
    world.fog = null;
  }

  function onContextEvent(e: ContextEvent, ev?: Event): void {
    const s = contextTransition(ctx, e);
    ctx = s.next;
    if (s.preventDefault) ev?.preventDefault();
    if (s.notifyLost) opts.onContextLost();
    if (s.notifyRestored) opts.onContextRestored();
    if (s.startRestore) {
      const generation = ctx.generation;
      assets.rebuildGpu();
      if (currentMap !== undefined) loadMap(currentMap, { force: true });
      applyGlSettings();
      void assets.warmup().then(() => {
        onContextEvent({ type: 'restore-done', generation });
      });
    }
  }

  const listeners: ReadonlyArray<readonly [ContextEventType, (e: Event) => void]> = [
    [
      'webglcontextlost',
      (ev) => {
        onContextEvent({ type: 'lost' }, ev);
      },
    ],
    [
      'webglcontextrestored',
      (ev) => {
        onContextEvent({ type: 'restored' }, ev);
      },
    ],
  ];
  for (const [type, fn] of listeners) opts.canvas.addEventListener(type, fn);

  return {
    loadMap,
    unloadMap,
    beginRound(weapon) {
      beginCoreRound(core, weapon);
    },
    render(frame) {
      if (disposed || !canRender(ctx) || map === undefined) return;
      const aspect = resize();
      const outp = stepPresentation(core, frame, aspect);
      webgl.clear();
      if (!outp.draw) return;
      for (const w of botMeshes) syncInstances(w);
      for (const w of effectMeshes) syncInstances(w);
      const c = core.camera;
      camera.position.set(c.x, c.y, c.z);
      camera.rotation.set(c.pitch, c.yaw, c.roll);
      if (camera.fov !== c.vFovDeg || camera.aspect !== aspect || camera.far !== c.far) {
        camera.fov = c.vFovDeg;
        camera.aspect = aspect;
        camera.near = c.near;
        camera.far = c.far;
        camera.updateProjectionMatrix();
      }
      webgl.render(world, camera);
      if (vm !== undefined && outp.viewmodel.visible) {
        vm.update(outp.viewmodel, aspect);
        webgl.clearDepth();
        webgl.render(vm.scene, vm.camera);
      }
    },
    applySettings(settings) {
      const applied = applyRenderSettings(core, settings);
      applyGlSettings();
      return applied;
    },
    stats() {
      const info = webgl.info;
      return Object.freeze({
        ...coreStats(core),
        mapId: map?.mapId ?? null,
        contextState: ctx.state,
        mapMeshes: map?.meshes ?? 0,
        skippedSolids: map?.skippedSolids ?? 0,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
        gpuGeometries: info.memory.geometries,
        gpuTextures: info.memory.textures,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctx = contextTransition(ctx, { type: 'dispose' }).next;
      for (const [type, fn] of listeners) opts.canvas.removeEventListener(type, fn);
      unloadMap();
      for (const w of [...botMeshes, ...effectMeshes]) w.mesh.dispose();
      vm?.dispose();
      world.clear();
      webgl.dispose();
    },
  };
}
