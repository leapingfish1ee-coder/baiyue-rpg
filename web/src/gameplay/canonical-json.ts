export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("canonical JSON rejects lone high surrogates");
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("canonical JSON rejects lone low surrogates");
    }
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError("canonical JSON numbers must be canonical safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError("canonical JSON rejects sparse arrays");
    }
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError(`canonical JSON does not support ${typeof value}`);

  const record = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("canonical JSON only accepts plain objects");
  const members = Object.keys(record)
    .sort(compareCodePoints)
    .map((key) => {
      assertUnicodeScalarString(key);
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    });
  return `{${members.join(",")}}`;
}
