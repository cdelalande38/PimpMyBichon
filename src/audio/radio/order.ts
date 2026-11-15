// Ordre de lecture d'une station : dans l'ordre, ou aléatoire sans redite (chaque morceau
// une fois par tour, et jamais deux fois de suite à la jonction de deux tours).

export type Random = () => number;

export function makeOrder(count: number, shuffle: boolean, random: Random = Math.random, avoidFirst = -1): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (!shuffle || count < 2) return order;
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (order[0] === avoidFirst) {
    const swap = 1 + Math.floor(random() * (count - 1));
    [order[0], order[swap]] = [order[swap]!, order[0]!];
  }
  return order;
}

/** File de lecture : position dans un tour, tour suivant fabriqué à la demande. */
export class PlayQueue {
  private order: number[];
  private pos: number;
  private readonly count: number;
  private shuffle: boolean;
  private readonly random: Random;
  /** Tour suivant, tiré d'avance quand on regarde au-delà de la fin du tour (peekNext). */
  private upcoming: number[] | null = null;

  constructor(count: number, shuffle: boolean, start = 0, random: Random = Math.random) {
    this.count = count;
    this.shuffle = shuffle;
    this.random = random;
    this.order = makeOrder(count, shuffle, random);
    if (shuffle && count > 1) {
      // Le morceau choisi ouvre le tour ; les autres suivent dans un ordre tiré au sort.
      const at = this.order.indexOf(start);
      if (at > 0) [this.order[0], this.order[at]] = [this.order[at]!, this.order[0]!];
      this.pos = 0;
    } else {
      this.pos = Math.min(Math.max(start, 0), Math.max(count - 1, 0));
    }
  }

  get current(): number {
    return this.order[this.pos] ?? 0;
  }

  /** Morceau qui suivra : next() rendra exactement celui-là (le tour suivant est tiré d'avance). */
  peekNext(): number {
    if (this.pos + 1 < this.order.length) return this.order[this.pos + 1]!;
    this.upcoming ??= makeOrder(this.count, this.shuffle, this.random, this.current);
    return this.upcoming[0] ?? 0;
  }

  next(): number {
    if (this.pos + 1 < this.order.length) {
      this.pos += 1;
    } else {
      this.order = this.upcoming ?? makeOrder(this.count, this.shuffle, this.random, this.current);
      this.upcoming = null;
      this.pos = 0;
    }
    return this.current;
  }

  previous(): number {
    if (this.pos > 0) this.pos -= 1;
    // Dans l'ordre, on remonte aussi d'un tour à l'autre ; en aléatoire, le début du tour reste le début.
    else if (!this.shuffle && this.count > 0) this.pos = this.count - 1;
    return this.current;
  }

  setShuffle(shuffle: boolean): void {
    if (shuffle === this.shuffle) return;
    const current = this.current;
    this.shuffle = shuffle;
    this.upcoming = null;
    if (shuffle) {
      this.order = makeOrder(this.count, true, this.random, current);
      const at = this.order.indexOf(current);
      [this.order[0], this.order[at]] = [this.order[at]!, this.order[0]!];
      this.pos = 0;
    } else {
      this.order = makeOrder(this.count, false);
      this.pos = current;
    }
  }
}
