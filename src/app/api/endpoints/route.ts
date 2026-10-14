import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

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

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: endpoints, error: endpointError } = await supabaseAdmin
    .from("endpoints")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (endpointError) {
    return NextResponse.json({ error: endpointError.message }, { status: 500 });
  }

  if (endpoints.length === 0) {
    return NextResponse.json([]);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endpointIds = endpoints.map((endpoint) => endpoint.id);
  const [checksResult, latestChecks] = await Promise.all([
    supabaseAdmin
      .from("health_checks")
      .select("endpoint_id, status, response_time_ms")
      .in("endpoint_id", endpointIds)
      .gte("checked_at", since),
    Promise.all(
      endpoints.map(async (endpoint) => {
        const result = await supabaseAdmin
          .from("health_checks")
          .select("status, checked_at")
          .eq("endpoint_id", endpoint.id)
          .order("checked_at", { ascending: false })
          .limit(1);

        return { endpointId: endpoint.id, ...result };
      })
    ),
  ]);

  if (checksResult.error) {
    return NextResponse.json(
      { error: checksResult.error.message },
      { status: 500 }
    );
  }

  const latestError = latestChecks.find((result) => result.error)?.error;
  if (latestError) {
    return NextResponse.json({ error: latestError.message }, { status: 500 });
  }

  const checksByEndpoint = new Map<string, typeof checksResult.data>();
  for (const check of checksResult.data) {
    const checks = checksByEndpoint.get(check.endpoint_id) ?? [];
    checks.push(check);
    checksByEndpoint.set(check.endpoint_id, checks);
  }

  const latestByEndpoint = new Map(
    latestChecks.map((result) => [result.endpointId, result.data?.[0] ?? null])
  );

  const enriched = endpoints.map((endpoint) => {
    const checks = checksByEndpoint.get(endpoint.id) ?? [];
    const upCount = checks.filter((check) => check.status === "up").length;
    const responseTimes = checks
      .map((check) => check.response_time_ms)
      .filter((time): time is number => time !== null);
    const uptime = checks.length > 0 ? (upCount / checks.length) * 100 : 100;
    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) /
          responseTimes.length
        : 0;
    const latestCheck = latestByEndpoint.get(endpoint.id);

    return {
      ...endpoint,
      current_status: latestCheck?.status ?? "unknown",
      uptime_24h: Math.round(uptime * 100) / 100,
      avg_response_time: Math.round(averageResponseTime),
      last_checked: latestCheck?.checked_at ?? null,
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
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

  const {
    name,
    url,
    method = "GET",
    headers = {},
    body: requestBody = null,
    expected_status = 200,
    check_interval_seconds = 60,
    timeout_ms = 10000,
    retries = 2,
  } = body;

  if (typeof name !== "string" || !name.trim() || !isValidUrl(url)) {
    return NextResponse.json(
      { error: "A non-empty name and valid HTTP(S) URL are required" },
      { status: 400 }
    );
  }
  if (
    typeof method !== "string" ||
    !HTTP_METHODS.has(method.toUpperCase()) ||
    !isValidHeaders(headers) ||
    (requestBody !== null && typeof requestBody !== "string") ||
    typeof expected_status !== "number" ||
    !Number.isInteger(expected_status) ||
    expected_status < 100 ||
    expected_status > 599 ||
    typeof check_interval_seconds !== "number" ||
    !Number.isInteger(check_interval_seconds) ||
    check_interval_seconds < 1 ||
    typeof timeout_ms !== "number" ||
    !Number.isInteger(timeout_ms) ||
    timeout_ms < 1 ||
    typeof retries !== "number" ||
    !Number.isInteger(retries) ||
    retries < 0
  ) {
    return NextResponse.json({ error: "Invalid endpoint settings" }, { status: 400 });
  }

  const { data: endpoint, error } = await supabaseAdmin
    .from("endpoints")
    .insert({
      user_id: user.id,
      name: name.trim(),
      url: url.trim(),
      method: method.toUpperCase(),
      headers,
      body: requestBody,
      expected_status,
      check_interval_seconds,
      timeout_ms,
      retries,
    })
    .select()
    .single();

  if (error) {
    console.error("Create endpoint error:", error);
    return NextResponse.json(
      { error: "Failed to create endpoint" },
      { status: 500 }
    );
  }

  return NextResponse.json(endpoint, { status: 201 });
}
