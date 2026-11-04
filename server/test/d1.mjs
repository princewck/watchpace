import { readFileSync, readdirSync } from "node:fs";
import { SQLiteD1 } from "../node-runtime/database.mjs";
export class D1 extends SQLiteD1 {
  constructor() {
    super(":memory:");
    for (const name of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((x) => x.endsWith(".sql"))
      .sort())
      this.db.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
  }
}
