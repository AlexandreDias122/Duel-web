// Icônes et habillages extraits des fichiers de Master Duel (data.unity3d) : boutons d'action ronds,
// boutons du menu de phase. Chargés par Vite comme des fichiers (URL).

const actionFiles = import.meta.glob("../assets/actions/*.webp", { eager: true, import: "default" }) as Record<string, string>;
const phaseFiles = import.meta.glob("../assets/phase/*.webp", { eager: true, import: "default" }) as Record<string, string>;

const byName = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ""), url]));

/** Boutons d'action ronds (GUI_T_DuelButtonActIcon*) : activate, set, summon, special, attack, position, atk-up, def-up, list, decide, cancel. */
export const ACTION_ICON: Record<string, string> = byName(actionFiles);
/** Menu de phase : base, ring, cursor et les icônes dp, sp, mp1, bp, mp2, ep. */
export const PHASE_ICON: Record<string, string> = byName(phaseFiles);
