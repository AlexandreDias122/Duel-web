// Réglage « plateau 3D » mémorisé sur l'appareil.
const KEY = "duelweb-board3d";

export function board3dEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBoard3dEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* stockage indisponible : réglage non mémorisé */
  }
}
