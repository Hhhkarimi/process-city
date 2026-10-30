import * as THREE from "three";

/** Resolve a visible building surface to the process represented by that surface. */
export function pickBuilding(
  ray: THREE.Raycaster,
  bodies: THREE.InstancedMesh,
  roofs: THREE.Group,
  keys: readonly string[],
): string | null {
  // Instance transforms change as measurements arrive and buildings grow.
  // Three caches this bound; a bound computed for an empty/older city rejects valid rays.
  bodies.computeBoundingSphere();
  bodies.updateWorldMatrix(true, false);
  roofs.updateWorldMatrix(true, true);
  for (const hit of ray.intersectObjects([bodies, roofs], true)) {
    if (hit.object === bodies && hit.instanceId !== undefined)
      return keys[hit.instanceId] ?? null;
    let owner: THREE.Object3D | null = hit.object;
    while (owner && owner !== roofs) {
      if (typeof owner.userData.processKey === "string")
        return owner.userData.processKey;
      owner = owner.parent;
    }
  }
  return null;
}
