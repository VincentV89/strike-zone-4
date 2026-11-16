/**
 * Shader warmup (PD-R-7): one throwaway scene with every material in its instanced and plain
 * form, the effect materials and fog. compileAsync runs with shadows on and off, then one render
 * into a 16 × 16 target compiles the shadow depth programs, which compileAsync skips.
 */
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderTarget,
  type BufferGeometry,
  type Material,
  type WebGLRenderer,
} from 'three';

export interface WarmupInputs {
  readonly worldMaterials: ReadonlyArray<Material>;
  readonly instancedMaterials: ReadonlyArray<Material>;
  readonly geometry: BufferGeometry;
}

export async function warmupPrograms(renderer: WebGLRenderer, inp: WarmupInputs): Promise<void> {
  const scene = new Scene();
  scene.fog = new Fog(new Color(0.8, 0.8, 0.8), 10, 90);
  const sun = new DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.position.set(10, 20, 10);
  scene.add(sun, sun.target, new HemisphereLight(0xffffff, 0x444444, 0.5));
  for (const m of inp.worldMaterials) {
    const mesh = new Mesh(inp.geometry, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const m of inp.instancedMaterials) {
    const mesh = new InstancedMesh(inp.geometry, m, 1);
    mesh.setColorAt(0, new Color(1, 1, 1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const camera = new PerspectiveCamera(60, 1, 0.05, 100);
  camera.position.set(0, 2, 8);
  const shadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = true;
  await renderer.compileAsync(scene, camera);
  renderer.shadowMap.enabled = false;
  await renderer.compileAsync(scene, camera);
  renderer.shadowMap.enabled = true;
  const target = new WebGLRenderTarget(16, 16);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  target.dispose();
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  renderer.shadowMap.enabled = shadows;
  for (const child of scene.children) {
    if (child instanceof InstancedMesh) child.dispose();
  }
}
