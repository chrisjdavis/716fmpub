import { isSensitiveKeyName } from "./log-redaction.js";

/** Shape-compatible with `z.ZodError#flatten()` for public HTTP `details` payloads. */
export type ZodFlattenForApi = {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
};

function fieldPathTouchesSensitiveKey(flatKey: string): boolean {
  return flatKey.split(".").some((segment) => isSensitiveKeyName(segment));
}

/**
 * Replaces Zod `fieldErrors` messages for credential-bearing keys so validation failures
 * never echo secret-shaped input via issue text, even if a future refinement changes wording.
 */
export function redactZodFlattenForPublicApi(flat: ZodFlattenForApi): ZodFlattenForApi {
  const fieldErrors: Record<string, string[] | undefined> = { ...flat.fieldErrors };
  for (const key of Object.keys(fieldErrors)) {
    if (fieldPathTouchesSensitiveKey(key)) {
      fieldErrors[key] = ["Invalid value"];
    }
  }
  return { formErrors: [...flat.formErrors], fieldErrors };
}
