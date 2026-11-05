// Plateau 3D (forêt) et compagnon (Rescue Rabbit) rendus avec three.js sous le terrain CSS.
// Chargé à la demande (import dynamique) pour ne pas alourdir le premier affichage.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODELS = `${import.meta.env.BASE_URL}models/`;

/** Écart entre deux zones du plateau d'origine, en unités du modèle (mesuré sur le modèle). */
const MODEL_COL = 8.6;
const MODEL_ROW = 9.1;
/** Emplacement du compagnon sur le plateau d'origine (côté joueur, à gauche). */
const AVATAR = new THREE.Vector3(37.58, 1.2, -6.94);
/** Hauteur du lapin, en nombre de rangées de zones. */
const MATE_ROWS = 1.45;
/** Case libre (rangée centrale, 2e colonne) utilisée quand le terrain occupe toute la largeur. */
const NARROW_SPOT = new THREE.Vector3(2 * MODEL_COL, 0, -0.42 * MODEL_ROW);
const MATE_ROWS_NARROW = 1.15;
const IDLE = "M09755_a";
const REACTIONS = ["M09755_b", "M09755_c", "M09755_g", "M09755_h", "M09755_i"];

export interface Board3D {
  /** Recalcule la caméra pour coller au terrain CSS (à appeler quand la mise en page change). */
  layout(): void;
  /** Le compagnon joue une animation de réaction ; renvoie faux si le point touché ne le vise pas. */
  poke(clientX: number, clientY: number): boolean;
  dispose(): void;
}

/**
 * Crée la scène dans `canvas`, posé en plein cadre dans `board` (l'élément qui porte la perspective CSS),
 * et aligne le modèle sur la grille `.field` contenue dans `.mat`.
 */
