const forbiddenWords = [
  "powerful",
  "seamless",
  "robust",
  "optimal",
  "approximately",
  "might",
  "could",
  "innovative",
  "revolutionary",
  "smart",
  "delightful"
];

const forbiddenPattern = new RegExp(`\\b(${forbiddenWords.join("|")})\\b`, "i");
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

export function countSentences(text) {
  return Array.from(sentenceSegmenter.segment(text.trim())).filter(({ segment }) =>
    /[a-z0-9]/i.test(segment)
  ).length;
}

export function validateExplanation(text) {
  const normalised = text.trim();

  if (/^\s*[-*#]\s/m.test(normalised)) {
    return { ok: false, reason: "Explanation must be plain prose without bullet lists or headers." };
  }

  const sentenceCount = countSentences(normalised);

  if (sentenceCount < 3 || sentenceCount > 4) {
    return { ok: false, reason: `Sentence count must be between 3 and 4 (got ${sentenceCount}).` };
  }

  if (normalised.length < 200 || normalised.length > 600) {
    return {
      ok: false,
      reason: `Explanation length must be between 200 and 600 characters (got ${normalised.length}).`
    };
  }

  const match = normalised.match(forbiddenPattern);
  if (match) {
    return { ok: false, reason: `Explanation contains forbidden wording ("${match[0]}").` };
  }

  return { ok: true };
}
