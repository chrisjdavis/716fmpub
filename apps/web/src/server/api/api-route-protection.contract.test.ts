import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PUBLIC_API_ROUTE_SEGMENTS } from "@/server/api/public-api-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoutesRoot = path.join(__dirname, "..", "..", "app", "api");

function collectRouteTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectRouteTsFiles(p));
    } else if (ent.name === "route.ts") {
      out.push(p);
    }
  }
  return out;
}

function relApiRoutePosix(absPath: string): string {
  return path.relative(apiRoutesRoot, absPath).split(path.sep).join("/");
}

function isPublicRouteFile(absPath: string): boolean {
  const relPosix = relApiRoutePosix(absPath);
  const segment = relPosix.replace(/\/route\.ts$/, "");
  return (PUBLIC_API_ROUTE_SEGMENTS as readonly string[]).includes(segment);
}

/** Bearer-secret routes under `app/api/internal/*`; see `internal-api-paths.ts`. */
function isInternalRouteFile(absPath: string): boolean {
  return relApiRoutePosix(absPath).startsWith("internal/");
}

function hasExportKeyword(node: ts.FunctionDeclaration): boolean {
  return (
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

function isHttpMethodName(name: string | undefined): name is "GET" | "POST" | "PATCH" | "PUT" | "DELETE" {
  return (
    name === "GET" ||
    name === "POST" ||
    name === "PATCH" ||
    name === "PUT" ||
    name === "DELETE"
  );
}

function isSessionGuardWrappedCall(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr)) {
    return false;
  }
  if (!ts.isIdentifier(expr.expression)) {
    return false;
  }
  const name = expr.expression.text;
  if (name !== "withApiSession" && name !== "withAdminApiSession") {
    return false;
  }
  /** `withApiSession` / `withAdminApiSession(request, handler)` — request plus session callback. */
  return expr.arguments.length >= 2;
}

function blockReturnsWithApiSession(block: ts.Block): boolean {
  for (const st of block.statements) {
    if (ts.isReturnStatement(st) && st.expression && isSessionGuardWrappedCall(st.expression)) {
      return true;
    }
    if (ts.isTryStatement(st) && st.tryBlock) {
      if (blockReturnsWithApiSession(st.tryBlock)) {
        return true;
      }
    }
  }
  return false;
}

function assertRouteHandlersAreSessionWrapped(filePath: string, sourceText: string): void {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt)) {
      continue;
    }
    if (!hasExportKeyword(stmt) || !stmt.name) {
      continue;
    }
    if (!isHttpMethodName(stmt.name.text)) {
      continue;
    }
    if (!stmt.body) {
      throw new Error(`${filePath}: exported ${stmt.name.text} has no body`);
    }
    if (!blockReturnsWithApiSession(stmt.body)) {
      throw new Error(
        `${filePath}: exported ${stmt.name.text} must return withApiSession(...) or withAdminApiSession(...) at route top level`,
      );
    }
  }
}

describe("API route protection contract", () => {
  it("lists every App Router api route file", () => {
    const files = collectRouteTsFiles(apiRoutesRoot);
    expect(files.length).toBeGreaterThan(0);
  });

  it("requires withApiSession on every non-public route handler", () => {
    const files = collectRouteTsFiles(apiRoutesRoot);
    for (const file of files) {
      if (isPublicRouteFile(file) || isInternalRouteFile(file)) {
        continue;
      }
      const sourceText = fs.readFileSync(file, "utf8");
      assertRouteHandlersAreSessionWrapped(file, sourceText);
    }
  });

  it("requires requireInternalApiAuth in internal route modules", () => {
    const files = collectRouteTsFiles(apiRoutesRoot).filter(isInternalRouteFile);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sourceText = fs.readFileSync(file, "utf8");
      expect(sourceText, file).toContain("requireInternalApiAuth");
    }
  });
});