export async function createBoard3D(canvas: HTMLCanvasElement, board: HTMLElement): Promise<Board3D> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 2.2));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(-0.4, 0.6, 1);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;

  const loader = new GLTFLoader();
  const [near, far, mate] = await Promise.all(
    ["forest_near.glb", "forest_far.glb", "rescue_rabbit.glb"].map((f) => loader.loadAsync(MODELS + f)),
  );

  // Le plateau d'origine n'est pas éclairé (shaders « Unlit ») : matériaux de base.
  const field = new THREE.Group();
  field.matrixAutoUpdate = false;
  for (const g of [near, far]) {
    g.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      mesh.material = new THREE.MeshBasicMaterial({
        map: src.map, color: src.color, side: THREE.DoubleSide,
        transparent: src.transparent, alphaTest: src.alphaTest, depthWrite: !src.transparent,
      });
      src.dispose();
    });
    field.add(g.scene);
  }
  scene.add(field);

  const rabbit = new THREE.Group();
  rabbit.matrixAutoUpdate = false;
  rabbit.add(mate.scene);
  scene.add(rabbit);
  mate.scene.updateMatrixWorld(true);
  const mateBox = new THREE.Box3().setFromObject(mate.scene, true);
  const mateHeight = mateBox.max.y - mateBox.min.y || 1;
  const mixer = new THREE.AnimationMixer(mate.scene);
  const clips = new Map(mate.animations.map((a) => [a.name, a]));
  const idleClip = clips.get(IDLE) ?? mate.animations[0];
  let current: THREE.AnimationAction | null = idleClip ? mixer.clipAction(idleClip).play() : null;
  const play = (name: string) => {
    const clip = clips.get(name);
    if (!clip || !idleClip) return;
    const next = mixer.clipAction(clip);
    next.reset().setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    current?.crossFadeTo(next.play(), 0.25, false);
    current = next;
  };
  mixer.addEventListener("finished", () => {
    if (!idleClip || !current) return;
    const idle = mixer.clipAction(idleClip).reset().play();
    current.crossFadeTo(idle, 0.3, false);
    current = idle;
  });

  // ---- Alignement sur la mise en page CSS ----
  const mateScreen = new THREE.Box2();
  const layout = () => {
    const W = board.clientWidth, H = board.clientHeight;
    const mat = board.querySelector<HTMLElement>(".mat");
    const grid = mat?.querySelector<HTMLElement>(".field");
    if (!W || !H || !mat || !grid) return;
    renderer.setSize(W, H, false);

    const bs = getComputedStyle(board);
    const P = parseFloat(bs.perspective) || 1100;
    const [ox, oy] = bs.perspectiveOrigin.split(" ").map(parseFloat);
    const gs = getComputedStyle(grid);
    const colW = parseFloat(gs.gridTemplateColumns);
    const rowH = parseFloat(gs.gridTemplateRows);
    const pitchX = colW + (parseFloat(gs.columnGap) || 0);
    const pitchY = rowH + (parseFloat(gs.rowGap) || 0);
    const ms = getComputedStyle(mat);
    const [tox, toy] = ms.transformOrigin.split(" ").map(parseFloat);
    const css = ms.transform && ms.transform !== "none" ? new DOMMatrix(ms.transform) : new DOMMatrix();

    // Repère CSS du terrain (px, y vers le bas, z vers l'écran) → repère de la scène (y vers le haut).
    const toBoard = new THREE.Matrix4()
      .makeTranslation(mat.offsetLeft + tox, mat.offsetTop + toy, 0)
      .multiply(new THREE.Matrix4().fromArray(css.toFloat64Array()))
      .multiply(new THREE.Matrix4().makeTranslation(-tox, -toy, 0));
    const flipY = new THREE.Matrix4().makeScale(1, -1, 1);
    const chain = flipY.multiply(toBoard);
    const cx = grid.offsetLeft + grid.offsetWidth / 2;
    const cy = grid.offsetTop + grid.offsetHeight / 2;
    const sx = pitchX / MODEL_COL, sz = pitchY / MODEL_ROW;
    // Modèle (x, hauteur y, profondeur z ; le joueur côté z < 0) → terrain CSS (droite, bas, vers l'écran).
    const toMat = (kx: number, kz: number, kh: number) =>
      new THREE.Matrix4().set(-kx, 0, 0, cx, 0, 0, -kz, cy, 0, kh, 0, 0, 0, 0, 0, 1);
    field.matrix.copy(chain).multiply(toMat(sx, sz, sx));
    field.matrixWorldNeedsUpdate = true;

    // Caméra : même point de vue que la perspective CSS (œil à P px de l'écran, décentré).
    const n = 1, f = P * 4;
    camera.matrix.makeTranslation(ox, -oy, P);
    camera.matrixWorld.copy(camera.matrix);
    camera.matrixWorldInverse.copy(camera.matrix).invert();
    camera.projectionMatrix.makePerspective((-ox * n) / P, ((W - ox) * n) / P, (oy * n) / P, ((oy - H) * n) / P, n, f);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    // Compagnon : debout face à l'écran, à gauche du terrain du joueur. Sur un écran étroit (téléphone en
    // portrait), la place manque à côté du terrain : il se tient dans la case libre à côté de la zone extra gauche.
    const screenX = (x: number, z: number) => ox + ((x - ox) * P) / (P - z);
    let foot = AVATAR.clone().applyMatrix4(field.matrix);
    let h = pitchY * MATE_ROWS;
    if (screenX(foot.x - h * 0.36, foot.z) < 4) {
      foot = NARROW_SPOT.clone().applyMatrix4(field.matrix);
      h = pitchY * MATE_ROWS_NARROW;
    }
    const k = h / mateHeight;
    const halfW = h * 0.36;
    rabbit.matrix.compose(
      foot,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0.45, 0, "YXZ")),
      new THREE.Vector3(k, k, k),
    );
    rabbit.matrixWorldNeedsUpdate = true;
    // Zone touchable du lapin, en coordonnées écran (approximation par sa boîte projetée).
    const sxl = screenX(foot.x - halfW, foot.z), sxr = screenX(foot.x + halfW, foot.z);
    const syb = oy + ((-foot.y - oy) * P) / (P - foot.z), syt = oy + ((-(foot.y + h) - oy) * P) / (P - foot.z);
    mateScreen.set(new THREE.Vector2(sxl, syt), new THREE.Vector2(sxr, syb));
  };
  layout();

  // ---- Boucle de rendu (30 i/s, en pause quand l'onglet est masqué) ----
  const clock = new THREE.Clock();
  let raf = 0, acc = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dt = clock.getDelta();
    acc += dt;
    if (acc < 1 / 30) return;
    mixer.update(Math.min(acc, 0.1));
    acc = 0;
    renderer.render(scene, camera);
  };
  const onVisibility = () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) { clock.getDelta(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener("visibilitychange", onVisibility);
  raf = requestAnimationFrame(frame);

  return {
    layout,
    poke(clientX, clientY) {
      const r = board.getBoundingClientRect();
      if (!mateScreen.containsPoint(new THREE.Vector2(clientX - r.left, clientY - r.top))) return false;
      play(REACTIONS[Math.floor(Math.random() * REACTIONS.length)]);
      return true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      mixer.stopAllAction();
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
