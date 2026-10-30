import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { pickBuilding } from "../src/picking.ts";

function fixture() {
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    110,
  );
  const roofs = new THREE.Group();
  bodies.count = 0;
  return {
    bodies,
    roofs,
    ray: new THREE.Raycaster(
      new THREE.Vector3(5, 2, 5),
      new THREE.Vector3(0, 0, -1),
    ),
  };
}
function place(bodies: THREE.InstancedMesh, x: number) {
  bodies.count = 1;
  bodies.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 2, 0));
  bodies.instanceMatrix.needsUpdate = true;
  bodies.updateMatrixWorld(true);
}
test("building selection survives a cached empty instanced bound followed by first data", () => {
  const { bodies, roofs, ray } = fixture();
  bodies.computeBoundingSphere();
  place(bodies, 5);
  assert.equal(pickBuilding(ray, bodies, roofs, ["process-a"]), "process-a");
});
test("selection follows relocated instances after snapshot and camera layout changes", () => {
  const { bodies, roofs, ray } = fixture();
  place(bodies, -5);
  bodies.computeBoundingSphere();
  place(bodies, 5);
  assert.equal(pickBuilding(ray, bodies, roofs, ["process-b"]), "process-b");
});
test("an architectural roof surface selects its owner even outside the body footprint", () => {
  const { bodies, roofs, ray } = fixture();
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 2),
    new THREE.MeshBasicMaterial(),
  );
  roof.position.set(5, 2, 0);
  const building = new THREE.Group();
  building.userData.processKey = "roof-owner";
  building.add(roof);
  roofs.add(building);
  roofs.updateMatrixWorld(true);
  assert.equal(pickBuilding(ray, bodies, roofs, []), "roof-owner");
});
test("empty space never selects a process", () => {
  const { bodies, roofs, ray } = fixture();
  assert.equal(pickBuilding(ray, bodies, roofs, []), null);
});
