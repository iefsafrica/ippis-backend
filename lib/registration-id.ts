function parseIppisParts(cleaned: string): { part1: string; part2: string } | null {
  // Case 1: IPPIS followed by 2 number groups, e.g. IPPIS-877298-4125 or IPPIS 877298 4125 or IPPIS_877298_4125
  const twoPartMatch = cleaned.match(/^IPPIS[-\s_]*0*(\d+)[-\s_]+0*(\d+)$/);
  if (twoPartMatch) {
    return { part1: twoPartMatch[1]!, part2: twoPartMatch[2]! };
  }

  // Case 2: Just 2 number groups without IPPIS prefix, e.g. 877298-4125
  const twoPartNoPrefix = cleaned.match(/^0*(\d{4,})[-\s_]+0*(\d+)$/);
  if (twoPartNoPrefix) {
    return { part1: twoPartNoPrefix[1]!, part2: twoPartNoPrefix[2]! };
  }

  // Case 3: 10 digits attached to IPPIS, e.g. IPPIS8772984125 or IPPIS-8772984125 (6 + 4 standard)
  const tenDigitMatch = cleaned.match(/^IPPIS[-\s_]*(\d{6})(\d{4})$/);
  if (tenDigitMatch) {
    return { part1: tenDigitMatch[1]!, part2: tenDigitMatch[2]! };
  }

  return null;
}

function parseIppisSingle(cleaned: string): string | null {
  const singleMatch = cleaned.match(/^IPPIS[-\s_]*0*(\d+)$/);
  if (singleMatch) {
    return singleMatch[1]!;
  }

  const digitsOnly = cleaned.match(/^0*(\d{1,5})$/);
  if (digitsOnly) {
    return digitsOnly[1]!;
  }

  return null;
}

export function normalizeRegistrationId(value: string): string {
  const cleaned = value.trim().toUpperCase();

  const twoParts = parseIppisParts(cleaned);
  if (twoParts) {
    return `IPPIS${twoParts.part1}${twoParts.part2}`;
  }

  const single = parseIppisSingle(cleaned);
  if (single) {
    return `IPPIS${single}`;
  }

  return cleaned.replace(/[^A-Z0-9]/g, "");
}

export function canonicalizeRegistrationId(value: string): string {
  const cleaned = value.trim().toUpperCase();

  const twoParts = parseIppisParts(cleaned);
  if (twoParts) {
    return `IPPIS-${twoParts.part1}-${twoParts.part2}`;
  }

  const single = parseIppisSingle(cleaned);
  if (single) {
    const width = Math.max(4, single.length);
    return `IPPIS-${single.padStart(width, "0")}`;
  }

  return cleaned;
}

export function buildRegistrationLookupExpression(columnName: string): string {
  return `regexp_replace(regexp_replace(upper(${columnName}), '[^A-Z0-9]', '', 'g'), '^IPPIS0+', 'IPPIS', '')`;
}

export function resolveRegistrationIdInput(
  headerValue?: string | null,
  bodyValue?: string | null
): string | null {
  const raw = headerValue?.trim() || bodyValue?.trim() || "";
  if (!raw) return null;
  return canonicalizeRegistrationId(raw);
}

export function hasRegistrationId(value?: string | null): value is string {
  return Boolean(value && value.trim());
}

export function buildRegistrationIdVariants(value: string): string[] {
  const raw = value.trim();
  const upper = raw.toUpperCase();
  const cleaned = upper;

  const variants = new Set<string>([raw, upper]);

  const twoParts = parseIppisParts(cleaned);
  if (twoParts) {
    const { part1, part2 } = twoParts;
    const combined = `${part1}${part2}`;
    variants.add(`IPPIS-${part1}-${part2}`);
    variants.add(`IPPIS ${part1} ${part2}`);
    variants.add(`IPPIS ${part1}-${part2}`);
    variants.add(`IPPIS-${combined}`);
    variants.add(`IPPIS ${combined}`);
    variants.add(`IPPIS${combined}`);
    variants.add(`${part1}-${part2}`);
    variants.add(`${part1} ${part2}`);
    variants.add(combined);
  }

  const single = parseIppisSingle(cleaned);
  if (single) {
    const padded4 = single.padStart(4, "0");
    const padded3 = single.padStart(3, "0");
    variants.add(`IPPIS-${padded4}`);
    variants.add(`IPPIS-${padded3}`);
    variants.add(`IPPIS-${single}`);
    variants.add(`IPPIS ${padded4}`);
    variants.add(`IPPIS ${padded3}`);
    variants.add(`IPPIS ${single}`);
    variants.add(`IPPIS${padded4}`);
    variants.add(`IPPIS${single}`);
    variants.add(padded4);
    variants.add(single);
  }

  const alphanumeric = cleaned.replace(/[^A-Z0-9]/g, "");
  if (alphanumeric) {
    variants.add(alphanumeric);
    if (!alphanumeric.startsWith("IPPIS")) {
      variants.add(`IPPIS${alphanumeric}`);
      variants.add(`IPPIS-${alphanumeric}`);
    }
  }

  return Array.from(variants).filter(Boolean);
}

export async function findRegistrationIdInDb(
  sqlClient: any,
  inputId: string
): Promise<string | null> {
  if (!inputId || !inputId.trim()) return null;

  for (const candidate of buildRegistrationIdVariants(inputId)) {
    const rows = (await sqlClient`
      SELECT registration_id
      FROM registrations
      WHERE registration_id = ${candidate}
      LIMIT 1
    `) as Array<{ registration_id: string }>;

    if (rows.length > 0 && rows[0]?.registration_id) {
      return rows[0].registration_id;
    }
  }

  const stripped = inputId.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (stripped) {
    const fallbackRows = (await sqlClient`
      SELECT registration_id
      FROM registrations
      WHERE regexp_replace(upper(registration_id), '[^A-Z0-9]', '', 'g') = ${stripped}
      LIMIT 1
    `) as Array<{ registration_id: string }>;

    if (fallbackRows.length > 0 && fallbackRows[0]?.registration_id) {
      return fallbackRows[0].registration_id;
    }
  }

  return null;
}
