// Génère les données statiques servies par l'appli (public/data, public/scripts)
// à partir des dépôts Project Ignis téléchargés par fetch-data.sh.
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const DATA = process.env.DATA_DIR ?? ".data";
const OUT = "public";
const SQL = await initSqlJs();

// --- Cartes -----------------------------------------------------------------
const cdbDir = join(DATA, "BabelCDB");
const cdbFiles = readdirSync(cdbDir)
  .filter((f) => f.endsWith(".cdb"))
  .filter((f) => f === "cards.cdb" || /^(release|prerelease)-/.test(f))
  .filter((f) => !f.includes("rush"))
  // cards.cdb en dernier pour que les données officielles écrasent les pré-sorties
  .sort((a, b) => (a === "cards.cdb" ? 1 : b === "cards.cdb" ? -1 : a.localeCompare(b)));

const cards = new Map();
for (const file of cdbFiles) {
  const db = new SQL.Database(readFileSync(join(cdbDir, file)));
  const res = db.exec(
    "select d.id,d.ot,d.alias,d.setcode,d.type,d.atk,d.def,d.level,d.race,d.attribute,d.category,t.name,t.desc," +
      Array.from({ length: 16 }, (_, i) => `t.str${i + 1}`).join(",") +
      " from datas d join texts t on t.id=d.id",
  );
  for (const row of res[0]?.values ?? []) {
    const [id, ot, alias, setcode, type, atk, def, level, race, attribute, category, name, desc, ...strs] = row;
    // Les chaînes vides en fin de liste sont retirées pour alléger le JSON.
    while (strs.length && !strs[strs.length - 1]) strs.pop();
    cards.set(id, [id, ot, alias, String(setcode), type, atk, def, level, race, attribute, name, desc, strs, String(category)]);
  }
  db.close();
}
mkdirSync(join(OUT, "data"), { recursive: true });
const list = [...cards.values()].sort((a, b) => a[0] - b[0]);
writeFileSync(join(OUT, "data", "cards.json"), JSON.stringify(list));
console.log(`cartes: ${list.length} (${cdbFiles.join(", ")})`);

// --- Chaînes système (FR avec repli EN) -------------------------------------
function parseStrings(file) {
  const out = { system: {}, victory: {}, counter: {}, setname: {} };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^!(system|victory|counter|setname)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const key = m[1] === "system" ? Number(m[2]) : parseInt(m[2], 16);
    out[m[1]][key] = m[3].split("\t")[0].trim();
  }
  return out;
}
const en = parseStrings(join(DATA, "Distribution", "config", "strings.conf"));
const fr = parseStrings(join(DATA, "Distribution", "config", "languages", "Français", "strings.conf"));
const strings = {};
for (const k of Object.keys(en)) strings[k] = { ...en[k], ...fr[k] };
writeFileSync(join(OUT, "data", "strings.json"), JSON.stringify(strings));

// --- Banlists ----------------------------------------------------------------
const banlists = [];
for (const file of ["0TCG.lflist.conf", "OCG.lflist.conf"]) {
  const path = join(DATA, "LFLists", file);
  if (!existsSync(path)) continue;
  let current = null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.startsWith("!")) {
      current = { name: line.slice(1).trim(), cards: {} };
      banlists.push(current);
    } else if (current && /^\d/.test(line)) {
      const [code, count] = line.split(/\s+/);
      current.cards[code] = Number(count);
    }
  }
}
writeFileSync(join(OUT, "data", "banlists.json"), JSON.stringify(banlists));
console.log(`banlists: ${banlists.map((b) => b.name).join(", ")}`);

// --- Scripts Lua (aplatis dans public/scripts) -----------------------------
const scriptsOut = join(OUT, "scripts");
rmSync(scriptsOut, { recursive: true, force: true });
mkdirSync(scriptsOut, { recursive: true });
const scriptsDir = join(DATA, "CardScripts");
let copied = 0;
const copyLua = (dir) => {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".lua")) continue;
    copyFileSync(join(dir, f), join(scriptsOut, f));
    copied++;
  }
};
copyLua(join(scriptsDir, "pre-release"));
copyLua(join(scriptsDir, "official"));
copyLua(scriptsDir);
copyFileSync(join(scriptsDir, "unofficial", "proc_unofficial.lua"), join(scriptsOut, "proc_unofficial.lua"));
// Scripts utilitaires préchargés au début de chaque duel.
const baseScripts = readdirSync(scriptsDir).filter((f) => f.endsWith(".lua")).concat("proc_unofficial.lua");
writeFileSync(join(OUT, "data", "base-scripts.json"), JSON.stringify(baseScripts));
console.log(`scripts: ${copied}`);

// --- Decks de démarrage ------------------------------------------------------
const decksOut = join(OUT, "data", "decks");
mkdirSync(decksOut, { recursive: true });
const starter = [];
for (const dir of [join(DATA, "Distribution", "deck"), "decks"]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ydk"))) {
    starter.push({ name: f.replace(/\.ydk$/, "").replace(/^\[[^\]]*\]\s*/, ""), ydk: readFileSync(join(dir, f), "utf8") });
  }
}
writeFileSync(join(decksOut, "starter.json"), JSON.stringify(starter));
console.log(`decks: ${starter.length}`);
