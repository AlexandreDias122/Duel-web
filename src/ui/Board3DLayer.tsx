import { useEffect, useRef, useState } from "react";
import type { Board3D } from "./board3d";

/**
 * Plateau 3D affiché derrière le terrain CSS (même élément parent, qui porte la perspective).
 * `onReady` signale que la scène est prête, pour rendre le tapis CSS transparent.
 */
export function Board3DLayer({ onReady }: { onReady: (ready: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const canvas = ref.current;
    const board = canvas?.parentElement;
    if (!canvas || !board) return;
    let scene: Board3D | null = null;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    const onTap = (e: PointerEvent) => {
      // Seulement hors des zones et des boutons : le lapin ne doit pas voler une touche destinée au jeu.
      if (!(e.target as Element).closest(".cell, button")) scene?.poke(e.clientX, e.clientY);
    };
    import("./board3d")
      .then(({ createBoard3D }) => createBoard3D(canvas, board))
      .then((s) => {
        if (cancelled) return s.dispose();
        scene = s;
        readyRef.current(true);
        // La mise en page change avec la taille de l'écran et quand le terrain apparaît : on suit les deux.
        ro = new ResizeObserver(() => s.layout());
        ro.observe(board);
        const mat = board.querySelector(".mat");
        if (mat) ro.observe(mat);
        board.addEventListener("pointerdown", onTap);
      })
      .catch((err) => {
        console.warn("Plateau 3D indisponible", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
      board.removeEventListener("pointerdown", onTap);
      scene?.dispose();
      readyRef.current(false);
    };
  }, []);

  if (failed) return null;
  return <canvas ref={ref} className="board-3d" aria-hidden="true" />;
}
