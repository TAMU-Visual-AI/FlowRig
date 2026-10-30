// Shared 4D viewer (animated mesh + skeleton) used by the In-the-Wild and Dynamic Reconstruction sections.
//   AnimatedMesh      positions uint16 [T,V,3] (p = q / 65535 * 2 - 1) + faces [F,3]; ONE geometry that several
//                     views can display, updated once per frame
//   AnimatedSkeleton  per-frame joints + bones (parent, child); topology may change from frame to frame
//   View4DGroup       N canvases sharing ONE camera and orbit target: rotating / zooming any canvas moves all
// The skeleton is drawn in a second pass after a depth clear, so it stays visible through the mesh (x-ray),
// like the offline renders.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const COLORS = { mesh: 0xc7d1e0, bone: 0x5485eb, joint: 0xd14552 };
const LAYER_MESH = 0;
const LAYER_SKELETON = 1;

export function hasWebGL() {
  const probe = document.createElement('canvas');
  return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
}

export class AnimatedMesh {
  constructor(positions, faces, T, V) {
    if (positions.length !== T * V * 3 || faces.length % 3 !== 0) {
      throw new Error(`AnimatedMesh: positions ${positions.length} != ${T}*${V}*3 or faces ${faces.length} % 3`);
    }
    this.positions = positions;
    this.T = T;
    this.V = V;
    this.frame = -1;
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(faces, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.sqrt(3));   // data lives in [-1,1]^3
  }

  setFrame(k) {
    if (k === this.frame) return;
    if (!(k >= 0 && k < this.T)) throw new Error(`AnimatedMesh: frame ${k} outside [0, ${this.T})`);
    this.frame = k;
    const pos = this.posAttr.array, q = this.positions, base = k * this.V * 3;
    for (let i = 0; i < this.V * 3; i++) pos[i] = q[base + i] / 32767.5 - 1;
    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose() { this.geometry.dispose(); }
}

export class AnimatedSkeleton {
  // frames[t] = { joints: Float32Array(J_t * 3), bones: ArrayLike(B_t * 2) as (parent, child) pairs }
  constructor(frames, jointRadius, boneRadius) {
    frames.forEach((f, t) => {
      const J = f.joints.length / 3;
      if (f.joints.length % 3 !== 0 || f.bones.length % 2 !== 0) throw new Error(`AnimatedSkeleton: bad sizes at frame ${t}`);
      for (let i = 0; i < f.bones.length; i++) {
        if (!(f.bones[i] >= 0 && f.bones[i] < J)) throw new Error(`AnimatedSkeleton: bone index ${f.bones[i]} outside [0, ${J}) at frame ${t}`);
      }
    });
    this.frames = frames;
    this.T = frames.length;
    this.frame = -1;
    this.boneRadius = boneRadius;
    const maxJ = Math.max(1, ...frames.map((f) => f.joints.length / 3));
    const maxB = Math.max(1, ...frames.map((f) => f.bones.length / 2));
    const cone = new THREE.ConeGeometry(1, 1, 18, 1);
    cone.translate(0, 0.5, 0);   // base (wide) at y=0 = parent, apex at y=1 = child
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(jointRadius, 18, 12),
      new THREE.MeshPhongMaterial({ color: COLORS.joint, shininess: 40 }), maxJ);
    this.bones = new THREE.InstancedMesh(cone, new THREE.MeshPhongMaterial({ color: COLORS.bone, shininess: 40 }), maxB);
    this.objects = [this.joints, this.bones];
    this.objects.forEach((m) => {
      m.layers.set(LAYER_SKELETON);
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    });
  }

