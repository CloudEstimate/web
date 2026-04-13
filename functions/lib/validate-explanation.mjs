const forbiddenWords = ["powerful", "seamless", "robust", "optimal", "approximately", "might", "could"];

export function validateExplanation(text) {
  const normalised = text.trim();
  const sentenceCount = normalised.split(/[.!?]+/).filter(Boolean).length;

  if (sentenceCount < 3 || sentenceCount > 4) {
    return { ok: false, reason: "Sentence count must be between 3 and 4." };
  }

  if (normalised.length < 200 || normalised.length > 600) {
    return { ok: false, reason: "Explanation length must be between 200 and 600 characters." };
  }

  const lower = normalised.toLowerCase();
  if (forbiddenWords.some((word) => lower.includes(word))) {
    return { ok: false, reason: "Explanation contains forbidden wording." };
  }

  return { ok: true };
}
