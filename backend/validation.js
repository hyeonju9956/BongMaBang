export class ValidationError extends Error {
  constructor(fields) {
    super("요청 데이터가 올바르지 않습니다.");
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export function validateEpisode(input) {
  const errors = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError({ episode: "객체 형식이어야 합니다." });
  }

  const allowed = new Set(["era", "title", "who", "text", "bright"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors[key] = "허용되지 않는 필드입니다.";
  }

  const result = {};
  for (const key of ["era", "title", "text"]) {
    if (typeof input[key] !== "string") {
      errors[key] = "문자열이어야 합니다.";
    } else {
      result[key] = input[key].trim();
      if (!result[key]) errors[key] = "비워둘 수 없습니다.";
      if (result[key].length > (key === "text" ? 100000 : 200)) {
        errors[key] = "입력 가능한 길이를 초과했습니다.";
      }
    }
  }

  if (input.who === undefined) {
    result.who = [];
  } else if (!Array.isArray(input.who)) {
    errors.who = "문자열 배열이어야 합니다.";
  } else {
    result.who = input.who.map((person, index) => {
      if (typeof person !== "string") {
        errors[`who.${index}`] = "문자열이어야 합니다.";
        return "";
      }
      const name = person.trim();
      if (name.length > 100) errors[`who.${index}`] = "이름은 100자 이하여야 합니다.";
      return name;
    }).filter(Boolean);
    if (result.who.length > 100) errors.who = "인물은 100명 이하로 입력해 주세요.";
  }

  if (input.bright !== undefined && typeof input.bright !== "boolean") {
    errors.bright = "true 또는 false여야 합니다.";
  } else {
    result.bright = input.bright === true;
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return result;
}

export function toExportEpisode(episode) {
  const valid = validateEpisode({
    era: episode.era,
    title: episode.title,
    who: episode.who,
    text: episode.text,
    ...(episode.bright === undefined ? {} : { bright: episode.bright })
  });
  if (valid.bright) return valid;
  delete valid.bright;
  return valid;
}
