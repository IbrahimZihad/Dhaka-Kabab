import { revalidateTag } from "next/cache";

/**
 * The two cached scopes on the guest side, invalidated from the staff write
 * routes. `updateTag` would give read-your-own-writes, but it only exists inside
 * Server Actions and these mutations are REST route handlers, so the documented
 * primitive here is `revalidateTag`.
 *
 * A minute is the point where being right beats being fast: until then a visitor
 * is served the previous copy while the refresh runs, and past then a request
 * waits for fresh data rather than showing yesterday's price or last month's
 * restaurant name.
 */
const STALE_WINDOW_SECONDS = 60;

export function revalidateMenu() {
  revalidateTag("menu", { expire: STALE_WINDOW_SECONDS });
}

export function revalidateSettings() {
  revalidateTag("settings", { expire: STALE_WINDOW_SECONDS });
}
