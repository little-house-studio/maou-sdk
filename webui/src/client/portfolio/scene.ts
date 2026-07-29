/**
 * Demo scene for canvas-ui ThreeFilterPipeline showcase.
 */

import * as THREE from "three";
import { WORKS, type Work } from "./works";

export interface GalleryScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: THREE.Object3D[];
  setActive: (index: number) => void;
  update: (t: number, dt: number) => void;
  dispose: () => void;
}

function makeMaterial(work: Work): THREE.MeshStandardMaterial {
  const c = new THREE.Color().setHSL(work.hue, work.sat, Math.max(0.55, work.lit));
  const e = new THREE.Color().setHSL(work.hue, work.sat * 0.6, 0.35);
  return new THREE.MeshStandardMaterial({
    color: c,
    emissive: e,
    emissiveIntensity: 0.22,
    roughness: 0.32,
    metalness: 0.35,
    flatShading: work.form === "icosa" || work.form === "crystal",
  });
}

function makeGeometry(form: Work["form"]): THREE.BufferGeometry {
  switch (form) {
    case "knot":
      return new THREE.TorusKnotGeometry(1.0, 0.32, 180, 28);
    case "torus":
      return new THREE.TorusGeometry(1.15, 0.36, 32, 96);
    case "icosa":
      return new THREE.IcosahedronGeometry(1.25, 0);
    case "lathe": {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 18; i++) {
        const t = i / 17;
        const x = 0.18 + Math.sin(t * Math.PI) * 0.62 * (1 - t * 0.25);
        const y = (t - 0.5) * 2.2;
        pts.push(new THREE.Vector2(x, y));
      }
      return new THREE.LatheGeometry(pts, 48);
    }
    case "crystal":
      return new THREE.OctahedronGeometry(1.15, 0);
    default:
      return new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
}

export function createGalleryScene(): GalleryScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#3a3228");
  scene.fog = new THREE.Fog("#3a3228", 10, 24);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  camera.position.set(0, 0.4, 4.4);

  scene.add(new THREE.AmbientLight(0xfff0e0, 0.75));
  const key = new THREE.DirectionalLight(0xfff2dc, 1.6);
  key.position.set(3.5, 6, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c0e0, 0.55);
  fill.position.set(-4, 2, -2);
  scene.add(fill);
  const rim = new THREE.PointLight(0xffb060, 1.1, 14);
  rim.position.set(0, 0.5, 3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x2a2018, 0.45));

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 64),
    new THREE.MeshStandardMaterial({
      color: "#4a4034",
      roughness: 0.88,
      metalness: 0.05,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.4;
  scene.add(floor);

  const group = new THREE.Group();
  scene.add(group);

  const meshes: THREE.Object3D[] = [];
  WORKS.forEach((work, i) => {
    const mesh = new THREE.Mesh(makeGeometry(work.form), makeMaterial(work));
    mesh.scale.setScalar(i === 0 ? 1 : 0.001);
    mesh.visible = i === 0;
    group.add(mesh);
    meshes.push(mesh);
    mesh.add(
      new THREE.Mesh(
        (mesh.geometry as THREE.BufferGeometry).clone(),
        new THREE.MeshBasicMaterial({
          color: "#f0d8a8",
          wireframe: true,
          transparent: true,
          opacity: 0.12,
        }),
      ),
    );
  });

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.7, 0.025, 8, 64),
    new THREE.MeshStandardMaterial({
      color: "#6a5a40",
      roughness: 0.5,
      metalness: 0.35,
      emissive: "#3a2810",
      emissiveIntensity: 0.2,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.38;
  scene.add(ring);

  let active = 0;
  const targetPos = new THREE.Vector3();
  const targetLook = new THREE.Vector3(0, 0.1, 0);

  const setActive = (index: number) => {
    active = ((index % WORKS.length) + WORKS.length) % WORKS.length;
  };

  const update = (t: number, _dt: number) => {
    meshes.forEach((mesh, i) => {
      const on = i === active;
      const s = on ? 1 : 0.001;
      mesh.scale.x += (s - mesh.scale.x) * 0.18;
      mesh.scale.y = mesh.scale.x;
      mesh.scale.z = mesh.scale.x;
      mesh.visible = mesh.scale.x > 0.02;
      if (on) {
        mesh.rotation.y = t * 0.4;
        mesh.rotation.x = Math.sin(t * 0.35) * 0.15;
        mesh.position.y = Math.sin(t * 0.7) * 0.1;
      }
    });
    targetPos.set(
      Math.sin(t * 0.12) * 0.4,
      0.35 + Math.sin(t * 0.2) * 0.1,
      4.2 + Math.cos(t * 0.1) * 0.25,
    );
    camera.position.lerp(targetPos, 0.05);
    camera.lookAt(targetLook);
  };

  const dispose = () => {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  };

  return { scene, camera, meshes, setActive, update, dispose };
}
