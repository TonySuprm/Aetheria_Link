export class KitsuId {
  public readonly id: string;
  public readonly season: number | undefined = undefined;
  public readonly episode: number | undefined;

  public constructor(id: string, episode?: number) {
    this.id = id;
    this.episode = episode;
  }

  public static fromString(id: string): KitsuId {
    const idParts = id.split(':');

    if (!idParts[0] || !/^\d+$/.test(idParts[0])) {
      throw new Error(`Kitsu ID "${id}" is invalid`);
    }

    return new KitsuId(
      idParts[0],
      idParts[1] ? parseInt(idParts[1], 10) : undefined,
    );
  }

  public toString(): string {
    return this.episode !== undefined ? `${this.id}:${this.episode}` : this.id;
  }
}
