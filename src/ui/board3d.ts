// Plateau 3D (forêt) rendu avec three.js sous le terrain CSS.
// Chargé à la demande (import dynamique) pour ne pas alourdir le premier affichage.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { MAT_HALF_D, MAT_HALF_W } from "./matGeometry";

const MODELS = `${import.meta.env.BASE_URL}models/`;

/** Socles du cimetière et des bannis, posés à côté du plateau (repère du modèle). */
const PEDESTALS: [string, THREE.Vector3][] = [
  ["grave_near.glb", new THREE.Vector3(-25.74, -0.22, -14.26)],
  ["grave_far.glb", new THREE.Vector3(25.74, -0.22, 14.26)],
];

export interface Board3D {
  /** Recalcule la caméra pour coller au terrain CSS (à appeler quand la mise en page change). */
  layout(): void;
  dispose(): void;
}

/**
 * Crée la scène dans `canvas` (qui couvre tout l'écran de duel) et aligne le modèle sur le tapis `.mat`
 * contenu dans `board`, l'élément qui porte la perspective CSS.
 */
export async function createBoard3D(canvas: HTMLCanvasElement, board: HTMLElement): Promise<Board3D> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;

  const loader = new GLTFLoader();
  // Minuteur : déjà placé dans son modèle (bord gauche, entre les deux camps).
  // Le bouton de phase n'est pas en 3D : c'est le même médaillon (image) que sur le tapis 2D, posé par-dessus.
  const files = ["forest_near.glb", "forest_far.glb", ...PEDESTALS.map(([f]) => f), "timer.glb"];
  const gltfs = await Promise.all(files.map((f) => loader.loadAsync(MODELS + f)));

  // Le plateau d'origine n'est pas éclairé (shaders « Unlit ») : matériaux de base.
  const field = new THREE.Group();
  field.matrixAutoUpdate = false;
  gltfs.forEach((g, i) => {
    g.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      // Le cadran du minuteur (shader animé à l'origine, sans texture) devient un verre bleu nuit sous le texte.
      const glass = i >= 2 + PEDESTALS.length && (!src.map || /surface/i.test(mesh.name));
      mesh.material = new THREE.MeshBasicMaterial({
        map: src.map, color: glass ? new THREE.Color(0x0b1b3a) : src.color, side: THREE.DoubleSide,
        transparent: src.transparent, alphaTest: src.alphaTest, depthWrite: !src.transparent,
      });
      src.dispose();
    });
    const pedestal = PEDESTALS[i - 2];
    if (pedestal) g.scene.position.copy(pedestal[1]);
    field.add(g.scene);
  });
  scene.add(field);

  // ---- Alignement sur la mise en page CSS ----
  const layout = () => {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const mat = board.querySelector<HTMLElement>(".mat");
    if (!W || !H || !mat || !mat.offsetWidth) return;
    renderer.setSize(W, H, false);

    // Position du terrain dans le canvas (le canvas couvre tout l'écran de duel, le terrain une partie).
    const cr = canvas.getBoundingClientRect(), br = board.getBoundingClientRect();
    const bx = br.left - cr.left, by = br.top - cr.top;
    const bs = getComputedStyle(board);
    const P = parseFloat(bs.perspective) || 1100;
    const [pox, poy] = bs.perspectiveOrigin.split(" ").map(parseFloat);
    const ox = bx + pox, oy = by + poy;
    // Position du tapis avant sa transformation, en remontant les offsetParent jusqu'au terrain.
    let mx = 0, my = 0;
    for (let el: HTMLElement | null = mat; el && el !== board; el = el.offsetParent as HTMLElement | null) {
      mx += el.offsetLeft;
      my += el.offsetTop;
      if (el.offsetParent && !board.contains(el.offsetParent)) break;
    }
    const ms = getComputedStyle(mat);
    const [tox, toy] = ms.transformOrigin.split(" ").map(parseFloat);
    const css = ms.transform && ms.transform !== "none" ? new DOMMatrix(ms.transform) : new DOMMatrix();

    // Repère CSS du tapis (px, y vers le bas, z vers l'écran) → repère de la scène (y vers le haut).
    const toCanvas = new THREE.Matrix4()
      .makeTranslation(bx + mx + tox, by + my + toy, 0)
      .multiply(new THREE.Matrix4().fromArray(css.toFloat64Array()))
      .multiply(new THREE.Matrix4().makeTranslation(-tox, -toy, 0));
    const chain = new THREE.Matrix4().makeScale(1, -1, 1).multiply(toCanvas);
    // Une unité du modèle = --u px ; le centre du modèle (entre les Zones Monstre Extra) = centre du tapis.
    const u = mat.offsetWidth / (2 * MAT_HALF_W);
    const cx = mat.clientLeft + MAT_HALF_W * u, cy = mat.clientTop + MAT_HALF_D * u;
    // Modèle (x, hauteur y, profondeur z ; le joueur côté z < 0, x inversé par l'export) → tapis CSS.
    const toMat = new THREE.Matrix4().set(-u, 0, 0, cx, 0, 0, -u, cy, 0, u, 0, 0, 0, 0, 0, 1);
    field.matrix.copy(chain).multiply(toMat);
    field.matrixWorldNeedsUpdate = true;

    // Caméra : même point de vue que la perspective CSS (œil à P px de l'écran, décentré).
    const n = 1, f = P * 4;
    camera.matrix.makeTranslation(ox, -oy, P);
    camera.matrixWorld.copy(camera.matrix);
    camera.matrixWorldInverse.copy(camera.matrix).invert();
    camera.projectionMatrix.makePerspective((-ox * n) / P, ((W - ox) * n) / P, (oy * n) / P, ((oy - H) * n) / P, n, f);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    renderer.render(scene, camera);
  };
  layout();

  return {
    layout,
    dispose() {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of [mesh.material].flat()) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
    },
  };
}
