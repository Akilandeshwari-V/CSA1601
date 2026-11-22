import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AXIS_COLORS } from '../theme.js';

const S = 10; // edge length of the cube in scene units
const RAMP = ['#3b5bdb', '#14b8c4', '#f7c948'].map((c) => new THREE.Color(c));

export const rampColor = (t, target = new THREE.Color()) => {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return target.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
};
export const RAMP_CSS = 'linear-gradient(90deg,#3b5bdb,#14b8c4,#f7c948)';

export function createEngine(container, cb) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  const HOME = new THREE.Vector3(13.5, 9.5, 17);
  camera.position.copy(HOME);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 9;
  controls.maxDistance = 48;
  controls.autoRotateSpeed = 1.4;

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(8, 14, 10);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x88ccff, 0.6);
  fill.position.set(-10, -4, -8);
  scene.add(fill);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(S, S, S)),
    new THREE.LineBasicMaterial({ color: 0xb7e3d8, transparent: true, opacity: 0.85 }),
  );
  scene.add(frame);

  const gridGroup = new THREE.Group();
  const labelGroup = new THREE.Group();
  const cellGroup = new THREE.Group();
  scene.add(gridGroup, labelGroup, cellGroup);

  const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const hoverOutline = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xffd166 }));
  const selOutline = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0xffffff }));
  hoverOutline.visible = false;
  selOutline.visible = false;
  scene.add(hoverOutline, selOutline);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  let mesh = null;
  let cells = [];
  let sizes = []; // per-instance scale (x,y,z)
  let positions = [];
  let hoverIdx = -1;

  const disposeGroup = (g) => {
    for (const child of [...g.children]) {
      g.remove(child);
      if (child.element?.parentNode) child.element.parentNode.removeChild(child.element);
      child.geometry?.dispose?.();
      if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
    }
  };

  function addLabel(text, x, y, z, cls, cx, cy, color) {
    const el = document.createElement('div');
    el.className = 'cube-lbl ' + cls;
    el.textContent = text;
    if (color) el.style.setProperty('--ax', color);
    const o = new CSS2DObject(el);
    o.position.set(x, y, z);
    o.center.set(cx, cy);
    labelGroup.add(o);
  }

  function placeOutline(outline, idx, grow = 1.14) {
    if (idx < 0 || !positions[idx]) { outline.visible = false; return; }
    const p = positions[idx], s = sizes[idx];
    outline.position.set(p[0], p[1], p[2]);
    outline.scale.set(s[0] * grow, s[1] * grow, s[2] * grow);
    outline.visible = true;
  }

  function update(result, measure, selectedId) {
    disposeGroup(gridGroup); disposeGroup(labelGroup); disposeGroup(cellGroup);
    mesh = null; hoverIdx = -1; hoverOutline.visible = false;
    cells = result.cells;
    const n = result.grid;
    const pos = (axis, idx) => -S / 2 + ((idx + 0.5) * S) / n[axis];
    const bound = (axis, k) => -S / 2 + (k * S) / n[axis];
    const step = (cnt) => Math.max(1, Math.ceil(cnt / 24));

    // back-wall grids
    const pts = [];
    const h = S / 2;
    for (let k = 0; k <= n[0]; k += step(n[0])) {
      pts.push(bound(0, k), -h, -h, bound(0, k), -h, h);
      pts.push(bound(0, k), -h, -h, bound(0, k), h, -h);
    }
    for (let k = 0; k <= n[1]; k += step(n[1])) {
      pts.push(-h, bound(1, k), -h, h, bound(1, k), -h);
      pts.push(-h, bound(1, k), -h, -h, bound(1, k), h);
    }
    for (let k = 0; k <= n[2]; k += step(n[2])) {
      pts.push(-h, -h, bound(2, k), h, -h, bound(2, k));
      pts.push(-h, -h, bound(2, k), -h, h, bound(2, k));
    }
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    gridGroup.add(new THREE.LineSegments(gGeo, new THREE.LineBasicMaterial({ color: 0x5b9a8d, transparent: true, opacity: 0.32 })));

    // lattice dots for empty cells (gives the "cube of cells" look)
    if (result.gridSize <= 9000) {
      const occupied = new Set(cells.map((c) => c.id));
      const dots = [];
      for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) {
        if (!occupied.has((i * n[1] + j) * n[2] + k)) dots.push(pos(0, i), pos(1, j), pos(2, k));
      }
      if (dots.length) {
        const dGeo = new THREE.BufferGeometry();
        dGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
        cellGroup.add(new THREE.Points(dGeo, new THREE.PointsMaterial({ color: 0x8fc4b8, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.4 })));
      }
    }

    // axis labels
    const maxLabels = 16;
    result.axes.forEach((ax, a) => {
      const stp = Math.max(1, Math.ceil(ax.members.length / maxLabels));
      const color = AXIS_COLORS[a];
      ax.members.forEach((m, i) => {
        if (i % stp) return;
        if (a === 0) addLabel(m.label, pos(0, i), -h - 0.35, h + 0.5, 'tick', 0.5, 0, color);
        if (a === 1) addLabel(m.label, -h - 0.5, pos(1, i), h + 0.35, 'tick', 1, 0.5, color);
        if (a === 2) addLabel(m.label, h + 0.5, -h - 0.35, pos(2, i), 'tick', 0, 0.5, color);
      });
      const title = `${ax.dimName} › ${ax.levelName}`;
      if (a === 0) addLabel(title, 0, -h - 1.7, h + 1.9, 'title', 0.5, 0.5, color);
      if (a === 1) addLabel(title, -h - 0.5, h + 1.0, h + 0.35, 'title', 1, 0.5, color);
      if (a === 2) addLabel(title, h + 1.0, -h - 1.2, 0, 'title', 0, 0.5, color);
    });

    // cells
    positions = []; sizes = [];
    if (cells.length) {
      const base = n.map((c) => Math.min((S / c) * 0.8, S * 0.22));
      const max = result.max[measure] || 1;
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.12, transparent: true, opacity: 0.95 });
      mesh = new THREE.InstancedMesh(geo, mat, cells.length);
      cells.forEach((c, idx) => {
        const t = Math.sqrt(Math.max(0, c[measure]) / max);
        const f = 0.4 + 0.6 * t;
        const p = [pos(0, c.i), pos(1, c.j), pos(2, c.k)];
        const s = [base[0] * f, base[1] * f, base[2] * f];
        positions.push(p); sizes.push(s);
        dummy.position.set(p[0], p[1], p[2]);
        dummy.scale.set(s[0], s[1], s[2]);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        mesh.setColorAt(idx, rampColor(t, tmpColor));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      cellGroup.add(mesh);
    }
    placeOutline(selOutline, selectedId == null ? -1 : cells.findIndex((c) => c.id === selectedId), 1.2);
  }

  function setSelected(selectedId) {
    placeOutline(selOutline, selectedId == null ? -1 : cells.findIndex((c) => c.id === selectedId), 1.2);
  }

  function pick(clientX, clientY) {
    if (!mesh) return -1;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    return hit && hit.instanceId != null ? hit.instanceId : -1;
  }

  // --- interaction -------------------------------------------------------
  const el = renderer.domElement;
  let down = null;
  let raf = 0;
  const onMove = (e) => {
    if (e.buttons) { if (hoverIdx !== -1) { hoverIdx = -1; hoverOutline.visible = false; cb.onHover(null); } return; }
    if (raf) return;
    const { clientX, clientY } = e;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const idx = pick(clientX, clientY);
      const r = container.getBoundingClientRect();
      if (idx !== hoverIdx) { hoverIdx = idx; placeOutline(hoverOutline, idx, 1.1); el.style.cursor = idx >= 0 ? 'pointer' : 'grab'; }
      cb.onHover(idx >= 0 ? { cell: cells[idx], x: clientX - r.left, y: clientY - r.top } : null);
    });
  };
  const onLeave = () => { hoverIdx = -1; hoverOutline.visible = false; cb.onHover(null); };
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const idx = pick(e.clientX, e.clientY);
    cb.onSelect(idx >= 0 ? cells[idx] : null);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.style.cursor = 'grab';

  // --- sizing -------------------------------------------------------------
  const resize = () => {
    const w = Math.max(120, container.clientWidth);
    const hgt = Math.max(120, container.clientHeight);
    renderer.setSize(w, hgt, false);
    el.style.width = '100%'; el.style.height = '100%';
    labelRenderer.setSize(w, hgt);
    camera.aspect = w / hgt;
    // keep the cube fully visible on portrait / narrow screens by widening the vertical FOV
    const base = 40;
    camera.fov = camera.aspect < 1.15 ? (2 * Math.atan(Math.tan((base * Math.PI) / 360) / Math.min(1, camera.aspect / 1.15)) * 180) / Math.PI : base;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return {
    update,
    setSelected,
    setAutoRotate: (v) => { controls.autoRotate = v; },
    resetView: () => { camera.position.copy(HOME); controls.target.set(0, 0, 0); controls.update(); },
    dispose() {
      renderer.setAnimationLoop(null);
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      controls.dispose();
      [gridGroup, labelGroup, cellGroup].forEach(disposeGroup);
      frame.geometry.dispose(); frame.material.dispose();
      unitEdges.dispose(); hoverOutline.material.dispose(); selOutline.material.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}

export default function CubeScene({ result, measure, selectedId, autoRotate, resetToken, onHover, onSelect }) {
  const host = useRef(null);
  const engine = useRef(null);
  const cbs = useRef({});
  cbs.current = { onHover, onSelect };
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      engine.current = createEngine(host.current, {
        onHover: (h) => cbs.current.onHover?.(h),
        onSelect: (c) => cbs.current.onSelect?.(c),
      });
    } catch (e) {
      setError(e.message || String(e));
    }
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);

  useEffect(() => { engine.current?.update(result, measure, selectedId); }, [result, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => { engine.current?.setAutoRotate(autoRotate); }, [autoRotate]);
  useEffect(() => { if (resetToken) engine.current?.resetView(); }, [resetToken]);

  return (
    <div className="cube-host" ref={host} role="img" aria-label="Interactive 3D OLAP cube. Drag to rotate, scroll to zoom, click a cell for details.">
      {error && (
        <div className="cube-error">
          <strong>3D view unavailable.</strong>
          <span>WebGL could not start in this browser ({error}). The cube table below shows the same data.</span>
        </div>
      )}
    </div>
  );
}
