// The arcade layer: Matt's patience (the fail state), points and multipliers, going viral, and
// the high-score board. Dollars are still counted, as what you made Matt.

export const PATIENCE = {
  /** Losing patience comes quicker than winning it back: losses are scaled up, gains scaled down. */
  drain: 1.5,
  regain: 0.6,
  /** A new hire gets this long (game seconds) before Matt can fire them. */
  grace: 60,
  /** How close to the edge he can get during the grace period, or while the place is viral (above fireAt). */
  floor: 0.4,
};

// The score is money, and like a pinball table's it is preposterous: a box of toasted ravs is worth
// thousands. (What the register actually took is still counted, and shown at the end.)
export const POINTS = {
  /** Per rav that goes out: cooked just right, or merely fine. */
  perfectRav: 1000,
  okRav: 400,
  /** A cutlet onto the tray: juicy (165 to 175 or so), or merely safe. */
  juicyCutlet: 6000,
  okCutlet: 2500,
  /** Per presentation point on the box (liner, name, sauce, salt, set, dressed, house style). */
  style: 500,
  /** A whole ticket out: this much, more the faster it went (up to double). */
  ticket: 4000,
  /** Each clean ticket in a row adds one to the multiplier, up to this. */
  multMax: 8,
};

export const VIRAL = {
  /** A ticket out perfect and fast might get posted: the chance each time, once the shift is this old. */
  chance: 0.22,
  notBefore: 75,
  /** How long the frenzy lasts, and how long before it can happen again (game seconds). */
  seconds: 32,
  cooldown: 50,
  /** While it lasts: tickets come this much faster and everything scores this much more. */
  rush: 0.38,
  points: 2,
  /** Afterwards the place is simply busier: each time adds this many minutes to the difficulty clock. */
  heatMinutes: 1.5,
};

export const BOARD = { size: 10, key: 'get-toasted.scores.v2' };

export interface ScoreRow {
  name: string;
  points: number;
}

export function loadBoard(): ScoreRow[] {
  try {
    const rows = JSON.parse(localStorage.getItem(BOARD.key) ?? '[]') as ScoreRow[];
    return Array.isArray(rows) ? rows.filter((r) => typeof r.name === 'string' && typeof r.points === 'number').slice(0, BOARD.size) : [];
  } catch {
    return [];
  }
}

/** Would this score make the board? */
export function makesBoard(points: number) {
  const rows = loadBoard();
  return points > 0 && (rows.length < BOARD.size || points > (rows[rows.length - 1]?.points ?? 0));
}

/** Put a score on the board; returns where it landed (0 is the top). */
export function addToBoard(name: string, points: number) {
  const rows = loadBoard();
  const row = { name: name.toUpperCase().slice(0, 3), points };
  rows.push(row);
  rows.sort((a, b) => b.points - a.points);
  const kept = rows.slice(0, BOARD.size);
  try {
    localStorage.setItem(BOARD.key, JSON.stringify(kept));
  } catch {
    /* private mode: the board lives for this visit only */
  }
  return kept.indexOf(row);
}
