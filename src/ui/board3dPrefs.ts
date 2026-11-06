// Réglages du terrain mémorisés sur l'appareil : plateau 3D et image de fond du tapis.
// Nouvelle clé : le plateau 3D est désormais désactivé par défaut, y compris pour qui l'avait déjà.
const KEY = "duelweb-board3d-v2";
const PLAYMAT_KEY = "duelweb-playmat";

export function board3dEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setBoard3dEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* stockage indisponible : réglage non mémorisé */
  }
}

/** Image du tapis choisie par le joueur (data URL), ou null pour le tapis gris par défaut. */
export function playmatImage(): string | null {
  try {
    return localStorage.getItem(PLAYMAT_KEY);
  } catch {
    return null;
  }
}

/** Mémorise l'image ; renvoie false si le stockage la refuse (trop lourde, navigation privée). */
export function setPlaymatImage(url: string | null): boolean {
  try {
    if (url) localStorage.setItem(PLAYMAT_KEY, url);
    else localStorage.removeItem(PLAYMAT_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Réduit l'image choisie (1600 px de large au plus, JPEG) pour qu'elle tienne dans le stockage du navigateur. */
export async function fileToPlaymat(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
