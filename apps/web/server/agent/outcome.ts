import type { AgentRequest } from '../../shared/agent.js';

export function agentRequestOutcome(request: AgentRequest) {
  const automatic = request.approvalMode === 'automatic';
  const completed = request.status === 'completed' && Boolean(request.execution);
  return {
    fundsMoved: completed,
    humanApprovalRequired: !automatic,
    nextStep: automatic
      ? completed
        ? 'Execution completed within the owner’s guardrails. Use the returned Explorer link for the transaction.'
        : 'Automatic execution did not complete. Inspect request.failure and retry the identical intent with the same idempotency key when the provider is ready.'
      : 'Ask the user to open Flay → Agent access, review the exact provider transaction, and approve it in Privy before this request expires.',
  };
}
