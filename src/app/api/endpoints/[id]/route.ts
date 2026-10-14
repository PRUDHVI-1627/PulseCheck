import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const EDITABLE_FIELDS = new Set([
  "name",
  "url",
  "method",
  "headers",
  "body",
  "expected_status",
  "check_interval_seconds",
  "timeout_ms",
  "retries",
  "is_active",
]);
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidHeaders(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((headerValue) => typeof headerValue === "string")
  );
}

function validateUpdate(body: Record<string, unknown>): string | null {
  const entries = Object.entries(body);
  if (entries.length === 0) return "At least one field is required";

  for (const [field, value] of entries) {
    if (!EDITABLE_FIELDS.has(field)) return `Field "${field}" cannot be updated`;

    switch (field) {
      case "name":
        if (typeof value !== "string" || !value.trim()) return "Name cannot be empty";
        break;
      case "url":
        if (!isValidUrl(value)) return "URL must be a valid HTTP(S) URL";
        break;
      case "method":
        if (
          typeof value !== "string" ||
          !HTTP_METHODS.has(value.toUpperCase())
        ) {
          return "Invalid HTTP method";
        }
        break;
      case "headers":
        if (!isValidHeaders(value)) return "Headers must be an object of strings";
        break;
      case "body":
        if (value !== null && typeof value !== "string") {
          return "Body must be a string or null";
        }
        break;
      case "expected_status":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 100 ||
          value > 599
        ) {
          return "Expected status must be an integer between 100 and 599";
        }
        break;
      case "check_interval_seconds":
      case "timeout_ms":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
          return `${field} must be a positive integer`;
        }
        break;
      case "retries":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          return "Retries must be a non-negative integer";
        }
        break;
      case "is_active":
        if (typeof value !== "boolean") return "is_active must be a boolean";
        break;
    }
  }

  return null;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { data: endpoint, error } = await supabaseAdmin
    .from("endpoints")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }

  return NextResponse.json(endpoint);
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const validationError = validateUpdate(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const updates = { ...body };
  if (typeof updates.name === "string") updates.name = updates.name.trim();
  if (typeof updates.url === "string") updates.url = updates.url.trim();
  if (typeof updates.method === "string") updates.method = updates.method.toUpperCase();

  const { id } = await params;
  const { data: endpoint, error } = await supabaseAdmin
    .from("endpoints")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }

  return NextResponse.json(endpoint);
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { data: endpoint, error } = await supabaseAdmin
    .from("endpoints")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
