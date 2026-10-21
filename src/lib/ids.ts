const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL から受け取った ID を、パスやクエリに載せる前に形だけ確かめる。 */
export function isEventId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
