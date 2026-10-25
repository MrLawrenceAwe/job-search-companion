import { inferenceSettingsContract } from "../../shared/contracts.js";
import { hashJson } from "../../shared/sha256.js";
import { readProfileEvidence } from "./profile.js";

export const combineProfileAndCvEvidence = (profile, index, { indexModel, indexPath } = {}) => {
  if (!index) {
    return {
      ...profile,
      cvIndexStatus: "pending",
      hash: hashJson({ facts: profile.facts, cvFingerprint: null, indexModel }),
    };
  }
  const facts = [
    ...profile.facts,
    ...index.facts.map((fact, position) => ({ ...fact, id: `CV${position + 1}` })),
  ];
  return {
    ...profile,
    cvIndexStatus: "current",
    facts,
    sources: indexPath
      ? [...profile.sources, { name: "CV experience index", path: indexPath }]
      : profile.sources,
    hash: hashJson({ facts, cvFingerprint: index.fingerprint }),
  };
};

export const createEvidenceProvider = ({ profileSources, cvIndex, indexPath, getIndexModel }) => {
  let preparationController = new AbortController();
  const combine = (profile, index, model) =>
    combineProfileAndCvEvidence(profile, index, { indexModel: model, indexPath });
  return {
    async readCurrent() {
      const profile = await readProfileEvidence(profileSources);
      if (!cvIndex) return { ...profile, cvIndexStatus: "disabled" };
      const model = getIndexModel();
      return combine(profile, await cvIndex.readCurrent({ model }), model);
    },
    async prepareCurrent({ signal } = {}) {
      const profile = await readProfileEvidence(profileSources);
      if (!cvIndex) return { ...profile, cvIndexStatus: "disabled" };
      if (preparationController.signal.aborted) preparationController = new AbortController();
      const model = getIndexModel();
      const workSignal = signal
        ? AbortSignal.any([signal, preparationController.signal])
        : preparationController.signal;
      const index = await cvIndex.ensureCurrent({
        signal: workSignal,
        model,
        reasoningEffort: inferenceSettingsContract.indexingReasoningEffort,
      });
      return combine(profile, index, model);
    },
    cancelPreparation() {
      preparationController.abort();
    },
  };
};