  setFrame(k) {
    if (k === this.frame) return;
    if (!(k >= 0 && k < this.T)) throw new Error(`AnimatedSkeleton: frame ${k} outside [0, ${this.T})`);
    this.frame = k;
    const { joints: J, bones: B } = this.frames[k];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const p = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const nJ = J.length / 3, nB = B.length / 2;
    for (let j = 0; j < nJ; j++) {
      m.makeTranslation(J[3 * j], J[3 * j + 1], J[3 * j + 2]);
      this.joints.setMatrixAt(j, m);
    }
    for (let b = 0; b < nB; b++) {
      p.fromArray(J, 3 * B[2 * b]);
      c.fromArray(J, 3 * B[2 * b + 1]);
      dir.subVectors(c, p);
      const len = dir.length();
      q.setFromUnitVectors(up, len > 1e-8 ? dir.divideScalar(len) : up);
      m.compose(p, q, len > 1e-8 ? s.set(this.boneRadius, len, this.boneRadius) : s.set(0, 0, 0));
      this.bones.setMatrixAt(b, m);
    }
    this.joints.count = nJ;
    this.bones.count = nB;
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.objects.forEach((o) => { o.geometry.dispose(); o.material.dispose(); o.dispose(); });
  }
}

export class View4DGroup {
  // stages: elements of identical size; one WebGL canvas each, all looking through the same camera
  constructor(stages, { background = 0xf5f6f8 } = {}) {
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.target = new THREE.Vector3();
    this.material = new THREE.MeshPhongMaterial({ color: COLORS.mesh, specular: 0x1c1c1c, shininess: 24, side: THREE.DoubleSide });
    this.views = stages.map((stage) => {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(background, 1);
      renderer.autoClear = false;
      stage.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8a93a6, 1.4);
      const head = new THREE.DirectionalLight(0xffffff, 2.2);   // follows the shared camera (see render)
      hemi.layers.enableAll();
      head.layers.enableAll();
      scene.add(hemi, head, head.target);
      return { stage, renderer, scene, head, controls: null, content: [] };
    });
    this.meshes = [];
    this.skeletons = [];
    this.home = null;
    this.dirty = true;
    this.running = false;
    this.animate = this.animate.bind(this);
    this.makeControls(new THREE.Vector3(0, 1, 0));
    const ro = new ResizeObserver(() => this.resize());
    stages.forEach((s) => ro.observe(s));
    this.resize();
  }

  // OrbitControls caches the camera's up axis when constructed -> rebuild them when the up axis changes
  makeControls(up) {
    this.camera.up.copy(up);
    this.views.forEach((v) => {
      if (v.controls) v.controls.dispose();
      const c = new OrbitControls(this.camera, v.renderer.domElement);
      c.target = this.target;   // one shared target object: every canvas orbits the same point
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      c.screenSpacePanning = true;
      c.addEventListener('change', () => { this.dirty = true; });
      v.controls = c;
    });
  }

  // contents[i] = { mesh: AnimatedMesh|null, skeleton: AnimatedSkeleton|null } for canvas i
  setContents(contents) {
    this.clearContents();
    contents.forEach(({ mesh, skeleton }, i) => {
      const v = this.views[i];
      if (mesh) {
        const obj = new THREE.Mesh(mesh.geometry, this.material);
        obj.layers.set(LAYER_MESH);
        v.scene.add(obj);
        v.content.push(obj);
        if (!this.meshes.includes(mesh)) this.meshes.push(mesh);
      }
      if (skeleton) {
        v.scene.add(...skeleton.objects);
        v.content.push(...skeleton.objects);
        this.skeletons.push(skeleton);
      }
    });
    this.dirty = true;
  }

  // swap the skeleton of canvas i (e.g. a baseline menu) and keep everything else; null = show no skeleton
  replaceSkeleton(i, skeleton) {
    const v = this.views[i];
    const old = this.skeletons.find((s) => s.objects.every((o) => v.content.includes(o)));
    if (old) {
      old.objects.forEach((o) => v.scene.remove(o));
      v.content = v.content.filter((o) => !old.objects.includes(o));
      old.dispose();
      this.skeletons = this.skeletons.filter((s) => s !== old);
    }
    if (skeleton) {
      v.scene.add(...skeleton.objects);
      v.content.push(...skeleton.objects);
      this.skeletons.push(skeleton);
      const k = this.meshes.length ? this.meshes[0].frame : -1;
      if (k >= 0) skeleton.setFrame(k);
    }
    this.dirty = true;
  }

  clearContents() {
    this.views.forEach((v) => { v.content.forEach((o) => v.scene.remove(o)); v.content = []; });
    this.meshes.forEach((m) => m.dispose());
    this.skeletons.forEach((s) => s.dispose());
    this.meshes = [];
    this.skeletons = [];
    this.dirty = true;
  }

  // Home camera: looking from eyeDir with the given up, framed tightly on `positions` (uint16 [T,V,3] web coords)
  setHome(eyeDir, up, positions) {
    const ez = new THREE.Vector3().fromArray(eyeDir).normalize();
    const ey0 = new THREE.Vector3().fromArray(up).normalize();
    const ex = new THREE.Vector3().crossVectors(ey0, ez).normalize();
    const ey = new THREE.Vector3().crossVectors(ez, ex);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * this.camera.aspect;
    let dist = 0;
    for (let i = 0; i < positions.length; i += 12) {   // every 4th vertex of every frame
      const x = positions[i] / 32767.5 - 1, y = positions[i + 1] / 32767.5 - 1, z = positions[i + 2] / 32767.5 - 1;
      const px = x * ex.x + y * ex.y + z * ex.z, py = x * ey.x + y * ey.y + z * ey.z, pz = x * ez.x + y * ez.y + z * ez.z;
      dist = Math.max(dist, 1.12 * Math.max(Math.abs(px) / tanH, Math.abs(py) / tanV) + pz);   // nearer points need more room
    }
    this.home = { position: ez.clone().multiplyScalar(dist), up: ey };
    this.makeControls(ey);
    this.views.forEach((v) => {
      v.controls.minDistance = dist * 0.15;
      v.controls.maxDistance = dist * 6;
    });
    this.resetView();
  }

  resetView() {
    if (!this.home) return;
    this.target.set(0, 0, 0);
    this.camera.position.copy(this.home.position);
    this.camera.up.copy(this.home.up);
    this.camera.lookAt(this.target);
    this.views.forEach((v) => v.controls.update());
    this.dirty = true;
  }

  setFrame(k) {
    this.meshes.forEach((m) => m.setFrame(k));
    this.skeletons.forEach((s) => s.setFrame(k));
    this.dirty = true;
  }

  resize() {
    const s0 = this.views[0].stage;
    const w0 = Math.max(1, s0.clientWidth), h0 = Math.max(1, s0.clientHeight);
    this.views.forEach((v) => v.renderer.setSize(Math.max(1, v.stage.clientWidth), Math.max(1, v.stage.clientHeight), false));
    this.camera.aspect = w0 / h0;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  render() {
    this.camera.updateMatrixWorld();
    const headPos = this.camera.localToWorld(new THREE.Vector3(0.6, 0.8, 0.2).multiplyScalar(this.camera.position.distanceTo(this.target)));
    this.views.forEach((v) => {
      v.head.position.copy(headPos);
      v.head.target.position.copy(this.target);
      v.head.target.updateMatrixWorld();
      const r = v.renderer;
      r.clear();
      this.camera.layers.set(LAYER_MESH);
      r.render(v.scene, this.camera);
      r.clearDepth();
      this.camera.layers.set(LAYER_SKELETON);
      r.render(v.scene, this.camera);
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.animate);
  }

  stop() { this.running = false; }

  animate() {
    if (!this.running) return;
    requestAnimationFrame(this.animate);
    let moved = false;
    this.views.forEach((v) => { moved = v.controls.update() || moved; });
    if (moved || this.dirty) {
      this.render();
      this.dirty = false;
    }
  }
}
