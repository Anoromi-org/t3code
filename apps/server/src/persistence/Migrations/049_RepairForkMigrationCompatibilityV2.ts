import * as Effect from "effect/Effect";
import repairLegacyFork from "./048_RepairForkMigrationCompatibility.ts";
import repair0 from "./041_AuthSessionClientConnection.ts";
import repair1 from "./042_ProjectionThreadLinkedPullRequest.ts";
import repair2 from "./043_ProjectionThreadsUnsettledAt.ts";
import repair3 from "./044_ClearAutomaticProjectModelDefaults.ts";
import repair4 from "./045_ProjectionProjectsAutoPull.ts";
import repair5 from "./046_RepairAutomaticSettlementTimestamps.ts";
import repair6 from "./047_ProjectionProjectIcon.ts";

// Fork releases occupied canonical ids 41–47 and recorded their repair at 48.
// Keep that ledger intact and restore every skipped effect after both histories.
export default Effect.gen(function* () {
  yield* repairLegacyFork;
  yield* repair0;
  yield* repair1;
  yield* repair2;
  yield* repair3;
  yield* repair4;
  yield* repair5;
  yield* repair6;
});
