import type { Diagnostic } from "@pinesandbox/computer";

export const diagnosticView = (d: Diagnostic) => ({
  id: d.id,
  state: d.state,
  createdAt: d.createdAt?.toISOString(),
  completedAt: d.completedAt?.toISOString(),
  assessment: d.assessment,
});
