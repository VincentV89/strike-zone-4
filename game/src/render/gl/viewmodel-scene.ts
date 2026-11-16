/**
 * Viewmodel scene (LC-G-6, PD-R-10): its own camera (55° vertical, near 0.01), drawn after the
 * world with depth cleared, hidden while scoped or dead. One weapon mesh is visible at a time,
 * plus the flash quad sized to < 2% of the viewport (SD-R-6).
 */
import type { AssetFactory } from '@sz/assets';
import { VIEWMODELS } from '@sz/assets/core/viewmodel-parts';
import { VIEWMODEL_FOV_DEG, VM_FLASH_DIST, VM_FLASH_SIZE } from '@sz/render/core/flash';
import type { ViewmodelPose } from '@sz/render/core/viewmodel';
import type { WeaponId } from '@sz/kernel';
import { DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene } from 'three';

export interface ViewmodelScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  update(pose: ViewmodelPose, aspect: number): void;
  dispose(): void;
}

export function createViewmodelScene(assets: AssetFactory): ViewmodelScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(VIEWMODEL_FOV_DEG, 16 / 9, 0.01, 5);
  scene.add(new HemisphereLight(0xdfe8f0, 0x40382c, 1.1));
  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(0.5, 1, 0.3);
  scene.add(key);
  const rig = new Group();
  scene.add(rig);
  const weapons = new Map<WeaponId, Mesh>();
  const vmMat = assets.viewmodelMaterial();
  for (const [weapon] of VIEWMODELS) {
    const geo = assets.viewmodel(weapon);
    if (geo === undefined || vmMat === undefined) continue;
    const mesh = new Mesh(geo, vmMat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    rig.add(mesh);
    weapons.set(weapon, mesh);
  }
  const quad = assets.quadGeometry();
  const flashMat = assets.effectMaterial('muzzle');
  const flash = quad !== undefined && flashMat !== undefined ? new Mesh(quad, flashMat) : undefined;
  if (flash !== undefined) {
    flash.scale.setScalar(VM_FLASH_SIZE);
    flash.visible = false;
    flash.frustumCulled = false;
    scene.add(flash);
  }

  return {
    scene,
    camera,
    update(pose, aspect) {
      if (Number.isFinite(aspect) && aspect > 0 && camera.aspect !== aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      const spec = VIEWMODELS.get(pose.weapon);
      for (const [w, mesh] of weapons) mesh.visible = pose.visible && w === pose.weapon;
      if (spec !== undefined) {
        rig.position.set(spec.rest.x + pose.x, spec.rest.y + pose.y, spec.rest.z + pose.z);
        rig.rotation.set(pose.pitch, 0, pose.roll);
      }
      if (flash !== undefined) {
        flash.visible = pose.visible && pose.flash;
        // On the barrel line, at the fixed flash distance used for the 2% area pin.
        flash.position.set(rig.position.x, rig.position.y, -VM_FLASH_DIST);
      }
    },
    dispose() {
      scene.clear();
      weapons.clear();
    },
  };
}
