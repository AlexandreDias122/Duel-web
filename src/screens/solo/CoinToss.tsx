// Pile ou face façon Master Duel : la pièce du Puzzle du Millénium est lancée, retombe,
// et le gagnant choisit de commencer en premier ou en second.
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { asset } from "./options";

interface Props {
  opponentName: string;
  /** L'adversaire préfère commencer en second s'il gagne. */
  opponentGoesSecond: boolean;
  onDone: (meFirst: boolean) => void;
  onCancel: () => void;
}

const FLIGHT_MS = 2300;

export function CoinToss({ opponentName, opponentGoesSecond, onDone, onCancel }: Props) {
  // Face (le triangle) : vous gagnez. Pile : l'adversaire gagne.
  const [face] = useState(() => Math.random() < 0.5);
  const [stage, setStage] = useState<"ready" | "flying" | "landed">("ready");
  useEffect(() => {
    const t1 = setTimeout(() => setStage("flying"), 450);
    const t2 = setTimeout(() => setStage("landed"), 450 + FLIGHT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  // L'adversaire choisit tout seul (en premier, sauf deck qui préfère jouer en second).
  useEffect(() => {
    if (stage !== "landed" || face) return;
    const t = setTimeout(() => onDone(opponentGoesSecond), 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, face, opponentGoesSecond]);

  // 6 tours complets pour face, un demi-tour de plus pour pile.
  const end = face ? 2160 : 2340;
  return (
    <div className="toss" role="dialog" aria-label="Pile ou face">
      <div className="toss-rays" />
      <h2 className="toss-title">Pile ou face</h2>
      <div className={`toss-stage ${stage}`}>
        <div className="toss-shadow" />
        <div className="toss-lift">
          <div className="toss-coin" style={{ "--end": `${end}deg` } as CSSProperties}>
            <img className="toss-face" src={asset("coin-face.webp")} alt="Face" draggable={false} />
            <img className="toss-back" src={asset("coin-back.webp")} alt="Pile" draggable={false} />
          </div>
        </div>
      </div>
      <div className="toss-result">
        {stage === "landed" && (
          <>
            <div className={`toss-word ${face ? "win" : "lose"}`}>{face ? "Face" : "Pile"}</div>
            {face ? (
              <>
                <p>Vous avez gagné le pile ou face !<br />Voulez-vous commencer en premier ou en second ?</p>
                <div className="toss-choices">
                  <button className="md-cta" onClick={() => onDone(true)}>En premier</button>
                  <button className="md-btn" onClick={() => onDone(false)}>En second</button>
                </div>
                <button className="toss-cancel" onClick={onCancel}>Retour au salon</button>
              </>
            ) : (
              <p>{opponentName} a gagné le pile ou face<br />et choisit de commencer <b>{opponentGoesSecond ? "en second" : "en premier"}</b>.</p>
            )}
          </>
        )}
        {stage !== "landed" && <p className="toss-hint">Face : vous choisissez. Pile : l'adversaire choisit.</p>}
      </div>
    </div>
  );
}
