import { NextResponse } from "next/server";
import {
  ADVANCED_ENTITLEMENT_REQUIRED_CODE,
  ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE,
} from "@vs/domain";

export function advancedEntitlementRequiredJsonResponse(): NextResponse {
  return NextResponse.json(
    {
      error: ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE,
      code: ADVANCED_ENTITLEMENT_REQUIRED_CODE,
    },
    { status: 403 },
  );
}
