export type AssistantForkSourceChoice = {
  agent?: string;
  providerID?: string;
  modelID?: string;
  variant?: string;
} | null;

export type AssistantForkCurrentChoice = {
  providerID?: string | null;
  modelID?: string | null;
  agent?: string | null;
  lastUsedProvider?: {
    providerID?: string;
    modelID?: string;
  } | null;
};

export type AssistantForkSendChoice = {
  providerID: string;
  modelID: string;
  agent?: string;
  variant?: string;
};

const nonEmpty = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const resolveCompleteModelChoice = (
  choice: { providerID?: string | null; modelID?: string | null },
): { providerID: string; modelID: string } | null => {
  const providerID = nonEmpty(choice.providerID);
  const modelID = nonEmpty(choice.modelID);
  return providerID && modelID ? { providerID, modelID } : null;
};

export const resolveAssistantForkSendChoice = (
  sourceChoice: AssistantForkSourceChoice,
  currentChoice: AssistantForkCurrentChoice,
): AssistantForkSendChoice | null => {
  const sourceModelChoice = sourceChoice ? resolveCompleteModelChoice(sourceChoice) : null;
  const modelChoice = sourceModelChoice
    ?? resolveCompleteModelChoice(currentChoice)
    ?? (currentChoice.lastUsedProvider ? resolveCompleteModelChoice(currentChoice.lastUsedProvider) : null);

  if (!modelChoice) {
    return null;
  }

  return {
    providerID: modelChoice.providerID,
    modelID: modelChoice.modelID,
    agent: nonEmpty(sourceChoice?.agent) ?? nonEmpty(currentChoice.agent),
    variant: sourceModelChoice ? nonEmpty(sourceChoice?.variant) : undefined,
  };
};
