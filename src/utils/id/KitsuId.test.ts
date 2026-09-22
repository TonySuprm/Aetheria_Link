import { KitsuId } from './KitsuId';

describe('can be created from string', () => {
  test('splits id and episode', () => {
    const kitsuId = KitsuId.fromString('12345:7');

    expect(kitsuId.id).toBe('12345');
    expect(kitsuId.episode).toBe(7);
    expect(kitsuId.season).toBeUndefined();

    expect(kitsuId.toString()).toBe('12345:7');
  });

  test('supports movie without episode', () => {
    const kitsuId = KitsuId.fromString('12345');

    expect(kitsuId.id).toBe('12345');
    expect(kitsuId.episode).toBeUndefined();
    expect(kitsuId.season).toBeUndefined();

    expect(kitsuId.toString()).toBe('12345');
  });

  test('throws for empty ids', () => {
    expect(() => {
      KitsuId.fromString('');
    }).toThrow('Kitsu ID "" is invalid');
  });

  test('throws for invalid ids', () => {
    expect(() => {
      KitsuId.fromString('foo');
    }).toThrow('Kitsu ID "foo" is invalid');
  });
});
