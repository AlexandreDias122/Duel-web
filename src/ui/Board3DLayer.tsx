import { useEffect, useRef, useState } from "react";

/**
 * Plateau 3D affiché en fond de l'écran de duel, aligné sur le tapis CSS de `.duel-board`.
 * `onReady` signale que la scène est prête, pour rendre le tapis CSS transparent.
 */
export function Board3DLayer({ onReady }: { onReady: (ready: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const canvas = ref.current;
    const board = canvas?.parentElement?.querySelector<HTMLElement>(".duel-board");
    if (!canvas || !board) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let dispose = () => {};
    import("./board3d")
      .then(({ createBoard3D }) => createBoard3D(canvas, board))
      .then((s) => {
        if (cancelled) return s.dispose();
        dispose = () => s.dispose();
        readyRef.current(true);
        // La mise en page change avec la taille de l'écran et quand le terrain apparaît : on suit tout.
        ro = new ResizeObserver(() => s.layout());
        ro.observe(canvas);
        ro.observe(board);
        const mat = board.querySelector(".mat");
        if (mat) ro.observe(mat);
      })
      .catch((err) => {
        console.warn("Plateau 3D indisponible", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      ro?.disconnect();
      dispose();
      readyRef.current(false);
    };
  }, []);

  if (failed) return null;
  return <canvas ref={ref} className="board-3d" aria-hidden="true" />;
}
