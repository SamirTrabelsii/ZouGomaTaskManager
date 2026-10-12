/** The only database the e2e suite may touch. */
export const TEST_DATABASE_URL = 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';

/** Refuses anything that is not the dedicated test database. */
export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (name !== 'lifeos_test') throw new Error(`e2e tests may only use the lifeos_test database, got "${name}"`);
}
