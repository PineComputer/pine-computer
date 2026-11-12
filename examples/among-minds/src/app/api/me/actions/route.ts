// The resident API: the same actions a native writes to its outbox. Delivering,
// publishing and sharing skills read files from the visitor's home, which is woken for it.

import { body, route } from "@/server/http";
import { visitor } from "@/server/visitor";
import { Actions, apply } from "@/engine/actions";
import { wake } from "@/engine/homes";
import { config } from "@/engine/config";
import { run } from "@/engine/db";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const me = visitor(request);
  const actions = Actions.parse(await body(request));
  const needsHome = Boolean(actions.deliver?.length || actions.publish?.length || actions.shareSkill?.length);
  if (needsHome && config().paused) throw new Error("The world is paused.");
  const home = needsHome ? await wake(me) : undefined;
  const results = await apply(me, actions, { via: "api" }, home);
  if (actions.intention) run("update residents set intention = ? where id = ?", actions.intention, me.id);
  return { results };
});
